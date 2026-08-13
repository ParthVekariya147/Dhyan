/**
 * Tests for ગુણ and મારી પ્રગતિ — `node scripts/test-points.mjs`.
 *
 * Same shape as scripts/test-domain.mjs and for the same reason it gives: everything in
 * shared/domain/points.js and shared/domain/history.js is a pure function over plain data —
 * no database, no network, no React, no clock — so it can be tested exactly and cheaply, and
 * adding a framework to run assertions on two modules is not worth a dependency. Exit code is
 * the result: 0 green, 1 red.
 *
 * What it protects, specifically. Every one of these fails **silently** in production — no
 * throw, no red screen, no log line; a યુવક is simply paid the wrong number, or reads a day
 * that is not the day he had:
 *
 *   1. **`typeof` versus `Number()`, in the resolver.** `Number(null)`, `Number('')` and
 *      `Number([])` are all 0, and `Number('300')` is 300. A resolver that coerced would turn
 *      "nothing configured" into a real awardable zero, and would turn the string '300' into
 *      300 while the SQL mirror's `jsonb_typeof(...) = 'number'` refuses it outright. The panel
 *      would then show ૩૦૦ beside a level the server pays 0 for, and neither screen could say
 *      which was lying. This is the single most important property in this file.
 *
 *   2. **`enabled` being anything other than JSON `true`.** The stored value is jsonb, so the
 *      string 'false' is truthy. A truthiness test switches a scoring system on for two
 *      thousand people because somebody's form serialised a checkbox as text, and nobody
 *      pressed anything.
 *
 *   3. **Out of range paid instead of refused.** A mistyped ૩૦૦૦૦૦ clamped to ૧૦૦૦૦ pays a
 *      number nobody chose, and pays it every day until someone notices that લેવલ ૧ is worth
 *      more than the whole of લેવલ ૪. Refusing to pay is the only answer that cannot be wrong
 *      in the સંચાલક's favour by accident.
 *
 *   4. **One malformed field blacking out the other three.** A half-typed row is ordinary. A
 *      row that silently stops paying every level because one field is a string is not, and it
 *      looks exactly like "points are off".
 *
 *   5. **An unlisted કસોટી falling to 0 instead of to `level4.default`.** The સંચાલક creates
 *      activities whenever he likes; a new ૪.૫ nobody has priced yet is worth what લેવલ ૪ is
 *      worth. A zero there is indistinguishable on screen from a deliberate "this one is free",
 *      and he has no way to tell which he is looking at. The reverse matters just as much: a
 *      કસોટી priced 0 on purpose must stay 0 and must not fall through to the default.
 *
 *   6. **The resolver and the validator disagreeing.** Anything `validatePoints()` accepts,
 *      `resolvePoints()` must return unchanged. The moment that equivalence breaks, the number
 *      in the panel's field and the number in the yuvak's ledger are two different numbers, and
 *      the Save that caused it succeeded.
 *
 *   7. **A history row read out of two vocabularies.** The server hands back snake_case from
 *      `activity_attempts` and camelCase from the લેવલ ૪ view. A normaliser that missed one
 *      renders `undefined / undefined` beside three good rows, or drops the day entirely.
 *
 *   8. **The daily reset eating yesterday.** §25: a new IST day has no row yet, and that is the
 *      whole mechanism — there is no cron job and there must not be one. Expressed here as a
 *      property provable without a database: adding today's row may not alter yesterday's group
 *      in any respect, including its points total.
 *
 *   9. **Days ordered the wrong way, or a day's points summed wrong.** Days descend, rows
 *      inside a day ascend by level. A day whose figure is off by one row is a scoreboard
 *      nobody can reconcile against the ledger, and it never throws.
 *
 *  10. **Drift between this module and the migration that mirrors it.** `point_value_for()`
 *      awards from the same map the panel shows. If the bounds, the activity keys, the business
 *      timezone or the no-duplicate constraint stop agreeing, the disagreement surfaces as a
 *      yuvak paid twice, or paid nothing, on a day nobody was watching.
 *
 *  11. **A literal total leaking into either module.** §62: no count of દ્રશ્યો lives outside
 *      useScenes(). A day that reads ૮૨/૧૦૮ must keep reading ૮૨/૧૦૮ after the collection grows
 *      to ૧૦૯, because the total arrived on the row.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ACTIVITY_CODE_RE,
  ACTIVITY_KEY,
  ACTIVITY_LEVEL,
  ATTEMPT_STATUS,
  DEFAULT_POINTS,
  POINTS_KEY,
  POINT_MAX,
  POINT_MIN,
  SUGGESTED_POINTS,
  pointsFor,
  resolvePoints,
  validatePoints,
} from '../shared/domain/points.js';
import {
  ACTIVITY_LABEL,
  ISO_DAY_RE,
  LEVEL_LABEL,
  STATUS_LABEL,
  groupByDate,
  isISODay,
  normaliseHistoryRow,
  normalisePointSummary,
  summariseRow,
} from '../shared/domain/history.js';

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
 * A check that could not be run at all, said out loud.
 *
 * Not a pass and not a failure: a group whose input does not exist yet has proved nothing,
 * and counting it green is how a suite ends up reporting that it verified a file that was
 * never written. Printed loudly enough to be noticed in a wall of green.
 */
const skipped = [];
const skip = (name, why) => {
  skipped.push(name);
  console.log(`    SKIPPED  ${name}  -  ${why}`);
};

// ==================================================================== fixtures

/** The shape the panel writes into settings['levels'].value.points. Overrides go on top. */
const stored = (over = {}) => ({
  enabled: true,
  level1: 100,
  level2: 200,
  level3: 300,
  level4: { default: 100 },
  ...over,
});

/** DEFAULT_POINTS as a plain object, for comparing a resolver's answer against. */
const OFF = { enabled: false, level1: 0, level2: 0, level3: 0, level4: { default: 0 } };

/** One history row in the snake_case the server actually hands back. */
const row = (over = {}) => ({
  activity_date: '2026-08-13',
  level_id: 2,
  activity_key: ACTIVITY_KEY.DARSHAN,
  attempt_count: 1,
  completed_items: 0,
  total_items: 0,
  status: ATTEMPT_STATUS.COMPLETED,
  points: 0,
  ...over,
});

/** A renderer that is visibly not `String`, so "the digits were rendered" is provable. */
const mark = (n) => `[${n}]`;

/** The real thing: Gujarati digits, which is what a યુવક reads. */
const GU_DIGITS = ['૦', '૧', '૨', '૩', '૪', '૫', '૬', '૭', '૮', '૯'];
const gu = (n) => String(n).replace(/[0-9]/g, (d) => GU_DIGITS[Number(d)]);

// ==================================================================== the constants

group('constants - the identities the ledger is built on');
eq('the settings key', POINTS_KEY, 'points');
eq('the bounds', [POINT_MIN, POINT_MAX], [0, 10000]);
eq('the three fixed activity keys', ACTIVITY_KEY, {
  VIDEO: 'video',
  DARSHAN: 'darshan',
  REVISION: 'revision',
});
eq('each key knows its level', ACTIVITY_LEVEL, { video: 1, darshan: 2, revision: 3 });
eq('the two outcomes, and no IN_PROGRESS', Object.keys(ATTEMPT_STATUS), [
  'COMPLETED',
  'REVISION_REQUIRED',
]);
eq('the default pays nothing and is switched off', DEFAULT_POINTS, OFF);
eq('the suggestion is the brief numbers and is only a suggestion', SUGGESTED_POINTS, {
  enabled: true,
  level1: 100,
  level2: 200,
  level3: 300,
  level4: { default: 100 },
});
eq('deploying this work does not switch scoring on', DEFAULT_POINTS.enabled, false);
eq('the constants are frozen', [
  Object.isFrozen(ACTIVITY_KEY),
  Object.isFrozen(ACTIVITY_LEVEL),
  Object.isFrozen(ATTEMPT_STATUS),
  Object.isFrozen(DEFAULT_POINTS),
  Object.isFrozen(SUGGESTED_POINTS),
], [true, true, true, true, true]);

