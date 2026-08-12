/**
 * Tests for the લેવલ ૪ selection engine — `node scripts/test-level4.mjs`.
 *
 * Same shape as scripts/test-domain.mjs and for the same reason: everything in
 * shared/domain/level4-selection.js is a pure function over plain data, so it can be tested
 * exactly, cheaply and without a framework. Exit code is the result: 0 green, 1 red.
 *
 * What this protects, specifically — every one of these fails *silently* in production:
 *
 *   1. **The division itself.** A દ્રશ્ય in two પ્રવૃત્તિઓ hands out the second one for free
 *      (§2.2's coverage rule); a દ્રશ્ય in none is never learned; an auto-division that
 *      loses one leaves a યુવક a પ્રવૃત્તિ short with nothing on screen to say so.
 *
 *   2. **Printed number ≠ array position** (§25). `slice(from - 1, to)` passes every test
 *      written against a collection numbered 1…n in order, and selects the wrong દ્રશ્યો
 *      the day the સંચાલક renumbers one. So the fixtures below are deliberately renumbered,
 *      reordered and gapped.
 *
 *   3. **The sparse-overlay trade** (§1). There is no foreign key behind
 *      `level4_activity_items.scene_id`, so "this દ્રશ્ય does not exist" and "this દ્રશ્ય is
 *      not published" are caught here or they are not caught at all.
 *
 * The literal totals in these fixtures are fixtures — the module under test never sees a
 * number it did not count itself, which is what the last group asserts.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { darshanId } from '../shared/domain/darshan.js';
import {
  expandRange,
  autoDivide,
  findDuplicates,
  findMissing,
  findInvalid,
  validateAssignment,
  orderSceneIds,
  searchScenes,
  summarise,
} from '../shared/domain/level4-selection.js';

let pass = 0;
const fails = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) pass++;
  else fails.push(`${name}\n       got  ${g}\n       want ${w}`);
};

const group = (name) => console.log(`\n  ${name}`);

// ==================================================================== fixtures

/** A દ્રશ્ય in the manifest's shape — what `useScenes()` hands back. */
const scene = (n, extra = {}) => ({
  id: darshanId(n),
  n,
  index: n,
  order: n,
  t: `દ્રશ્ય ${n} — સાગરકિનારે ઊભેલા વર્ણીનું દર્શન`,
  url: `https://lh3.googleusercontent.com/d/id-${n}=w1600-rj-v1`,
  ...extra,
});

/** The same દ્રશ્ય in the panel's DarshanItem shape — what `listDarshan()` hands back. */
const item = (n, extra = {}) => ({
  id: darshanId(n),
  index: n,
  order: n,
  active: true,
  caption: `દ્રશ્ય ${n} — સાગરકિનારે ઊભેલા વર્ણીનું દર્શન`,
  imageUrl: `https://lh3.googleusercontent.com/d/id-${n}=w1600-rj-v1`,
  ...extra,
});

const numbers = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const scenes = (a, b) => numbers(a, b).map((n) => scene(n));
const ids = (...ns) => ns.map(darshanId);

/** Twelve દ્રશ્યો, numbered 1…12. The ordinary case. */
const TWELVE = scenes(1, 12);

/** A hundred and nine, one of which (૪૭) was never issued — the live collection's shape. */
const GAPPED = numbers(1, 109).filter((n) => n !== 47).map((n) => scene(n));

const assign = (obj) => Object.entries(obj).map(([activityKey, sceneIds]) => ({ activityKey, sceneIds }));

// ==================================================================== expandRange

group('expandRange — printed numbers in, stable ids out');
{
  const got = expandRange(TWELVE, 3, 6);
  eq('the range names four દ્રશ્યો', got, ids(3, 4, 5, 6));
  eq('and they are ids, never positions', got[0], 'darshan-003');
}
eq('from > to is the same range said backwards', expandRange(TWELVE, 6, 3), ids(3, 4, 5, 6));
eq('a single number is a range of one', expandRange(TWELVE, 5, 5), ids(5));
eq('Gujarati digits are the same numbers', expandRange(TWELVE, '૩', '૬'), ids(3, 4, 5, 6));
eq('a number typed with punctuation still reads', expandRange(TWELVE, ' 3. ', '6'), ids(3, 4, 5, 6));

