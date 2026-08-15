import { useEffect, useMemo, useRef, useState } from 'react';
import { useAsync } from '../../../lib/useAsync';
import { useAdminAuth } from '../../../lib/adminAuth';
import { AsyncBlock, TableSkeleton } from '../../../components/StateBlocks';
import { StatusBadge } from '../../../components/StatCard';
import { dateGu } from '../../../lib/format';
import { roleLabel } from '../../../../../shared/domain/permissions.js';
import { PAGES, pageAccess } from '../../../../../shared/domain/access-map.js';
import {
  adminWriteError,
  effectivePermissions,
  listAdmins,
  listGrants,
  listPermissions,
  listRoles,
  removeGrant,
  roleLabels,
  setGrant,
} from '../../users/services/adminService';

/**
 * ────────────────────────────────────────────────────────────────────────────
 * Effective access — what one person may actually do, and why
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The screen that makes the whole model debuggable. Roles say what a role may do; grants say
 * what one person has on top of or instead of it; the bootstrap allowlist overrides both and
 * is invisible in every table. Given those three, "why can he not open Point Ledger" has no
 * answer anybody can work out by looking — and the question gets asked the moment a second
 * person is given access.
 *
 * So every permission is listed with its *source*, and the sidebar is rendered as he would
 * see it. That second part is the one people actually read: a list of forty-six permission
 * keys is a correct answer to a question nobody asked, and "here are the sections he can
 * open" is the question.
 *
 * ── The answer comes from the database, not from this file ──────────────────
 *
 * `admin_effective_permissions()` (0044) performs the same resolution `has_permission()` does,
 * because it calls the same function — `permissions_of()`, which `caller_permissions()` also
 * calls. Assembling the union here from `role_permissions` and `admin_grants` would have been
 * a second implementation of the rule, and a screen whose whole purpose is explaining the gate
 * must not be able to describe a different one.
 *
 * ── Denials are shown, not omitted ──────────────────────────────────────────
 *
 * A DENY row is a permission he does *not* hold, so a list of what he holds would leave it
 * out — and then this screen cannot answer the one case where it is most needed: why one
 * COORDINATOR is missing something every other COORDINATOR has. It is listed, struck through,
 * with its reason.
 */

const SOURCE = {
  bootstrap: {
    tone: 'warn',
    label: 'founding account',
    note: 'Holds every permission through the bootstrap allowlist (0024), which no panel action can revoke. His role, if he has one, is not what is granting this.',
  },
  role: { tone: 'off', label: 'from role' },
  granted: { tone: 'ok', label: 'granted individually' },
  denied: { tone: 'danger', label: 'denied individually' },
};

