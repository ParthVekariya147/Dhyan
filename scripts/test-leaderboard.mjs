/**
 * Tests for ક્રમાંક — `node scripts/test-leaderboard.mjs`.
 *
 * Same shape as scripts/test-domain.mjs and scripts/test-points.mjs, and for the same reason
 * test-domain.mjs gives: everything in shared/domain/leaderboard.js is a pure function over
 * plain data — no database, no network, no React, no clock — so it can be tested exactly and
 * cheaply, and adding a framework to run assertions on one module is not worth a dependency.
 * Exit code is the result: 0 green, 1 red.
 *
 * This module is not like the others on this page. Every other resolver in the project decides
 * what a યુવક sees of **his own** સાધના; this one decides whether he may see **another
 * યુવક's name**. §13's rule is that there is no path which reads another યુવક's row without
 * being a સંચાલક, and this feature is the single, deliberate, narrow crossing of it. A wrong
 * `false` here is a missing page. A wrong `true` is a disclosure, and nobody is told.
 *
 * What it protects, specifically. Every one of these fails **silently** in production — no
 * throw, no red screen, no log line; the board simply opens when it should not have, or shows
 * something it was never meant to carry:
 *
 *   1. **A half-finished row opening the board.** `enabled: true` with no window chosen is
 *      what a save interrupted halfway, or a row edited by hand, actually looks like. It must
 *      resolve to **off**. A resolver that read `enabled` alone would put every yuvak's name in
 *      front of every other yuvak because a field was missing. This is the single most
 *      important assertion in this file.
 *
 *   2. **`enabled` being anything other than JSON `true`.** The stored value is jsonb, so the
 *      string 'false' is truthy in JavaScript. A truthiness test switches this on for two
 *      thousand people because somebody's tooling serialised a checkbox as text, and nobody
 *      pressed anything.
 *
 *   3. **A malformed `periods` widening to ALL.** The tempting fallback for a field that
 *      cannot be understood is "show everything". Here that means a field which failed to
 *      describe a window silently choosing the widest one. It must fall to empty, and empty
 *      resolves to off.
 *
 *   4. **A `defaultPeriod` pointing at a tab that is not on screen.** The board opens on
 *      nothing: no rows, no error, and no way for a યુવક to tell that a tab exists.
 *
 *   5. **`typeof` versus `Number()`, on `topN`.** `Number('50')` is 50 and `Number(null)` is 0.
 *      The SQL mirror tests `jsonb_typeof = 'number'`, so a coercing resolver would show a
 *      board of 50 in the panel while the function built one of 20, and neither screen could
 *      say which was lying.
 *
 *   6. **The resolver and the validator disagreeing.** Anything `validateLeaderboard()`
 *      accepts, `resolveLeaderboard()` must return unchanged — otherwise the સંચાલક saves one
 *      board and yuvako read a different one, and the Save that caused it said "Saved".
 *
 *   7. **The deliberate asymmetry being ironed out.** Enabled-with-no-periods *resolves* to off
 *      and is *refused* by the validator, on purpose. A future tidy-up that made the validator
 *      as forgiving as the resolver would tell a સંચાલક "Saved" and leave him looking at a dark
 *      board with nothing on any screen to say he had not finished.
 *
 *   8. **A row reaching a screen carrying more than a name and a number.** `normaliseLeaderboard()`
 *      strips every row down to rank/name/points/isMe. That is not defensive habit: it is the
 *      client half of the §13 rule. If a future migration ever widened the function's SELECT,
 *      this is the assertion that fails, and the extra column has to be added here deliberately
 *      before it can reach a phone.
 *
 *   9. **The aperture widening in SQL.** The leaderboard function is the only path in the
 *      project that reads another યુવક's row. The migration must not mention `sub_zone_id`,
 *      `smk`, `mobile` or `p.email` anywhere at all — a single extra column in one SELECT is
 *      the whole rule, undone, with every screen still looking correct.
 *
 *  10. **The window being computed on the phone.** The bounds are `timezone('Asia/Kolkata')`
 *      and `date_trunc` over it, in SQL. A browser in another time zone, or with a wrong clock,
 *      must not be able to ask for a different week than everybody else is ranked in.
 *
 *  11. **Drift between this module and the migration that mirrors it.** The bounds, the four
 *      period names and the settings shape are stated twice — here and in SQL — and they are
 *      checked against each other by string containment, because a module must not import a
 *      migration.
 *
 *  12. **A literal total leaking into the module.** §62: no count of દ્રશ્યો lives outside
 *      useScenes().
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_LEADERBOARD,
  LEADERBOARD_KEY,
  LEADERBOARD_PERIOD,
  LEADERBOARD_PERIODS,
  LEADERBOARD_TOP_MAX,
  LEADERBOARD_TOP_MIN,
  PERIOD_LABEL,
  PERIOD_LABEL_EN,
  SUGGESTED_LEADERBOARD,
  isPeriod,
  normaliseLeaderboard,
  resolveLeaderboard,
  validateLeaderboard,
} from '../shared/domain/leaderboard.js';

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

const { DAY, WEEK, MONTH, ALL } = LEADERBOARD_PERIOD;

/** The shape the panel writes into settings['levels'].value.leaderboard. Overrides go on top. */
const stored = (over = {}) => ({
  enabled: true,
  periods: [WEEK, MONTH, ALL],
  defaultPeriod: WEEK,
  topN: 20,
  ...over,
});

/** DEFAULT_LEADERBOARD as a plain object, for comparing a resolver's answer against. */
const OFF = { enabled: false, periods: [], defaultPeriod: ALL, topN: 20 };

/** One row as `leaderboard()` hands it back. */
const rank = (over = {}) => ({ rank: 1, name: 'વર્ણી યુવક', points: 900, isMe: false, ...over });

// ==================================================================== the constants

