import { useEffect, useRef, useState } from 'react';
import { useAsync } from '../../../lib/useAsync';
import { useAdminAuth } from '../../../lib/adminAuth';
import DataTable from '../../../components/DataTable';
import { AsyncBlock, TableSkeleton } from '../../../components/StateBlocks';
import ConfirmDialog from '../../../components/ConfirmDialog';
import { StatusBadge } from '../../../components/StatCard';
import { dateGu } from '../../../lib/format';
import { loginError } from '../../../lib/errors';
import { ROLES, roleLabel } from '../../../../../shared/domain/permissions.js';
import {
  adminWriteError,
  createAdmin,
  listAdmins,
  setRole,
  setStatus,
  updateDisplayName,
} from '../services/adminService';

/**
 * ────────────────────────────────────────────────────────────────────────────
 * The સંચાલક list — who runs the panel, and the only screen that changes it
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `permissions_for()` has granted `admins.read`, `admins.create`, `admins.update`,
 * `admins.disable` and `roles.assign` since 0004_rbac.sql, and `admin_profiles` enforced all
 * five in RLS — but no page in admin/src rendered any of it. Appointing an administrator meant
 * running a Node script by hand with the project's secret key, and there was no way at all to
 * suspend one. Five permissions the database checked on every write, against a UI that offered
 * none of the writes. This is that UI.
 *
 * ── What is shown is not what is allowed ────────────────────────────────────
 *
 * Every action below is rendered only when `can()` says the role holds its permission, and
 * that is *visibility*, exactly as it is in AdminShell's sidebar. The boundary is the policy
 * on `public.admins` plus `admins_guard()`, which refuse the same things again with no regard
 * for what this file rendered. A yuvak who edits the check out of his own copy of the bundle
 * gets a button that produces a refusal, which is the correct outcome and the reason the
 * refusal is shown in full rather than swallowed.
 *
 * The guard refuses three further things that no permission can grant, so they have no
 * checkbox here and are simply reported when they happen: appointing yourself, changing your
 * OWN role or status, and touching a SUPER_ADMIN unless you are one. The first two are what
 * stop the last SUPER_ADMIN from locking himself out of his own panel, so the rows that would
 * break them are not offered — see `isSelf` below.
 *
 * ── No password field, ever, for an administrator who exists ────────────────
 *
 * The add form carries a password because there is no auth account yet and one has to be
 * created with something. Nothing else here does. A "set his password" control would mean an
 * administrator can take over a colleague's account, and would mean this panel handling a
 * credential it has no business seeing (§67). Recovery is a link mailed to the address on the
 * row — `resetPassword()` from adminAuth.jsx, the same function the login page's "forgot your
 * password" uses, landing on the યુવક app's reset screen where the new password is typed once
 * by the person it belongs to.
 *
 * ── Suspend, never delete ───────────────────────────────────────────────────
 *
 * There is no delete. `admins_no_delete()` refuses one from anyone, service_role included,
 * and this screen agrees with it: a disabled administrator keeps his audit history attached to
 * a row that still exists, and `effective_role()` returns NULL for any status but ACTIVE, so a
 * suspension takes effect on his very next request.
 */

/** Same three states, same three tones, as the યુવક list next door (§47). */
const ACCOUNT_STATUS = {
  ACTIVE: { label: 'Active', tone: 'ok' },
  SUSPENDED: { label: 'Suspended', tone: 'warn' },
  DISABLED: { label: 'Disabled', tone: 'off' },
};

/**
 * Which statuses this screen can set, and what each one means when it is chosen.
 *
 * DISABLED and SUSPENDED are both "cannot sign in" as far as `effective_role()` is concerned;
 * the difference is intent, and the words say so rather than the colours. Only two buttons are
 * ever offered on a row — the one that turns the account off and the one that turns it back on
 * — because a three-way state control invites a person to pick between two synonyms.
 */
