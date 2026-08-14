/**
 * Tests for 0031's rule keys — `node scripts/test-point-rules.mjs`.
 *
 * The same shape as scripts/test-points.mjs and for the same reason it gives: everything under
 * test is a pure function over plain data — no database, no network, no React, no clock — so it
 * can be checked exactly and cheaply, and adding a framework to run assertions on one module is
 * not worth a dependency. Exit code is the result: 0 green, 1 red.
 *
 * The authority for every assertion in this file is supabase/migrations/0031_point_engine.sql,
 * not this file's own opinion. `point_rules()` (0031:208), `point_rule_live()` (0031:321) and
 * `settings_check_points()` (0031:736) are what the ledger actually obeys; the four functions
 * tested here exist so the panel can promise the same numbers before the row is written. Where
 * the two could differ the SQL is right, and the last group in this file reads that SQL as text
 * to say so out loud.
 *
 * What it protects, specifically. Every one of these fails **silently** in production — no
 * throw, no red screen, no log line; a યુવક is simply paid a number nobody chose, or stops being
 * paid at all on a day nobody was watching:
 *
 *   1. **A settings row written before 0031 resolving to anything but yesterday.** This is the
 *      whole deployment contract: the migration ships, two thousand યુવકો keep the awarding they
 *      had, and the panel arrives whenever it is ready. `resolvePointRules({})` must be
 *      DEFAULT_POINT_RULES to the byte, and DEFAULT_POINT_RULES must be 0021's behaviour.
 *
 *   2. **`byCode` reading a key that is not a કસોટી.** The overrides live among `repeat`'s own
 *      keys (0031:271-280), beside `enabled`, `default` and `dailyLimit`. A resolver that took
 *      every key would price a કસોટી called "dailyLimit" and pay the day's limit as ગુણ.
 *
 *   3. **`repeat.enabled` being anything other than JSON `true`.** The stored value is jsonb, so
 *      the string 'false' is truthy. A truthiness test starts paying repeat awards to everybody
 *      because somebody's form serialised a checkbox as text, and nobody pressed anything.
 *
 *   4. **A tick mode that is not one of the three.** ACTIVITY is the only fallback that keeps
 *      લેવલ ૩ paying what it paid yesterday; anything else either pays twice for one નોંધાવો or
 *      stops paying it.
 *
 *   5. **A malformed `effectiveFrom` reading as "not yet in force".** That direction stops every
 *      award in the project on a typo, and an award that never arrives is invisible from both
 *      ends. null — in force since forever — is the only safe reading.
 *
 *   6. **A date compared through a Date object.** `new Date('2026-08-14')` is midnight UTC,
 *      which is ૫:૩૦ on the ૧૪મી in Asia/Kolkata. Y-M-D strings compare as dates, and that is
 *      why the format is load-bearing rather than cosmetic.
 *
 *   7. **The resolver and the validator disagreeing.** Anything `validatePointRules()` accepts,
 *      `resolvePointRules()` must carry through unchanged. The moment that breaks, the figure in
 *      the panel's field and the figure in the yuvak's ledger are two different figures, and the
 *      Save that caused it succeeded.
 *
 *   8. **A refusal 0031 makes that this module does not.** Then the panel offers a value the
 *      trigger throws on, and the સંચાલક reads a raw postgres error instead of a sentence.
 *
 *   9. **A refusal this module makes that 0031 does not.** Then the panel refuses a row the
 *      server would have accepted, which is a field he cannot use and cannot find out why.
 *
 *  10. **An em dash reaching a user-visible string.** It renders as a broken overlapping glyph
 *      in the panel's font. Comments may use it; strings may not, and that is checked by reading
 *      this module's own source.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ACTIVITY_CODE_RE,
  DEFAULT_POINT_RULES,
  DISABLED_LEVEL_RE,
  EFFECTIVE_DAY_RE,
  POINT_MAX,
  POINT_MIN,
  REPEAT_DAILY_LIMIT_MAX,
  REPEAT_DAILY_LIMIT_MIN,
  RULE_VERSION_MAX,
  RULE_VERSION_MIN,
  TICK_DAILY_CAP_MAX,
  TICK_DAILY_CAP_MIN,
  TICK_MODE,
  isPointRuleLive,
  repeatValueFor,
  resolvePointRules,
  validatePointRules,
  validatePoints,
  // 0035's pace rule — the mirror of point_pace() and settings_check_pace().
  DEFAULT_PACE,
  PACE_GRACE_MAX,
  PACE_GRACE_MIN,
  PACE_MAX_GAP_MAX,
  PACE_MAX_GAP_MIN,
  PACE_SECONDS_MAX,
  PACE_SECONDS_MIN,
  eligibleTicks,
  requiredSeconds,
  resolvePointPace,
  validatePointPace,
} from '../shared/domain/points.js';

let pass = 0;
const fails = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) pass++;
  else fails.push(`${name}\n       got  ${g}\n       want ${w}`);
};

const group = (name) => console.log(`\n  ${name}`);

/** A check that could not be run at all, said out loud. Not a pass, and not a failure. */
const skipped = [];
const skip = (name, why) => {
  skipped.push(name);
  console.log(`    SKIPPED  ${name}  -  ${why}`);
};

// ==================================================================== fixtures

/** The 0021 half of the points object, which every valid row must still carry. */
const base = () => ({
  enabled: true,
  level1: 100,
  level2: 200,
  level3: 300,
  level4: { default: 100 },
});

/** A points object with 0031 keys on top of it. */
const stored = (over = {}) => ({ ...base(), ...over });

/** DEFAULT_POINT_RULES as a plain object, so "the default is 0021" is written out once. */
const YESTERDAY = {
  version: 0,
  effectiveFrom: null,
  disabled: [],
  repeat: { enabled: false, default: 0, dailyLimit: 0, byCode: {} },
  tick: { mode: 'ACTIVITY', perTick: 0, perRevision: 0, dailyCap: 0 },
  // 0033's earning modes. Every level DAY_FIRST and ticks FRESH *is* 0021's behaviour, which is
  // why they belong in this object rather than beside it: the whole point of writing yesterday
  // out by hand is that adding a key with a different default would fail here, loudly, on the
  // assertion that says the default rule set changes nothing.
  earn: {
    level1: 'DAY_FIRST',
    level2: 'DAY_FIRST',
    level3: 'DAY_FIRST',
    level4: 'DAY_FIRST',
    tickCount: 'FRESH',
  },
};

/** Resolved rules with only the named fields changed, for the liveness and repeat groups. */
const live = (over = {}) => ({ ...YESTERDAY, ...over });

// ==================================================================== the constants

group('constants - the bounds 0031 states field by field');
eq('the three modes, and ACTIVITY first', TICK_MODE, {
  ACTIVITY: 'ACTIVITY',
  TICK: 'TICK',
  REVISION: 'REVISION',
});
eq('the repeat daily limit', [REPEAT_DAILY_LIMIT_MIN, REPEAT_DAILY_LIMIT_MAX], [0, 1000]);
eq('the tick daily cap', [TICK_DAILY_CAP_MIN, TICK_DAILY_CAP_MAX], [0, 100000]);
eq('the version floor', RULE_VERSION_MIN, 0);
eq('the version ceiling is int4, which is what point_rules() casts to', RULE_VERSION_MAX, 2147483647);
eq('the cap is a different order from a single award, so it needs its own ceiling', TICK_DAILY_CAP_MAX > POINT_MAX, true);
eq('the effective-day shape', EFFECTIVE_DAY_RE.source, '^\\d{4}-\\d{2}-\\d{2}$');
eq('the disabled-level shape', DISABLED_LEVEL_RE.source, '^level[1-4]$');
eq('TICK_MODE is frozen', Object.isFrozen(TICK_MODE), true);

group('EFFECTIVE_DAY_RE - the shape effectiveFrom is compared in');
for (const good of ['2026-08-14', '2026-01-01', '1999-12-31']) {
  eq(`accepts ${good}`, EFFECTIVE_DAY_RE.test(good), true);
}
for (const bad of ['14-08-2026', '2026-8-14', '2026/08/14', '', '2026-08-14T00:00:00Z', 'today']) {
  eq(`refuses ${JSON.stringify(bad)}`, EFFECTIVE_DAY_RE.test(bad), false);
}

group('DISABLED_LEVEL_RE - a whole ladder, switched off by name');
for (const good of ['level1', 'level2', 'level3', 'level4']) {
  eq(`accepts ${good}`, DISABLED_LEVEL_RE.test(good), true);
}
for (const bad of ['level0', 'level5', 'level', 'Level2', 'level22', ' level2', '4.1']) {
  eq(`refuses ${JSON.stringify(bad)}`, DISABLED_LEVEL_RE.test(bad), false);
}

// ==================================================================== DEFAULT_POINT_RULES

/*
  ────────────────────────────────────────────────────────────────────────────
  The deployment contract
  ────────────────────────────────────────────────────────────────────────────

  0031's header states it as a promise: "It does not change what an untouched project pays."
  Every key it adds is optional and every absent key resolves to the behaviour of the day before
  it ran. That promise is one equality, and this is it.
*/