group('ACTIVITY_CODE_RE - level4_activities.code own shape');
for (const good of ['4.1', '4.12', '10.3', '0.0', '123.456']) {
  eq(`accepts ${good}`, ACTIVITY_CODE_RE.test(good), true);
}
for (const bad of ['banana', '4', '4.', '.1', '4.1.2', '', ' 4.1', '4.1 ', '4,1', 'default']) {
  eq(`refuses ${JSON.stringify(bad)}`, ACTIVITY_CODE_RE.test(bad), false);
}

// ==================================================================== resolvePoints, nothing stored

group('resolvePoints - nothing usable was stored');
eq('undefined', resolvePoints(undefined), OFF);
eq('null', resolvePoints(null), OFF);
eq('a string', resolvePoints('points'), OFF);
eq('the empty string', resolvePoints(''), OFF);
eq('a number', resolvePoints(300), OFF);
eq('true', resolvePoints(true), OFF);
eq('an array is not an object here', resolvePoints([]), OFF);
eq('an array of good-looking values is still not an object', resolvePoints([100, 200, 300]), OFF);
eq('an empty object', resolvePoints({}), OFF);
eq('it never returns the suggestion', resolvePoints(undefined).level1, 0);
eq('a resolved value is always awardable, never null', resolvePoints(undefined).level4.default, 0);

// ==================================================================== resolvePoints, the switch

group('resolvePoints - only JSON true switches points on');
eq('true', resolvePoints(stored({ enabled: true })).enabled, true);
eq("the string 'true' is text, not a switch", resolvePoints(stored({ enabled: 'true' })).enabled, false);
eq("the string 'false' is truthy and must still read as off", resolvePoints(stored({ enabled: 'false' })).enabled, false);
eq('1 is not true', resolvePoints(stored({ enabled: 1 })).enabled, false);
eq('0 is not true', resolvePoints(stored({ enabled: 0 })).enabled, false);
eq("the string '1'", resolvePoints(stored({ enabled: '1' })).enabled, false);
eq('null', resolvePoints(stored({ enabled: null })).enabled, false);
eq('undefined', resolvePoints(stored({ enabled: undefined })).enabled, false);
eq('absent', resolvePoints({ level1: 100 }).enabled, false);
eq('an object', resolvePoints(stored({ enabled: {} })).enabled, false);
eq('an array', resolvePoints(stored({ enabled: [] })).enabled, false);
eq('Boolean(new Boolean(false)) is true - the boxed object is refused too', resolvePoints(stored({ enabled: new Boolean(false) })).enabled, false);
eq('the levels survive a bad switch, so nothing is lost by refusing to pay', resolvePoints(stored({ enabled: 'true' })), {
  enabled: false,
  level1: 100,
  level2: 200,
  level3: 300,
  level4: { default: 100 },
});

// ==================================================================== resolvePoints, typeof not Number

/*
  ────────────────────────────────────────────────────────────────────────────
  The one that matters most
  ────────────────────────────────────────────────────────────────────────────

  The SQL mirror tests `jsonb_typeof(...) = 'number'`. A resolver that reached for `Number()`
  would accept the string '300' where the server refuses it, and the panel would promise a
  number the ledger never pays. So these assertions are written in pairs: what `Number()`
  would have said, then what the resolver actually says.
*/

group('resolvePoints - typeof, never Number (the panel and the ledger must agree)');
eq("Number('300') is 300, and that is the trap", Number('300'), 300);
eq("a numeric string level is worth 0, not 300", resolvePoints(stored({ level3: '300' })).level3, 0);
eq("a numeric string level1", resolvePoints(stored({ level1: '100' })).level1, 0);
eq("a numeric string level2", resolvePoints(stored({ level2: '200' })).level2, 0);
eq("a numeric string level4 default", resolvePoints(stored({ level4: { default: '100' } })).level4.default, 0);
eq("a numeric string level4 code is dropped entirely", resolvePoints(stored({ level4: { default: 100, '4.1': '500' } })).level4, { default: 100 });
eq("'0' is text too", resolvePoints(stored({ level1: '0' })).level1, 0);
eq('a whitespace-padded number string', resolvePoints(stored({ level1: ' 100 ' })).level1, 0);

group('resolvePoints - the values Number() silently turns into 0 or worse');
eq('Number(null) is 0', Number(null), 0);
eq("Number('') is 0", Number(''), 0);
eq('Number([]) is 0', Number([]), 0);
eq('Number(false) is 0', Number(false), 0);
eq("Number(['300']) is 300", Number(['300']), 300);
eq('Number(true) is 1', Number(true), 1);
eq('null reads as 0 because nothing was configured, not because it coerced', resolvePoints(stored({ level1: null })).level1, 0);
eq('the empty string reads as 0', resolvePoints(stored({ level1: '' })).level1, 0);
eq('an empty array reads as 0', resolvePoints(stored({ level1: [] })).level1, 0);
eq('a one-element array that Number() would make 300 is still 0', resolvePoints(stored({ level3: ['300'] })).level3, 0);
eq('true, which Number() would make 1, is 0', resolvePoints(stored({ level1: true })).level1, 0);
eq('an object', resolvePoints(stored({ level1: { valueOf: () => 100 } })).level1, 0);
eq('a Number wrapper object is not a number', resolvePoints(stored({ level1: new Number(100) })).level1, 0);

// ==================================================================== resolvePoints, the bounds

group('resolvePoints - out of range is refused, never clamped');
eq('-1 is 0 and not 0-by-clamping', resolvePoints(stored({ level1: -1 })).level1, 0);
eq('-500', resolvePoints(stored({ level2: -500 })).level2, 0);
eq('10001 is 0, not 10000', resolvePoints(stored({ level3: 10001 })).level3, 0);
eq('300000 mistyped for 300 pays nothing', resolvePoints(stored({ level3: 300000 })).level3, 0);
eq('the floor is inclusive', resolvePoints(stored({ level1: 0 })).level1, 0);
eq('the ceiling is inclusive', resolvePoints(stored({ level1: 10000 })).level1, 10000);
eq('one under the ceiling', resolvePoints(stored({ level1: 9999 })).level1, 9999);
eq('out of range on the level4 default', resolvePoints(stored({ level4: { default: 10001 } })).level4.default, 0);
eq('out of range on a level4 code drops the code', resolvePoints(stored({ level4: { default: 100, '4.1': -1 } })).level4, { default: 100 });

group('resolvePoints - fractions round, they do not truncate');
eq('250.4 rounds down', resolvePoints(stored({ level1: 250.4 })).level1, 250);
eq('250.5 rounds up', resolvePoints(stored({ level1: 250.5 })).level1, 251);
eq('250.6 rounds up', resolvePoints(stored({ level1: 250.6 })).level1, 251);
eq('0.4 rounds to 0', resolvePoints(stored({ level1: 0.4 })).level1, 0);
eq('0.5 rounds to 1', resolvePoints(stored({ level1: 0.5 })).level1, 1);
eq('9999.6 rounds to 10000 and stays inside', resolvePoints(stored({ level1: 9999.6 })).level1, 10000);
eq('10000.4 rounds back to the ceiling', resolvePoints(stored({ level1: 10000.4 })).level1, 10000);
eq('10000.6 rounds past the ceiling and is refused', resolvePoints(stored({ level1: 10000.6 })).level1, 0);
eq('-0.4 rounds to zero rather than below the floor', resolvePoints(stored({ level1: -0.4 })).level1, 0);
eq('a fractional level4 code rounds', resolvePoints(stored({ level4: { default: 0, '4.1': 49.5 } })).level4['4.1'], 50);

