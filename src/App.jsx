import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { LearningProvider } from './lib/learning';
import { useSettings, youtubeId } from './lib/useSettings';
import DhunPlayer from './components/DhunPlayer';
import Register from './pages/Register';
import Login from './pages/Login';
import EntryGate from './pages/EntryGate';
import Home from './pages/Home';

/**
 * દર્શન is loaded on demand. It pulls in content/darshan.json — 124 KB describing every
 * image variant — which has no business being in the bundle a yuvak downloads just to
 * reach the login screen. §14 asks the app to work on slow networks.
 */
const DarshanPage = lazy(() => import('./modules/darshan/DarshanPage'));

/**
 * The guided journey, split out for the same reason as દર્શન: it pulls in the scene
 * metadata, which a yuvak sitting on the login screen has no use for yet.
 */
const LearningPage = lazy(() => import('./modules/learning/LearningPage'));

/**
 * લેવલ ૩ અને લેવલ ૪ (§7) — the daily સાધના itself.
 *
 * Lazy for the same reason as the two above: it reads useScenes(), and so pulls in
 * content/darshan.json. Both routes share one chunk because they share one component —
 * a યુવક who reaches લેવલ ૪ has certainly already loaded લેવલ ૩.
 */
const LevelPage = lazy(() => import('./modules/levels/LevelPage'));

function Loading() {
  return (
    <div className="spinner-page">
      <span className="dot" />
      <span className="dot" />
      <span className="dot" />
    </div>
  );
}

/**
 * Shown when VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY is missing from the build.
 *
 * This used to be a blank white page: the client was constructed during module evaluation
 * and threw before React existed, so nothing could report it. It is built lazily now, and
 * AuthProvider raises `unconfigured` from the environment without touching the client.
 *
 * Worded for the yuvak, not the developer — §1 forbids leaving him at a dead end, and a
 * stack trace is not something he can act on. The real diagnosis goes to the console, for
 * whoever deployed it.
 */
function ConfigNotice() {
  return (
    <div className="page">
      <div className="notice warn">
        એપ્લિકેશન હજુ પૂરી ગોઠવાઈ નથી. થોડી વાર પછી ફરી ખોલો, અથવા સંચાલકને જણાવો.
      </div>
    </div>
  );
}

/**
 * Three-state guard (§5, §6):
 *   not signed in            → /login
 *   signed in, gate not done → /welcome
 *   signed in, gate done     → the requested page
 */
function Guarded({ children }) {
  const { user, profile, loading, unconfigured } = useAuth();
  const loc = useLocation();

  if (unconfigured) return <ConfigNotice />;
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (profile && !profile.gate_passed_at) return <Navigate to="/welcome" replace />;
  return children;
}

/** Signed-in users should never sit on the login or registration pages. */
function PublicOnly({ children }) {
  const { user, loading, unconfigured } = useAuth();
  if (unconfigured) return <ConfigNotice />;
  if (loading) return <Loading />;
  if (user) return <Navigate to="/" replace />;
  return children;
}

/**
 * દર્શન sits behind the login guard, as the spec requires.
 *
 * `VITE_PUBLIC_DARSHAN=1` lifts that guard for one purpose only: the image-delivery
 * regression suite (scripts/verify-loading.mjs), which proves the 25 MB → 0.27 MB fix
 * still holds. Those checks are about bytes on the wire, not about auth, and they must
 * keep running before a Supabase sign-in exists. Never set this flag on a real deploy.
 */
function DarshanGate({ children }) {
  if (import.meta.env.VITE_PUBLIC_DARSHAN === '1') return children;
  return <Guarded>{children}</Guarded>;
}

/**
 * §5/§6 — the પ્રવેશદ્વાર, and afterwards the way back to the video.
 *
 * Passing the gate used to bounce a yuvak home from here for good, which made the intro
 * video unreachable the moment he answered the two questions: watched once, never again.
 * The gate is what is asked once — not the દર્શન. So a yuvak who has already passed still
 * gets this page, in replay mode: the video, without the questions he has answered.
 */
function GateRoute() {
  const { user, profile, loading, unconfigured } = useAuth();
  const { settings, loading: sLoading } = useSettings();

  if (unconfigured) return <ConfigNotice />;
  if (loading || sLoading) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;

  return (
    <EntryGate
      videoId={youtubeId(settings?.youtubeUrl)}
      replay={Boolean(profile?.gate_passed_at)}
    />
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
          <Route path="/register" element={<PublicOnly><Register /></PublicOnly>} />
          <Route path="/welcome" element={<GateRoute />} />

          <Route path="/" element={<Guarded><Home /></Guarded>} />
          <Route
            path="/darshan"
            element={
              <DarshanGate>
                <Suspense fallback={<Loading />}>
                  <DarshanPage />
                </Suspense>
              </DarshanGate>
            }
          />

          {/*
            §7 — the two levels that are ticked and counted.

            A route each, unlike the guided journey below, because these are not stages of
            one flow: they are two places a યુવક chooses between from the home page, every
            day, for as long as he does the સાધના. Nothing about the URL grants anything —
            લેવલ ૪'s lock is `profiles.level4_unlocked`, read inside the page, so typing
            /level/4 early shows the invitation rather than the level (and rather than a
            redirect, which would answer a question he did not ask).
          */}
          <Route
            path="/level/3"
            element={
              <Guarded>
                <Suspense fallback={<Loading />}>
                  <LevelPage level={3} />
                </Suspense>
              </Guarded>
            }
          />
          <Route
            path="/level/4"
            element={
              <Guarded>
                <Suspense fallback={<Loading />}>
                  <LevelPage level={4} />
                </Suspense>
              </Guarded>
            }
          />

          {/*
            One route for the whole journey. The stage lives in the yuvak's progress
            document, not in the URL, so resuming works across devices and no stage can
            be reached by typing a path (§22, §23).
          */}
          <Route
            path="/learn"
            element={
              <Guarded>
                <LearningProvider>
                  <Suspense fallback={<Loading />}>
                    <LearningPage />
                  </Suspense>
                </LearningProvider>
              </Guarded>
            }
          />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>

        {/*
          §8 — the ધૂન, mounted beside <Routes> rather than inside one of them.

          That placement is the requirement, not a tidiness choice. §8 asks that the dhun
          "સળંગ વાગ્યા કરે જેથી ધ્યાન તૂટે નહીં" — it loops without a break — and a player
          rendered inside a route unmounts on every navigation, taking its <audio> with it.
          The dhun would then stop the moment the yuvak left the દર્શન feed for the home
          page, which is exactly the break the spec forbids. Here it is mounted once and
          lives as long as the tab does.

          It renders nothing at all until a yuvak is signed in and the સંચાલક has actually
          uploaded a dhun, so the login screen and today's no-dhun-yet state cost one small
          settings read and not a byte of audio. Preloading is off; see DhunPlayer.jsx.
        */}
        <DhunPlayer />
      </AuthProvider>
    </BrowserRouter>
  );
}
