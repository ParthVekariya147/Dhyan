import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAsync } from '../../../lib/useAsync';
import { useAdminAuth } from '../../../lib/adminAuth';
import DataTable from '../../../components/DataTable';
import { AsyncBlock, TableSkeleton } from '../../../components/StateBlocks';
import ConfirmDialog from '../../../components/ConfirmDialog';
import { StatusBadge } from '../../../components/StatCard';
import { dateGu } from '../../../lib/format';
import { loginError } from '../../../lib/errors';
import { roleLabel } from '../../../../../shared/domain/permissions.js';
import {
  adminWriteError,
  createAdmin,
  existingAdminIds,
  listAdmins,
  listRoles,
  promoteUser,
  roleLabels,
  setRole,
  setStatus,
  updateDisplayName,
} from '../services/adminService';
import { searchUsers } from '../services/userService';
import { isUnrestricted } from '../../../../../shared/domain/scope.js';
import { listScopes, loadGeography } from '../../access/services/scopeService';

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

/**
 * The four states, and the fourth is not a degree of the other three.
 *
 * ACTIVE, SUSPENDED and DISABLED all describe an administrator: he is one, or he is one whose
 * access is paused, or he is a former one. REVOKED says the appointment itself was a mistake
 * and has been undone — and it is the only state that returns the person to `public.yuvaks`,
 * so he reappears in the Users list, the counts, the leaderboard and every report (0045).
 */