group('DEFAULT_POINT_RULES - absent means yesterday');
eq('the default rule set is 0021 behaviour, written out', DEFAULT_POINT_RULES, YESTERDAY);
eq('nothing repeats', DEFAULT_POINT_RULES.repeat.enabled, false);
eq('no repeat is worth anything', DEFAULT_POINT_RULES.repeat.default, 0);
eq('there is no repeat limit to reach', DEFAULT_POINT_RULES.repeat.dailyLimit, 0);
eq('no activity has a repeat price', DEFAULT_POINT_RULES.repeat.byCode, {});
eq('level 3 pays its flat value, as today', DEFAULT_POINT_RULES.tick.mode, 'ACTIVITY');
eq('there is no date to wait for', DEFAULT_POINT_RULES.effectiveFrom, null);
eq('nothing is switched off', DEFAULT_POINT_RULES.disabled, []);
eq('the version stamped on a new award is 0, meaning unversioned', DEFAULT_POINT_RULES.version, 0);
eq('deeply frozen, because it is a shared fallback', [
  Object.isFrozen(DEFAULT_POINT_RULES),
  Object.isFrozen(DEFAULT_POINT_RULES.disabled),
  Object.isFrozen(DEFAULT_POINT_RULES.repeat),
  Object.isFrozen(DEFAULT_POINT_RULES.repeat.byCode),
  Object.isFrozen(DEFAULT_POINT_RULES.tick),
], [true, true, true, true, true]);
eq('and a caller cannot quietly switch repeats on for everybody', (() => {
  try {
    DEFAULT_POINT_RULES.repeat.enabled = true;
  } catch {
    // A frozen write throws under a module's implicit strict mode, which is the point.
  }
  return DEFAULT_POINT_RULES.repeat.enabled;
})(), false);

// ==================================================================== resolvePointRules, nothing stored

group('resolvePointRules - nothing usable was stored');
for (const bad of [undefined, null, '', 'points', 0, 300, true, false, NaN, [], [1, 2], () => 1]) {
  eq(`${typeof bad} ${JSON.stringify(bad) ?? String(bad)} resolves to the default`, resolvePointRules(bad), YESTERDAY);
}
eq('an empty object', resolvePointRules({}), YESTERDAY);
eq('a settings row that only knows 0021 keys', resolvePointRules(base()), YESTERDAY);
eq('and it never throws on any of them', true, true);
eq('the shape is always the full shape', Object.keys(resolvePointRules(null)), [
  'version',
  'effectiveFrom',
  'disabled',
  'repeat',
  'tick',
  'earn',
]);
eq('the earn shape, in the order point_rules() builds it', Object.keys(resolvePointRules(null).earn), [
  'level1',
  'level2',
  'level3',
  'level4',
  'tickCount',
]);
eq('the repeat shape, in the order point_rules() builds it', Object.keys(resolvePointRules(null).repeat), [
  'enabled',
  'default',
  'dailyLimit',
  'byCode',
]);
eq('the tick shape', Object.keys(resolvePointRules(null).tick), [
  'mode',
  'perTick',
  'perRevision',
  'dailyCap',
]);
eq('resolving twice is the same answer', resolvePointRules(resolvePointRules(stored())), resolvePointRules(stored()));

/*
  ────────────────────────────────────────────────────────────────────────────
  The resolved shape is not the stored shape, and only one of them is resolved
  ────────────────────────────────────────────────────────────────────────────

  `repeat`'s per-કસોટી overrides are stored flat and resolved nested (0031:271-280), so feeding a
  *resolved* rule set back through the resolver drops them: `byCode` is not a code, so the gather
  step passes over it. That is correct and is worth an assertion rather than a silence, because
  the alternative reading — "resolve is idempotent, so anything may be resolved twice" — is the
  one that would put a resolved object into settings and lose every override the સંચાલક typed.
  Only what came out of the database is ever resolved.
*/
group('resolvePointRules - only a stored row is ever resolved');
eq('a stored row resolves its codes', resolvePointRules(stored({ repeat: { '4.1': 25 } })).repeat.byCode, { '4.1': 25 });
eq('re-resolving the result drops them, because byCode is not a code', resolvePointRules(resolvePointRules(stored({ repeat: { '4.1': 25 } }))).repeat.byCode, {});
eq('everything else survives re-resolution untouched', (() => {
  const once = resolvePointRules(stored({ version: 3, effectiveFrom: '2026-09-01', disabled: ['level2'], repeat: { enabled: true, default: 50, dailyLimit: 3 }, tick: { mode: 'TICK', perTick: 1, dailyCap: 500 } }));
  return JSON.stringify(resolvePointRules(once)) === JSON.stringify(once);
})(), true);
eq('the stored value is never mutated', (() => {
  const s = stored({ repeat: { enabled: true, banana: 5 } });
  resolvePointRules(s);
  return s.repeat;
})(), { enabled: true, banana: 5 });

// ==================================================================== version

group('resolvePointRules - version');
eq('a whole number', resolvePointRules(stored({ version: 3 })).version, 3);
eq('zero', resolvePointRules(stored({ version: 0 })).version, 0);
eq('absent is 0', resolvePointRules(stored()).version, 0);
eq('a negative is clamped to 0, because a label cannot pay anybody', resolvePointRules(stored({ version: -5 })).version, 0);
eq("the string '3' is text, not a version", resolvePointRules(stored({ version: '3' })).version, 0);
eq('null', resolvePointRules(stored({ version: null })).version, 0);
eq('an array', resolvePointRules(stored({ version: [3] })).version, 0);
eq('NaN', resolvePointRules(stored({ version: NaN })).version, 0);
eq('Infinity', resolvePointRules(stored({ version: Infinity })).version, 0);
eq('3.4 rounds down', resolvePointRules(stored({ version: 3.4 })).version, 3);
eq('3.5 rounds up', resolvePointRules(stored({ version: 3.5 })).version, 4);

// ==================================================================== effectiveFrom

group('resolvePointRules - effectiveFrom is a day or nothing');
eq('a day', resolvePointRules(stored({ effectiveFrom: '2026-08-14' })).effectiveFrom, '2026-08-14');
eq('absent', resolvePointRules(stored()).effectiveFrom, null);
eq('null', resolvePointRules(stored({ effectiveFrom: null })).effectiveFrom, null);
for (const bad of ['14-08-2026', '2026-8-14', '2026/08/14', '2026-08-14T00:00:00Z', '', ' 2026-08-14', 'tomorrow', 20260814, {}, []]) {
  eq(`malformed ${JSON.stringify(bad)} is null, never "not yet in force"`, resolvePointRules(stored({ effectiveFrom: bad })).effectiveFrom, null);
}
eq('a malformed date does not stop the rest of the rules resolving', resolvePointRules(stored({ effectiveFrom: 'oops', repeat: { enabled: true, default: 50 } })).repeat.default, 50);

// ==================================================================== disabled

group('resolvePointRules - disabled keeps strings, in order, and nothing else');
eq('absent', resolvePointRules(stored()).disabled, []);
eq('empty', resolvePointRules(stored({ disabled: [] })).disabled, []);
eq('two entries, in the order they were written', resolvePointRules(stored({ disabled: ['4.3', 'level2'] })).disabled, ['4.3', 'level2']);
eq('non-strings are dropped, because point_rule_live() compares strings', resolvePointRules(stored({ disabled: ['4.3', 4, null, true, {}, [], 'level1'] })).disabled, ['4.3', 'level1']);
eq('a string the validator would refuse is still kept, because it can only match nothing', resolvePointRules(stored({ disabled: ['banana'] })).disabled, ['banana']);
eq('duplicates are kept as written', resolvePointRules(stored({ disabled: ['4.1', '4.1'] })).disabled, ['4.1', '4.1']);
for (const bad of ['4.3', null, 0, {}, true, '']) {
  eq(`disabled = ${JSON.stringify(bad)} is not a list`, resolvePointRules(stored({ disabled: bad })).disabled, []);
}

// ==================================================================== repeat

group('resolvePointRules - only JSON true enables repeats');
eq('true', resolvePointRules(stored({ repeat: { enabled: true } })).repeat.enabled, true);
for (const bad of ['true', 'false', 1, 0, '1', null, undefined, {}, [], new Boolean(false)]) {
  eq(`enabled = ${JSON.stringify(bad)} reads as off`, resolvePointRules(stored({ repeat: { enabled: bad } })).repeat.enabled, false);
}
eq('absent', resolvePointRules(stored({ repeat: {} })).repeat.enabled, false);
eq('the values survive a bad switch, so nothing is lost by refusing to pay', resolvePointRules(stored({ repeat: { enabled: 'true', default: 50 } })).repeat, {
  enabled: false,
  default: 50,
  dailyLimit: 0,
  byCode: {},
});

group('resolvePointRules - repeat is not an object');
for (const bad of ['x', 50, true, null, [], [1, 2]]) {
  eq(`repeat = ${JSON.stringify(bad)}`, resolvePointRules(stored({ repeat: bad })).repeat, {
    enabled: false,
    default: 0,
    dailyLimit: 0,
    byCode: {},
  });
}

group('resolvePointRules - repeat.default takes the point bounds, refused not clamped');
eq('a number', resolvePointRules(stored({ repeat: { default: 50 } })).repeat.default, 50);
eq('the floor is inclusive', resolvePointRules(stored({ repeat: { default: POINT_MIN } })).repeat.default, 0);
eq('the ceiling is inclusive', resolvePointRules(stored({ repeat: { default: POINT_MAX } })).repeat.default, 10000);
eq('one over the ceiling is 0, not the ceiling', resolvePointRules(stored({ repeat: { default: 10001 } })).repeat.default, 0);
eq('a mistyped figure pays nothing', resolvePointRules(stored({ repeat: { default: 300000 } })).repeat.default, 0);
eq('below the floor', resolvePointRules(stored({ repeat: { default: -1 } })).repeat.default, 0);
eq("the string '50'", resolvePointRules(stored({ repeat: { default: '50' } })).repeat.default, 0);
eq('49.5 rounds', resolvePointRules(stored({ repeat: { default: 49.5 } })).repeat.default, 50);
eq('NaN', resolvePointRules(stored({ repeat: { default: NaN } })).repeat.default, 0);

