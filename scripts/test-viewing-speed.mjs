/**
 * ────────────────────────────────────────────────────────────────────────────
 * THE યુવક'S OWN આપોઆપ SPEED, AS PURE LOGIC - `npm run test:speed`
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `shared/domain/viewing-speed.js` answers one question - how long does a દ્રશ્ય stay on
 * screen - for a યુવક who has decided it for himself. Everything in it is a pure function
 * with no database, no network and no React, so it can be tested exactly and in
 * milliseconds, which is the whole reason the presets, the bounds, the resolver and the
 * validator were pulled out of `src/pages/Settings.jsx` before that page was written.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * What this protects, and what each group is protecting against
 * ────────────────────────────────────────────────────────────────────────────
 *
 *   1. **The four presets are the requirement document's four.** 3, 5, 8 and 12 seconds are
 *      not implementation detail and they are not a starting point somebody may improve on a
 *      quiet afternoon: they are the timings the સાધના was specified with. Asserted as
 *      literals, so re-timing them is a test that goes red rather than a diff nobody reads.
 *
 *   2. **`totalMinutes()` reproduces the document's own second column.** The document lists
 *      ૫, ૯, ૧૫ and ૨૨ minutes against the four presets, and those minutes - not the seconds
 *      - are what a યુવક is actually deciding in. The module deliberately computes them
 *      instead of storing them (§62: the total is counted, never typed), which means the
 *      only thing standing between "computed" and "computed wrongly" is this file. The
 *      109-દ્રશ્યો group is the single most valuable thing here.
 *
 *   3. **A default is not an override, and the two must stay distinguishable.** The
 *      સંચાલક's `settings['app'].slideshow` is where a યુવક starts; his own choice is where
 *      he ends up. `chosen` is what tells "he picked ૫" from "the સંચાલક set ૫ and he has
 *      never opened this screen" - two states that produce the same number, only one of
 *      which may offer a way back to the default. A resolver that lost that distinction
 *      would show a "સંચાલકની ગોઠવણી પર પાછા જાઓ" control that undoes nothing.
 *
 *   4. **Nothing this module returns may reach `setTimeout` and fire immediately.** A stored
 *      preference comes out of localStorage, which is a string that this app's own older
 *      builds - or anybody with the origin's devtools - may have written. `Number('')` and
 *      `Number(null)` are both 0, so one coercing check anywhere in the resolver turns a
 *      damaged preference into a zero dwell, and ૧૦૯ દ્રશ્યો flicker past as fast as they
 *      decode. That is not a fast slideshow, it is a broken one, and the last group asserts
 *      the property over a table of hostile values rather than trusting a reading of the code.
 *
 *   5. **A value the validator accepts is a value the resolver returns unchanged.** If the
 *      two ever disagree, a યુવક is told his speed was saved and it is not the speed he
 *      saved - the exact fault every validate/resolve pair in `shared/domain/settings.js` is
 *      written to prevent, one screen along.
 *
 * No test framework, for the reason `scripts/test-domain.mjs` gives: adding one to run
 * assertions on a single module is not worth a dependency. Exit code is the result: 0 green,
 * 1 red.
 */
import {
  SPEED_PRESETS,
  SPEED_MIN_SECONDS,
  SPEED_MAX_SECONDS,
  presetForSeconds,
  presetByKey,
  totalMinutes,
  resolveViewingSpeed,
  validateViewingSpeed,
  toStoredViewingSpeed,
} from '../shared/domain/viewing-speed.js';
import {
  SLIDESHOW_MIN_SECONDS,
  SLIDESHOW_MAX_SECONDS,
  DEFAULT_SLIDESHOW,
  resolveSlideshow,
} from '../shared/domain/settings.js';

let pass = 0;
const fails = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) pass++;
  else fails.push(`${name}\n       got  ${g}\n       want ${w}`);
};

const group = (name) => console.log(`\n  ${name}`);

/**
 * Gujarati, as a Unicode block. Written as escapes rather than as literal characters on
 * purpose: a character class full of Gujarati glyphs is a class nobody can proofread in a
 * diff, and one that has been mangled by an editor's encoding looks exactly like one that
 * has not. U+0A80..U+0AFF is the whole block, and it is the assertion that a message a યુવક
 * reads was not quietly written in English.
 */
const GUJARATI = /[\u0A80-\u0AFF]/;

// ==================================================================== the four presets

