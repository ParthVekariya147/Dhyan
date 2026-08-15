import { useSearchParams } from 'react-router-dom';
import { useAdminAuth } from '../../../lib/adminAuth';
import Tabs, { TabPanel } from '../../../components/Tabs';
import { PageHeader } from '../../../components/StatCard';
import AdminsTab from '../../users/pages/AdminsTab';
import RolesTab from './RolesTab';
import PermissionsTab from './PermissionsTab';
import EffectiveAccessTab from './EffectiveAccessTab';
import '../access.css';

/**
 * ────────────────────────────────────────────────────────────────────────────
 * /access — who runs the panel, and what each of them may do
 * ────────────────────────────────────────────────────────────────────────────
 *
 * 0043 turned the permission matrix from a hardcoded SQL function into four tables the panel
 * can write. Until this page existed, that was true and unreachable: roles, bindings and
 * per-person exceptions were live and enforced, and the only way to change one was to type SQL
 * at the database. A permission model nobody but a developer can operate is one that gets
 * worked around by sharing a password, which is how every access-control system is actually
 * defeated.
 *
 * ── Why it is a section and not another tab under /users ────────────────────
 *
 * The સંચાલક list has been a tab of /users since 0038, and that was right while it was one
 * list: administrators and યુવકો are two populations answering one question, "who is in this
 * system and what state is their account in". Roles, the catalogue and effective access are a
 * different question — "what may a person do, and why" — and burying it three clicks inside a
 * page named after somebody else is why it could not be found.
 *
 * The Administrators tab is therefore *rendered in both places*, not moved. It answers both
 * questions: it belongs beside the યુવક list as a population, and beside the role editor as
 * the thing roles are assigned to. It is one component imported twice, so the two cannot drift
 * — the alternative, a copy per section, is how two screens for one table start disagreeing
 * about what a suspension means.
 *
 * ── One permission per tab, and none of it is the boundary ──────────────────
 *
 * Every tab names the permission that governs the data it reads, exactly as AdminShell's NAV
 * does. It is visibility: `role_permissions` is readable by anyone holding any role at all and
 * writable only with `roles.manage`, and the guards behind that bind service_role too. A tab
 * filtered out here is a tab whose data would have come back empty or whose every save would
 * have been refused — and an RLS read denial returns zero rows rather than an error, so
 * "empty" is exactly what somebody would otherwise have been shown about a list that is full.
 *
 * ── The tab is in the URL ───────────────────────────────────────────────────
 *
 * Same reasoning as /users, and the same implementation: `?tab=roles` means a refresh comes
 * back where you were, the back button undoes a tab switch instead of leaving the section, and
 * a link pasted into a message opens on the list it is about. A URL naming a tab the role may
 * not see falls back to the first in silence — the person did not do anything wrong, and a
 * message explaining which tab he was refused would announce the thing the filter is hiding.
 */

const TABS = [
  {
    id: 'admins',
    label: 'Administrators',
    need: 'admins.read',
    sub: 'Who can open this panel. Give an existing yuvak a role, or create a new login.',
  },
  {
    id: 'roles',
    label: 'Roles',
    /*
      `roles.manage` and not `admins.read`, unlike every other tab here.

      This is the one tab that is useless read-only. Its whole content is a grid of checkboxes
      over a matrix that anybody holding any role can already read — so offering it without the
      permission to save would be a screen whose every control is refused on press, which is
      the failure the filtering exists to prevent rather than an instance of it.
    */
    need: 'roles.manage',
    sub: 'What each role may do. Editing a role changes it for everybody holding it, at once.',
  },
  {
    id: 'permissions',
    label: 'Permissions',
    need: 'admins.read',
    sub: 'Every permission that exists, and who holds it. Read-only - the catalogue is changed by a migration.',
  },
  {
    id: 'effective',
    label: 'Effective access',
    need: 'admins.read',
    sub: 'Pick a person and see exactly what he may do, and where each permission comes from.',
  },
];

const PANELS = {
  admins: AdminsTab,
  roles: RolesTab,
  permissions: PermissionsTab,
  effective: EffectiveAccessTab,
};

export default function AccessPage() {
  const { can } = useAdminAuth();
  const [params, setParams] = useSearchParams();

  const allowed = TABS.filter((t) => !t.need || can(t.need));
  const asked = params.get('tab');
  const current = allowed.some((t) => t.id === asked) ? asked : allowed[0]?.id;

  // Nothing to show at all. Reachable only by a role holding none of the three permissions,
  // which RequirePermission on the route has already refused — so this is the last line rather
  // than a state anybody meets.
  if (!current) return null;

  const meta = allowed.find((t) => t.id === current);
  const Panel = PANELS[current];

  return (
    <>
      <PageHeader title="Access" sub={meta?.sub} />

      <Tabs
        idBase="access"
        label="Access"
        tabs={allowed.map(({ id, label }) => ({ id, label }))}
        value={current}
        // `replace` so switching tabs does not stack a history entry per press: the back
        // button should leave the section after one press from wherever you started, not walk
        // back through every tab you looked at.
        onChange={(id) => setParams({ tab: id }, { replace: true })}
      />

      <TabPanel idBase="access" id={current}>
        <Panel />
      </TabPanel>
    </>
  );
}