group('resolvePointRules - repeat.dailyLimit has its own, smaller ceiling');
eq('a number', resolvePointRules(stored({ repeat: { dailyLimit: 3 } })).repeat.dailyLimit, 3);
eq('0 means no limit and is a real value', resolvePointRules(stored({ repeat: { dailyLimit: 0 } })).repeat.dailyLimit, 0);
eq('the ceiling is inclusive', resolvePointRules(stored({ repeat: { dailyLimit: REPEAT_DAILY_LIMIT_MAX } })).repeat.dailyLimit, 1000);
eq('one over is 0', resolvePointRules(stored({ repeat: { dailyLimit: 1001 } })).repeat.dailyLimit, 0);
eq('a value inside the point bounds but outside this one is still refused', resolvePointRules(stored({ repeat: { dailyLimit: 5000 } })).repeat.dailyLimit, 0);
eq('negative', resolvePointRules(stored({ repeat: { dailyLimit: -1 } })).repeat.dailyLimit, 0);
eq("the string '3'", resolvePointRules(stored({ repeat: { dailyLimit: '3' } })).repeat.dailyLimit, 0);

/*
  ────────────────────────────────────────────────────────────────────────────
  byCode: the per-કસોટી overrides, read from repeat's own keys
  ────────────────────────────────────────────────────────────────────────────

  0031:271-280 gathers them with `where e.key ~ '^[0-9]+\.[0-9]+$'`, so the regex is the whole
  separation between a કસોટી and a setting. `enabled`, `default` and `dailyLimit` cannot match
  it — which is why a fourth reserved key added next year cannot leak in either.
*/

group('resolvePointRules - byCode keeps codes and only codes');
eq('one code', resolvePointRules(stored({ repeat: { '4.1': 50 } })).repeat.byCode, { '4.1': 50 });
eq('several', resolvePointRules(stored({ repeat: { '4.1': 50, '4.12': 25, '10.3': 7 } })).repeat.byCode, {
  '4.1': 50,
  '4.12': 25,
  '10.3': 7,
});
eq('default is not a code', resolvePointRules(stored({ repeat: { default: 50 } })).repeat.byCode, {});
eq('enabled is not a code', resolvePointRules(stored({ repeat: { enabled: true } })).repeat.byCode, {});
eq('dailyLimit is not a code', resolvePointRules(stored({ repeat: { dailyLimit: 3 } })).repeat.byCode, {});
eq('none of the three leak in, together', resolvePointRules(stored({ repeat: { enabled: true, default: 50, dailyLimit: 3 } })).repeat.byCode, {});
eq('and the three still resolve to themselves', resolvePointRules(stored({ repeat: { enabled: true, default: 50, dailyLimit: 3 } })).repeat, {
  enabled: true,
  default: 50,
  dailyLimit: 3,
  byCode: {},
});
for (const bad of ['banana', '4', '4.', '.1', '4.1.2', '', ' 4.1', '4.1 ', '4,1', 'Default', 'toString', 'constructor', '__proto__']) {
  eq(`${JSON.stringify(bad)} is not a code and is dropped`, resolvePointRules(stored({ repeat: { [bad]: 50 } })).repeat.byCode, {});
}
eq('good and bad keys together - only the bad ones go', resolvePointRules(stored({ repeat: { enabled: true, default: 10, dailyLimit: 2, '4.1': 50, banana: 9, '4.2': 0, '4.': 1, '10.3': 7 } })).repeat.byCode, {
  '4.1': 50,
  '4.2': 0,
  '10.3': 7,
});

group('resolvePointRules - byCode values, dropped rather than zeroed');
eq('a priced 0 is kept, because 0 is a price', resolvePointRules(stored({ repeat: { '4.2': 0 } })).repeat.byCode, { '4.2': 0 });
eq('out of range drops the code entirely', resolvePointRules(stored({ repeat: { default: 10, '4.1': 10001 } })).repeat.byCode, {});
eq('negative drops it', resolvePointRules(stored({ repeat: { '4.1': -1 } })).repeat.byCode, {});
eq("the string '500' drops it", resolvePointRules(stored({ repeat: { '4.1': '500' } })).repeat.byCode, {});
eq('null drops it', resolvePointRules(stored({ repeat: { '4.1': null } })).repeat.byCode, {});
eq('NaN drops it', resolvePointRules(stored({ repeat: { '4.1': NaN } })).repeat.byCode, {});
eq('Infinity drops it', resolvePointRules(stored({ repeat: { '4.1': Infinity } })).repeat.byCode, {});
eq('a fraction rounds', resolvePointRules(stored({ repeat: { '4.1': 49.5 } })).repeat.byCode, { '4.1': 50 });
eq('the ceiling is inclusive', resolvePointRules(stored({ repeat: { '4.1': POINT_MAX } })).repeat.byCode, { '4.1': 10000 });
eq('one bad code does not take a good one down with it', resolvePointRules(stored({ repeat: { '4.1': 50, '4.2': 99999 } })).repeat.byCode, { '4.1': 50 });

// ==================================================================== tick

group('resolvePointRules - tick.mode falls to ACTIVITY, the only safe fallback');
for (const mode of ['ACTIVITY', 'TICK', 'REVISION']) {
  eq(`${mode} passes through`, resolvePointRules(stored({ tick: { mode, perTick: 1, perRevision: 1 } })).tick.mode, mode);
}
for (const bad of ['activity', 'tick', 'Revision', 'DAY_FIRST', 'MANUAL', '', 'x', 0, 1, null, undefined, true, {}, [], ['TICK']]) {
  eq(`mode = ${JSON.stringify(bad)} reads as ACTIVITY`, resolvePointRules(stored({ tick: { mode: bad } })).tick.mode, 'ACTIVITY');
}
eq('absent', resolvePointRules(stored({ tick: {} })).tick.mode, 'ACTIVITY');
eq('and an unrecognised mode does not take its values down with it', resolvePointRules(stored({ tick: { mode: 'x', perTick: 2 } })).tick, {
  mode: 'ACTIVITY',
  perTick: 2,
  perRevision: 0,
  dailyCap: 0,
});

group('resolvePointRules - tick is not an object');
for (const bad of ['TICK', 5, true, null, [], ['TICK']]) {
  eq(`tick = ${JSON.stringify(bad)}`, resolvePointRules(stored({ tick: bad })).tick, {
    mode: 'ACTIVITY',
    perTick: 0,
    perRevision: 0,
    dailyCap: 0,
  });
}

group('resolvePointRules - perTick and perRevision take the point bounds');
eq('perTick', resolvePointRules(stored({ tick: { perTick: 1 } })).tick.perTick, 1);
eq('perRevision', resolvePointRules(stored({ tick: { perRevision: 25 } })).tick.perRevision, 25);
eq('perTick over the ceiling is 0', resolvePointRules(stored({ tick: { perTick: 10001 } })).tick.perTick, 0);
eq('perRevision below the floor is 0', resolvePointRules(stored({ tick: { perRevision: -1 } })).tick.perRevision, 0);
eq("perTick as the string '1'", resolvePointRules(stored({ tick: { perTick: '1' } })).tick.perTick, 0);
eq('perTick rounds', resolvePointRules(stored({ tick: { perTick: 1.5 } })).tick.perTick, 2);

group('resolvePointRules - dailyCap is an order larger, because a tick rule multiplies');
eq('a cap', resolvePointRules(stored({ tick: { dailyCap: 5000 } })).tick.dailyCap, 5000);
eq('0 means no cap', resolvePointRules(stored({ tick: { dailyCap: 0 } })).tick.dailyCap, 0);
eq('the ceiling is inclusive', resolvePointRules(stored({ tick: { dailyCap: TICK_DAILY_CAP_MAX } })).tick.dailyCap, 100000);
eq('one over is 0', resolvePointRules(stored({ tick: { dailyCap: 100001 } })).tick.dailyCap, 0);
eq('a value above the point ceiling is fine here', resolvePointRules(stored({ tick: { dailyCap: 20000 } })).tick.dailyCap, 20000);
eq('negative', resolvePointRules(stored({ tick: { dailyCap: -1 } })).tick.dailyCap, 0);

group('resolvePointRules - a whole configured rule set');
eq('everything at once', resolvePointRules(stored({
  version: 3,
  effectiveFrom: '2026-09-01',
  disabled: ['4.3', 'level2'],
  repeat: { enabled: true, default: 50, dailyLimit: 3, '4.1': 25, banana: 9 },
  tick: { mode: 'TICK', perTick: 1, perRevision: 0, dailyCap: 108 * 0 + 500 },
  earn: { level1: 'EVERY', level2: 'EVERY', level3: 'ONCE', tickCount: 'ALL' },
})), {
  version: 3,
  effectiveFrom: '2026-09-01',
  disabled: ['4.3', 'level2'],
  repeat: { enabled: true, default: 50, dailyLimit: 3, byCode: { '4.1': 25 } },
  tick: { mode: 'TICK', perTick: 1, perRevision: 0, dailyCap: 500 },
  // level4 was not named above and resolves to DAY_FIRST, which is the property that matters most
  // in this whole group: a partially configured `earn` leaves every level it does not mention
  // paying exactly what it paid before.
  earn: { level1: 'EVERY', level2: 'EVERY', level3: 'ONCE', level4: 'DAY_FIRST', tickCount: 'ALL' },
});

