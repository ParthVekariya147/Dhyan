/**
 * આપોઆપ — how fast the fullscreen દર્શન moves, chosen by the યુવક himself.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * What this is, and how it differs from the setting beside it
 * ────────────────────────────────────────────────────────────────────────────
 *
 * There are now two answers to "how long does a દ્રશ્ય stay on screen", and they are not in
 * competition — they are a default and an override, in that order:
 *
 *   settings['app'].slideshow.seconds   the સંચાલક's. One number for the whole સંઘ, 1-60,
 *                                       enforced by a trigger (0018). It is what a યુવક who
 *                                       has never opened this screen gets, on every device,
 *                                       for ever.
 *   this module                          the યુવક's own. His, on his phone, from the moment
 *                                       he picks it until he picks another.
 *
 * The requirement document is explicit about which way round that goes: "ગતિ યુવક પોતે એ જ
 * પાના પર બદલી શકે" — he changes it himself — and "પસંદ કરેલી ગતિ યાદ રહે, બીજી વાર ખોલે
 * ત્યારે ફરી ગોઠવવી ન પડે": the choice is remembered, so he never sets it twice.
 *
 * So the સંચાલક's number is not overridden in the sense of being ignored. It is the starting
 * position of a control that belongs to the યુવક, and it goes back to being the answer the
 * moment he clears his choice.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why the four presets are named and not a slider
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The document lists four (ઝડપી, મધ્યમ, ધીમું, અતિ ધીમું) with a seconds value AND a total
 * running time against each. That second column is the reason the presets exist at all: "8
 * seconds" is a number a યુવક cannot picture, and "આશરે ૧૫ મિનિટ" is the same fact in the
 * unit he is actually deciding in — how long am I sitting down for. A bare slider from 2 to
 * 30 answers the first question and never the second.
 *
 * The custom field is there too, because the document asks for it, and it is bounded 2-30.
 */

/**
 * ────────────────────────────────────────────────────────────────────────────
 * THE FOUR — from the requirement document, page 5, ગતિના વિકલ્પ
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The seconds are the document's, exactly: 3, 5, 8, 12. The minute totals in the document's
 * table (૫, ૯, ૧૫, ૨૨) are NOT reproduced here and must never be — see totalMinutes() below.
 * They are the product of the seconds and the size of the collection, and the collection
 * grows. A typed total is a number that is right on the day it is written and quietly wrong
 * afterwards (§62: the total is counted, never typed).
 *
 * `key` is the identity and is what gets stored. The label is Gujarati because a યુવક reads
 * it; the key is Latin because it is data, and a stored value that changes when somebody
 * improves a caption is a stored value nothing can match against.
 */
export const SPEED_PRESETS = Object.freeze([
  Object.freeze({ key: 'fast', label: 'ઝડપી', seconds: 3 }),
  Object.freeze({ key: 'medium', label: 'મધ્યમ', seconds: 5 }),
  Object.freeze({ key: 'slow', label: 'ધીમું', seconds: 8 }),
  Object.freeze({ key: 'verySlow', label: 'અતિ ધીમું', seconds: 12 }),
]);

/**
 * The custom range, 2 to 30 seconds, and both ends are the document's.
 *
 * They are deliberately NOT the સંચાલક's 1-60 (shared/domain/settings.js). The two bounds
 * answer different questions and the difference is the point:
 *
 *   1-60 is what one person setting a default for two thousand others may choose, including
 *   the deliberately slow end used for a hall of યુવકો watching together.
 *
 *   2-30 is what a યુવક may do to his own દર્શન in the moment. The floor is 2 rather than 1
 *   because at one second per દ્રશ્ય the collection is not being looked at, it is flickering
 *   past — and unlike the સંચાલક, who sets a number once and deliberately, a યુવક reaches
 *   this control by tapping and could arrive at the floor by accident. The ceiling is 30
 *   because past that a દ્રશ્ય that has not moved is indistinguishable from an app that has
 *   frozen, and he has the › arrow for going slower still.
 *
 * A સંચાલક default outside 2-30 is legal and is honoured as-is: it is his number, not the
 * યુવક's, and clamping it here would silently change a setting this module does not own.
 */
export const SPEED_MIN_SECONDS = 2;
export const SPEED_MAX_SECONDS = 30;

/**
 * The preset a number corresponds to, or null if it is a custom value.
 *
 * Used to light the chosen chip. Matched on the SECONDS rather than on a stored key, which is
 * the whole reason this function exists: a યુવક who types 8 into the custom field has chosen
 * ધીમું, and showing him a highlighted custom box beside an unlit ધીમું chip would be the
 * screen disagreeing with itself about what he just did. One number, one highlighted control.
 */
export const presetForSeconds = (seconds) =>
  SPEED_PRESETS.find((p) => p.seconds === seconds) || null;

/** The preset with this key, or null. */
export const presetByKey = (key) => SPEED_PRESETS.find((p) => p.key === key) || null;

/**
 * How long the whole collection takes at this speed, in minutes — the document's second
 * column, computed.
 *
 * `sceneCount` is `useScenes().total`, counted from the દર્શન that passed both gates, so the
 * day દ્રશ્ય ૧૧૦ is added every row of this table corrects itself. The document's own numbers
 * (૫, ૯, ૧૫, ૨૨ minutes) are what this returns for 109 દ્રશ્યો, which is the size of the
 * collection it was written against — 3×109/60 = 5.45 → ૫, 12×109/60 = 21.8 → ૨૨.
 *
 * Rounded, not floored: 21.8 minutes is nearer 22 than 21, and this number is prefixed with
 * "આશરે" on screen precisely because it is an estimate a યુવક uses to decide whether he has
 * time before dinner. Returns 0 when the count is not yet known, and the caller renders
 * nothing rather than "આશરે ૦ મિનિટ" — a confident zero is worse than a missing line.
 */
