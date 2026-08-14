import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AdminAuthProvider, useAdminAuth } from './lib/adminAuth';
import RequireAdmin from './app/RequireAdmin';
import RequirePermission from './app/RequirePermission';
import AdminShell, { NAV } from './app/AdminShell';
import LoginPage from './features/auth/pages/LoginPage';
import { PageLoading } from './components/StateBlocks';

/**
 * Every section is a separate chunk (§51, §52). Opening the panel loads the shell, the
 * guard and one page — not the user table, not the 124 KB દર્શન manifest, not the audit
 * log. The manifest in particular is why દર્શન must stay lazy: it is the same file the
 * યુવક app refuses to put in its login bundle.
 *
 * The login page is *not* lazy: it is the first thing an unauthenticated visitor sees,
 * and a spinner-then-form is worse than a form.
 */
const DashboardPage = lazy(() => import('./features/dashboard/pages/DashboardPage'));
const UsersPage = lazy(() => import('./features/users/pages/UsersPage'));
const UserDetailPage = lazy(() => import('./features/users/pages/UserDetailPage'));
const UserActivityPage = lazy(() => import('./features/users/pages/UserActivityPage'));
const DarshanListPage = lazy(() => import('./features/darshan/pages/DarshanListPage'));
const DarshanHealthPage = lazy(() => import('./features/darshan/pages/DarshanHealthPage'));
const DarshanImportPage = lazy(() => import('./features/darshan/pages/DarshanImportPage'));
const DarshanDetailPage = lazy(() => import('./features/darshan/pages/DarshanDetailPage'));
const ProgressPage = lazy(() => import('./features/progress/pages/ProgressPage'));
const UserProgressDetailPage = lazy(() => import('./features/progress/pages/UserProgressDetailPage'));
const SessionsPage = lazy(() => import('./features/sessions/pages/SessionsPage'));
const LevelsPage = lazy(() => import('./features/levels/pages/LevelsPage'));
const Level4ListPage = lazy(() => import('./features/level4/pages/Level4ListPage'));
const Level4EditorPage = lazy(() => import('./features/level4/pages/Level4EditorPage'));
const VideoPage = lazy(() => import('./features/video/pages/VideoPage'));
const NavigationPage = lazy(() => import('./features/navigation/pages/NavigationPage'));
const PointsPage = lazy(() => import('./features/points/pages/PointsPage'));
const PointLedgerPage = lazy(() => import('./features/points/pages/PointLedgerPage'));
const DailyActivityPage = lazy(() => import('./features/points/pages/DailyActivityPage'));
/*
  Two pages, two questions, and the names are close enough that the difference is worth stating
  where they are declared. DailyActivity is one day across everybody, from the submissions the app
  itself observed. DailyRecords is one યુવક's own daily record over a range of days - what he
  reported beside what was recorded, whether his edit window is still open, and the ledger rows
  behind the figure.
*/
const DailyRecordsPage = lazy(() => import('./features/points/pages/DailyRecordsPage'));
/*
  §29 — the લેવલ ૩ report, and it is a page rather than four more filters on Progress.

  Progress adds its લેવલ ૩ columns from a second call that is handed the page of યુવકો the
  report has *already* paginated, so a threshold asked there could only mean "on this page". This
  one reads `admin_level3_users()` (0035), where every threshold, the sort and the count are
  decided in Postgres — and which LEFT JOINs from profiles, so "who did not do લેવલ ૩ today" is
  answerable at all.
*/
const Level3Page = lazy(() => import('./features/points/pages/Level3Page'));
const LeaderboardPage = lazy(() => import('./features/points/pages/LeaderboardPage'));
const SettingsPage = lazy(() => import('./features/settings/pages/SettingsPage'));
const AuditLogPage = lazy(() => import('./features/audit/pages/AuditLogPage'));