// ==================================================================== isPointRuleLive

/*
  ────────────────────────────────────────────────────────────────────────────
  The four branches of point_rule_live()
  ────────────────────────────────────────────────────────────────────────────

  0031:328-334, in order: the effective date, the activity code, the level token, and true.
  Both questions are about the *rule* and neither is about the યુવક — nothing here reads a
  profile, a status or a clock.
*/

group('isPointRuleLive - before the effective date');
{
  const r = live({ effectiveFrom: '2026-09-01' });
  eq('the day before', isPointRuleLive(r, 4, '4.1', '2026-08-31'), false);
  eq('a month before', isPointRuleLive(r, 4, '4.1', '2026-08-01'), false);
  eq('a year before', isPointRuleLive(r, 2, 'darshan', '2025-09-01'), false);
  eq('the day itself is on or after, so it is live', isPointRuleLive(r, 4, '4.1', '2026-09-01'), true);
  eq('the day after', isPointRuleLive(r, 4, '4.1', '2026-09-02'), true);
  eq('across a year boundary', isPointRuleLive(r, 4, '4.1', '2027-01-01'), true);
  eq('the comparison is lexicographic and that is the same as chronological', isPointRuleLive(r, 4, '4.1', '2026-10-31'), true);
  eq('no date at all means in force since forever', isPointRuleLive(live(), 4, '4.1', '1999-01-01'), true);
}
eq('an unusable day skips the date branch rather than killing every award', isPointRuleLive(live({ effectiveFrom: '2026-09-01' }), 4, '4.1', ''), true);
eq('an undefined day likewise', isPointRuleLive(live({ effectiveFrom: '2026-09-01' }), 4, '4.1', undefined), true);
eq('a non-string day likewise', isPointRuleLive(live({ effectiveFrom: '2026-09-01' }), 4, '4.1', 20260831), true);

group('isPointRuleLive - the activity code is switched off');
{
  const r = live({ disabled: ['4.3'] });
  eq('the named activity is dead', isPointRuleLive(r, 4, '4.3', '2026-08-14'), false);
  eq('its neighbour is not', isPointRuleLive(r, 4, '4.1', '2026-08-14'), true);
  eq('and neither is another level', isPointRuleLive(r, 2, 'darshan', '2026-08-14'), true);
}
{
  const r = live({ disabled: ['darshan'] });
  eq('a fixed activity key can be switched off too', isPointRuleLive(r, 2, 'darshan', '2026-08-14'), false);
  eq('and the others keep paying', isPointRuleLive(r, 3, 'revision', '2026-08-14'), true);
}
eq("an empty key asks about '', which is nothing unless he listed it", isPointRuleLive(live({ disabled: ['4.1'] }), 4, '', '2026-08-14'), true);
eq("a list containing '' switches the empty key off", isPointRuleLive(live({ disabled: [''] }), 0, '', '2026-08-14'), false);
eq('no key argument at all is the empty key', isPointRuleLive(live({ disabled: [''] }), 0), false);

group('isPointRuleLive - a whole ladder is switched off');
{
  const r = live({ disabled: ['level2'] });
  eq('every level 2 award stops', isPointRuleLive(r, 2, 'darshan', '2026-08-14'), false);
  eq('whatever the key', isPointRuleLive(r, 2, 'anything', '2026-08-14'), false);
  eq('level 3 is untouched', isPointRuleLive(r, 3, 'revision', '2026-08-14'), true);
  eq('level 4 is untouched', isPointRuleLive(r, 4, '4.1', '2026-08-14'), true);
}
eq('level4 switches off every activity at once', isPointRuleLive(live({ disabled: ['level4'] }), 4, '4.7', '2026-08-14'), false);
eq("a manual adjustment computes 'level0', which no valid list may contain", isPointRuleLive(live({ disabled: ['level1', 'level2', 'level3', 'level4'] }), 0, '', '2026-08-14'), true);
eq('a null level reads as level0 rather than throwing', isPointRuleLive(live({ disabled: ['level0'] }), null, '', '2026-08-14'), false);

group('isPointRuleLive - otherwise it is live');
eq('nothing configured', isPointRuleLive(live(), 4, '4.1', '2026-08-14'), true);
eq('the default rule set is live for everything', isPointRuleLive(DEFAULT_POINT_RULES, 3, 'revision', '2026-08-14'), true);
eq('no rules at all falls to the default, which is live', isPointRuleLive(null, 3, 'revision', '2026-08-14'), true);
eq('undefined', isPointRuleLive(undefined, 1, 'video', '2026-08-14'), true);
eq('a rule set with a broken disabled list is still live', isPointRuleLive({ ...YESTERDAY, disabled: 'level2' }, 2, 'darshan', '2026-08-14'), true);
eq('a date that has passed and nothing switched off', isPointRuleLive(live({ effectiveFrom: '2026-01-01' }), 4, '4.1', '2026-08-14'), true);
eq('both branches can refuse at once, and the date is asked first', isPointRuleLive(live({ effectiveFrom: '2026-09-01', disabled: ['4.1'] }), 4, '4.1', '2026-08-14'), false);
eq('straight off the resolver, not off a fixture', isPointRuleLive(resolvePointRules(stored({ disabled: ['level3'] })), 3, 'revision', '2026-08-14'), false);

// ==================================================================== repeatValueFor

group('repeatValueFor - a named code wins, then the default, then nothing');
{
  const r = live({ repeat: { enabled: true, default: 50, dailyLimit: 0, byCode: { '4.1': 25, '4.2': 0, '10.3': 100 } } });
  eq('a named code', repeatValueFor(r, '4.1'), 25);
  eq('another', repeatValueFor(r, '10.3'), 100);
  eq('an activity nobody has priced falls to the repeat default', repeatValueFor(r, '4.9'), 50);
  eq('and that is not 0', repeatValueFor(r, '4.9') === 0, false);
  eq('a code priced 0 on purpose stays 0', repeatValueFor(r, '4.2'), 0);
  eq('and does not fall through to the default', repeatValueFor(r, '4.2') === 50, false);
  eq('no code at all is the default', repeatValueFor(r), 50);
  eq('an empty code is the default', repeatValueFor(r, ''), 50);
  eq('a prototype key is not a price', repeatValueFor(r, 'toString'), 50);
  eq('nor is constructor', repeatValueFor(r, 'constructor'), 50);
  eq('nor is __proto__', repeatValueFor(r, '__proto__'), 50);
}
eq('a repeat rule with neither is worth nothing', repeatValueFor(live()), 0);
eq('no rules at all is worth nothing', repeatValueFor(null, '4.1'), 0);
eq('undefined', repeatValueFor(undefined, '4.1'), 0);
eq('a rule set with no repeat object at all', repeatValueFor({ version: 0 }, '4.1'), 0);
eq('a rule set whose default is not a number', repeatValueFor({ repeat: { byCode: {}, default: '50' } }, '4.1'), 0);
eq('a byCode value that is not a number falls through', repeatValueFor({ repeat: { default: 50, byCode: { '4.1': '25' } } }, '4.1'), 50);
eq('it does not ask whether repeats are enabled - that is a separate question', repeatValueFor(live({ repeat: { enabled: false, default: 50, dailyLimit: 0, byCode: {} } }), '4.1'), 50);
eq('straight off the resolver', repeatValueFor(resolvePointRules(stored({ repeat: { enabled: true, default: 50, '4.1': 25 } })), '4.1'), 25);
eq('and off the resolver for an unlisted code', repeatValueFor(resolvePointRules(stored({ repeat: { enabled: true, default: 50, '4.1': 25 } })), '4.9'), 50);
eq('a code the resolver dropped as out of range falls to the default, not to the bad figure', repeatValueFor(resolvePointRules(stored({ repeat: { default: 50, '4.1': 99999 } })), '4.1'), 50);

// ==================================================================== validatePointRules, absence

group('validatePointRules - there is nothing to save');
for (const bad of [null, undefined, 'points', 100, true, []]) {
  const r = validatePointRules(bad);
  eq(`${JSON.stringify(bad)} is refused`, r.ok, false);
  eq(`${JSON.stringify(bad)} says what is missing`, r.gu, 'The points setting is missing.');
}

group('validatePointRules - every 0031 key is optional');
eq('an empty object is a valid rule set', validatePointRules({}).ok, true);
eq('a settings row written before 0031 still saves', validatePointRules(base()).ok, true);
eq('and resolves to yesterday', validatePointRules(base()).rules, YESTERDAY);
eq('an explicitly undefined key is absence, not a bad value', validatePointRules({ version: undefined, repeat: undefined, tick: undefined, disabled: undefined, effectiveFrom: undefined }).ok, true);
eq('and it resolves to yesterday too', validatePointRules({ version: undefined }).rules, YESTERDAY);

// ==================================================================== validatePointRules, refusals

