import { useEffect, useMemo, useRef, useState } from 'react';
import { useAsync } from '../../../lib/useAsync';
import { useAdminAuth } from '../../../lib/adminAuth';
import { AsyncBlock, TableSkeleton } from '../../../components/StateBlocks';
import { StatusBadge } from '../../../components/StatCard';
import { PAGES, sharesViewWith } from '../../../../../shared/domain/access-map.js';
import {
  adminWriteError,
  createRole,
  deleteRole,
  listRolePermissions,
  listRoles,
  roleUsage,
  setRolePermissions,
  updateRole,
} from '../../users/services/adminService';

/**
 * ────────────────────────────────────────────────────────────────────────────
 * Roles — the matrix, editable
 * ────────────────────────────────────────────────────────────────────────────
 *
 * 0004 put the role→permission matrix in a SQL function and argued that changing who may do
 * what should need a migration and a deploy. 0043 overruled it, deliberately, and split the
 * sentence: what became data is the *binding* — which role holds which permission — and what
 * stayed code is the *catalogue*, which permissions exist at all. This screen edits the first
 * half and cannot touch the second.
 *
 * That split is why there is no "add a permission" button anywhere on this page, and why its
 * absence is not an omission. A permission name means something only because some RLS policy
 * or SECURITY DEFINER function checks it; a panel that could invent `users.delete` would
 * render a tick box that grants nothing and appears to grant everything.
 *
 * ── Arranged by page, not by permission ────────────────────────────────────
 *
 * The catalogue is `resource.verb` because that is the string a policy has to name. Nobody
 * decides access in those terms: the question is always "should he be able to open the Point
 * Ledger, and should he only be able to look at it". A grid of forty-six keys grouped by
 * resource made the person translate the second question into the first in his head, for every
 * one of them — and a translation done in somebody's head is one that gets made wrong, quietly,
 * in the direction of granting too much.
 *
 * So the grid is one row per page of the panel: a View tick that decides whether the section
 * opens at all, and one tick per action that page offers. shared/domain/access-map.js is the
 * mapping, and scripts/test-permission-catalogue.mjs asserts it covers every permission in the
 * catalogue exactly once — so nothing here can grant what no policy enforces, and nothing a
 * policy enforces is unreachable from this screen.
 *
 * Actions are not collapsed into one "Edit" tick. Most of these pages offer several genuinely
 * different writes, and on દર્શન the difference between editing a વર્ણન and replacing an image
 * two thousand phones will see is the whole point of having separate permissions at all.
 *
 * ── Editing a role is a bulk action on people, and reads like one ───────────
 *
 * A checkbox here is not a setting. It changes what every administrator holding that role may
 * do, on their very next request — `has_permission()` reads these rows live, so there is no
 * session to expire and no cache to wait for. So the count of affected people is on screen
 * before the save, and the confirm names it. Anything destructive or irreversible carries its
 * warning at the moment it is granted rather than only when it is used.
 *
 * ── What this screen may not do, and does not pretend it can ────────────────
 *
 * SUPER_ADMIN's set is not editable by anyone, including a SUPER_ADMIN: it holds the whole
 * catalogue by definition, and `role_permissions_guard()` refuses every write to it. Without
 * that, the most available attack on the model is to remove `roles.manage` from SUPER_ADMIN
 * and edit at leisure — and the likelier accident is somebody unticking something on the one
 * role that must never be short of a permission, breaking the only account that can repair
 * the others. It is shown, read-only, with the reason.
 *
 * A role at or above your own rank is equally out of reach, and so is granting a permission
 * you do not hold yourself. Both are enforced by the guard; both are reflected here by
 * disabling the control rather than by letting the press produce a refusal.
 */

/** The four verbs that only ever remove something. Used to warn before a revocation. */
const isRevocation = (before, after) => before && !after;

