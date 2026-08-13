import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { isSupabaseConfigured, supabaseConfigFromEnv } from '../../shared/supabase/client.js';
import {
  DEFAULT_MOBILE_NAV,
  MOBILE_BOTTOM_KEY,
  NAV_SETTINGS_DOC,
  resolveMobileNav,
} from '../../shared/domain/navigation.js';

/**
 * ────────────────────────────────────────────────────────────────────────────
 * settings['nav'] → the buttons at the bottom of a યુવક's screen.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * This is a settings hook like the five in src/lib/useSettings.js, and it deliberately is
 * NOT one of them. Two things make it different, and both of them are about the fact that
 * this row is read by a component that is mounted on every single page rather than by a
 * page:
 *
 *   1. it is fetched ONCE PER APP LOAD, not once per hook instance;
 *   2. it keeps its last good answer on the device, so a bar exists before the network
 *      does — and on a visit where the network never answers at all.
 *
 * Everything below is those two sentences.
 */

/**
 * Read from the environment, never from the client, exactly as useSettings.js and auth.jsx
 * do. Touching `supabase` on a build with no URL or key throws during module evaluation,
 * which is a white screen rather than the ગોઠવણ notice App.jsx is trying to render.
 */
const configured = isSupabaseConfigured(supabaseConfigFromEnv(import.meta.env));

/**
 * ────────────────────────────────────────────────────────────────────────────
 * Last known good, on this device
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Versioned in the key itself rather than inside the value, because the only migration
 * this data will ever need is "throw it away": it is a cache of a row that is authoritative
 * on the server, so a v2 simply stops reading v1's key and re-fetches once. A version field
 * *inside* the JSON would have to be read, compared and branched on by the code that is
 * running before the network answers — which is the one place in this file that must not be
 * able to throw.
 *
 * `varni:` prefixed like `varni:last-route:<uid>` and `varni:pending-profile`, so everything
 * this app leaves on a shared phone is visibly ours and greppable.
 *
 * NOT per-user, unlike the last-route key. The bar is the સંચાલક's configuration and is the
 * same for every યુવક on the phone; keying it by uid would mean a second brother opening the
 * app on the same handset gets the empty-cache path for no reason, and would leave one stale
 * copy per account behind forever.
 */
const NAV_CACHE_KEY = 'varni:nav:v1';

/**
 * What is cached is the STORED ROW, not the resolved bar.
 *
 * That distinction is the whole safety argument for this cache. A resolved bar carries
 * `route`, and a route read out of localStorage is a destination that some previous build of
 * this app — or anything else with access to the origin's storage — put there. The stored
 * row carries keys and the સંચાલક's opinions about them; every read below re-runs it through
 * resolveMobileNav(), which looks each key up in NAV_REGISTRY and takes the route from code.
 * So the worst a tampered or outdated cache entry can do is name a key this build drops, and
 * the resolver already drops it (see the file header of shared/domain/navigation.js: "a
 * stored row may choose among destinations, it may never name one").
 */