group('resolvePoints - the non-finite numbers');
eq('NaN', resolvePoints(stored({ level1: NaN })).level1, 0);
eq('Infinity', resolvePoints(stored({ level2: Infinity })).level2, 0);
eq('-Infinity', resolvePoints(stored({ level3: -Infinity })).level3, 0);
eq('NaN on the level4 default', resolvePoints(stored({ level4: { default: NaN } })).level4.default, 0);
eq('Infinity on a level4 code drops it', resolvePoints(stored({ level4: { default: 5, '4.1': Infinity } })).level4, { default: 5 });

// ==================================================================== resolvePoints, isolation

group('resolvePoints - one bad field does not black out the other three');
eq('a string level1', resolvePoints(stored({ level1: 'x' })), {
  enabled: true,
  level1: 0,
  level2: 200,
  level3: 300,
  level4: { default: 100 },
});
eq('an out-of-range level2', resolvePoints(stored({ level2: 99999 })), {
  enabled: true,
  level1: 100,
  level2: 0,
  level3: 300,
  level4: { default: 100 },
});
eq('a NaN level3', resolvePoints(stored({ level3: NaN })), {
  enabled: true,
  level1: 100,
  level2: 200,
  level3: 0,
  level4: { default: 100 },
});
eq('a broken level4 leaves the first three alone', resolvePoints(stored({ level4: 'x' })), {
  enabled: true,
  level1: 100,
  level2: 200,
  level3: 300,
  level4: { default: 0 },
});
eq('three broken fields still leave the fourth', resolvePoints(stored({ level1: 'a', level2: [], level3: null })).level4, { default: 100 });

// ==================================================================== resolvePoints, level4

group('resolvePoints - level4 is not an object');
for (const bad of ['x', 100, true, null, undefined, [], [1, 2]]) {
  eq(`level4 = ${JSON.stringify(bad)} gives {default: 0}`, resolvePoints(stored({ level4: bad })).level4, { default: 0 });
}
eq('an empty level4 object still gets a default', resolvePoints(stored({ level4: {} })).level4, { default: 0 });
eq('level4 with only codes still gets a default', resolvePoints(stored({ level4: { '4.1': 50 } })).level4, { default: 0, '4.1': 50 });
eq('default comes first, always, so panel and ledger serialise alike', Object.keys(resolvePoints(stored({ level4: { '4.1': 50, default: 10 } })).level4), ['default', '4.1']);

group('resolvePoints - a key that is not an activity code cannot be worth anything');
eq("'banana' is dropped", resolvePoints(stored({ level4: { default: 100, banana: 50 } })).level4, { default: 100 });
eq("'4' is not a code", resolvePoints(stored({ level4: { default: 100, 4: 50 } })).level4, { default: 100 });
eq("'4.' is not a code", resolvePoints(stored({ level4: { default: 100, '4.': 50 } })).level4, { default: 100 });
eq("'.1' is not a code", resolvePoints(stored({ level4: { default: 100, '.1': 50 } })).level4, { default: 100 });
eq("'4.1.2' is not a code", resolvePoints(stored({ level4: { default: 100, '4.1.2': 50 } })).level4, { default: 100 });
eq("'' is not a code", resolvePoints(stored({ level4: { default: 100, '': 50 } })).level4, { default: 100 });
eq("'4.1' is kept", resolvePoints(stored({ level4: { default: 100, '4.1': 50 } })).level4, { default: 100, '4.1': 50 });
eq("'10.3' is kept", resolvePoints(stored({ level4: { default: 100, '10.3': 7 } })).level4, { default: 100, '10.3': 7 });
eq("'4.12' is kept", resolvePoints(stored({ level4: { default: 100, '4.12': 12 } })).level4, { default: 100, '4.12': 12 });
eq('a priced 0 code is kept, because 0 is a price', resolvePoints(stored({ level4: { default: 100, '4.2': 0 } })).level4, { default: 100, '4.2': 0 });
eq('good and bad keys together - only the bad ones go', resolvePoints(stored({ level4: { default: 100, '4.1': 50, banana: 9, '4.2': 0, '4.': 1, '10.3': 7 } })).level4, {
  default: 100,
  '4.1': 50,
  '4.2': 0,
  '10.3': 7,
});
eq('a stored value is never mutated', (() => {
  const s = stored({ level4: { default: 100, banana: 50 } });
  resolvePoints(s);
  return s.level4;
})(), { default: 100, banana: 50 });
eq('resolving twice is the same answer', resolvePoints(resolvePoints(stored())), resolvePoints(stored()));

// ==================================================================== pointsFor, the switch

group('pointsFor - disabled is 0 everywhere, with no field blanked');
{
  const off = resolvePoints(stored({ enabled: false, level4: { default: 100, '4.1': 500 } }));
  eq('level 1', pointsFor(off, 1), 0);
  eq('level 2', pointsFor(off, 2), 0);
  eq('level 3', pointsFor(off, 3), 0);
  eq('level 4 default', pointsFor(off, 4), 0);
  eq('a named level 4 code is 0 too - no half-off state', pointsFor(off, 4, '4.1'), 0);
  eq('an unlisted level 4 code', pointsFor(off, 4, '4.9'), 0);
  eq('the values are still there for when it is switched back on', off.level3, 300);
}
eq('no resolved value at all falls to DEFAULT_POINTS, which pays nothing', pointsFor(null, 3), 0);
eq('undefined', pointsFor(undefined, 1), 0);
eq('undefined, level 4', pointsFor(undefined, 4, '4.1'), 0);

// ==================================================================== pointsFor, the ladder

group('pointsFor - the first three levels');
{
  const p = resolvePoints(stored());
  eq('level 1', pointsFor(p, 1), 100);
  eq('level 2', pointsFor(p, 2), 200);
  eq('level 3', pointsFor(p, 3), 300);
  eq('a code is ignored for levels 1-3', pointsFor(p, 3, '4.1'), 300);
}
eq('a resolved map missing a level still answers with a number', pointsFor({ enabled: true }, 1), 0);
eq('a resolved map missing level4 still answers with a number', pointsFor({ enabled: true }, 4, '4.1'), 0);

group('pointsFor - an unknown level is worth nothing');
{
  const p = resolvePoints(stored());
  for (const bad of [0, 5, 6, -1, null, undefined, NaN, 1.5]) {
    eq(`level ${JSON.stringify(bad)}`, pointsFor(p, bad), 0);
  }
  eq("the string '3' is not level 3", pointsFor(p, '3'), 0);
  eq("the string '4' is not level 4", pointsFor(p, '4', '4.1'), 0);
}

