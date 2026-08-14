/**
 * ────────────────────────────────────────────────────────────────────────────
 * THE BOTTOM BAR, AS PURE LOGIC — `npm run test:navigation`
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `shared/domain/navigation.js` decides what stands at the bottom of a phone, in what
 * order, and — this is the part that is not cosmetic — where each of those buttons goes.
 * It reads a jsonb row that anybody holding `settings.update` may have written through
 * PostgREST without going anywhere near `admin/src`, and it must produce a renderable bar
 * out of every possible value of that row, including the values nobody meant to write.
 *
 * Everything in that module is a pure function: no database, no network, no React. So it
 * can be tested exactly, in milliseconds, on every commit — which is the whole reason the
 * resolving, the validating and the reordering were pulled out of the panel and the app in
 * the first place. What a browser is needed for is measured separately in
 * scripts/verify-nav.mjs; this file deliberately does not try to reach it.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * What it protects, and what each part is protecting against
 * ────────────────────────────────────────────────────────────────────────────
 *
 *   1. **A destination may never come from the row.** The registry holds every route; the
 *      stored item holds a key and the admin's opinions about it. One curl against
 *      `settings` could otherwise put `https://evil.example` — or `/admin` — under a button
 *      that 2,000 people press without reading. Acceptance 9 below is the single most important
 *      group in this file and is written as its own section for that reason.
 *
 *   2. **The way home cannot be taken away.** There is no sidebar, no hamburger and no
 *      breadcrumb behind this bar, and a PWA in standalone mode draws no browser Back. A
 *      configuration that hides મુખપૃષ્ઠ is not a preference, it is a trap, and it can be
 *      set three different ways (absent, `visible: false`, `enabled: false`) which is why
 *      all three are asserted rather than one.
 *
 *   3. **A bad row must never produce an empty bar.** Every branch of the resolver has to
 *      end at something renderable. A yuvak whose settings read failed, or whose row was
 *      written by a build newer than his, gets the same four buttons as everybody else —
 *      not a blank strip, and not a bar that quietly lost its way home.
 *
 *   4. **The reorder has a wrong answer.** Splicing an item out before computing where it
 *      lands drops a downward drag one row short of where it was released. That is a bug
 *      fixed twice — once for the mouse, once for the keyboard — unless both go through one
 *      function, and acceptance 3 is where that function is held to it without a browser.
 *
 *   5. **The registry must agree with the things it claims to describe**: the router in
 *      src/App.jsx, and the CHECK constraints in 0019. Two copies of one list, checked by
 *      the build, is the pattern `shared/domain/permissions.js` documents and regrets not
 *      having automated - acceptances 13 and 14 are that automation for this list.
 *
 * The group headings carry the acceptance-test numbers from the brief, so the correspondence
 * between what was asked for and what is asserted can be read off rather than reconstructed.
 *
 * No test framework, for the same reason scripts/test-domain.mjs gives: adding one to run
 * assertions on a single module is not worth a dependency. Exit code is the result: 0 green,
 * 1 red.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_MOBILE_NAV,
  MOBILE_BOTTOM_KEY,
  MOBILE_NAV_MAX,
  MOBILE_NAV_MIN,
  NAV_CUSTOM_MAX,
  NAV_CUSTOM_PREFIX,
  NAV_ICONS,
  NAV_LABEL_MAX,
  NAV_REGISTRY,
  NAV_REQUIRED_KEY,
  NAV_ROUTES,
  duplicateNavItem,
  isCustomKey,
  isValidCustomKey,
  makeCustomKey,
  navDestination,
  navRegistryEntry,
  navRouteEntry,
  navRouteError,
  newCustomItem,
  normalizeNavRoute,
  reorder,
  resolveMobileNav,
  resolveMobileNavConfig,
  toStoredMobileNav,
  validateMobileNav,
} from '../shared/domain/navigation.js';

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

/** One stored item, in the shape the panel writes. Overrides go on top. */
const nav = (key, over = {}) => ({ key, visible: true, enabled: true, ...over });

/**
 * A stored list, numbered 1..n in the order given — what `toStoredMobileNav()` would have
 * produced. A bare string is the ordinary "shown, enabled" item; an object that already
 * carries an order keeps it, so a test can break the numbering on purpose.
 */
const stored = (...items) =>
  items.map((it, i) => {
    const o = typeof it === 'string' ? nav(it) : it;
    return o.sortOrder === undefined && o.sort_order === undefined ? { ...o, sortOrder: i + 1 } : o;
  });

const keysOf = (list) => list.map((i) => i.key);
const routesOf = (list) => list.map((i) => i.route);

/** The four DEFAULT_MOBILE_NAV resolves to, spelled out so a change to it has to be deliberate. */
const DEFAULT_KEYS = ['home', 'darshan', 'revision', 'profile'];
const DEFAULT_ROUTES = ['/', '/darshan', '/level/3', '/profile'];

/** Every route the registry admits. Nothing resolved may ever carry anything else. */
const REGISTRY_ROUTES = new Set(NAV_REGISTRY.map((r) => r.route));

// ============================================================ 1 - hide an item

/*
  The સંચાલક switches an item off, and two different questions come out of it.

  Two different questions, and the whole reason resolveMobileNav() and
  resolveMobileNavConfig() are two functions rather than one with a boolean: the panel has to
  keep listing what is hidden (otherwise it cannot be switched back on) and the bar must not
  render it. A single function with a flag would eventually be called the wrong way round by
  a caller that could not see the argument at the call site.
*/
group('acceptance 1 - the admin can hide an item');
{
  const row = stored('home', 'darshan', nav('revision', { visible: false }), 'profile');

  eq('hiding a non-required item is a legal configuration', validateMobileNav(row).ok, true);
  eq('the bar no longer holds it', keysOf(resolveMobileNav(row)), ['home', 'darshan', 'profile']);
  eq('the panel still does', keysOf(resolveMobileNavConfig(row)), ['home', 'darshan', 'revision', 'profile']);
  eq(
    'and it is listed as hidden, not as missing',
    resolveMobileNavConfig(row).find((i) => i.key === 'revision').visible,
    false
  );
  // Hiding one must not disturb the three that stay - the order is the admin's, and a bar
  // that reshuffles itself when something is switched off teaches a yuvak that buttons move.
  eq('the rest keep their order', routesOf(resolveMobileNav(row)), ['/', '/darshan', '/profile']);
}

// ============================================================ 2 - switch an item on

group('acceptance 2 - the admin can switch an item on');
{
  // લેવલ ૪ is in the registry and not in the default four. Switching it on is the ordinary
  // reason this feature exists: a bar is a judgement about what a yuvak should be doing this
  // month, and the judgement changes without a deploy.
  const row = stored('home', 'darshan', 'revision', 'profile', 'level4');

  eq('five is still a legal bar', validateMobileNav(row).ok, true);
  eq('the new item reaches the bar', keysOf(resolveMobileNav(row)), ['home', 'darshan', 'revision', 'profile', 'level4']);
  eq('carrying the registry route', resolveMobileNav(row)[4].route, '/level/4');
  eq('and the registry label, none having been written', resolveMobileNav(row)[4].label, 'લેવલ ૪');
  eq('and the registry icon', resolveMobileNav(row)[4].icon, 'grid');

  // A key the row has never mentioned is simply absent - it is not silently added back.
  eq('an item nobody switched on stays out', keysOf(resolveMobileNav(row)).includes('start'), false);
}

// ============================================================ 3 - reorder

/*
  The one piece of reordering that has a wrong answer.

  `reorder()` exists as a shared function for a single reason: computing the destination
  index AFTER splicing the item out shifts every position past the source by one, so a
  downward drag lands one row short of where it was released. Upward moves are unaffected,
  which is what makes the bug survive review — it looks right half the time.

  So the downward move is asserted specifically, at the two indices where the off-by-one
  would show: one step down, and all the way to the end.
*/
group('acceptance 3 - the admin can reorder, both directions');
{
  const four = ['home', 'darshan', 'revision', 'profile'];

  eq('down one lands where it was dropped', reorder(four, 0, 1), ['darshan', 'home', 'revision', 'profile']);
  eq('down two, not one short', reorder(four, 0, 2), ['darshan', 'revision', 'home', 'profile']);
  eq('down to the last row, not the second-to-last', reorder(four, 0, 3), ['darshan', 'revision', 'profile', 'home']);
  eq('the middle moves down correctly too', reorder(four, 1, 3), ['home', 'revision', 'profile', 'darshan']);

  eq('up one', reorder(four, 3, 2), ['home', 'darshan', 'profile', 'revision']);
  eq('up to the front', reorder(four, 3, 0), ['profile', 'home', 'darshan', 'revision']);
  eq('the middle moves up correctly too', reorder(four, 2, 1), ['home', 'revision', 'darshan', 'profile']);

  // A drop past the end of the list is a perfectly clear instruction; a keyboard user
  // pressing ↓ on the last row should be a no-op rather than an error.
  eq('a drop past the end clamps to the end', reorder(four, 0, 99), ['darshan', 'revision', 'profile', 'home']);
  eq('a drop before the start clamps to the start', reorder(four, 2, -5), ['revision', 'home', 'darshan', 'profile']);
  eq('an out-of-range source changes nothing', reorder(four, 9, 0), four);
  eq('a negative source changes nothing', reorder(four, -1, 0), four);
  eq('a non-integer source changes nothing', reorder(four, 1.5, 0), four);
  eq('from === to is a no-op', reorder(four, 2, 2), four);
  eq('a drop past the end from the last row is a no-op', reorder(four, 3, 99), four);

  // The panel holds this list in React state. A function that mutated it in place would
  // reorder the rows without re-rendering them, which reads as a drag that did nothing.
  const before = [...four];
  reorder(four, 0, 3);
  eq('the original list is never mutated', four, before);
  eq('a new array is returned every time', reorder(four, 0, 0) === four, false);
}

// ============================================================ 4 - the saved order

