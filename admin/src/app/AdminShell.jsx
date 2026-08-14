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
 * reading surface; this is an operational console — light, neutral, dense, high contrast.
 * The separation is light-against-dark rather than cool-against-warm: the panel now takes
 * the product's amber as its one accent, at a darker value that reads as authority on
 * white instead of as decoration. §8 says not to share UI components between the two, and
 * that has not changed — the two stylesheets have no common ancestor.
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
  /*
    ગુણ — six entries, and two permissions between them.

    The five reading screens go to functions that each check `progress.read` before they answer
    — 0032's open with `admin_assert_progress_reader()` and 0035's લેવલ ૩ report raises
    `level3_report_forbidden` itself — so all five name `progress.read`, the same permission
    Progress names, and for the same reason: it is the one that decides whether the page can
    say anything true. Point Management edits `settings['levels'].value.points`, so it names
    `settings.read` like every other screen that edits a settings row, and its saves are
    refused without `settings.update` by the policy and the trigger behind it.

    Placed here, after Sessions, against the note above rather than by taste. This list decides
    every role's landing page — App.jsx opens the panel on `NAV.find(can)` — so an insertion
    near the top would silently move somebody's front door. દર્શન is third and every role in
    the matrix holds darshan.read, so nothing inserted after it can change where any role
    lands. This is well after it, beside the two people-shaped sections it is read against.

    Icons from the Geometric Shapes block like their neighbours, so they render from the same
    font on the same machines: ◉ a mark being awarded, ▦ ruled rows and columns, ◧ one day out
    of the whole, ◭ a place on a podium.
  */
  { to: '/points', label: 'Point Management', icon: '◉', need: 'settings.read' },
  { to: '/points/ledger', label: 'Point Ledger', icon: '▦', need: 'progress.read' },
  { to: '/points/daily', label: 'Daily Activity', icon: '◧', need: 'progress.read' },
  // ◨ against Daily Activity's ◧ - the mirrored half, because the two are the same day seen from
  // opposite sides: what the app observed, and what the યુવક wrote down himself.
  { to: '/points/records', label: 'Daily Records', icon: '◨', need: 'progress.read' },
  /*
    §29's લેવલ ૩ report. `progress.read` like the other reading screens, because that is the
    permission `admin_level3_users()` raises 42501 without.

    It is a section rather than a filter on Progress for the reason its page states at length:
    Progress adds its લેવલ ૩ columns to a page of યુવકો it has already paginated, so a threshold
    asked there would silently mean "on this page". ◫ - a square with one band filled - against
    Daily Activity's ◧ and Daily Records' ◨, from the same Geometric Shapes block as every icon
    here so it renders from the same font on the same machines.
  */
  { to: '/points/level3', label: 'Level 3 Report', icon: '◫', need: 'progress.read' },
  { to: '/points/leaderboard', label: 'Leaderboard', icon: '◭', need: 'progress.read' },
  { to: '/levels', label: 'Level', icon: '⧉', need: 'settings.read' },
  // Its own entry rather than a link buried inside Levels: લેવલ ૪ is a container the સંચાલક
  // fills — which દર્શન each sub-level asks for — and that is a section's worth of work, not
  // a setting. `settings.read` for the same reason its neighbours have it: a VIEWER may read
  // what is configured while settings.update and the policy behind it refuse every save.
  { to: '/levels/4', label: 'Level 4', icon: '⌗', need: 'settings.read' },
  { to: '/video', label: 'Video', icon: '▷', need: 'settings.read' },
  /*
    The bottom bar of the યુવક app — settings/nav.

    `settings.read`, like the three entries around it: a VIEWER may read which buttons a
    યુવક has, and every control that writes is disabled without settings.update and refused
    by the policy and the trigger behind it.

    Where it sits was chosen against the note above rather than by taste. This list decides
    every role's landing page — App.jsx opens the panel on `NAV.find(can)` — so an insertion
    near the top would silently move somebody's front door. Every role in the matrix holds
    darshan.read and દર્શન is third, so nothing inserted after it can change where any role
    lands; this is well after it, between the two screens it is read against. Video, this and
    Settings are the three that decide what the app *looks like* rather than what is in it.
  */
  // ▥ — a square ruled into vertical cells, which is the bar: four or five equal buttons
  // side by side. The same Geometric Shapes family as ▤ and ❑ above, so it renders from the
  // same font on the same machines.
  { to: '/navigation', label: 'Navigation', icon: '▥', need: 'settings.read' },
  { to: '/settings', label: 'Settings', icon: '⚙', need: 'settings.read' },
  { to: '/audit-logs', label: 'Audit Log', icon: '✎', need: 'audit.read' },
];

