import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { useSettings, youtubeId } from './lib/useSettings';
import { guardRoute, resolveEntryRoute } from './lib/entryRoute';
import DhunPlayer from './components/DhunPlayer';
import InstallPrompt from './components/InstallPrompt';
import AppShell from './components/AppShell';
import Register from './pages/Register';
import Login from './pages/Login';
import EntryGate from './pages/EntryGate';

/**
 * The મુખપૃષ્ઠ, on demand — and this became true the day §4 changed which page is first.
 *
 * It was imported eagerly for one stated reason: "it is where a યુવક lands after signing
 * in". That is no longer the shape of a first visit. A visitor who opens the URL with no
 * session is shown નોંધણી, registers, and goes straight to લેવલ ૧ (§5, §6, §22) — the
 * મુખપૃષ્ઠ is not on that path at all. Keeping it eager meant every one of those first
 * visits paid, before seeing a single field, for a page he would not reach that day:
 * shared/domain/journey.js's ten page descriptions, useLevels(), and the લેવલ ૪ gate
 * resolver. The same argument the four screens below have always made.
 *
 * A returning યુવક usually resumes at a level rather than here, and when he does land here
 * the chunk arrives while auth is still resolving — so in practice nobody waits for it.
 */
const Home = lazy(() => import('./pages/Home'));

/**
 * પાસવર્ડ રીકવરી — both screens lazy, unlike લોગિન and નોંધણી beside them.
 *
 * The two auth pages above are eager because they are where a visit *starts*: a first visitor
 * sees નોંધણી and a returning one sees લોગિન, so a chunk boundary there is a wait every session
 * pays. These two are the opposite case. A યુવક reaches them once, if ever, and reaches them by
 * tapping a link he is already looking at or by opening a mail - in both cases from a page that
 * has been on screen long enough for a chunk to arrive unnoticed.
 *
 * They are also the only pages that pull shared/domain/recovery.js. Keeping that module out of
 * the entry bundle is the same discipline the rest of this file follows, and it has the same
 * side benefit: if a future edit reached for the recovery validators from a page that has no
 * business with them, it would appear in the build as a new import rather than as nothing.
 */
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));

/**
 * The guided journey's context, lazy — and this one line is worth more than every other lazy
 * import in this file put together.
 *
 * It was a static import at the top, beside AuthProvider, because it is a *provider*: it wraps
 * the `/learn` route below rather than being routed to. That reads as harmless and was not.
 * `src/lib/learning.jsx` imports `./scenes`, and `src/lib/scenes.js` line 12 is
 *
 *     import data from '../../content/darshan.json';
 *
 * — a 59 KB static import describing every image variant of every દ્રશ્ય. A static import
 * cannot be code-split, so it landed in the entry chunk, and the entry chunk is what a visitor
 * downloads to see the નોંધણી form. `npm run verify:separation` has been failing on exactly
 * this ("યુવક entry chunk is app code only — 121 KB"), and §14 asks the app to work on slow
 * networks: this was ~90 KB of image metadata in front of the login field, for a route that
 * visitor may never open.
 *
 * Every page comment above already gives this reason for being lazy. Nine of them were true;
 * this import quietly made all nine pointless, because the manifest arrived in the entry chunk
 * regardless of which page pulled it.
 *
 * Moved inside the <Suspense> below rather than kept out here as a second boundary: the
 * provider and the page are one chunk's worth of work and one waiting state — a યુવક opening
 * `/learn` waits once, for both.
 */
const LearningProvider = lazy(() =>
  import('./lib/learning').then((m) => ({ default: m.LearningProvider }))
);

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
 * લેવલ ૩ (§7) — the daily સાધના itself.
 *
 * Lazy for the same reason as the two above: it reads useScenes(), and so pulls in
 * content/darshan.json. It used to serve લેવલ ૪ as well, from the same chunk; લેવલ ૪ is now
 * a container of પ્રવૃત્તિઓ rather than a variant of this list, and has its own pages below.
 */
const LevelPage = lazy(() => import('./modules/levels/LevelPage'));

/**
 * લેવલ ૪ — three screens, three chunks, and lazy for the same reason as everything else
 * here: they read useScenes() for the printed numbers, and a યુવક on the login screen has
 * no use for content/darshan.json yet (§14, slow networks).
 *
 * Split three ways rather than bundled as one, because they are not one journey through
 * the same bytes: the list is what a યુવક opens every day, the test is what he opens when
 * he sits down to it, and the revision — the only one of the three that carries images —
 * is what he opens when he needs to look again. Loading the image screen to read the list
 * would be paying for the pictures લેવલ ૪ exists to do without.
 */
