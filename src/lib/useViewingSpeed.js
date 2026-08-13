import { useCallback, useEffect, useState } from 'react';
import { useSlideshow } from './useSettings';
import {
  resolveViewingSpeed,
  toStoredViewingSpeed,
  validateViewingSpeed,
} from '../../shared/domain/viewing-speed.js';

/**
 * ────────────────────────────────────────────────────────────────────────────
 * The યુવક's own આપોઆપ speed — his choice, on his phone.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * shared/domain/viewing-speed.js holds the rule; this file holds the storage and the React
 * plumbing around it. Nothing here decides what a number means — every read goes back out
 * through `resolveViewingSpeed()` and every write goes through `validateViewingSpeed()`,
 * because a second opinion about what "8" is worth is exactly the two-answers-to-one-question
 * fault the shared module was written to prevent.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why localStorage and not the `profiles` row
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The obvious alternative is a column on `profiles`, which would follow a યુવક between
 * devices, and it is the wrong home for this one. Three reasons, in the order they matter:
 *
 *   1. **It has to be instant.** The requirement is that tapping ધીમું takes effect at once;
 *      a યુવક who taps it and watches the chip light half a second later has been shown a
 *      round trip he did not ask about. A write here is synchronous and the render that
 *      follows is the same tick.
 *   2. **It has to survive no signal.** This is a preference about how a phone behaves, and
 *      a phone in a mandir basement still has to obey it. A column would mean the choice is
 *      unreadable exactly where the app is most used.
 *   3. **It is a property of the handset, not of the person.** The same brother on a small
 *      phone at night and a tablet in a hall genuinely may want different dwells, and the
 *      shared row would force one on both.
 *
 * What that costs is honest and small: a new phone starts at the સંચાલક's default, and
 * clearing the browser's data forgets the choice. Both land on a working slideshow, which is
 * the only outcome this module owes anybody.
 *
 * The key is versioned in the key itself — `varni:speed:v1` — for the reason useNavigation.js
 * gives about `varni:nav:v1`: the only migration this will ever need is "throw it away", and a
 * version field *inside* the JSON has to be read and branched on by the code that runs before
 * anything else, which is the one place that must not be able to throw. `varni:` prefixed like
 * `varni:nav:v1`, `varni:last-route:<uid>` and `varni:pending-profile`, so everything this app
 * leaves on a shared phone is visibly ours and greppable.
 *
 * NOT per-user, unlike the last-route key, and for the same reason the nav cache is not: it is
 * a property of the handset. Two brothers sharing a phone share its slideshow speed, which is
 * the same bargain they already accept for every other physical thing about the device — and
 * keying it by uid would leave one orphaned copy per account behind for ever.
 */
const SPEED_KEY = 'varni:speed:v1';

/**
 * The stored object, or null for "he has never chosen".
 *
 * Deliberately does NOT resolve here. What is cached is the STORED VALUE, not the resolved
 * one — the same distinction useNavigation.js draws — because resolving needs the સંચાલક's
 * default, which arrives from the network at its own pace and can change under a mounted
 * component. Resolve at the point of use, from whatever the default is at that moment, and
 * there is no way for a stale resolution to outlive the fact it was resolved against.
 *
 * Every failure path ends at null, which the resolver reads as "no choice" and answers with
 * the સંચાલક's number. Private mode, a full quota, a half-written value and JSON that is not
 * JSON all mean the same thing here — there is no remembered choice — and none of them may
 * cost a યુવક a running slideshow.
 */