const STATUS_ACTIONS = {
  SUSPENDED: {
    label: 'Suspend',
    title: 'Suspend this administrator?',
    danger: true,
    confirm: 'Yes, suspend',
    body: 'He will not be able to open the panel from his next request onwards. Nothing he has done is removed - the audit trail keeps his name on it - and you can re-enable him at any time.',
  },
  ACTIVE: {
    label: 'Enable',
    title: 'Enable this administrator again?',
    danger: false,
    confirm: 'Yes, enable',
    body: 'He gets his role back immediately, with exactly the permissions it carried before.',
  },
};

/*
  The add form's three field rules, and every one of them is a copy of a rule that is enforced
  somewhere else — netlify/functions/create-admin.js checks all three again, and the CHECK on
  `admins.mobile` (0038) checks the third a third time. They are copied here so the form can
  answer before the round trip instead of after it, and they are copied *exactly* rather than
  approximately: a client rule looser than the server's turns a fixable typo into a
  "bad-request" from an endpoint, and a client rule stricter than the server's refuses details
  that would have been accepted.
*/
const looksLikeEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v).trim());
const looksLikeMobile = (v) => /^[6-9][0-9]{9}$/.test(String(v).trim());
const PASSWORD_MIN = 8;
// bcrypt truncates at 72 bytes and GoTrue refuses anything longer rather than silently cutting
// it, which would leave a password that works in one place and not another.
const PASSWORD_MAX = 72;