group('constants - the identities the board is built on');
eq('the settings key', LEADERBOARD_KEY, 'leaderboard');
eq('the four windows and no fifth', LEADERBOARD_PERIOD, { DAY: 'DAY', WEEK: 'WEEK', MONTH: 'MONTH', ALL: 'ALL' });
eq('tab order is narrowest window first', LEADERBOARD_PERIODS, [DAY, WEEK, MONTH, ALL]);
eq('the bounds', [LEADERBOARD_TOP_MIN, LEADERBOARD_TOP_MAX], [3, 100]);
eq('every window has a Gujarati label for the યુવક', Object.keys(PERIOD_LABEL).sort(), [...LEADERBOARD_PERIODS].sort());
eq('every window has an English label for the panel', Object.keys(PERIOD_LABEL_EN).sort(), [...LEADERBOARD_PERIODS].sort());
eq('the panel labels are the words the card shows', [
  PERIOD_LABEL_EN[DAY],
  PERIOD_LABEL_EN[WEEK],
  PERIOD_LABEL_EN[MONTH],
  PERIOD_LABEL_EN[ALL],
], ['Today', 'This week', 'This month', 'All time']);
eq('the default is off, with no window chosen', DEFAULT_LEADERBOARD, OFF);
eq('deploying this work shows nobody to anybody', DEFAULT_LEADERBOARD.enabled, false);
eq('and the default is not "all time" quietly waiting to be switched on', DEFAULT_LEADERBOARD.periods, []);
eq('the suggestion is only a suggestion', SUGGESTED_LEADERBOARD, {
  enabled: true,
  periods: [WEEK, MONTH, ALL],
  defaultPeriod: WEEK,
  topN: 20,
});
eq('the constants are frozen', [
  Object.isFrozen(LEADERBOARD_PERIOD),
  Object.isFrozen(LEADERBOARD_PERIODS),
  Object.isFrozen(PERIOD_LABEL),
  Object.isFrozen(PERIOD_LABEL_EN),
  Object.isFrozen(DEFAULT_LEADERBOARD),
  Object.isFrozen(SUGGESTED_LEADERBOARD),
], [true, true, true, true, true, true]);

group('isPeriod - only the four exact strings');
for (const good of LEADERBOARD_PERIODS) eq(`accepts ${good}`, isPeriod(good), true);
for (const bad of ['day', 'Day', 'YEAR', 'ALLTIME', '', ' DAY', 'DAY ', null, undefined, 0, 1, true, {}, ['DAY']]) {
  eq(`refuses ${JSON.stringify(bad)}`, isPeriod(bad), false);
}

// ==================================================================== resolveLeaderboard, nothing stored

group('resolveLeaderboard - nothing usable was stored, so nobody is shown');
eq('undefined', resolveLeaderboard(undefined), OFF);
eq('null', resolveLeaderboard(null), OFF);
eq('a string', resolveLeaderboard('leaderboard'), OFF);
eq('the empty string', resolveLeaderboard(''), OFF);
eq('a number', resolveLeaderboard(20), OFF);
eq('true', resolveLeaderboard(true), OFF);
eq('an array is not an object here', resolveLeaderboard([]), OFF);
eq('an array of period names is still not an object', resolveLeaderboard([DAY, WEEK]), OFF);
eq('an empty object', resolveLeaderboard({}), OFF);
eq('it never returns the suggestion', resolveLeaderboard(undefined).periods, []);
eq('and never enables', resolveLeaderboard(undefined).enabled, false);

// ==================================================================== resolveLeaderboard, the switch

group('resolveLeaderboard - only JSON true opens the board');
eq('true', resolveLeaderboard(stored({ enabled: true })).enabled, true);
eq("the string 'true' is text, not a switch", resolveLeaderboard(stored({ enabled: 'true' })).enabled, false);
eq("the string 'false' is truthy and must still read as off", resolveLeaderboard(stored({ enabled: 'false' })).enabled, false);
eq('1 is not true', resolveLeaderboard(stored({ enabled: 1 })).enabled, false);
eq('0 is not true', resolveLeaderboard(stored({ enabled: 0 })).enabled, false);
eq("the string '1'", resolveLeaderboard(stored({ enabled: '1' })).enabled, false);
eq('null', resolveLeaderboard(stored({ enabled: null })).enabled, false);
eq('undefined', resolveLeaderboard(stored({ enabled: undefined })).enabled, false);
eq('absent', resolveLeaderboard({ periods: [ALL] }).enabled, false);
eq('an object', resolveLeaderboard(stored({ enabled: {} })).enabled, false);
eq('an array', resolveLeaderboard(stored({ enabled: [] })).enabled, false);
eq('Boolean(new Boolean(false)) is true - the boxed object is refused too', resolveLeaderboard(stored({ enabled: new Boolean(false) })).enabled, false);
eq('the windows survive a bad switch, so nothing he chose is lost', resolveLeaderboard(stored({ enabled: 'true' })), {
  enabled: false,
  periods: [WEEK, MONTH, ALL],
  defaultPeriod: WEEK,
  topN: 20,
});

// ==================================================================== the most important one

/*
  ────────────────────────────────────────────────────────────────────────────
  Enabled with no window is off
  ────────────────────────────────────────────────────────────────────────────

  This is what a save interrupted halfway looks like, and what a row edited by hand looks like.
  The board is a list of other people's names; a row that has not finished saying which window
  it wants must not be read as "show everything to everyone". There is exactly one safe answer
  to a half-described board, and it is no board.
*/

group('resolveLeaderboard - enabled with no period chosen resolves to OFF (the one that matters most)');
eq('enabled true, periods absent', resolveLeaderboard({ enabled: true }).enabled, false);
eq('enabled true, periods empty', resolveLeaderboard({ enabled: true, periods: [] }).enabled, false);
eq('enabled true, periods empty, everything else filled in', resolveLeaderboard(stored({ periods: [] })).enabled, false);
// The stored `defaultPeriod: WEEK` does not survive, and must not: it named a tab that is not
// offered, so the answer is the built-in rather than a window nobody chose to show.
eq('and the whole answer is a board with nothing on it', resolveLeaderboard(stored({ periods: [] })), {
  enabled: false,
  periods: [],
  defaultPeriod: DEFAULT_LEADERBOARD.defaultPeriod,
  topN: 20,
});
eq('every period being unknown is the same as none', resolveLeaderboard(stored({ periods: ['YEAR', 'FORTNIGHT'] })).enabled, false);
eq('a periods array of junk is the same as none', resolveLeaderboard(stored({ periods: [null, 0, {}, [], 'day'] })).enabled, false);
eq('one good window is enough to open it', resolveLeaderboard(stored({ periods: [DAY] })).enabled, true);

// ==================================================================== resolveLeaderboard, periods

group('resolveLeaderboard - a malformed periods field falls to empty, never to ALL');
for (const bad of ['ALL', 'DAY,WEEK', 100, true, null, undefined, {}, { 0: DAY }]) {
  const r = resolveLeaderboard(stored({ periods: bad }));
  eq(`periods = ${JSON.stringify(bad)} gives no window`, r.periods, []);
  eq(`periods = ${JSON.stringify(bad)} does NOT widen to all four`, r.periods.length === LEADERBOARD_PERIODS.length, false);
  eq(`periods = ${JSON.stringify(bad)} leaves the board shut`, r.enabled, false);
}