/*
  The numbers the સાધના was specified with, asserted as literals.

  Everything else in this file is a rule; this group is a set of facts, and it is written the
  long way round on purpose. A test that said `SPEED_PRESETS[0].seconds === SPEED_PRESETS[0]
  .seconds` would pass for ever and protect nothing, and a test that derived the four from
  the module would be the module marking its own homework. The requirement document, page 5,
  ગતિના વિકલ્પ, says ઝડપી ૩, મધ્યમ ૫, ધીમું ૮, અતિ ધીમું ૧૨ - so those four numbers are
  written out here, once, and a tidy-up that re-times the સાધના has to go through this line.
*/
group('SPEED_PRESETS - the document\'s four, exactly');
{
  eq('there are exactly four', SPEED_PRESETS.length, 4);
  eq('the keys are the document\'s four, in its order', SPEED_PRESETS.map((p) => p.key), [
    'fast',
    'medium',
    'slow',
    'verySlow',
  ]);
  eq('and the seconds are 3 / 5 / 8 / 12', SPEED_PRESETS.map((p) => p.seconds), [3, 5, 8, 12]);

  // The order is not decoration: the chips are rendered in array order, and a list that ran
  // slow-to-fast would put અતિ ધીમું under the thumb that expects ઝડપી.
  eq('and they run fastest first', SPEED_PRESETS.map((p) => p.seconds), [...SPEED_PRESETS.map((p) => p.seconds)].sort((a, b) => a - b));

  // Every one of them is a whole number of seconds. A fractional preset would round the
  // moment it went through the resolver, so the chip would light for a number nobody stored.
  eq('every preset is a whole number of seconds', SPEED_PRESETS.every((p) => Number.isInteger(p.seconds)), true);

  /*
    A preset the custom field would refuse is an incoherent screen: the chip sets a value,
    the box beside it goes red about the value the chip just set, and nothing on the page
    explains which of the two controls is lying. So every preset has to live inside the
    bounds - and this is checked rather than eyeballed because the bounds and the presets are
    two independent lists that a later change may move apart.
  */
  eq(
    'every preset sits inside the custom range the same screen enforces',
    SPEED_PRESETS.every((p) => p.seconds >= SPEED_MIN_SECONDS && p.seconds <= SPEED_MAX_SECONDS),
    true
  );
  eq('the bounds are the document\'s 2 and 30', [SPEED_MIN_SECONDS, SPEED_MAX_SECONDS], [2, 30]);

  // The key is what gets stored and the label is what gets read. Two presets sharing a key
  // would make a stored choice ambiguous; a preset with no label would light a blank chip.
  eq('every key is unique', SPEED_PRESETS.length, new Set(SPEED_PRESETS.map((p) => p.key)).size);
  eq('every seconds value is unique', SPEED_PRESETS.length, new Set(SPEED_PRESETS.map((p) => p.seconds)).size);
  eq('every preset has a Gujarati label', SPEED_PRESETS.every((p) => GUJARATI.test(p.label)), true);

  // Frozen, because the list is read on every render of the settings screen and a caller
  // that sorted it in place would re-time the chips for everybody until the next reload.
  eq('the list is frozen', Object.isFrozen(SPEED_PRESETS), true);
  eq('and so is every entry in it', SPEED_PRESETS.every((p) => Object.isFrozen(p)), true);
}

/*
  `presetForSeconds()` matches on the NUMBER, not on a stored key, and this group is where
  that decision is held to account.

  A યુવક who types 8 into the custom box has chosen ધીમું, and a screen that highlighted the
  custom box while leaving the ધીમું chip dark would be disagreeing with itself about what he
  had just done. One number, one highlighted control - which only works if the lookup goes
  through the seconds.

  The null cases are the other half of the same rule: 4 and 7 sit between presets, and 2 and
  30 are the ends of the custom range and deliberately not presets. Returning a preset for
  any of them would light a chip the યુવક did not press.
*/
group('presetForSeconds / presetByKey - one number, one lit control');
{
  for (const p of SPEED_PRESETS) {
    eq(`${p.key} round-trips through its seconds`, presetForSeconds(p.seconds).key, p.key);
    eq(`${p.key} is found by key`, presetByKey(p.key).seconds, p.seconds);
  }

  eq('4 seconds is a custom value, not a preset', presetForSeconds(4), null);
  eq('7 seconds is a custom value, not a preset', presetForSeconds(7), null);
  eq('the floor of the custom range is not a preset', presetForSeconds(SPEED_MIN_SECONDS), null);
  eq('nor is the ceiling', presetForSeconds(SPEED_MAX_SECONDS), null);
  eq('2 explicitly', presetForSeconds(2), null);
  eq('30 explicitly', presetForSeconds(30), null);

  // Nothing throws on the values a half-written screen can hand it - this is called during
  // render with whatever the resolver produced, and an exception here is a blank page.
  eq('a number nobody could store', presetForSeconds(-1), null);
  eq('a fractional number matches nothing', presetForSeconds(7.5), null);
  eq('a numeric string is not a number', presetForSeconds('8'), null);
  eq('undefined', presetForSeconds(undefined), null);

  eq('an unknown key is null, never the first preset', presetByKey('sluggish'), null);
  eq('an empty key', presetByKey(''), null);
  eq('undefined', presetByKey(undefined), null);
  // The label is a caption, not an identity. Looking one up by its Gujarati word would start
  // working and then stop the first time a word is improved.
  eq('a label is not a key', presetByKey('ધીમું'), null);
}

// ==================================================================== the document's second column