group('expandRange — endpoints that do not exist');
eq('a gap inside the range is skipped, not invented', expandRange(GAPPED, 45, 49), ids(45, 46, 48, 49));
eq('a range past the end selects what exists', expandRange(TWELVE, 10, 200).length, 3);
eq('…and never invents the rest', expandRange(TWELVE, 10, 200), ids(10, 11, 12));
eq('a range entirely outside the collection is empty', expandRange(TWELVE, 50, 60), []);
eq('an empty collection has nothing in any range', expandRange([], 1, 30), []);
eq('an unreadable endpoint selects nothing rather than guessing', expandRange(TWELVE, '', 6), []);
eq('…either end', expandRange(TWELVE, 1, 'ક'), []);

group('expandRange — array position is never identity (§25)');
{
  // દ્રશ્ય ૫૦ presented first, દ્રશ્ય ૧ presented last: the સંચાલક renumbered and reordered.
  const shuffled = [scene(50, { order: 1 }), scene(1, { order: 2 }), scene(9, { order: 3 })];
  eq('the range reads printed numbers, not slice()', expandRange(shuffled, 1, 9), ids(1, 9));
  eq('…and returns them in the collection’s own order', expandRange(shuffled, 1, 50), ids(50, 1, 9));
}
{
  // A withheld દ્રશ્ય inside the range is kept so validateAssignment can name it. Dropping
  // it silently would shrink the સંચાલક's range with no reason given.
  const withOne = [...scenes(1, 3), scene(4, { t: '' })];
  eq('a withheld દ્રશ્ય in the range is kept, not quietly dropped', expandRange(withOne, 1, 4), ids(1, 2, 3, 4));
}

// ==================================================================== autoDivide

/** Every id exactly once, in order, in `parts` buckets — the only thing autoDivide promises. */
const dividesCleanly = (list, parts) => {
  const out = autoDivide(list, parts);
  const flat = out.flat();
  const sizes = out.map((p) => p.length);
  return {
    parts: out.length,
    covered: JSON.stringify(flat) === JSON.stringify(list),
    unique: new Set(flat).size === flat.length,
    spread: sizes.length ? Math.max(...sizes) - Math.min(...sizes) : 0,
    sizes,
  };
};