function readStored() {
  try {
    const raw = localStorage.getItem(SPEED_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // An object or nothing. Anything else is treated as absent rather than repaired: the
    // resolver's contract is "whatever you hand me, you get a usable dwell", and handing it
    // a shape it will only throw away is a slower way of handing it null.
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function writeStored(value) {
  try {
    localStorage.setItem(SPEED_KEY, JSON.stringify(value));
  } catch {
    // Storage denied or full. He keeps the speed he just picked for this visit — the module
    // mirror below is what the app actually reads — and the next visit starts from the
    // સંચાલક's default again. A storage failure costs the MEMORY of the choice, never the
    // choice itself, which is the whole point of keeping the mirror separate from the write.
  }
}

function removeStored() {
  try {
    localStorage.removeItem(SPEED_KEY);
  } catch {
    // Nothing to remove, or storage denied. The mirror below is cleared either way, which is
    // the part the tab in front of him is actually asking for.
  }
}

/**
 * ────────────────────────────────────────────────────────────────────────────
 * ONE ANSWER PER TAB — how two mounted copies of this hook are kept from disagreeing
 * ────────────────────────────────────────────────────────────────────────────
 *
 * This hook has at least two callers by construction: the સેટિંગ page, where a યુવક changes
 * the speed, and DarshanFeed, which consumes it. React knows nothing that connects them — a
 * `useState` in each would give the સેટિંગ page a chip lit on ધીમું while a દર્શન feed still
 * mounted in the same tab went on running at the old dwell, and neither would be wrong about
 * its own state. That is the disagreement, and it is invisible in review because the two
 * screens are rarely open at once in development.
 *
 * The fix is that the value does not live in a component at all. `mirror` is the tab's single
 * copy of the stored object and `listeners` is every mounted hook; a write updates the mirror
 * and notifies all of them in the same synchronous tick, so every copy re-renders from one
 * value. Same shape as useNavigation.js's module-scope cache, for the same reason — the state
 * belongs to the tab, not to whichever component happened to mount first.
 *
 * `undefined` means "not read from storage yet"; `null` is a legitimate value meaning "he has
 * never chosen", which resolves to the સંચાલક's default.
 */
let mirror;
const listeners = new Set();

function currentStored() {
  if (mirror === undefined) mirror = readStored();
  return mirror;
}

function publish(next) {
  mirror = next;
  // A copy, because a listener that unsubscribes during the loop would otherwise mutate the
  // Set being iterated — which is not hypothetical here: a change on the સેટિંગ page can
  // navigate, and unmounting is exactly what removes a listener.
  for (const notify of [...listeners]) notify(next);
}

/**
 * The other tab.
 *
 * `storage` fires only in the tabs that did NOT write, which is precisely the gap the mirror
 * leaves open: it lives as long as the tab does, so without this a યુવક with the સેટિંગ page
 * open in one tab and દર્શન in another would change the speed in the first and the second
 * would go on running at the old one until it was reloaded.
 *
 * Bound once for the life of the tab rather than per mount, and never removed. That is the
 * same bargain useNavigation.js's module-scope promise makes: one listener that costs nothing
 * is cheaper than add/remove pairs on every mount of two components, and there is no state in
 * which removing it would be correct — the mirror it maintains outlives every component.
 */
let bound = false;
function bindOtherTabs() {
  if (bound || typeof window === 'undefined') return;
  bound = true;
  window.addEventListener('storage', (e) => {
    // `e.key === null` is a whole-storage clear (another tab called localStorage.clear()),
    // which does include ours — so it is re-read rather than ignored.
    if (e.key !== null && e.key !== SPEED_KEY) return;
    publish(readStored());
  });
}

/**
 * The dwell this યુવક actually gets, and the two controls that change it.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Default and override, in that order
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `useSlideshow()` is the સંચાલક's number — one value for the whole સંઘ, out of
 * settings['app'].slideshow, bounded 1-60 by a database trigger. It is not overridden in the
 * sense of being ignored: it is the starting position of a control that belongs to the યુવક,
 * and it becomes the answer again the instant he calls `clear()`. `chosen` is what tells the
 * two apart, because they produce the same number and must not look the same on screen — only
 * one of them has a way back.
 *
 * It is read HERE rather than by each caller so that the default/override join happens in one
 * place. A caller that read `useSlideshow()` itself and fell back manually would be a second
 * copy of the precedence rule, and the copy that drifts is always the one nobody is looking at.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * What `seconds` is guaranteed to be
 * ────────────────────────────────────────────────────────────────────────────
 *
 * A finite number above zero, on every render including the very first, with no stored value,
 * no network and no settings row. `resolveViewingSpeed()` guarantees it and nothing here may
 * defeat it — a NaN or a 0 reaching `setTimeout` fires immediately, which turns a damaged
 * preference into exactly the zero-dwell flicker SPEED_MIN_SECONDS exists to forbid. Which is
 * why the resolved value is never cached, never patched and never merged with a draft: there
 * is one path from storage to `seconds` and it runs through the shared resolver.
 *
 * @returns {{
 *   seconds: number, chosen: boolean, preset: string|null,
 *   setSeconds: (n: number) => { ok: boolean, gu?: string, seconds?: number },
 *   clear: () => void, loading: boolean
 * }}
 *   `loading` is the સંચાલક's read, not his own choice — his own is on the device and is
 *   already in hand on the first render. A caller that renders the NUMBER should wait on it,
 *   or it will print the shared default for the width of one round trip and then correct
 *   itself; a caller that only starts a timer need not, because a યુવક cannot open the viewer
 *   and press આપોઆપ inside one round trip.
 */
export function useViewingSpeed() {
  const { slideshowMs, loading } = useSlideshow();
  const [stored, setStored] = useState(currentStored);

  useEffect(() => {
    bindOtherTabs();
    listeners.add(setStored);
    // Re-read on mount, because this component may have been mounted after another copy of
    // the hook changed the value — `useState`'s initialiser runs once and the mirror it read
    // may have moved on between that render and this effect.
    setStored(currentStored());
    return () => {
      listeners.delete(setStored);
    };
  }, []);

  /*
    Seconds in, milliseconds out — the same boundary useSlideshow() draws, crossed back over
    here. The row holds seconds because that is the unit the સંચાલક types and the unit his
    1-60 bound is written in; this module talks in seconds for the same reason (2-30 is a
    range of seconds); only the timer wants milliseconds, and only the timer's caller converts.

    Resolved on every render rather than memoised, exactly as useMobileNav() resolves its bar:
    the work is a typeof, a clamp and a find over four frozen entries, which is cheaper than
    the dependency array a useMemo would need — and what a memo would add is a second place
    where an identity check decides whether the dwell on screen is the current one.
  */
  const { seconds, chosen, preset } = resolveViewingSpeed(stored, slideshowMs / 1000);

  /**
   * Commit a number, and BE the authority on whether it is allowed.
   *
   * The સેટિંગ page validates as he types so the message arrives on the keystroke that caused
   * it, and that check is display only — this one decides. Two checks that could disagree
   * would mean a યુવક told "૨ થી ૩૦ સેકંડ વચ્ચે લખો" by one and quietly given 30 by the other;
   * both call the same `validateViewingSpeed()`, so they cannot.
   *
   * Storage first, then the mirror — but the mirror is published whether the write succeeded
   * or not, which is the deliberate part: on a phone in private mode `writeStored()` is a
   * no-op, and a યુવક who taps ધીમું there must still get ધીમું for this visit. He loses the
   * memory of it, not the effect.
   */
  const setSeconds = useCallback((next) => {
    const v = validateViewingSpeed(next);
    if (!v.ok) return v;
    const value = toStoredViewingSpeed(v.seconds);
    writeStored(value);
    publish(value);
    return v;
  }, []);

  /** Forget his choice; the સંચાલક's number is the answer again from the next render. */
  const clear = useCallback(() => {
    removeStored();
    publish(null);
  }, []);

  return { seconds, chosen, preset, setSeconds, clear, loading };
}