/*
  ────────────────────────────────────────────────────────────────────────────
  THE ONE THAT MATTERS MOST. ૫, ૯, ૧૫, ૨૨ minutes at 109 દ્રશ્યો.
  ────────────────────────────────────────────────────────────────────────────

  These four numbers are copied out of the requirement document, page 5, where they stand in
  the second column of the ગતિના વિકલ્પ table beside the four presets. They are the reason
  the presets are named rather than a bare slider: "8 seconds" is a number a યુવક cannot
  picture, and "આશરે ૧૫ મિનિટ" is the same fact in the unit he is actually deciding in - how
  long am I sitting down for.

  `viewing-speed.js` deliberately does NOT store them. They are the product of the seconds and
  the size of the collection, the collection grows, and a typed total is a number that is
  right on the day it is written and quietly wrong afterwards (§62: the total is counted,
  never typed). The cost of that decision is that nothing in the module can be compared
  against the document any more - the arithmetic could drift from the specification by a
  rounding rule and no screen would say so.

  **This group is the payment.** Reproducing the document's published figures from the
  computation proves that what was specified is what is being computed. 109 is the size of the
  collection the document was written against, so it is written here as a fixture of the
  document and not read from content/darshan.json - the day a દ્રશ્ય ૧૧૦ is added, this test
  must go on asserting what the document said, and the app must go on counting.

    3 × 109 / 60 =  5.45  → ૫
    5 × 109 / 60 =  9.08  → ૯
    8 × 109 / 60 = 14.53  → ૧૫   (rounded, not floored - this is the one that would be 14)
   12 × 109 / 60 = 21.80  → ૨૨
*/
group('totalMinutes - the requirement document\'s own figures, recomputed');
{
  const DOCUMENT_SCENE_COUNT = 109;

  eq('ઝડપી (3s) is the document\'s ૫ મિનિટ', totalMinutes(3, DOCUMENT_SCENE_COUNT), 5);
  eq('મધ્યમ (5s) is the document\'s ૯ મિનિટ', totalMinutes(5, DOCUMENT_SCENE_COUNT), 9);
  eq('ધીમું (8s) is the document\'s ૧૫ મિનિટ', totalMinutes(8, DOCUMENT_SCENE_COUNT), 15);
  eq('અતિ ધીમું (12s) is the document\'s ૨૨ મિનિટ', totalMinutes(12, DOCUMENT_SCENE_COUNT), 22);

  // The same four again, driven off the preset list rather than off literals, so that a
  // preset re-timed without touching this file cannot slip past by matching a hand-written
  // pair of numbers above.
  eq(
    'the whole table, from the presets themselves',
    SPEED_PRESETS.map((p) => totalMinutes(p.seconds, DOCUMENT_SCENE_COUNT)),
    [5, 9, 15, 22]
  );

  // ધીમું is the assertion that fixes the rounding rule. 14.53 floors to 14 and rounds to
  // 15, and the document says ૧૫ - so `Math.round` is not a preference here, it is what was
  // specified, and a "tidier" Math.floor would silently disagree with the printed table.
  eq('rounded and not floored, which is what makes ધીમું ૧૫ and not ૧૪', totalMinutes(8, DOCUMENT_SCENE_COUNT) > Math.floor((8 * DOCUMENT_SCENE_COUNT) / 60), true);
}

/*
  It is a function of the collection, not a constant - which is the entire reason it is a
  function. Double the દ્રશ્યો and every row of the table roughly doubles; the "roughly" is
  rounding, and it is asserted as a bound rather than papered over.
*/
group('totalMinutes - it follows the collection, it does not describe one moment in its life');
{
  eq('218 દ્રશ્યો, the four presets', SPEED_PRESETS.map((p) => totalMinutes(p.seconds, 218)), [11, 18, 29, 44]);
  eq(
    'every one of them is within a rounding of double the 109 figure',
    SPEED_PRESETS.every((p) => Math.abs(totalMinutes(p.seconds, 218) - 2 * totalMinutes(p.seconds, 109)) <= 1),
    true
  );

  // A smaller collection than the document's is answered honestly, not with the document's
  // number - the failure that a typed table would have produced on day one of a new સંઘ.
  eq('a collection of 30 at ધીમું', totalMinutes(8, 30), 4);
  eq('a collection of 60 at મધ્યમ', totalMinutes(5, 60), 5);

  // A custom speed is on the same table as a preset. Nothing here is preset-only.
  eq('a custom 2 seconds over the document\'s collection', totalMinutes(2, 109), 4);
  eq('a custom 30 seconds over the document\'s collection', totalMinutes(30, 109), 55);
}

/*
  Zero is the answer when the count is not known, and it is a signal rather than a value: the
  screen renders nothing at all. "આશરે ૦ મિનિટ" is a confident statement that the whole
  collection takes no time, printed while the app is still finding out how big it is, and a
  યુવક reading it has been told something false rather than nothing.

  Every branch below is a real state. `useScenes().total` is `undefined` on first paint, `0`
  while the manifest is in flight, and can be a NaN from a `.length` read off a failed fetch.
*/
group('totalMinutes - an unknown collection renders nothing, never a confident zero');
{
  eq('the count is not in yet', totalMinutes(8, 0), 0);
  eq('a negative count', totalMinutes(8, -5), 0);
  eq('a NaN count', totalMinutes(8, NaN), 0);
  eq('an undefined count', totalMinutes(8, undefined), 0);
  eq('a null count', totalMinutes(8, null), 0);
  eq('a numeric string count', totalMinutes(8, '109'), 0);
  eq('an Infinity count', totalMinutes(8, Infinity), 0);

  // The speed can be missing for the same reasons, and falls the same way.
  eq('a NaN speed', totalMinutes(NaN, 109), 0);
  eq('an undefined speed', totalMinutes(undefined, 109), 0);
  eq('a null speed', totalMinutes(null, 109), 0);
  eq('a numeric string speed', totalMinutes('8', 109), 0);
  eq('an Infinity speed', totalMinutes(Infinity, 109), 0);

  /*
    …and the mirror image: a collection that really is small must never be reported as zero
    minutes, because that is indistinguishable from "not known yet" and it is not true - it
    takes three seconds, which is a minute's worth of sitting down as far as a sentence on a
    screen is concerned. `Math.max(1, ...)` in the module is that floor, and it is asserted
    here rather than trusted, since it is one character away from being deleted as redundant.
  */
  eq('one દ્રશ્ય at ઝડપી is a minute, not nothing', totalMinutes(3, 1), 1);
  eq('one દ્રશ્ય at અતિ ધીમું is a minute, not nothing', totalMinutes(12, 1), 1);
  eq('five દ્રશ્યો at ઝડપી round to 0 and are floored to 1', totalMinutes(3, 5), 1);
  eq(
    'no legitimate collection ever reports zero minutes',
    [1, 2, 5, 10, 30, 109, 500].every((n) => SPEED_PRESETS.every((p) => totalMinutes(p.seconds, n) >= 1)),
    true
  );
}

// ==================================================================== default and override