export default function AdminsTab() {
  const { can, user, resetPassword } = useAdminAuth();

  const [role, setRoleFilter] = useState('');
  const [status, setStatusFilter] = useState('');
  const [term, setTerm] = useState('');
  const [applied, setApplied] = useState('');

  // `pending` is the row an action is about, and which action: { kind, admin }. One piece of
  // state for all four dialogs, because only one of them can be open at a time and four
  // independent booleans is how two of them end up open at once.
  const [pending, setPending] = useState(null);
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  // The refusal, shown inside the dialog that caused it so it sits beside the control that
  // will be pressed again. Cleared when a dialog opens, never on a timer.
  const [failure, setFailure] = useState('');
  const [note, setNote] = useState(null); // { tone, text } — the result, on the page

  const state = useAsync(() => listAdmins({ role, status, term: applied }), [role, status, applied]);

  const rows = state.data?.rows || [];
  const filtered = !!role || !!status || !!applied;

  const open = (kind, admin, initial = '') => {
    setFailure('');
    // The result of the *previous* action goes when the next one is opened. It is a statement
    // about a write that has already happened, and leaving "he has been suspended" on screen
    // above a dialog about somebody else is the panel appearing to describe what is in front
    // of you.
    setNote(null);
    setDraft(initial);
    setPending({ kind, admin });
  };

  const close = () => {
    if (busy) return;
    setPending(null);
    setFailure('');
  };

  /**
   * Every write goes through here, so the four of them cannot disagree about what happens
   * afterwards.
   *
   * On success the list is re-read rather than patched in place. A patch would be one round
   * trip cheaper and would show what this component *believes* the row now says; the triggers
   * on `admins` rewrite `updated_at` and the audit trail on every write, and a re-read is the
   * only version of the row that is not a guess (§62).
   */
  const run = async (fn, done) => {
    setBusy(true);
    setFailure('');
    try {
      await fn();
      setPending(null);
      setNote({ tone: 'notice-ok', text: done });
      state.retry();
    } catch (e) {
      // Never swallowed and never generalised: the guard's refusals each name a rule the
      // person can act on, and adminWriteError() is what turns them into that sentence.
      setFailure(adminWriteError(e));
    } finally {
      setBusy(false);
    }
  };

  /**
   * The recovery email, and the one action here that is not a database write.
   *
   * loginError() rather than adminWriteError(): this is supabase.auth, so what comes back is a
   * GoTrue AuthError — over_email_send_rate_limit is the realistic one — and the SQLSTATE maps
   * would have nothing to say about it.
   */
  const sendReset = async (admin) => {
    setBusy(true);
    setFailure('');
    try {
      await resetPassword(admin.email);
      setPending(null);
      setNote({
        tone: 'notice-ok',
        text: `A password reset link has been sent to ${admin.email}. It expires, so ask him to open it soon.`,
      });
    } catch (e) {
      setFailure(loginError(e));
    } finally {
      setBusy(false);
    }
  };

  const isSelf = (a) => !!user && a.id === user.id;

  const columns = [
    {
      key: 'name',
      label: 'Name',
      render: (a) => (
        <span style={{ display: 'inline-block', maxWidth: '100%', minWidth: 0 }}>
          <span style={{ display: 'block' }}>{a.name || '-'}</span>
          {/* The optional label, under the name rather than instead of it: "સંચાલક (વરાછા)"
              says which patch he looks after, and the name says who he is. */}
          {a.displayName && a.displayName !== a.name && (
            <span className="hint">{a.displayName}</span>
          )}
          {/* Your own row, marked. Two administrators may share a name, and the rules below
              treat this row differently - saying which one it is beats leaving it to be
              worked out from the missing buttons. */}
          {isSelf(a) && <span className="chip">You</span>}
        </span>
      ),
    },
    { key: 'email', label: 'Email' },
    // Contact only since 0038, and genuinely allowed to be absent - a dash here is not a
    // number the panel failed to read.
    { key: 'mobile', label: 'Mobile', render: (a) => <span className="mono">{a.mobile || '-'}</span> },
    {
      key: 'role',
      label: 'Role',
      // The label from the shared matrix, never a string spelled here: the panel, the RLS
      // helper and the seed script all read one list, and a fourth spelling is how a role
      // starts meaning two things.
      render: (a) => <StatusBadge tone="info">{roleLabel(a.role)}</StatusBadge>,
    },
    {
      key: 'status',
      label: 'Status',
      render: (a) => {
        const s = ACCOUNT_STATUS[a.status] || { label: a.status || '-', tone: 'off' };
        return <StatusBadge tone={s.tone}>{s.label}</StatusBadge>;
      },
    },
    { key: 'createdAt', label: 'Added', render: (a) => dateGu(a.createdAt) },
  ];

  /*
    The Actions column exists only for a role that has an action. An ADMIN holds `admins.read`
    and none of the three write permissions — 0004's matrix reserves administering
    administrators for SUPER_ADMIN alone — so for him this would be a whole column of dashes
    headed "Actions", which is a column that exists to say he cannot do anything. Below 900px
    it would be worse: DataTable prints every column as a labelled line on the row's card, so
    each administrator would carry a line reading "Actions -".
  */
  if (can('roles.assign') || can('admins.disable') || can('admins.update')) {
    columns.push({
      key: 'actions',
      label: 'Actions',
      render: (a) => <RowActions admin={a} self={isSelf(a)} can={can} onOpen={open} />,
    });
  }

  return (
    <>
      <form
        className="filters"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied(term.trim());
        }}
      >
        <div className="field">
          <label htmlFor="adm-q">Search</label>
          <input
            id="adm-q"
            type="search"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Name or email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-describedby="adm-q-hint"
          />
          <span className="hint" id="adm-q-hint">Any part of the name or the email address</span>
        </div>

        <div className="field">
          <label htmlFor="adm-role">Role</label>
          <select id="adm-role" value={role} onChange={(e) => setRoleFilter(e.target.value)}>
            <option value="">All roles</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>{roleLabel(r)}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="adm-status">Status</label>
          <select id="adm-status" value={status} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All states</option>
            {Object.entries(ACCOUNT_STATUS).map(([value, s]) => (
              <option key={value} value={value}>{s.label}</option>
            ))}
          </select>
        </div>

        <button className="btn btn-quiet" type="submit">Search</button>

        {/* The one action that creates something, at the end of the filter row rather than in
            the page header: the header belongs to the section and this button belongs to the
            tab, and a "Add admin" sitting above a યુવક table would be offering the wrong thing
            on the other tab. */}
        {can('admins.create') && (
          <button
            className="btn"
            type="button"
            onClick={() => { setFailure(''); setNote(null); setAdding(true); }}
          >
            Add administrator
          </button>
        )}
      </form>

      {note && (
        <div className={`notice ${note.tone}`} role="status">
          {note.text}
        </div>
      )}

      <AsyncBlock
        state={{ ...state, isEmpty: !state.loading && !state.error && rows.length === 0 }}
        emptyTitle={filtered ? 'Nothing matches these filters' : 'No administrators'}
        emptyIcon="🛡️"
        empty={
          filtered
            ? 'No administrator matches this search, role or state.'
            : 'This list is empty, which should be impossible - you are reading it, so at least your own record exists. Reload the page, and tell whoever built the panel if it stays empty.'
        }
        emptyAction={
          filtered ? (
            <button
              className="btn btn-quiet"
              type="button"
              onClick={() => { setRoleFilter(''); setStatusFilter(''); setTerm(''); setApplied(''); }}
            >
              Clear all filters
            </button>
          ) : null
        }
        onRetry={state.retry}
        skeleton={<TableSkeleton cols={columns.length} />}
      >
        <>
          <DataTable caption="Administrator list" columns={columns} rows={rows} rowKey={(a) => a.id} />

          {/* Only ever seen if the સંઘ acquires two hundred administrators, and stated rather
              than hidden for the same reason the export says when it truncated: a list that is
              quietly partial is worse than one that says so. */}
          {state.data?.truncated && (
            <div className="notice notice-warn" role="status">
              Showing the first {state.data.cap} administrators. Narrow the search to see the rest.
            </div>
          )}

          <p className="card-note">
            An administrator is never deleted - suspend him instead, so everything the audit
            trail records stays attached to a person. Since the change of 0038 he needs no
            yuvak account, and his mobile number here is for contact only: administrators sign
            in by email.
          </p>
        </>
      </AsyncBlock>

      {/*
        One ConfirmDialog for all four row actions (§57). Its title, its body and its verb come
        from the pending action, so the four cannot drift into four different ways of asking
        the same question - and, more usefully, a refusal is rendered in the same place for all
        of them, right above the button that will be pressed again.
      */}
      <ConfirmDialog
        open={!!pending}
        title={pending ? dialogTitle(pending) : ''}
        busy={busy}
        danger={pending?.kind === 'status' && nextOf(pending) === 'SUSPENDED'}
        confirmLabel={pending ? dialogConfirm(pending) : 'Yes, do it'}
        onCancel={close}
        onConfirm={() => {
          if (!pending) return;
          const { kind, admin } = pending;
          // Derived, never carried on the pending action: the row is re-read after every
          // write, so a `next` captured when the dialog opened could describe a status the
          // row has since moved away from.
          const next = nextOf(pending);
          if (kind === 'role') {
            // Confirming without touching the select is a press that means "never mind". Sent
            // anyway it would be a real UPDATE: the trigger permits it (the role is not
            // distinct, so roles.assign is never consulted) and `audit_admin()` would record an
            // ADMIN_UPDATED against a row nothing about which changed - an entry in an
            // append-only trail describing an edit that never happened.
            if (draft === admin.role) return close();
            run(() => setRole(admin.id, draft), `${admin.name} is now ${roleLabel(draft)}.`);
          } else if (kind === 'status') {
            run(
              () => setStatus(admin.id, next),
              next === 'ACTIVE' ? `${admin.name} can use the panel again.` : `${admin.name} has been suspended.`
            );
          } else if (kind === 'name') {
            // Same reason as the role above: an unchanged value is a no-op that would still
            // write a row and still be recorded as a change.
            if (draft.trim() === admin.displayName) return close();
            run(() => updateDisplayName(admin.id, draft), 'The display name has been saved.');
          } else if (kind === 'reset') {
            sendReset(admin);
          }
        }}
        body={
          pending && (
            <DialogBody
              pending={pending}
              draft={draft}
              setDraft={setDraft}
              busy={busy}
              failure={failure}
            />
          )
        }
      />

      <AddAdminDialog
        open={adding}
        busy={busy}
        failure={failure}
        onCancel={() => {
          if (busy) return;
          setAdding(false);
          setFailure('');
        }}
        onSave={async (values) => {
          setBusy(true);
          setFailure('');
          try {
            await createAdmin(values);
            setAdding(false);
            setNote({
              tone: 'notice-ok',
              text: `${values.name} has been added as ${roleLabel(values.role)}. Give him the password you chose and ask him to change it from the login screen.`,
            });
            state.retry();
          } catch (e) {
            setFailure(adminWriteError(e));
          } finally {
            setBusy(false);
          }
        }}
      />
    </>
  );
}