group('pointsFor - level 4, where the fall-through rule lives');
{
  const p = resolvePoints(stored({ level4: { default: 100, '4.1': 500, '4.2': 0, '10.3': 25 } }));
  eq('a named code wins over the default', pointsFor(p, 4, '4.1'), 500);
  eq('another named code', pointsFor(p, 4, '10.3'), 25);
  eq('a કસોટી nobody has priced is worth what લેવલ ૪ is worth', pointsFor(p, 4, '4.9'), 100);
  eq('an unlisted code is NOT 0', pointsFor(p, 4, '4.9') === 0, false);
  eq('a code priced 0 on purpose stays 0', pointsFor(p, 4, '4.2'), 0);
  eq('a code priced 0 does NOT fall through to the default', pointsFor(p, 4, '4.2') === 100, false);
  eq('no code at all is the default', pointsFor(p, 4), 100);
  eq('an empty code is the default', pointsFor(p, 4, ''), 100);
  eq('a code that was dropped as malformed falls to the default', pointsFor(resolvePoints(stored({ level4: { default: 100, banana: 5 } })), 4, 'banana'), 100);
  eq("a code whose stored value was the string '500' falls to the default, not to 500", pointsFor(resolvePoints(stored({ level4: { default: 100, '4.1': '500' } })), 4, '4.1'), 100);
  eq('a prototype key is not a price', pointsFor(p, 4, 'toString'), 100);
  eq('constructor is not a price either', pointsFor(p, 4, 'constructor'), 100);
}
{
  const zeroDefault = resolvePoints(stored({ level4: { default: 0, '4.1': 500 } }));
  eq('a zero default is allowed and is what unlisted કસોટીઓ get', pointsFor(zeroDefault, 4, '4.9'), 0);
  eq('the named one still pays', pointsFor(zeroDefault, 4, '4.1'), 500);
}

// ==================================================================== validatePoints, refusals

group('validatePoints - there is nothing to save');
for (const bad of [null, undefined, 'points', 100, true, []]) {
  const r = validatePoints(bad);
  eq(`${JSON.stringify(bad)} is refused`, r.ok, false);
  eq(`${JSON.stringify(bad)} says what is missing`, r.gu, 'The points setting is missing.');
}

group('validatePoints - the switch must be a real boolean');
for (const bad of ['true', 'false', 1, 0, null, undefined, {}]) {
  const r = validatePoints({ ...stored(), enabled: bad });
  eq(`enabled = ${JSON.stringify(bad)} is refused`, r.ok, false);
  eq(`enabled = ${JSON.stringify(bad)} names the act`, r.gu, 'Points: turn the system on or off before saving.');
}
eq('false is a real boolean and is accepted', validatePoints({ ...stored(), enabled: false }).ok, true);

group('validatePoints - a level value the resolver would have zeroed');
{
  const r = validatePoints(stored({ level3: '300' }));
  eq('a numeric string is refused rather than silently zeroed', r.ok, false);
  eq('and the message says what is wrong', r.gu, 'Level 3 points: enter a number.');
}
for (const [field, label] of [['level1', 'Level 1'], ['level2', 'Level 2'], ['level3', 'Level 3']]) {
  eq(`${field} - a string`, validatePoints(stored({ [field]: '5' })).gu, `${label} points: enter a number.`);
  eq(`${field} - null`, validatePoints(stored({ [field]: null })).gu, `${label} points: enter a number.`);
  eq(`${field} - absent`, validatePoints(stored({ [field]: undefined })).gu, `${label} points: enter a number.`);
  eq(`${field} - NaN`, validatePoints(stored({ [field]: NaN })).gu, `${label} points: enter a number.`);
  eq(`${field} - Infinity`, validatePoints(stored({ [field]: Infinity })).gu, `${label} points: enter a number.`);
  eq(`${field} - an array`, validatePoints(stored({ [field]: [] })).gu, `${label} points: enter a number.`);
  eq(`${field} - a fraction`, validatePoints(stored({ [field]: 100.5 })).gu, `${label} points: enter a whole number.`);
  eq(`${field} - below the floor`, validatePoints(stored({ [field]: -1 })).gu, `${label} points: between 0 and 10000.`);
  eq(`${field} - above the ceiling`, validatePoints(stored({ [field]: 10001 })).gu, `${label} points: between 0 and 10000.`);
  eq(`${field} - a bound message names both bounds`, [String(POINT_MIN), String(POINT_MAX)].every((n) => validatePoints(stored({ [field]: -1 })).gu.includes(n)), true);
  eq(`${field} - the floor itself is accepted`, validatePoints(stored({ [field]: 0 })).ok, true);
  eq(`${field} - the ceiling itself is accepted`, validatePoints(stored({ [field]: 10000 })).ok, true);
}

/*
  The resolver rounds a fraction and the validator refuses it, and that split is intentional
  rather than an oversight: a stored row must always yield something awardable, but a સંચાલક
  who has typed ૧૦૦.૫ into a field should be told, because the number he saved and the number
  he would be paid are not the same number.
*/
group('validatePoints - the resolver rounds, the validator refuses (deliberately)');
eq('the resolver rounds 100.5', resolvePoints(stored({ level1: 100.5 })).level1, 101);
eq('the validator refuses it', validatePoints(stored({ level1: 100.5 })).ok, false);
eq('and says so in whole-number words', validatePoints(stored({ level1: 100.5 })).gu, 'Level 1 points: enter a whole number.');
eq('same split on the level4 default', [resolvePoints(stored({ level4: { default: 49.5 } })).level4.default, validatePoints(stored({ level4: { default: 49.5 } })).ok], [50, false]);

group('validatePoints - level4 must be a map of activities');
for (const bad of [null, undefined, 'x', 100, true, []]) {
  const r = validatePoints(stored({ level4: bad }));
  eq(`level4 = ${JSON.stringify(bad)} is refused`, r.ok, false);
  eq(`level4 = ${JSON.stringify(bad)} names the shape`, r.gu, 'Level 4 points: expected a value for each activity.');
}

group('validatePoints - a level4 key that is not an activity code is refused by name');
{
  const r = validatePoints(stored({ level4: { default: 100, banana: 50 } }));
  eq('refused', r.ok, false);
  eq('and the offending key is quoted back', r.gu, 'Level 4 points: "banana" is not an activity code like 4.1.');
  eq('the message actually contains the key', r.gu.includes('banana'), true);
}
for (const bad of ['4', '4.', '.1', '4.1.2', 'Default', ' 4.1']) {
  const r = validatePoints(stored({ level4: { default: 100, [bad]: 50 } }));
  eq(`${JSON.stringify(bad)} is refused`, r.ok, false);
  eq(`${JSON.stringify(bad)} is named in the message`, r.gu.includes(bad), true);
}

group('validatePoints - level4 values');
eq("a numeric string code value", validatePoints(stored({ level4: { default: 100, '4.1': '500' } })).gu, 'Level 4.1 points: enter a number.');
eq('a fractional code value', validatePoints(stored({ level4: { default: 100, '4.1': 49.5 } })).gu, 'Level 4.1 points: enter a whole number.');
eq('an out-of-range code value', validatePoints(stored({ level4: { default: 100, '4.1': 10001 } })).gu, 'Level 4.1 points: between 0 and 10000.');
eq('a negative code value', validatePoints(stored({ level4: { default: 100, '4.1': -1 } })).gu, 'Level 4.1 points: between 0 and 10000.');
eq('a string default', validatePoints(stored({ level4: { default: '100' } })).gu, 'Level 4 default points: enter a number.');
eq('a fractional default', validatePoints(stored({ level4: { default: 100.5 } })).gu, 'Level 4 default points: enter a whole number.');
eq('an out-of-range default', validatePoints(stored({ level4: { default: 10001 } })).gu, 'Level 4 default points: between 0 and 10000.');
eq('a code priced 0 is accepted', validatePoints(stored({ level4: { default: 100, '4.1': 0 } })).ok, true);

group('validatePoints - a missing level4 default is refused');
{
  const r = validatePoints(stored({ level4: {} }));
  eq('an empty map has no default', r.ok, false);
  eq('and says what to set', r.gu, 'Level 4 points: set a default for activities with no value of their own.');
}
{
  const r = validatePoints(stored({ level4: { '4.1': 50 } }));
  eq('codes without a default are refused', r.ok, false);
  eq('with the same message', r.gu, 'Level 4 points: set a default for activities with no value of their own.');
}
eq('a default of 0 counts as set', validatePoints(stored({ level4: { default: 0 } })).ok, true);