/*
  What the સંચાલક dragged is what a યુવક sees.

  `toStoredMobileNav()` renumbers rather than saving the numbers already on the items,
  because after a drag the POSITIONS are the truth and the old numbers are stale. This is the
  one place array position is allowed to decide an order, and it is allowed only because it
  is immediately turned into a stored number that nothing downstream may re-derive.
*/
group('acceptance 4 - the saved order is the order that appears');
{
  const shuffled = [nav('profile'), nav('home'), nav('revision'), nav('darshan')];
  const row = toStoredMobileNav(shuffled);

  eq('sortOrder is renumbered 1..n in array order', row.map((i) => i.sortOrder), [1, 2, 3, 4]);
  eq('the keys keep the order they were dragged into', keysOf(row), ['profile', 'home', 'revision', 'darshan']);
  eq('the bar comes back in that order', keysOf(resolveMobileNav(row)), ['profile', 'home', 'revision', 'darshan']);
  eq('and so do the routes', routesOf(resolveMobileNav(row)), ['/profile', '/', '/level/3', '/darshan']);
  eq('the round trip is still a legal configuration', validateMobileNav(row).ok, true);

  // Stale numbers on the incoming items are discarded, not honoured - otherwise the drag
  // would appear to have worked in the panel and not in the app.
  const stale = toStoredMobileNav([nav('profile', { sortOrder: 40 }), nav('home', { sortOrder: 9 })]);
  eq('a stale sortOrder is overwritten by the position', stale.map((i) => i.sortOrder), [1, 2]);
  eq('...and the position wins in the bar', keysOf(resolveMobileNav([...stale, nav('darshan', { sortOrder: 3 })])), ['profile', 'home', 'darshan']);

  // The stored row carries a route so it can be read on its own in psql, in a backup, or in
  // the audit trail's `after` blob. It is the registry's, and acceptance 9 enforces that.
  eq('every stored item carries its registry route', routesOf(row), ['/profile', '/', '/level/3', '/darshan']);
  eq('and nothing else is written into the row', Object.keys(row[0]).sort(), ['enabled', 'icon', 'key', 'label', 'route', 'sortOrder', 'visible']);

  // The brief spells the field `sort_order`; a hand-run SQL patch may well have written it
  // that way. Read both, write one - a bar that silently reorders itself because the key was
  // spelled the other way has nothing on any screen to say why.
  const snake = [
    { key: 'profile', visible: true, enabled: true, sort_order: 1 },
    { key: 'home', visible: true, enabled: true, sort_order: 2 },
  ];
  eq('snake_case is read on the way in', keysOf(resolveMobileNav(snake)), ['profile', 'home']);
  eq('...and camelCase is what goes back out', toStoredMobileNav(snake).map((i) => i.sortOrder), [1, 2]);
}

// ============================================================ 5 - hidden / disabled

/*
  Two different words for "not on screen", and both have to work.

  `visible: false` is the સંચાલક's choice; `enabled: false` is the item being switched off as
  a destination. Rendering either one would be a button a યુવક can press that he was not
  meant to have, so the bar filters on both and the panel lists both.
*/
group('acceptance 5 - hidden items do not appear, disabled items cannot be opened');
{
  const hidden = stored('home', 'darshan', nav('revision', { visible: false }), 'profile');
  const disabled = stored('home', 'darshan', nav('revision', { enabled: false }), 'profile');
  const both = stored('home', 'darshan', nav('revision', { visible: false, enabled: false }), 'profile');

  eq('visible: false is off the bar', keysOf(resolveMobileNav(hidden)).includes('revision'), false);
  eq('enabled: false is off the bar', keysOf(resolveMobileNav(disabled)).includes('revision'), false);
  eq('both at once is off the bar', keysOf(resolveMobileNav(both)).includes('revision'), false);

  eq('all three still list in the panel', [
    keysOf(resolveMobileNavConfig(hidden)).length,
    keysOf(resolveMobileNavConfig(disabled)).length,
    keysOf(resolveMobileNavConfig(both)).length,
  ], [4, 4, 4]);

  eq('the panel can tell hidden from disabled', [
    resolveMobileNavConfig(hidden).find((i) => i.key === 'revision').enabled,
    resolveMobileNavConfig(disabled).find((i) => i.key === 'revision').visible,
  ], [true, true]);

  /*
    Absence is not "off". `false` is how off is said — anything else and a row written by a
    build that did not know about a field would switch that field's item off on upgrade.

    Worth being precise about where that rule actually bites, because it is not where the
    resolver's `s.visible !== false` suggests. A list whose items omit the two booleans fails
    validation, so the resolver never honours it — it hands back the default four instead.
    That is the same answer by a different road, and it is the answer asserted here: a row
    that forgot to say `visible` does not produce a bar with things missing from it. The
    `!== false` in the resolver is belt to that braces, reachable only from a list that
    already validated, and it stays because the cost of being wrong is a missing button.
  */
  const terse = [{ key: 'home', sortOrder: 1 }, { key: 'darshan', sortOrder: 2 }];
  eq('a row that omits visible/enabled is refused by the validator', validateMobileNav(terse).ok, false);
  eq('...so the resolver falls back rather than guessing', keysOf(resolveMobileNavConfig(terse)), DEFAULT_KEYS);
  eq('...and nothing is switched off by absence', resolveMobileNavConfig(terse).every((i) => i.visible && i.enabled), true);
  eq('...and the bar is still four buttons wide', resolveMobileNav(terse).length, 4);
}

// ============================================================ 6 - home

/*
  §8 — the item no configuration may hide, refused three ways.

  Absent, `visible: false` and `enabled: false` are three different ways of taking the way
  back off the screen and they fail at three different places in the validator, so all three
  are asserted. `find(...)?.visible` alone would let the third through.

  And the resolver's answer matters as much as the validator's: a row that hides મુખપૃષ્ઠ
  did not come from the panel, so honouring the half of it that parses is exactly how a યુવક
  ends up in લેવલ ૪'s કસોટી with no way out. The whole list is thrown away for the default.
*/
group('acceptance 6 - home cannot accidentally disappear');
{
  const absent = stored('darshan', 'revision', 'profile');
  const invisible = stored(nav('home', { visible: false }), 'darshan', 'revision', 'profile');
  const off = stored(nav('home', { enabled: false }), 'darshan', 'revision', 'profile');

  eq('home absent is refused', validateMobileNav(absent).ok, false);
  eq('home visible: false is refused', validateMobileNav(invisible).ok, false);
  eq('home enabled: false is refused', validateMobileNav(off).ok, false);

  // The message has to name the item and the reason. A refusal that says only "invalid
  // configuration" is a refusal the next person works around.
  eq('the refusal names મુખપૃષ્ઠ', validateMobileNav(off).gu.includes('મુખપૃષ્ઠ'), true);

  for (const [what, row] of [['absent', absent], ['hidden', invisible], ['disabled', off]]) {
    eq(`home ${what}: the bar falls back to the default four`, keysOf(resolveMobileNav(row)), DEFAULT_KEYS);
    eq(`home ${what}: and the default contains home`, keysOf(resolveMobileNav(row)).includes('home'), true);
    eq(`home ${what}: home is on screen, not merely listed`, resolveMobileNav(row).some((i) => i.key === 'home' && i.visible && i.enabled), true);
  }

  // The bar is at most five wide, so a second protected item is a second thing the સંચાલક
  // cannot arrange. Exactly one, and the registry has to agree with the constant.
  eq('exactly one registry item is required', NAV_REGISTRY.filter((r) => r.required === true).map((r) => r.key), [NAV_REQUIRED_KEY]);
  eq('the resolver reports required, so the panel can grey the switch', resolveMobileNav(stored('home', 'darshan'))[0].required, true);
  eq('...and only for that one', resolveMobileNav(stored('home', 'darshan'))[1].required, false);
}

// ============================================================ 7 - refusals

/*
  Everything the validator refuses, and why refusing beats correcting.

  The resolver forgives because a stored row must always yield a bar. This refuses, because a
  સંચાલક who has just written a 13-character label should be told at the moment he presses
  Save rather than discover it by watching the preview quietly show him a different word.
  Same division of labour as validateLevels()/resolveLevels() beside it.
*/
group('acceptance 7 - an invalid configuration is rejected');
{
  const bad = (why, row) => eq(why, validateMobileNav(row).ok, false);

  // The two counts. Six is the measurement 320px produces (64px a cell at five, 53px at six,
  // which is under the 44px tap floor with the label already clipped); one is not navigation.
  bad('six visible items', stored('home', 'start', 'darshan', 'revision', 'level4', 'profile'));
  bad('one visible item', stored('home'));
  bad('no items at all', []);
  eq('...and the six-item message names the limit', validateMobileNav(stored('home', 'start', 'darshan', 'revision', 'level4', 'profile')).gu.includes(String(MOBILE_NAV_MAX)), true);
  eq('...and the one-item message names the floor', validateMobileNav(stored('home')).gu.includes(String(MOBILE_NAV_MIN)), true);

  // Five is legal - the bound is inclusive on both sides, and both are real settings rather
  // than edge cases to be nudged off.
  eq('five visible items is legal', validateMobileNav(stored('home', 'start', 'darshan', 'revision', 'profile')).ok, true);
  eq('two visible items is legal', validateMobileNav(stored('home', 'darshan')).ok, true);

  bad('a duplicate key', stored('home', 'darshan', 'darshan', 'profile'));
  bad('a key this app has never heard of', stored('home', 'darshan', 'quiz', 'profile'));
  bad('an entry that is not an object', [null, ...stored('home', 'darshan')]);
  bad('an entry that is a number', [3, ...stored('home', 'darshan')]);

  bad('a label of 13 characters', stored('home', nav('darshan', { label: 'ક'.repeat(NAV_LABEL_MAX + 1) })));
  bad('an empty label', stored('home', nav('darshan', { label: '' })));
  bad('a label that is only whitespace', stored('home', nav('darshan', { label: '   ' })));
  eq('a label of exactly 12 is legal', validateMobileNav(stored('home', nav('darshan', { label: 'ક'.repeat(NAV_LABEL_MAX) }))).ok, true);

  bad('an icon this app cannot draw', stored('home', nav('darshan', { icon: 'rocket' })));
  eq('an icon from the closed list is legal', validateMobileNav(stored('home', nav('darshan', { icon: 'star' }))).ok, true);

  bad('a route that disagrees with the registry', stored('home', nav('darshan', { route: '/somewhere-else' })));
  eq('the registry route may be written back', validateMobileNav(stored('home', nav('darshan', { route: '/darshan' }))).ok, true);

  bad('visible is not a boolean', stored('home', nav('darshan', { visible: 'yes' })));
  bad('enabled is not a boolean', stored('home', nav('darshan', { enabled: 1 })));
  bad('visible is null', stored('home', nav('darshan', { visible: null })));

  bad('sortOrder missing', [{ key: 'home', visible: true, enabled: true }, nav('darshan', { sortOrder: 2 })]);
  bad('sortOrder zero', [nav('home', { sortOrder: 0 }), nav('darshan', { sortOrder: 2 })]);
  bad('sortOrder negative', [nav('home', { sortOrder: -1 }), nav('darshan', { sortOrder: 2 })]);
  bad('sortOrder fractional', [nav('home', { sortOrder: 1.5 }), nav('darshan', { sortOrder: 2 })]);
  bad('sortOrder a numeric string', [nav('home', { sortOrder: '1' }), nav('darshan', { sortOrder: 2 })]);

  bad('not a list at all', 'nonsense');
  bad('null', null);
  bad('undefined', undefined);

  // Every refusal has to carry a sentence. A `{ ok: false }` with nothing on it is a Save
  // button that greys out for no stated reason.
  const refusals = [
    stored('home'),
    stored('home', 'start', 'darshan', 'revision', 'level4', 'profile'),
    stored('home', 'darshan', 'darshan'),
    stored('home', nav('darshan', { icon: 'rocket' })),
    stored('darshan', 'revision'),
    [],
  ];
  eq('every refusal explains itself', refusals.every((r) => typeof validateMobileNav(r).gu === 'string' && validateMobileNav(r).gu.length > 0), true);
}