function readCachedRow() {
  try {
    const raw = localStorage.getItem(NAV_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // An array or nothing. Anything else is treated as absent rather than repaired: the
    // resolver's contract is "whatever you hand me, you get a bar", and handing it a shape
    // it will only throw away is a slower way of handing it null.
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    // Private mode, a storage quota, a half-written value, or JSON that is not JSON. Every
    // one of them means the same thing here — there is no last known good — and none of
    // them may cost a યુવક his navigation.
    return null;
  }
}

function writeCachedRow(row) {
  try {
    localStorage.setItem(NAV_CACHE_KEY, JSON.stringify(Array.isArray(row) ? row : []));
  } catch {
    // Storage denied. He gets the network read this visit and the defaults on the next
    // first paint, which is the behaviour this cache improves on rather than depends on.
  }
}

/**
 * ────────────────────────────────────────────────────────────────────────────
 * THE ONCE-PER-LOAD READ — the point of this module
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `useSettingsRow()` fires one request per hook instance per key, and that is right for the
 * pages that use it: a page mounts, asks its question, and unmounts. The bottom bar is not
 * a page. It is mounted beside every route for as long as the tab lives, it is remounted by
 * StrictMode's double-invoke in development, and it would be remounted again by any future
 * change that lets the shell unmount between routes. With useSettingsRow's shape, each of
 * those is another `GET /settings?key=eq.nav` — which is precisely the "Home API →
 * Navigation API → Navigation API" trail the brief forbids, and which on a weak signal is
 * three chances for the bar to be late instead of one.
 *
 * So the request lives at module scope, not in a component. The first caller starts it;
 * every later caller — this render, the next route, the remount after StrictMode tears the
 * tree down — awaits the very same promise. One request per page load, no matter how many
 * components ask and how many times they are mounted.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Deliberately NOT time-based
 * ────────────────────────────────────────────────────────────────────────────
 *
 * There is no TTL here and there must not be one. The cache is scoped to the page load: it
 * dies with the tab, and the next visit reads the row again. That means a સંચાલક who
 * rearranges the bar reaches a યુવક on his NEXT visit — which is exactly, and intentionally,
 * how every other setting in this app already behaves (the levels list, the ધૂન, the
 * YouTube link, the journey wording are all read once at start and not re-polled). A
 * five-minute TTL would buy nothing a reload does not, and would cost a bar that can change
 * shape under a thumb mid-session.
 */
let navPromise = null;

/**
 * The settled answer, kept beside the promise.
 *
 * `navPromise.then()` is always asynchronous, even on an already-resolved promise — so a
 * component mounting after the read has finished would still render one frame from the
 * localStorage copy before the awaited value arrived. Usually those are identical and
 * nobody could tell; when they are not (first visit after a સંચાલક's change, second route
 * of the session) it is a bar that visibly reshuffles on a navigation. Holding the settled
 * row synchronously means every mount after the first paints the final bar immediately.
 *
 * `undefined` means "not settled yet"; `null` is a legitimate settled value meaning "no row
 * anywhere", which resolves to DEFAULT_MOBILE_NAV.
 */
let navSettled;

/**
 * Start (or join) the one read.
 *
 * Resolves to the stored `mobileBottom` array, or null. It never rejects — a caller of this
 * has a bar to render either way, and a rejected promise here would mean an unhandled
 * rejection in the console of every yuvak with a bad signal.
 */
function loadNavRow() {
  if (navPromise) return navPromise;

  navPromise = (async () => {
    // Same guard as useSettingsRow's, and for the same reason: a build with no Supabase
    // configuration must degrade to the defaults rather than throw on the client.
    if (!configured) return readCachedRow();

    try {
      const { data, error } = await supabase
        .from('settings')
        .select('value')
        .eq('key', NAV_SETTINGS_DOC)
        .maybeSingle();

      // An error is a failed READ and is not evidence about the row: the સંચાલક's
      // arrangement is still whatever it was, and the best guess at it is the copy from the
      // last visit. Falling through to the cache here rather than to the defaults is what
      // stops a bad minute of signal from silently re-ordering a યુવક's buttons.
      if (error) return readCachedRow();

      const row = data?.value?.[MOBILE_BOTTOM_KEY];

      // A row that exists but holds no list is "nothing has been configured", which is a
      // real answer and not a failure — DEFAULT_MOBILE_NAV is what it means, and that is
      // what the resolver returns for it. The cache is not updated from it, because
      // overwriting a good copy with an empty one turns a project that briefly lost its
      // settings row into a project whose phones have forgotten the bar.
      if (!Array.isArray(row)) return readCachedRow();

      writeCachedRow(row);
      return row;
    } catch {
      // A thrown fetch — offline, DNS, a service worker that could not answer. Identical
      // handling to `error` above; the distinction is PostgREST's, not this app's.
      return readCachedRow();
    }
  })().then((row) => {
    navSettled = row ?? null;
    return navSettled;
  });

  return navPromise;
}

/**
 * The bar, resolved, in the order it must be drawn.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Never empty, at any point in the lifecycle — including the first paint
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The initial state is computed synchronously, from the settled row if this is not the
 * first mount and from localStorage if it is, and falls through resolveMobileNav() to
 * DEFAULT_MOBILE_NAV when there is neither. There is no state in which this returns an
 * empty array and therefore no state in which the bar is not drawn.
 *
 * That is the same argument `resolveLevels()` and `useLevels()` make about the મુખપૃષ્ઠ,
 * and it is stronger here. A level list that appears half a second late is a page that
 * fills in. A bottom bar that appears half a second late is 64px of chrome inserted under
 * a thumb that is already travelling towards something else — the content it was aiming
 * at moves up, and the tap lands on a button. §18's "validation must not move the page"
 * is the same rule looked at from the other end of the screen.
 *
 * The cost is the mirror of useLevels()' cost: for the width of one round trip, a bar the
 * સંચાલક changed since this phone's last visit shows its previous arrangement. `loading`
 * is returned for a caller that would rather wait. BottomNav does not, and must not.
 *
 * @returns {{ items: Array, loading: boolean }} `items` is never empty.
 */
export function useMobileNav() {
  const [row, setRow] = useState(() => (navSettled !== undefined ? navSettled : readCachedRow()));
  const [loading, setLoading] = useState(() => navSettled === undefined);

  useEffect(() => {
    // Already answered on a previous mount — nothing to wait for and nothing to set. The
    // initial state above already holds the settled row, so re-setting it here would only
    // be a redundant render.
    if (navSettled !== undefined) {
      setLoading(false);
      return;
    }

    let alive = true;
    loadNavRow().then((next) => {
      if (!alive) return;
      setRow(next);
      setLoading(false);
    });

    return () => {
      // The unmounted-component guard, not a cancellation: the promise is shared and the
      // read must go on finishing for whoever else is waiting on it.
      alive = false;
    };
  }, []);

  /*
    Resolved on every render rather than memoised, and that is not an oversight.
    resolveMobileNav() maps and sorts a list of at most five items whose registry lookup is
    a Map — cheaper than the dependency array a useMemo would need, and `row` is a value
    that changes at most once in the life of the tab. What a memo *would* add is a second
    place where the identity of `row` decides whether the bar is up to date.

    The stored row goes through the resolver here, on every read, including the one that
    came out of localStorage. That is the rule from the top of this file restated where it
    is enforced: a cached row is data written by an older build, and it may name a key that
    no longer has a route, an icon this build cannot draw, or a label somebody has since
    lengthened past what fits. The resolver drops or replaces each of those, and hands back
    routes from NAV_REGISTRY rather than from the row.
  */
  return { items: resolveMobileNav(row), loading };
}

/**
 * Forget the once-per-load read and the device's copy.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Where this would be called from — and why nothing in src/ calls it today
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The obvious caller is the સંચાલક panel, at the moment it saves a new arrangement: clear
 * the cache, re-read, show the yuvak the change immediately. It cannot be that caller. The
 * panel is a SEPARATE APPLICATION with its own Vite build and its own Rollup graph
 * (vite.config.js's header, §5/§50) — admin code cannot import this module, and a સંચાલક's
 * browser is not a યુવક's browser in any case.
 *
 * Inside this app the honest answer is that there is nothing to call it from: a યુવક has no
 * screen that edits navigation, and the cache dies with the tab regardless. It is exported
 * because the two futures that need it are real and neither should have to invent it —
 * a "refresh" affordance on a future સેટિંગ page, and a logout that clears everything this
 * origin has stored for the person handing the phone back. Both want this to be one call,
 * beside the row it forgets, rather than a localStorage key spelled out somewhere else.
 */
export function clearNavCache() {
  navPromise = null;
  navSettled = undefined;
  try {
    localStorage.removeItem(NAV_CACHE_KEY);
  } catch {
    // Nothing to clear, or storage denied. The module-scope halves above are cleared
    // either way, which is the part a caller in this tab is actually asking for.
  }
}
