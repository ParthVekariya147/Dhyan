import { useEffect, useMemo, useState } from 'react';
import { supabase } from './supabase';
import { isSupabaseConfigured, supabaseConfigFromEnv } from '../../shared/supabase/client.js';
import { APP_SETTINGS_DOC } from '../../shared/domain/settings.js';
import { APP_ICON_KEY, appIconLinks, resolveAppIcon } from '../../shared/domain/appicon.js';
import {
  SESSION_KEY,
  SESSION_STARTED_KEY,
  resolveSessionPolicy,
  sessionExpired,
} from '../../shared/domain/session.js';

/**
 * The two things about the app that are true of the whole app rather than of any page in it:
 * the mark it wears, and how long one સેશન is allowed to last.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why these two live in one module
 * ────────────────────────────────────────────────────────────────────────────
 *
 * They look unrelated and they are the same problem seen from two ends. Everyone in the સંઘ
 * has added ધ્યાન to a home screen, and an installed PWA is not a browser tab: it is opened
 * and closed for weeks without ever being *loaded*. So the icon on that home screen is
 * whichever bitmap iOS copied at Add-to-Home-Screen, and the JavaScript behind it is whatever
 * the service worker precached on the last real load - possibly in June.
 *
 * `useAppIcon()` is what a page can still fix: the tab icon and the bitmap the NEXT install
 * will copy. `useSessionExpiry()` is what makes a real load happen again at all, which is the
 * only thing that fixes anything else. Both read one row - `settings['app']` - and neither
 * has a page it belongs to, so both are mounted once, at the root, in src/App.jsx.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why this reads the row itself instead of calling useSettings.js
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `useSettingsRow()` there is private and its public wrappers each return one resolved shape;
 * exporting a third and a fourth from that file would put two more shell concerns into a
 * module every page imports. The read below is deliberately the SAME read, character for
 * character in the parts that matter - the `configured` guard before anything touches the
 * client, `maybeSingle()`, and above all the degradation rule: **every failure ends at `{}`,
 * never at an error.** A settings read that could throw at the root of the tree would take the
 * whole app down over a row that is optional by design (§1 - a યુવક is never left at a dead
 * end).
 *
 * The promise is memoised at module scope rather than per hook. Both hooks below want the
 * same row and both are mounted in the same render, and without the memo that is two requests
 * for one object on every boot - four under StrictMode's double-mount in development. It is
 * never invalidated: this row is read once at start and the mechanism that picks up a changed
 * one is a page load, which is a new module instance. See useSessionExpiry() - that is not a
 * limitation of the cache, it is the entire subject of the second half of this file.
 */
const configured = isSupabaseConfigured(supabaseConfigFromEnv(import.meta.env));

let appRowPromise = null;

function readAppRow() {
  if (appRowPromise) return appRowPromise;

  appRowPromise = (async () => {
    if (!configured) return {};
    try {
      const { data, error } = await supabase
        .from('settings')
        .select('value')
        .eq('key', APP_SETTINGS_DOC)
        .maybeSingle();
      return error ? {} : data?.value ?? {};
    } catch {
      // A network failure, a client that could not be built, an origin that is offline. All
      // of them mean "no configuration", which is the built-in icon and no session policy -
      // the state this app shipped in and works perfectly well in.
      return {};
    }
  })();

  return appRowPromise;
}

