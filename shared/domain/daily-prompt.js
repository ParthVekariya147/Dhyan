/**
 * ────────────────────────────────────────────────────────────────────────────
 * "આજે તમે શું કર્યું?" — whether ક્રમાંક asks, and whether it asks by itself
 * ────────────────────────────────────────────────────────────────────────────
 *
 * A યુવક opens ક્રમાંક to find out where he stands, and until today is written down the board
 * he is reading does not have his day on it. So the app puts the day's form in front of him at
 * that moment — a sheet when the app has already seen something today, and a button at the foot
 * of the board when it has not.
 *
 * That behaviour was written into the component first, and it should not have been. **When a
 * screen interrupts a યુવક is a decision about his સંઘ, not a fact about this build.** A
 * project whose યુવકો do their ધ્યાન away from the phone wants the button and never the sheet;
 * one that has just introduced the daily record wants the sheet every evening; one that has not
 * started using daily records at all wants neither. None of those is a release.
 *
 * So it lives where every other decision of that kind lives: `settings['levels'].value`, beside
 * `leaderboard`, `level4Gate`, `tickWord` and `slideshow`, resolved by a pure function that has
 * a test and mirrored by a trigger that refuses what the panel would refuse.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Two fields, and why not a third
 * ────────────────────────────────────────────────────────────────────────────
 *
 *   `enabled`   ask at all. Off means ક્રમાંક is exactly the board it was before this feature —
 *               no sheet, no button, and no read of the day's record from that route.
 *   `autoOpen`  ask by opening. Off means the sheet never appears on its own; the button is
 *               still there, so nothing is taken away from a યુવક who wants to write his day
 *               down — he simply is not interrupted to do it.
 *
 * There is deliberately **no list of routes** and no "ask again after N hours". A route list
 * would let a સંચાલક put a form on the મુખપૃષ્ઠ, which §27 forbids for a reason that has
 * nothing to do with preference — the home page is what a યુવક lands on over a weak connection
 * and it must not load a day's record. A re-ask interval would be a second, weaker copy of "is
 * this day written down yet", which the server already answers on every open.
 */

/** The key this block lives under, inside `settings['levels'].value`. */
export const DAILY_PROMPT_KEY = 'dailyPrompt';

/**
 * On, and opening by itself.
 *
 * The opposite default to `DEFAULT_LEADERBOARD`, and the difference is worth stating because
 * the two sit in the same settings row. The board is off by default because it is the one
 * feature that shows a યુવક **another યુવક's name**, and turning that on because a migration
 * ran would be making a disclosure decision on somebody's behalf. This one discloses nothing at
 * all: it asks a યુવક about his own day, on a screen he chose to open, and the whole point of
 * the daily record is that days get recorded. A default of "off" would ship the feature switched
 * off and have every project wonder why nothing changed.
 *
 * `autoOpen` still only ever fires when the app has recorded something that is not written down
 * — that condition is the client's and is not a setting, because it is a fact about the data
 * rather than a decision about the સંઘ.
 */
export const DEFAULT_DAILY_PROMPT = Object.freeze({
  enabled: true,
  autoOpen: true,
});

/**
 * settings['levels'].value.dailyPrompt → what is actually in force.
 *
 * Forgiving, like every other resolver in this project: a row that cannot be understood falls
 * to the default rather than throwing, because this runs at the top of a page a યુવક is looking
 * at and a settings row is optional by design (§1 — never a dead end).
 *
 * **`=== false` and never a truthiness test**, in both fields. The stored value is jsonb, so a
 * tool that serialised a checkbox as the string `"false"` produces a value JavaScript reads as
 * true; and an absent key must mean the default rather than "off". Testing explicitly for the
 * boolean `false` is the only reading under which a missing field, a malformed field and a
 * field that genuinely says no are three different things — which is what the whole of
 * `resolveLeaderboard()`'s third paragraph is about, arriving here from the other direction.
 *
 * `autoOpen` is meaningless while `enabled` is false and is reported as false there rather than
 * as whatever was stored, so a caller cannot read one field without the other and reach a state
 * the panel does not offer.
 */
export function resolveDailyPrompt(stored) {
  const s = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};

  const enabled = s.enabled !== false;

  return {
    enabled,
    autoOpen: enabled && s.autoOpen !== false,
  };
}

/**
 * Refuses what `resolveDailyPrompt()` would silently correct.
 *
 * The same asymmetry `validateLeaderboard()` documents, and for the same reason: a resolver
 * reading a stored row has nobody to tell, so it must fall to a default and carry on; a
 * સંચાલક who saves a malformed value and is told "Saved" would then go looking for a behaviour
 * that never took effect, with nothing on any screen to say why. Refusing the write is the one
 * moment at which it can be explained to the person who can fix it.
 *
 * English, like every other message in this module's neighbours: it is read in the panel.
 */
export function validateDailyPrompt(prompt) {
  const p = prompt && typeof prompt === 'object' && !Array.isArray(prompt) ? prompt : null;
  if (!p) return { ok: false, gu: 'The daily prompt setting is missing.' };

  if (typeof p.enabled !== 'boolean') {
    return { ok: false, gu: 'Daily prompt: turn it on or off before saving.' };
  }
  if (typeof p.autoOpen !== 'boolean') {
    return { ok: false, gu: 'Daily prompt: choose whether it opens by itself.' };
  }

  /*
    "Off, but it opens by itself" is refused rather than quietly narrowed. The resolver reports
    it as fully off, which is the only sane reading, but a panel that accepted the combination
    would leave a switch on screen saying something the app does not do — and the સંચાલક would
    be looking at a control that had stopped meaning anything without being told.
  */
  if (!p.enabled && p.autoOpen) {
    return {
      ok: false,
      gu: 'Daily prompt: it cannot open by itself while it is switched off.',
    };
  }

  return { ok: true, dailyPrompt: { enabled: p.enabled, autoOpen: p.autoOpen } };
}