// ==================================================================== validatePoints, acceptance

group('validatePoints - a good value comes back unchanged');
{
  const good = stored();
  const r = validatePoints(good);
  eq('accepted', r.ok, true);
  eq('returned unchanged', r.points, {
    enabled: true,
    level1: 100,
    level2: 200,
    level3: 300,
    level4: { default: 100 },
  });
  eq('the input is not mutated', good, stored());
  eq('the returned map is a copy, not the input', r.points === good, false);
  eq('the returned level4 is a copy too', r.points.level4 === good.level4, false);
}
eq('the suggestion the panel pre-fills is itself valid', validatePoints(SUGGESTED_POINTS).ok, true);
eq('so is the default it starts from', validatePoints(DEFAULT_POINTS).ok, true);
eq('unknown extra keys are dropped rather than saved', Object.keys(validatePoints({ ...stored(), stray: 9 }).points), ['enabled', 'level1', 'level2', 'level3', 'level4']);

/*
  ────────────────────────────────────────────────────────────────────────────
  The equivalence
  ────────────────────────────────────────────────────────────────────────────

  Anything validatePoints() accepts, resolvePoints() must return unchanged. This is the
  property that keeps the panel's field and the yuvak's award the same number: the panel
  validates before it writes, the server resolves before it pays, and if those two functions
  ever describe one stored row differently the disagreement is invisible from both ends.
*/
group('validatePoints accepts only what resolvePoints returns unchanged');
{
  const GOOD = [
    { enabled: false, level1: 0, level2: 0, level3: 0, level4: { default: 0 } },
    { enabled: true, level1: 0, level2: 0, level3: 0, level4: { default: 0 } },
    { enabled: true, level1: 100, level2: 200, level3: 300, level4: { default: 100 } },
    { enabled: true, level1: 10000, level2: 10000, level3: 10000, level4: { default: 10000 } },
    { enabled: true, level1: 1, level2: 2, level3: 3, level4: { default: 4, '4.1': 50, '4.2': 0, '10.3': 10000 } },
    { enabled: false, level1: 100, level2: 200, level3: 300, level4: { default: 100, '4.1': 500 } },
    { enabled: true, level1: 0, level2: 10000, level3: 1, level4: { default: 0, '4.12': 9999 } },
    DEFAULT_POINTS,
    SUGGESTED_POINTS,
  ];
  for (const g of GOOD) {
    const label = JSON.stringify(g);
    const r = validatePoints(g);
    eq(`accepted: ${label}`, r.ok, true);
    eq(`resolver returns it unchanged: ${label}`, resolvePoints(g), r.points);
    eq(`the resolver agrees with itself on the validator's output: ${label}`, resolvePoints(r.points), r.points);
    eq(`re-validating the validator's output accepts it: ${label}`, validatePoints(r.points).points, r.points);
  }

  // And the pay-out itself, straight through both, for the whole ladder.
  const p = validatePoints(GOOD[4]).points;
  eq('the award the panel would show is the award the resolver computes', [
    pointsFor(resolvePoints(GOOD[4]), 1),
    pointsFor(resolvePoints(GOOD[4]), 2),
    pointsFor(resolvePoints(GOOD[4]), 3),
    pointsFor(resolvePoints(GOOD[4]), 4, '4.1'),
    pointsFor(resolvePoints(GOOD[4]), 4, '4.2'),
    pointsFor(resolvePoints(GOOD[4]), 4, '4.9'),
  ], [1, 2, 3, 50, 0, 4]);
  eq('and computing it from the validator output gives the same list', [
    pointsFor(p, 1),
    pointsFor(p, 2),
    pointsFor(p, 3),
    pointsFor(p, 4, '4.1'),
    pointsFor(p, 4, '4.2'),
    pointsFor(p, 4, '4.9'),
  ], [1, 2, 3, 50, 0, 4]);
}

// ==================================================================== history, the labels

group('history - the labels a યુવક reads');
eq('a level label for every level', Object.keys(LEVEL_LABEL), ['1', '2', '3', '4']);
eq('an activity label for every fixed key', Object.keys(ACTIVITY_LABEL).sort(), ['darshan', 'revision', 'video']);
eq('the two outcomes are labelled', Object.keys(STATUS_LABEL).sort(), ['COMPLETED', 'REVISION_REQUIRED']);
eq('nothing is called a failure', Object.values(STATUS_LABEL).some((s) => s.includes('નિષ્ફળ')), false);
eq('the labels are frozen', [Object.isFrozen(LEVEL_LABEL), Object.isFrozen(ACTIVITY_LABEL), Object.isFrozen(STATUS_LABEL)], [true, true, true]);

group('isISODay - the shape activity_date is compared in everywhere');
for (const good of ['2026-08-13', '2026-01-01', '1999-12-31']) {
  eq(`accepts ${good}`, isISODay(good), true);
}
for (const bad of ['13-08-2026', '2026-8-13', '2026/08/13', '', null, undefined, 20260813, '2026-08-13T00:00:00Z']) {
  eq(`refuses ${JSON.stringify(bad)}`, isISODay(bad), false);
}
eq('the regex is exported for the migration to be checked against', ISO_DAY_RE.source, '^\\d{4}-\\d{2}-\\d{2}$');

// ==================================================================== normaliseHistoryRow

group('normaliseHistoryRow - both vocabularies, one shape');
{
  const snake = normaliseHistoryRow({
    activity_date: '2026-08-13',
    level_id: 3,
    activity_key: 'revision',
    attempt_count: 2,
    completed_items: 82,
    total_items: 108,
    status: 'COMPLETED',
    points: 300,
  });
  const camel = normaliseHistoryRow({
    activityDate: '2026-08-13',
    levelId: 3,
    activityKey: 'revision',
    attemptCount: 2,
    completedItems: 82,
    totalItems: 108,
    status: 'COMPLETED',
    points: 300,
  });
  eq('snake_case normalises', snake, {
    activityDate: '2026-08-13',
    levelId: 3,
    activityKey: 'revision',
    title: 'વર્ણન યાદી',
    attemptCount: 2,
    completedItems: 82,
    totalItems: 108,
    status: 'COMPLETED',
    points: 300,
  });
  eq('camelCase normalises to exactly the same row', camel, snake);
  eq('the key order is the same, so two screens serialise alike', Object.keys(camel), Object.keys(snake));
}
eq('camelCase wins when both are present, and neither throws', normaliseHistoryRow({ activityDate: '2026-08-14', activity_date: '2026-08-13', level_id: 1 }).activityDate, '2026-08-14');

group('normaliseHistoryRow - a row that cannot be understood is dropped, not half-rendered');
for (const bad of [null, undefined, 'row', 100, true, []]) {
  eq(`${JSON.stringify(bad)} is not a row`, normaliseHistoryRow(bad), null);
}
eq('no date at all', normaliseHistoryRow(row({ activity_date: undefined })), null);
eq('a date in the wrong order', normaliseHistoryRow(row({ activity_date: '13-08-2026' })), null);
eq('a timestamp is not a business date', normaliseHistoryRow(row({ activity_date: '2026-08-13T10:00:00Z' })), null);
eq('an empty date', normaliseHistoryRow(row({ activity_date: '' })), null);
eq('a null date', normaliseHistoryRow(row({ activity_date: null })), null);
eq('level 0', normaliseHistoryRow(row({ level_id: 0 })), null);
eq('level 5', normaliseHistoryRow(row({ level_id: 5 })), null);
eq('a negative level', normaliseHistoryRow(row({ level_id: -1 })), null);
eq('a fractional level', normaliseHistoryRow(row({ level_id: 2.5 })), null);
eq('a level that is not a number at all', normaliseHistoryRow(row({ level_id: 'two' })), null);
eq('no level', normaliseHistoryRow(row({ level_id: undefined })), null);
eq('a level 4 row survives', normaliseHistoryRow(row({ level_id: 4, activity_key: '4.1' })).levelId, 4);
eq("a bigint arriving as the string '3' is still level 3", normaliseHistoryRow(row({ level_id: '3' })).levelId, 3);