/*
  ────────────────────────────────────────────────────────────────────────────
  The સંચાલક's number is the DEFAULT. The યુવક's is the OVERRIDE.
  ────────────────────────────────────────────────────────────────────────────

  There are now two answers to "how long does a દ્રશ્ય stay on screen" and they are not in
  competition. `settings['app'].slideshow.seconds` is one number for the whole સંઘ, and it is
  what a યુવક who has never opened `/settings` gets on every device for ever. His own choice
  replaces it from the moment he makes it until he clears it.

  `chosen` is what carries that distinction, and it is not cosmetic: "he picked ૫" and "the
  સંચાલક set ૫ and he has never been here" produce the same number and must not look the same
  on screen, because only one of them has anything to undo. A screen that offered "સંચાલકની
  ગોઠવણી પર પાછા જાઓ" in both states would offer a control that visibly does nothing.
*/
group('resolveViewingSpeed - nothing stored is the સંચાલક\'s number, and says so');
{
  eq('nothing stored at all', resolveViewingSpeed(undefined, 6), { seconds: 6, chosen: false, preset: null });
  eq('an empty slot', resolveViewingSpeed(null, 6), { seconds: 6, chosen: false, preset: null });
  eq('a string where an object was expected', resolveViewingSpeed('nonsense', 6), { seconds: 6, chosen: false, preset: null });
  eq('an object with nothing in it', resolveViewingSpeed({}, 6), { seconds: 6, chosen: false, preset: null });
  eq('a number where an object was expected', resolveViewingSpeed(8, 6), { seconds: 6, chosen: false, preset: null });
  eq('an array', resolveViewingSpeed([], 6), { seconds: 6, chosen: false, preset: null });

  /*
    The two that a coercing implementation would get wrong, and they are the reason the module
    tests `typeof` rather than calling `Number()`:

      Number('')   === 0
      Number(null) === 0

    Both are finite, both survive a clamp only because the clamp would push them to 2 - and an
    implementation that reached for `Number(n) || fallback` instead would hand back 0 and the
    dwell would be nothing at all. A localStorage value written by an older build, or by a
    half-finished form that saved an empty input, arrives in exactly these two shapes.
  */
  eq('seconds is an empty string, which Number() would make 0', resolveViewingSpeed({ seconds: '' }, 6), { seconds: 6, chosen: false, preset: null });
  eq('seconds is null, which Number() would also make 0', resolveViewingSpeed({ seconds: null }, 6), { seconds: 6, chosen: false, preset: null });
  eq('seconds is an empty array, which Number() would make 0 as well', resolveViewingSpeed({ seconds: [] }, 6), { seconds: 6, chosen: false, preset: null });

  // NaN and Infinity survive both Math.min and Math.max unchanged, so a clamp on its own
  // would let them through to setTimeout - which fires immediately on a NaN.
  eq('seconds is NaN', resolveViewingSpeed({ seconds: NaN }, 6), { seconds: 6, chosen: false, preset: null });
  eq('seconds is Infinity', resolveViewingSpeed({ seconds: Infinity }, 6), { seconds: 6, chosen: false, preset: null });
  eq('seconds is -Infinity', resolveViewingSpeed({ seconds: -Infinity }, 6), { seconds: 6, chosen: false, preset: null });

  // A numeric string is refused for the same reason `resolveSlideshow()` refuses one: it is a
  // shape nothing in this app writes, so it means something else wrote it.
  eq('seconds is a numeric string', resolveViewingSpeed({ seconds: '8' }, 6), { seconds: 6, chosen: false, preset: null });
  eq('seconds is a boolean', resolveViewingSpeed({ seconds: true }, 6), { seconds: 6, chosen: false, preset: null });

  // …and when the સંચાલક's own number happens to be a preset, the chip lights even though
  // nothing was chosen. That is right: the chip shows what is in force, `chosen` shows whose
  // decision it was, and they are two different questions.
  eq('the admin default lights its chip without being a choice', resolveViewingSpeed(null, 8), { seconds: 8, chosen: false, preset: 'slow' });
}