// ============================================================ 8 - the fallback

/*
  §16 — the settings read failed, or the row is rubbish, and a bar still has to be drawn.

  This is the branch that runs on the worst day: Supabase unreachable, a half-written row, a
  migration mid-flight. There is no state in which this may return nothing, because the bar
  is the only chrome the app has on a phone.
*/
group('acceptance 8 - an API failure uses the safe fallback');
{
  const cases = [
    ['undefined - the read never resolved', undefined],
    ['null - the row exists with no value', null],
    ['[] - the row is an empty list', []],
    ["'nonsense' - a string where a list was expected", 'nonsense'],
    ['{} - an object where a list was expected', {}],
    ['[null, 3, "x"] - a list of things that are not items', [null, 3, 'x']],
    ['[{}] - a list of one item with no key', [{}]],
    ['a number', 42],
    ['a boolean', true],
  ];

  for (const [what, value] of cases) {
    eq(`${what}: the default four, in order`, keysOf(resolveMobileNav(value)), DEFAULT_KEYS);
    eq(`${what}: each carrying its registry route`, routesOf(resolveMobileNav(value)), DEFAULT_ROUTES);
  }

  eq('the fallback is never empty', resolveMobileNav(undefined).length >= MOBILE_NAV_MIN, true);
  eq('...and never wider than the bar allows', resolveMobileNav(undefined).length <= MOBILE_NAV_MAX, true);
  eq('the fallback is the same list the panel would save', keysOf(DEFAULT_MOBILE_NAV), DEFAULT_KEYS);
  eq('...and it is itself a legal configuration', validateMobileNav(DEFAULT_MOBILE_NAV).ok, true);
  eq('every fallback item is on screen', resolveMobileNav(undefined).every((i) => i.visible && i.enabled), true);
  eq('every fallback item has a word under it', resolveMobileNav(undefined).every((i) => typeof i.label === 'string' && i.label.length > 0), true);
  eq('every fallback item has an icon this app can draw', resolveMobileNav(undefined).every((i) => NAV_ICONS.includes(i.icon)), true);
}

// ============================================================ 9 - THE ROUTES

/*
  ────────────────────────────────────────────────────────────────────────────
  THE ONE THAT MATTERS MOST. A stored row may CHOOSE a destination; it may never
  NAME one.
  ────────────────────────────────────────────────────────────────────────────

  `settings` is writable through PostgREST by anyone `has_permission('settings.update')`
  admits, with no obligation to go anywhere near admin/src. If the stored `route` were
  honoured, one curl would put an arbitrary path — or an off-site URL, or a `javascript:`
  URL — under a button that 2,000 યુવકો press without reading the status bar. `/admin` is
  the quiet one of the three: it does not look like an attack, it looks like a typo, and it
  hands a yuvak a link to the panel from the bottom of every screen.

  So this is not tidiness and it is not defence in depth. It is the reason the registry
  exists at all, and it is asserted twice over: once on the path where the row is thrown away
  (a disagreeing route fails validation, so the default is returned), and once on the path
  where the row is HONOURED — a not-yet-ready item is dropped before validation, so the rest
  of the list stands, and the hostile route in the dropped item must not survive anywhere.

  If any assertion in this group ever fails, nothing else in this file matters.
*/
group('acceptance 9 - routes always come from the registry, never from the row');
{
  const HOSTILE = ['https://evil.example', '/admin', 'javascript:alert(1)', '//evil.example/x', '/admin/users'];

  for (const route of HOSTILE) {
    // (a) the route disagrees with the registry, so the whole list is refused and replaced.
    const row = stored('home', nav('darshan', { route }), 'revision', 'profile');
    eq(`refused outright: ${route}`, validateMobileNav(row).ok, false);
    eq(`never reaches the bar: ${route}`, routesOf(resolveMobileNav(row)).includes(route), false);
    eq(`never reaches the panel either: ${route}`, routesOf(resolveMobileNavConfig(row)).includes(route), false);

    // (b) the path where the list IS honoured: the hostile item names a key that is not
    // built yet, so it is dropped before validation and the other four stand. This is the
    // case a validator-only defence would miss entirely.
    const smuggled = [...stored('home', 'darshan', 'revision', 'profile'), { key: 'leaderboard', route, visible: true, enabled: true, sortOrder: 5 }];
    eq(`the honoured list is unaffected: ${route}`, keysOf(resolveMobileNav(smuggled)), DEFAULT_KEYS);
    eq(`and the smuggled route is nowhere in it: ${route}`, JSON.stringify(resolveMobileNav(smuggled)).includes(route), false);

    // (c) the panel's own save path must not write it back either.
    eq(`toStoredMobileNav rewrites it: ${route}`, toStoredMobileNav([nav('darshan', { route })])[0].route, '/darshan');
  }

  // The general statement, over every shape this file has built: whatever comes out, its
  // route is the registry's route for its own key. Not "a registry route" - THE one.
  const everything = [
    undefined, null, [], {}, 'nonsense', [null, 3, 'x'],
    stored('home', 'darshan'),
    stored('home', 'start', 'darshan', 'revision', 'level4'),
    stored('home', nav('darshan', { route: 'https://evil.example' })),
    [...stored('home', 'darshan', 'revision', 'profile'), { key: 'quiz', route: '/admin', visible: true, enabled: true, sortOrder: 5 }],
    stored('darshan', 'revision'),
  ];
  let mismatched = [];
  for (const row of everything) {
    for (const item of resolveMobileNavConfig(row)) {
      if (item.route !== navRegistryEntry(item.key).route) mismatched.push(`${item.key} -> ${item.route}`);
      if (!REGISTRY_ROUTES.has(item.route)) mismatched.push(`${item.key} -> off-registry ${item.route}`);
    }
  }
  eq('every resolved item carries its own registry route, always', mismatched, []);

  // A label and an icon are the સંચાલક's to choose; a route is not. Stated as an assertion so
  // the distinction cannot be quietly widened later.
  const dressed = stored('home', nav('darshan', { label: 'નવું', icon: 'star' }));
  eq('the label IS the row\'s to set', resolveMobileNav(dressed)[1].label, 'નવું');
  eq('the icon IS the row\'s to set', resolveMobileNav(dressed)[1].icon, 'star');
  eq('the route is NOT', resolveMobileNav(dressed)[1].route, '/darshan');
}

// ============================================================ 10 - not built yet