group('validatePointRules - version (0031:824-831)');
for (const bad of ['3', null, [], {}, true, NaN, Infinity]) {
  const r = validatePointRules({ version: bad });
  eq(`version = ${JSON.stringify(bad)} is refused`, r.ok, false);
  eq(`version = ${JSON.stringify(bad)} names the shape`, r.gu, 'Points version: a whole number of 0 or more.');
}
eq('a fraction', validatePointRules({ version: 3.5 }).gu, 'Points version: a whole number of 0 or more.');
eq('a negative', validatePointRules({ version: -1 }).gu, 'Points version: a whole number of 0 or more.');
eq('0 is accepted', validatePointRules({ version: 0 }).ok, true);
eq('3 is accepted', validatePointRules({ version: 3 }).ok, true);
eq('int4 max is accepted', validatePointRules({ version: RULE_VERSION_MAX }).ok, true);
/*
  And one more is refused.

  This assertion used to read the other way, and the reversal is the point of it. The first draft
  refused to invent a bound the server did not state — sound reasoning on a wrong premise, because
  `settings_check_points()`'s silence here was a defect rather than a decision: `point_rules()`
  resolves the field with `round(...)::integer`, so a stored trillion saved happily and then made
  every later read of the rules raise, on the award path for every level, for everybody.

  0031 now states the ceiling and both mirrors enforce it. The rule worth carrying to the next
  field: a bound the validator enforces must be inside the range of the type the resolver casts
  to, or the resolver's forgiveness is a raise.
*/
eq('one over int4 is refused', validatePointRules({ version: RULE_VERSION_MAX + 1 }).ok, false);
eq('and it names the ceiling', validatePointRules({ version: RULE_VERSION_MAX + 1 }).gu,
  `Points version: between 0 and ${RULE_VERSION_MAX}.`);
eq('the floor is 0', RULE_VERSION_MIN, 0);

// The property behind both bounds, stated once: every version the validator accepts must survive
// the resolver. This is the assertion that would have caught the original defect.
for (const v of [0, 1, 3, 1000, RULE_VERSION_MAX]) {
  eq(`version ${v} survives the resolver`, resolvePointRules({ version: v }).version, v);
}

group('validatePointRules - effectiveFrom (0031:833-839)');
for (const bad of ['14-08-2026', '2026-8-14', '2026/08/14', '2026-08-14T00:00:00Z', '', 'tomorrow', 20260814, {}, [], true]) {
  const r = validatePointRules({ effectiveFrom: bad });
  eq(`effectiveFrom = ${JSON.stringify(bad)} is refused`, r.ok, false);
  eq(`effectiveFrom = ${JSON.stringify(bad)} says the format`, r.gu, 'Points start date: write it as YYYY-MM-DD, or leave it empty.');
}
eq('a day is accepted', validatePointRules({ effectiveFrom: '2026-09-01' }).ok, true);
eq('null is accepted and means in force since forever', validatePointRules({ effectiveFrom: null }).ok, true);
eq('and null resolves to null', validatePointRules({ effectiveFrom: null }).rules.effectiveFrom, null);

/*
  The shape is not the value.

  Every string below matches `^\d{4}-\d{2}-\d{2}$` and none of them is a day. This mattered
  enough to fix in SQL: `point_rule_live()` casts this field with `::date` on every award, so a
  stored non-day raised 22008 for every submission at every level, for everybody - the same
  failure the version ceiling had, through a different cast. The calendar is not a regular
  language, so the check constructs the date and reads it back rather than growing the pattern.
*/
for (const bad of ['2026-13-01', '2026-00-10', '2026-01-32', '2026-01-00', '2026-02-30', '2025-02-29', '2026-04-31', '2026-11-31']) {
  const r = validatePointRules({ effectiveFrom: bad });
  eq(`effectiveFrom = ${bad} is shaped like a day and is refused`, r.ok, false);
  eq(`effectiveFrom = ${bad} says it is not real`, r.gu, `Points start date: "${bad}" is not a real date.`);
  eq(`effectiveFrom = ${bad} passes the shape test that used to be the whole check`, EFFECTIVE_DAY_RE.test(bad), true);
}

// The leap years either side of the one refused above, so the check is not simply "no 29th".
eq('2024-02-29 is a real day', validatePointRules({ effectiveFrom: '2024-02-29' }).ok, true);
eq('2000-02-29 is a real day (a century that is a leap year)', validatePointRules({ effectiveFrom: '2000-02-29' }).ok, true);
eq('1900-02-29 is not (a century that is not)', validatePointRules({ effectiveFrom: '1900-02-29' }).ok, false);
// Years below 100 are the reason isRealDay() does not use Date.UTC(): that constructor maps them
// into the 1900s, which would accept this as 1901-01-01 and store a year nothing else agrees on.
eq('0001-01-01 is a real day and is not silently 1901', validatePointRules({ effectiveFrom: '0001-01-01' }).ok, true);
eq('and it resolves to itself', resolvePointRules({ effectiveFrom: '0001-01-01' }).effectiveFrom, '0001-01-01');

group('validatePointRules - disabled (0031:841-855)');
for (const bad of ['4.3', 100, true, {}, null]) {
  const r = validatePointRules({ disabled: bad });
  eq(`disabled = ${JSON.stringify(bad)} is refused`, r.ok, false);
  eq(`disabled = ${JSON.stringify(bad)} shows a list`, r.gu, 'Switched-off rules: expected a list like ["4.3", "level2"].');
}
eq('an empty list is accepted', validatePointRules({ disabled: [] }).ok, true);
eq('codes and levels together are accepted', validatePointRules({ disabled: ['4.3', '10.1', 'level1', 'level4'] }).ok, true);
for (const bad of ['banana', 'darshan', 'level0', 'level5', 'level', '4', '4.', '.1', '', ' 4.1', 'Level2']) {
  const r = validatePointRules({ disabled: [bad] });
  eq(`${JSON.stringify(bad)} is refused`, r.ok, false);
  eq(`${JSON.stringify(bad)} is quoted back`, r.gu, `Switched-off rules: "${bad}" is not an activity code like 4.3 or a level like level2.`);
}
eq('a number in the list is refused and rendered as its text', validatePointRules({ disabled: [4] }).gu, 'Switched-off rules: "4" is not an activity code like 4.3 or a level like level2.');
eq('null in the list', validatePointRules({ disabled: [null] }).gu, 'Switched-off rules: "" is not an activity code like 4.3 or a level like level2.');
eq('an object in the list is rendered as its json', validatePointRules({ disabled: [{ a: 1 }] }).gu, 'Switched-off rules: "{"a":1}" is not an activity code like 4.3 or a level like level2.');
eq('one bad entry among good ones is still refused', validatePointRules({ disabled: ['4.1', 'level2', 'banana'] }).ok, false);

group('validatePointRules - repeat (0031:857-905)');
for (const bad of ['x', 50, true, null, []]) {
  const r = validatePointRules({ repeat: bad });
  eq(`repeat = ${JSON.stringify(bad)} is refused`, r.ok, false);
  eq(`repeat = ${JSON.stringify(bad)} names the shape`, r.gu, 'Repeat points: expected a value for each activity.');
}
eq('an empty repeat object is accepted', validatePointRules({ repeat: {} }).ok, true);
for (const bad of ['true', 'false', 1, 0, null, {}, []]) {
  const r = validatePointRules({ repeat: { enabled: bad } });
  eq(`enabled = ${JSON.stringify(bad)} is refused`, r.ok, false);
  eq(`enabled = ${JSON.stringify(bad)} names the act`, r.gu, 'Repeat points: turn repeat awards on or off before saving.');
}
eq('true is accepted', validatePointRules({ repeat: { enabled: true } }).ok, true);
eq('false is a real boolean and is accepted', validatePointRules({ repeat: { enabled: false } }).ok, true);
for (const bad of ['banana', '4', '4.', '.1', '4.1.2', 'Default', 'dailylimit', 'byCode']) {
  const r = validatePointRules({ repeat: { [bad]: 50 } });
  eq(`repeat key ${JSON.stringify(bad)} is refused`, r.ok, false);
  eq(`repeat key ${JSON.stringify(bad)} is quoted back`, r.gu, `Repeat points: "${bad}" is not an activity code like 4.1.`);
}
eq('a resolved rule set is not a stored one - byCode is refused as a key', validatePointRules({ repeat: { byCode: {} } }).ok, false);
eq('default is not refused as a key', validatePointRules({ repeat: { default: 50 } }).ok, true);
eq('dailyLimit is not refused as a key', validatePointRules({ repeat: { dailyLimit: 3 } }).ok, true);
eq('a code is not refused as a key', validatePointRules({ repeat: { '4.1': 50 } }).ok, true);