group('resolveViewingSpeed - a stored choice is his, and is honoured');
{
  eq('the ordinary case', resolveViewingSpeed({ seconds: 8 }, 5), { seconds: 8, chosen: true, preset: 'slow' });
  eq('ઝડપી', resolveViewingSpeed({ seconds: 3 }, 5), { seconds: 3, chosen: true, preset: 'fast' });
  eq('અતિ ધીમું', resolveViewingSpeed({ seconds: 12 }, 5), { seconds: 12, chosen: true, preset: 'verySlow' });
  eq('a custom value between two presets', resolveViewingSpeed({ seconds: 7 }, 5), { seconds: 7, chosen: true, preset: null });
  eq('the floor of the custom range', resolveViewingSpeed({ seconds: 2 }, 5), { seconds: 2, chosen: true, preset: null });
  eq('the ceiling of the custom range', resolveViewingSpeed({ seconds: 30 }, 5), { seconds: 30, chosen: true, preset: null });

  // A choice that happens to equal the admin's number is still a choice. This is the pair
  // that `chosen` exists for, asserted side by side so the two cannot be collapsed later.
  eq('he picked 5 himself', resolveViewingSpeed({ seconds: 5 }, 5).chosen, true);
  eq('the સંચાલક set 5 and he has never been here', resolveViewingSpeed(null, 5).chosen, false);
  eq('…and both produce the same number', [resolveViewingSpeed({ seconds: 5 }, 5).seconds, resolveViewingSpeed(null, 5).seconds], [5, 5]);

  /*
    Out of range is CLAMPED, not discarded, and `chosen` stays true - the two halves of one
    decision.

    A stored 45 was a real intention once: he meant slow. The nearest thing this module is
    allowed to give him is 30, which is nearer to what he asked for than silently reverting to
    the સંચાલક's ૬. And it is still HIS number, so the screen must go on offering him the way
    back to the default; flipping `chosen` to false on a clamp would take that control away
    from a યુવક who has plainly used this screen.
  */
  eq('above the ceiling clamps down', resolveViewingSpeed({ seconds: 45 }, 6), { seconds: 30, chosen: true, preset: null });
  eq('below the floor clamps up', resolveViewingSpeed({ seconds: 1 }, 6), { seconds: 2, chosen: true, preset: null });
  eq('zero clamps up to the floor', resolveViewingSpeed({ seconds: 0 }, 6), { seconds: 2, chosen: true, preset: null });
  eq('a negative value clamps up to the floor', resolveViewingSpeed({ seconds: -30 }, 6), { seconds: 2, chosen: true, preset: null });
  eq('an absurd value clamps down', resolveViewingSpeed({ seconds: 86400 }, 6), { seconds: 30, chosen: true, preset: null });
  eq('a clamp is still a choice', [
    resolveViewingSpeed({ seconds: 45 }, 6).chosen,
    resolveViewingSpeed({ seconds: 1 }, 6).chosen,
  ], [true, true]);

  // Rounded, not floored - 7.6s is nearer 8 than 7, and nothing here is safer either way, so
  // the arithmetic that is simply more accurate wins. Same rule as `resolveSlideshow()`.
  eq('fractional rounds down', resolveViewingSpeed({ seconds: 7.4 }, 6).seconds, 7);
  eq('fractional rounds up', resolveViewingSpeed({ seconds: 7.6 }, 6).seconds, 8);
  eq('…and a rounded-up value lights the preset it landed on', resolveViewingSpeed({ seconds: 7.6 }, 6).preset, 'slow');
  // Rounding must not be able to land outside the bound it was clamped into.
  eq('1.4 rounds to 1 and is then clamped to the floor', resolveViewingSpeed({ seconds: 1.4 }, 6).seconds, 2);
  eq('30.4 rounds to 30', resolveViewingSpeed({ seconds: 30.4 }, 6).seconds, 30);
  eq('30.6 rounds to 31 and is then clamped to the ceiling', resolveViewingSpeed({ seconds: 30.6 }, 6).seconds, 30);
}