/**
 * The buttons on a row, each behind the permission that governs the write it performs.
 *
 * Nothing is rendered disabled. A greyed-out "Change role" tells a COORDINATOR that the panel
 * can change roles and that he is not trusted with it, which is a sentence about him rather
 * than about the product; the sidebar makes the same choice for whole sections.
 *
 * Your own row is the exception, and there the buttons are absent *with* a reason on screen:
 * the guard refuses a self role or status change whoever you are, so a button that could only
 * ever produce a refusal is replaced by the refusal itself, up front.
 */
function RowActions({ admin, self, can, onOpen }) {
  const canRole = can('roles.assign');
  const canStatus = can('admins.disable');
  const canUpdate = can('admins.update');

  // The state the button moves him to: anything that is not ACTIVE goes back to ACTIVE, and
  // an ACTIVE account is suspended. DISABLED is reachable only through the database, which is
  // deliberate - see STATUS_ACTIONS.
  const nextStatus = admin.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
  const action = STATUS_ACTIONS[nextStatus];

  // A role holding none of the three never gets here: the column itself is not built. See the
  // note where `columns` is assembled.
  return (
    <span style={{ display: 'inline-flex', gap: 'var(--sp-1)', flexWrap: 'wrap' }}>
      {canRole && !self && (
        <button className="btn btn-quiet btn-sm" type="button" onClick={() => onOpen('role', admin, admin.role)}>
          Change role
        </button>
      )}
      {canStatus && !self && (
        <button
          className="btn btn-quiet btn-sm"
          type="button"
          onClick={() => onOpen('status', admin)}
        >
          {action.label}
        </button>
      )}
      {canUpdate && (
        <button
          className="btn btn-quiet btn-sm"
          type="button"
          onClick={() => onOpen('name', admin, admin.displayName)}
        >
          Display name
        </button>
      )}
      {canUpdate && (
        <button className="btn btn-quiet btn-sm" type="button" onClick={() => onOpen('reset', admin)}>
          Send reset link
        </button>
      )}
      {self && (canRole || canStatus) && (
        <span className="hint">Your own role and status can only be changed by another administrator.</span>
      )}
    </span>
  );
}

