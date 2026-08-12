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
 *   2. **Display number ≠ source number ≠ array position** (§25, ORDERING.md decision #2).
 *      The engine selects by `displayIndex` — the continuous ૧…N a યુવક counts through — and
 *      `slice(from - 1, to)` passes every test written against a collection numbered 1…n in
 *      order, then selects the wrong દ્રશ્યો the day one is withheld. So the fixtures below
 *      are deliberately reordered, gapped, and interleaved with inactive entries whose
 *      display numbers and printed numbers no longer line up.
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
import { darshanId, withDisplayIndex } from '../shared/domain/darshan.js';
import { deriveStatuses } from '../shared/domain/level4.js';
import {
  expandRange,
  autoDivide,
  findDuplicates,
  findMissing,
  findInvalid,
  validateAssignment,
  orderSceneIds,
  searchScenes,
  matchKind,
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

/**
 * ORDERING.md §2's derivation, written out rather than imported.
 *
 * The engine's contract is that its `collection` has already been through
 * `withDisplayIndex()` — canonically sorted by `position ?? sourceIndex ?? ∞` tie-broken by
 * `id`, with `displayIndex` running ૧…N across the entries a યુવક can actually be shown and
 * `null` on the rest. "Can be shown" is `isLearnable` and not merely `active`: a દ્રશ્ય
 * switched on but still missing its picture or its વર્ણન reaches no યુવક, so numbering it
 * would shift every number after it in the panel and nowhere else.
 *
 * Restating the rule here is deliberate — these are tests of the engine, and importing the
 * derivation would make a fault in one read as a fault in the other. The last group but one
 * then checks the two really do agree, which is the only place they are allowed to meet.
 */
const sequenced = (entries) => {
  const sourceOf = (e) => e.index ?? e.n ?? null;
  const numbered = (e) => e.active !== false && !!(e.t ?? e.caption ?? '') && !!(e.url ?? e.imageUrl ?? '');
  const rank = (e) => e.order ?? sourceOf(e) ?? Infinity;
  const sorted = [...entries].sort(
    (a, b) => (rank(a) - rank(b)) || (String(a.id ?? '') < String(b.id ?? '') ? -1 : 1)
  );
  let shown = 0;
  return sorted.map((e) => ({ ...e, sourceIndex: sourceOf(e), displayIndex: numbered(e) ? ++shown : null }));
};

const numbers = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const scenes = (a, b) => numbers(a, b).map((n) => scene(n));
const ids = (...ns) => ns.map(darshanId);

/** Twelve દ્રશ્યો, numbered 1…12 with nothing withheld. Display and source agree throughout. */
const TWELVE = sequenced(scenes(1, 12));

/**
 * A hundred and nine printed numbers, one of which (૪૭) was never issued — the live
 * collection's shape. The printed numbering has a hole in it; the display numbering does
 * not, because it counts દ્રશ્યો rather than reading their labels.
 */
const GAPPED = sequenced(numbers(1, 109).filter((n) => n !== 47).map((n) => scene(n)));

/**
 * Ten દ્રશ્યો with two of them withheld — the case decision #2 exists for.
 *
 * Sources ૩ and ૭ are inactive, so they carry no display number and everything after them
 * shifts down: display ૩ is the દ્રશ્ય printed ૪, display ૬ is the one printed ૮. Every
 * assertion below that reads `ids(...)` is naming **source** numbers, because that is what
 * the id is built from — which is exactly the divergence being tested.
 *
 *   display   1  2  –  3  4  5  –  6  7   8
 *   source    1  2  3  4  5  6  7  8  9  10
 */
const INTERLEAVED_RAW = numbers(1, 10).map((n) => scene(n, n === 3 || n === 7 ? { active: false } : {}));
const INTERLEAVED = sequenced(INTERLEAVED_RAW);

/** The eight of them a યુવક can actually reach. */
const INTERLEAVED_LIVE = ids(1, 2, 4, 5, 6, 8, 9, 10);

const assign = (obj) => Object.entries(obj).map(([activityKey, sceneIds]) => ({ activityKey, sceneIds }));

// ==================================================================== expandRange

group('expandRange — display numbers in, stable ids out');
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
eq('a range past the end selects what exists', expandRange(TWELVE, 10, 200).length, 3);
eq('…and never invents the rest', expandRange(TWELVE, 10, 200), ids(10, 11, 12));
eq('a range entirely outside the collection is empty', expandRange(TWELVE, 50, 60), []);
eq('an empty collection has nothing in any range', expandRange([], 1, 30), []);
eq('an unreadable endpoint selects nothing rather than guessing', expandRange(TWELVE, '', 6), []);
eq('…either end', expandRange(TWELVE, 1, 'ક'), []);
{
  // ૪૭ was never issued, so the દ્રશ્ય printed ૪૮ is the forty-seventh a યુવક meets. The
  // સંચાલક picks by what the યુવક sees (decision #2), so the hole in the sheet's numbering is
  // simply not visible from here.
  eq(
    'a hole in the printed numbering is invisible to a display range',
    expandRange(GAPPED, 45, 49),
    ids(45, 46, 48, 49, 50)
  );
  eq('…and the range is still exactly as long as it was asked to be', expandRange(GAPPED, 45, 49).length, 5);
}

group('expandRange — display numbers, not printed numbers (decision #2)');
{
  eq('“from 1 to 3” is the first three ACTIVE દ્રશ્યો', expandRange(INTERLEAVED, 1, 3), ids(1, 2, 4));
  eq(
    'a range that spans a withheld દ્રશ્ય passes straight over it',
    expandRange(INTERLEAVED, 2, 5),
    ids(2, 4, 5, 6)
  );
  eq('…so it is not slice(from - 1, to) — that would have caught the withheld one', expandRange(INTERLEAVED, 2, 5).length, 4);
  eq('the whole sequence is the active ones and only those', expandRange(INTERLEAVED, 1, 8), INTERLEAVED_LIVE);
  eq('…and a range past its end adds nothing', expandRange(INTERLEAVED, 1, 10), INTERLEAVED_LIVE);
  eq(
    'a withheld દ્રશ્ય has no display number, so no range can reach it',
    expandRange(INTERLEAVED, 1, 10).includes(darshanId(3)),
    false
  );
}

group('expandRange — array position is never identity (§25)');
{
  // દ્રશ્ય ૫૦ presented first, દ્રશ્ય ૧ presented last: the સંચાલક reordered. Display numbers
  // follow his order, so ૧–૨ is "the first two he arranged", whatever the sheet printed on them.
  const shuffled = sequenced([scene(50, { order: 1 }), scene(1, { order: 2 }), scene(9, { order: 3 })]);
  eq('display numbers follow the સંચાલક’s order, not the sheet’s', expandRange(shuffled, 1, 2), ids(50, 1));
  eq('…and the whole run comes back in that order', expandRange(shuffled, 1, 3), ids(50, 1, 9));
  eq('…while the printed numbers are no longer selectable', expandRange(shuffled, 50, 50), []);
}
{
  // A દ્રશ્ય still missing its વર્ણન is not in the sequence either — `withDisplayIndex()`
  // numbers what a યુવક can be *shown*, not merely what is switched on — so "૧–૪" over a
  // collection holding three ready દ્રશ્યો is three of them, not four with a dud in it.
  //
  // The path that still puts an unpublishable id into a પ્રવૃત્તિ is the one that matters: a
  // *stored* config naming a દ્રશ્ય that has gone unready since it was written. Nothing can
  // stop that from happening, so findInvalid is what makes sure he is told.
  const withOne = sequenced([...scenes(1, 3), scene(4, { t: '' })]);
  eq('an unready દ્રશ્ય carries no display number, so no range reaches it', expandRange(withOne, 1, 4), ids(1, 2, 3));
  eq('…and a stored config that names it is still told', findInvalid(assign({ '4.1': ids(1, 4) }), withOne), ids(4));
}
{
  // The engine reads `displayIndex` and nothing else. A collection that never went through
  // withDisplayIndex() is a wiring fault, and answering it in printed numbers would be the
  // one silent wrong answer §25 exists to prevent.
  eq('an un-sequenced collection has no display numbers, so nothing is selectable', expandRange(scenes(1, 5), 1, 5), []);
}

group('the engine no longer sorts — ordering is the caller’s (ORDERING.md rule 4)');
{
  // `order: 9` on the first row would have sent it to the end under the old `order ?? n`
  // sort. It stays where the caller put it, because withDisplayIndex() has already decided.
  const canonical = [
    { id: 'b', index: 2, order: 9, sourceIndex: 2, displayIndex: 1, t: 'બીજું', url: 'u' },
    { id: 'a', index: 1, order: 1, sourceIndex: 1, displayIndex: 2, t: 'પહેલું', url: 'u' },
  ];
  eq('the collection’s own array order is the order', searchScenes(canonical, '').map((e) => e.id), ['b', 'a']);
  eq('…a range walks it as given', expandRange(canonical, 1, 2), ['b', 'a']);
  eq('…and a stored list is re-ordered against it', orderSceneIds(['a', 'b'], canonical), ['b', 'a']);
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
  // Auto Divide splits the sequenced list, so each part is an unbroken run of display
  // numbers — which is what makes the cards read ૧–૩, ૪–૫, ૬–૮ rather than a scatter.
  const parts = autoDivide(expandRange(INTERLEAVED, 1, 8), 3);
  eq('the withheld દ્રશ્યો are not in any part', parts.flat(), INTERLEAVED_LIVE);
  eq(
    '…and every part is a contiguous run of display numbers',
    parts.map((p) => summarise(p, INTERLEAVED)).map((r) => [r.fromIndex, r.toIndex, r.contiguous]),
    [[1, 3, true], [4, 6, true], [7, 8, true]]
  );
}
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
  findMissing(assign({ '4.1': ids(1, 2, 3) }), sequenced(scenes(1, 5))),
  ids(4, 5)
);
eq('a full division misses nothing', findMissing(assign({ '4.1': TWELVE.map((s) => s.id) }), TWELVE), []);
{
  // A દ્રશ્ય with no વર્ણન is missing from દર્શન, not from લેવલ ૪. Reporting it here would
  // be unsatisfiable: assigning it raises §7 E, leaving it raises §7 B.
  const half = sequenced([...scenes(1, 2), scene(3, { t: '' })]);
  eq('an unlearnable દ્રશ્ય is not "missing from લેવલ ૪"', findMissing(assign({ '4.1': ids(1, 2) }), half), []);
}
eq(
  'nor is a withheld one — it carries no display number and is not in the sequence',
  findMissing(assign({ '4.1': INTERLEAVED_LIVE }), INTERLEAVED),
  []
);
eq('an empty collection is never missing anything', findMissing([], []), []);

group('findInvalid — §7 D and E');
eq(
  'an id the collection has never heard of',
  findInvalid(assign({ '4.1': [...ids(1, 2), 'darshan-999'] }), TWELVE),
  ['darshan-999']
);
{
  const half = sequenced([...scenes(1, 2), scene(3, { t: '' }), scene(4, { url: '' }), scene(5, { active: false })]);
  eq(
    'a દ્રશ્ય with no વર્ણન, one with no picture and one withheld are all invalid',
    findInvalid(assign({ '4.1': ids(1, 2, 3, 4, 5) }), half),
    ids(3, 4, 5)
  );
}
eq(
  'a દ્રશ્ય withheld after the config named it — displayIndex: null is the whole signal',
  findInvalid(assign({ '4.1': ids(2, 3, 4) }), INTERLEAVED),
  ids(3)
);
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
  const collection = sequenced([...scenes(1, 3), scene(4, { t: '' })]);
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
  // Inactivity now reaches the engine as `displayIndex: null` and nothing else, and it has
  // to land on the same error it always did — this is the config that was written before the
  // સંચાલક withheld the દ્રશ્ય, and it is now a પ્રવૃત્તિ nobody can pass.
  const collection = sequenced([...scenes(1, 3), scene(4, { active: false })]);
  const r = validateAssignment({ assignments: assign({ '4.1': ids(1, 2, 3, 4) }), collection });
  eq('a withheld દ્રશ્ય is unpublished, not unknown', errorCodes(r), ['unpublished-scene']);
  eq('…and it is named', r.errors[0].sceneIds, ids(4));
  eq('…so publishing is blocked', r.ok, false);
}
{
  const r = validateAssignment({
    assignments: assign({ '4.1': ids(1, 2, 3), '4.2': ids(4, 5, 6) }),
    collection: INTERLEAVED,
  });
  eq('the same in a collection where display and source have diverged', errorCodes(r), ['unpublished-scene']);
  eq('…naming only the withheld one', r.errors[0].sceneIds, ids(3));
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
  const collection = sequenced([...scenes(1, 3), scene(4, { t: '' })]);
  const r = validateAssignment({
    assignments: assign({ '4.1': ids(1, 2, 3) }),
    collection,
    requireFullCoverage: true,
  });
  eq('a દ્રશ્ય without its વર્ણન does not make full coverage impossible', [r.ok, codes(r)], [true, []]);
}
{
  // Nor does a withheld one. The two halves have to agree: it is not missing (findMissing)
  // and it must not be assigned (findInvalid), so full coverage is reachable without it.
  const r = validateAssignment({
    assignments: assign({ '4.1': INTERLEAVED_LIVE.slice(0, 4), '4.2': INTERLEAVED_LIVE.slice(4) }),
    collection: INTERLEAVED,
    requireFullCoverage: true,
  });
  eq('a withheld દ્રશ્ય does not make full coverage impossible either', [r.ok, codes(r)], [true, []]);
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
  const panel = sequenced([item(1), item(2), item(3, { active: false })]);
  const r = validateAssignment({ assignments: assign({ '4.1': ids(1, 2, 3) }), collection: panel });
  eq('caption/imageUrl/active are read like t/url/active', errorCodes(r), ['unpublished-scene']);
  eq('…naming the same દ્રશ્ય', r.errors[0].sceneIds, ids(3));
}

