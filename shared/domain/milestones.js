/**
 * What the app says at the moments a યુવક finishes something.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why these sentences are in one file
 * ────────────────────────────────────────────────────────────────────────────
 *
 * There are six of these moments and they were written in six places, months apart, so the
 * app congratulated a યુવક in six slightly different voices: one said 'જય સ્વામિનારાયણ',
 * one said 'જય સ્વામિનારાયણ 🙏', one said nothing warm at all and simply reported a number.
 * A યુવક climbing લેવલ ૨ → ૩ → ૪ in one sitting meets three of them in a row, and the
 * difference between them reads as carelessness at exactly the moment the app should feel
 * most like it was written for him.
 *
 * So the moments are named here and each one is written once. Adding a seventh means
 * adding it here, where the other six are visible to compare against.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * The shape, and why every one of them has three parts
 * ────────────────────────────────────────────────────────────────────────────
 *
 *   title   what happened, in his words — and it names the thing he finished, never a score
 *   line    what it means from here on: what is now permanent, what stays open to him
 *   grow    the one sentence that says the સાધના continues
 *
 * `grow` is the part that was missing everywhere and is the reason this file exists. Every
 * one of these screens used to end at a full stop — 'પૂરું થયું', and then a button. Ending
 * there quietly frames each level as a thing to be got past, when the whole of §7 is that it
 * is one climb that goes on: the same દર્શન, seen again, held longer. So each moment now
 * ends by pointing forward — and does it without setting a target, because a target is a
 * count of what is missing (§1 rule 4).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * What none of these may become
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Not one of them compares him to anybody, counts what he did not do, marks anything wrong,
 * or promises what he will achieve. §16 governs the two લેવલ ૪ moments in particular: the
 * one for an attempt that fell short is written to be as warm as the one for an attempt that
 * passed, because it is the same યુવક on the same સાધના and the app has no opinion about the
 * difference.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Numerals
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Every number arrives already in Gujarati digits, as a string. This module is shared with
 * the સંચાલક panel, which has its own `gu()` (admin/src/lib/format.js) separate from the
 * યુવક app's (src/lib/scenes.js); importing either one here would tie shared code to one
 * side of the app for the sake of a digit.
 */

/** A કસોટી of લેવલ ૪, passed. `code` is the કસોટી's own code, already in Gujarati digits. */
export const passedActivity = (code) => ({
  title: `અભિનંદન — લેવલ ${code} પૂરું થયું`,
  line:
    'તમે જે ધીરજથી દર્શન સાચવ્યાં એ આજે કામ લાગ્યું. આ કસોટી હવે કાયમ પૂરી ગણાશે — ' +
    'ફરી કરવી હોય તો જ્યારે મન થાય ત્યારે કરી શકાય.',
  grow: 'આમ જ એક પછી એક આગળ વધતા રહો — દરેક દર્શન સ્મરણમાં વધુ ઊંડું ઊતરે છે. જય સ્વામિનારાયણ 🙏',
});

/**
 * A કસોટી attempted, with fewer દ્રશ્યો brought to mind than its mark.
 *
 * Deliberately the same shape and the same warmth as `passedActivity` above — a title that
 * says what to do next rather than what happened, no count, no word that reads as falling
 * short, and the same closing. §16: going back to the દર્શન is an ordinary step of the
 * સાધના, so it is written as one.
 */
export const shortAttempt = () => ({
  title: 'દર્શન ફરી જોઈ લઈએ',
  line:
    'થોડાં દ્રશ્યો ફરી શાંતિથી જોઈ લો, પછી અહીં પાછા આવો. જેટલી વાર જોવું હોય એટલી વાર જોઈ ' +
    'શકાય — કંઈ ગુમાવ્યું નથી.',
  grow: 'દરેક વખતે સ્મરણ થોડું વધુ ઊંડું થાય છે — મંડ્યા રહો. જય સ્વામિનારાયણ 🙏',
});

/** Every published કસોટી of લેવલ ૪ finished. `level` is the level number, in Gujarati digits. */
export const allActivitiesDone = (level) => ({
  title: `અભિનંદન — લેવલ ${level} ની બધી કસોટીઓ પૂરી થઈ`,
  line: 'આટલી ધીરજ અને નિયમિતતા સહેલી નથી. તમે એ કરી બતાવ્યું.',
  grow:
    'સાધના અહીં અટકતી નથી — દર્શન જ્યારે જોવાં હોય ત્યારે જોઈ શકાય, અને દરેક વખતે એ વધુ ' +
    'પોતાનાં લાગશે. જય સ્વામિનારાયણ 🙏',
});

/**
 * A day of લેવલ ૩ finished — every દ્રશ્ય ticked before midnight.
 *
 * One line rather than three, because it sits at the foot of a hundred rows and not on a
 * screen of its own. `count` is already in Gujarati digits.
 */
export const dayComplete = (count) =>
  `અભિનંદન — આજનું ધ્યાન સંપૂર્ણ, ${count} દ્રશ્યો. આવતી કાલે ફરી આ જ ભાવથી. જય સ્વામિનારાયણ 🙏`;

/**
 * લેવલ ૪ earned at લેવલ ૩ — the threshold crossed, once and permanently.
 *
 * The one moment on that page worth marking: લેવલ ૩ has no 'પૂરું કરો' and no result screen,
 * so without this the crossing would pass without a word.
 */
export const levelUnlocked = (level) => ({
  title: 'અભિનંદન — આગળના લેવલ માટે જરૂરી યાદશક્તિની ચકાસણી તમે પૂરી કરી છે.',
  line: `લેવલ ${level} હવે તમારા માટે કાયમ ખુલ્લું છે.`,
  grow: 'આ જ લગન સાથે આગળ વધતા રહો — જે યાદ રહ્યું છે એ હવે તમારું છે. જય સ્વામિનારાયણ 🙏',
});

/**
 * A whole ધ્યાન session of /learn finished.
 *
 * Both numbers arrive in Gujarati digits: what he held today, and how many times he has
 * completed the ધ્યાન altogether. The second is the only running total anywhere in these
 * sentences, and it is a count of what he *has* done.
 */
export const sessionComplete = (remembered, sessions) => ({
  title: 'અભિનંદન — દર્શન સંપૂર્ણ',
  line: `તમે ${remembered} દ્રશ્યો યાદ રાખ્યાં. કુલ ${sessions} વખત ધ્યાન પૂરું કર્યું.`,
  grow: 'દર વખતે થોડું વધુ સ્મરણમાં રહી જાય છે — આમ જ મંડ્યા રહો. જય સ્વામિનારાયણ 🙏',
});