export function totalMinutes(seconds, sceneCount) {
  if (!Number.isFinite(seconds) || !Number.isFinite(sceneCount) || sceneCount <= 0) return 0;
  return Math.max(1, Math.round((seconds * sceneCount) / 60));
}

/**
 * A stored choice → the dwell actually used, in seconds.
 *
 * Forgiving in the same shape and for the same reason as every resolver in
 * shared/domain/settings.js: this comes out of localStorage, which is a string anybody with
 * the origin's devtools — or a previous version of this app — may have written. Every way it
 * can be wrong ends at a usable number rather than at an exception or a NaN, because a NaN
 * reaches `setTimeout` and fires immediately, turning a damaged preference into exactly the
 * zero-dwell flicker SPEED_MIN_SECONDS exists to forbid.
 *
 *   nothing stored           → the સંચાલક's number. He has not chosen, so the default stands.
 *   not an object            → the સંચાલક's number.
 *   seconds not a number     → the સંચાલક's number. **`typeof`, never `Number()`**, exactly
 *                              as resolveSlideshow() argues: `Number(null)` and `Number('')`
 *                              are both 0, so a coercing check turns "nothing here" into a
 *                              dwell of zero.
 *   out of range             → clamped into 2-30, not discarded. A stored 45 was a real
 *                              intention once, and the nearest thing this module can honour
 *                              is nearer to it than silently reverting to the સંચાલક's.
 *   fractional               → rounded.
 *
 * @param stored            whatever came out of storage
 * @param adminSeconds      settings['app'].slideshow.seconds, already resolved
 * @returns {{ seconds: number, chosen: boolean, preset: string|null }}
 *   `chosen` is what the screen needs to tell "he picked 5" from "the સંચાલક set 5 and he has
 *   never been here" — two states that produce the same number and must not look the same,
 *   because only one of them offers a way back to the default.
 */
export function resolveViewingSpeed(stored, adminSeconds) {
  /*
    ────────────────────────────────────────────────────────────────────────────
    Why the floor is here and not left to the caller
    ────────────────────────────────────────────────────────────────────────────

    `Math.max(1, ...)` around the rounding, and it is load-bearing rather than defensive
    padding. The guard admits any `adminSeconds > 0` and *then* rounds, so without the floor
    every fraction below 0.5 rounds to **zero** — and a zero dwell is not a fast slideshow, it
    is `setTimeout(fn, 0)` firing immediately, which is exactly the flicker SPEED_MIN_SECONDS
    exists to forbid. It would have arrived through the *default* rather than through anything
    the યુવક stored, so none of the clamping below would ever have seen it.

    That is unreachable today: this parameter is documented as an already-resolved value, and
    `resolveSlideshow()` in shared/domain/settings.js clamps to 1..60 before it rounds, so
    nothing in the app can hand a fraction in. It is still wrong to depend on that. This
    module is the last thing between a number and a timer, and "the caller already checked" is
    the assumption that stops being true the day a second caller appears.

    The floor is 1 and NOT SPEED_MIN_SECONDS (2), which would be the tidier-looking choice and
    is the wrong one: 1 is a legal value for the સંચાલક (his range is 1-60) and this is *his*
    number being passed through, not the યુવક's. Clamping it to 2 would silently overrule a
    setting this module does not own — the 2-30 bound governs what a યુવક may choose for
    himself and has never governed the default he starts from.
  */
  const fallback =
    typeof adminSeconds === 'number' && Number.isFinite(adminSeconds) && adminSeconds > 0
      ? Math.max(1, Math.round(adminSeconds))
      : SPEED_PRESETS[1].seconds;

  const s = stored && typeof stored === 'object' ? stored : null;
  const n = s?.seconds;
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    return { seconds: fallback, chosen: false, preset: presetForSeconds(fallback)?.key ?? null };
  }

  const seconds = Math.min(SPEED_MAX_SECONDS, Math.max(SPEED_MIN_SECONDS, Math.round(n)));
  return { seconds, chosen: true, preset: presetForSeconds(seconds)?.key ?? null };
}

/**
 * Refuses what resolveViewingSpeed() would silently clamp — same division of labour as every
 * validate/resolve pair in shared/domain/settings.js.
 *
 * The resolver forgives because a stored value must always produce a running slideshow; this
 * refuses because a યુવક typing 45 into the custom box should be told the ceiling is 30, not
 * watch it quietly become 30 and be left wondering whether it took.
 *
 * Written in Gujarati, unlike the panel's validators: a યુવક reads this one.
 */
export function validateViewingSpeed(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) {
    return { ok: false, gu: 'સેકંડમાં આંકડો લખો.' };
  }
  if (!Number.isInteger(seconds)) {
    return { ok: false, gu: 'આખા સેકંડમાં લખો.' };
  }
  if (seconds < SPEED_MIN_SECONDS || seconds > SPEED_MAX_SECONDS) {
    return {
      ok: false,
      gu: `${SPEED_MIN_SECONDS} થી ${SPEED_MAX_SECONDS} સેકંડ વચ્ચે લખો.`,
    };
  }
  return { ok: true, seconds };
}

/** What goes into storage. One field, so a later addition cannot silently drop this one. */
export const toStoredViewingSpeed = (seconds) => ({ seconds });