export default function EffectiveAccessTab() {
  const { can, user, rank: myRank } = useAdminAuth();

  const list = useAsync(() => Promise.all([listAdmins({}), listRoles(), listPermissions()]), []);
  const [admins, roles, catalogue] = list.data ? [list.data[0].rows, list.data[1], list.data[2]] : [[], [], []];

  const [pickedId, setPickedId] = useState('');
  const picked = admins.find((a) => a.id === pickedId) || null;

  // Re-read when the selection changes *or* after a grant is written, which is what `stamp`
  // is for: the resolution lives on the server, so the only honest way to show the result of
  // an edit is to ask again rather than to patch a local copy of it.
  const [stamp, setStamp] = useState(0);
  const detail = useAsync(
    () => (pickedId ? Promise.all([effectivePermissions(pickedId), listGrants(pickedId)]) : Promise.resolve(null)),
    [pickedId, stamp]
  );
  const [effective, grants] = detail.data || [[], []];

  const [editing, setEditing] = useState(false);
  const [failure, setFailure] = useState('');
  const [note, setNote] = useState(null);

  const labels = roleLabels(roles);
  const rankOf = useMemo(() => Object.fromEntries(roles.map((r) => [r.key, r.rank])), [roles]);

  const holds = useMemo(
    () => new Set(effective.filter((e) => e.source !== 'denied').map((e) => e.permission)),
    [effective]
  );

  const isBootstrap = effective.some((e) => e.source === 'bootstrap');

  /*
    May the signed-in person edit this one's exceptions?

    The same three rules admin_grants_guard() applies, checked here only so the controls are
    absent rather than refused on press. Editing your own access is refused for everybody,
    whoever they are - it is what stops an administrator who can write his own grants from
    holding every permission that exists.
  */
  const canEdit =
    can('grants.manage') &&
    picked &&
    // Derived from the signed-in identity rather than read off the row: `admins` carries no
    // "is you" column, and inventing one on the client would be a fact about the session
    // stored on a record of somebody else.
    picked.id !== user?.id &&
    (rankOf[picked.role] ?? 0) < myRank;

  const bySource = (s) => effective.filter((e) => e.source === s);

  return (
    <>
      {note && <div className={`notice ${note.tone}`} role="status">{note.text}</div>}

      <div className="field" style={{ maxWidth: '28rem' }}>
        <label htmlFor="eff-who">Administrator</label>
        <select id="eff-who" value={pickedId} onChange={(e) => { setPickedId(e.target.value); setNote(null); }}>
          <option value="">Choose a person…</option>
          {admins.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} - {roleLabel(a.role, labels)}
              {a.status !== 'ACTIVE' ? ` (${a.status.toLowerCase()})` : ''}
            </option>
          ))}
        </select>
      </div>

      <AsyncBlock state={list} skeleton={<TableSkeleton rows={4} cols={2} />} empty="No administrators.">
        {!picked ? (
          <p className="hint">Pick somebody to see exactly what he may do.</p>
        ) : (
          <AsyncBlock state={detail} skeleton={<TableSkeleton rows={8} cols={2} />}>
            {picked.status !== 'ACTIVE' && (
              <div className="notice notice-warn" role="status">
                This account is {picked.status.toLowerCase()}. `effective_role()` returns nothing
                for any status but ACTIVE, so he holds none of the permissions below until he is
                enabled again - they are what he would get back.
              </div>
            )}

            {isBootstrap && (
              <div className="notice notice-warn" role="status">{SOURCE.bootstrap.note}</div>
            )}

            {/*
              The sidebar as he sees it, first.

              This is what somebody actually came to find out. The permission list below is the
              precise answer and this is the useful one, and putting the useful one second is
              how a screen ends up being described as hard to read.
            */}
            <section className="eff-block">
              <h3>What he can do, page by page</h3>
              <p className="hint" style={{ marginBottom: 'var(--sp-3)' }}>
                A page he cannot view is hidden from his sidebar and refused if he types the
                URL. Everything else is an action on a page he can open.
              </p>

              <table className="eff-pages">
                <thead>
                  <tr>
                    <th scope="col">Page</th>
                    <th scope="col">View</th>
                    <th scope="col">Can change</th>
                  </tr>
                </thead>
                <tbody>
                  {PAGES.map((page) => {
                    const a = pageAccess([...holds], page);
                    return (
                      <tr key={page.id} className={a.canView ? '' : 'is-closed'}>
                        <th scope="row">
                          <span className="eff-page-name">{page.label}</span>
                          <span className="eff-page-what">{page.what}</span>
                        </th>
                        <td>
                          {a.canView
                            ? <StatusBadge tone="ok">yes</StatusBadge>
                            : <StatusBadge tone="off">no</StatusBadge>}
                        </td>
                        <td>
                          {!a.canView ? (
                            <span className="hint">-</span>
                          ) : a.total === 0 ? (
                            <span className="hint">Nothing to change here.</span>
                          ) : a.granted === 0 ? (
                            <span className="hint">View only.</span>
                          ) : (
                            <span className="eff-actions">
                              {a.actions.filter((x) => x.granted).map((x) => (
                                <StatusBadge key={x.key} tone={x.kind === 'danger' ? 'warn' : 'info'}>
                                  {x.label}
                                </StatusBadge>
                              ))}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>

            <section className="eff-block">
              <div className="eff-block-head">
                <h3>Permissions</h3>
                {canEdit && (
                  <button className="btn btn-quiet" type="button" onClick={() => { setFailure(''); setEditing(true); }}>
                    Add an exception
                  </button>
                )}
              </div>

              {failure && <div className="notice notice-danger" role="alert">{failure}</div>}

              {['granted', 'denied', 'bootstrap', 'role'].map((s) => {
                const items = bySource(s);
                if (!items.length) return null;
                return (
                  <div key={s} className="eff-group">
                    <h4>
                      <StatusBadge tone={SOURCE[s].tone}>{SOURCE[s].label}</StatusBadge>
                      <span className="hint">{items.length}</span>
                    </h4>
                    <ul className={`eff-list${s === 'denied' ? ' is-denied' : ''}`}>
                      {items.map((e) => {
                        const g = grants.find((x) => x.permission === e.permission);
                        return (
                          <li key={`${s}-${e.permission}`}>
                            <span className="mono">{e.permission}</span>
                            {e.expiresAt && (
                              <span className="hint"> expires {dateGu(e.expiresAt)}</span>
                            )}
                            {g?.reason && <span className="eff-reason">{g.reason}</span>}
                            {canEdit && g && (
                              <button
                                className="linklike"
                                type="button"
                                onClick={async () => {
                                  setFailure('');
                                  try {
                                    await removeGrant(picked.id, e.permission);
                                    setNote({
                                      tone: 'notice-ok',
                                      text: `The exception on ${e.permission} has been removed. He is back to what his role gives him.`,
                                    });
                                    setStamp((n) => n + 1);
                                  } catch (err) {
                                    setFailure(adminWriteError(err));
                                  }
                                }}
                              >
                                remove
                              </button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </section>
          </AsyncBlock>
        )}
      </AsyncBlock>

      <GrantDialog
        open={editing}
        admin={picked}
        catalogue={catalogue}
        holds={holds}
        canGrant={(key) => can(key)}
        failure={failure}
        onCancel={() => { setEditing(false); setFailure(''); }}
        onSave={async (values) => {
          setFailure('');
          try {
            await setGrant({ adminId: picked.id, ...values });
            setEditing(false);
            setNote({
              tone: 'notice-ok',
              text:
                values.effect === 'ALLOW'
                  ? `${picked.name} now holds ${values.permission}, on top of his role.`
                  : `${picked.name} no longer holds ${values.permission}, even though his role carries it.`,
            });
            setStamp((n) => n + 1);
          } catch (e) {
            setFailure(adminWriteError(e));
          }
        }}
      />
    </>
  );
}

/**
 * One exception.
 *
 * `reason` is required by this form and defaults to '' in the column. That asymmetry is
 * deliberate: the database must accept a row written by a migration or a script, and the
 * person adding one by hand is the one who will not be here in a year when somebody asks why
 * a coordinator can award points.
 *
 * The expiry presets exist because a permanent exception is the default outcome of every
 * access system that offers only "forever" — somebody needs લેવલ ૪ editing for one week of
 * ઉત્સવ and holds it for three years, because revoking it is nobody's job.
 */
function GrantDialog({ open, admin, catalogue, holds, canGrant, failure, onCancel, onSave }) {
  const ref = useRef(null);
  const [permission, setPermission] = useState('');
  const [effect, setEffect] = useState('ALLOW');
  const [reason, setReason] = useState('');
  const [expiry, setExpiry] = useState('');
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPermission('');
    setEffect('ALLOW');
    setReason('');
    setExpiry('');
    setTouched(false);
  }, [open]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  if (!admin) return null;

  const problems = [];
  if (!permission) problems.push('Choose the permission this is about.');
  // Only in the granting direction: taking a permission away is not an escalation, which is
  // why admin_grants_guard() checks the holding rule for ALLOW alone.
  else if (effect === 'ALLOW' && !canGrant(permission)) {
    problems.push('You do not hold that permission yourself, so you cannot grant it.');
  }
  if (!reason.trim()) problems.push('Say why. An exception with no recorded reason is one nobody can judge later.');
  const ok = problems.length === 0;

  const expiresAt = useMemo(() => {
    if (!expiry) return null;
    const days = Number(expiry);
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString();
  }, [expiry]);

  return (
    <dialog ref={ref} className="dialog" onCancel={(e) => { e.preventDefault(); onCancel(); }}>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (!ok) return;
          onSave({ permission, effect, reason: reason.trim(), expiresAt });
        }}
      >
        <h2>An exception for {admin.name}</h2>
        <p className="hint" style={{ marginBottom: 'var(--sp-4)' }}>
          This applies to him alone and leaves his role untouched. A denial beats a grant, and a
          grant beats the role.
        </p>

        <div className="field">
          <label htmlFor="grant-perm">Permission</label>
          <select id="grant-perm" value={permission} onChange={(e) => setPermission(e.target.value)} autoFocus>
            <option value="">Choose…</option>
            {catalogue.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label} - {p.key}
                {holds.has(p.key) ? ' (has it)' : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="grant-effect">Give or take away</label>
          <select id="grant-effect" value={effect} onChange={(e) => setEffect(e.target.value)}>
            <option value="ALLOW">Give it to him, on top of his role</option>
            <option value="DENY">Take it away, even though his role has it</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="grant-reason">Why</label>
          <input
            id="grant-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Runs the utsav reports until the end of the month"
          />
        </div>

        <div className="field">
          <label htmlFor="grant-expiry">Until</label>
          <select id="grant-expiry" value={expiry} onChange={(e) => setExpiry(e.target.value)}>
            <option value="">No end date</option>
            <option value="7">One week</option>
            <option value="30">One month</option>
            <option value="90">Three months</option>
          </select>
          <span className="hint">
            An exception with an end date is the only kind that gets cleaned up. It stops
            applying on its own - the row stays, so the trail keeps what he held and when.
          </span>
        </div>

        {failure && <div className="notice notice-danger" role="alert">{failure}</div>}
        {touched && !ok && <div className="notice notice-danger" role="alert">{problems[0]}</div>}

        <div className="confirm-actions">
          <button className="btn btn-quiet" type="button" onClick={onCancel}>Cancel</button>
          <button className="btn" type="submit" disabled={!ok}>Save the exception</button>
        </div>
      </form>
    </dialog>
  );
}