group('resolveLeaderboard - an unknown window costs one tab, not the board');
eq('one unknown among three good ones', resolveLeaderboard(stored({ periods: [WEEK, 'YEAR', MONTH, ALL] })).periods, [WEEK, MONTH, ALL]);
eq('a lowercase period is not a period', resolveLeaderboard(stored({ periods: ['week', MONTH] })).periods, [MONTH]);
eq('a padded period is not a period', resolveLeaderboard(stored({ periods: [' WEEK', MONTH] })).periods, [MONTH]);
eq('non-strings among them are dropped', resolveLeaderboard(stored({ periods: [DAY, null, 1, {}, ALL] })).periods, [DAY, ALL]);
eq('a fifth window written by a later build still leaves the board open', resolveLeaderboard(stored({ periods: [DAY, 'QUARTER'] })).enabled, true);

group('resolveLeaderboard - de-duplicated, and always in tab order');
eq('duplicates collapse', resolveLeaderboard(stored({ periods: [WEEK, WEEK, WEEK] })).periods, [WEEK]);
eq('duplicates among distinct ones collapse', resolveLeaderboard(stored({ periods: [ALL, DAY, ALL, DAY] })).periods, [DAY, ALL]);
// Deliberately reversed: the stored order is exactly wrong, and the answer is exactly right.
eq('a reversed list comes back narrowest-first', resolveLeaderboard(stored({ periods: [ALL, MONTH, WEEK, DAY], defaultPeriod: ALL })).periods, [DAY, WEEK, MONTH, ALL]);
eq('a shuffled list comes back narrowest-first', resolveLeaderboard(stored({ periods: [MONTH, DAY, ALL, WEEK], defaultPeriod: ALL })).periods, [DAY, WEEK, MONTH, ALL]);
eq('order is taken from the canonical list, not from the row', resolveLeaderboard(stored({ periods: [ALL, WEEK] })).periods, [WEEK, ALL]);
eq('all four, stored forwards', resolveLeaderboard(stored({ periods: [DAY, WEEK, MONTH, ALL], defaultPeriod: DAY })).periods, LEADERBOARD_PERIODS);
eq('a stored value is never mutated', (() => {
  const s = stored({ periods: [ALL, DAY] });
  resolveLeaderboard(s);
  return s.periods;
})(), [ALL, DAY]);

// ==================================================================== resolveLeaderboard, defaultPeriod

group('resolveLeaderboard - the board never opens on a tab that is not there');
eq('a default among the offered ones is kept', resolveLeaderboard(stored({ periods: [WEEK, ALL], defaultPeriod: ALL })).defaultPeriod, ALL);
eq('a default that is not offered falls to the first offered', resolveLeaderboard(stored({ periods: [MONTH, ALL], defaultPeriod: DAY })).defaultPeriod, MONTH);
eq('and "first" means first in tab order, not first as stored', resolveLeaderboard(stored({ periods: [ALL, WEEK], defaultPeriod: DAY })).defaultPeriod, WEEK);
for (const bad of ['week', 'YEAR', '', null, undefined, 1, true, {}, [WEEK]]) {
  eq(`a default of ${JSON.stringify(bad)} falls to the first offered`, resolveLeaderboard(stored({ periods: [MONTH, ALL], defaultPeriod: bad })).defaultPeriod, MONTH);
}
eq('with no window at all there is nothing to open, so the built-in stands', resolveLeaderboard({ enabled: true, periods: [], defaultPeriod: DAY }).defaultPeriod, DEFAULT_LEADERBOARD.defaultPeriod);
eq('the resolved default is always one of the offered windows when there are any', (() => {
  const cases = [
    stored({ periods: [DAY], defaultPeriod: ALL }),
    stored({ periods: [WEEK, ALL], defaultPeriod: 'nonsense' }),
    stored({ periods: [ALL, MONTH, DAY], defaultPeriod: undefined }),
  ];
  return cases.every((c) => {
    const r = resolveLeaderboard(c);
    return r.periods.includes(r.defaultPeriod);
  });
})(), true);

// ==================================================================== resolveLeaderboard, topN

/*
  ────────────────────────────────────────────────────────────────────────────
  typeof, never Number()
  ────────────────────────────────────────────────────────────────────────────

  The SQL mirror tests `jsonb_typeof(...) = 'number'`. A resolver reaching for `Number()` would
  accept the string '50' where the server refuses it, and the panel would promise a board of 50
  names while the function built one of 20. So these are written in pairs: what `Number()` would
  have said, then what the resolver actually says.

  Note also that out-of-range does not clamp to the nearest bound — it falls to the built-in 20.
  A length is a page length rather than a promise about anybody's ગુણ, so a stored row always
  yields a board that renders; but "renders" is the requirement, not "renders as close to what
  was typed as possible", and 20 is the number the panel would have written.
*/

group('resolveLeaderboard - topN is read by typeof, never by Number()');
eq("Number('50') is 50, and that is the trap", Number('50'), 50);
eq("the string '50' is text, so the built-in 20 stands", resolveLeaderboard(stored({ topN: '50' })).topN, 20);
eq("and it is emphatically not 50", resolveLeaderboard(stored({ topN: '50' })).topN === 50, false);
eq("the string '20' is text too", resolveLeaderboard(stored({ topN: '20' })).topN, 20);
eq('a whitespace-padded number string', resolveLeaderboard(stored({ topN: ' 50 ' })).topN, 20);
eq('Number(null) is 0', Number(null), 0);
eq("Number('') is 0", Number(''), 0);
eq('Number([]) is 0', Number([]), 0);
eq("Number(['50']) is 50", Number(['50']), 50);
eq('null reads as the built-in, not as 0', resolveLeaderboard(stored({ topN: null })).topN, 20);
eq('the empty string', resolveLeaderboard(stored({ topN: '' })).topN, 20);
eq('an empty array', resolveLeaderboard(stored({ topN: [] })).topN, 20);
eq('a one-element array Number() would make 50', resolveLeaderboard(stored({ topN: ['50'] })).topN, 20);
eq('true, which Number() would make 1', resolveLeaderboard(stored({ topN: true })).topN, 20);
eq('an object with a valueOf', resolveLeaderboard(stored({ topN: { valueOf: () => 50 } })).topN, 20);
eq('a Number wrapper object is not a number', resolveLeaderboard(stored({ topN: new Number(50) })).topN, 20);