export default function App() {
  return (
    // basename matches vite's base: the panel is served from /admin on the same site,
    // and moving it to admin.<domain> means setting both to '/'.
    <BrowserRouter basename="/admin">
      <AdminAuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          <Route
            element={
              <RequireAdmin>
                <AdminShell />
              </RequireAdmin>
            }
          >
            <Route index element={<Landing />} />
            <Route path="/dashboard" element={<Gate need="users.read"><DashboardPage /></Gate>} />
            <Route path="/users" element={<Gate need="users.read"><UsersPage /></Gate>} />
            <Route path="/users/:userId" element={<Gate need="users.read"><UserDetailPage /></Gate>} />
            {/*
              One user's day-by-day record and his points ledger. `users.read` and not a new
              permission: every role that holds it also holds `progress.read`, which is what
              the three views behind this page are gated on in RLS, so the route gate and the
              data gate agree without inventing a name. §23 and §24 of the brief ask for this
              to be auditable, and the ledger is append-only with no update path for anyone.
            */}
            <Route
              path="/users/:userId/activity"
              element={<Gate need="users.read"><UserActivityPage /></Gate>}
            />
            <Route path="/darshan" element={<Gate need="darshan.read"><DarshanListPage /></Gate>} />
            <Route path="/darshan/health" element={<Gate need="darshan.read"><DarshanHealthPage /></Gate>} />
            {/* The bulk importer writes to every દ્રશ્ય it names, so it is gated on the
                permission for the *write* rather than on darshan.read like its neighbours —
                a VIEWER holds darshan.read and must not reach a screen whose only purpose
                is a mass edit. Placed beside /darshan/health for the same reason that one
                is here: react-router ranks a static segment above /darshan/:itemId, so this
                is legibility rather than precedence. */}
            <Route path="/darshan/import" element={<Gate need="darshan.update"><DarshanImportPage /></Gate>} />
            <Route path="/darshan/:itemId" element={<Gate need="darshan.read"><DarshanDetailPage /></Gate>} />
            <Route path="/progress" element={<Gate need="progress.read"><ProgressPage /></Gate>} />
            {/*
              One યુવક's લેવલ ૧–૪ record, read from the tables the app actually writes
              (0028). `progress.read` and not `users.read`, unlike /users/:userId next door:
              that page is the account, this one is the સાધના, and the RPC behind it refuses
              without both permissions anyway. Every role holding one of the two holds the
              other, so the two routes admit exactly the same people — naming the permission
              the *data* is gated on is what keeps the route gate and the policy from drifting
              apart the day a role is added.

              Placed directly after /progress because it is that page's row expanded, and it
              competes with nothing for precedence: there is no other /progress/* route.
            */}
            <Route
              path="/progress/:userId"
              element={<Gate need="progress.read"><UserProgressDetailPage /></Gate>}
            />
            <Route path="/sessions" element={<Gate need="sessions.read"><SessionsPage /></Gate>} />
            <Route path="/levels" element={<Gate need="settings.read"><LevelsPage /></Gate>} />
            {/* લેવલ ૪ is a container of sub-levels, and arranging them is a different job from
                deciding which levels exist — /levels stays the availability screen. Both sit
                under settings.read for the reason AdminShell's NAV table gives: the permission
                named is the one that decides whether the page can say anything true, and every
                control that *writes* here is disabled without settings.update and refused by
                the policy behind it. The editor's static /config segment ranks above nothing —
                there is no /levels/:levelId route for it to compete with — so it is placed
                beside its list purely to be read as a pair. */}
            <Route path="/levels/4" element={<Gate need="settings.read"><Level4ListPage /></Gate>} />
            <Route path="/levels/4/config/:configId" element={<Gate need="settings.read"><Level4EditorPage /></Gate>} />
            <Route path="/video" element={<Gate need="settings.read"><VideoPage /></Gate>} />
            {/* The bottom bar of the યુવક app — settings/nav, its own row beside settings/app.
                `settings.read` like the three screens around it, and for the same reason
                AdminShell's NAV table gives: the permission a section names is the one that
                decides whether the page can say anything true, and a VIEWER may read which
                four buttons a યુવક has while settings.update, the RLS policy and the trigger
                in 0019 all refuse the save. Placed between Video and Settings because those
                are the two it is read against — all three configure what the app looks like
                rather than what is in it — and it competes with no other path for
                precedence. */}
            <Route path="/navigation" element={<Gate need="settings.read"><NavigationPage /></Gate>} />
            <Route path="/settings" element={<Gate need="settings.read"><SettingsPage /></Gate>} />
            {/*
              ગુણ — the rules, and what they have paid.

              Six routes and two permissions, because the section really is two things. The
              rule page *configures* `settings['levels'].value.points`, so it names
              `settings.read` like every other screen that edits a settings row; the reporting
              screens read the ledger through 0032's functions, every one of which
              opens with `admin_assert_progress_reader()`, so they name `progress.read`. The
              permission a route names is the one that decides whether the page can say
              anything true — naming a single permission for all of them would give one of the
              two halves a door that opens onto a refusal.

              /points is the rule page rather than an overview that then links to a rule page.
              A સંચાલક who opens this section has come to change what an activity is worth far
              more often than to read a total, and the totals are on the page anyway.

              The five static children are placed above nothing — there is no /points/:id for
              them to compete with — so their order here is only how they are read: the ledger
              is the record, the day is a cut of it, the record is the યુવક's own account of it,
              લેવલ ૩ is one rung of it asked about on its own, and the board is what it all adds
              up to.
            */}
            <Route path="/points" element={<Gate need="settings.read"><PointsPage /></Gate>} />
            <Route path="/points/ledger" element={<Gate need="progress.read"><PointLedgerPage /></Gate>} />
            <Route path="/points/daily" element={<Gate need="progress.read"><DailyActivityPage /></Gate>} />
            <Route path="/points/records" element={<Gate need="progress.read"><DailyRecordsPage /></Gate>} />
            {/* `progress.read` and not a name of its own: `admin_level3_users()` raises
                `level3_report_forbidden` (42501) without exactly that permission, so the route
                gate and the data gate agree without inventing a third spelling. */}
            <Route path="/points/level3" element={<Gate need="progress.read"><Level3Page /></Gate>} />
            <Route path="/points/leaderboard" element={<Gate need="progress.read"><LeaderboardPage /></Gate>} />
            <Route path="/audit-logs" element={<Gate need="audit.read"><AuditLogPage /></Gate>} />
          </Route>

          {/* An unknown path lands on the role's own first section, not on a fixed one that
              half the roles may not open. */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AdminAuthProvider>
    </BrowserRouter>
  );
}

const Lazy = ({ children }) => <Suspense fallback={<PageLoading />}>{children}</Suspense>;

/**
 * §10 — hiding the link in the sidebar is not a guard, because typing the URL never passes
 * a menu. RequireAdmin stays the outer gate ("any role at all"); this is the finer layer
 * inside it, and the permission names are the same ones AdminShell's NAV table carries,
 * read off `public.permissions_for()` in 0004_rbac.sql.
 *
 * The permission is checked *outside* <Lazy>, so a section the role cannot open does not
 * even fetch its chunk — a refusal that still downloads the 124 KB દર્શન manifest would be
 * a strange kind of refusal (§51).
 */
const Gate = ({ need, children }) => (
  <RequirePermission need={need}>
    <Lazy>{children}</Lazy>
  </RequirePermission>
);

/**
 * §13 — where the panel opens.
 *
 * /dashboard was hard-coded here, and the dashboard counts registrations: a CONTENT_MANAGER
 * holds no `users.read`, so opening the panel dropped him straight onto a refusal before he
 * had touched anything. The landing section is the first one his own role can actually use,
 * taken from the same NAV table the sidebar filters, so the menu and the front door cannot
 * disagree. `replace`, so the back button does not bounce off it.
 */
function Landing() {
  const { can } = useAdminAuth();
  const first = NAV.find((n) => can(n.need));
  // Every role in the matrix holds darshan.read, so `first` is always found. The fallback
  // is for the role that gets added later and forgotten: it lands on a page that states the
  // refusal, which is a bug report, rather than on a redirect that loops.
  return <Navigate to={first ? first.to : '/dashboard'} replace />;
}
