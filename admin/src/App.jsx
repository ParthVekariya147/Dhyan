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
const DarshanListPage = lazy(() => import('./features/darshan/pages/DarshanListPage'));
const DarshanHealthPage = lazy(() => import('./features/darshan/pages/DarshanHealthPage'));
const DarshanImportPage = lazy(() => import('./features/darshan/pages/DarshanImportPage'));
const DarshanDetailPage = lazy(() => import('./features/darshan/pages/DarshanDetailPage'));
const ProgressPage = lazy(() => import('./features/progress/pages/ProgressPage'));
const SessionsPage = lazy(() => import('./features/sessions/pages/SessionsPage'));
const LevelsPage = lazy(() => import('./features/levels/pages/LevelsPage'));
const VideoPage = lazy(() => import('./features/video/pages/VideoPage'));
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
            <Route path="/sessions" element={<Gate need="sessions.read"><SessionsPage /></Gate>} />
            <Route path="/levels" element={<Gate need="settings.read"><LevelsPage /></Gate>} />
            <Route path="/video" element={<Gate need="settings.read"><VideoPage /></Gate>} />
            <Route path="/settings" element={<Gate need="settings.read"><SettingsPage /></Gate>} />
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