group('resolveLeaderboard - topN, absent and out of range');
eq('absent', resolveLeaderboard({ enabled: true, periods: [ALL] }).topN, 20);
eq('0 is below the floor and falls to the built-in', resolveLeaderboard(stored({ topN: 0 })).topN, 20);
eq('2 is one below the floor', resolveLeaderboard(stored({ topN: 2 })).topN, 20);
eq('and 2 does not become 3 by clamping', resolveLeaderboard(stored({ topN: 2 })).topN === LEADERBOARD_TOP_MIN, false);
eq('3, the floor itself, is honoured', resolveLeaderboard(stored({ topN: 3 })).topN, 3);
eq('100, the ceiling itself, is honoured', resolveLeaderboard(stored({ topN: 100 })).topN, 100);
eq('99', resolveLeaderboard(stored({ topN: 99 })).topN, 99);
eq('101 is one over and falls to the built-in', resolveLeaderboard(stored({ topN: 101 })).topN, 20);
eq('and 101 does not become 100 by clamping', resolveLeaderboard(stored({ topN: 101 })).topN === LEADERBOARD_TOP_MAX, false);
eq('500, a whole સંઘ, is refused - a directory is what §13 forbids', resolveLeaderboard(stored({ topN: 500 })).topN, 20);
eq('-1', resolveLeaderboard(stored({ topN: -1 })).topN, 20);
eq('-100', resolveLeaderboard(stored({ topN: -100 })).topN, 20);

group('resolveLeaderboard - topN, fractions round and the non-finite fall back');
eq('20.4 rounds down', resolveLeaderboard(stored({ topN: 20.4 })).topN, 20);
eq('20.5 rounds up', resolveLeaderboard(stored({ topN: 20.5 })).topN, 21);
eq('20.6 rounds up', resolveLeaderboard(stored({ topN: 20.6 })).topN, 21);
eq('2.6 rounds up into range', resolveLeaderboard(stored({ topN: 2.6 })).topN, 3);
eq('2.4 rounds down out of range and falls to the built-in', resolveLeaderboard(stored({ topN: 2.4 })).topN, 20);
eq('100.4 rounds back onto the ceiling', resolveLeaderboard(stored({ topN: 100.4 })).topN, 100);
eq('100.6 rounds past the ceiling and falls to the built-in', resolveLeaderboard(stored({ topN: 100.6 })).topN, 20);
eq('NaN', resolveLeaderboard(stored({ topN: NaN })).topN, 20);
eq('Infinity', resolveLeaderboard(stored({ topN: Infinity })).topN, 20);
eq('-Infinity', resolveLeaderboard(stored({ topN: -Infinity })).topN, 20);
eq('a resolved length is always a usable whole number', (() => {
  const odd = [undefined, null, '', '50', NaN, Infinity, -Infinity, 0, 2, 101, 500, 20.5, {}, []];
  return odd.every((v) => {
    const n = resolveLeaderboard(stored({ topN: v })).topN;
    return Number.isInteger(n) && n >= LEADERBOARD_TOP_MIN && n <= LEADERBOARD_TOP_MAX;
  });
})(), true);

group('resolveLeaderboard - one bad field does not black out the others');
eq('a broken topN leaves the windows alone', resolveLeaderboard(stored({ topN: 'x' })), {
  enabled: true,
  periods: [WEEK, MONTH, ALL],
  defaultPeriod: WEEK,
  topN: 20,
});
eq('a broken defaultPeriod leaves the windows and the length alone', resolveLeaderboard(stored({ defaultPeriod: 'x', topN: 50 })), {
  enabled: true,
  periods: [WEEK, MONTH, ALL],
  defaultPeriod: WEEK,
  topN: 50,
});
eq('resolving twice is the same answer', resolveLeaderboard(resolveLeaderboard(stored())), resolveLeaderboard(stored()));
eq('and a third time', resolveLeaderboard(resolveLeaderboard(resolveLeaderboard(stored()))), resolveLeaderboard(stored()));
eq('the shape is always the same four keys', Object.keys(resolveLeaderboard(null)), ['enabled', 'periods', 'defaultPeriod', 'topN']);
eq('and the same four when everything was good', Object.keys(resolveLeaderboard(stored())), ['enabled', 'periods', 'defaultPeriod', 'topN']);

// ==================================================================== validateLeaderboard, refusals

group('validateLeaderboard - there is nothing to save');
for (const bad of [null, undefined, 'leaderboard', 20, true, []]) {
  const r = validateLeaderboard(bad);
  eq(`${JSON.stringify(bad)} is refused`, r.ok, false);
  eq(`${JSON.stringify(bad)} says what is missing`, r.gu, 'The leaderboard setting is missing.');
}

group('validateLeaderboard - the switch must be a real boolean');
for (const bad of ['true', 'false', 1, 0, null, undefined, {}, []]) {
  const r = validateLeaderboard({ ...stored(), enabled: bad });
  eq(`enabled = ${JSON.stringify(bad)} is refused`, r.ok, false);
  eq(`enabled = ${JSON.stringify(bad)} names the act`, r.gu, 'Leaderboard: turn it on or off before saving.');
}
eq('false is a real boolean and is accepted', validateLeaderboard({ ...stored(), enabled: false }).ok, true);

group('validateLeaderboard - periods must be a list, and of real windows');
for (const bad of ['ALL', 20, true, null, undefined, {}]) {
  const r = validateLeaderboard(stored({ periods: bad }));
  eq(`periods = ${JSON.stringify(bad)} is refused`, r.ok, false);
  eq(`periods = ${JSON.stringify(bad)} names the choice`, r.gu, 'Leaderboard: choose which periods to show.');
}
{
  const r = validateLeaderboard(stored({ periods: [WEEK, 'YEAR'] }));
  eq('an unknown window is refused rather than silently dropped', r.ok, false);
  eq('and the offending name is quoted back', r.gu, 'Leaderboard: "YEAR" is not a period.');
  eq('the message actually contains it', r.gu.includes('YEAR'), true);
}
for (const bad of ['week', ' WEEK', '', 'ALLTIME']) {
  const r = validateLeaderboard(stored({ periods: [bad, ALL] }));
  eq(`${JSON.stringify(bad)} is refused`, r.ok, false);
  eq(`${JSON.stringify(bad)} is named in the message`, r.gu.includes(String(bad)), true);
}
eq('duplicates are not an error - they collapse', validateLeaderboard(stored({ periods: [WEEK, WEEK, ALL] })).ok, true);
eq('and the accepted value carries each window once, in tab order', validateLeaderboard(stored({ periods: [ALL, WEEK, WEEK] })).leaderboard.periods, [WEEK, ALL]);