export default function RolesTab() {
  const { can, role: myRole, rank: myRank } = useAdminAuth();

  /*
    The catalogue is no longer read here.

    The grid is built from shared/domain/access-map.js, which carries the label and the
    warning for every permission in the shape the decision is made in — one row per page. The
    table's own `label` and `description` are what the Permissions tab renders, where the
    subject is the catalogue itself rather than the panel.

    Dropping the read is not a saving worth making on its own; it is here because a screen
    that loads a list it does not use is a screen somebody will later "fix" by rendering it.
  */
  const state = useAsync(
    () => Promise.all([listRoles(), listRolePermissions(), roleUsage()]),
    []
  );

  const [roles, held, usage] = state.data || [[], {}, {}];

  const [selected, setSelected] = useState('');
  const [draft, setDraft] = useState(null); // Set<permission> | null
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [note, setNote] = useState(null);
  const [creating, setCreating] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // Open on the first role the moment the data lands, so the page is never a list with an
  // empty panel beside it. Keyed on the roles arriving rather than on mount.
  useEffect(() => {
    if (!selected && roles.length) setSelected(roles[0].key);
  }, [roles, selected]);

  const current = roles.find((r) => r.key === selected) || null;
  const baseline = useMemo(() => held[selected] || new Set(), [held, selected]);

  // The draft is discarded whenever the selected role changes: carrying half-made edits from
  // one role onto another is how somebody grants Coordinator what he meant to grant Admin.
  useEffect(() => {
    setDraft(null);
    setFailure('');
  }, [selected]);

  const ticked = draft || baseline;

  /*
    Whether this role may be edited at all, and the sentence saying why not.

    Every one of these is re-checked by role_permissions_guard(), which is the boundary. What
    they decide here is whether the control is offered — a checkbox that produces a refusal on
    every press is worse than no checkbox, because it reads as a bug rather than as a rule.
  */
  const lock = !current ? 'Select a role.'
    : current.key === 'SUPER_ADMIN'
      ? 'Super Admin always holds every permission. This is enforced by the database and cannot be changed here or anywhere else.'
    : !can('roles.manage')
      ? 'You do not have permission to edit roles.'
    // A bootstrap account resolves to rank 100 and may edit anything below it; everyone else
    // is held to the rank of the role they hold.
    : current.rank >= myRank
      ? `You hold ${myRole} (rank ${myRank}). A role at or above your own rank cannot be changed by you.`
    : '';

  const editable = !lock;

  const changed = draft
    ? [...new Set([...baseline, ...draft])].filter((p) => baseline.has(p) !== draft.has(p))
    : [];

  const affected = usage[selected]?.members ?? 0;

  async function save() {
    if (!current || !changed.length) return;
    setBusy(true);
    setFailure('');
    try {
      const { added, removed } = await setRolePermissions(current.key, [...ticked]);
      setDraft(null);
      setConfirming(false);
      setNote({
        tone: 'notice-ok',
        text:
          `${current.label}: ${added} added, ${removed} removed. ` +
          (affected
            ? `${affected} administrator${affected === 1 ? '' : 's'} holding this role ${affected === 1 ? 'is' : 'are'} affected from their next request.`
            : 'Nobody holds this role yet.'),
      });
      state.retry();
    } catch (e) {
      setFailure(adminWriteError(e));
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Ticking an action ticks View with it, and unticking View clears the row.
   *
   * An action without the permission that opens the page is access nobody can use: the
   * database would hold `users.update` beside no `users.read` quite happily, and the person
   * would find the section missing from his sidebar and the URL refused. Rather than let
   * somebody build that and discover it later, the two move together.
   *
   * Only downward, though. Unticking one action leaves View alone — he keeps the page and
   * loses the button, which is the ordinary thing somebody means.
   */
  function toggleView(page, on) {
    setDraft((d) => {
      const next = new Set(d || baseline);
      if (on) next.add(page.view);
      else {
        next.delete(page.view);
        for (const a of page.actions) next.delete(a.key);
      }
      return next;
    });
  }

  function toggleAction(page, key, on) {
    setDraft((d) => {
      const next = new Set(d || baseline);
      if (on) {
        next.add(key);
        next.add(page.view);
      } else {
        next.delete(key);
      }
      return next;
    });
  }

  return (
    <>
      {note && <div className={`notice ${note.tone}`} role="status">{note.text}</div>}

      <div className="access-split">
        <aside className="role-list" aria-label="Roles">
          <div className="role-list-head">
            <h3>Roles</h3>
            {can('roles.manage') && (
              <button className="btn btn-quiet" type="button" onClick={() => { setFailure(''); setCreating(true); }}>
                New role
              </button>
            )}
          </div>

          <AsyncBlock state={state} skeleton={<TableSkeleton rows={5} cols={2} />} empty="No roles.">
            <ul>
              {roles.map((r) => (
                <li key={r.key}>
                  <button
                    type="button"
                    className={`role-pick${r.key === selected ? ' is-picked' : ''}`}
                    onClick={() => setSelected(r.key)}
                    aria-pressed={r.key === selected}
                  >
                    <span className="role-pick-main">
                      <strong>{r.label}</strong>
                      {r.isSystem && <StatusBadge tone="info">built-in</StatusBadge>}
                    </span>
                    <span className="role-pick-sub">
                      <span className="mono">{r.key}</span>
                      <span>rank {r.rank}</span>
                      <span>
                        {(held[r.key]?.size ?? 0)} permission{(held[r.key]?.size ?? 0) === 1 ? '' : 's'}
                        {' · '}
                        {(usage[r.key]?.members ?? 0)} member{(usage[r.key]?.members ?? 0) === 1 ? '' : 's'}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </AsyncBlock>
        </aside>

        <section className="role-editor" aria-label="Role permissions">
          {current && (
            <>
              <div className="role-editor-head">
                <div>
                  <h3>{current.label}</h3>
                  <p className="hint">{current.description || 'No description.'}</p>
                </div>
                <RoleMeta
                  role={current}
                  usage={usage[current.key]}
                  canManage={can('roles.manage') && editable}
                  onSaved={(text) => { setNote({ tone: 'notice-ok', text }); state.retry(); }}
                  onFailed={setFailure}
                />
              </div>

              {lock && <div className="notice notice-warn" role="status">{lock}</div>}

              {failure && <div className="notice notice-danger" role="alert">{failure}</div>}

              {/*
                One row per page of the panel, not one per permission.

                The catalogue is organised `resource.verb` because that is what a policy needs
                to name. Nobody decides access that way: the question is always "should he be
                able to open the Point Ledger, and should he only be able to look at it". A
                grid of forty-six keys made the person translate the second question into the
                first in his head, every time — and a translation done in somebody's head is
                one that gets made wrong in the direction of granting too much.

                shared/domain/access-map.js is the mapping, and a test asserts it covers every
                permission in the catalogue exactly once — so nothing can be granted here that
                the policies do not enforce, and nothing the policies enforce is unreachable.
              */}
              <div className="page-perms">
                {PAGES.map((page) => {
                  const view = ticked.has(page.view);
                  const shared = sharesViewWith(page);
                  const cannotView = !view && !can(page.view);
                  return (
                    <div key={page.id} className={`page-row${view ? ' is-open' : ''}`}>
                      <div className="page-row-head">
                        <span className="page-row-name">{page.label}</span>
                        <span className="page-row-what">{page.what}</span>
                      </div>

                      <div className="page-row-perms">
                        <label className={`perm-chip is-view${view ? ' is-on' : ''}${cannotView ? ' is-blocked' : ''}`}>
                          <input
                            type="checkbox"
                            checked={view}
                            disabled={!editable || busy || cannotView}
                            onChange={(e) => toggleView(page, e.target.checked)}
                          />
                          <span>View</span>
                        </label>

                        {page.actions.length === 0 && (
                          <span className="hint page-row-none">Nothing to change on this page.</span>
                        )}

                        {page.actions.map((a) => {
                          const on = ticked.has(a.key);
                          // You may not grant what you do not hold. Checked here so the box is
                          // disabled rather than refused on save — and only in the granting
                          // direction, because taking a permission away is not an escalation.
                          const cannotGrant = !on && !can(a.key);
                          return (
                            <label
                              key={a.key}
                              className={`perm-chip is-${a.kind}${on ? ' is-on' : ''}${cannotGrant ? ' is-blocked' : ''}`}
                              title={a.note || a.key}
                            >
                              <input
                                type="checkbox"
                                checked={on}
                                disabled={!editable || busy || cannotGrant}
                                onChange={(e) => toggleAction(page, a.key, e.target.checked)}
                              />
                              <span>{a.label}</span>
                            </label>
                          );
                        })}
                      </div>

                      {/* Said where the tick is, not in a footnote. `settings.read` opens
                          Settings, Video and Navigation together, and somebody who ticked View
                          on Video and found Settings had appeared would reasonably conclude
                          the screen was broken. */}
                      {view && shared.length > 0 && (
                        <p className="page-row-note">
                          Viewing this also opens {shared.join(' and ')} - the three read the
                          same settings row, so there is one permission between them.
                        </p>
                      )}

                      {page.actions.some((a) => ticked.has(a.key) && a.note) && (
                        <ul className="page-row-warnings">
                          {page.actions
                            .filter((a) => ticked.has(a.key) && a.note)
                            .map((a) => (
                              <li key={a.key}>
                                <strong>{a.label}:</strong> {a.note}
                              </li>
                            ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>

              {editable && (
                <div className="role-editor-foot">
                  <span className="hint">
                    {changed.length === 0
                      ? 'No changes.'
                      : `${changed.length} change${changed.length === 1 ? '' : 's'}: ${changed.join(', ')}`}
                  </span>
                  <span>
                    <button
                      className="btn btn-quiet"
                      type="button"
                      disabled={!changed.length || busy}
                      onClick={() => setDraft(null)}
                    >
                      Discard
                    </button>
                    <button
                      className={`btn${busy ? ' is-busy' : ''}`}
                      type="button"
                      disabled={!changed.length || busy}
                      onClick={() => setConfirming(true)}
                    >
                      {busy ? 'Saving…' : 'Save'}
                    </button>
                  </span>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {/*
        The confirm names the people, not the checkboxes.

        A role change is a bulk action: it is the only control in this panel where one press
        alters what several named people may do, immediately. Restating it as "N administrators
        are affected" before the save is the difference between a decision and a slip.
      */}
      <ConfirmSave
        open={confirming}
        busy={busy}
        role={current}
        changes={changed}
        baseline={baseline}
        ticked={ticked}
        affected={affected}
        onCancel={() => setConfirming(false)}
        onConfirm={save}
      />

      <NewRoleDialog
        open={creating}
        busy={busy}
        maxRank={myRank}
        existing={roles}
        failure={failure}
        onCancel={() => { setCreating(false); setFailure(''); }}
        onSave={async (values) => {
          setBusy(true);
          setFailure('');
          try {
            const made = await createRole(values);
            setCreating(false);
            setSelected(made.key);
            setNote({
              tone: 'notice-ok',
              text: `${made.label} created. It holds nothing yet - tick what it may do and press Save.`,
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

/** The role's own details, and the delete. Separate so the grid above is only the grid. */
function RoleMeta({ role, usage, canManage, onSaved, onFailed }) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(role.label);
  const [description, setDescription] = useState(role.description);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setLabel(role.label);
    setDescription(role.description);
    setEditing(false);
  }, [role.key, role.label, role.description]);

  if (!canManage) return null;

  if (!editing) {
    return (
      <span className="role-meta-actions">
        <button className="btn btn-quiet" type="button" onClick={() => setEditing(true)}>
          Rename
        </button>
        {/* Only ever offered for a role nobody holds and that did not ship with the schema.
            The guard refuses both anyway and names the number in the second case, but a
            button that can only be refused is not an action. */}
        {!role.isSystem && (usage?.members ?? 0) === 0 && (
          <button
            className="btn btn-quiet is-danger"
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await deleteRole(role.key);
                onSaved(`${role.label} deleted.`);
              } catch (e) {
                onFailed(adminWriteError(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Delete
          </button>
        )}
      </span>
    );
  }

  return (
    <span className="role-meta-edit">
      <input value={label} onChange={(e) => setLabel(e.target.value)} disabled={busy} aria-label="Role name" />
      <input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        disabled={busy}
        aria-label="Description"
        placeholder="What this role is for"
      />
      <button
        className="btn"
        type="button"
        disabled={busy || !label.trim()}
        onClick={async () => {
          setBusy(true);
          try {
            await updateRole(role.key, { label, description });
            onSaved('Role details saved.');
            setEditing(false);
          } catch (e) {
            onFailed(adminWriteError(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        Save
      </button>
      <button className="btn btn-quiet" type="button" onClick={() => setEditing(false)} disabled={busy}>
        Cancel
      </button>
    </span>
  );
}

function ConfirmSave({ open, busy, role, changes, baseline, ticked, affected, onCancel, onConfirm }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  if (!role) return null;

  const removed = changes.filter((p) => isRevocation(baseline.has(p), ticked.has(p)));
  const added = changes.filter((p) => !baseline.has(p));

  return (
    <dialog ref={ref} className="dialog" onCancel={(e) => { e.preventDefault(); if (!busy) onCancel(); }}>
      <h2>Save changes to {role.label}?</h2>

      <p>
        {affected === 0
          ? 'Nobody holds this role yet, so nothing changes for anybody today.'
          : `${affected} administrator${affected === 1 ? '' : 's'} hold${affected === 1 ? 's' : ''} this role. The change applies from their next request - there is no session to expire.`}
      </p>

      {added.length > 0 && (
        <>
          <p className="hint">Gaining:</p>
          <ul className="change-list">{added.map((p) => <li key={p} className="mono">{p}</li>)}</ul>
        </>
      )}

      {removed.length > 0 && (
        <>
          <p className="hint">Losing:</p>
          <ul className="change-list is-removing">{removed.map((p) => <li key={p} className="mono">{p}</li>)}</ul>
        </>
      )}

      <div className="confirm-actions">
        <button className="btn btn-quiet" type="button" onClick={onCancel} disabled={busy}>Cancel</button>
        <button className={`btn${busy ? ' is-busy' : ''}`} type="button" onClick={onConfirm} disabled={busy}>
          {busy ? 'Saving…' : 'Yes, save'}
        </button>
      </div>
    </dialog>
  );
}

/**
 * A new role.
 *
 * The key is upper snake case and permanent — `admins.role` is a foreign key to it, so a
 * rename would orphan every person holding it, which is why updateRole() will not change one.
 * The label is what people read and can be changed at any time.
 *
 * Rank is offered only *below* the creator's own. The guard refuses anything at or above it,
 * and the field says so rather than letting the press discover it.
 */
function NewRoleDialog({ open, busy, maxRank, existing, failure, onCancel, onSave }) {
  const ref = useRef(null);
  const [key, setKey] = useState('');
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [rank, setRank] = useState('');
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setKey('');
    setLabel('');
    setDescription('');
    // Halfway down the space below the creator, so the common case needs no thought and the
    // field is still obviously a number somebody may change.
    setRank(String(Math.max(1, Math.floor(maxRank / 2))));
    setTouched(false);
  }, [open, maxRank]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  const n = Number(rank);
  const problems = [];
  // The CHECK on admin_roles.key, copied exactly - a client rule looser than the server's
  // turns a fixable typo into a constraint violation.
  if (!/^[A-Z][A-Z0-9_]{2,31}$/.test(key.trim().toUpperCase())) {
    problems.push('The key is 3-32 characters, A-Z, 0-9 and underscore, starting with a letter.');
  } else if (existing.some((r) => r.key === key.trim().toUpperCase())) {
    problems.push('A role with that key already exists.');
  }
  if (!label.trim()) problems.push('Give it a name people will read.');
  if (!Number.isInteger(n) || n < 1 || n >= maxRank) {
    problems.push(`Rank must be between 1 and ${maxRank - 1} - below your own.`);
  }
  const ok = problems.length === 0;

  return (
    <dialog ref={ref} className="dialog" onCancel={(e) => { e.preventDefault(); if (!busy) onCancel(); }}>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (!ok || busy) return;
          onSave({ key: key.trim().toUpperCase(), label: label.trim(), description, rank: n });
        }}
      >
        <h2>New role</h2>

        <div className="field">
          <label htmlFor="role-key">Key</label>
          <input
            id="role-key"
            value={key}
            onChange={(e) => setKey(e.target.value.toUpperCase())}
            disabled={busy}
            autoFocus
            autoCapitalize="characters"
            spellCheck={false}
            aria-describedby="role-key-hint"
          />
          <span className="hint" id="role-key-hint">
            ZONE_LEAD, REPORT_VIEWER. This is permanent - it is what the audit trail records and
            what every administrator's row points at, so it cannot be renamed later.
          </span>
        </div>

        <div className="field">
          <label htmlFor="role-label">Name</label>
          <input id="role-label" value={label} onChange={(e) => setLabel(e.target.value)} disabled={busy} />
        </div>

        <div className="field">
          <label htmlFor="role-desc">What it is for</label>
          <input
            id="role-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={busy}
            placeholder="Sees Varachha progress, changes nothing"
          />
        </div>

        <div className="field">
          <label htmlFor="role-rank">Rank</label>
          <input
            id="role-rank"
            type="number"
            min="1"
            max={maxRank - 1}
            value={rank}
            onChange={(e) => setRank(e.target.value)}
            disabled={busy}
            aria-describedby="role-rank-hint"
          />
          <span className="hint" id="role-rank-hint">
            Who may administer whom. Somebody can only edit roles and people *below* his own
            rank, so a lower number is a less powerful role. Yours is {maxRank}.
          </span>
        </div>

        {failure && <div className="notice notice-danger" role="alert">{failure}</div>}
        {touched && !ok && <div className="notice notice-danger" role="alert">{problems[0]}</div>}

        <div className="confirm-actions">
          <button className="btn btn-quiet" type="button" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className={`btn${busy ? ' is-busy' : ''}`} type="submit" disabled={busy || !ok}>
            {busy ? 'Creating…' : 'Create role'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