group('normaliseHistoryRow - an unknown status reads as થોડું બાકી, never as done');
for (const bad of ['PENDING', 'IN_PROGRESS', 'completed', 'Completed', '', null, undefined, 1, true, {}]) {
  eq(`status ${JSON.stringify(bad)}`, normaliseHistoryRow(row({ status: bad })).status, 'REVISION_REQUIRED');
}
eq('only the exact word is completion', normaliseHistoryRow(row({ status: 'COMPLETED' })).status, 'COMPLETED');
eq('REVISION_REQUIRED passes through', normaliseHistoryRow(row({ status: 'REVISION_REQUIRED' })).status, 'REVISION_REQUIRED');

group('normaliseHistoryRow - the title, and the counts');
eq('a લેવલ ૪ row carries the કસોટી own name', normaliseHistoryRow(row({ level_id: 4, activity_key: '4.1', title: 'ધ્યાનની કસોટી' })).title, 'ધ્યાનની કસોટી');
eq('activity_title is accepted too', normaliseHistoryRow(row({ level_id: 4, activity_key: '4.1', activity_title: 'બીજી કસોટી' })).title, 'બીજી કસોટી');
eq('લેવલ ૧ falls back to the fixed label', normaliseHistoryRow(row({ level_id: 1, activity_key: 'video' })).title, 'વિડિયો દર્શન');
eq('લેવલ ૨ falls back', normaliseHistoryRow(row({ level_id: 2, activity_key: 'darshan' })).title, 'દર્શન');
eq('લેવલ ૩ falls back', normaliseHistoryRow(row({ level_id: 3, activity_key: 'revision' })).title, 'વર્ણન યાદી');
eq('an unknown key with no title is empty, never the word undefined', normaliseHistoryRow(row({ activity_key: 'mystery' })).title, '');
eq('a missing activity key is the empty string', normaliseHistoryRow(row({ activity_key: undefined })).activityKey, '');
eq('missing counts are 0, not NaN', normaliseHistoryRow({ activity_date: '2026-08-13', level_id: 1 }), {
  activityDate: '2026-08-13',
  levelId: 1,
  activityKey: '',
  title: '',
  attemptCount: 0,
  completedItems: 0,
  totalItems: 0,
  status: 'REVISION_REQUIRED',
  points: 0,
});
eq('a negative count is 0', normaliseHistoryRow(row({ attempt_count: -3 })).attemptCount, 0);
eq('negative points are 0 - nothing is ever taken away', normaliseHistoryRow(row({ points: -100 })).points, 0);
eq('a fractional count floors', normaliseHistoryRow(row({ attempt_count: 2.9 })).attemptCount, 2);
eq('a NaN count is 0', normaliseHistoryRow(row({ total_items: NaN })).totalItems, 0);
eq('a string count still reads', normaliseHistoryRow(row({ completed_items: '82', total_items: '108' })), normaliseHistoryRow(row({ completed_items: 82, total_items: 108 })));
eq('the totalItems arrives on the row and is not recomputed', normaliseHistoryRow(row({ completed_items: 82, total_items: 108 })).totalItems, 108);
eq('an old day keeps its own total after the collection grows', normaliseHistoryRow(row({ completed_items: 82, total_items: 108 })).totalItems === 109, false);

// ==================================================================== groupByDate

group('groupByDate - nothing to group');
for (const bad of [null, undefined, 'rows', 100, {}, []]) {
  eq(`${JSON.stringify(bad)} gives []`, groupByDate(bad), []);
}
eq('a list of junk gives []', groupByDate([null, undefined, 3, 'x', {}, []]), []);
eq('one good row among junk survives', groupByDate([null, row({ points: 5 }), 'x']).length, 1);
eq('and the junk is not counted into its points', groupByDate([null, row({ points: 5 }), 'x'])[0].points, 5);

group('groupByDate - days descend, newest first');
{
  const days = groupByDate([
    row({ activity_date: '2026-08-11' }),
    row({ activity_date: '2026-08-14' }),
    row({ activity_date: '2026-08-12' }),
    row({ activity_date: '2026-08-13' }),
  ]);
  eq('four days', days.length, 4);
  eq('newest first, because "what did I do today" is the question', days.map((d) => d.date), [
    '2026-08-14',
    '2026-08-13',
    '2026-08-12',
    '2026-08-11',
  ]);
  eq('across a month boundary', groupByDate([row({ activity_date: '2026-08-01' }), row({ activity_date: '2026-07-31' })]).map((d) => d.date), ['2026-08-01', '2026-07-31']);
  eq('across a year boundary', groupByDate([row({ activity_date: '2025-12-31' }), row({ activity_date: '2026-01-01' })]).map((d) => d.date), ['2026-01-01', '2025-12-31']);
}

group('groupByDate - rows inside a day ascend by level, the order he walked it');
{
  const day = groupByDate([
    row({ level_id: 4, activity_key: '4.1' }),
    row({ level_id: 1, activity_key: 'video' }),
    row({ level_id: 3, activity_key: 'revision' }),
    row({ level_id: 2, activity_key: 'darshan' }),
  ])[0];
  eq('one day', day.date, '2026-08-13');
  eq('the ladder in order', day.rows.map((r) => r.levelId), [1, 2, 3, 4]);
  eq('a day never reads as though he climbed it backwards', day.rows[0].levelId < day.rows[3].levelId, true);
}
{
  const day = groupByDate([
    row({ level_id: 4, activity_key: '4.3' }),
    row({ level_id: 4, activity_key: '4.1' }),
    row({ level_id: 4, activity_key: '4.2' }),
  ])[0];
  eq('two કસોટીઓ on one day are broken by code, stably', day.rows.map((r) => r.activityKey), ['4.1', '4.2', '4.3']);
}

group('groupByDate - a day carries its own points, summed from its own rows');
{
  const days = groupByDate([
    row({ activity_date: '2026-08-13', level_id: 1, points: 100 }),
    row({ activity_date: '2026-08-13', level_id: 2, points: 200 }),
    row({ activity_date: '2026-08-13', level_id: 3, points: 0 }),
    row({ activity_date: '2026-08-12', level_id: 1, points: 100 }),
  ]);
  eq('today', days[0].points, 300);
  eq('yesterday', days[1].points, 100);
  eq('a zero row is counted as zero, not skipped', days[0].rows.length, 3);
  eq('an unpaid day is 0, not absent', groupByDate([row({ points: 0 })])[0].points, 0);
  eq('a negative stored value cannot reduce a day', groupByDate([row({ points: 100 }), row({ level_id: 3, points: -50 })])[0].points, 100);
  eq('every day has a points number', days.every((d) => typeof d.points === 'number'), true);
  eq('the shape of a day', Object.keys(days[0]), ['date', 'rows', 'points']);
}
eq('the input array is not reordered under the caller', (() => {
  const input = [row({ level_id: 3 }), row({ level_id: 1 })];
  groupByDate(input);
  return input.map((r) => r.level_id);
})(), [3, 1]);