/*
  §4 — a future item may sit in the list; it may not stand in the bar.

  ક્રમાંક is the placeholder it was asked to be: points, gamification and the leaderboard are
  a separate piece of work and are not part of this one. `ready: false` is a fact about
  src/App.jsx, not an opinion anybody may hold, so it is checked against the registry and
  cannot be overridden by any row — which is what keeps the panel able to SHOW the line
  ("not built yet") without any save or any curl being able to turn it into a button that
  navigates nowhere.

  ────────────────────────────────────────────────────────────────────────────
  Why the list is derived and no longer written out
  ────────────────────────────────────────────────────────────────────────────

  This group used to iterate `['leaderboard', 'settings']`, because on the day it was written
  those were the two placeholders. સેટિંગ has since become a real screen — `/settings` is
  routed and the registry says `ready: true` — and a hard-coded list did not merely go stale,
  it threw: `validateMobileNav()` stopped refusing the item, so the refusal message this
  group reaches into was `undefined` and the whole suite died at this line, taking acceptances
  11 to 14 with it.

  That is the argument for deriving the list from the registry rather than restating it. The
  registry is the fact; a second copy of it in a test is a copy that goes wrong in exactly the
  way the test exists to catch, and goes wrong loudly at the worst moment — the commit that
  ships a feature. What is asserted instead is the RULE, over whatever is not ready today, and
  the two named entries below pin the two directions that actually matter.
*/
group('acceptance 10 - a not-yet-built item cannot be shown');
{
  const notReady = NAV_REGISTRY.filter((r) => !r.ready).map((r) => r.key);

  /*
    The registry has no placeholder left, and this is the moment the comment above predicted.

    ક્રમાંક was the last one, and it shipped: `/leaderboard` is routed, `public.leaderboard()`
    is behind it, and 0023 flipped the database's copy. સેટિંગ went the same way in 0020. So
    `notReady` is empty today, and the loop below has nothing to iterate.

    An empty loop that reports nothing is exactly the failure this group's own header warns
    about — a test passing in green while asserting nothing — so the emptiness is *skipped*
    rather than passed. `skip` is counted separately and printed loudly, which is the honest
    reading: the rule is still the rule, there is simply nothing in this build that exercises
    it. The moment anybody adds a placeholder to the registry it runs again, unchanged.

    What is NOT skipped is the rule itself against a key the registry has never heard of,
    below — an unknown key must still cost one button rather than the bar, and that half can
    be exercised without a placeholder to point at.
  */
  if (!notReady.length) {
    skip('a not-yet-built item cannot be shown', 'every registry entry is built in this app today');
  }
  // Both directions, named rather than merely counted, so a migration or an edit that
  // quietly reverted either one is a failure with a name on it rather than a line in a list.
  eq('સેટિંગ is built (0020)', notReady.includes('settings'), false);
  eq('ક્રમાંક is built (0023)', notReady.includes('leaderboard'), false);

  for (const key of notReady) {
    const reg = navRegistryEntry(key);
    eq(`${key} is in the registry`, !!reg, true);
    eq(`${key} is marked not ready`, reg.ready, false);

    const row = [...stored('home', 'darshan', 'revision', 'profile'), { key, visible: true, enabled: true, sortOrder: 5 }];
    eq(`${key} is dropped by the resolver`, keysOf(resolveMobileNav(row)).includes(key), false);
    eq(`${key} is not offered to the panel either`, keysOf(resolveMobileNavConfig(row)).includes(key), false);
    eq(`${key} is refused by the validator`, validateMobileNav([...stored('home', 'darshan'), { key, visible: true, enabled: true, sortOrder: 3 }]).ok, false);
    eq(`...and the refusal says it is not built`, validateMobileNav([...stored('home', 'darshan'), { key, visible: true, enabled: true, sortOrder: 3 }]).gu.includes(reg.label), true);

    // Listed-but-off is the state the panel shows. It must be legal, or the panel cannot
    // display the row it exists to explain.
    eq(`${key} may sit in the list switched off`, validateMobileNav([...stored('home', 'darshan'), { key, visible: false, enabled: false, sortOrder: 3 }]).ok, true);
  }

  /*
    The mirror of the same rule, and the half that had nothing asserting it.

    `ready: true` has to mean the item is SHOWABLE, or the flag has stopped saying "this app
    has the screen" and become a second switch that no panel exposes and no message explains.
    સેટિંગ is the entry that just crossed that line, so it is the one this is written against:
    the સંચાલક still decides whether it stands in the bar, and this asserts that he now can.
  */
  {
    const row = [...stored('home', 'darshan', 'revision'), { key: 'settings', visible: true, enabled: true, sortOrder: 4 }];
    eq('a ready item is accepted by the validator', validateMobileNav(row).ok, true);
    eq('...and reaches the bar', keysOf(resolveMobileNav(row)).includes('settings'), true);
    eq('...carrying the registry route, not the row\'s', resolveMobileNav(row).find((i) => i.key === 'settings').route, '/settings');
    // …and it is still not in the default four. `ready` is not "show it": સેટિંગ is reached
    // from મારું, which is where a યુવક looks for it, and no flag flip may change that.
    eq('...while the default bar is unchanged', keysOf(DEFAULT_MOBILE_NAV), DEFAULT_KEYS);
  }

  /*
    The same three rows that used to prove ક્રમાંક was unshippable, now proving the opposite.

    This assertion has been inverted rather than deleted, and deliberately. What it was really
    testing was never "the leaderboard is off" — it was that `ready` decides, and that a row
    cannot argue with it. That is still exactly what is being checked; the flag moved, so the
    expected answer moved with it, and the third row still carries a `route` of its own to
    prove the registry's route wins over anything stored (the rule this whole file is about).

    Deleting it instead would have removed the only assertion covering a `ready: true` entry
    arriving from a stored row with a route attached, at the moment that path became live.
  */
  eq('a built item can now be shipped by configuration', ['leaderboard'].every((k) =>
    [
      [...stored('home', 'darshan'), { key: k, visible: true, enabled: true, sortOrder: 3 }],
      [...stored('home'), { key: k, visible: true, enabled: true, sortOrder: 2 }],
      // Naming the route it actually has is allowed; naming a different one is not, which is
      // the pair asserted just below.
      [...stored('home'), { key: k, visible: true, enabled: true, sortOrder: 2, route: '/leaderboard' }],
    ].every((row) => keysOf(resolveMobileNav(row)).includes(k))
  ), true);

  /*
    The original list carried a fourth row — ક્રમાંક alone, with no મુખપૃષ્ઠ — and it is
    deliberately not here.

    While the item was `ready: false` that row proved nothing about readiness: it was refused
    twice over, once for the flag and once because a bar of one item that is not મુખપૃષ્ઠ
    breaks both MOBILE_NAV_MIN and §8's required key. Inverting it would have asserted that a
    built item ships from a configuration that is invalid for two unrelated reasons, which is
    false and should be. The rule it was really covering is asserted where it belongs, in
    acceptance 7.
  */

  /*
    …and the rule the file header is really about, now that ક્રમાંક is a live destination.

    A row may say WHICH destination it wants; it may not say where that destination goes. A
    stored row naming a different page is not honoured-with-the-right-route, it is **refused
    outright** — and because a single bad entry invalidates the whole configuration, the bar
    falls back to the default four rather than shipping a half-trusted list. That is the
    stricter of the two possible readings and it is the one implemented, which is worth an
    assertion of its own now that there is a real page behind the key to point away from.
  */
  {
    const hijacked = [...stored('home'), { key: 'leaderboard', visible: true, enabled: true, sortOrder: 2, route: '/somewhere-else' }];
    eq('a row may not point ક્રમાંક at another page', validateMobileNav(hijacked).ok, false);
    eq('...and the refusal names the item', validateMobileNav(hijacked).gu.includes('ક્રમાંક'), true);
    eq('...so the whole row falls back to the default bar', keysOf(resolveMobileNav(hijacked)), DEFAULT_KEYS);
  }

  // The default bar is unchanged by any of this. `ready` has never meant "show it".
  eq('the default bar is still the four', keysOf(DEFAULT_MOBILE_NAV), DEFAULT_KEYS);
}

// ============================================================ 11 - unknown keys

/*
  §16, the other half — a row saved by a LATER build may name a destination this build has
  never heard of. That must cost one button, not the bar.

  The alternative — treating an unknown key as damage and falling back — would mean that the
  first phone to miss an update loses its whole configuration the day a new item ships. So
  unknown keys and not-ready keys are both dropped BEFORE validation: neither is damage, both
  are ordinary version skew.
*/
group('acceptance 11 - an unknown key costs one button, not the bar');
{
  const row = [...DEFAULT_MOBILE_NAV, { key: 'quiz', visible: true, enabled: true, sortOrder: 5 }];
  eq('the four that are known still stand', keysOf(resolveMobileNav(row)), DEFAULT_KEYS);
  eq('the unknown one is simply not there', keysOf(resolveMobileNav(row)).includes('quiz'), false);
  eq('the panel does not offer it either', keysOf(resolveMobileNavConfig(row)).includes('quiz'), false);
  eq('the order of the known four is untouched', routesOf(resolveMobileNav(row)), DEFAULT_ROUTES);

  // Two unknowns, one in the middle, and the order still holds around the gap.
  const gappy = [
    nav('home', { sortOrder: 1 }),
    { key: 'quiz', visible: true, enabled: true, sortOrder: 2 },
    nav('darshan', { sortOrder: 3 }),
    { key: 'chat', visible: true, enabled: true, sortOrder: 4 },
    nav('profile', { sortOrder: 5 }),
  ];
  eq('unknowns in the middle leave the order alone', keysOf(resolveMobileNav(gappy)), ['home', 'darshan', 'profile']);

  // But a list of NOTHING but unknowns is not a configuration this build can honour, so it
  // falls back rather than rendering an empty strip.
  eq('a list of only unknown keys falls back', keysOf(resolveMobileNav([{ key: 'quiz', visible: true, enabled: true, sortOrder: 1 }])), DEFAULT_KEYS);
}

// ============================================================ 12 - registry integrity

/*
  The registry is a hand-maintained table and every field in it is load-bearing. These are
  the invariants that no reviewer will re-check on the day a tenth row is added.
*/
group('acceptance 12 - registry integrity');
{
  const keys = NAV_REGISTRY.map((r) => r.key);
  const routes = NAV_REGISTRY.map((r) => r.route);

  eq('every key is unique', keys.length, new Set(keys).size);
  // Two keys at one route would be two buttons that land in the same place - a સંચાલક who
  // hid one and showed the other would have changed nothing while believing he had.
  eq('every route is unique', routes.length, new Set(routes).size);
  eq('every route is an absolute app path', routes.every((r) => r.startsWith('/') && !r.startsWith('//')), true);
  eq('no route points at the panel', routes.some((r) => r.startsWith('/admin')), false);

  eq('every default icon is one this app can draw', NAV_REGISTRY.every((r) => NAV_ICONS.includes(r.icon)), true);
  eq('every default label fits under an icon', NAV_REGISTRY.every((r) => r.label.length <= NAV_LABEL_MAX), true);
  eq('every default label is non-empty', NAV_REGISTRY.every((r) => r.label.trim().length > 0), true);
  eq('every entry declares whether it is built', NAV_REGISTRY.every((r) => typeof r.ready === 'boolean'), true);

  eq('exactly one entry is required', NAV_REGISTRY.filter((r) => r.required === true).length, 1);
  eq('...and it is NAV_REQUIRED_KEY', NAV_REGISTRY.find((r) => r.required === true).key, NAV_REQUIRED_KEY);
  eq('...and it is built', navRegistryEntry(NAV_REQUIRED_KEY).ready, true);

  eq('the icon list is closed and non-empty', NAV_ICONS.length > 0 && Object.isFrozen(NAV_ICONS), true);
  eq('no icon name is repeated', NAV_ICONS.length, new Set(NAV_ICONS).size);
  eq('the registry is frozen', Object.isFrozen(NAV_REGISTRY), true);

  eq('the default bar is between the two bounds', DEFAULT_MOBILE_NAV.length >= MOBILE_NAV_MIN && DEFAULT_MOBILE_NAV.length <= MOBILE_NAV_MAX, true);
  eq('the default bar validates', validateMobileNav(DEFAULT_MOBILE_NAV).ok, true);
  eq('the default bar contains the required item', keysOf(DEFAULT_MOBILE_NAV).includes(NAV_REQUIRED_KEY), true);
  eq('every default item names a real registry key', DEFAULT_MOBILE_NAV.every((i) => !!navRegistryEntry(i.key)), true);
  eq('every default item is built', DEFAULT_MOBILE_NAV.every((i) => navRegistryEntry(i.key).ready), true);
  eq('the bounds are the numbers the bar was measured against', [MOBILE_NAV_MIN, MOBILE_NAV_MAX, NAV_LABEL_MAX], [2, 5, 12]);
}