const Level4Page = lazy(() => import('./modules/level4/Level4Page'));
const ActivityTestPage = lazy(() => import('./modules/level4/ActivityTestPage'));
const RevisionPage = lazy(() => import('./modules/level4/RevisionPage'));

/**
 * મારું — the fourth button of the default bottom bar, and lazy for the same reason as
 * every screen above it.
 *
 * It is a small page and its chunk is small, which is precisely the argument: a visitor who
 * opens the URL with no session sees નોંધણી, and nothing about that path needs a screen
 * that reads a `profiles` row he does not have yet. The chunk arrives when he presses the
 * button, by which time the app has been on screen for however long it took him to get
 * there.
 *
 * It exists because DEFAULT_MOBILE_NAV puts `profile` in the bar every project gets, and
 * NAV_REGISTRY marks that key `ready: true` — which is a claim about THIS FILE. `ready` is
 * not an opinion anybody may hold (shared/domain/navigation.js), so the claim had to be
 * made true here rather than argued with there.
 */
const Profile = lazy(() => import('./pages/Profile'));

/**
 * મારી પ્રગતિ — lazy, and the reason is the sharpest one on this list.
 *
 * This is the only screen in the app that reads history at all, and §27 is explicit that the
 * મુખપૃષ્ઠ must not: home loads today's progress, the unlock state and today's point summary,
 * and nothing else. Making the chunk lazy is what turns that from a rule somebody has to keep
 * in mind into a property of the build — `src/lib/history.js`'s two hooks are reachable from
 * this chunk and from no other, so a future edit that pulled a day of history onto the home
 * page would have to import them there and would be visible in the bundle the moment it did.
 *
 * It also carries no scene content: history rows arrive with the totals the server recorded at
 * the time of the attempt, so this chunk does not pull content/darshan.json the way સેટિંગ and
 * the levels do. A day that read ૮૨/૧૦૮ goes on reading ૮૨/૧૦૮ after the collection grows.
 */
const History = lazy(() => import('./pages/History'));

/**
 * ક્રમાંક — lazy, and here the reason is about what the chunk contains rather than its size.
 *
 * This is the one screen in the app that shows a યુવક another યુવક's name, and everything that
 * makes that narrow — the period resolver, the shape the rows are stripped to — lives in the
 * module this chunk pulls. Keeping it out of the entry bundle means the code that reads other
 * people is not downloaded by somebody who never opens the page, and, more usefully, that any
 * future edit which reached for it from a page that should not have it would show up in the
 * build as a new import rather than as nothing at all.
 *
 * A યુવક whose સંચાલક has left the board switched off still gets this chunk if he opens the
 * route, and it renders a sentence saying so. That is deliberate: the alternative is a route
 * that 404s depending on a settings row, which reads as a broken app rather than a feature
 * nobody turned on.
 */
const Leaderboard = lazy(() => import('./pages/Leaderboard'));

/**
 * સેટિંગ — the યુવક's own આપોઆપ speed, and lazy for a reason of its own on top of the ones
 * above.
 *
 * It reads useScenes(), because every minute total on it is `seconds × the size of the
 * collection` and that size is counted rather than typed (§62) — so this chunk carries
 * content/darshan.json exactly as દર્શન and the levels do. A screen a યુવક opens once, to set
 * one number he then never sets again, has no business putting 124 KB of image metadata in
 * front of the login form.
 *
 * NAV_REGISTRY marks `settings` `ready: true`, which is a claim about THIS FILE and nothing
 * else. scripts/test-navigation.mjs reads App.jsx as text and asserts both directions of it —
 * every ready route routed, and no not-ready route quietly shipped — so the claim is checked
 * rather than remembered. The bar does not carry સેટિંગ by default all the same: it is reached
 * from મારું, where a યુવક looks for it, and whether it also stands in the bar remains the
 * સંચાલક's to decide.
 */
const Settings = lazy(() => import('./pages/Settings'));

/**
 * §13 — the auth-initialisation state.
 *
 * Three things it must not be: a blank screen, an infinite spinner, or a flicker. It was
 * the first of those, and not by accident — the markup was three bare `.dot` spans, and
 * `.dot` is defined in levels.css and darshan.css, neither of which exists in the bundle
 * while auth is still resolving. So a યુવક opening the app saw nothing at all until
 * Supabase answered. The dots now live in forms.css, which every eager page imports, and
 * a line of Gujarati says what is happening — because two seconds of silence on a weak
 * signal is indistinguishable from a broken app.
 *
 * It is bounded by construction rather than by a timeout: AuthProvider clears `loading`
 * on every path through getSession() and onAuthStateChange, including the failures, so
 * there is no state in which this renders forever.
 */