// ==================================================================== order, search, summary

group('orderSceneIds — ક્રમ કદી તૂટે નહીં (§26)');
eq('a stored list comes back in collection order', orderSceneIds(ids(9, 2, 5), TWELVE), ids(2, 5, 9));
{
  // The સંચાલક reordered દર્શન after the config was saved; the config must follow.
  const reordered = sequenced([scene(9, { order: 1 }), scene(2, { order: 2 }), scene(5, { order: 3 })]);
  eq('…and it is the collection’s order, not the number’s', orderSceneIds(ids(2, 5, 9), reordered), ids(9, 2, 5));
}
eq('a withheld દ્રશ્ય still has a place in the list', orderSceneIds(ids(6, 3, 2), INTERLEAVED), ids(2, 3, 6));
eq('a repeated id appears once', orderSceneIds(ids(3, 3, 1), TWELVE), ids(1, 3));
eq(
  'an unknown id is kept, at the end — hiding it would hide the fault',
  orderSceneIds(['darshan-999', ...ids(3, 1)], TWELVE),
  [...ids(1, 3), 'darshan-999']
);
eq('an empty list stays empty', orderSceneIds([], TWELVE), []);
eq('a missing list does not throw', orderSceneIds(undefined, TWELVE), []);

group('searchScenes — a display number, a source number, or words out of the વર્ણન');
eq('an exact number', searchScenes(TWELVE, '7').map((s) => s.id), ids(7));
eq('the same number in Gujarati digits', searchScenes(TWELVE, '૭').map((s) => s.id), ids(7));
eq('a prefix, so results appear while he is still typing', searchScenes(TWELVE, '1').map((s) => s.id), ids(1, 10, 11, 12));
eq('words from the વર્ણન', searchScenes(TWELVE, 'સાગરકિનારે').length, TWELVE.length);
eq('…narrowed to one દ્રશ્ય', searchScenes(TWELVE, 'દ્રશ્ય 4 —').map((s) => s.id), ids(4));
eq('an empty box is no filter, not no results', searchScenes(TWELVE, '').length, TWELVE.length);
eq('a query that matches nothing returns nothing', searchScenes(TWELVE, 'ઝઝઝ').length, 0);
eq('results keep collection order', searchScenes(TWELVE, '1').map((s) => s.displayIndex), [1, 10, 11, 12]);
eq('the entries themselves come back, વર્ણન and all', searchScenes(TWELVE, '7')[0].t, TWELVE[6].t);
eq('searching an empty collection is empty', searchScenes([], '7'), []);
{
  // `4` means two different pictures here: the fourth દ્રશ્ય (printed ૫) and the one the
  // sheet printed ૪ (which is third). Both come back, and matchKind is how the row says which.
  eq('a number finds both numberings', searchScenes(INTERLEAVED, '4').map((s) => s.id), ids(4, 5));
  eq('…the display match is labelled', matchKind(INTERLEAVED[4], '4'), 'display');
  eq('…and the source match separately', matchKind(INTERLEAVED[3], '4'), 'source');
  eq('a withheld દ્રશ્ય is still findable by its printed number', searchScenes(INTERLEAVED, '3').map((s) => s.id), ids(3, 4));
  eq('…and it can only be a source match, having no display number', matchKind(INTERLEAVED[2], '3'), 'source');
  eq('a વર્ણન match is labelled as one', matchKind(INTERLEAVED[0], 'સાગરકિનારે'), 'text');
  eq('a row that does not match says nothing', matchKind(INTERLEAVED[0], 'ઝઝઝ'), '');
  eq('an empty query is not a match either', matchKind(INTERLEAVED[0], ''), '');
}
{
  // The source number is exact, not a prefix: `૪` has one traceback answer and burying it
  // under everything printed ૪-something would defeat the point of showing it. The વર્ણન here
  // carries no digits, so nothing but the numbering can be what matched.
  const traced = sequenced([scene(4, { order: 1, t: 'ચિત્ર' }), scene(47, { order: 2, t: 'ચિત્ર' })]);
  eq('the source number is matched exactly, never by prefix', searchScenes(traced, '4').map((s) => s.sourceIndex), [4]);
  eq('…while the display number is still a prefix', searchScenes(sequenced(scenes(1, 12).map((s) => ({ ...s, t: 'ચિત્ર' }))), '1').length, 4);
}