/**
 * §10 — the same sections, grouped for the sidebar.
 *
 * Grouping is presentation and nothing else, which is why this is a second view of NAV
 * rather than a replacement for it. NAV stays flat and stays in *its* order because
 * App.jsx opens the panel on `NAV.find(can)` — the first section the role can actually
 * use — and re-ordering this list would silently move every role's front door. One
 * table, two shapes, no third spelling of a permission.
 *
 * A group whose items are all filtered out renders nothing at all: an empty "CONTENT"
 * heading over a gap tells a CONTENT_MANAGER there is something he cannot see, which is
 * both untrue and the opposite of what the filter is for.
 */
const at = (to) => NAV.find((n) => n.to === to);

export const NAV_GROUPS = [
  { label: 'Overview', items: [at('/dashboard')] },
  { label: 'Content', items: [at('/darshan'), at('/levels'), at('/levels/4')] },
  {
    label: 'People',
    items: [
      at('/users'),
      at('/progress'),
      at('/sessions'),
      // The three reading screens sit with the people they are about, not with the rule page
      // that priced them. A સંચાલક asking "what did he do, and what was he paid" is asking a
      // question about a યુવક; changing what an activity is worth is a system decision, and
      // that one entry is under System with the other settings screens.
      at('/points/ledger'),
      at('/points/daily'),
      at('/points/records'),
      // Beside the two daily reports rather than under System: "who has done 50 points of
      // પુનરાવર્તન, and who did none today" is a question about યુવકો, which is what this group is.
      at('/points/level3'),
      at('/points/leaderboard'),
    ],
  },
  {
    label: 'System',
    items: [at('/video'), at('/navigation'), at('/points'), at('/settings'), at('/audit-logs')],
  },
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

  // The same filter, applied per group, with empty groups dropped. Rendering is the only
  // thing that differs — `can` is asked exactly the questions it was asked before.
  const groups = NAV_GROUPS
    .map((g) => ({ ...g, items: g.items.filter((n) => n && can(n.need)) }))
    .filter((g) => g.items.length > 0);

  /**
   * §9 — what the topbar says you are looking at.
   *
   * Longest matching path, not `startsWith` on the first hit: /levels/4 and /levels both
   * match a /levels/4/config/… URL, and the shorter one would label the લેવલ ૪ editor
   * "Level". Falls back to the product name on the landing redirect, which is on screen
   * for one frame.
   */
  const section = nav
    .filter((n) => loc.pathname === n.to || loc.pathname.startsWith(n.to + '/'))
    .sort((a, b) => b.to.length - a.to.length)[0];

  // A drawer that survives navigation would hide the page it just opened.
  useEffect(() => setOpen(false), [loc.pathname]);

  /**
   * §11 — the page behind the drawer must not scroll under it.
   *
   * Without this, a touch drag over the scrim scrolls the list underneath, so closing the
   * drawer returns you somewhere you never navigated to. Restoring the previous value
   * rather than clearing it outright leaves any other owner of `overflow` undisturbed.
   */
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

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

  /**
   * §9 — the account menu.
   *
   * The topbar used to spend its whole right-hand side on a name, a role and a permanent
   * "Log out" button. Log out is the one action in the panel nobody performs by accident
   * and nobody performs often, so it had the most prominent position in the chrome for the
   * least reason. It lives behind the avatar now, with the identity it belongs to.
   *
   * Closed on navigation, on Escape, and on a pointerdown outside it. `pointerdown` rather
   * than `click`: a document-level click listener fires *after* the trigger's own onClick
   * has already toggled the menu, so pressing the avatar a second time would close and
   * immediately reopen it — the menu could never be dismissed by its own button.
   */
  const [menu, setMenu] = useState(false);
  const menuRef = useRef(null);
  const menuBtnRef = useRef(null);

  useEffect(() => setMenu(false), [loc.pathname]);

  useEffect(() => {
    if (!menu) return;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      setMenu(false);
      // Focus goes back to the trigger, not to the top of the page: closing a menu with
      // the keyboard must leave you where you opened it (§43).
      menuBtnRef.current?.focus();
    };
    // The ref wraps the trigger *and* the dropdown, so a press on the trigger is "inside"
    // and is left to its own onClick to handle.
    const onDown = (e) => { if (!menuRef.current?.contains(e.target)) setMenu(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [menu]);

  const who = profile?.name || user?.email || '';
  // Two initials from a name, one from an email. Purely decorative, so it is aria-hidden
  // and the accessible name on the button carries the real identity.
  const initials = who.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

  return (
    <div className={`shell ${open ? 'is-open' : ''}`}>
      <a className="skip" href="#main">Skip to main content</a>

      {/*
        The grid has always declared a "brand" cell — the square above the sidebar, beside
        the topbar — and nothing was ever placed in it, so the panel opened with an empty
        white rectangle in its top-left corner and the product's name nowhere on screen
        except as a subtitle. This fills it. It is a link to the panel root rather than
        inert text, because a logo that does not go home is a thing people click at anyway.
      */}
      <NavLink to="/" className="brand" end>
        <span className="brand-mark" aria-hidden="true">ધ</span>
        <span className="brand-text">
          <strong>Varni Dhyan</strong>
          <span>Admin Panel</span>
        </span>
      </NavLink>

      <header className="topbar">
        <button
          className="icon-btn only-narrow"
          type="button"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          aria-controls="admin-nav"
          onClick={() => setOpen((o) => !o)}
        >
          ☰
        </button>
        <div className="topbar-title">
          <strong>{section ? section.label : 'Admin Panel'}</strong>
        </div>

        <div className="topbar-right" ref={menuRef}>
          <button
            className={`account ${menu ? 'is-open' : ''}`}
            type="button"
            ref={menuBtnRef}
            aria-haspopup="menu"
            aria-expanded={menu}
            onClick={() => setMenu((m) => !m)}
          >
            <span className="avatar" aria-hidden="true">{initials}</span>
            <span className="account-who">
              <span className="who-name">{who}</span>
              {/* The role, not the word "સંચાલક": a COORDINATOR and a SUPER_ADMIN see
                  different panels, and which one you are holding is worth being able to
                  read off the screen. */}
              <span className="who-role" title={role || ''}>{roleLabel(role)}</span>
            </span>
            <span className="account-caret" aria-hidden="true">▾</span>
          </button>

          {menu && (
            <div className="menu" role="menu" aria-label="Account">
              <div className="menu-head">
                <strong>{who}</strong>
                {/* The email as well as the name: two સંચાલકો may share a name, and this
                    is the string you quote when asking for a role to be changed. */}
                {user?.email && who !== user.email && <span>{user.email}</span>}
                <span className="pill pill-info">{roleLabel(role)}</span>
              </div>
              <a
                className="menu-item"
                role="menuitem"
                href="/"
                target="_blank"
                rel="noopener noreferrer"
              >
                <span aria-hidden="true">↗</span> Open the User app
              </a>
              <button className="menu-item is-danger" role="menuitem" type="button" onClick={logout}>
                <span aria-hidden="true">⏻</span> Log out
              </button>
            </div>
          )}
        </div>
      </header>

      <nav className="sidebar" id="admin-nav" ref={drawerRef} aria-label="Sections">
        {/* The drawer needs its own head: on a phone the brand cell above the sidebar is
            not rendered at all, so without this the panel slides open with no statement of
            what it is. Desktop hides it — the brand block already says so, and saying it
            twice in one column is clutter. */}
        <div className="sidebar-brand" aria-hidden="true">
          <span className="brand-mark">ધ</span>
          <strong>Varni Dhyan</strong>
        </div>

        {groups.map((g) => (
          <div className="nav-group" key={g.label}>
            <p className="nav-group-label">{g.label}</p>
            <ul>
              {g.items.map((n) => (
                <li key={n.to}>
                  {/* `end` on /levels only: without it react-router marks the parent
                      active for /levels/4 as well, so two items light up at once and
                      neither reads as where you are. */}
                  <NavLink
                    to={n.to}
                    end={n.to === '/levels'}
                    className={({ isActive }) => (isActive ? 'is-active' : '')}
                  >
                    <span className="nav-icon" aria-hidden="true">{n.icon}</span>
                    {n.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {/* "Open the User app" used to sit here. It moved into the account menu, where the
            other cross-application action already was, rather than being offered twice. */}
      </nav>

      {/* Scrim only exists while the drawer is open, so it can never eat clicks. */}
      {open && <button className="scrim" aria-label="Close menu" onClick={() => setOpen(false)} />}

      <main className="content" id="main">
        <Outlet />
      </main>
    </div>
  );
}