group('validatePointRules - repeat values, label by label');
for (const [key, label] of [['default', 'Repeat default'], ['dailyLimit', 'Repeat daily limit'], ['4.1', 'Repeat 4.1']]) {
  eq(`${key} - a string`, validatePointRules({ repeat: { [key]: '5' } }).gu, `${label}: enter a number.`);
  eq(`${key} - null`, validatePointRules({ repeat: { [key]: null } }).gu, `${label}: enter a number.`);
  eq(`${key} - an array`, validatePointRules({ repeat: { [key]: [] } }).gu, `${label}: enter a number.`);
  eq(`${key} - NaN`, validatePointRules({ repeat: { [key]: NaN } }).gu, `${label}: enter a number.`);
  eq(`${key} - Infinity`, validatePointRules({ repeat: { [key]: Infinity } }).gu, `${label}: enter a number.`);
  eq(`${key} - a fraction`, validatePointRules({ repeat: { [key]: 1.5 } }).gu, `${label}: enter a whole number.`);
  eq(`${key} - the floor itself is accepted`, validatePointRules({ repeat: { [key]: 0 } }).ok, true);
}
eq('default below the floor', validatePointRules({ repeat: { default: -1 } }).gu, `Repeat default: between ${POINT_MIN} and ${POINT_MAX} (got -1).`);
eq('default above the ceiling', validatePointRules({ repeat: { default: 10001 } }).gu, 'Repeat default: between 0 and 10000 (got 10001).');
eq('the ceiling itself is accepted', validatePointRules({ repeat: { default: POINT_MAX } }).ok, true);
eq('a code above the ceiling', validatePointRules({ repeat: { '4.1': 20000 } }).gu, 'Repeat 4.1: between 0 and 10000 (got 20000).');
eq('the daily limit has its own bound, and says what 0 means', validatePointRules({ repeat: { dailyLimit: 1001 } }).gu, 'Repeat daily limit: between 0 and 1000 (got 1001). 0 means no limit.');
eq('a limit inside the point bounds but outside its own is refused', validatePointRules({ repeat: { dailyLimit: 5000 } }).ok, false);
eq('its ceiling itself is accepted', validatePointRules({ repeat: { dailyLimit: REPEAT_DAILY_LIMIT_MAX } }).ok, true);
eq('a negative limit', validatePointRules({ repeat: { dailyLimit: -1 } }).gu, 'Repeat daily limit: between 0 and 1000 (got -1). 0 means no limit.');
eq('enabled is not held to a numeric bound', validatePointRules({ repeat: { enabled: true, default: 50, dailyLimit: 3, '4.1': 25 } }).ok, true);

group('validatePointRules - tick (0031:907-968)');
for (const bad of ['TICK', 5, true, null, []]) {
  const r = validatePointRules({ tick: bad });
  eq(`tick = ${JSON.stringify(bad)} is refused`, r.ok, false);
  eq(`tick = ${JSON.stringify(bad)} names the shape`, r.gu, 'Level 3 rule: expected a mode and its values.');
}
eq('an empty tick object is accepted', validatePointRules({ tick: {} }).ok, true);
eq('ACTIVITY is accepted with no values at all', validatePointRules({ tick: { mode: 'ACTIVITY' } }).ok, true);
for (const bad of ['activity', 'tick', 'Revision', 'DAY_FIRST', '', 'x', 0, true, {}, []]) {
  const r = validatePointRules({ tick: { mode: bad } });
  eq(`mode = ${JSON.stringify(bad)} is refused`, r.ok, false);
  eq(`mode = ${JSON.stringify(bad)} lists the three`, r.gu, `Level 3 rule: choose ACTIVITY, TICK or REVISION (got "${typeof bad === 'string' ? bad : JSON.stringify(bad)}").`);
}
eq('a null mode is an absent mode, which 0031 accepts too', validatePointRules({ tick: { mode: null } }).ok, true);
eq('and resolves to ACTIVITY', validatePointRules({ tick: { mode: null } }).rules.tick.mode, 'ACTIVITY');
for (const bad of ['perTicks', 'PerTick', 'dailycap', 'byCode', 'banana', 'level3']) {
  const r = validatePointRules({ tick: { [bad]: 1 } });
  eq(`tick key ${JSON.stringify(bad)} is refused`, r.ok, false);
  eq(`tick key ${JSON.stringify(bad)} lists the three fields`, r.gu, `Level 3 rule: "${bad}" is not one of perTick, perRevision, dailyCap.`);
}

group('validatePointRules - tick values, label by label');
for (const [key, label] of [['perTick', 'Points per tick'], ['perRevision', 'Points per revision'], ['dailyCap', 'Level 3 daily cap']]) {
  eq(`${key} - a string`, validatePointRules({ tick: { [key]: '5' } }).gu, `${label}: enter a number.`);
  eq(`${key} - null`, validatePointRules({ tick: { [key]: null } }).gu, `${label}: enter a number.`);
  eq(`${key} - NaN`, validatePointRules({ tick: { [key]: NaN } }).gu, `${label}: enter a number.`);
  eq(`${key} - a fraction`, validatePointRules({ tick: { [key]: 1.5 } }).gu, `${label}: enter a whole number.`);
  eq(`${key} - a negative`, validatePointRules({ tick: { [key]: -1 } }).ok, false);
  eq(`${key} - the floor itself is accepted`, validatePointRules({ tick: { [key]: 0 } }).ok, true);
}
eq('perTick above the ceiling', validatePointRules({ tick: { perTick: 10001 } }).gu, 'Points per tick: between 0 and 10000 (got 10001).');
eq('perRevision above the ceiling', validatePointRules({ tick: { perRevision: 10001 } }).gu, 'Points per revision: between 0 and 10000 (got 10001).');
eq('the cap has its own bound, and says what 0 means', validatePointRules({ tick: { dailyCap: 100001 } }).gu, `Level 3 daily cap: between ${TICK_DAILY_CAP_MIN} and ${TICK_DAILY_CAP_MAX} (got 100001). 0 means no cap.`);
eq('a cap above the point ceiling is accepted, because a tick rule multiplies', validatePointRules({ tick: { dailyCap: 20000 } }).ok, true);
eq('its ceiling itself is accepted', validatePointRules({ tick: { dailyCap: TICK_DAILY_CAP_MAX } }).ok, true);

/*
  A mode that pays nothing is a mode that switches લેવલ ૩ off while looking configured (0031:955).
  The સંચાલક is told at the field rather than discovering it in a week of unpaid પુનરાવર્તન.
*/
group('validatePointRules - a mode that would pay nothing is refused');
eq('TICK with no perTick', validatePointRules({ tick: { mode: 'TICK' } }).gu, 'Level 3 rule: per-tick mode needs points per tick above 0.');
eq('TICK with perTick 0', validatePointRules({ tick: { mode: 'TICK', perTick: 0 } }).gu, 'Level 3 rule: per-tick mode needs points per tick above 0.');
eq('TICK with a perTick of 1 is accepted', validatePointRules({ tick: { mode: 'TICK', perTick: 1 } }).ok, true);
eq('REVISION with no perRevision', validatePointRules({ tick: { mode: 'REVISION' } }).gu, 'Level 3 rule: per-revision mode needs points per revision above 0.');
eq('REVISION with perRevision 0', validatePointRules({ tick: { mode: 'REVISION', perRevision: 0 } }).gu, 'Level 3 rule: per-revision mode needs points per revision above 0.');
eq('REVISION with a perRevision of 25 is accepted', validatePointRules({ tick: { mode: 'REVISION', perRevision: 25 } }).ok, true);
eq('REVISION mode does not need a perTick', validatePointRules({ tick: { mode: 'REVISION', perRevision: 25, perTick: 0 } }).ok, true);
eq('TICK mode does not need a perRevision', validatePointRules({ tick: { mode: 'TICK', perTick: 1, perRevision: 0 } }).ok, true);
eq('ACTIVITY mode needs neither', validatePointRules({ tick: { mode: 'ACTIVITY', perTick: 0, perRevision: 0 } }).ok, true);
eq('the value check comes before the mode check, so text is named as text', validatePointRules({ tick: { mode: 'TICK', perTick: 'x' } }).gu, 'Points per tick: enter a number.');

// ==================================================================== the equivalence

/*
  ────────────────────────────────────────────────────────────────────────────
  The equivalence
  ────────────────────────────────────────────────────────────────────────────

  Anything validatePointRules() accepts, resolvePointRules() must carry through unchanged. This
  is the property that keeps the panel's field and the yuvak's award the same figure: the panel
  validates before it writes, the server resolves before it pays, and if the two ever describe
  one stored row differently the disagreement is invisible from both ends.

  It is stated as "carries through" rather than "returns it unchanged" because every key here is
  optional: a valid `{}` resolves to a full rule set, so the equality that can be asserted is
  that each key the સંચાલક *did* write survives, and that resolving the resolver's own output is
  a fixed point.
*/

group('validatePointRules accepts only what resolvePointRules carries through');
{
  const GOOD = [
    {},
    base(),
    { version: 0 },
    { version: 7 },
    { effectiveFrom: null },
    { effectiveFrom: '2026-09-01' },
    { disabled: [] },
    { disabled: ['4.3', 'level2'] },
    { repeat: {} },
    { repeat: { enabled: false } },
    { repeat: { enabled: true, default: 50 } },
    { repeat: { enabled: true, default: 0, dailyLimit: 3, '4.1': 25, '10.3': 0 } },
    { repeat: { dailyLimit: REPEAT_DAILY_LIMIT_MAX, default: POINT_MAX } },
    { tick: {} },
    { tick: { mode: 'ACTIVITY' } },
    { tick: { mode: 'TICK', perTick: 1, dailyCap: 500 } },
    { tick: { mode: 'REVISION', perRevision: 25 } },
    { tick: { mode: 'TICK', perTick: POINT_MAX, dailyCap: TICK_DAILY_CAP_MAX } },
    {
      ...base(),
      version: 3,
      effectiveFrom: '2026-09-01',
      disabled: ['4.3', 'level2'],
      repeat: { enabled: true, default: 50, dailyLimit: 3, '4.1': 25 },
      tick: { mode: 'TICK', perTick: 1, perRevision: 0, dailyCap: 500 },
    },
  ];
  for (const g of GOOD) {
    const label = JSON.stringify(g);
    const r = validatePointRules(g);
    eq(`accepted: ${label}`, r.ok, true);
    eq(`the resolver agrees with the validator: ${label}`, resolvePointRules(g), r.rules);
    eq(`every key written survives into the resolved rules: ${label}`, (() => {
      const flat = { ...g.repeat };
      delete flat.enabled;
      return [
        g.version === undefined || r.rules.version === g.version,
        g.effectiveFrom === undefined || r.rules.effectiveFrom === (g.effectiveFrom ?? null),
        g.disabled === undefined || JSON.stringify(r.rules.disabled) === JSON.stringify(g.disabled),
        g.repeat === undefined || r.rules.repeat.enabled === (g.repeat.enabled === true),
        Object.entries(flat).every(([k, v]) => (ACTIVITY_CODE_RE.test(k) ? r.rules.repeat.byCode[k] : r.rules.repeat[k]) === v),
        g.tick === undefined || Object.entries(g.tick).every(([k, v]) => r.rules.tick[k] === v),
      ].every(Boolean);
    })(), true);
    eq(`the input is not mutated: ${label}`, JSON.stringify(g), label);
  }
  // DEFAULT_POINT_RULES is the resolver's output and not a stored row, so it belongs to the
  // group above rather than to this one - see "only a stored row is ever resolved".
  eq('the default rule set is what an absent one resolves to', resolvePointRules({}), DEFAULT_POINT_RULES);

  // The resolved shape is not the stored shape, and re-validating it must say so rather than
  // pretend: `byCode` is a key point_rules() builds, and no સંચાલક may write it.
  eq('a resolved rule set is not re-validatable as a stored one', validatePointRules(resolvePointRules({})).ok, false);
  eq('and it says which key it could not accept', validatePointRules(resolvePointRules({})).gu, 'Repeat points: "byCode" is not an activity code like 4.1.');
}