/*
  The સંચાલક's number is not this module's to correct.

  His bound is 1-60 (`shared/domain/settings.js`, enforced by the trigger in 0018) and the
  યુવક's is 2-30, and the difference is deliberate: 1-60 is what one person setting a default
  for two thousand others may choose, including the deliberately slow end used for a hall
  watching together. 2-30 is what a યુવક may do to his own દર્શન by tapping.

  So a default of 45, or of 1, is honoured exactly as it stands when nothing is stored.
  Clamping it here would silently change a setting this module does not own, and would produce
  the worst possible symptom: the panel showing ૪૫ while every phone ran at ૩૦, with nothing
  on either screen to say which was in force.
*/
group('resolveViewingSpeed - the સંચાલક\'s 1-60 is his, and is not clamped into 2-30');
{
  eq('45 seconds, above the યુવક ceiling, stands', resolveViewingSpeed(null, 45), { seconds: 45, chosen: false, preset: null });
  eq('1 second, below the યુવક floor, stands', resolveViewingSpeed(null, 1), { seconds: 1, chosen: false, preset: null });
  eq('his ceiling stands', resolveViewingSpeed(undefined, SLIDESHOW_MAX_SECONDS), { seconds: 60, chosen: false, preset: null });
  eq('his floor stands', resolveViewingSpeed(undefined, SLIDESHOW_MIN_SECONDS), { seconds: 1, chosen: false, preset: null });
  eq('his default stands', resolveViewingSpeed(undefined, DEFAULT_SLIDESHOW.seconds).seconds, DEFAULT_SLIDESHOW.seconds);

  // Every value his own resolver can produce arrives here intact. This is the join between
  // the two modules, and it is asserted across his whole range rather than at three points.
  let honoured = true;
  for (let n = SLIDESHOW_MIN_SECONDS; n <= SLIDESHOW_MAX_SECONDS; n++) {
    if (resolveViewingSpeed(null, resolveSlideshow({ seconds: n }).seconds).seconds !== n) honoured = false;
  }
  eq('every number the સંચાલક can save reaches an unconfigured phone unchanged', honoured, true);

  // A fractional default is rounded rather than refused - his field cannot produce one, so a
  // fraction here came from somewhere else and the nearest whole second is the honest answer.
  eq('a fractional default rounds', resolveViewingSpeed(null, 6.6).seconds, 7);
  eq('…and a fraction just above his floor rounds to his floor', resolveViewingSpeed(null, 0.6).seconds, 1);

  /*
    ────────────────────────────────────────────────────────────────────────────
    REGRESSION - a sub-half-second default used to round to a dwell of ZERO
    ────────────────────────────────────────────────────────────────────────────

    This is written out as its own block, with its own reasoning, because it is a fault that
    was live in this module until the `Math.max(1, ...)` went into the fallback, and because
    the shape of it is the reason it survived review.

    The guard admits `adminSeconds` on three tests - a number, finite, above zero - and *then*
    rounds. 0.4 passes all three and `Math.round(0.4)` is **0**. A zero dwell is not a fast
    slideshow: it is `setTimeout(fn, 0)` firing on the next tick, ૧૦૯ દ્રશ્યો advancing as
    fast as they decode, and a યુવક who cannot stop it by pressing anything because the દ્રશ્ય
    he is reaching for has already been replaced.

    **It arrived through the DEFAULT, not through anything he stored.** That is the whole
    reason it hid. Every clamp in this module - the `Math.min`/`Math.max` into 2-30, the
    `typeof` test that catches `''` and `null`, the finiteness check - sits on the *stored*
    branch, below this line and after the early return. None of them is on the path a value
    takes when nothing has been stored, so none of them would ever have seen this number. A
    reading of the code that satisfies itself the clamping is thorough is a reading that has
    looked at the wrong half of the function.

    Nothing in the app could deliver one: the parameter is documented as already resolved and
    `resolveSlideshow()` clamps to 1..60 before rounding. That made it unreachable, which is
    not the same as safe - "the caller already checked" stops being true the day a second
    caller appears, and this module is the last thing between a number and a timer.
  */
  eq('a fraction below half a second is a dwell of one, never of zero', resolveViewingSpeed(null, 0.4).seconds, 1);
  eq('…however small it gets', [
    resolveViewingSpeed(null, 0.1).seconds,
    resolveViewingSpeed(null, 0.0001).seconds,
    resolveViewingSpeed(null, 1e-9).seconds,
    resolveViewingSpeed(null, Number.MIN_VALUE).seconds,
  ], [1, 1, 1, 1]);
  eq('…and it is still the default, not a choice', resolveViewingSpeed(null, 0.4), { seconds: 1, chosen: false, preset: null });

  /*
    The other half of that floor, and it is not a formality.

    The floor is 1 and deliberately NOT SPEED_MIN_SECONDS. Two is the tidier-looking number -
    it is this module's own minimum, it sits right there in the file - and raising the floor
    to it would silently overrule the સંચાલક, whose range is 1-60 and for whom 1 is a legal,
    deliberate setting. The 2-30 bound governs what a યુવક may choose for himself and has
    never governed the default he starts from.

    So this is asserted as a number rather than as `>= SPEED_MIN_SECONDS`: a later tidy-up
    that unified the two floors would leave a panel reading ૧ while every phone that has never
    opened /settings ran at ૨, with nothing on either screen to say which was in force.
  */
  eq('the સંચાલક\'s legal minimum of 1 comes back as exactly 1', resolveViewingSpeed(null, 1).seconds, 1);
  eq('…and is NOT raised to the યુવક\'s floor', resolveViewingSpeed(null, 1).seconds === SPEED_MIN_SECONDS, false);
  eq('…nor is a 1 that arrived by rounding', resolveViewingSpeed(null, 1.4).seconds, 1);
  eq('…and 2 is still 2, so the floor did not overshoot the other way', resolveViewingSpeed(null, 2).seconds, 2);

  /*
    …and when his number is missing or damaged there is still a running slideshow. This is the
    branch that runs on the worst day: the settings read failed, or the row was written by a
    build newer than this one. The answer is મધ્યમ - the middle preset, and the one number in
    this file that is a judgement rather than a specification.
  */
  const MEDIUM = SPEED_PRESETS[1].seconds;
  for (const [what, admin] of [
    ['no default at all', undefined],
    ['a null default', null],
    ['a string default', 'nonsense'],
    ['a numeric string default', '6'],
    ['a NaN default', NaN],
    ['an Infinity default', Infinity],
    ['a zero default', 0],
    ['a negative default', -5],
    ['an object default', {}],
    ['a boolean default', true],
  ]) {
    eq(`${what}: falls back to મધ્યમ`, resolveViewingSpeed(null, admin), { seconds: MEDIUM, chosen: false, preset: 'medium' });
    eq(`${what}: and a stored choice still wins over it`, resolveViewingSpeed({ seconds: 12 }, admin).seconds, 12);
  }
}

// ==================================================================== the setTimeout property

