import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAdminAuth } from '../lib/adminAuth';
import { tryWriteAudit } from '../features/audit/services/auditService';
import { ACTIONS } from '../../../shared/domain/audit.js';
import { roleLabel } from '../../../shared/domain/permissions.js';

/**
 * §13 — the panel shell. Sidebar + top bar + content on a desktop; on a phone the
 * sidebar becomes a drawer over the content.
 *
 * This deliberately looks nothing like the યુવક app. That app is a dark, gold, unhurried
 * reading surface; this is an operational console — dense, cool-toned, high contrast.
 * §8 says not to share UI components between the two, and this is why.
 */

/**
 * §10, §13 — one section, one permission.
 *
 * This was a flat list, so every role saw every link and the panel's own README described a
 * visibility layer that did not exist. Hiding a link is usability and never security — the
 * policy in 0004_rbac.sql is the boundary — but a link that leads somewhere untrue is not
 * decoration either. An RLS *read* denial returns zero rows rather than an error
 * (admin/src/lib/errors.js says why), so a VIEWER who opened Audit Log was told "No changes
 * have been recorded yet" about a log that is full, and a CONTENT_MANAGER, who holds no
 * user permission of any kind, was shown "Total registered: 1" — his own profile, the only
 * row the policy let past — as the size of the સંઘ. A confident wrong number is worse than
 * a missing menu item.
 *
 * `need` is a permission name read off `public.permissions_for()` in 0004_rbac.sql and its
 * UI copy in shared/domain/permissions.js. Never a name invented here: the two matrices are
 * already duplicated on purpose, and a third spelling would make the menu promise something
 * no policy grants.
 *
 * Each section names the permission governing the data it *reads*, because that is what
 * decides whether the page can say anything true — not the permission needed to save, which
 * is the individual control's business (§35). So Levels and Video sit under `settings.read`
 * with Settings: all three read settings/app, and a VIEWER may look at what is configured
 * while `settings.update` and the WITH CHECK behind it refuse the save. Dashboard counts
 * registrations and learning progress, so it is `users.read` and not `darshan.read` — every
 * role holds darshan.read, which would have kept the tile of wrong user totals visible to
 * exactly the role that must not see it.
 *
 * Exported because App.jsx opens the panel on the first section the role can actually use.
 * One table, so the sidebar and the landing page cannot disagree.
 */
export const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: '▤', need: 'users.read' },
  { to: '/users', label: 'Users', icon: '☰', need: 'users.read' },
  { to: '/darshan', label: 'Darshan', icon: '❑', need: 'darshan.read' },
  { to: '/progress', label: 'Progress', icon: '◔', need: 'progress.read' },
  { to: '/sessions', label: 'Sessions', icon: '◷', need: 'sessions.read' },
  { to: '/levels', label: 'Level', icon: '⧉', need: 'settings.read' },
  // Its own entry rather than a link buried inside Levels: લેવલ ૪ is a container the સંચાલક
  // fills — which દર્શન each sub-level asks for — and that is a section's worth of work, not
  // a setting. `settings.read` for the same reason its neighbours have it: a VIEWER may read
  // what is configured while settings.update and the policy behind it refuse every save.
  { to: '/levels/4', label: 'Level 4', icon: '⌗', need: 'settings.read' },
  { to: '/video', label: 'Video', icon: '▷', need: 'settings.read' },
  { to: '/settings', label: 'Settings', icon: '⚙', need: 'settings.read' },
  { to: '/audit-logs', label: 'Audit Log', icon: '✎', need: 'audit.read' },
];

export default function AdminShell() {
  const { user, profile, role, logout, via, can } = useAdminAuth();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const drawerRef = useRef(null);

  // Nine lookups in a list of at most seventeen permissions, so no useMemo: a dependency
  // list is one more thing that has to be kept in step with the role, and a menu left over
  // from the previous role is the exact failure this filter exists to prevent. Every role
  // in the matrix holds darshan.read, so `nav` is never empty — and it is filtered rather
  // than defaulted, so a role added later that holds nothing gets an empty sidebar instead
  // of somebody else's menu.
  const nav = NAV.filter((n) => can(n.need));

  // A drawer that survives navigation would hide the page it just opened.
  useEffect(() => setOpen(false), [loc.pathname]);

  /**
   * ADMIN_LOGIN, once per browser session (§41).
   *
   * sessionStorage rather than a state flag: this component remounts on every full page
   * load, and a log entry per refresh would bury the entries that matter. The key holds
   * a uid, not a credential — §69 rules out storing anything sensitive here.
   *
   * The marker is written *after* the insert lands, never before. tryWriteAudit() swallows
   * its failure by design — a failed audit write must not undo the thing it was recording —
   * so marking first meant one dropped packet cost that સંચાલક his ADMIN_LOGIN for the whole
   * browser session, silently, and §41 asks for the entry rather than for an attempt.
   * `attempted` is only a guard against two overlapping writes within one mount (the effect
   * re-runs when `role` and `via` arrive); it is reset on failure so the next run may retry.
   */
  const attempted = useRef(false);
  useEffect(() => {
    if (!user) return;
    // `user.id`, not `user.uid`. The Firebase field name survived the port to Supabase and
    // made this undefined, so the key was shared by every admin and the insert was
    // rejected for a null actor_id — ADMIN_LOGIN was never actually recorded.
    const key = 'admin:logged:' + user.id;
    if (attempted.current || sessionStorage.getItem(key)) return;
    attempted.current = true;
    tryWriteAudit({
      actorId: user.id,
      actorRole: role,
      action: ACTIONS.ADMIN_LOGIN,
      resourceType: 'auth',
      targetId: user.id,
      meta: { via: via || 'unknown' },
    }).then((ok) => {
      if (ok) sessionStorage.setItem(key, '1');
      else attempted.current = false;
    });
  }, [user, role, via]);

  // §56 — Escape closes the drawer, and focus moves into it when it opens.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    drawerRef.current?.querySelector('a')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className={`shell ${open ? 'is-open' : ''}`}>
      <a className="skip" href="#main">Skip to main content</a>

      <header className="topbar">
        <button
          className="icon-btn only-narrow"
          type="button"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          ☰
        </button>
        <div className="topbar-title">
          <strong>Admin Panel</strong>
          <span>Varni Dhyan</span>
        </div>
        <div className="topbar-right">
          <div className="who">
            <span className="who-name">{profile?.name || user?.email}</span>
            {/* The role, not the word "સંચાલક": a COORDINATOR and a SUPER_ADMIN see
                different panels, and which one you are holding is worth being able to
                read off the screen. */}
            <span className="who-role" title={role || ''}>
              {roleLabel(role)}
            </span>
          </div>
          <button className="btn btn-quiet" type="button" onClick={logout}>
            Log out
          </button>
        </div>
      </header>

      <nav className="sidebar" ref={drawerRef} aria-label="Sections">
        <ul>
          {nav.map((n) => (
            <li key={n.to}>
              <NavLink to={n.to} className={({ isActive }) => (isActive ? 'is-active' : '')}>
                <span className="nav-icon" aria-hidden="true">{n.icon}</span>
                {n.label}
              </NavLink>
            </li>
          ))}
        </ul>
        <p className="sidebar-foot">
          Open the User app:{' '}
          <a href="/" target="_blank" rel="noopener noreferrer">/</a>
        </p>
      </nav>

      {/* Scrim only exists while the drawer is open, so it can never eat clicks. */}
      {open && <button className="scrim" aria-label="Close menu" onClick={() => setOpen(false)} />}

      <main className="content" id="main">
        <Outlet />
      </main>
    </div>
  );
}