function Loading({ label = 'એક ક્ષણ…' }) {
  return (
    <div className="spinner-page is-auth" role="status" aria-live="polite">
      <span className="spinner-dots" aria-hidden="true">
        <span className="dot" />
        <span className="dot" />
        <span className="dot" />
      </span>
      <span>{label}</span>
    </div>
  );
}

/*
  <RouteMemory> stood here — one effect beside <Routes> that recorded the last level front
  door this યુવક stood at, for §7's "resume where he was". Signing in lands on the મુખપૃષ્ઠ
  now, so the only reader of that record is gone and the writer went with it.
*/

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
 * The guard for every protected page (§10, §11, §12).
 *
 * It decides nothing itself. `guardRoute()` in shared/domain/entry-route.js holds the
 * whole rule — that is the point of §10, and the reason the four scattered conditions
 * that used to live in this file are gone. This component's entire job is: wait until the
 * answer is knowable, ask for it once, and render either the page or one redirect.
 *
 * "Knowable" is `loading`, and it covers the session AND the profile (see AuthProvider).
 * Asking before then is what produced the flicker §13 forbids: a refresh on /level/4 with
 * a half-known યુવક answers "લેવલ ૧", and a moment later answers "/level/4" again.
 *
 * `state.from` is carried on the redirect so the લોગિન page can send him back to the page
 * he actually asked for — a refresh on /level/4 that finds an expired session should not
 * cost him his place (§12).
 */
function Guarded({ children }) {
  const { user, profile, profileError, loading, unconfigured } = useAuth();
  const loc = useLocation();

  if (unconfigured) return <ConfigNotice />;
  if (loading) return <Loading />;

  const { allow, to } = guardRoute({ path: loc.pathname, user, profile, profileError });
  if (allow) return children;

  /*
    `replace`, always, on every redirect in this file.

    §16 — a યુવક who is bounced from / to /register, registers, and lands on the મુખપૃષ્ઠ
    must be able to press back without being walked through that bounce in reverse. A
    pushed redirect leaves both the page he could not see and the page he was sent to in
    the history, so back returns to the guard, which redirects forward again — the loop
    §16 describes. Replacing means the entry redirects were never there.
  */
  return <Navigate to={to} replace state={{ from: loc.pathname }} />;
}

/**
 * લોગિન and નોંધણી — the two pages a signed-in યુવક must never see (§22).
 *
 * The destination is resolveEntryRoute()'s, not a hard-coded '/'. That is what removes
 * the second hop of §15: a યુવક who has not passed the પ્રવેશદ્વાર used to be sent to the
 * મુખપૃષ્ઠ here and immediately onward to /welcome by the guard above, so he saw a page he
 * was not entitled to for one frame on the way past.
 *
 * `registering` holds this still for the few hundred milliseconds in which a new account
 * has a session but not yet a profile row — see AuthProvider. Without it this guard fires
 * mid-registration and unmounts the નોંધણી page while its profile insert is still in
 * flight, taking the error handling for a duplicate SMK with it.
 */