/*
  ────────────────────────────────────────────────────────────────────────────
  The asymmetry, asserted as a pair
  ────────────────────────────────────────────────────────────────────────────

  Switching the board on with no window chosen **resolves to off** and is **refused by the
  validator**, and the difference is deliberate rather than an oversight.

  The resolver is read by the SECURITY DEFINER function that decides whether one યુવક may see
  another's name, and there is exactly one safe answer to a row it cannot understand: show
  nothing. The validator is read by a person who is looking at the card. If it were as
  forgiving as the resolver, a સંચાલક who ticked the box and pressed Save would be told
  "Saved", and would then find the board dark with nothing on any screen to tell him he had not
  finished choosing. Forgiveness is correct facing the database and wrong facing the person.
*/

group('validateLeaderboard - enabled with no window RESOLVES to off but is REFUSED (deliberate)');
{
  const half = { enabled: true, periods: [], defaultPeriod: WEEK, topN: 20 };
  eq('the resolver falls closed and shows nothing', resolveLeaderboard(half).enabled, false);
  eq('the validator refuses to let it be saved at all', validateLeaderboard(half).ok, false);
  eq('and says what is still to be done', validateLeaderboard(half).gu, 'Leaderboard: choose at least one period to show.');
  // The mirror image: switched off with no window is a finished, ordinary state.
  eq('off with no window is accepted, because that is what "off" means', validateLeaderboard({ ...half, enabled: false }).ok, true);
  eq('and the resolver agrees it is off', resolveLeaderboard({ ...half, enabled: false }).enabled, false);
}
eq('every window being unknown is refused before the empty-list message is reached', validateLeaderboard(stored({ periods: ['YEAR'] })).gu, 'Leaderboard: "YEAR" is not a period.');

group('validateLeaderboard - which window opens first');
for (const bad of ['week', 'YEAR', '', null, undefined, 1, true, {}]) {
  const r = validateLeaderboard(stored({ defaultPeriod: bad }));
  eq(`defaultPeriod = ${JSON.stringify(bad)} is refused`, r.ok, false);
  eq(`defaultPeriod = ${JSON.stringify(bad)} names the choice`, r.gu, 'Leaderboard: choose which period opens first.');
}
{
  // A real window, but not one he ticked. The board would open on a tab that is not there.
  const r = validateLeaderboard(stored({ periods: [WEEK, ALL], defaultPeriod: DAY }));
  eq('a real window that is not offered is refused', r.ok, false);
  eq('and it is named as the સંચાલક reads it, not as the row stores it', r.gu, 'Leaderboard: "Today" opens first but is not one of the periods shown.');
  eq('the message uses the panel label', r.gu.includes(PERIOD_LABEL_EN[DAY]), true);
  eq('and not the raw constant', r.gu.includes('"DAY"'), false);
}
eq('a default that is offered is accepted', validateLeaderboard(stored({ periods: [WEEK, ALL], defaultPeriod: ALL })).ok, true);

group('validateLeaderboard - how many names');
for (const bad of ['20', null, undefined, NaN, Infinity, -Infinity, [], {}, true]) {
  const r = validateLeaderboard(stored({ topN: bad }));
  eq(`topN = ${JSON.stringify(bad)} is refused`, r.ok, false);
  eq(`topN = ${JSON.stringify(bad)} asks for a number`, r.gu, 'Leaderboard: enter how many names to list.');
}
eq('a fraction is refused as a fraction', validateLeaderboard(stored({ topN: 20.5 })).gu, 'Leaderboard: the number of names must be a whole number.');
eq('below the floor names the bound', validateLeaderboard(stored({ topN: 2 })).gu, 'Leaderboard: list between 3 and 100 names.');
eq('above the ceiling names the bound', validateLeaderboard(stored({ topN: 101 })).gu, 'Leaderboard: list between 3 and 100 names.');
eq('0', validateLeaderboard(stored({ topN: 0 })).gu, 'Leaderboard: list between 3 and 100 names.');
eq('-1', validateLeaderboard(stored({ topN: -1 })).gu, 'Leaderboard: list between 3 and 100 names.');
eq('500', validateLeaderboard(stored({ topN: 500 })).gu, 'Leaderboard: list between 3 and 100 names.');
eq('a bound message names both bounds', [String(LEADERBOARD_TOP_MIN), String(LEADERBOARD_TOP_MAX)].every((n) => validateLeaderboard(stored({ topN: 2 })).gu.includes(n)), true);
eq('the floor itself is accepted', validateLeaderboard(stored({ topN: 3 })).ok, true);
eq('the ceiling itself is accepted', validateLeaderboard(stored({ topN: 100 })).ok, true);

group('validateLeaderboard - every refusal is a refusal with words');
{
  const bad = [
    null, undefined, 'x', 20, [],
    { ...stored(), enabled: 'true' },
    stored({ periods: 'ALL' }),
    stored({ periods: ['YEAR'] }),
    { enabled: true, periods: [], defaultPeriod: WEEK, topN: 20 },
    stored({ defaultPeriod: 'x' }),
    stored({ periods: [WEEK], defaultPeriod: DAY }),
    stored({ topN: '20' }),
    stored({ topN: 20.5 }),
    stored({ topN: 2 }),
    stored({ topN: 101 }),
  ];
  eq('none of them is accepted', bad.filter((b) => validateLeaderboard(b).ok).length, 0);
  eq('every one of them carries a message', bad.every((b) => typeof validateLeaderboard(b).gu === 'string' && validateLeaderboard(b).gu.length > 0), true);
  eq('and none of them returns a leaderboard to save', bad.every((b) => validateLeaderboard(b).leaderboard === undefined), true);
}

// ==================================================================== validateLeaderboard, acceptance

