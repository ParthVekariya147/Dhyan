import { useSearchParams } from 'react-router-dom';
import { useAdminAuth } from '../../../lib/adminAuth';
import Tabs, { TabPanel } from '../../../components/Tabs';
import { PageHeader } from '../../../components/StatCard';
import UsersTab from './UsersTab';
import AdminsTab from './AdminsTab';

/**
 * ────────────────────────────────────────────────────────────────────────────
 * /users — two populations, one section
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Until 0038 there was one table of people: an administrator was a `profiles` row with an
 * `admin_profiles` row attached, so the યુવક list, the dashboard's "Total registered" and every
 * export counted the people running the panel among the people learning. 104 registered was
 * never 104 yuvaks.
 *
 * 0038 splits them - `public.admins` keys off `auth.users`, and `public.yuvaks` is
 * `profiles_level4` minus anyone holding an admins row - and this page is where that split
 * becomes visible. Two tabs over one section rather than two entries in the sidebar, for two
 * reasons:
 *
 *   · they are one question asked about two groups ("who is in this system and what state is
 *     their account in"), and the answer is read side by side far more often than either half
 *     is read alone;
 *   · a second sidebar entry would be a section three of the five roles may not open, and the
 *     menu already carries as many of those as it needs to.
 *
 * ── The tab is in the URL, and that is not decoration ───────────────────────
 *
 * `?tab=admins` means a refresh comes back where you were, the back button undoes a tab switch
 * instead of leaving the section, and the link a SUPER_ADMIN pastes into a message opens on the
 * list he was talking about. Held in the query string rather than in component state, because
 * every one of those three is a property of the address and none of them can be a property of
 * a useState.
 *
 * ── A COORDINATOR must not learn that the other tab exists ──────────────────
 *
 * The સંચાલક tab is not rendered disabled, not rendered greyed, not rendered at all without
 * `admins.read`. That is the same rule AdminShell applies to sidebar sections and it is
 * visibility rather than security: the policy on `public.admins` is
 * `id = auth.uid() or has_permission('admins.read')`, so the data is refused regardless. What
 * the filter prevents is a panel that advertises a list it will then show as empty - and an
 * RLS *read* denial returns zero rows rather than an error, so "empty" is exactly what a
 * COORDINATOR would have been shown about a list that is full (admin/src/lib/errors.js).
 *
 * A URL asking for a tab the role may not see falls back to the first tab in silence. No
 * notice, no redirect: he did not do anything wrong - he opened a link somebody else sent him
 * - and a message explaining which tab he was refused would announce the very thing the filter
 * is hiding.
 */

/**
 * The tabs, in the order they are read.
 *
 * `need` is a permission name taken from shared/domain/permissions.js and its copy in
 * `public.permissions_for()` (0004_rbac.sql), never a name invented here - the two matrices are
 * already duplicated on purpose and a third spelling would make a tab promise something no
 * policy grants. A tab with no `need` is offered to everyone who can open the section at all,
 * which for /users is `users.read`, checked by the route in App.jsx.
 *
 * The labels are English because this panel is: every sidebar entry, every column heading and
 * every sentence in admin/src/lib/errors.js is. "યુવક / સંચાલક" was tried here first and read as
 * two foreign words dropped into an English page - the યુવક app is where the Gujarati lives.
 * "Yuvaks" and not "Users", because the page is already called Users and a tab repeating its
 * parent's name says nothing about what distinguishes it from the tab beside it.
 *
 * `sub` is the page's own one-line description and changes with the tab, because the header is
 * above the strip and would otherwise describe whichever list happened to be first.
 */
const TABS = [
  {
    id: 'users',
    label: 'Yuvaks',
    sub: 'Every registered yuvak. Search, filter and export - all answered by the database.',
  },
  {
    id: 'admins',
    label: 'Administrators',
    need: 'admins.read',
    sub: 'Who runs the panel, and what each of them may do. Administrators are not counted as yuvaks.',
  },
];

export default function UsersPage() {
  const { can } = useAdminAuth();
  const [params, setParams] = useSearchParams();

  // Filtered before anything else looks at it, so no later line has to remember the rule.
  // `users.read` gates the route itself, so this list always holds at least one tab.
  const tabs = TABS.filter((t) => !t.need || can(t.need));

  const requested = params.get('tab');
  const active = tabs.find((t) => t.id === requested) || tabs[0];

  /**
   * The address follows the tab.
   *
   * `replace: false` - a tab switch is a place you can go back from, which is the whole reason
   * this lives in the URL. The default tab drops the parameter entirely rather than writing
   * `?tab=users`: /users and /users?tab=users are the same screen, and only one of them should
   * ever be copied out of the address bar.
   *
   * Nothing rewrites the URL when it asks for a tab that is not on offer. Leaving `?tab=admins`
   * in the address of a COORDINATOR is deliberate: correcting it would be the panel silently
   * editing a link he was sent, and the tab he cannot see is precisely what must not be
   * commented on.
   */
  const choose = (id) => {
    const next = new URLSearchParams(params);
    if (id === TABS[0].id) next.delete('tab');
    else next.set('tab', id);
    setParams(next);
  };

  const panel = active.id === 'admins' ? <AdminsTab /> : <UsersTab />;

  return (
    <>
      <PageHeader title="Users" sub={active.sub} />

      {/*
        One tab is not a choice, so it is not drawn as one. A COORDINATOR sees the યુવક table
        under the page header exactly as he did before this section had tabs at all - which is
        the same rule as the sidebar's: a group whose items are all filtered out renders
        nothing, because an empty control announces what it was hiding.
      */}
      {tabs.length > 1 && (
        <Tabs
          idBase="users"
          label="People in the system"
          tabs={tabs}
          value={active.id}
          onChange={choose}
        />
      )}

      {/*
        Only the selected tab is mounted (see TabPanel). Each tab owns a query and a set of
        filters; keeping the other one alive would leave it re-reading a list nobody is looking
        at, and keeping its state would mean a search typed into the યુવક tab quietly still
        applied after a trip to the સંચાલક list and back.

        With one tab there is no strip, and then there must be no tabpanel either: its
        `aria-labelledby` would point at a tab element that was never rendered, which is a
        broken reference rather than a missing one. The content simply stands on the page, as it
        did before this section had tabs.
      */}
      {tabs.length > 1 ? (
        <TabPanel idBase="users" id={active.id}>
          {panel}
        </TabPanel>
      ) : (
        panel
      )}
    </>
  );
}