const ACCOUNT_STATUS = {
  ACTIVE: { label: 'Active', tone: 'ok' },
  SUSPENDED: { label: 'Suspended', tone: 'warn' },
  DISABLED: { label: 'Disabled', tone: 'off' },
  REVOKED: { label: 'Not an admin', tone: 'off' },
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
  /*
    Undoing the appointment, which is a different act from suspending him and is worded as one.

    An existing યુવક who is appointed disappears from `public.yuvaks` the instant the row is
    written - and therefore from the Users list, "Total registered", the leaderboard, the
    progress report and every export. Before 0045, suspending or disabling him did not bring
    him back, because the exclusion never looked at status. This is the state that does.
  */
  REVOKED: {
    label: 'Not an admin',
    title: 'Undo this appointment?',
    danger: true,
    confirm: 'Yes, he is not an administrator',
    body:
      'He stops being an administrator entirely and goes back to being an ordinary yuvak. If he has a learning record it is untouched - not one દર્શન, point or daily record is removed - and he reappears immediately in the Users list, the counts, the leaderboard and every report, which is where an appointment made by mistake had been hiding him. The row is kept, so the audit trail still shows who appointed him and who undid it.',
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
  // Its own flag rather than a value on `pending`: `pending` is always *about a row* in this
  // table, and this dialog is about a person who is not in it yet.
  const [promoting, setPromoting] = useState(false);
  const [busy, setBusy] = useState(false);
  // The refusal, shown inside the dialog that caused it so it sits beside the control that
  // will be pressed again. Cleared when a dialog opens, never on a timer.
  const [failure, setFailure] = useState('');
  const [note, setNote] = useState(null); // { tone, text } — the result, on the page

  const state = useAsync(() => listAdmins({ role, status, term: applied }), [role, status, applied]);

  /*
    The roles, from the database.

    Loaded separately from the administrators and never awaited before them: 0043 made roles
    editable, so this list can no longer be a constant in the bundle — but a page that showed
    nothing until a second request landed would be slower for everybody in exchange for a
    dropdown that is only used when somebody is being edited. An empty list degrades to an
    empty select and a key printed through roleLabel()'s humaniser, which is what the table
    would show anyway for a role deleted since the row was written.

    No dependency array entry: roles change when somebody edits them on the Access screen, and
    that is a navigation away and back.
  */
  const roleState = useAsync(() => listRoles(), []);
  const roles = roleState.data || [];

  /*
    Who is limited to which zones (0051), and the zone names to print them with.

    Loaded beside the roles and never awaited before the list, for the same reason: a page that
    showed nothing until two more requests landed would be slower for everybody in exchange for
    one column. Both degrade to "Every zone", which is what an administrator with no rows
    genuinely is — so a failed read shows the common case rather than a blank or a wrong one.

    RLS decides how much of `admin_scopes` comes back: `admin_id = auth.uid() or
    has_permission('admins.read')`. This tab is already gated on `admins.read`, so anybody
    reading it sees every row rather than only his own.
  */
  const scopeState = useAsync(() => listScopes(), []);
  const geoState = useAsync(() => loadGeography(), []);
  const scopes = scopeState.data || {};
  const zoneName = (id) =>
    (geoState.data?.zones || []).find((z) => z.id === id)?.name || id;
  const labels = roleLabels(roles);
  /** A role key as a person reads it. Falls back to humanising the key - see roleLabel(). */
  const label = (key) => roleLabel(key, labels);

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
      /*
        The column that stays put when the table is swiped on a phone.

        Here it happens to be the first column as well, so `pin: true` changes nothing today
        — it is written anyway because DataTable's default is "the first column", and that
        default is an accident of order rather than a decision about meaning. The moment
        somebody puts an avatar, a row number or a select-all checkbox in front of Name, the
        pin would silently move to it and the administrator list would scroll with nothing
        on screen saying which administrator each row is about. Naming the column makes that
        a deliberate change rather than a side effect.

        Name and not Email, even though email is what an administrator signs in with: the
        row also carries "You" and the display name in this cell, so it is the cell that
        says whose row this is, and an email address is the widest thing on the table.
      */
      pin: true,
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
      render: (a) => <StatusBadge tone="info">{label(a.role)}</StatusBadge>,
    },
    {
      key: 'status',
      label: 'Status',
      render: (a) => {
        const s = ACCOUNT_STATUS[a.status] || { label: a.status || '-', tone: 'off' };
        return <StatusBadge tone={s.tone}>{s.label}</StatusBadge>;
      },
    },
    {
      key: 'zones',
      label: 'Sees',
      /*
        Which યુવકો this administrator can see (0051), beside the role that says what he may do
        to them. The two are the same question asked twice and were only ever half answerable
        here.

        "Every zone" in words rather than an empty cell. An empty cell in this column would read
        as "no zones", and it means the exact opposite — no rows in `admin_scopes` is
        unrestricted. That inversion is the one thing about zone scope that is not guessable,
        and it is not left to be guessed on the screen where administrators are listed.
      */
      render: (a) => {
        const s = scopes[a.id];
        if (isUnrestricted(s)) return <span className="hint">Every zone</span>;
        return (
          <span style={{ display: 'inline-flex', gap: 'var(--sp-1)', flexWrap: 'wrap' }}>
            {s.map((z) => (
              <StatusBadge key={z} tone="warn">{zoneName(z)}</StatusBadge>
            ))}
          </span>
        );
      },
    },
    { key: 'createdAt', label: 'Added', render: (a) => dateGu(a.createdAt) },
  ];

  /*
    The Actions column exists only for a role that has an action. An ADMIN holds `admins.read`
    and none of the three write permissions — 0004's matrix reserves administering
    administrators for SUPER_ADMIN alone — so for him this would be a whole column of dashes
    headed "Actions", which is a column that exists to say he cannot do anything. Below 900px
    it would be worse: the table scrolls sideways there, so an empty last column is a column
    an ADMIN would swipe the whole width of the row to reach and find nothing in.
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
            {roles.map((r) => (
              <option key={r.key} value={r.key}>{r.label}</option>
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
          <>
            {/*
              Two ways in, because there are two genuinely different situations and the panel
              used to answer only one of them.

              "Promote" is first, and is the one most often wanted: the person is already a
              યુવક, already has a login, and needs a role on the account he has. The other
              creates a login for somebody who has none.

              Offering only the second is what sent people to create a second account on a
              different address for somebody who already had one - splitting one person into
              two identities, leaving his learning record on the login he stops using, and
              adding a row that every યુવક count then includes.
            */}
            <button
              className="btn"
              type="button"
              onClick={() => { setFailure(''); setNote(null); setPromoting(true); }}
            >
              Give an existing user access
            </button>
            <button
              className="btn btn-quiet"
              type="button"
              onClick={() => { setFailure(''); setNote(null); setAdding(true); }}
            >
              Add administrator
            </button>
          </>
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

          {/* Read here, changed there. The "Sees" column answers "why can he not open this
              yuvak", which is the question that gets asked on this screen; setting it is a
              decision about a population and belongs beside the yuvak counts per zone. */}
          <p className="card-note">
            "Sees" is which yuvaks he can open - <strong>Every zone</strong> means no limit has
            been set, which is what an administrator has until somebody sets one. Change it
            under <Link to="/access?tab=zones">Access &rarr; Zone access</Link>. A Super Admin
            always sees every zone and cannot be limited.
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
        danger={pending?.kind === 'revoke' || (pending?.kind === 'status' && nextOf(pending) === 'SUSPENDED')}
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
            run(() => setRole(admin.id, draft), `${admin.name} is now ${label(draft)}.`);
          } else if (kind === 'status') {
            run(
              () => setStatus(admin.id, next),
              next === 'ACTIVE' ? `${admin.name} can use the panel again.` : `${admin.name} has been suspended.`
            );
          } else if (kind === 'revoke') {
            run(
              () => setStatus(admin.id, 'REVOKED'),
              // Says what actually happened to the numbers, because that is the half nobody
              // would otherwise know had changed.
              `${admin.name} is no longer an administrator. If he has a yuvak account he is back in the Users list and in every count and report, with his learning record exactly as it was.`
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
              roles={roles}
              label={label}
            />
          )
        }
      />

      <PromoteUserDialog
        roles={roles}
        open={promoting}
        busy={busy}
        failure={failure}
        onCancel={() => { setPromoting(false); setFailure(''); }}
        onSave={async ({ user: picked, role: chosen }) => {
          setBusy(true);
          setFailure('');
          try {
            await promoteUser({
              id: picked.id,
              email: picked.email,
              name: picked.name,
              mobile: picked.mobile,
              role: chosen,
            });
            setPromoting(false);
            setNote({
              tone: 'notice-ok',
              text: `${picked.name} is now ${label(chosen)}. He signs in at this panel with the same email and password he already uses - nothing has been sent to him, and his yuvak account is unchanged.`,
            });
            state.retry();
          } catch (e) {
            setFailure(adminWriteError(e));
          } finally {
            setBusy(false);
          }
        }}
      />

      <AddAdminDialog
        roles={roles}
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
              text: `${values.name} has been added as ${label(values.role)}. Give him the password you chose and ask him to change it from the login screen.`,
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

  /*
    Revoke is a second, separate button rather than a third state on the first one.

    Suspend/Enable is a toggle because the two are opposite ends of one question - "may he use
    the panel today". Undoing the appointment is a different question with a different answer,
    and folding it into the same control would make a person cycle through "he is paused" to
    reach "he was never meant to be one".

    Offered only for somebody who is not already revoked, and restoring one is deliberately NOT
    offered here: the guard asks for `admins.create` to come back out of REVOKED, because that
    is an appointment being made rather than access being switched back on. Use "Give an
    existing user access", which is the screen that appoints people and says so.
  */
  const canRevoke = canStatus && !self && admin.status !== 'REVOKED';

  // A role holding none of the three never gets here: the column itself is not built. See the
  // note where `columns` is assembled.
  return (
    <span style={{ display: 'inline-flex', gap: 'var(--sp-1)', flexWrap: 'wrap' }}>
      {canRole && !self && (
        <button className="btn btn-quiet btn-sm" type="button" onClick={() => onOpen('role', admin, admin.role)}>
          Change role
        </button>
      )}
      {canStatus && !self && admin.status !== 'REVOKED' && (
        <button
          className="btn btn-quiet btn-sm"
          type="button"
          onClick={() => onOpen('status', admin)}
        >
          {action.label}
        </button>
      )}
      {canRevoke && (
        <button
          className="btn btn-quiet btn-sm is-danger"
          type="button"
          onClick={() => onOpen('revoke', admin)}
        >
          Not an admin
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
  : p.kind === 'revoke' ? STATUS_ACTIONS.REVOKED.title
  : p.kind === 'status' ? STATUS_ACTIONS[nextOf(p)].title
  : p.kind === 'name' ? `Display name for ${p.admin.name}`
  : `Send a password reset link to ${p.admin.name}?`;

const dialogConfirm = (p) =>
  p.kind === 'role' ? 'Change the role'
  : p.kind === 'revoke' ? STATUS_ACTIONS.REVOKED.confirm
  : p.kind === 'status' ? STATUS_ACTIONS[nextOf(p)].confirm
  : p.kind === 'name' ? 'Save the display name'
  : 'Yes, send the link';

const nextOf = (p) => (p.admin.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE');

function DialogBody({ pending, draft, setDraft, busy, failure, roles, label }) {
  const { kind, admin } = pending;
  return (
    <>
      {kind === 'role' && (
        <>
          <p>
            {admin.name} holds {label(admin.role)} today. A role decides which sections of
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
              {roles.map((r) => (
                <option key={r.key} value={r.key}>{r.label}</option>
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

      {kind === 'revoke' && (
        <>
          <p>{STATUS_ACTIONS.REVOKED.body}</p>
          {/* Named separately from the paragraph above, because it is the one consequence
              somebody might not want and cannot discover by trying it: getting him back is a
              fresh appointment, not an undo of the undo. */}
          <p className="hint">
            To make him an administrator again later, appoint him from "Give an existing user
            access". Bringing somebody back out of this state is an appointment, so it asks for
            the permission that appointing asks for.
          </p>
        </>
      )}

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
/**
 * ────────────────────────────────────────────────────────────────────────────
 * Give an existing યુવક a role
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The dialog the panel was missing. `admins.id` references `auth.users`, and a registered
 * યુવક has had a row there since the day he signed up - `profiles.id` **is** that id - so
 * appointing him is one INSERT and needs no secret key, no server function, and no password.
 *
 * ── It creates nothing, and says so ─────────────────────────────────────────
 *
 * There is no password field here and there must never be one. The person already has a
 * login; he signs in to this panel with exactly the credentials he already uses for the યુવક
 * app. A "set his password" control would mean one administrator can take over another
 * person's account, which is the same rule that keeps a password field off every row in the
 * table behind this dialog (§67).
 *
 * ── Why the search is a dialog of its own rather than the Yuvaks tab ────────
 *
 * Picking a person out of two thousand is a different act from browsing them, and the thing
 * being chosen is an *identity* - so the row shows SMK, name, mobile and email together, and
 * the id that will actually be written is the id of the row that was clicked. Sending the
 * સંચાલક to the other tab to copy an address and paste it back would reintroduce the exact
 * failure this replaces: an address typed by hand that does not match any account, and a
 * second account created for a person who already has one.
 *
 * ── Somebody who already holds a role will not appear here at all ───────────
 *
 * searchUsers() reads `public.yuvaks`, which is `profiles_level4` **minus anyone holding a
 * public.admins row** (0038). So an existing administrator is not in these results, and the
 * empty state says so rather than reporting a flat "nobody matches" about a person who is
 * plainly listed in the table behind this dialog.
 *
 * The `existingAdminIds()` check is kept anyway, and it is defensive rather than redundant:
 * it costs one indexed lookup on at most twenty-five ids, and it is what stands between a
 * future change to that view and a duplicate-key `23505` on the press - a true statement
 * about a row that tells the person nothing about what to do next.
 */
function PromoteUserDialog({ roles, open, busy, failure, onCancel, onSave }) {
  const ref = useRef(null);

  const [term, setTerm] = useState('');
  const [results, setResults] = useState([]);
  const [held, setHeld] = useState(new Set());
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [picked, setPicked] = useState(null);
  // Least privilege, exactly as the add form opens: appointing somebody is a deliberate
  // choice of what he may do rather than an accepted default (§10).
  const [role, setRoleChoice] = useState('VIEWER');

  /* Cleared on every open, not on close - a dialog that keeps the last search on screen
     invites somebody to press the button beside a row he did not just look for. Keyed on
     `open` going true, like the add form beside it. */
  useEffect(() => {
    if (!open) return;
    setTerm('');
    setResults([]);
    setHeld(new Set());
    setSearching(false);
    setSearched(false);
    setSearchError('');
    setPicked(null);
    setRoleChoice('VIEWER');
  }, [open]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  async function find(e) {
    /*
      This is a button and not a nested <form>.

      A <form> inside a <form> is invalid HTML and the browser drops the inner one, so the
      search field's Enter would have submitted the *outer* form - appointing whoever
      happened to be selected. The two actions are kept apart deliberately: searching is
      cheap and repeated, appointing is done once and is hard to undo.
    */
    e?.preventDefault?.();
    const q = term.trim();
    if (!q) return;
    setSearching(true);
    setSearchError('');
    setPicked(null);
    try {
      const { rows } = await searchUsers(q, { pageSize: 25 });
      setResults(rows);
      // One extra round trip, and it buys the difference between "he is already an admin"
      // and a duplicate-key error after the press.
      setHeld(await existingAdminIds(rows.map((r) => r.id)));
      setSearched(true);
    } catch (err) {
      setSearchError(loginError(err));
      setResults([]);
      setSearched(true);
    } finally {
      setSearching(false);
    }
  }

  const ok = Boolean(picked) && roles.some((r) => r.key === role);

  function submit(e) {
    e.preventDefault();
    if (!ok || busy) return;
    onSave({ user: picked, role });
  }

  return (
    <dialog
      ref={ref}
      className="dialog"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onCancel();
      }}
      aria-labelledby="adm-promote-title"
    >
      <form onSubmit={submit} noValidate>
        <h2 id="adm-promote-title">Give an existing user admin access</h2>

        <p className="hint" style={{ marginBottom: 'var(--sp-4)' }}>
          For somebody who already uses the yuvak app. He keeps the same login and the same
          learning record - this only adds a role. No password is set or sent.
        </p>

        <div className="field">
          <label htmlFor="adm-promote-q">Find the user</label>
          <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
            <input
              id="adm-promote-q"
              type="text"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              disabled={busy}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoFocus
              // Enter searches rather than submitting the dialog. See find().
              onKeyDown={(e) => { if (e.key === 'Enter') find(e); }}
              aria-describedby="adm-promote-q-hint"
            />
            <button
              className="btn btn-quiet"
              type="button"
              onClick={find}
              disabled={busy || searching || !term.trim()}
            >
              {searching ? 'Searching…' : 'Search'}
            </button>
          </div>
          <span className="hint" id="adm-promote-q-hint">
            Any part of the name, the SMK, the mobile number or the email address.
          </span>
        </div>

        {searchError && <div className="notice notice-danger" role="alert">{searchError}</div>}

        {searched && !searchError && results.length === 0 && (
          <div className="notice notice-warn" role="status">
            No yuvak matches that. Try a shorter piece of the name or the number - and note
            that anyone who is already an administrator is not listed here; look for him in
            the table behind this dialog instead.
          </div>
        )}

        {results.length > 0 && (
          <div className="field">
            <label>Results</label>
            <ul className="pick-list">
              {results.map((u) => {
                const already = held.has(u.id);
                const chosen = picked?.id === u.id;
                return (
                  <li key={u.id}>
                    <button
                      type="button"
                      className={`pick${chosen ? ' is-picked' : ''}`}
                      disabled={busy || already}
                      onClick={() => setPicked(u)}
                      aria-pressed={chosen}
                    >
                      <span className="pick-main">
                        <strong>{u.name || '-'}</strong>
                        <span className="mono">{u.smk || '-'}</span>
                      </span>
                      <span className="pick-sub">
                        <span className="mono">{u.mobile || '-'}</span>
                        <span>{u.email || '-'}</span>
                      </span>
                      {/* Named on the row rather than left to fail on the press. */}
                      {already && <span className="pick-note">already an administrator</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {picked && (
          <div className="field">
            <label htmlFor="adm-promote-role">Role</label>
            <select
              id="adm-promote-role"
              value={role}
              onChange={(e) => setRoleChoice(e.target.value)}
              disabled={busy}
              aria-describedby="adm-promote-role-hint"
            >
              {roles.map((r) => (
                <option key={r.key} value={r.key}>{r.label}</option>
              ))}
            </select>
            <span className="hint" id="adm-promote-role-hint">
              Start with the least he needs - it can be changed from this list at any time.
              Only a Super Admin may grant Super Admin.
            </span>
          </div>
        )}

        {failure && <div className="notice notice-danger" role="alert">{failure}</div>}

        <div className="confirm-actions">
          <button className="btn btn-quiet" type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className={`btn${busy ? ' is-busy' : ''}`} type="submit" disabled={!ok || busy}>
            {busy ? 'Working…' : picked ? `Make ${picked.name} an administrator` : 'Choose a user'}
          </button>
        </div>
      </form>
    </dialog>
  );
}

function AddAdminDialog({ roles, open, busy, failure, onCancel, onSave }) {
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
  /*
    Checked against the roles that actually exist, which is a database read since 0043 rather
    than a constant. The empty case matters and is deliberately not waved through: if the roles
    failed to load, `roles` is [] and this refuses to submit rather than sending a role key the
    server would reject with a flat `bad-request` after the account had already been created.
  */
  if (!roles.some((r) => r.key === role)) problems.push('Choose the role he is being given.');

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
            {roles.map((r) => (
              <option key={r.key} value={r.key}>{r.label}</option>
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