group('autoDivide — a convenience, but the arithmetic is not optional (§6)');
{
  const list = GAPPED.map((s) => s.id);
  const r = dividesCleanly(list, 4);
  eq('૧૦૮ દ્રશ્યો into 4 — every id, exactly once, in order', [r.parts, r.covered, r.unique], [4, true, true]);
  eq('…sizes differ by at most one', r.spread <= 1, true);
  eq('…and the remainder goes to the earliest parts', r.sizes, [27, 27, 27, 27]);
}
{
  const r = dividesCleanly(ids(...numbers(1, 109)), 4);
  eq('109 into 4 is 28/27/27/27, not 27/27/27/28', r.sizes, [28, 27, 27, 27]);
  eq('…and still covers everything once', [r.covered, r.unique], [true, true]);
}
{
  const r = dividesCleanly(ids(...numbers(1, 10)), 3);
  eq('10 into 3', r.sizes, [4, 3, 3]);
  eq('…no gap, no overlap', [r.covered, r.unique], [true, true]);
}
{
  const r = dividesCleanly(ids(...numbers(1, 7)), 7);
  eq('7 into 7 is one each', r.sizes, [1, 1, 1, 1, 1, 1, 1]);
  eq('…no gap, no overlap', [r.covered, r.unique], [true, true]);
}
{
  const r = dividesCleanly(ids(...numbers(1, 5)), 8);
  eq('5 into 8 keeps all eight boxes the સંચાલક asked for', r.sizes, [1, 1, 1, 1, 1, 0, 0, 0]);
  eq('…and is still the same rule: sizes differ by at most one', r.spread <= 1, true);
  eq('…covering every id once', [r.covered, r.unique], [true, true]);
}
eq('an empty selection still returns the boxes asked for', autoDivide([], 3), [[], [], []]);
eq('zero parts divides into nothing', autoDivide(ids(1, 2, 3), 0), []);
eq('a negative count divides into nothing', autoDivide(ids(1, 2), -2), []);
eq('a missing count divides into nothing', autoDivide(ids(1, 2)), []);
eq('a fractional count is read as whole parts', autoDivide(ids(1, 2, 3), 2.7).length, 2);
eq('a repeated id is placed once, not in two parts', autoDivide(['a', 'b', 'a'], 2), [['a'], ['b']]);
{
  // Every awkward pair, checked rather than argued about.
  const bad = [];
  for (let n = 0; n <= 40; n++) {
    const list = ids(...numbers(1, n)).slice(0, n);
    for (let p = 1; p <= 12; p++) {
      const r = dividesCleanly(list, p);
      if (!r.covered || !r.unique || r.parts !== p || r.spread > 1) bad.push(`${n}/${p}`);
    }
  }
  eq('every count from 0…40 into 1…12 parts covers all, once, evenly', bad, []);
}

// ==================================================================== the seven findings

group('findDuplicates — §7 A, a દ્રશ્ય in two પ્રવૃત્તિઓ');
eq(
  'the shared દ્રશ્ય is named, with both પ્રવૃત્તિઓ',
  findDuplicates(assign({ '4.1': ids(1, 2, 3), '4.2': ids(3, 4) })),
  [{ sceneId: darshanId(3), activityKeys: ['4.1', '4.2'] }]
);
eq('a clean partition has none', findDuplicates(assign({ '4.1': ids(1, 2), '4.2': ids(3, 4) })), []);
eq(
  'a દ્રશ્ય listed twice inside one પ્રવૃત્તિ is reported too — the PK would refuse it',
  findDuplicates(assign({ '4.1': ids(1, 1) })),
  [{ sceneId: darshanId(1), activityKeys: ['4.1', '4.1'] }]
);
eq('nothing assigned, nothing duplicated', findDuplicates([]), []);

group('findMissing — §7 B, દ્રશ્યો in no પ્રવૃત્તિ');
eq(
  'the unassigned દ્રશ્યો, in collection order',
  findMissing(assign({ '4.1': ids(1, 2, 3) }), TWELVE.slice(0, 5)),
  ids(4, 5)
);
eq('a full division misses nothing', findMissing(assign({ '4.1': TWELVE.map((s) => s.id) }), TWELVE), []);
{
  // A દ્રશ્ય with no વર્ણન is missing from દર્શન, not from લેવલ ૪. Reporting it here would
  // be unsatisfiable: assigning it raises §7 E, leaving it raises §7 B.
  const half = [...scenes(1, 2), scene(3, { t: '' })];
  eq('an unlearnable દ્રશ્ય is not "missing from લેવલ ૪"', findMissing(assign({ '4.1': ids(1, 2) }), half), []);
}
eq('an empty collection is never missing anything', findMissing([], []), []);

group('findInvalid — §7 D and E');
eq(
  'an id the collection has never heard of',
  findInvalid(assign({ '4.1': [...ids(1, 2), 'darshan-999'] }), TWELVE),
  ['darshan-999']
);
{
  const half = [...scenes(1, 2), scene(3, { t: '' }), scene(4, { url: '' }), scene(5, { active: false })];
  eq(
    'a દ્રશ્ય with no વર્ણન, one with no picture and one hidden are all withheld',
    findInvalid(assign({ '4.1': ids(1, 2, 3, 4, 5) }), half),
    ids(3, 4, 5)
  );
}
eq('a valid assignment has none', findInvalid(assign({ '4.1': ids(1, 2) }), TWELVE), []);