group('validateLeaderboard - a good value comes back in tab order');
{
  const good = stored();
  const r = validateLeaderboard(good);
  eq('accepted', r.ok, true);
  eq('returned in canonical form', r.leaderboard, {
    enabled: true,
    periods: [WEEK, MONTH, ALL],
    defaultPeriod: WEEK,
    topN: 20,
  });
  eq('the input is not mutated', good, stored());
  eq('the returned board is a copy, not the input', r.leaderboard === good, false);
  eq('the returned periods are a copy too', r.leaderboard.periods === good.periods, false);
}
eq('the suggestion the panel pre-fills is itself valid', validateLeaderboard(SUGGESTED_LEADERBOARD).ok, true);
eq('so is the default it starts from', validateLeaderboard(DEFAULT_LEADERBOARD).ok, true);
eq('unknown extra keys are dropped rather than saved', Object.keys(validateLeaderboard({ ...stored(), stray: 9 }).leaderboard), ['enabled', 'periods', 'defaultPeriod', 'topN']);
eq('a reversed selection is accepted and straightened', validateLeaderboard(stored({ periods: [ALL, MONTH, WEEK, DAY], defaultPeriod: ALL })).leaderboard.periods, LEADERBOARD_PERIODS);

/*
  ────────────────────────────────────────────────────────────────────────────
  The equivalence
  ────────────────────────────────────────────────────────────────────────────

  Anything validateLeaderboard() accepts, resolveLeaderboard() must return unchanged. This is
  the property that keeps the card's controls and the yuvak's board the same board: the panel
  validates before it writes, the function resolves before it reads, and if those two ever
  described one stored row differently the disagreement would be invisible from both ends.
*/

group('validateLeaderboard accepts only what resolveLeaderboard returns unchanged');
{
  const GOOD = [
    { enabled: false, periods: [], defaultPeriod: ALL, topN: 20 },
    { enabled: true, periods: [ALL], defaultPeriod: ALL, topN: 20 },
    { enabled: true, periods: [DAY], defaultPeriod: DAY, topN: 3 },
    { enabled: true, periods: [WEEK, MONTH, ALL], defaultPeriod: WEEK, topN: 20 },
    { enabled: true, periods: [DAY, WEEK, MONTH, ALL], defaultPeriod: MONTH, topN: 100 },
    { enabled: true, periods: [ALL, DAY], defaultPeriod: DAY, topN: 50 },
    { enabled: false, periods: [WEEK, ALL], defaultPeriod: ALL, topN: 10 },
    DEFAULT_LEADERBOARD,
    SUGGESTED_LEADERBOARD,
  ];
  for (const g of GOOD) {
    const label = JSON.stringify(g);
    const r = validateLeaderboard(g);
    eq(`accepted: ${label}`, r.ok, true);
    eq(`the resolver returns it unchanged: ${label}`, resolveLeaderboard(g), r.leaderboard);
    eq(`the resolver agrees with itself on the validator output: ${label}`, resolveLeaderboard(r.leaderboard), r.leaderboard);
    eq(`re-validating the validator output accepts it: ${label}`, validateLeaderboard(r.leaderboard).leaderboard, r.leaderboard);
    eq(`and is idempotent: ${label}`, validateLeaderboard(validateLeaderboard(r.leaderboard).leaderboard).leaderboard, r.leaderboard);
  }
}

/*
  The one place the equivalence is not literal, recorded rather than hidden.

  A board that is **off** with no window chosen may name any real window as the one that would
  open first — the validator has nothing to check it against, so it accepts it, while the
  resolver has no offered window to keep it among and answers with the built-in. Both are
  right, and the difference cannot be seen: an off board opens no tab at all. It is asserted
  here so that a future change which makes it visible fails loudly instead of quietly.
*/
group('the one benign divergence: an off board with no window remembers nothing');
{
  const offWithHint = { enabled: false, periods: [], defaultPeriod: DAY, topN: 20 };
  eq('the validator accepts it', validateLeaderboard(offWithHint).ok, true);
  eq('and keeps the hint', validateLeaderboard(offWithHint).leaderboard.defaultPeriod, DAY);
  eq('the resolver answers with the built-in instead', resolveLeaderboard(offWithHint).defaultPeriod, DEFAULT_LEADERBOARD.defaultPeriod);
  eq('and both agree on the only thing a યુવક can see', [
    resolveLeaderboard(offWithHint).enabled,
    validateLeaderboard(offWithHint).leaderboard.enabled,
  ], [false, false]);
  eq('no window is offered either way', resolveLeaderboard(offWithHint).periods, []);
}

// ==================================================================== normaliseLeaderboard

group('normaliseLeaderboard - nothing usable came back');
for (const bad of [null, undefined, 'board', 20, true]) {
  eq(`${JSON.stringify(bad)} gives an empty board`, normaliseLeaderboard(bad), {
    period: ALL,
    rows: [],
    me: null,
    participants: 0,
  });
}
eq('an empty object', normaliseLeaderboard({}), { period: ALL, rows: [], me: null, participants: 0 });
eq('the shape is always the same four keys', Object.keys(normaliseLeaderboard(null)), ['period', 'rows', 'me', 'participants']);
eq('rows is always an array, never undefined', Array.isArray(normaliseLeaderboard(null).rows), true);
for (const bad of ['rows', 20, {}, null, undefined]) {
  eq(`rows = ${JSON.stringify(bad)} gives []`, normaliseLeaderboard({ rows: bad }).rows, []);
}
eq('a list of junk rows gives []', normaliseLeaderboard({ rows: [null, undefined, 3, 'x', {}, []] }).rows, []);

group('normaliseLeaderboard - the period it says it is');
for (const good of LEADERBOARD_PERIODS) {
  eq(`period ${good} survives`, normaliseLeaderboard({ period: good }).period, good);
}
for (const bad of ['day', 'YEAR', '', null, undefined, 1, {}]) {
  eq(`period ${JSON.stringify(bad)} reads as ALL`, normaliseLeaderboard({ period: bad }).period, ALL);
}

group('normaliseLeaderboard - a row with no rank is not a row');
eq('rank absent', normaliseLeaderboard({ rows: [{ name: 'A', points: 10 }] }).rows, []);
eq('rank 0', normaliseLeaderboard({ rows: [rank({ rank: 0 })] }).rows, []);
eq('rank negative', normaliseLeaderboard({ rows: [rank({ rank: -1 })] }).rows, []);
eq('rank NaN', normaliseLeaderboard({ rows: [rank({ rank: NaN })] }).rows, []);
eq('rank null', normaliseLeaderboard({ rows: [rank({ rank: null })] }).rows, []);
eq('rank not a number at all', normaliseLeaderboard({ rows: [rank({ rank: 'first' })] }).rows, []);
eq('one good row among rankless ones survives', normaliseLeaderboard({ rows: [{ name: 'A' }, rank({ rank: 2 }), null] }).rows.length, 1);
eq('and it keeps its own rank', normaliseLeaderboard({ rows: [{ name: 'A' }, rank({ rank: 2 })] }).rows[0].rank, 2);