// ==================================================================== summariseRow

group('summariseRow - coverage, for the levels that ask how many you hold');
eq('82 of 108', summariseRow({ completedItems: 82, totalItems: 108, attemptCount: 3, status: 'REVISION_REQUIRED' }), '82 / 108');
eq('a complete coverage still reads as coverage', summariseRow({ completedItems: 108, totalItems: 108, attemptCount: 1, status: 'COMPLETED' }), '108 / 108');
eq('none of them yet', summariseRow({ completedItems: 0, totalItems: 108, attemptCount: 1, status: 'REVISION_REQUIRED' }), '0 / 108');
eq('coverage beats the attempt count', summariseRow({ completedItems: 5, totalItems: 10, attemptCount: 9, status: 'COMPLETED' }), '5 / 10');

group('summariseRow - repetition, for the levels with nothing to count but the doing');
eq('5 times', summariseRow({ completedItems: 0, totalItems: 0, attemptCount: 5, status: 'COMPLETED' }), '5 વાર');
eq('2 times', summariseRow({ completedItems: 0, totalItems: 0, attemptCount: 2, status: 'COMPLETED' }), '2 વાર');
eq('11 times', summariseRow({ completedItems: 0, totalItems: 0, attemptCount: 11, status: 'COMPLETED' }), '11 વાર');

group('summariseRow - a single attempt with nothing to count says that it happened');
eq('once, and completed', summariseRow({ completedItems: 0, totalItems: 0, attemptCount: 1, status: 'COMPLETED' }), 'પૂરું થયું');
eq('once, and revision is still owed', summariseRow({ completedItems: 0, totalItems: 0, attemptCount: 1, status: 'REVISION_REQUIRED' }), 'થોડું બાકી');
eq('zero attempts falls to the status, not to "0 વાર"', summariseRow({ completedItems: 0, totalItems: 0, attemptCount: 0, status: 'COMPLETED' }), 'પૂરું થયું');
eq('no row at all is empty, never undefined', summariseRow(null), '');
eq('undefined', summariseRow(undefined), '');

group('summariseRow - the digit renderer is applied, and only to digits');
eq('coverage goes through the renderer', summariseRow({ completedItems: 82, totalItems: 108, attemptCount: 1, status: 'COMPLETED' }, mark), '[82] / [108]');
eq('repetition goes through the renderer', summariseRow({ completedItems: 0, totalItems: 0, attemptCount: 5, status: 'COMPLETED' }, mark), '[5] વાર');
eq('a bare status has no digits to render', summariseRow({ completedItems: 0, totalItems: 0, attemptCount: 1, status: 'COMPLETED' }, mark), 'પૂરું થયું');
eq('the real renderer gives Gujarati digits', summariseRow({ completedItems: 82, totalItems: 108, attemptCount: 1, status: 'COMPLETED' }, gu), 'a / b'.replace('a', gu(82)).replace('b', gu(108)));
eq('and Gujarati digits for the repetition count', summariseRow({ completedItems: 0, totalItems: 0, attemptCount: 5, status: 'COMPLETED' }, gu), `${gu(5)} વાર`);
eq('the default renderer is String, so the module holds no opinion about digits', summariseRow({ completedItems: 82, totalItems: 108, attemptCount: 1, status: 'COMPLETED' }), '82 / 108');

group('summariseRow - straight off a normalised row');
eq('a લેવલ ૩ attempt', summariseRow(normaliseHistoryRow(row({ level_id: 3, activity_key: 'revision', completed_items: 82, total_items: 108, status: 'REVISION_REQUIRED' }))), '82 / 108');
eq('a લેવલ ૨ day of five દર્શન', summariseRow(normaliseHistoryRow(row({ level_id: 2, attempt_count: 5 }))), '5 વાર');
eq('a લેવલ ૧ single answer', summariseRow(normaliseHistoryRow(row({ level_id: 1, activity_key: 'video', attempt_count: 1 }))), 'પૂરું થયું');

// ==================================================================== normalisePointSummary

group('normalisePointSummary - the ledger says both numbers, and nothing here adds them up');
eq('nothing', normalisePointSummary(undefined), { today: 0, total: 0 });
eq('null', normalisePointSummary(null), { today: 0, total: 0 });
eq('a string', normalisePointSummary('900'), { today: 0, total: 0 });
eq('a number', normalisePointSummary(900), { today: 0, total: 0 });
eq('an empty object', normalisePointSummary({}), { today: 0, total: 0 });
eq('camelCase', normalisePointSummary({ today: 300, total: 12400 }), { today: 300, total: 12400 });
eq('snake_case from the rpc', normalisePointSummary({ today_points: 300, total_points: 12400 }), { today: 300, total: 12400 });
eq('a driver returning numerics as strings still reads', normalisePointSummary({ today_points: '300', total_points: '12400' }), { today: 300, total: 12400 });
eq('a missing half is 0, not undefined', normalisePointSummary({ today: 300 }), { today: 300, total: 0 });
eq('the other missing half', normalisePointSummary({ total: 12400 }), { today: 0, total: 12400 });
eq('negatives read as 0 - the ledger only ever adds', normalisePointSummary({ today: -5, total: -900 }), { today: 0, total: 0 });
eq('NaN reads as 0 rather than throwing on a screen the ધ્યાન does not depend on', normalisePointSummary({ today: NaN, total: NaN }), { today: 0, total: 0 });
eq('garbage values', normalisePointSummary({ today: 'x', total: {} }), { today: 0, total: 0 });
eq('a fraction floors', normalisePointSummary({ today: 300.9, total: 0 }), { today: 300, total: 0 });
eq('the shape is always the same two keys', Object.keys(normalisePointSummary(null)), ['today', 'total']);
eq('today may exceed nothing it should not - it is simply reported', normalisePointSummary({ today: 12400, total: 300 }), { today: 12400, total: 300 });

// ==================================================================== §39 - the daily reset

/*
  ────────────────────────────────────────────────────────────────────────────
  §39 acceptance: a new day never deletes yesterday
  ────────────────────────────────────────────────────────────────────────────

  §25 states the mechanism: there is no cron job, and there must not be one — a new IST day
  simply has no `daily_activity_progress` row yet, so "find or create today" returns an empty
  one while yesterday's sits untouched beside it. A job whose purpose is to delete yesterday
  is a job that will one day delete today.

  That is a property of the data, so it can be proved here with no database at all: take a
  finished ૧૩ ઑગસ્ટ, add a ૧૪ ઑગસ્ટ row, and assert that the ૧૩ ઑગસ્ટ group is byte-identical
  to what it was — same rows, same order, same points.
*/

const AUG13 = [
  // Deliberately shuffled, so the grouping does the ordering and not the fixture.
  row({ activity_date: '2026-08-13', level_id: 3, activity_key: 'revision', attempt_count: 3, completed_items: 82, total_items: 108, status: 'REVISION_REQUIRED', points: 0 }),
  row({ activity_date: '2026-08-13', level_id: 1, activity_key: 'video', attempt_count: 2, points: 100 }),
  row({ activity_date: '2026-08-13', level_id: 4, activity_key: '4.1', title: 'પહેલી કસોટી', attempt_count: 1, points: 100 }),
  row({ activity_date: '2026-08-13', level_id: 2, activity_key: 'darshan', attempt_count: 5, points: 200 }),
];

const AUG14 = row({ activity_date: '2026-08-14', level_id: 1, activity_key: 'video', attempt_count: 1, points: 100 });