// ==================================================================== validateAssignment

const codes = (r) => [...r.errors, ...r.warnings].map((e) => e.code);
const errorCodes = (r) => r.errors.map((e) => e.code);
const warnCodes = (r) => r.warnings.map((e) => e.code);

group('validateAssignment — §45 case 1: equal division');
{
  const parts = autoDivide(TWELVE.map((s) => s.id), 4);
  const assignments = parts.map((sceneIds, i) => ({ activityKey: `a${i}`, sceneIds }));
  const r = validateAssignment({ assignments, collection: TWELVE, requireFullCoverage: true });
  eq('an auto-division of the whole દર્શન is valid under full coverage', [r.ok, codes(r)], [true, []]);
}

group('validateAssignment — §45 case 2: unequal custom division');
{
  const r = validateAssignment({
    assignments: assign({ '4.1': ids(1, 2), '4.2': ids(3, 4, 5, 6, 7, 8, 9, 10, 11, 12) }),
    collection: TWELVE,
    requireFullCoverage: true,
  });
  eq('sizes the સંચાલક chose are his to choose', [r.ok, codes(r)], [true, []]);
}

group('validateAssignment — §45 case 3: individual, non-contiguous picks');
{
  const r = validateAssignment({
    assignments: assign({ '4.1': ids(2, 7, 11), '4.2': ids(1, 3, 4, 5, 6, 8, 9, 10, 12) }),
    collection: TWELVE,
    requireFullCoverage: true,
  });
  eq('a hand-picked, scattered પ્રવૃત્તિ is perfectly valid', [r.ok, codes(r)], [true, []]);
}

group('validateAssignment — §45 case 4: the same દ્રશ્ય in two પ્રવૃત્તિઓ');
{
  const r = validateAssignment({
    assignments: assign({ '4.1': ids(1, 2, 3), '4.2': ids(3, 4) }),
    collection: TWELVE,
  });
  eq('it is an error, not a warning', [r.ok, errorCodes(r)], [false, ['duplicate-scene']]);
  const e = r.errors[0];
  eq('the દ્રશ્ય is named', e.sceneIds, ids(3));
  eq('…and so are the પ્રવૃત્તિઓ, so the સંચાલક knows where to look', e.activityKeys, ['4.1', '4.2']);
  eq('the panel gets English', /more than one activity/.test(e.en), true);
  eq('and the message carries Gujarati too, with Gujarati numerals', e.gu.includes('૧ દ્રશ્ય'), true);
}

group('validateAssignment — §45 case 5: a દ્રશ્ય in no પ્રવૃત્તિ');
{
  const partial = { assignments: assign({ '4.1': ids(1, 2, 3) }), collection: TWELVE };
  const loose = validateAssignment({ ...partial, requireFullCoverage: false });
  eq('partial coverage is a warning — teaching ૧–૩ this month is not a fault', warnCodes(loose), ['missing-scene']);
  eq('…so the configuration is still valid', loose.ok, true);
  eq('…and it names every unassigned દ્રશ્ય', loose.warnings[0].sceneIds.length, TWELVE.length - 3);

  const strict = validateAssignment({ ...partial, requireFullCoverage: true });
  eq('the same finding is an error once he asks for full coverage', errorCodes(strict), ['missing-scene']);
  eq('…and it blocks', strict.ok, false);
  eq('…with the same ids either way', strict.errors[0].sceneIds, loose.warnings[0].sceneIds);
}