group('validatePoints and validatePointRules are two halves of one trigger');
{
  const whole = {
    ...base(),
    version: 3,
    repeat: { enabled: true, default: 50 },
    tick: { mode: 'REVISION', perRevision: 25 },
  };
  eq('the 0021 half accepts it', validatePoints(whole).ok, true);
  eq('the 0031 half accepts it', validatePointRules(whole).ok, true);
  eq('the 0021 half drops the 0031 keys rather than saving them twice', Object.keys(validatePoints(whole).points), ['enabled', 'level1', 'level2', 'level3', 'level4']);
  eq('the 0031 half says nothing about the price of a level', validatePointRules({ ...base(), level1: 'x' }).ok, true);
  eq('and the 0021 half is the one that refuses that', validatePoints({ ...base(), level1: 'x' }).ok, false);
  eq('a row with a bad 0031 key is refused by the half that owns it', [
    validatePoints({ ...base(), tick: { mode: 'x' } }).ok,
    validatePointRules({ ...base(), tick: { mode: 'x' } }).ok,
  ], [true, false]);
}

// ==================================================================== drift against 0031

/*
  ────────────────────────────────────────────────────────────────────────────
  The module against the SQL that mirrors it
  ────────────────────────────────────────────────────────────────────────────

  A domain module must not import a migration, so the agreement is checked here by reading the
  SQL as text, exactly as scripts/test-points.mjs:941 checks this module against 0021. String
  containment only: this suite never executes SQL and has no database to execute it against.
  supabase/migrations run under Docker instead - see the header of scripts/lib/pgtest.mjs.
*/

const SQL_0031 = new URL('../supabase/migrations/0031_point_engine.sql', import.meta.url);

group('0031 agrees with shared/domain/points.js');
if (!existsSync(fileURLToPath(SQL_0031))) {
  skip('points vs 0031_point_engine.sql', 'the migration does not exist yet - re-run once it lands');
} else {
  const sql = readFileSync(SQL_0031, 'utf8');
  const has = (s) => sql.includes(s);

  eq('the migration was read at all', sql.length > 0, true);

  // ---- the functions this module mirrors ------------------------------------
  const missing = [
    'point_rules',
    'point_rule_live',
    'point_award',
    'award_points',
    'admin_award_manual_points',
    'settings_check_points',
  ].filter((n) => !has(n));
  eq('every function this module mirrors is defined', missing, []);

  // ---- the resolved shape, key by key --------------------------------------
  const missingKeys = ['version', 'effectiveFrom', 'disabled', 'repeat', 'tick', 'byCode', 'dailyLimit', 'perTick', 'perRevision', 'dailyCap', 'enabled', 'default'].filter((k) => !has(`'${k}'`));
  eq('every key of the resolved shape is named in the SQL', missingKeys, []);

  // ---- the regexes, which are the identity of a code, a day and a level -----
  eq('the activity code regex is the same', has(ACTIVITY_CODE_RE.source), true);
  eq('the effective-day regex is the same', has(EFFECTIVE_DAY_RE.source), true);
  eq('the disabled-level regex is the same', has(DISABLED_LEVEL_RE.source), true);

  // ---- the bounds, field by field ------------------------------------------
  eq('the point bounds', has(`between 0 and ${POINT_MAX}`), true);
  eq('the repeat daily limit bound', has(`between 0 and ${REPEAT_DAILY_LIMIT_MAX}`), true);
  eq('the tick daily cap bound', has(`between 0 and ${TICK_DAILY_CAP_MAX}`), true);
  eq('0 means no limit, said in the SQL too', has('0 means no limit'), true);
  eq('0 means no cap, said in the SQL too', has('0 means no cap'), true);

  // ---- the three modes, and the kinds they are written as -------------------
  eq('all three modes are named', Object.values(TICK_MODE).every((m) => has(`'${m}'`)), true);
  eq("the tick branch only fires for TICK and REVISION", has("in ('TICK', 'REVISION')"), true);
  const missingKinds = ['DAY_FIRST', 'REPEAT', 'TICK', 'REVISION', 'MANUAL'].filter((k) => !has(`'${k}'`));
  eq('every award kind is named', missingKinds, []);

  // ---- the messages, word for word -----------------------------------------
  const MESSAGES = [
    'Points version: a whole number of 0 or more.',
    'Points start date: write it as YYYY-MM-DD, or leave it empty.',
    'Switched-off rules: expected a list like ["4.3", "level2"].',
    'is not an activity code like 4.3 or a level like level2.',
    'Repeat points: expected a value for each activity.',
    'Repeat points: turn repeat awards on or off before saving.',
    'is not an activity code like 4.1.',
    'Repeat default',
    'Repeat daily limit',
    'Level 3 rule: expected a mode and its values.',
    'Level 3 rule: choose ACTIVITY, TICK or REVISION',
    'is not one of perTick, perRevision, dailyCap.',
    'Points per tick',
    'Points per revision',
    'Level 3 daily cap',
    'Level 3 rule: per-tick mode needs points per tick above 0.',
    'Level 3 rule: per-revision mode needs points per revision above 0.',
    'enter a number.',
    'enter a whole number.',
  ].filter((m) => !has(m));
  eq('every message this module can show appears in the SQL', MESSAGES, []);

  // ---- the version cast this module has to bound for the SQL ----------------
  eq('point_rules() casts the version to integer, which is the ceiling RULE_VERSION_MAX names', /greatest\(0, round\(\(p ->> 'version'\)::numeric\)\)::integer/.test(sql), true);
  eq('settings_check_points() still names the shape', /Points version: a whole number of 0 or more/.test(sql), true);
  // And now states the ceiling too, which is what this module mirrors. Asserted against the SQL
  // rather than against RULE_VERSION_MAX alone, so that removing the bound from 0031 without
  // removing it here — the divergence that would put a refusal in the panel for a row the server
  // accepts — fails this suite rather than reaching a સંચાલક.
  eq('and states the int4 ceiling', /Points version: between 0 and 2147483647/.test(sql), true);
  eq('which is the number RULE_VERSION_MAX names', RULE_VERSION_MAX, 2_147_483_647);

  // ---- the business day is the attempt own, and the timezone is IST ---------
  eq('the day is decided in Asia/Kolkata', has("timezone('Asia/Kolkata'"), true);
  eq('the resolvers run above RLS, so they can be read on the submit path', has('security definer'), true);
}

// ==================================================================== 0035 — the pace rule

/*
  "૫૦ ટિક માટે ૫૦ સેકંડ", and the four things that would break it silently.

  The authority is supabase/migrations/0035_level3_revisions.sql — `point_pace()` and
  `settings_check_pace()` — exactly as the groups above defer to 0031. What is protected here:

    1. **An absent block resolving to anything but "no rule".** Every settings row in the wild
       is missing `pace`, so a resolver that read a missing `secondsPerTick` as anything above
       zero would start capping every પુનરાવર્તન in the project on the day 0035 deployed, and
       the only symptom would be યુવકો quietly being paid less than they earned.

    2. **`maxGapSeconds` falling back to 0.** It is the one bound in this module whose floor is
       not zero, and the reason is that 0 here does not mean "no limit" as it does everywhere
       else — it means no gap ever counts, so no attention ever accumulates and every
       પુનરાવર્તન is paid nothing. The default has to be a working number.

    3. **The cap becoming a gate.** ૫૦ ticks in ૪૫ seconds must be ૪૫ and never ૦. A gate would
       punish a યુવક who was half a minute quick exactly as hard as one who flicked to the
       bottom of the list, which §1 rule 4 refuses.

    4. **Integer division drifting from the SQL's.** `award_points()` computes
       `((engaged_ms / 1000) + grace) / secondsPerTick` in Postgres integer arithmetic. A JS
       mirror that divided in floating point would promise a number the ledger then did not pay,
       which is worse than promising nothing.
*/