group('§39 - 13 ઑગસ્ટ, as it was lived');
{
  const days = groupByDate(AUG13);
  eq('one day', days.length, 1);
  eq('and it is the 13th', days[0].date, '2026-08-13');
  eq('all four rows are there', days[0].rows.length, 4);
  eq('in ladder order', days[0].rows.map((r) => r.levelId), [1, 2, 3, 4]);
  eq('the day is worth what its rows are worth', days[0].points, 400);
  eq('and each row reads as what it measured', days[0].rows.map((r) => summariseRow(r)), [
    '2 વાર',
    '5 વાર',
    '82 / 108',
    'પૂરું થયું',
  ]);
  eq('the કસોટી kept its own name', days[0].rows[3].title, 'પહેલી કસોટી');
  eq('the unfinished લેવલ ૩ is not called a failure', days[0].rows[2].status, 'REVISION_REQUIRED');
  eq('and it earned nothing, without consuming anything', days[0].rows[2].points, 0);
}

group('§39 - 14 ઑગસ્ટ arrives and yesterday is untouched');
{
  const before = groupByDate(AUG13);
  const after = groupByDate([...AUG13, AUG14]);

  eq('there are now two days', after.length, 2);
  eq('today is first', after[0].date, '2026-08-14');
  eq('yesterday is still there', after[1].date, '2026-08-13');
  eq('yesterday is identical in every respect', JSON.stringify(after[1]), JSON.stringify(before[0]));
  eq('same rows', after[1].rows.length, 4);
  eq('same order', after[1].rows.map((r) => r.levelId), [1, 2, 3, 4]);
  eq('same points - a new day does not reach back', after[1].points, 400);
  eq('same summaries', after[1].rows.map((r) => summariseRow(r)), before[0].rows.map((r) => summariseRow(r)));
  eq('today carries only today', after[0].rows.length, 1);
  eq('and only today points', after[0].points, 100);
  eq('the two days do not share rows', after[0].rows[0] === after[1].rows[0], false);
}

group('§39 - a day with nothing in it simply is not there');
{
  const days = groupByDate(AUG13);
  eq('the 14th, before anything is done on it, has no group at all', days.some((d) => d.date === '2026-08-14'), false);
  eq('and its absence has not emptied the 13th', days[0].rows.length, 4);
  eq('nor zeroed it', days[0].points, 400);

  // The other direction: rows arriving out of order, days apart, still land correctly.
  const scattered = groupByDate([AUG14, ...AUG13, row({ activity_date: '2026-08-10', level_id: 1, points: 100 })]);
  eq('three days', scattered.map((d) => d.date), ['2026-08-14', '2026-08-13', '2026-08-10']);
  eq('and the 13th is still exactly itself', JSON.stringify(scattered[1]), JSON.stringify(groupByDate(AUG13)[0]));
  eq('the gap day is not invented', scattered.some((d) => d.date === '2026-08-11'), false);
}

group('§39 - a second attempt today does not disturb yesterday either');
{
  const before = groupByDate(AUG13)[0];
  const later = groupByDate([
    ...AUG13,
    AUG14,
    row({ activity_date: '2026-08-14', level_id: 3, activity_key: 'revision', attempt_count: 2, completed_items: 108, total_items: 108, status: 'COMPLETED', points: 300 }),
  ]);
  eq('today grew', later[0].rows.length, 2);
  eq('today is worth more', later[0].points, 400);
  eq("today's લેવલ ૩ finished", summariseRow(later[0].rows[1]), '108 / 108');
  eq('yesterday is byte-identical', JSON.stringify(later[1]), JSON.stringify(before));
  eq('yesterday still reads 82 / 108 after today read 108 / 108', summariseRow(later[1].rows[2]), '82 / 108');
}

// ==================================================================== drift against the migration

/*
  ────────────────────────────────────────────────────────────────────────────
  The module against the SQL that mirrors it
  ────────────────────────────────────────────────────────────────────────────

  `point_value_for()` awards from the same map the panel shows, and `activity_submit()` writes
  the ledger row. Nothing in this module can check that, because a module must not import a
  migration — so it is checked here, by reading the SQL as text, exactly as
  scripts/test-navigation.mjs:694-712 checks the nav registry against src/App.jsx. String
  containment only: this suite never executes SQL and has no database to execute it against.
*/

const SQL_0021 = new URL('../supabase/migrations/0021_progress_history_points.sql', import.meta.url);

group('the migration agrees with shared/domain/points.js');
if (!existsSync(fileURLToPath(SQL_0021))) {
  skip('points vs 0021_progress_history_points.sql', 'the migration does not exist yet - re-run once it lands');
} else {
  const sql = readFileSync(SQL_0021, 'utf8');
  const flat = sql.toLowerCase().replace(/\s+/g, ' ');
  const has = (s) => flat.includes(s.toLowerCase());

  eq('the migration was read at all', sql.length > 0, true);

  // ---- the bounds, which a trigger enforces and this module also enforces ----
  eq('the migration carries the same bounds', [String(POINT_MIN), String(POINT_MAX)].every((n) => sql.includes(n)), true);
  eq('the settings key it guards is named', has(POINTS_KEY), true);

  // ---- everything the migration is expected to define -----------------------
  const missing = [
    'point_settings',
    'point_value_for',
    'activity_submit',
    'award_points',
    'my_point_summary',
    'settings_check_points',
  ].filter((n) => !has(n));
  eq('every function the app calls is defined in the migration', missing, []);

  const missingTables = ['activity_attempts', 'daily_activity_progress', 'point_transactions'].filter((t) => !has(t));
  eq('the three tables are named', missingTables, []);

  // ---- the once-per-day guarantee, which lives here and nowhere else --------
  const missingCols = ['user_id', 'activity_date', 'level_id', 'activity_key'].filter((c) => !has(c));
  eq('the four columns of the no-duplicate key are named', missingCols, []);
  eq(
    'the unique constraint is over exactly those four, in order',
    /unique\s*\(\s*user_id\s*,\s*activity_date\s*,\s*level_id\s*,\s*activity_key\s*\)/.test(flat),
    true
  );

  // ---- the business date is the server's, not the phone's -------------------
  eq("the day is decided in Asia/Kolkata", sql.includes("timezone('Asia/Kolkata'"), true);

  // ---- the submit path runs above RLS, so it can write the ledger -----------
  eq('security definer', has('security definer'), true);

  // ---- the identities the ledger stores ------------------------------------
  const missingKeys = Object.values(ACTIVITY_KEY).filter((k) => !sql.includes(`'${k}'`) && !sql.includes(k));
  eq('every activity key this module names appears in the SQL', missingKeys, []);
  eq('and each one individually', [
    sql.includes(ACTIVITY_KEY.VIDEO),
    sql.includes(ACTIVITY_KEY.DARSHAN),
    sql.includes(ACTIVITY_KEY.REVISION),
  ], [true, true, true]);

  // ---- the two outcomes, in the same words -----------------------------------
  eq('both attempt statuses are named', Object.values(ATTEMPT_STATUS).every((s) => sql.includes(s)), true);
}

// ==================================================================== §62 rule - no literal total

group('neither module holds a total (§62)');
for (const rel of ['../shared/domain/points.js', '../shared/domain/history.js']) {
  const source = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
  // Comments are prose and may name ૧૦૮ as an example; code may not.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n');
  eq(`${rel} - the file was read`, source.length > 0, true);
  eq(`${rel} - no literal total`, /\b(108|109|110)\b/.test(code), false);
  eq(`${rel} - no TOTAL constant`, /\bTOTAL\b/.test(code), false);
}

// ==================================================================== result

console.log(`\n  ${pass} passed, ${fails.length} failed\n`);
if (fails.length) {
  console.log(fails.map((f) => `  ✗ ${f}`).join('\n\n') + '\n');
  process.exit(1);
}
