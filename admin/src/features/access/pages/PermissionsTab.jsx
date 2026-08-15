import { useMemo, useState } from 'react';
import { useAsync } from '../../../lib/useAsync';
import { AsyncBlock, TableSkeleton } from '../../../components/StateBlocks';
import { StatusBadge } from '../../../components/StatCard';
import { listPermissions, listRolePermissions, listRoles } from '../../users/services/adminService';

/**
 * ────────────────────────────────────────────────────────────────────────────
 * Permissions — the catalogue, and who holds each one
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The screen that answers "who can do X". In any system with per-person exceptions that
 * question becomes unanswerable without it: the roles page answers "what may this role do"
 * and the effective-access page answers "what may this person do", and neither of them can be
 * read backwards. Somebody asking "who can delete a test account" would otherwise have to open
 * every role and every administrator in turn.
 *
 * ── Read-only, and that is a property of the schema rather than of this page ─
 *
 * `public.permissions` is written by migrations and by nothing else. `permissions_immutable()`
 * raises on any insert, update or delete where `auth.uid()` is not null — which includes
 * `service_role`, so a Netlify function holding the secret key cannot write here either. That
 * is the safeguard the whole of 0043 rests on: the bindings became data so the સંચાલક can hand
 * out access, and the catalogue stayed code so he cannot invent access that no policy enforces.
 *
 * So there is no add button, no edit, and no delete, and their absence is the design rather
 * than an unfinished screen. The note at the top of the page says so, because a person who
 * needs a permission that does not exist needs to know who to ask, not to keep looking for a
 * button.
 *
 * ── Roles only, deliberately, and not individuals ───────────────────────────
 *
 * The "held by" column lists roles. It could list people too — every ALLOW grant is readable
 * with `admins.read` — and it does not, because a permission held by four roles and three
 * individual exceptions would render as a wall of names in which the roles, which are the
 * thing you can actually reason about, would be lost. The individual exceptions belong to the
 * person, and Effective access is where a person is the subject.
 */
export default function PermissionsTab() {
  const state = useAsync(() => Promise.all([listPermissions(), listRoles(), listRolePermissions()]), []);
  const [permissions, roles, held] = state.data || [[], [], {}];

  const [term, setTerm] = useState('');
  const [resource, setResource] = useState('');

  const resources = useMemo(
    () => [...new Set(permissions.map((p) => p.resource))],
    [permissions]
  );

  /**
   * Which roles hold each permission, inverted once rather than per row.
   *
   * `held` arrives as role → Set(permission), which is the shape the role editor needs. Asking
   * it the opposite question inside the render would be a scan of every role's set for every
   * one of forty-six rows on every keystroke in the filter box.
   */
  const holders = useMemo(() => {
    const out = {};
    for (const [roleKey, set] of Object.entries(held)) {
      for (const p of set) (out[p] ||= []).push(roleKey);
    }
    return out;
  }, [held]);

  const labelOf = useMemo(
    () => Object.fromEntries(roles.map((r) => [r.key, r.label])),
    [roles]
  );

  const q = term.trim().toLowerCase();
  const rows = permissions.filter((p) => {
    if (resource && p.resource !== resource) return false;
    if (!q) return true;
    return (
      p.key.toLowerCase().includes(q) ||
      p.label.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q)
    );
  });

  return (
    <>
      <div className="notice notice-info" role="note">
        This list is fixed for this deploy. Permissions are created by a database migration and
        cannot be added, renamed or removed from the panel - by anyone, including a Super Admin.
        That is what stops a role being given an ability that no policy actually enforces. If
        something you need is missing here, it has to be built.
      </div>

      <form className="filters" onSubmit={(e) => e.preventDefault()}>
        <div className="field">
          <label htmlFor="perm-q">Search</label>
          <input
            id="perm-q"
            type="search"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="points, replace, export…"
            autoCapitalize="none"
            spellCheck={false}
          />
        </div>

        <div className="field">
          <label htmlFor="perm-resource">Area</label>
          <select id="perm-resource" value={resource} onChange={(e) => setResource(e.target.value)}>
            <option value="">All areas</option>
            {resources.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>
      </form>

      <AsyncBlock
        state={state}
        skeleton={<TableSkeleton rows={8} cols={3} />}
        empty="No permissions match that."
      >
        {rows.length === 0 ? (
          <p className="hint">No permission matches that.</p>
        ) : (
          <ul className="perm-catalogue">
            {rows.map((p) => (
              <li key={p.key}>
                <div className="perm-cat-head">
                  <strong>{p.label}</strong>
                  {p.isSection && (
                    <StatusBadge tone="info">opens a section</StatusBadge>
                  )}
                  <span className="mono perm-cat-key">{p.key}</span>
                </div>
                <p className="perm-cat-desc">{p.description}</p>
                <div className="perm-cat-roles">
                  {(holders[p.key] || []).length === 0 ? (
                    /* A permission nothing holds is worth pointing at: it is either newly
                       added and not yet granted, or it was taken away from everybody, and
                       both are states somebody would want to know about. */
                    <span className="hint">No role holds this.</span>
                  ) : (
                    (holders[p.key] || []).map((r) => (
                      <StatusBadge key={r} tone="off">{labelOf[r] || r}</StatusBadge>
                    ))
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </AsyncBlock>
    </>
  );
}