group('normaliseLeaderboard - rank, name and points are coerced, never invented');
eq("a driver returning numerics as strings still reads", normaliseLeaderboard({ rows: [rank({ rank: '2', points: '900' })] }).rows[0], { rank: 2, name: 'વર્ણી યુવક', points: 900, isMe: false });
eq('a fractional rank floors', normaliseLeaderboard({ rows: [rank({ rank: 2.9 })] }).rows[0].rank, 2);
eq('fractional points floor', normaliseLeaderboard({ rows: [rank({ points: 900.9 })] }).rows[0].points, 900);
eq('negative points read as 0 - the ledger only ever adds', normaliseLeaderboard({ rows: [rank({ points: -50 })] }).rows[0].points, 0);
eq('NaN points read as 0', normaliseLeaderboard({ rows: [rank({ points: NaN })] }).rows[0].points, 0);
eq('missing points read as 0, never as undefined', normaliseLeaderboard({ rows: [{ rank: 1, name: 'A' }] }).rows[0].points, 0);
eq('a missing name is the empty string, never the word undefined', normaliseLeaderboard({ rows: [{ rank: 1 }] }).rows[0].name, '');
eq('a non-string name is the empty string', normaliseLeaderboard({ rows: [rank({ name: 42 })] }).rows[0].name, '');
eq('a null name', normaliseLeaderboard({ rows: [rank({ name: null })] }).rows[0].name, '');
eq('a Gujarati name comes through untouched', normaliseLeaderboard({ rows: [rank({ name: 'પાર્થ' })] }).rows[0].name, 'પાર્થ');
eq('row order is left exactly as the server ranked it', normaliseLeaderboard({ rows: [rank({ rank: 1 }), rank({ rank: 2 }), rank({ rank: 3 })] }).rows.map((r) => r.rank), [1, 2, 3]);

group('normaliseLeaderboard - isMe is exactly true, or it is not him');
eq('true', normaliseLeaderboard({ rows: [rank({ isMe: true })] }).rows[0].isMe, true);
for (const bad of ['true', 'false', 1, 0, 'yes', {}, [], null, undefined]) {
  eq(`isMe = ${JSON.stringify(bad)} is not him`, normaliseLeaderboard({ rows: [rank({ isMe: bad })] }).rows[0].isMe, false);
}
eq('absent', normaliseLeaderboard({ rows: [{ rank: 1, name: 'A', points: 5 }] }).rows[0].isMe, false);

/*
  ────────────────────────────────────────────────────────────────────────────
  §13, the client half
  ────────────────────────────────────────────────────────────────────────────

  A row of this list is a name and a number. Not an id — not even an opaque one, because an id
  is what turns a list of names into a key another request can be built around — and not a SMK
  number, a મોબાઈલ, an email or a સબઝોન.

  The SQL half of that rule is the aperture check further down. This is the client half: if a
  future migration ever widened the function's SELECT, the extra column would arrive here and
  be dropped, and somebody would have to add it deliberately before it could reach a phone.
  The assertion is on the **exact key set**, because an assertion on the values would pass
  happily while an extra one rode along beside them.
*/

group('§13 - a row is stripped to a name and a number, whatever it arrived carrying');
{
  const wide = normaliseLeaderboard({
    rows: [{
      rank: 1,
      name: 'પાર્થ',
      points: 900,
      isMe: true,
      user_id: '00000000-0000-0000-0000-000000000001',
      smk: 'SMK-1234',
      mobile: '9876543210',
      email: 'someone@example.com',
      sub_zone_id: 7,
      created_at: '2026-08-13T00:00:00Z',
    }],
  });
  eq('exactly four keys, and these four', Object.keys(wide.rows[0]), ['rank', 'name', 'points', 'isMe']);
  eq('the row still reads correctly', wide.rows[0], { rank: 1, name: 'પાર્થ', points: 900, isMe: true });
  eq('no user id', 'user_id' in wide.rows[0], false);
  eq('no SMK number', 'smk' in wide.rows[0], false);
  eq('no મોબાઈલ', 'mobile' in wide.rows[0], false);
  eq('no email', 'email' in wide.rows[0], false);
  eq('no સબઝોન', 'sub_zone_id' in wide.rows[0], false);
  eq('no dates', 'created_at' in wide.rows[0], false);
  eq('and nothing was serialised that was not asked for', JSON.stringify(wide.rows[0]).includes('9876543210'), false);
  eq('every row of a longer list is stripped, not just the first', normaliseLeaderboard({
    rows: [
      { rank: 1, name: 'A', points: 3, user_id: 'x' },
      { rank: 2, name: 'B', points: 2, mobile: '1' },
      { rank: 3, name: 'C', points: 1, smk: 's' },
    ],
  }).rows.every((r) => JSON.stringify(Object.keys(r)) === JSON.stringify(['rank', 'name', 'points', 'isMe'])), true);
}

group('normaliseLeaderboard - "me", which is a different thing from being last');
eq('absent is null, not a rank of 0', normaliseLeaderboard({ rows: [rank()] }).me, null);
eq('null stays null', normaliseLeaderboard({ me: null }).me, null);
for (const bad of ['me', 20, true]) {
  eq(`me = ${JSON.stringify(bad)} is null`, normaliseLeaderboard({ me: bad }).me, null);
}
eq('a real me', normaliseLeaderboard({ me: { rank: 7, points: 450 } }).me, { rank: 7, points: 450 });
eq('me is stripped to two numbers as well', Object.keys(normaliseLeaderboard({ me: { rank: 7, points: 450, name: 'પાર્થ', user_id: 'x' } }).me), ['rank', 'points']);
eq('and it carries no name', 'name' in normaliseLeaderboard({ me: { rank: 7, points: 450, name: 'પાર્થ' } }).me, false);
eq('string numerics read', normaliseLeaderboard({ me: { rank: '7', points: '450' } }).me, { rank: 7, points: 450 });
eq('missing halves are 0, not undefined', normaliseLeaderboard({ me: {} }).me, { rank: 0, points: 0 });
eq('negatives read as 0', normaliseLeaderboard({ me: { rank: -1, points: -5 } }).me, { rank: 0, points: 0 });
eq('a fraction floors', normaliseLeaderboard({ me: { rank: 7.9, points: 450.9 } }).me, { rank: 7, points: 450 });