group('validateAssignment — §45 case 6: an invalid દ્રશ્ય');
{
  const collection = [...scenes(1, 3), scene(4, { t: '' })];
  const r = validateAssignment({
    assignments: assign({ '4.1': [...ids(1, 2, 3, 4), 'darshan-999'] }),
    collection,
  });
  eq(
    '"does not exist" and "not published" are two different problems',
    errorCodes(r),
    ['unknown-scene', 'unpublished-scene']
  );
  eq('the unknown id is named', r.errors[0].sceneIds, ['darshan-999']);
  eq('…and the withheld one separately', r.errors[1].sceneIds, ids(4));
  eq('the configuration does not pass', r.ok, false);
}
{
  const collection = [...scenes(1, 3), scene(4, { active: false })];
  const r = validateAssignment({ assignments: assign({ '4.1': ids(1, 2, 3, 4) }), collection });
  eq('a hidden દ્રશ્ય is withheld, not unknown', errorCodes(r), ['unpublished-scene']);
}

group('validateAssignment — §45 case 7: full coverage vs partial coverage');
{
  const full = TWELVE.map((s) => s.id);
  const r = validateAssignment({
    assignments: assign({ '4.1': full.slice(0, 6), '4.2': full.slice(6) }),
    collection: TWELVE,
    requireFullCoverage: true,
  });
  eq('every દ્રશ્ય covered exactly once passes the strict check', [r.ok, codes(r)], [true, []]);
}
{
  // Full coverage counts only what a યુવક can be shown: an unlearnable દ્રશ્ય cannot be
  // covered and must not make coverage unreachable.
  const collection = [...scenes(1, 3), scene(4, { t: '' })];
  const r = validateAssignment({
    assignments: assign({ '4.1': ids(1, 2, 3) }),
    collection,
    requireFullCoverage: true,
  });
  eq('a દ્રશ્ય without its વર્ણન does not make full coverage impossible', [r.ok, codes(r)], [true, []]);
}

group('validateAssignment — the traps that lock a યુવક out');
{
  const r = validateAssignment({ assignments: assign({ '4.1': ids(1), '4.2': [] }), collection: TWELVE });
  eq('an empty પ્રવૃત્તિ can never be completed, so it is an error', errorCodes(r).includes('empty-activity'), true);
  eq('…and it names which one', r.errors.find((e) => e.code === 'empty-activity').activityKeys, ['4.2']);
}
{
  const r = validateAssignment({
    assignments: [
      { activityKey: '4.1', sceneIds: ids(1) },
      { activityKey: '4.1', sceneIds: ids(2) },
    ],
    collection: TWELVE,
  });
  eq('two પ્રવૃત્તિઓ under one key is §7 C, caught before Postgres phrases it', errorCodes(r)[0], 'duplicate-activity-key');
}
eq('nothing at all is not an error — it is an empty draft', validateAssignment({ assignments: [], collection: [] }).ok, true);
eq('a missing argument does not throw', validateAssignment().ok, true);

group('validateAssignment — the panel’s shape works exactly the same');
{
  const panel = [item(1), item(2), item(3, { active: false })];
  const r = validateAssignment({ assignments: assign({ '4.1': ids(1, 2, 3) }), collection: panel });
  eq('caption/imageUrl/active are read like t/url/active', errorCodes(r), ['unpublished-scene']);
  eq('…naming the same દ્રશ્ય', r.errors[0].sceneIds, ids(3));
}

// ==================================================================== order, search, summary

group('orderSceneIds — ક્રમ કદી તૂટે નહીં (§26)');
eq('a stored list comes back in collection order', orderSceneIds(ids(9, 2, 5), TWELVE), ids(2, 5, 9));
{
  // The સંચાલક reordered દર્શન after the config was saved; the config must follow.
  const reordered = [scene(9, { order: 1 }), scene(2, { order: 2 }), scene(5, { order: 3 })];
  eq('…and it is the collection’s order, not the number’s', orderSceneIds(ids(2, 5, 9), reordered), ids(9, 2, 5));
}
eq('a repeated id appears once', orderSceneIds(ids(3, 3, 1), TWELVE), ids(1, 3));
eq(
  'an unknown id is kept, at the end — hiding it would hide the fault',
  orderSceneIds(['darshan-999', ...ids(3, 1)], TWELVE),
  [...ids(1, 3), 'darshan-999']
);
eq('an empty list stays empty', orderSceneIds([], TWELVE), []);
eq('a missing list does not throw', orderSceneIds(undefined, TWELVE), []);