// ============================================================ 13 - the router

/*
  ────────────────────────────────────────────────────────────────────────────
  The registry against the router it claims to describe
  ────────────────────────────────────────────────────────────────────────────

  `ready: true` is a statement about src/App.jsx: this build routes that path. Nothing in
  the module can check it, because the module must not import the router — so it is checked
  here, by reading App.jsx as text. scripts/test-domain.mjs already reads a fixture off disk
  for the same reason: some facts are only true about files.

  This is the check that catches a registry entry pointing at a route somebody deleted, and
  the reverse — a page that shipped while the registry still calls it "not built yet", which
  would leave the સંચાલક looking at a row that says come back later about a page that exists.
*/
group('acceptance 13 - every registry route exists in src/App.jsx');
{
  const APP = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const routed = new Set([...APP.matchAll(/<Route\s[^>]*path="([^"]+)"/g)].map((m) => m[1]));

  eq('the router was parsed at all', routed.size > 0, true);

  const ready = NAV_REGISTRY.filter((r) => r.ready);
  const missing = ready.filter((r) => !routed.has(r.route)).map((r) => `${r.key} -> ${r.route}`);
  eq('every ready registry route is routed', missing, []);

  // The other direction. A `ready: false` entry whose route HAS appeared in the router is
  // drift in the safe-looking direction: nothing breaks, the item is simply unreachable from
  // the bar for no reason anybody wrote down.
  const shipped = NAV_REGISTRY.filter((r) => !r.ready && routed.has(r.route)).map((r) => `${r.key} -> ${r.route}`);
  eq('no not-ready route has quietly shipped', shipped, []);
}

// ============================================================ 14 - the SQL

/*
  ────────────────────────────────────────────────────────────────────────────
  Drift, the registry against the database
  ────────────────────────────────────────────────────────────────────────────

  The rules live twice: once here, where the panel and the app read them, and once in a
  BEFORE trigger, which is the only one of the two that a curl cannot go around. That is the
  same arrangement `shared/domain/permissions.js` describes for the permission matrix — and
  the same file records that nothing checks ITS two copies for drift, and that changing one
  means changing the other by hand. This group is that check, for this list.

  ────────────────────────────────────────────────────────────────────────────
  Two files, and the difference between them is the whole point of this group
  ────────────────────────────────────────────────────────────────────────────

  This used to read `0019_mobile_navigation.sql` and nothing else, which was right on the day
  it was written and became wrong the moment `nav_registry()` was redefined by a later
  migration. `0020_nav_settings_ready.sql` is exactly that: it flips the `settings` row from
  `ready = false` to `ready = true`, because `/settings` is now a route src/App.jsx serves and
  the JS registry moved with it.

  A test pinned to 0019 would have gone on passing against a function the database has not
  run since — asserting the truth of a state that exists nowhere, which is a test doing worse
  than nothing because it also reports that it checked. So the registry checks read the
  **latest** migration that defines `nav_registry()`, found by scanning the directory, and the
  bounds and trigger checks stay on 0019, which is where the trigger and the CHECK numbers
  actually live and where they have not moved.

  ────────────────────────────────────────────────────────────────────────────
  What the `ready` check is protecting against
  ────────────────────────────────────────────────────────────────────────────

  `ready` decides whether a configuration may put an item in a યુવક's bar, and it is enforced
  on both sides: `validateMobileNav()` here, `nav_config_error()` there. Two copies of one
  boolean that disagree produce a specific, miserable failure — the panel offers a checkbox,
  the સંચાલક ticks it, and the database refuses the save with an error about an item the
  screen has just told him is available. Nothing asserted that until now, which is precisely
  the blind spot 0020 walked into: one file changed, and nothing would have noticed if the
  other had not.

  A substring test rather than a parse, for the keys, the icons and the bounds: the point is
  to notice a name that exists on one side and not the other, and a SQL parser would be a
  second thing to maintain for no more information than `includes()` already gives. The
  `ready` flags need slightly more than a substring — they need to be read off a particular
  row — so the row is found by its quoted key and the booleans are read off that one line.
  That is still not a parser and is deliberately not one: the `values` list is eight lines of
  literals with a fixed column order, and anything that made it complicated enough to need
  parsing would be a change this test should be failing on anyway.
*/
group('acceptance 14 - drift, the registry against the database trigger');
{
  const MIGRATIONS = new URL('../supabase/migrations/', import.meta.url);
  const DEFINES = 'create or replace function public.nav_registry';

  /*
    The latest definition wins, and "latest" is the highest-numbered file rather than the most
    recently modified one: mtime is a fact about this checkout, not about the database, and a
    fresh clone would order them by whatever the filesystem felt like. The names are
    zero-padded four-digit prefixes, so a plain sort is the migration order.
  */
  const files = existsSync(fileURLToPath(MIGRATIONS))
    ? readdirSync(fileURLToPath(MIGRATIONS)).filter((f) => f.endsWith('.sql')).sort()
    : [];
  const defining = files.filter((f) => readFileSync(new URL(f, MIGRATIONS), 'utf8').includes(DEFINES));
  const latest = defining[defining.length - 1] || null;

  // ---- the keys, the icons and the ready flags, against the latest definition ----
  if (!latest) {
    skip('registry vs the latest nav_registry() migration', 'no migration defines nav_registry() yet - re-run once one lands');
  } else {
    const sql = readFileSync(new URL(latest, MIGRATIONS), 'utf8');
    console.log(`    nav_registry() last defined in ${latest}`);

    const missingKeys = NAV_REGISTRY.map((r) => r.key).filter((k) => !sql.includes(k));
    eq('every registry key is named in the latest definition', missingKeys, []);

    /*
      Only the function body, so that a key mentioned in the file's header prose cannot stand
      in for a key mentioned in the table. 0020's header talks about `settings` and about
      `leaderboard` at length while defining rows for both — a search over the whole file
      would find those sentences and be satisfied by them.
    */
    const start = sql.indexOf(DEFINES);
    const body = sql.slice(start, sql.indexOf('$$;', start));
    const rows = body
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('('));

    eq('the values list was found, and has a row per registry entry', rows.length, NAV_REGISTRY.length);

    const drift = [];
    for (const reg of NAV_REGISTRY) {
      // The row is the one that names this key in quotes. `'profile'` cannot match `'/profile'`
      // — the quote has to sit immediately against the word — and the icon repeat on the
      // `home` row is on that same line anyway, so one line is one entry.
      const row = rows.find((l) => l.includes(`'${reg.key}'`));
      if (!row) {
        drift.push(`${reg.key} has no row in ${latest}`);
        continue;
      }
      // Column order is (key, route, label, icon, ready, required) and the only booleans on
      // the line are the last two, in that order.
      const booleans = row.match(/\b(true|false)\b/g) || [];
      if (booleans.length !== 2) {
        drift.push(`${reg.key}: expected two booleans on its row, found ${booleans.length}`);
        continue;
      }
      const [sqlReady, sqlRequired] = booleans.map((b) => b === 'true');
      if (sqlReady !== reg.ready) drift.push(`${reg.key}: ready is ${reg.ready} here and ${sqlReady} in ${latest}`);
      if (sqlRequired !== (reg.required === true)) {
        drift.push(`${reg.key}: required is ${reg.required === true} here and ${sqlRequired} in ${latest}`);
      }
      // The route is the field the whole file header is about, so it is compared too — a
      // registry and a database pointing one key at two different pages is the same class of
      // fault as a ready flag that disagrees, and costs one more `includes()` to notice.
      if (!row.includes(`'${reg.route}'`)) drift.push(`${reg.key}: route ${reg.route} is not on its row in ${latest}`);
    }
    eq('every registry entry agrees with the latest SQL row, ready flags included', drift, []);

    // Stated separately as the fact 0020 exists for, so a revert of that migration alone is a
    // named failure rather than a line in a list.
    eq('સેટિંગ is ready on both sides', [
      navRegistryEntry('settings').ready,
      /\('settings'[^)]*\btrue\b/.test(body),
    ], [true, true]);
    // …and the same for 0023, which did for ક્રમાંક what 0020 did for સેટિંગ. Named
    // separately for the same reason: a revert of that one migration is a failure with its
    // own sentence rather than an entry in the drift list above.
    eq('ક્રમાંક is ready on both sides', [
      navRegistryEntry('leaderboard').ready,
      /\('leaderboard'[^)]*\btrue\b/.test(body),
    ], [true, true]);
  }

  /*
    ---- the icons, against the latest definition of nav_icons() ----

    Read from the latest migration that DEFINES `nav_icons()`, for exactly the reason the
    registry checks above are read from the latest definition of `nav_registry()`: this list
    grew in 0028 when custom buttons arrived, and a check pinned to 0019 would go on asserting
    the truth of a function the database has not run since — a test doing worse than nothing,
    because it also reports that it checked.

    That is not hypothetical here. Pinning this to 0019 is precisely what failed the moment
    NAV_ICONS gained `chart`, and the failure was the useful kind: it named the four icons the
    migration had not yet been written for.
  */
  const ICON_DEFINES = 'create or replace function public.nav_icons';
  const iconFiles = files.filter((f) =>
    readFileSync(new URL(f, MIGRATIONS), 'utf8').includes(ICON_DEFINES)
  );
  const latestIcons = iconFiles[iconFiles.length - 1] || null;

  if (!latestIcons) {
    skip('icons vs the latest nav_icons() migration', 'no migration defines nav_icons() yet');
  } else {
    const sql = readFileSync(new URL(latestIcons, MIGRATIONS), 'utf8');
    console.log(`    nav_icons() last defined in ${latestIcons}`);
    // The function body only, so a name mentioned in the file's header prose cannot stand in
    // for a name in the array — 0028's header discusses the four new icons at length.
    const start = sql.indexOf(ICON_DEFINES);
    const body = sql.slice(start, sql.indexOf('$$;', start));
    const missingIcons = NAV_ICONS.filter((i) => !body.includes(`'${i}'`));
    eq('every icon name is named in the latest nav_icons() definition', missingIcons, []);
    // The other direction: a name the database admits and this build cannot draw is an icon
    // the panel would refuse and a curl could set, which resolves to the registry's picture
    // rather than to the one that was asked for.
    const quoted = [...body.matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
    const extraIcons = quoted.filter((n) => !NAV_ICONS.includes(n));
    eq('the database admits no icon this build has never heard of', extraIcons, []);
  }

  // ---- the trigger and the bounds, which live in 0019 and have not moved ----
  const SQL_0019 = new URL('../supabase/migrations/0019_mobile_navigation.sql', import.meta.url);
  if (!existsSync(fileURLToPath(SQL_0019))) {
    skip('bounds vs 0019_mobile_navigation.sql', 'the migration does not exist yet - re-run once it lands');
  } else {
    const sql = readFileSync(SQL_0019, 'utf8');

    eq('the migration names the settings key it guards', sql.includes(MOBILE_BOTTOM_KEY), true);
    eq('the migration names the item that cannot be hidden', sql.includes(NAV_REQUIRED_KEY), true);
    // The two counts and the label cap are numbers, and a number that disagrees between the
    // trigger and this module is a Save the panel accepts and the database refuses.
    eq('the migration carries the same bounds', [String(MOBILE_NAV_MIN), String(MOBILE_NAV_MAX), String(NAV_LABEL_MAX)].every((n) => sql.includes(n)), true);
  }
}

// ============================================================ 15 - the destination table

/*
  ────────────────────────────────────────────────────────────────────────────
  NAV_ROUTES against the router it claims to describe
  ────────────────────────────────────────────────────────────────────────────

  Acceptance 13 does this for NAV_REGISTRY and this is the same check for the list a CUSTOM
  button chooses from — and it matters more here, not less. A registry entry has a `ready`
  flag, so a route the router does not serve can at least be marked unavailable and sit in the
  panel as a future item. NAV_ROUTES has no such flag by design: every row in it is offered to
  the સંચાલક as a page he may point a button at, today. A route in this table that src/App.jsx
  does not serve is therefore not a mislabelled row, it is a button that navigates to the
  catch-all and lands the યુવક back on the મુખપૃષ્ઠ with no explanation.

  The reverse direction is deliberately NOT asserted. A route the app serves and this table
  omits is a perfectly good decision - /login, /register and the two password screens are
  routed and must never be bar destinations, and /level/4/:activityId is a parameterised path
  that cannot be one. Which routes are offered is a judgement; that the offered ones exist is a
  fact, and only the fact is checkable here.
*/
group('acceptance 15 - every destination exists in src/App.jsx');
{
  const APP = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const routed = new Set([...APP.matchAll(/<Route\s[^>]*path="([^"]+)"/g)].map((m) => m[1]));

  eq('the router was parsed at all', routed.size > 0, true);

  const missing = NAV_ROUTES.filter((r) => !routed.has(r.route)).map((r) => r.route);
  eq('every destination is a path src/App.jsx routes', missing, []);

  /*
    Every built-in that is ready must also be in the table, and this is not redundancy with
    acceptance 13. It is what makes Duplicate work on a built-in: duplicateNavItem() turns any
    row into a CUSTOM one, and a custom item's route has to resolve through NAV_ROUTES. A ready
    registry entry whose route is missing here would give the સંચાલક a Duplicate button that
    silently produces nothing.
  */
  const unreachable = NAV_REGISTRY.filter((r) => r.ready && !navRouteEntry(r.route)).map((r) => r.key);
  eq('every ready built-in destination can also be reached by a custom button', unreachable, []);

  // A table with a route in it twice is a <select> with two identical options, and a lookup
  // whose answer depends on which one Map.set() saw last.
  eq('no destination is listed twice', NAV_ROUTES.length, new Set(NAV_ROUTES.map((r) => r.route)).size);

  const badIcon = NAV_ROUTES.filter((r) => !NAV_ICONS.includes(r.icon)).map((r) => r.route);
  eq('every destination falls back to an icon this app can draw', badIcon, []);

  const badLabel = NAV_ROUTES.filter(
    (r) => typeof r.label !== 'string' || !r.label.trim() || r.label.length > NAV_LABEL_MAX
  ).map((r) => r.route);
  eq('every destination falls back to a label that fits under an icon', badLabel, []);

  // The normaliser, which is the one piece of string handling between what a route is written
  // as and what it is looked up as. `//x` is the case worth naming: repairing it into `/`
  // would turn a protocol-relative URL into a legal path.
  eq('a trailing slash is not a different page', normalizeNavRoute('/learn/'), '/learn');
  eq('the root keeps its slash', normalizeNavRoute('/'), '/');
  eq('surrounding whitespace is typing, not meaning', normalizeNavRoute('  /learn  '), '/learn');
  eq('a protocol-relative URL is NOT repaired into a path', normalizeNavRoute('//evil.example'), '//evil.example');
  eq('a trailing slash still finds the page', navRouteEntry('/learn/')?.route, '/learn');
}

// ============================================================ 16 - custom buttons

/*
  ────────────────────────────────────────────────────────────────────────────
  The સંચાલક's own buttons
  ────────────────────────────────────────────────────────────────────────────

  The feature this file grew for. Everything above proves the nine built-ins behave; this
  proves the tenth kind of item behaves, and — the half that actually matters — that the one
  new field which decides a destination cannot be made to decide a bad one.

  The security assertions are the ones to read first. A custom item is the only place in this
  system where a stored value influences where a button goes, so `route` is now the field the
  file header's rule is about, and it is asserted from three directions: the resolver drops
  what it cannot look up, the validator refuses it, and what comes out of the resolver is
  identity-equal to a frozen object from NAV_ROUTES rather than merely string-equal to it.
  The last of those is the one a future refactor would break silently.
*/
group('acceptance 16 - custom buttons');
{
  /** One custom item in the shape the panel writes. */
  const cust = (n, over = {}) => ({
    key: `${NAV_CUSTOM_PREFIX}btn-${n}`,
    label: 'યાત્રા',
    icon: 'book',
    route: '/learn',
    visible: true,
    enabled: true,
    ...over,
  });

  /** Two built-ins that satisfy the floor and §8, plus whatever is being tested. */
  const withHome = (...extra) => stored(nav('home'), nav('darshan'), ...extra);

  // ---- 2. create ----------------------------------------------------------
  const made = newCustomItem({ route: '/learn', label: 'યાત્રા', icon: 'book' }, ['custom:btn-1']);
  eq('a new custom button takes the first free key', made.key, 'custom:btn-2');
  eq('it knows which kind it is without being told', [made.isCustom, made.type], [true, 'custom']);
  /*
    Created switched off, and asserted rather than left to the panel. A visible new button is
    an immediate sixth cell in a five-cell bar, so the whole list would be refused for a
    reason the સંચાલક did not choose - and the refusal would name the ceiling rather than the
    button he just made.
  */
  eq('it is created hidden so it cannot break the bar it joins', [made.visible, made.enabled], [false, true]);
  eq('a custom button cannot be created on a page this app has no route for',
    newCustomItem({ route: '/nope', label: 'x', icon: 'book' }), null);
  eq('nor on an off-site URL',
    newCustomItem({ route: 'https://evil.example', label: 'x', icon: 'book' }), null);
  eq('the key counter stops at the ceiling',
    makeCustomKey(Array.from({ length: NAV_CUSTOM_MAX }, (_, i) => `custom:btn-${i + 1}`)), null);

  // ---- the happy path resolves ---------------------------------------------
  const good = withHome(cust(1));
  eq('a custom button is valid alongside built-ins', validateMobileNav(good).ok, true);
  eq('and it stands in the bar', keysOf(resolveMobileNav(good)), ['home', 'darshan', 'custom:btn-1']);
  eq('carrying the destination table\'s route', routesOf(resolveMobileNav(good)), ['/', '/darshan', '/learn']);
  eq('and the સંચાલક\'s own word', resolveMobileNav(good)[2].label, 'યાત્રા');
  eq('a built-in beside it is still a built-in', resolveMobileNav(good).map((i) => i.type),
    ['builtin', 'builtin', 'custom']);

  // ---- 3. edit -------------------------------------------------------------
  const edited = withHome(cust(1, { label: 'મારો ઇતિહાસ', icon: 'star', route: '/history' }));
  eq('editing a custom button changes its word, picture and page',
    [resolveMobileNav(edited)[2].label, resolveMobileNav(edited)[2].icon, resolveMobileNav(edited)[2].route],
    ['મારો ઇતિહાસ', 'star', '/history']);
  eq('and the edit is valid', validateMobileNav(edited).ok, true);

  // ---- 4. delete -----------------------------------------------------------
  /*
    Deleting is the ABSENCE of a row and nothing else - there is no tombstone and no deleted
    flag. That is the whole assertion: a list without the item resolves to a bar without the
    button, and nothing anywhere resurrects it. The page it opened is untouched by definition,
    because no part of this system has ever written a page.
  */
  const afterDelete = withHome();
  eq('a deleted custom button leaves no trace in the bar', keysOf(resolveMobileNav(afterDelete)), ['home', 'darshan']);
  eq('and the destination it used is still a page this app serves', navRouteEntry('/learn')?.route, '/learn');

  // ---- 5. duplicate --------------------------------------------------------
  const copy = duplicateNavItem(cust(1), ['custom:btn-1']);
  eq('a copy gets a new identity, never the original\'s', copy.key !== 'custom:btn-1', true);
  eq('the copy is a custom item', copy.isCustom, true);
  eq('it points at the same page', copy.route, '/learn');
  eq('and arrives switched off', copy.visible, false);
  /*
    Copying a BUILT-IN is the useful half, and the reason duplicateNavItem() is not restricted
    to custom rows: "the same page, under a second word, further along the bar" is a thing only
    a custom item can express, because a built-in's key IS its destination and there is exactly
    one of it.
  */
  const copiedBuiltin = duplicateNavItem(navRegistryEntry('darshan'), ['custom:btn-1']);
  eq('a built-in can be copied into a custom button', [copiedBuiltin.key, copiedBuiltin.route],
    ['custom:btn-2', '/darshan']);
  eq('the copy of a built-in is not itself a built-in', copiedBuiltin.isCustom, true);
  eq('there is no room for a copy at the ceiling',
    duplicateNavItem(cust(1), Array.from({ length: NAV_CUSTOM_MAX }, (_, i) => `custom:btn-${i + 1}`)), null);

  // ---- 6. reorder ----------------------------------------------------------
  const mixed = [nav('home'), cust(1), nav('darshan')];
  eq('a custom button moves like any other row', reorder(mixed, 1, 2).map((i) => i.key),
    ['home', 'darshan', 'custom:btn-1']);
  eq('and the saved order is the order that resolves',
    keysOf(resolveMobileNav(toStoredMobileNav(reorder(mixed, 1, 2)))),
    ['home', 'darshan', 'custom:btn-1']);
  eq('a custom button can be moved to the front, behind home\'s position only by order',
    keysOf(resolveMobileNav(toStoredMobileNav(reorder([nav('home'), nav('darshan'), cust(1)], 2, 0)))),
    ['custom:btn-1', 'home', 'darshan']);

  // ---- 7 & 8. hidden and disabled ------------------------------------------
  const hidden = withHome(cust(1, { visible: false }));
  eq('a hidden custom button is not in the bar', keysOf(resolveMobileNav(hidden)), ['home', 'darshan']);
  eq('but it is still in the configuration', keysOf(resolveMobileNavConfig(hidden)),
    ['home', 'darshan', 'custom:btn-1']);
  const disabled = withHome(cust(1, { enabled: false }));
  eq('a disabled custom button is not in the bar', keysOf(resolveMobileNav(disabled)), ['home', 'darshan']);
  eq('and it too is remembered', keysOf(resolveMobileNavConfig(disabled)), ['home', 'darshan', 'custom:btn-1']);
  eq('hiding one is a valid configuration', validateMobileNav(hidden).ok, true);

  // ---- 9-12. the routes that must be refused --------------------------------
  /*
    ────────────────────────────────────────────────────────────────────────────
    THE GROUP THAT MATTERS
    ────────────────────────────────────────────────────────────────────────────

    `settings` is writable through PostgREST by anyone `has_permission('settings.update')`
    admits, with no obligation to go anywhere near admin/src. Every string below is therefore
    something that CAN arrive in the row, and each is asserted twice: refused on the way in,
    and dropped on the way out. Either alone would be a hole - the first because a row written
    before this build existed was never offered to the validator, the second because a stored
    row that looks authoritative in psql is a trap for the next person to read it.
  */
  const BAD_ROUTES = [
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'https://evil.example/steal',
    'http://evil.example',
    '//evil.example',
    'mailto:someone@example.com',
    '/admin',
    '/admin/users',
    '/leaderbord',
    '/learn?next=https://evil.example',
    '/learn#/../admin',
    'learn',
    '',
    '   ',
  ];
  const rejected = BAD_ROUTES.filter((r) => navRouteError(r) === null);
  eq('every dangerous or unknown route is named as a problem', rejected, []);

  const accepted = BAD_ROUTES.filter((r) => validateMobileNav(withHome(cust(1, { route: r }))).ok);
  eq('and none of them can be saved', accepted, []);

  const rendered = BAD_ROUTES.filter((r) =>
    keysOf(resolveMobileNav(withHome(cust(1, { route: r })))).includes('custom:btn-1')
  );
  eq('and none of them can be rendered', rendered, []);

  eq('a bad custom route costs one button, not the bar',
    keysOf(resolveMobileNav(withHome(cust(1, { route: 'https://evil.example' })))), ['home', 'darshan']);

  // The messages are distinct, because "this app has no page at https://evil.example" is true
  // and useless: a સંચાલક who pasted a link has made a specific mistake and should be told
  // which one it was.
  eq('an off-site URL is named as an off-site URL',
    /link to somewhere outside this app/.test(navRouteError('https://evil.example')), true);
  eq('a javascript: URL is named as one too',
    /link to somewhere outside this app/.test(navRouteError('javascript:alert(1)')), true);
  eq('a protocol-relative URL is named as another site',
    /link to another site/.test(navRouteError('//evil.example')), true);
  eq('an unrouted path is named as a page that does not exist yet',
    /has no page at/.test(navRouteError('/leaderbord')), true);

  /*
    Identity, not equality. `===` against the frozen NAV_ROUTES object proves the resolved
    route came OUT of the table rather than being a string that happens to match one - which
    is the difference a future refactor would erase silently. The whole file header is one
    sentence about this line.
  */
  const resolvedRoute = resolveMobileNav(withHome(cust(1)))[2].route;
  eq('the resolved route is the frozen table\'s own value',
    resolvedRoute === NAV_ROUTES.find((r) => r.route === '/learn').route, true);
  const allResolved = resolveMobileNav(withHome(cust(1), cust(2, { route: '/history', label: 'પ્રગતિ' })));
  const legalRoutes = new Set([...NAV_ROUTES.map((r) => r.route), ...NAV_REGISTRY.map((r) => r.route)]);
  eq('nothing resolvable carries a route from outside code', allResolved.filter((i) => !legalRoutes.has(i.route)), []);

  // A built-in still cannot be re-pointed, and the custom mechanism did not open a back door
  // into doing so: `route` on a built-in row is ignored by the resolver and refused by the
  // validator, exactly as before custom items existed.
  eq('a built-in row carrying a custom destination is still refused',
    validateMobileNav(stored(nav('home', { route: '/learn' }), nav('darshan'))).ok, false);
  eq('and still resolves to its own page',
    routesOf(resolveMobileNav(stored(nav('home', { route: '/learn' }), nav('darshan')))),
    DEFAULT_ROUTES);

  // ---- 13. icons -----------------------------------------------------------
  eq('a custom button cannot carry a picture this app cannot draw',
    validateMobileNav(withHome(cust(1, { icon: 'skull' }))).ok, false);
  eq('a custom button must say which picture it uses',
    validateMobileNav(withHome(cust(1, { icon: undefined }))).ok, false);
  /*
    A list carrying an undrawable icon falls back WHOLE, and this is the behaviour rather than
    a per-field repair. The domain file argues it at length and the reasoning is the same for
    a custom item as for a built-in: a configuration that is not valid is damage, and honouring
    the half of it that parses is how a યુવક ends up with a bar somebody else designed. So the
    assertion is the default four, not a corrected third button.
  */
  eq('a list with an undrawable icon falls back to the built-in four',
    keysOf(resolveMobileNav(withHome(cust(1, { icon: 'skull' })))), DEFAULT_KEYS);

  /*
    Where the per-field fallback IS reachable: the panel's projection, which is handed working
    items rather than stored ones and may be given one that is not finished. It substitutes the
    destination's own word and picture rather than writing an empty label - so no path through
    this module can put a cell with no word in front of a યુવક.
  */
  const bare = toStoredMobileNav([{ key: 'custom:btn-1', route: '/learn', visible: true, enabled: true }]);
  eq('an unfinished custom item is completed from its destination',
    [bare[0].label, bare[0].icon, bare[0].route], ['યાત્રા', 'book', '/learn']);
  eq('an undrawable icon is replaced on the way to the row',
    toStoredMobileNav([{ key: 'custom:btn-1', route: '/learn', icon: 'skull' }])[0].icon, 'book');
  eq('and an item with no destination at all never reaches the row',
    toStoredMobileNav([{ key: 'custom:btn-1', route: 'javascript:alert(1)', label: 'x', icon: 'book' }]), []);

  // ---- 14. identities ------------------------------------------------------
  eq('two items cannot share one id', validateMobileNav(withHome(cust(1), cust(1, { label: 'બીજું' }))).ok, false);
  eq('and the refusal says so', /appears twice/.test(validateMobileNav(withHome(cust(1), cust(1))).gu), true);
  eq('a malformed id is refused', validateMobileNav(withHome(cust(1, { key: 'custom:Bad Key!' }))).ok, false);
  eq('and dropped rather than rendered',
    keysOf(resolveMobileNav(withHome(cust(1, { key: 'custom:Bad Key!' })))), ['home', 'darshan']);
  eq('an id with no slug at all is refused', isValidCustomKey('custom:'), false);
  eq('an id that only looks custom is not one', isCustomKey('customish'), false);
  eq('a registry key is never mistaken for a custom one', NAV_REGISTRY.filter((r) => isCustomKey(r.key)), []);

  // ---- labels ---------------------------------------------------------------
  eq('a custom button must have a name', validateMobileNav(withHome(cust(1, { label: '' }))).ok, false);
  eq('whitespace is not a name', validateMobileNav(withHome(cust(1, { label: '   ' }))).ok, false);
  eq('a name longer than the cap is refused',
    validateMobileNav(withHome(cust(1, { label: 'ક'.repeat(NAV_LABEL_MAX + 1) }))).ok, false);
  eq('Gujarati is a name like any other', validateMobileNav(withHome(cust(1, { label: 'લીડરબોર્ડ' }))).ok, true);
  /*
    A custom item with no label RESOLVES to the destination's word rather than to nothing -
    the resolver forgives what the validator refuses, so no configuration can produce a cell
    with a picture and no word for a યુવક to read.
  */
  /*
    A nameless custom item is refused on the way in, and a list containing one falls back
    whole on the way out — the same "damage is damage" rule as the icon above. What guarantees
    a યુવક never sees a cell with a picture and no word is the projection, asserted under
    icons: an empty label becomes the destination's own before it can reach the row.
  */
  eq('a list with a nameless custom button falls back to the built-in four',
    keysOf(resolveMobileNav(withHome(cust(1, { label: '' })))), DEFAULT_KEYS);
  eq('and a nameless one that reaches the projection is given the destination\'s word',
    toStoredMobileNav([{ key: 'custom:btn-1', route: '/learn', label: '', icon: 'book' }])[0].label, 'યાત્રા');

  // ---- 18. the ceilings -----------------------------------------------------
  const sixShown = stored(
    nav('home'), nav('darshan'), nav('revision'), nav('profile'),
    cust(1), cust(2, { label: 'બીજું' })
  );
  eq('six visible buttons is refused however they are made up', validateMobileNav(sixShown).ok, false);
  eq('and the refusal names the ceiling', /at most 5/.test(validateMobileNav(sixShown).gu), true);
  eq('a bar over the ceiling falls back whole, rather than being trimmed',
    keysOf(resolveMobileNav(sixShown)), DEFAULT_KEYS);

  const tooManyCustom = stored(
    nav('home'), nav('darshan'),
    ...Array.from({ length: NAV_CUSTOM_MAX + 1 }, (_, i) =>
      cust(i + 1, { visible: false, label: `બ${i}` }))
  );
  eq(`more than ${NAV_CUSTOM_MAX} custom buttons is refused`, validateMobileNav(tooManyCustom).ok, false);
  const atCeiling = stored(
    nav('home'), nav('darshan'),
    ...Array.from({ length: NAV_CUSTOM_MAX }, (_, i) => cust(i + 1, { visible: false, label: `બ${i}` }))
  );
  eq(`exactly ${NAV_CUSTOM_MAX} is allowed`, validateMobileNav(atCeiling).ok, true);

  // ---- §8, which a custom button cannot satisfy ------------------------------
  /*
    A custom button to `/` is a button to the મુખપૃષ્ઠ and is NOT the way home.

    The guarantee §8 makes is that there is a button back which the configuration cannot take
    away - and a custom item is by definition one that can be deleted, so honouring it here
    would reduce the guarantee to "there was one at the moment you saved". The refusal is
    therefore correct and is asserted so that a future change which "helpfully" accepts it has
    to argue with this line first.
  */
  const homeReplaced = stored(nav('darshan'), cust(1, { route: '/', label: 'ઘર' }));
  eq('a custom button to / does not stand in for home', validateMobileNav(homeReplaced).ok, false);
  eq('and the refusal names the item that is missing',
    validateMobileNav(homeReplaced).gu.includes(navRegistryEntry(NAV_REQUIRED_KEY).label), true);
  eq('and the bar falls back to one that has a way home',
    keysOf(resolveMobileNav(homeReplaced)), DEFAULT_KEYS);

  // ---- 19. what a configuration written before any of this still does ---------
  /*
    ────────────────────────────────────────────────────────────────────────────
    The migration assertion, and it asserts that there is nothing to migrate
    ────────────────────────────────────────────────────────────────────────────

    Every settings row in existence holds built-in keys only. The claim being made is the
    strongest available one: such a row does not merely go on working, it round-trips to the
    IDENTICAL bytes. `type` and `isCustom` are derived on read and written nowhere, and
    `toStoredMobileNav()` emits the same seven fields in the same order it always did - so a
    save that changes nothing produces a value byte for byte equal to the stored one, the
    panel's dirty check stays honest, and no deploy rewrites anybody's row.
  */
  const legacy = [
    { key: 'home', label: 'મુખપૃષ્ઠ', icon: 'home', route: '/', visible: true, enabled: true, sortOrder: 1 },
    { key: 'darshan', label: 'દર્શન', icon: 'darshan', route: '/darshan', visible: true, enabled: true, sortOrder: 2 },
    { key: 'revision', label: 'પુનરાવર્તન', icon: 'list', route: '/level/3', visible: true, enabled: true, sortOrder: 3 },
    { key: 'profile', label: 'મારું', icon: 'person', route: '/profile', visible: true, enabled: true, sortOrder: 4 },
  ];
  eq('a row written before custom buttons existed is still valid', validateMobileNav(legacy).ok, true);
  eq('and resolves to the same four', keysOf(resolveMobileNav(legacy)), DEFAULT_KEYS);
  eq('and re-serialises to the identical bytes', toStoredMobileNav(resolveMobileNavConfig(legacy)), legacy);
  eq('the seeded default still round-trips too',
    toStoredMobileNav(resolveMobileNavConfig(DEFAULT_MOBILE_NAV)).map((i) => i.key), DEFAULT_KEYS);
  /*
    The `sort_order` spelling the brief uses, on a custom item. Read but never written, exactly
    as on a built-in: an integration or a hand-run SQL patch may have used it, and an item
    whose position silently became 0 because the key was spelled the other way is a bar that
    reorders itself with nothing on any screen to say why.
  */
  eq('snake case is read on a custom item too',
    keysOf(resolveMobileNav([
      { ...cust(1), sortOrder: undefined, sort_order: 1 },
      nav('home', { sortOrder: 2 }),
      nav('darshan', { sortOrder: 3 }),
    ])),
    ['custom:btn-1', 'home', 'darshan']);

  // ---- what the panel and the app agree about ---------------------------------
  eq('navDestination answers for a built-in', navDestination({ key: 'darshan' })?.route, '/darshan');
  eq('and for a custom item', navDestination({ key: 'custom:btn-1', route: '/learn' })?.route, '/learn');
  eq('and refuses a custom item with no destination', navDestination({ key: 'custom:btn-1', route: '/nope' }), null);
  eq('and refuses an unknown built-in', navDestination({ key: 'nonsense' }), null);
  eq('a built-in cannot borrow a destination from its stored route',
    navDestination({ key: 'nonsense', route: '/learn' }), null);
}

// ============================================================ 17 - the SQL, again

/*
  ────────────────────────────────────────────────────────────────────────────
  NAV_ROUTES against the database's copy of it
  ────────────────────────────────────────────────────────────────────────────

  Acceptance 14's argument, applied to the second table. The panel offers what NAV_ROUTES
  holds; the trigger admits what `nav_routes()` holds. Two copies that disagree produce the
  specific, miserable failure 14 describes: the સંચાલક picks a page from a list the panel
  showed him, and the database refuses the save with an error about it.

  ────────────────────────────────────────────────────────────────────────────
  Why this group is SHORTER than 14 rather than longer
  ────────────────────────────────────────────────────────────────────────────

  Because nine of the ten destinations are not written down twice at all. Both sides DERIVE
  them from the registry — `NAV_REGISTRY.filter(ready)` here, `select … from nav_registry()
  where ready` there — and acceptance 14 has already asserted that the registry's two copies
  agree, routes included. So for those nine the two tables cannot disagree without 14 failing
  first, and re-checking them here would be asserting the same fact twice while implying it
  had been checked two ways.

  What is genuinely written twice is the extras list — one row today — and the SHAPE of the
  derivation, which is the thing that would quietly stop being true if somebody replaced the
  select with a literal list "for clarity". Both are checked below.
*/
group('acceptance 17 - drift, the destination table against the database');
{
  const MIGRATIONS = new URL('../supabase/migrations/', import.meta.url);
  const DEFINES = 'create or replace function public.nav_routes';

  const files = existsSync(fileURLToPath(MIGRATIONS))
    ? readdirSync(fileURLToPath(MIGRATIONS)).filter((f) => f.endsWith('.sql')).sort()
    : [];
  const defining = files.filter((f) => readFileSync(new URL(f, MIGRATIONS), 'utf8').includes(DEFINES));
  const latest = defining[defining.length - 1] || null;

  if (!latest) {
    skip('NAV_ROUTES vs nav_routes()', 'no migration defines nav_routes() yet - re-run once one lands');
  } else {
    const sql = readFileSync(new URL(latest, MIGRATIONS), 'utf8');
    console.log(`    nav_routes() last defined in ${latest}`);

    // The function body only, so a route mentioned in the file's header prose cannot stand in
    // for a row in the table - 0028's header discusses /learn and /admin at length.
    const start = sql.indexOf(DEFINES);
    const body = sql.slice(start, sql.indexOf('$$;', start));

    /*
      The derivation itself. If this stops being true, the nine built-in destinations become a
      second hand-written list and every guarantee above evaporates - so the shape is asserted
      rather than assumed, and the `ready` filter with it: without it, the database would admit
      a destination for a page src/App.jsx does not serve.
    */
    eq('the built-in destinations are derived from the registry, not repeated',
      /from\s+public\.nav_registry\(\)/.test(body), true);
    eq('and only the ones this build actually serves', /where\s+r\.ready/.test(body), true);

    /** Every destination that is NOT a ready built-in's - the part written twice. */
    const extras = NAV_ROUTES.filter((r) => !NAV_REGISTRY.some((b) => b.ready && b.route === r.route));
    eq('there is at least one destination no built-in names', extras.length > 0, true);

    const drift = [];
    for (const r of extras) {
      if (!body.includes(`'${r.route}'`)) {
        drift.push(`${r.route} is offered by the panel and absent from ${latest}`);
        continue;
      }
      if (!body.includes(`'${r.icon}'`)) drift.push(`${r.route}: icon ${r.icon} is not in ${latest}`);
      if (!body.includes(r.label)) drift.push(`${r.route}: label ${r.label} is not in ${latest}`);
    }
    eq('every extra destination agrees with the SQL', drift, []);

    /*
      The other direction, and it is the one that matters for safety: a route the DATABASE
      admits and this build does not offer is a destination a curl could put under a button
      while the panel has no idea it exists. Every quoted path in the body must be one of the
      extras - the derived nine are not quoted anywhere in it, which is the point.
    */
    const sqlPaths = [...body.matchAll(/'(\/[^']*)'/g)].map((m) => m[1]);
    const unknown = sqlPaths.filter((p) => !NAV_ROUTES.some((n) => n.route === p));
    eq('the database admits no destination this build has never heard of', unknown, []);
    const undeclared = sqlPaths.filter((p) => !extras.some((e) => e.route === p));
    eq('and none of the derived nine has been quietly written out again', undeclared, []);

    // The custom-key namespace and the ceiling, which the trigger enforces independently of
    // the panel. A prefix or a number that disagrees is a save the panel accepts and the
    // database refuses.
    eq('the migration knows the custom key namespace', sql.includes(`${NAV_CUSTOM_PREFIX}%`), true);
    eq('and carries the same ceiling on custom items', sql.includes(String(NAV_CUSTOM_MAX)), true);
    eq('and the normaliser it shares with this module',
      sql.includes('nav_normalize_route'), true);
  }
}

// ==================================================================== result

console.log(`\n  ${pass} passed, ${fails.length} failed${skipped.length ? `, ${skipped.length} skipped` : ''}\n`);
if (skipped.length) {
  console.log(skipped.map((s) => `  ~ SKIPPED  ${s}`).join('\n') + '\n');
}
if (fails.length) {
  console.log(fails.map((f) => `  ✗ ${f}`).join('\n\n') + '\n');
  process.exit(1);
}