group('normaliseLeaderboard - participants');
eq('absent is 0', normaliseLeaderboard({}).participants, 0);
eq('a number', normaliseLeaderboard({ participants: 42 }).participants, 42);
eq('a string numeric', normaliseLeaderboard({ participants: '42' }).participants, 42);
eq('negative reads as 0', normaliseLeaderboard({ participants: -1 }).participants, 0);
eq('NaN reads as 0 rather than throwing on a page the ધ્યાન does not depend on', normaliseLeaderboard({ participants: NaN }).participants, 0);
eq('garbage reads as 0', normaliseLeaderboard({ participants: {} }).participants, 0);
eq('a fraction floors', normaliseLeaderboard({ participants: 42.9 }).participants, 42);

group('normaliseLeaderboard - a whole board, straight through');
{
  const board = normaliseLeaderboard({
    period: WEEK,
    participants: 137,
    me: { rank: 12, points: 1500 },
    rows: [
      { rank: 1, name: 'પહેલો', points: 3000, isMe: false, user_id: 'a' },
      { rank: 2, name: 'બીજો', points: 2400, isMe: false, smk: 'b' },
      { rank: 3, name: 'ત્રીજો', points: 2400, isMe: true, mobile: 'c' },
      { name: 'રેન્ક વગરનો', points: 999 },
    ],
  });
  eq('the window it says it is', board.period, WEEK);
  eq('the rankless row is gone', board.rows.length, 3);
  eq('the ranks are in the order the server gave them', board.rows.map((r) => r.rank), [1, 2, 3]);
  eq('a tie keeps both rows and both numbers', board.rows.map((r) => r.points), [3000, 2400, 2400]);
  eq('exactly one row is him', board.rows.filter((r) => r.isMe).length, 1);
  eq('his own line is reported separately as well', board.me, { rank: 12, points: 1500 });
  eq('how many people are being ranked', board.participants, 137);
  eq('and not one row carries anything else', board.rows.every((r) => Object.keys(r).length === 4), true);
  eq('normalising twice is the same board', normaliseLeaderboard(board), board);
}

// ==================================================================== drift against the migration

/*
  ────────────────────────────────────────────────────────────────────────────
  The module against the SQL that mirrors it
  ────────────────────────────────────────────────────────────────────────────

  `leaderboard()` reads the same settings slice this module resolves, and it is the only path
  in the project that reads another યુવક's row. Nothing in the module can check that, because a
  module must not import a migration — so it is checked here, by reading the SQL as text,
  exactly as scripts/test-points.mjs checks 0021 and scripts/test-navigation.mjs checks the nav
  registry against src/App.jsx. String containment only: this suite never executes SQL and has
  no database to execute it against.
*/

const SQL_0023 = new URL('../supabase/migrations/0023_leaderboard.sql', import.meta.url);

group('the migration agrees with shared/domain/leaderboard.js');
if (!existsSync(fileURLToPath(SQL_0023))) {
  skip('leaderboard vs 0023_leaderboard.sql', 'the migration does not exist yet - re-run once it lands');
} else {
  const sql = readFileSync(SQL_0023, 'utf8');
  const flat = sql.toLowerCase().replace(/\s+/g, ' ');
  const has = (s) => flat.includes(s.toLowerCase());

  /**
   * The migration with its prose taken out: block comments, `--` comments, and single-quoted
   * literals.
   *
   * The same move test-points.mjs makes over the module for §62, and for the same reason. This
   * file **explains at length** what a leaderboard row does not carry, and the `nav_registry`
   * and `comment on` text it writes is prose too - so the words મોબાઈલ and SMK appear in it
   * precisely because the rule is being stated. A bare containment check over the whole file
   * would fail on the sentence that promises the thing it is checking for. What must not appear
   * is a bare identifier: a column selected, or a table joined, which is what is left after the
   * prose is removed.
   */
  const code = sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((l) => l.replace(/--.*$/, ' '))
    .join('\n')
    .replace(/'(?:[^']|'')*'/g, "''")
    .toLowerCase();

  eq('the migration was read at all', sql.length > 0, true);

  // ---- everything the migration is expected to define -----------------------
  const missing = ['leaderboard_settings', 'settings_check_leaderboard', 'nav_registry'].filter((n) => !has(n));
  eq('every object the app depends on is defined in the migration', missing, []);
  eq('the settings key it guards is named', has(LEADERBOARD_KEY), true);

  // ---- the aperture runs above RLS, because no policy is widened ------------
  eq('security definer - the single, deliberate crossing of §13', has('security definer'), true);

  // ---- the window is the server, in IST, and calendar-aligned --------------
  eq('the day is decided in Asia/Kolkata, never on the phone', sql.includes("timezone('Asia/Kolkata'"), true);
  eq("the week is a calendar week, not the last seven days", sql.includes("date_trunc('week'"), true);
  eq('the month is a calendar month', sql.includes("date_trunc('month'"), true);

  // ---- all four windows exist in SQL, or a tab shows an empty board --------
  const missingPeriods = LEADERBOARD_PERIODS.filter((p) => !sql.includes(p));
  eq('every window this module offers is handled in the SQL', missingPeriods, []);
  eq('and each one individually', LEADERBOARD_PERIODS.map((p) => sql.includes(p)), [true, true, true, true]);

  // ---- the same bounds on the same field -----------------------------------
  eq('the migration carries the same bounds', [String(LEADERBOARD_TOP_MIN), String(LEADERBOARD_TOP_MAX)].every((n) => sql.includes(n)), true);

  /*
    ──────────────────────────────────────────────────────────────────────────
    The aperture stays narrow
    ──────────────────────────────────────────────────────────────────────────

    A name and a number, and nothing else. These four tokens are searched for over the **whole
    file's code**, not merely inside the leaderboard function's body, because there is no reason
    for any of them to be executed anywhere in this migration — a JOIN written to fetch one of
    them is the rule undone, and every screen would still look correct.
  */
  const APERTURE = ['sub_zone_id', 'smk', 'mobile', 'p.email'];
  for (const token of APERTURE) {
    const hits = code.split(token.toLowerCase()).length - 1;
    eq(`the leaderboard never touches ${token}`, hits, 0);
  }
  eq('none of the four are executed anywhere in the migration', APERTURE.filter((t) => code.includes(t.toLowerCase())), []);
  // And the aperture is one function reading one thing: no policy anywhere is widened by it.
  eq('no RLS policy is created or altered by this migration', /\b(create|alter)\s+policy\b/.test(code), false);
}

// ==================================================================== §62 rule - no literal total

group('the module holds no total (§62)');
{
  const rel = '../shared/domain/leaderboard.js';
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