function PublicOnly({ children }) {
  const { user, profile, profileError, loading, registering, unconfigured } = useAuth();
  if (unconfigured) return <ConfigNotice />;
  if (loading) return <Loading />;
  if (registering) return children;
  if (user) {
    const to = resolveEntryRoute({ user, profile, profileError });
    return <Navigate to={to} replace />;
  }
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
  const { user, profile, profileError, loading, unconfigured } = useAuth();
  const { settings, loading: sLoading } = useSettings();
  const loc = useLocation();

  if (unconfigured) return <ConfigNotice />;
  if (loading || sLoading) return <Loading />;

  // The same centralized decision as everywhere else (§10). guardRoute() now refuses only
  // the unauthenticated — the hold at લેવલ ૧ is gone, so a signed-in યુવક reaches this
  // page whenever he asks for it. Still routed through the one function that knows, rather
  // than re-stating half the rule here.
  const { allow, to } = guardRoute({ path: loc.pathname, user, profile, profileError });
  if (!allow) return <Navigate to={to} replace state={{ from: loc.pathname }} />;

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

          {/*
            ────────────────────────────────────────────────────────────────────
            પાસવર્ડ રીકવરી — two public routes, and they are public for different reasons.
            ────────────────────────────────────────────────────────────────────

            §17 — both must open without a session, and nothing else in this file changes.
            The levels, the દર્શન, મારી પ્રગતિ and the panel keep the guards they had; adding a
            reset flow must not be the commit that quietly widens anything.

            /forgot-password is wrapped in <PublicOnly>, exactly like લોગિન and નોંધણી: a
            signed-in યુવક has no use for it and would be typing an address to receive a mail
            he does not need. It sends him to his entry route instead.

            /reset-password is NOT wrapped, and that is deliberate rather than an oversight.
            Supabase opens a recovery SESSION when it verifies the link, so by the time this
            page renders the visitor IS signed in — <PublicOnly> would bounce him to the
            મુખપૃષ્ઠ at the exact moment he arrived to change his password, and the link would
            be consumed with nothing done. The page therefore carries its own gate, and it is
            a stronger one than a route wrapper could be: it opens the form only for a
            recovery session, and the update it performs is bound to that session by Supabase
            rather than by anything this router could assert.

            Both sit outside <AppShell>, with લોગિન and નોંધણી, for the reason stated below:
            the bottom bar offers destinations that need a session, and drawing it around a
            recovery screen would hand a visitor five links that bounce him back here.
          */}
          <Route
            path="/forgot-password"
            element={
              <PublicOnly>
                <Suspense fallback={<Loading />}>
                  <ForgotPassword />
                </Suspense>
              </PublicOnly>
            }
          />
          <Route
            path="/reset-password"
            element={
              <Suspense fallback={<Loading />}>
                <ResetPassword />
              </Suspense>
            }
          />

          <Route path="/welcome" element={<GateRoute />} />

          {/*
            ────────────────────────────────────────────────────────────────────
            §15 — the pages that stand inside the app, and therefore inside the shell.
            ────────────────────────────────────────────────────────────────────

            <AppShell /> draws the phone's bottom bar under whatever is nested here. It is a
            layout route rather than a wrapper repeated around each element below, and
            rather than a check inside the shell, and those are two separate decisions:

              * A wrapper per route is six chances to forget the seventh, and the forgetting
                is invisible — a page without the bar simply has no way out of itself on a
                phone, which nobody notices on a desktop.
              * A path denylist INSIDE the shell ("no bar on /login, /register, /welcome")
                would be a second, private copy of the answer to "which routes need a
                session", when <Guarded> two lines down already answers it. Two copies of
                one rule drift, and this pair drifts in the direction that hurts: a public
                route added later gets a bar offering five destinations that will bounce the
                visitor straight back to લોગિન — the dead end §1 forbids, dressed up as
                navigation.

            So the three routes above are declared as siblings, outside, and everything a
            યુવક may only reach with a session is nested below. The nesting IS the rule.
            Nothing in AppShell.jsx knows a single path.

            The catch-all stays outside too: it renders a redirect, not a page, and a bar
            drawn for the width of one frame around a <Navigate> is a bar that flashes.
          */}
          <Route element={<AppShell />}>
            <Route
              path="/"
              element={
                <Guarded>
                  <Suspense fallback={<Loading />}>
                    <Home />
                  </Suspense>
                </Guarded>
              }
            />
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
              લેવલ ૪'s gate and the order of its પ્રવૃત્તિઓ are read inside the pages, from the
              published configuration, so typing a લેવલ ૪ path early shows the invitation
              rather than the level (and rather than a redirect, which would answer a question
              he did not ask). The server re-checks all of it in `level4_submit` regardless:
              a URL has never been permission here (§37).
            */}
            <Route
              path="/level/3"
              element={
                <Guarded>
                  <Suspense fallback={<Loading />}>
                    <LevelPage />
                  </Suspense>
                </Guarded>
              }
            />

            {/*
              લેવલ ૪, in three paths and no more (§42): the list, one પ્રવૃત્તિ's test, and that
              પ્રવૃત્તિ's દર્શન. There is deliberately no route per sub-level — ૪.૧ and ૪.૭ are
              rows of one table the સંચાલક edits, and a path shaped like /level/4.1 would turn
              his data into this file's business every time he published a new one.
            */}
            <Route
              path="/level/4"
              element={
                <Guarded>
                  <Suspense fallback={<Loading />}>
                    <Level4Page />
                  </Suspense>
                </Guarded>
              }
            />
            <Route
              path="/level/4/:activityId"
              element={
                <Guarded>
                  <Suspense fallback={<Loading />}>
                    <ActivityTestPage />
                  </Suspense>
                </Guarded>
              }
            />
            <Route
              path="/level/4/:activityId/revision"
              element={
                <Guarded>
                  <Suspense fallback={<Loading />}>
                    <RevisionPage />
                  </Suspense>
                </Guarded>
              }
            />

            {/*
              મારું — where the bar's `profile` key goes, and the route NAV_REGISTRY's
              `ready: true` is a statement about. It writes nothing: points, streaks and
              ક્રમાંક are a separate piece of work, which is why the registry carries
              `leaderboard` as a placeholder no configuration can switch on.
            */}
            <Route
              path="/profile"
              element={
                <Guarded>
                  <Suspense fallback={<Loading />}>
                    <Profile />
                  </Suspense>
                </Guarded>
              }
            />

            {/*
              મારી પ્રગતિ — every day a યુવક has done, and what each one earned.

              Inside the shell, so it keeps the bottom bar: this is a page he arrives at from
              that bar and leaves the same way, and a screen without it would strand him at the
              bottom of a list of days. <Guarded> and nothing more — the three views behind it
              are RLS-limited to `auth.uid()`, so the session this already requires *is* the
              authorisation, and a second check here would be a weaker copy of the one that
              actually holds (§13, §30).

              Nothing on this page can be reached by typing a path that another યુવક's data
              would answer: there is no :userId segment, deliberately. The સંચાલક's per-user
              view is a different page in a different app, gated on `users.read`.
            */}
            <Route
              path="/history"
              element={
                <Guarded>
                  <Suspense fallback={<Loading />}>
                    <History />
                  </Suspense>
                </Guarded>
              }
            />

            {/*
              ક્રમાંક — the board, and the only route in this app that reads other યુવકો.

              <Guarded> and nothing more, exactly like /history, but the reasoning underneath
              is different and worth stating here rather than only in the migration. /history
              needs no further check because RLS limits its views to `auth.uid()`. This page
              cannot be protected that way — its whole purpose is to read past that line — so
              the protection is inside `public.leaderboard()` instead: it is the single
              SECURITY DEFINER aperture, it returns a name and a total and no identifier of any
              kind, it lists only યુવકો who have earned something, and it returns an empty
              board until the સંચાલક switches it on. No RLS policy anywhere was widened to make
              this page work.

              There is no :userId here and there must never be one. A path parameter would turn
              a ranking into a lookup, which is the thing §13 refuses.
            */}
            <Route
              path="/leaderboard"
              element={
                <Guarded>
                  <Suspense fallback={<Loading />}>
                    <Leaderboard />
                  </Suspense>
                </Guarded>
              }
            />

            {/*
              સેટિંગ — reached from મારું, and inside the shell like every other page a
              signed-in યુવક stands on. It writes nothing to the server: the one thing it
              persists is a number in this browser's localStorage (src/lib/useViewingSpeed.js
              says why the handset and not the `profiles` row), so there is no permission
              question here beyond the session <Guarded> already requires.
            */}
            <Route
              path="/settings"
              element={
                <Guarded>
                  <Suspense fallback={<Loading />}>
                    <Settings />
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
                  <Suspense fallback={<Loading />}>
                    <LearningProvider>
                      <LearningPage />
                    </LearningProvider>
                  </Suspense>
                </Guarded>
              }
            />
          </Route>

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

        {/*
          "એપ્લિકેશન ઇન્સ્ટોલ કરો" — beside the ધૂન and outside <Routes>, for one of the same
          reasons and one of its own.

          The same reason: it must survive navigation. Chrome hands over `beforeinstallprompt`
          once per visit and at a moment of its choosing; a component that unmounted on every
          route change could be gone at exactly that moment, and the offer with it.

          Its own: the invitation is about the app, not about any page in it, so no page owns
          it. Mounting it here also means it is asked equally of a યુવક who opens straight to
          લોગિન and one who resumes at લેવલ ૩ — which is what "as soon as the app starts" has
          to mean in an app whose first screen depends on who is opening it.

          It renders null unless there is something to offer: already installed, already
          dismissed, or a browser that cannot install all produce no markup at all. The
          import is eager because a lazy chunk would arrive after the event it exists to
          catch; it carries no data and pulls nothing but its own stylesheet.
        */}
        <InstallPrompt />
      </AuthProvider>
    </BrowserRouter>
  );
}