group('searchScenes — a number or words out of the વર્ણન');
eq('an exact number', searchScenes(TWELVE, '7').map((s) => s.id), ids(7));
eq('the same number in Gujarati digits', searchScenes(TWELVE, '૭').map((s) => s.id), ids(7));
eq('a prefix, so results appear while he is still typing', searchScenes(TWELVE, '1').map((s) => s.id), ids(1, 10, 11, 12));
eq('words from the વર્ણન', searchScenes(TWELVE, 'સાગરકિનારે').length, TWELVE.length);
eq('…narrowed to one દ્રશ્ય', searchScenes(TWELVE, 'દ્રશ્ય 4 —').map((s) => s.id), ids(4));
eq('an empty box is no filter, not no results', searchScenes(TWELVE, '').length, TWELVE.length);
eq('a query that matches nothing returns nothing', searchScenes(TWELVE, 'ઝઝઝ').length, 0);
eq('results keep collection order', searchScenes(TWELVE, '1').map((s) => s.index), [1, 10, 11, 12]);
eq('the entries themselves come back, વર્ણન and all', searchScenes(TWELVE, '7')[0].t, TWELVE[6].t);
eq('searching an empty collection is empty', searchScenes([], '7'), []);

group('summarise — the preview line and the યુવક’s card');
eq('a contiguous range reads as one', summarise(expandRange(TWELVE, 1, 5), TWELVE), {
  count: 5,
  fromIndex: 1,
  toIndex: 5,
  contiguous: true,
});
{
  // ૪૭ was never issued. The first fifty દ્રશ્યો that exist still read "૧–૫૧".
  const sel = expandRange(GAPPED, 1, 51);
  eq('a gap in the printed numbering does not break the label', summarise(sel, GAPPED), {
    count: 50,
    fromIndex: 1,
    toIndex: 51,
    contiguous: true,
  });
}
eq('a scattered selection says so', summarise(ids(2, 7, 11), TWELVE), {
  count: 3,
  fromIndex: 2,
  toIndex: 11,
  contiguous: false,
});
eq('one દ્રશ્ય is a range of one', summarise(ids(4), TWELVE), { count: 1, fromIndex: 4, toIndex: 4, contiguous: true });
eq('an empty selection has no range to print', summarise([], TWELVE), {
  count: 0,
  fromIndex: null,
  toIndex: null,
  contiguous: false,
});
eq('an unknown id is counted but breaks the range', summarise([...ids(1, 2), 'darshan-999'], TWELVE), {
  count: 3,
  fromIndex: 1,
  toIndex: 2,
  contiguous: false,
});
eq('a repeated id is one item', summarise(ids(1, 1, 2), TWELVE).count, 2);
eq('nothing to summarise over an empty collection', summarise(ids(1), []), {
  count: 1,
  fromIndex: null,
  toIndex: null,
  contiguous: false,
});

// ==================================================================== §6 rules 1 and 2

group('the module holds no total and no activity code (§6)');
{
  const source = readFileSync(
    fileURLToPath(new URL('../shared/domain/level4-selection.js', import.meta.url)),
    'utf8'
  );
  // Comments are prose and may name ૧૦૯ as an example; code may not.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n');
  eq('no literal total', /\b(108|109|110)\b/.test(code), false);
  eq('no hard-coded activity code', /['"`]\d+\.\d+['"`]/.test(code), false);
  eq('no TOTAL constant', /\bTOTAL\b/.test(code), false);
}

// ==================================================================== result

console.log(`\n  ${pass} passed, ${fails.length} failed\n`);
if (fails.length) {
  console.log(fails.map((f) => `  ✗ ${f}`).join('\n\n') + '\n');
  process.exit(1);
}