/*
  ────────────────────────────────────────────────────────────────────────────
  The property that protects the timer, over everything that can reach it
  ────────────────────────────────────────────────────────────────────────────

  Everything above is a case. This is the rule they are all instances of, and it is asserted
  as a loop because the value that breaks it will be a shape nobody wrote a case for.

  `resolveViewingSpeed().seconds` is multiplied by 1000 and handed to `setTimeout`. A 0, a
  negative or a NaN all mean the same thing there - fire on the next tick - and ૧૦૯ દ્રશ્યો
  advancing on the next tick is not a fast slideshow, it is a broken one that a યુવક cannot
  stop by pressing anything, because the next દ્રશ્ય has already replaced the one he was
  reaching for. A non-integer is the quieter cousin: it works, and it makes the number the
  screen prints disagree with the number the timer uses.

  The invariant, stated once so it cannot be argued with later:

      Number.isInteger(seconds) && seconds >= 1

  Not `>= SPEED_MIN_SECONDS`. Two is what a યુવક may CHOOSE; one is what the સંચાલક may SET,
  and both are legitimate answers coming out of this function. The floor the timer needs is 1.

  The stored side of the table is everything localStorage can hold after `JSON.parse`, plus
  the shapes a partly-written form produces. The admin side is everything a jsonb column can
  hold, fractions below a second included - that is where this loop found a real zero dwell
  (see the regression block above), and it found it because the table was not trimmed to the
  values the contract was expected to deliver. Every combination of the two is checked, which
  is why this is a loop and not a list.
*/
group('resolveViewingSpeed - never returns something setTimeout would fire immediately on');
{
  const HOSTILE_STORED = [
    undefined,
    null,
    0,
    -1,
    NaN,
    Infinity,
    '',
    'nonsense',
    '{"seconds":8}',
    true,
    false,
    [],
    [8],
    {},
    { seconds: null },
    { seconds: '' },
    { seconds: NaN },
    { seconds: Infinity },
    { seconds: -Infinity },
    { seconds: 0 },
    { seconds: -5 },
    { seconds: -0 },
    { seconds: [] },
    { seconds: [8] },
    { seconds: {} },
    { seconds: '8' },
    { seconds: true },
    { seconds: 0.4 },
    { seconds: 2.5 },
    { seconds: 45 },
    { seconds: 1e9 },
    { seconds: -1e9 },
    { seconds: Number.MAX_SAFE_INTEGER },
    { seconds: 8, extra: 'ignored' },
    JSON.parse('{"seconds":null}'),
    Object.freeze({ seconds: 8 }),
  ];
  /*
    The admin side is everything a jsonb column can hold, fractions below one INCLUDED.

    They were briefly excluded from this table, while `resolveViewingSpeed()` still rounded
    `adminSeconds` without a floor and 0.4 came back as a dwell of zero. That exclusion was the
    wrong instinct and it is worth saying why: a property table that is trimmed until it passes
    has stopped being a property test and become a list of the cases that happen to work. The
    loop exists precisely to catch the value nobody wrote a case for, and narrowing it to the
    values the current contract can deliver removes the only thing it was built to do.

    So they are back, asserting the real invariant below - a whole number of seconds, one or
    more - and the named regression above pins the specific number that got in.
  */
  const HOSTILE_ADMIN = [6, 5, 1, 60, 0, -1, 0.4, 0.1, 0.0001, 1e-9, 1.4, 6.6, 59.6, NaN, Infinity, undefined, null, '', '6', {}, [], true];

  const broken = [];
  for (const stored of HOSTILE_STORED) {
    for (const admin of HOSTILE_ADMIN) {
      let out;
      try {
        out = resolveViewingSpeed(stored, admin);
      } catch (err) {
        broken.push(`threw: ${JSON.stringify(stored)} / ${JSON.stringify(admin)} - ${err.message}`);
        continue;
      }
      const label = `${JSON.stringify(stored)} / ${JSON.stringify(admin)}`;
      if (typeof out !== 'object' || out === null) broken.push(`not an object: ${label}`);
      else if (typeof out.seconds !== 'number') broken.push(`seconds is not a number: ${label}`);
      else if (!Number.isFinite(out.seconds)) broken.push(`seconds is not finite: ${label}`);
      else if (!Number.isInteger(out.seconds)) broken.push(`seconds is not a whole number: ${label}`);
      // `< 1`, not `<= 0`: 0.4 as an adminSeconds once produced exactly 0 here, and a bound
      // written as "positive" rather than as "at least one second" is a bound that a future
      // fractional dwell would satisfy on its way to the timer.
      else if (out.seconds < 1) broken.push(`seconds is ${out.seconds}: ${label}`);
      else if (typeof out.chosen !== 'boolean') broken.push(`chosen is not a boolean: ${label}`);
      else if (out.preset !== null && !presetByKey(out.preset)) broken.push(`preset names nothing: ${label}`);
    }
  }
  eq('a whole number of seconds, one or more, always', broken, []);
  eq('…checked over the whole table, or it proves nothing', HOSTILE_STORED.length * HOSTILE_ADMIN.length > 400, true);

  // Reading a preference must not rewrite it. The stored object comes straight out of
  // JSON.parse and is handed to React state; a resolver that mutated it would change what the
  // screen believes was saved without saving anything.
  const before = { seconds: 45 };
  const snapshot = JSON.stringify(before);
  resolveViewingSpeed(before, 6);
  eq('the stored object is never mutated', JSON.stringify(before), snapshot);
  eq('…not even when it is frozen', resolveViewingSpeed(Object.freeze({ seconds: 45 }), 6).seconds, 30);
}

// ==================================================================== the refusals

/*
  `validateViewingSpeed()` refuses exactly what the resolver would have clamped, and the
  division of labour is the same one every validate/resolve pair in this codebase draws.

  The resolver forgives because a stored value must always produce a running slideshow. This
  refuses because a યુવક typing 45 into the custom box should be TOLD the ceiling is 30, not
  watch it quietly become 30 and be left wondering whether the box took what he typed.

  And unlike every other validator in `shared/domain`, these messages are in Gujarati, because
  a યુવક reads them. The panel's are in English because a સંચાલક reads those. That is not a
  detail to be tidied into consistency: an English sentence under a Gujarati input is a
  sentence a યુવક cannot act on, which makes the refusal worse than no refusal at all.
*/
group('validateViewingSpeed - what is accepted');
{
  eq('the floor', validateViewingSpeed(2), { ok: true, seconds: 2 });
  eq('the middle', validateViewingSpeed(15), { ok: true, seconds: 15 });
  eq('the ceiling', validateViewingSpeed(30), { ok: true, seconds: 30 });
  eq('every preset is a legal thing to type into the custom box', SPEED_PRESETS.every((p) => validateViewingSpeed(p.seconds).ok), true);
}