group('0035 - constants and the absent block');
{
  eq('secondsPerTick spans 0 to an hour', [PACE_SECONDS_MIN, PACE_SECONDS_MAX], [0, 3600]);
  eq('graceSeconds spans 0 to a day', [PACE_GRACE_MIN, PACE_GRACE_MAX], [0, 86400]);
  eq('maxGapSeconds floors at 5, not 0', [PACE_MAX_GAP_MIN, PACE_MAX_GAP_MAX], [5, 3600]);

  eq('DEFAULT_PACE is no rule at all', DEFAULT_PACE.secondsPerTick, 0);
  eq('with a working gap ceiling under it', DEFAULT_PACE.maxGapSeconds, 180);
  eq('and no grace', DEFAULT_PACE.graceSeconds, 0);

  eq('an untouched settings row resolves to it', resolvePointPace({}), { ...DEFAULT_PACE });
  eq('so does one with no points at all', resolvePointPace(undefined), { ...DEFAULT_PACE });
  eq('so does a pace that is not an object', resolvePointPace({ pace: 5 }), { ...DEFAULT_PACE });
  eq('so does a pace that is null', resolvePointPace({ pace: null }), { ...DEFAULT_PACE });
}

group('0035 - resolvePointPace forgives every way a stored value can be wrong');
{
  const r = (pace) => resolvePointPace({ pace });

  eq('a whole number is kept', r({ secondsPerTick: 2 }).secondsPerTick, 2);
  eq('a fraction is rounded, as round(...)::integer does', r({ secondsPerTick: 1.6 }).secondsPerTick, 2);
  eq('a string is not a number', r({ secondsPerTick: '3' }).secondsPerTick, 0);
  eq('null is not a number either, and must not coerce to 0 by accident',
    r({ secondsPerTick: null }).secondsPerTick, 0);
  eq('NaN falls back', r({ secondsPerTick: NaN }).secondsPerTick, 0);
  eq('above the ceiling falls back rather than clamping, as the SQL does',
    r({ secondsPerTick: 99999 }).secondsPerTick, 0);
  eq('below the floor falls back', r({ secondsPerTick: -1 }).secondsPerTick, 0);

  eq('an out-of-range maxGapSeconds falls back to the working default, never to 0',
    r({ maxGapSeconds: 1 }).maxGapSeconds, 180);
  eq('and a valid one is kept', r({ maxGapSeconds: 30 }).maxGapSeconds, 30);
  eq('one field being wrong does not take the others with it',
    r({ secondsPerTick: 2, maxGapSeconds: 'x' }), { secondsPerTick: 2, graceSeconds: 0, maxGapSeconds: 180 });
}

group('0035 - validatePointPace refuses what the resolver would forgive');
{
  const v = (pace) => validatePointPace({ pace });

  eq('an absent block is fine', validatePointPace({}).ok, true);
  eq('a whole number is accepted', v({ secondsPerTick: 1 }).ok, true);
  eq('a fraction is refused', v({ secondsPerTick: 1.5 }).ok, false);
  eq('a negative is refused', v({ secondsPerTick: -1 }).ok, false);
  eq('a string is refused', v({ secondsPerTick: 'fast' }).ok, false);
  eq('an unknown key is refused, exactly as settings_check_pace does',
    v({ secondsPerTick: 1, wobble: 2 }).ok, false);
  eq('a non-object block is refused', validatePointPace({ pace: 7 }).ok, false);
  eq('maxGapSeconds under its floor is refused', v({ maxGapSeconds: 1 }).ok, false);
  eq('above every ceiling is refused', v({ graceSeconds: 999999 }).ok, false);

  eq('a refusal carries a sentence', typeof v({ secondsPerTick: -1 }).gu, 'string');
  eq('and it names the field', v({ secondsPerTick: -1 }).gu.includes('Seconds per tick'), true);
}

group('0035 - eligibleTicks is a cap and never a gate');
{
  const pace = (secondsPerTick, graceSeconds = 0) =>
    resolvePointPace({ pace: { secondsPerTick, graceSeconds } });

  const one = pace(1);
  eq('the requirement\'s own example: 50 ticks in 50 seconds is 50', eligibleTicks(50, 50_000, one), 50);
  eq('50 ticks in 45 seconds is 45, not 0 - this is the whole argument for a cap',
    eligibleTicks(50, 45_000, one), 45);
  eq('108 ticks flicked past in 12 seconds is 12', eligibleTicks(108, 12_000, one), 12);
  eq('108 ticks over three minutes is all 108', eligibleTicks(108, 180_000, one), 108);
  eq('time beyond what was ticked buys nothing extra', eligibleTicks(10, 999_000, one), 10);

  eq('with no rule configured nothing is capped', eligibleTicks(108, 0, DEFAULT_PACE), 108);
  eq('and that is true however little time passed', eligibleTicks(108, 1, DEFAULT_PACE), 108);

  eq('grace is added to the earned seconds', eligibleTicks(50, 40_000, pace(1, 10)), 50);

  // Integer division throughout, matching the SQL. A part-second buys nothing.
  eq('a part-second buys nothing', eligibleTicks(50, 45_999, one), 45);
  eq('two seconds per tick halves it', eligibleTicks(50, 50_000, pace(2)), 25);
  eq('and rounds down', eligibleTicks(50, 51_000, pace(2)), 25);

  eq('nothing ticked is nothing owed', eligibleTicks(0, 50_000, one), 0);
  eq('negative time is no time', eligibleTicks(50, -5, one), 0);
}

group('0035 - requiredSeconds is what a screen may promise');
{
  eq('no rule means no requirement, and the caller prints nothing',
    requiredSeconds(108, DEFAULT_PACE), 0);
  eq('one second a tick', requiredSeconds(108, resolvePointPace({ pace: { secondsPerTick: 1 } })), 108);
  eq('grace comes off the requirement',
    requiredSeconds(50, resolvePointPace({ pace: { secondsPerTick: 1, graceSeconds: 10 } })), 40);
  eq('nothing ticked needs no time', requiredSeconds(0, resolvePointPace({ pace: { secondsPerTick: 1 } })), 0);
}

group('0035 - the SQL is the authority, and says the same thing');
{
  const path = fileURLToPath(new URL('../supabase/migrations/0035_level3_revisions.sql', import.meta.url));
  eq('0035 is present', existsSync(path), true);
  const sql = readFileSync(path, 'utf8');

  eq('point_pace() exists', sql.includes('create or replace function public.point_pace()'), true);
  eq('and knows the same three keys',
    ['secondsPerTick', 'graceSeconds', 'maxGapSeconds'].every((k) => sql.includes(`'${k}'`)), true);
  eq('its secondsPerTick ceiling is this module\'s', sql.includes('between 0 and 3600'), true);
  eq('its graceSeconds ceiling is this module\'s', sql.includes('between 0 and 86400'), true);
  eq('its maxGapSeconds floor is 5 and not 0', sql.includes('between 5 and 3600'), true);
  eq('and its default gap is 180', /'maxGapSeconds'[\s\S]{0,400}?\), 180\)/.test(sql), true);

  eq('settings_check_pace() is a trigger of its own, not a widening of settings_check_points()',
    sql.includes('create trigger settings_check_pace'), true);
  eq('and settings_check_points() is NOT reissued here',
    sql.includes('create or replace function public.settings_check_points'), false);

  // The clamp itself. If this expression moves, the two mirrors have parted.
  eq('award_points() caps fresh ticks by the measured seconds',
    sql.includes("allowed := ((engaged / 1000) + (pace ->> 'graceSeconds')::integer) / per_tick_s;"), true);
  eq('and takes the smaller of that and what was ticked',
    sql.includes('fresh   := greatest(least(fresh, allowed), 0);'), true);

  /*
    The clock is the server's, and this is the assertion that keeps it that way (§17).

    Comments are stripped first, and that is not fussiness: 0035's own header says in as many
    words that there is no `p_engaged_ms` parameter and must not be one, so a search over the raw
    text finds the sentence promising the absence and reads it as the presence. What is being
    checked is the code — that no function in the file declares a parameter a browser could put
    a duration in.
  */
  const sqlCode = sql.replace(/^\s*--.*$/gm, '');
  eq('no client may send a duration - no function in 0035 declares a parameter for one',
    // `\b` at BOTH ends. Without the leading one, `p_ms` matches the local `gap_ms`, and the
    // check fails on the very variable that makes the clock server-side.
    /\b(p_engaged|p_seconds|p_duration|p_elapsed|p_ms)\b/.test(sqlCode), false);
  eq('and the header does say so, which is why the comments had to be stripped',
    sql.includes('p_engaged_ms'), true);
}

// ==================================================================== no em dash in a string

/*
  Comments in this project may use an em dash and do. A user-visible string may not: it renders
  as a broken overlapping glyph in the panel's font, and every message in validatePointRules()
  is a string `saveError()` puts in front of the સંચાલક. Checked by reading the module's own
  source with the comments stripped out, which is the only place the distinction is visible.
*/

group('no em dash reaches a user-visible string');
{
  const source = readFileSync(fileURLToPath(new URL('../shared/domain/points.js', import.meta.url)), 'utf8');
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n');
  eq('the module was read', source.length > 0, true);
  eq('its comments do use em dashes, so the check is meaningful', source.includes('—'), true);
  eq('and none of them survives into code', code.includes('—'), false);
  eq('no literal total leaked in either (§62)', /\b(108|109|110)\b/.test(code), false);
}

// ==================================================================== result

console.log(`\n  ${pass} passed, ${fails.length} failed\n`);
if (fails.length) {
  console.log(fails.map((f) => `  ✗ ${f}`).join('\n\n') + '\n');
  process.exit(1);
}