group('summarise — the preview line and the યુવક’s card');
eq('a contiguous range reads as one', summarise(expandRange(TWELVE, 1, 5), TWELVE), {
  count: 5,
  fromIndex: 1,
  toIndex: 5,
  contiguous: true,
});
{
  // ૪૭ was never issued, and the display numbering does not care: the first fifty-one
  // દ્રશ્યો a યુવક meets read "૧–૫૧".
  const sel = expandRange(GAPPED, 1, 51);
  eq('a hole in the printed numbering does not break the label', summarise(sel, GAPPED), {
    count: 51,
    fromIndex: 1,
    toIndex: 51,
    contiguous: true,
  });
}
{
  // Two દ્રશ્યો withheld inside the run. Their printed numbers are gone from the selection
  // and the label is still unbroken, because display numbers count what is there.
  const sel = expandRange(INTERLEAVED, 2, 5);
  eq('contiguous across a withheld દ્રશ્ય', summarise(sel, INTERLEAVED), {
    count: 4,
    fromIndex: 2,
    toIndex: 5,
    contiguous: true,
  });
  eq('the whole sequence is one unbroken run', summarise(INTERLEAVED_LIVE, INTERLEAVED), {
    count: 8,
    fromIndex: 1,
    toIndex: 8,
    contiguous: true,
  });
  eq('a withheld દ્રશ્ય dragged into the selection breaks it — it has no number to print', summarise([...sel, darshanId(3)], INTERLEAVED), {
    count: 5,
    fromIndex: 2,
    toIndex: 5,
    contiguous: false,
  });
  eq('and a selection of nothing but withheld દ્રશ્યો has no range at all', summarise(ids(3, 7), INTERLEAVED), {
    count: 2,
    fromIndex: null,
    toIndex: null,
    contiguous: false,
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

// ============================================ the contract with withDisplayIndex (§2)

/*
  The one place the engine's tests and ORDERING.md §2's derivation are allowed to meet.

  Every fixture above is numbered by this file's own `sequenced()`, so that a fault in the
  derivation cannot be mistaken for a fault in the engine. That is only safe while the two
  actually agree — so here they are run against each other, and the engine is then run against
  the real thing. If this group is the only one red, the engine is fine and §2 has moved.
*/
group('the engine reads exactly what withDisplayIndex() writes (ORDERING.md §2)');
{
  eq('the fixtures are numbered the way production numbers them', withDisplayIndex(INTERLEAVED_RAW), INTERLEAVED);

  const raw = [scene(9, { order: 3 }), scene(4, { order: 1, active: false }), scene(7, { order: 2 })];
  const live = withDisplayIndex(raw);
  eq('…including when the સંચાલક has reordered', live.map((e) => [e.sourceIndex, e.displayIndex]), [[4, null], [7, 1], [9, 2]]);
  eq('a range over the real derivation spans display numbers', expandRange(live, 1, 2), ids(7, 9));
  eq('…and the withheld દ્રશ્ય is unselectable through it', findInvalid(assign({ '4.1': ids(4, 7) }), live), ids(4));
  eq('…and the preview line reads in them', summarise(expandRange(live, 1, 2), live), {
    count: 2,
    fromIndex: 1,
    toIndex: 2,
    contiguous: true,
  });
}

// ==================================================================== access and repetition

/*
  `deriveStatuses()` — ક્રમ, and what may be walked again (0012).

  This is the one rule in લેવલ ૪ that is written three times: here in
  shared/domain/level4.js, in `withStatuses()` (src/lib/level4.js) for the screens, and in
  `level4_activity_states()` (0010, amended by 0012) which is the authority. The database
  cannot be tested from here, so what these assert is the *rule* — and the rule is the same
  sentence in all three, deliberately in the same branch order.

  Two things it must get right at once, and they pull in opposite directions:

    ACCESS      is sequential and stays sequential. A કસોટી opens when the one before it is
                done, and nothing below opens early.
    REPETITION  is unlimited. A કસોટી already passed is never LOCKED again — not by a
                reorder, and (this is 0012) not by the સંચાલક raising `gate_threshold` past
                where this યુવક stands.

  A test that only checked the second would pass on a function that unlocked everything.
  So every case below asserts the whole ladder, not the one card it is about.
*/
group('deriveStatuses — unlocked once, open forever; locked until earned');
{
  const L = 'LOCKED', A = 'AVAILABLE', C = 'COMPLETED', R = 'REVISION_REQUIRED';

  /** Four કસોટીઓ of three દ્રશ્યો each, in ક્રમ: ૪.૧ = ૧–૩, ૪.૨ = ૪–૬, and so on. */
  const LADDER = [1, 2, 3, 4].map((i) => ({
    id: `act-${i}`,
    code: `4.${i}`,
    position: i,
    active: true,
    sceneIds: ids(i * 3 - 2, i * 3 - 1, i * 3),
  }));

  /** The દ્રશ્યો of every કસોટી he has passed — what `level4_state().coveredSceneIds` holds. */
  const coverageOf = (...done) => done.flatMap((i) => LADDER[i - 1].sceneIds);

  const statuses = (opts) =>
    deriveStatuses({ activities: LADDER, ...opts }).map((a) => a.status);

  const rows = (...done) =>
    done.map((i) => ({ activity_id: `act-${i}`, status: C, attempt_count: 1 }));

  // ---- the original progression, untouched by any of this

  eq('nothing done — only ૪.૧ is open', statuses({ gateOpen: true }), [A, L, L, L]);

  eq(
    '૪.૧ done — ૪.૨ opens, ૪.૩ and ૪.૪ do not',
    statuses({ gateOpen: true, progressRows: rows(1), coveredSceneIds: coverageOf(1) }),
    [C, A, L, L]
  );

  eq(
    '૪.૨ done — the accessible set is ૪.૧ + ૪.૨ + ૪.૩, and no further',
    statuses({ gateOpen: true, progressRows: rows(1, 2), coveredSceneIds: coverageOf(1, 2) }),
    [C, C, A, L]
  );

  eq(
    'all four done',
    statuses({
      gateOpen: true,
      progressRows: rows(1, 2, 3, 4),
      coveredSceneIds: coverageOf(1, 2, 3, 4),
    }),
    [C, C, C, C]
  );

  // ---- repetition changes nothing about the ladder

  eq(
    'a half-attempt at ૪.૨ leaves ૪.૨ open and ૪.૩ shut',
    statuses({
      gateOpen: true,
      progressRows: [...rows(1), { activity_id: 'act-2', status: R, attempt_count: 3 }],
      coveredSceneIds: coverageOf(1),
    }),
    [C, R, L, L]
  );

  eq(
    'a half-attempt at a કસોટી already passed does not un-pass it',
    statuses({
      gateOpen: true,
      // What the database holds after a retake that fell short: 0010 step 7 never demotes a
      // COMPLETED row, so the status is still C and only `attempt_count` moved.
      progressRows: [...rows(1), { activity_id: 'act-2', status: C, attempt_count: 9 }],
      coveredSceneIds: coverageOf(1, 2),
    }),
    [C, C, A, L]
  );

  // ---- the gate, and 0012

  eq('gate shut, nothing earned — the whole ladder is shut', statuses({ gateOpen: false }), [
    L, L, L, L,
  ]);

  eq(
    'gate raised behind him — what he passed stays open, what he has not stays shut',
    statuses({ gateOpen: false, progressRows: rows(1, 2), coveredSceneIds: coverageOf(1, 2) }),
    [C, C, L, L]
  );

  // ---- and the two ways a completion is credited are the same completion

  eq(
    'credited by coverage alone (decision #4) — no progress row anywhere',
    statuses({ gateOpen: true, coveredSceneIds: coverageOf(1, 2) }),
    [C, C, A, L]
  );

  eq(
    'a reorder that puts an unfinished કસોટી first does not re-lock the finished ones',
    deriveStatuses({
      // ૪.૩ dragged to the front. It is unfinished, and everything after it has been passed.
      activities: [
        { ...LADDER[2], position: 0 },
        ...LADDER.filter((a) => a.position !== 3),
      ],
      gateOpen: true,
      progressRows: rows(1, 2, 4),
      coveredSceneIds: coverageOf(1, 2, 4),
    }).map((a) => a.status),
    [A, C, C, C]
  );
}

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