/** `settings['app']`, or `{}`. Never null after `loading` clears, never a thrown error. */
function useAppRow() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    readAppRow().then((value) => {
      if (!alive) return;
      setSettings(value);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  return { settings, loading };
}

// ────────────────────────────────────────────────────────────────────────────
// The mark
// ────────────────────────────────────────────────────────────────────────────

/**
 * Rewrite one `<link rel>` in the document head, creating it if the page never had one.
 *
 * `querySelector` on the rel rather than an id, so index.html keeps the two links it has
 * always had and the comments explaining them stay where they are. An id would be a second
 * name for an element that already has a unique one.
 *
 * Everything here is inside a try. This runs at the root of the tree on every load, and the
 * worst outcome it may ever produce is "the tab keeps the icon it already had" - a document
 * with a locked-down head (an embedded webview, an extension that froze it) must not be an
 * app that fails to render.
 */
function applyIconLink(rel, href, type) {
  if (!href) return;
  try {
    let el = document.querySelector(`link[rel="${rel}"]`);
    if (!el) {
      el = document.createElement('link');
      el.setAttribute('rel', rel);
      document.head.appendChild(el);
    }
    // Compared before writing so a re-render cannot make the browser re-fetch the image. It
    // also keeps this idempotent, which matters: the hook is mounted once but its effect runs
    // again whenever the resolved icon object changes identity.
    if (el.getAttribute('href') !== href) el.setAttribute('href', href);
    if (type) el.setAttribute('type', type);
    else el.removeAttribute('type');
  } catch {
    /* head is not writable here; the built-in mark from index.html stands. */
  }
}

/**
 * The સંચાલક's icon, applied to the running document.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * What this reaches, and what it cannot
 * ────────────────────────────────────────────────────────────────────────────
 *
 * shared/domain/appicon.js sets out the whole platform picture; the short version of this
 * hook's part in it:
 *
 *   * the browser tab, for anybody who has not installed - changes here, on this load;
 *   * every install made from today onward, on any platform - iOS copies `apple-touch-icon`
 *     at the moment Add-to-Home-Screen is tapped, and this is what it will find;
 *   * an installed Android launcher - not this hook's doing at all. Chrome re-reads the
 *     manifest netlify/functions/manifest.js serves and updates the WebAPK on its own.
 *   * an installed iPhone - **unreachable, by any code anywhere.** That is why
 *     src/components/ReinstallNotice.jsx exists.
 *
 * The DOM write is deferred until the row has actually arrived. While `loading` the resolver
 * answers "built-in", which is exactly what index.html already declares, so writing then
 * would be a no-op that costs a head mutation on every single load; and if the read fails it
 * answers "built-in" again, which is the correct answer rather than a fallback.
 *
 * @returns {{ icon: ReturnType<typeof resolveAppIcon>, loading: boolean }}
 *   `icon` is never null and never partial on the first paint - resolveAppIcon() falls back
 *   to the built-in mark. `icon.version` is what ReinstallNotice compares against.
 */
export function useAppIcon() {
  const { settings, loading } = useAppRow();
  const icon = useMemo(() => resolveAppIcon(settings?.[APP_ICON_KEY]), [settings]);

  useEffect(() => {
    if (loading) return;
    const links = appIconLinks(icon);
    applyIconLink('icon', links.icon, links.type);
    // No `type` on the Apple link: iOS has never read one there, and index.html does not
    // carry one either. Writing image/png onto it would be inventing an attribute the
    // platform ignores.
    applyIconLink('apple-touch-icon', links.apple, null);
  }, [icon, loading]);

  return { icon, loading };
}

// ────────────────────────────────────────────────────────────────────────────
// The session, and the load it forces
// ────────────────────────────────────────────────────────────────────────────

/**
 * At most one reload per page load, held at module scope rather than in a ref.
 *
 * A ref would be per component instance, and "per component instance" is not the lifetime
 * this is about: the thing that must happen only once is a navigation away from THIS
 * document. A module-level flag is reset by the only event that should reset it, which is the
 * new document the reload produces.
 *
 * Without it, `visibilitychange` and `pageshow` can both fire for one resume - they do on iOS
 * - and the second would call reload() on a page already unloading, or, worse, a reload that
 * lands back in an expired state would immediately queue another.
 */
let reloadFired = false;

const readStartedAt = () => {
  try {
    const raw = localStorage.getItem(SESSION_STARTED_KEY);
    const at = raw === null ? NaN : Number(raw);
    // `> 0` and not merely finite, because `Number('')` is 0 and an empty string is what a
    // half-written localStorage entry looks like. Zero is 1 January 1970, which sessionExpired()
    // would correctly call ancient - so without this, a damaged entry reloads the app instead of
    // being adopted as "we have not been counting yet", which is what it actually means.
    return Number.isFinite(at) && at > 0 ? at : NaN;
  } catch {
    // Private mode, or storage disabled. NaN is read by sessionExpired() as "beginning
    // unknown", and every branch of that function fails towards reloading on purpose.
    return NaN;
  }
};

const writeStartedAt = (at) => {
  try {
    localStorage.setItem(SESSION_STARTED_KEY, String(at));
  } catch {
    /* nothing to remember with; the policy simply cannot hold on this handset. */
  }
};

const clearStartedAt = () => {
  try {
    localStorage.removeItem(SESSION_STARTED_KEY);
  } catch {
    /* nothing to clear */
  }
};

/**
 * Ask every registered service worker to look for a new one, and never wait long for it.
 *
 * This is the half of the reload that actually delivers new code. `registerType: 'autoUpdate'`
 * checks for an update on load, but the load is the event that has not been happening; by the
 * time we get here we are about to force one, and asking the registration first means the
 * document that comes back is served by the new worker rather than by the old one with the new
 * one waiting behind it - which would cost a second reload nobody asked for.
 *
 * Raced against a timer because `update()` is a network request and this sits between a યુવક
 * bringing the app to the foreground and the app appearing. On a weak signal it can hang for
 * as long as the connection takes to fail. Three seconds is the most a resume may spend on an
 * optimisation: past that the reload happens anyway and the worker updates on its own during
 * the load that follows.
 */
async function refreshServiceWorkers() {
  try {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const updates = navigator.serviceWorker
      .getRegistrations()
      .then((regs) => Promise.all(regs.map((r) => r.update().catch(() => {}))));
    await Promise.race([updates, new Promise((resolve) => setTimeout(resolve, 3000))]);
  } catch {
    /* no worker, or a browser that refuses to enumerate them. The reload still happens. */
  }
}

const safeSignOut = async () => {
  try {
    await supabase.auth.signOut();
  } catch {
    // The token is expiring anyway and the reload is what this is really for. A failed
    // sign-out must not be the thing that leaves a phone on June's build.
  }
};

const safeReload = () => {
  try {
    location.reload();
  } catch {
    /* a context that forbids navigation. Nothing more can be done from here. */
  }
};

/**
 * The maximum age of one સેશન, and the load that enforcing it produces.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * What this is really for
 * ────────────────────────────────────────────────────────────────────────────
 *
 * shared/domain/session.js states it in full and it is worth repeating in one sentence here,
 * because this file is where somebody will come to delete it: an installed PWA can run the
 * same JavaScript for months, so the app is given a moment at which it must load itself from
 * the network again, and the end of a session is that moment. Signing out is the mechanism.
 * The reload is the point.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Off is a true no-op, not a cheap one
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `enabled: false` is the default and the state nearly every project will stay in. In that
 * state this hook reads one row and then does nothing at all: no listener, no auth
 * subscription, no localStorage write. That last one matters more than it looks - a hook that
 * kept the bookkeeping "ready" while switched off would be writing to every યુવક's handset for
 * a feature nobody turned on, and the row it writes is not one anything else may interpret.
 *
 * The cost of that is stated rather than hidden: when a સંચાલક does turn the policy on, no
 * phone has a stored start, so the first foreground after it takes effect adopts that moment
 * as the beginning of the session (see the ordering note below) instead of signing everybody
 * out at once. Turning it on is quiet; the first expiry arrives `hours` later, one યુવક at a
 * time, which is what the panel's card promises.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Boot signs out and does NOT reload. The loop that would follow if it did.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * On boot the document has just been fetched: it IS the newest code, and the service worker
 * has already been asked for an update by the load itself. There is nothing a reload could
 * deliver. What it would deliver is a loop - the new document boots, reads the same row,
 * finds a session that is expired (or a `startedAt` that storage refuses to keep, which reads
 * the same way), signs out and reloads again, forever, with the login screen never on screen
 * long enough to type into. The once-per-page-load guard does not save that case, because
 * each reload is a new page load with a fresh flag.
 *
 * So boot ends the session and stops. The યુવક sees લોગિન, on today's build, which is the
 * whole outcome this mechanism exists to produce.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * `pageshow` as well as `visibilitychange`, and why one is not enough
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `visibilitychange` is the correct event and it is the one that fires on Android and in every
 * desktop browser. An installed iOS PWA is the exception this whole file is built around: when
 * it is resumed from the app switcher Safari frequently restores the page from the
 * back/forward cache, and a bfcache restore fires `pageshow` (with `persisted: true`) while
 * `visibilityState` may never have changed from the document's point of view - so a listener
 * on visibility alone hears nothing, on the one platform where months-old code is most likely
 * to be running. Both are attached; both route into the same guarded handler, and the guard is
 * what makes hearing the same resume twice harmless.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Nothing happens without a live session
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Every path below returns early when nobody is signed in. That is not tidiness: with no
 * session there is no `startedAt`, sessionExpired() reads a missing start as expired, and the
 * app would reload on every single foreground of the લોગિન screen - an installed app that
 * refreshes itself each time it is opened and never gets as far as the password field.
 */
export function useSessionExpiry() {
  const { settings, loading } = useAppRow();
  const policy = useMemo(() => resolveSessionPolicy(settings?.[SESSION_KEY]), [settings]);

  useEffect(() => {
    if (loading) return;
    // The no-op. Note this is BEFORE anything touches storage, the auth client or the
    // document - `enabled: false` must be indistinguishable from this hook not existing.
    if (!policy.enabled) return;
    if (!configured) return;

    let alive = true;
    /**
     * Whether a session exists, tracked here rather than read from useAuth().
     *
     * src/lib/auth.jsx is deliberately untouched by this feature: it is the module every
     * route decision depends on, and a session policy that could change how IT reports a
     * session would be a change to routing dressed up as a setting. This hook observes the
     * same client from the outside and decides nothing the router reads.
     */
    let hasSession = false;

    /**
     * The end of a session, on a resume - the path that reloads.
     *
     * Order is fixed: forget the start, end the session, ask the workers, then navigate. The
     * sign-out has to precede the reload or the new document boots holding the very session
     * this just decided was too old, and the boot path would end it a second time - correct,
     * but it would have shown the મુખપૃષ્ઠ for a frame first.
     */
    const expireAndReload = async () => {
      if (reloadFired) return;
      reloadFired = true;
      clearStartedAt();
      await safeSignOut();
      await refreshServiceWorkers();
      safeReload();
    };

    /**
     * Adopt first, then check - and the order is the difference between a quiet rollout and
     * signing 2,000 યુવકો out on one afternoon.
     *
     * A session with no stored start is not evidence of an old session. It is what every
     * phone in the સંઘ looks like the moment the policy is switched on, and what a phone
     * looks like after somebody cleared site data. Writing "now" and calling it the beginning
     * is the honest reading of "we have not been counting until this moment".
     *
     * Checking first would invert that: sessionExpired() treats a missing start as expired by
     * design (its own note explains why - every ambiguity there falls towards reloading), so
     * the first foreground after the setting was enabled would sign out everybody at once,
     * with no announcement and no cause anyone could point at. That is precisely the outcome
     * shared/domain/session.js refuses in its "off by default" section, and it would arrive
     * through the back door if this order were swapped.
     *
     * The missing-start branch is still reachable and still does its job: once a start HAS
     * been adopted, storage that later loses it is read as expired on the next resume, which
     * costs one reload and is the safe direction.
     */
    const adopt = () => {
      if (!Number.isFinite(readStartedAt())) writeStartedAt(Date.now());
    };

    const onResume = () => {
      if (!alive || reloadFired) return;
      // `pageshow` also fires on an ordinary load, and `visibilitychange` fires on the way
      // out as well as on the way in. Neither is a resume, and neither may expire anything.
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      if (!hasSession) return;
      if (!sessionExpired(policy, readStartedAt(), Date.now())) return;
      void expireAndReload();
    };

    /**
     * The boot check. Sign out, stay put - see the long note above for the loop this avoids.
     */
    const onBoot = async () => {
      const { data } = await supabase.auth.getSession().catch(() => ({ data: {} }));
      if (!alive) return;
      hasSession = Boolean(data?.session);
      if (!hasSession) return;

      adopt();
      if (!sessionExpired(policy, readStartedAt(), Date.now())) return;

      clearStartedAt();
      await safeSignOut();
    };

    void onBoot();

    /**
     * The bookkeeping, driven by the auth client rather than by any page.
     *
     * SIGNED_OUT is the only event that clears, and it is what makes a new sign-in start a
     * new clock: the next event finds nothing stored and adopts that moment. Every other
     * event carrying a session - SIGNED_IN, INITIAL_SESSION, TOKEN_REFRESHED - goes through
     * the same adopt(), which writes only when there is nothing there.
     *
     * That is deliberately gentler than "SIGNED_IN always writes now", and the difference is
     * a bug rather than a preference. supabase-js has, across its 2.x line, re-emitted
     * SIGNED_IN for things that are not a sign-in - a tab regaining focus, a session
     * re-adopted from storage - and a handler that stamped `Date.now()` on each of those
     * would push the deadline forward every time a યુવક opened the app. The session would
     * then never expire on exactly the phones this exists for: the ones that are opened often
     * and loaded never. Adopting instead is identical on the path that matters, because
     * SIGNED_OUT has already cleared the previous start by the time a real sign-in arrives.
     */
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      if (!alive) return;
      hasSession = Boolean(next);

      if (event === 'SIGNED_OUT') clearStartedAt();
      else if (hasSession) adopt();
    });

    // On `document`, not on `window`: visibilitychange is dispatched at the document and a
    // window listener would hear the same resume a second time through bubbling. `pageshow`
    // is a window event and has no document counterpart, which is why the two differ here.
    document.addEventListener('visibilitychange', onResume);
    window.addEventListener('pageshow', onResume);

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
      document.removeEventListener('visibilitychange', onResume);
      window.removeEventListener('pageshow', onResume);
    };
    /*
      The two primitives rather than `policy` itself, even though the useMemo above already
      makes the object stable. That memo is one line away from being edited, and if it ever
      stopped holding, an object dependency would silently start tearing this effect down and
      rebuilding it on every render - unsubscribing from auth and re-attaching both listeners
      - which is the kind of regression nothing on screen would show. The two numbers ARE the
      policy; nothing else in it is read below.
    */
  }, [loading, policy.enabled, policy.hours]);

  return policy;
}