/* The wording of each dialog, in one place rather than four ternaries inside the JSX. The
   direction a status change is moving in is derived from the row by nextOf() everywhere it is
   needed - the title, the verb, the sentence and the write all ask the same function, so the
   dialog cannot describe a suspension and then perform an enable. */
const dialogTitle = (p) =>
  p.kind === 'role' ? `Change the role of ${p.admin.name}`
  : p.kind === 'status' ? STATUS_ACTIONS[nextOf(p)].title
  : p.kind === 'name' ? `Display name for ${p.admin.name}`
  : `Send a password reset link to ${p.admin.name}?`;

const dialogConfirm = (p) =>
  p.kind === 'role' ? 'Change the role'
  : p.kind === 'status' ? STATUS_ACTIONS[nextOf(p)].confirm
  : p.kind === 'name' ? 'Save the display name'
  : 'Yes, send the link';

const nextOf = (p) => (p.admin.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE');

function DialogBody({ pending, draft, setDraft, busy, failure }) {
  const { kind, admin } = pending;
  return (
    <>
      {kind === 'role' && (
        <>
          <p>
            {admin.name} holds {roleLabel(admin.role)} today. A role decides which sections of
            the panel he can open and what he may change in them - every one of those checks
            happens in the database, so the new role takes effect on his next request.
          </p>
          <div className="field" style={{ marginTop: 'var(--sp-4)', marginBottom: 0 }}>
            <label htmlFor="adm-newrole">New role</label>
            <select
              id="adm-newrole"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={busy}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>{roleLabel(r)}</option>
              ))}
            </select>
            {/* Named where it is chosen rather than discovered when the server refuses it. */}
            <span className="hint">
              {draft === 'SUPER_ADMIN'
                ? 'Super Admin can do everything in the panel, including appointing and suspending administrators. Only a Super Admin may grant it.'
                : 'Only a Super Admin may change the role of another Super Admin.'}
            </span>
          </div>
        </>
      )}

      {kind === 'status' && <p>{STATUS_ACTIONS[nextOf(pending)].body}</p>}

      {kind === 'name' && (
        <>
          <p>
            An optional label shown beside the name - "સંચાલક (વરાછા)", for instance. Leave it
            empty to show nothing but the name. It changes no permission.
          </p>
          <div className="field" style={{ marginTop: 'var(--sp-4)', marginBottom: 0 }}>
            <label htmlFor="adm-display">Display name</label>
            <input
              id="adm-display"
              type="text"
              value={draft}
              maxLength={80}
              onChange={(e) => setDraft(e.target.value)}
              disabled={busy}
            />
          </div>
        </>
      )}

      {kind === 'reset' && (
        <p>
          A link goes to {admin.email}. He chooses the new password himself on the page it
          opens - nobody here sees it, and his current password keeps working until he does.
          The link expires, so send it when he is ready to use it.
        </p>
      )}

      {failure && (
        <div className="notice notice-danger" role="alert" style={{ marginTop: 'var(--sp-4)', marginBottom: 0 }}>
          {failure}
        </div>
      )}
    </>
  );
}