group('validateViewingSpeed - what is refused, and in the યુવક\'s own language');
{
  const REFUSED = [
    ['just below the floor', 1],
    ['just above the ceiling', 31],
    ['zero, which is no dwell at all', 0],
    ['negative', -5],
    ['far above the ceiling', 600],
    ['fractional', 2.5],
    ['fractional near the middle', 8.5],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['-Infinity', -Infinity],
    ['a numeric string, which the resolver would also refuse', '8'],
    ['an empty string', ''],
    ['null', null],
    ['undefined', undefined],
    ['a boolean', true],
    ['an array', []],
    ['an object', {}],
    ['the whole stored shape, rather than the number inside it', { seconds: 8 }],
  ];

  for (const [what, value] of REFUSED) {
    eq(`refused: ${what}`, validateViewingSpeed(value).ok, false);
  }

  // Every refusal carries a sentence. A `{ ok: false }` with nothing on it is a red box with
  // no words in it, which tells a યુવક only that he is wrong and never how.
  eq(
    'every refusal explains itself',
    REFUSED.every(([, v]) => typeof validateViewingSpeed(v).gu === 'string' && validateViewingSpeed(v).gu.trim().length > 0),
    true
  );
  eq(
    'and every one of them is written in Gujarati',
    REFUSED.every(([, v]) => GUJARATI.test(validateViewingSpeed(v).gu)),
    true
  );

  // The out-of-range message names both ends rather than saying only "wrong" - it is what he
  // reads at the exact moment he is wrong about them.
  const outOfRange = validateViewingSpeed(45).gu;
  eq('the out-of-range refusal names both bounds', outOfRange.includes(String(SPEED_MIN_SECONDS)) && outOfRange.includes(String(SPEED_MAX_SECONDS)), true);

  // The three refusals are three different sentences. One message for every fault would tell
  // a યુવક who typed 2.5 that the range is 2-30, which is true and unhelpful.
  const messages = new Set([
    validateViewingSpeed('8').gu,
    validateViewingSpeed(2.5).gu,
    validateViewingSpeed(45).gu,
  ]);
  eq('a wrong type, a fraction and an out-of-range value are told apart', messages.size, 3);
}

/*
  ────────────────────────────────────────────────────────────────────────────
  validate and resolve must agree, or "સાચવ્યું" is a lie
  ────────────────────────────────────────────────────────────────────────────

  If the validator accepted a value the resolver then changed, the screen would confirm the
  save, store what he typed, and run at a different speed the next time he opened દર્શન - with
  nothing anywhere to say the two were different numbers. That is the fault every validator in
  `shared/domain/settings.js` is written to avoid, and it is checked here across the whole
  range the custom field can produce plus a margin on both sides.
*/
group('validateViewingSpeed / resolveViewingSpeed - a value accepted is a value kept');
{
  const disagreed = [];
  for (let n = 1; n <= 35; n++) {
    const accepted = validateViewingSpeed(n).ok;
    const resolved = resolveViewingSpeed({ seconds: n }, 5).seconds;
    if (accepted && resolved !== n) disagreed.push(`${n} accepted, resolved to ${resolved}`);
    // …and the other direction, so that the validator cannot be quietly widened either: a
    // value the resolver has to clamp must not be one the box said yes to.
    if (!accepted && resolved === n) disagreed.push(`${n} refused, yet kept unchanged`);
  }
  eq('across 1..35, every accepted value survives the resolver untouched', disagreed, []);

  // The bounds themselves, stated as the same fact from both sides.
  eq('the accepted range is exactly SPEED_MIN..SPEED_MAX', [
    validateViewingSpeed(SPEED_MIN_SECONDS - 1).ok,
    validateViewingSpeed(SPEED_MIN_SECONDS).ok,
    validateViewingSpeed(SPEED_MAX_SECONDS).ok,
    validateViewingSpeed(SPEED_MAX_SECONDS + 1).ok,
  ], [false, true, true, false]);
}

// ==================================================================== storage

/*
  What actually goes into localStorage.

  One field, deliberately: a later addition to this screen must not be able to drop the speed
  by writing a second key over the top of the first. And it has to survive the only journey it
  ever makes - `JSON.stringify` on the way in, `JSON.parse` on the way out - and come back
  through the resolver as the same number. That round trip is the whole contract between this
  module and the device, so it is asserted rather than assumed.
*/
group('toStoredViewingSpeed - the round trip through localStorage');
{
  eq('the shape is one field', toStoredViewingSpeed(8), { seconds: 8 });
  eq('and it carries nothing else', Object.keys(toStoredViewingSpeed(8)), ['seconds']);

  const trip = (n) => JSON.parse(JSON.stringify(toStoredViewingSpeed(n)));
  for (const p of SPEED_PRESETS) {
    eq(`${p.key} survives the round trip`, trip(p.seconds), { seconds: p.seconds });
    eq(`…and resolves back to itself, as his choice`, resolveViewingSpeed(trip(p.seconds), 6), {
      seconds: p.seconds,
      chosen: true,
      preset: p.key,
    });
  }

  for (const n of [2, 7, 15, 29, 30]) {
    eq(`a custom ${n} survives the round trip and the resolver`, resolveViewingSpeed(trip(n), 6), {
      seconds: n,
      chosen: true,
      preset: presetForSeconds(n)?.key ?? null,
    });
  }

  // Everything the validator accepts can be stored and read back as itself. The three
  // functions form one loop - type, validate, store, resolve - and this is that loop closed.
  const lost = [];
  for (let n = SPEED_MIN_SECONDS; n <= SPEED_MAX_SECONDS; n++) {
    if (!validateViewingSpeed(n).ok) lost.push(`${n} refused`);
    const back = resolveViewingSpeed(trip(n), 6);
    if (back.seconds !== n) lost.push(`${n} came back as ${back.seconds}`);
    if (!back.chosen) lost.push(`${n} came back as not chosen`);
  }
  eq('every value in the custom range makes the whole round trip intact', lost, []);

  // Clearing the choice is how he goes back to the સંચાલક's number, and it is the same path
  // as never having chosen - which is what makes the "back to default" control honest.
  eq('a cleared preference is the admin default again', resolveViewingSpeed(JSON.parse('null'), 6), { seconds: 6, chosen: false, preset: null });
}

// ==================================================================== result

console.log(`\n  ${pass} passed, ${fails.length} failed\n`);
if (fails.length) {
  console.log(fails.map((f) => `  ✗ ${f}`).join('\n\n') + '\n');
  process.exit(1);
}
