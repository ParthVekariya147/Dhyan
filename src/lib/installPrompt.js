/**
 * "એપ્લિકેશન ઇન્સ્ટોલ કરો" — the state behind the invitation, held OUTSIDE React.
 *
 * The reason it lives here and not in a component is timing. Chrome fires
 * `beforeinstallprompt` once, on its own schedule, and the event object it hands over is
 * the ONLY way to open the install sheet later - `prompt()` may not be called from a
 * fresh event we construct, and there is no API to ask "may I install?" afterwards. So
 * the listener has to be attached at module evaluation, before React has mounted
 * anything, and the event has to be kept somewhere a later render can reach. A listener
 * inside useEffect would be attached a frame or two too late on a fast load and the
 * event would be gone with nothing to show for it.
 *
 * The site has been installable this whole time - vite.config.js publishes the manifest
 * and the worker - but Chrome only raises its own banner when its engagement heuristics
 * are satisfied, which for a યુવક who opens the app once a day may be never. Nothing was
 * broken; nobody was ever asked. This module is the asking.
 */

const listeners = new Set();

/** The captured event. Single use: once `prompt()` is called it is spent. */
let deferred = null;

/** Set by `appinstalled`, so the dialog closes the moment the install succeeds. */
let installed = false;

/**
 * Already installed?
 *
 * Three readings, because no single one covers every platform: the standard display-mode
 * query (Chrome, Edge, Android), Safari's own `navigator.standalone` (iOS, which does not
 * implement display-mode), and the android-app:// referrer left by a TWA launch.
 *
 * All three answer "is this window the installed app", which is not quite the question we
 * want ("is it installed anywhere on this phone") - see the iOS note under `readLater()`.
 * On Chrome the difference does not matter, because `beforeinstallprompt` simply never
 * fires for an app that is already installed, whichever window is asking.
 */
export function isStandalone() {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)')?.matches === true ||
    window.navigator.standalone === true ||
    document.referrer.startsWith('android-app://')
  );
}

/**
 * iOS, including an iPad that reports itself as a Mac.
 *
 * iPadOS 13 changed the user agent to the desktop Safari string, so the `MacIntel` +
 * touch-points pair is the standard way back. Every browser on iOS is WebKit and every
 * one of them offers "Add to Home Screen" from the share menu, so this covers Chrome and
 * Edge on iOS as well as Safari - which is why the check is for the platform and not for
 * Safari.
 */
export function isIos() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

/* ────────────────────────────────────────────────────────────────────────────
   "પછી" — where a dismissal is remembered, and for how long
   ────────────────────────────────────────────────────────────────────────────
   Two storages, because the two platforms give us different amounts of truth.

   Where `beforeinstallprompt` exists, installing is self-limiting: the event stops
   firing once the app is on the home screen, so the invitation disappears by itself and
   a dismissal only has to last the session. sessionStorage, therefore - close the tab,
   open it tomorrow, and he is asked once more.

   On iOS nothing reports whether the app is installed while he is looking at Safari.
   A યુવક who installed it in March and still opens the site from a bookmark would meet
   the same instructions every single time, forever, with no way to say "I have done
   this". So there his "પછી" is kept for a fortnight. */
const SESSION_KEY = 'dhyan.install.later';
const IOS_KEY = 'dhyan.install.later.until';
const IOS_QUIET_MS = 14 * 24 * 60 * 60 * 1000;

function readLater() {
  try {
    if (isIos()) {
      const until = Number(window.localStorage.getItem(IOS_KEY) || 0);
      return Number.isFinite(until) && until > Date.now();
    }
    return window.sessionStorage.getItem(SESSION_KEY) === '1';
  } catch {
    // Private mode, or storage disabled. Not being able to remember a dismissal is not a
    // reason to fail; the worst case is being asked again, which is where we started.
    return false;
  }
}

/** Records the "પછી" and tells every subscriber, so the dialog closes. */
export function dismissInstall() {
  try {
    if (isIos()) window.localStorage.setItem(IOS_KEY, String(Date.now() + IOS_QUIET_MS));
    else window.sessionStorage.setItem(SESSION_KEY, '1');
  } catch {
    /* see readLater() */
  }
  emit();
}

/* ────────────────────────────────────────────────────────────────────────────
   The snapshot
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * `useSyncExternalStore` compares snapshots by identity and re-renders forever if a new
 * object comes back every read, so the snapshot is built once per change and cached.
 *
 *   'prompt' — the event is in hand; the button opens the real install sheet
 *   'ios'    — no event exists on this platform; the dialog explains the share menu
 *   'none'   — installed, dismissed, or a browser that cannot install at all
 */
let snapshot = { mode: 'none' };

function compute() {
  if (installed || isStandalone()) return 'none';
  if (readLater()) return 'none';
  if (deferred) return 'prompt';
  if (isIos()) return 'ios';
  return 'none';
}

function emit() {
  const mode = compute();
  if (mode !== snapshot.mode) snapshot = { mode };
  listeners.forEach((fn) => fn());
}

export function subscribeInstall(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getInstallState() {
  return snapshot;
}

/** The server/prerender snapshot. Constant, so hydration never disagrees. */
const SERVER_STATE = { mode: 'none' };
export function getInstallServerState() {
  return SERVER_STATE;
}

/**
 * Opens Chrome's install sheet and reports what he chose.
 *
 * `deferred` is cleared BEFORE prompting rather than after, and that ordering is the
 * whole safety of this function: the event is single-use, and a second `prompt()` on a
 * spent event throws. Clearing first means a double tap on a slow phone cannot reach it
 * twice. Chrome re-fires `beforeinstallprompt` on the next visit if he declined, so
 * nothing is permanently lost by throwing our copy away.
 */
export async function promptInstall() {
  const evt = deferred;
  if (!evt) return 'unavailable';
  deferred = null;
  emit();
  try {
    await evt.prompt();
    const { outcome } = await evt.userChoice;
    return outcome; // 'accepted' | 'dismissed'
  } catch {
    return 'unavailable';
  }
}

/* ────────────────────────────────────────────────────────────────────────────
   The listeners — attached at import, which is the point of this module
   ──────────────────────────────────────────────────────────────────────────── */
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    // Without preventDefault() Chrome shows its own mini-infobar and ours would be the
    // second thing on screen saying the same sentence.
    e.preventDefault();
    deferred = e;
    emit();
  });

  window.addEventListener('appinstalled', () => {
    deferred = null;
    installed = true;
    emit();
  });

  snapshot = { mode: compute() };
}