/**
 * ────────────────────────────────────────────────────────────────────────────
 * Appointing an administrator
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Built on <dialog> like ConfirmDialog and CustomItemDialog, for the same reason (§56): the
 * browser provides the modal semantics - focus trapped, Escape closes, the page behind it
 * inert - and hand-rolling that is where keyboard accessibility usually goes wrong.
 *
 * This is the only form in the panel with a password field, and it is here because there is no
 * account yet: `admins.id` references `auth.users`, so somebody has to be created before
 * anybody can hold a role. It is a starting password handed over once, not a credential this
 * panel stores or can read back - Supabase Auth hashes it and exposes neither it nor its hash
 * to any client (§67). Every other password journey in both apps is a recovery email.
 *
 * The mobile field is optional and says so. Before 0038 it could not be: an administrator was
 * a `profiles` row, and that table's NOT NULL, UNIQUE, immutable `mobile` is why the founding
 * admin account permanently owns the invented number 9999999999.
 */
function AddAdminDialog({ open, busy, failure, onCancel, onSave }) {
  const ref = useRef(null);

  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  // Least privilege: the form opens on the role that can do the least, so appointing somebody
  // is a deliberate choice of what he may do rather than an accepted default (§10).
  //
  // `setRoleChoice` and not `setRole`, which is the name this module imports from adminService:
  // shadowing it here works today only because this dialog happens never to call the service.
  // The first person to add a write to this component would have called a useState setter with
  // (id, role) and watched nothing happen.
  const [role, setRoleChoice] = useState('VIEWER');
  const [touched, setTouched] = useState(false);

  /* Cleared on every open, not on close: a form that keeps a colleague's half-typed password
     in memory after it was dismissed is a form that will one day show it to the next person
     who opens the dialog. Keyed on `open` going true for the same reason CustomItemDialog is. */
  useEffect(() => {
    if (!open) return;
    setEmail('');
    setName('');
    setMobile('');
    setPassword('');
    setReveal(false);
    setRoleChoice('VIEWER');
    setTouched(false);
  }, [open]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  /* Every reason this cannot be saved, in the order a person reads the form. The server checks
     all of it again - `bad-request`, `weak-password` and `email-taken` are three of the five
     codes the endpoint may answer with - so this is about answering before the round trip, not
     about being the rule. */
  const problems = [];
  if (!looksLikeEmail(email)) problems.push('Enter the email address he will sign in with.');
  if (!name.trim()) problems.push('Enter his name - it is what the panel and the audit trail will show.');
  if (mobile.trim() && !looksLikeMobile(mobile)) {
    problems.push('A mobile number is ten digits starting with 6, 7, 8 or 9 - or leave it empty.');
  }
  if (password.length < PASSWORD_MIN) {
    problems.push(`The starting password needs at least ${PASSWORD_MIN} characters.`);
  } else if (password.length > PASSWORD_MAX) {
    problems.push(`The starting password can be at most ${PASSWORD_MAX} characters.`);
  }
  if (!ROLES.includes(role)) problems.push('Choose the role he is being given.');

  const ok = problems.length === 0;

  function submit(e) {
    e.preventDefault();
    setTouched(true);
    if (!ok || busy) return;
    onSave({ email: email.trim().toLowerCase(), password, name: name.trim(), mobile: mobile.trim(), role });
  }

  return (
    <dialog
      className="confirm"
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onCancel();
      }}
      aria-labelledby="adm-add-title"
    >
      {/* A real <form>, so Enter submits from any field. `noValidate` because every message
          here is a full sentence in this panel's voice and the browser's bubble would sit on
          top of one of them. */}
      <form onSubmit={submit} noValidate>
        <h2 id="adm-add-title">Add an administrator</h2>

        <p className="hint" style={{ marginBottom: 'var(--sp-4)' }}>
          This creates a login. He does not need a yuvak account and will not appear in the
          Yuvak list.
        </p>

        <div className="field">
          <label htmlFor="adm-add-email">Email</label>
          <input
            id="adm-add-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
            aria-describedby="adm-add-email-hint"
          />
          <span className="hint" id="adm-add-email-hint">
            He signs in with this. It is also the only way to recover the account, so it has to
            be an address he reads.
          </span>
        </div>

        <div className="field">
          <label htmlFor="adm-add-name">Name</label>
          <input
            id="adm-add-name"
            type="text"
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
          />
        </div>

        <div className="field">
          <label htmlFor="adm-add-mobile">Mobile (optional)</label>
          <input
            id="adm-add-mobile"
            type="tel"
            inputMode="numeric"
            value={mobile}
            maxLength={10}
            onChange={(e) => setMobile(e.target.value.replace(/\D/g, ''))}
            disabled={busy}
            aria-describedby="adm-add-mobile-hint"
          />
          <span className="hint" id="adm-add-mobile-hint">
            Contact only. Administrators sign in by email, so a number here is not a login.
          </span>
        </div>

        <div className="field">
          <label htmlFor="adm-add-role">Role</label>
          <select
            id="adm-add-role"
            value={role}
            onChange={(e) => setRoleChoice(e.target.value)}
            disabled={busy}
            aria-describedby="adm-add-role-hint"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>{roleLabel(r)}</option>
            ))}
          </select>
          <span className="hint" id="adm-add-role-hint">
            Start with the least he needs - it can be changed from this list at any time. Only a
            Super Admin may grant Super Admin.
          </span>
        </div>

        <div className="field">
          <label htmlFor="adm-add-password">Starting password</label>
          <input
            id="adm-add-password"
            type={reveal ? 'text' : 'password'}
            value={password}
            maxLength={PASSWORD_MAX}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            autoComplete="new-password"
            aria-describedby="adm-add-password-hint"
          />
          <label className="check" htmlFor="adm-add-reveal">
            <input
              id="adm-add-reveal"
              type="checkbox"
              checked={reveal}
              onChange={(e) => setReveal(e.target.checked)}
              disabled={busy}
            />
            Show the password
          </label>
          <span className="hint" id="adm-add-password-hint">
            At least {PASSWORD_MIN} characters. Hand it to him once - nobody, including you, can
            read it back afterwards, and he can change it from the login screen.
          </span>
        </div>

        {/* The server's refusal, above the button rather than in a toast that has gone by the
            time he looks: "email-taken" in particular is answered by changing a field on this
            very form. */}
        {failure && (
          <div className="notice notice-danger" role="alert">{failure}</div>
        )}

        {touched && !ok && (
          <div className="notice notice-danger" role="alert">{problems[0]}</div>
        )}

        <div className="confirm-actions">
          <button className="btn btn-quiet" type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className={`btn${busy ? ' is-busy' : ''}`} type="submit" disabled={busy || !ok}>
            {busy ? 'Working…' : 'Add administrator'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
