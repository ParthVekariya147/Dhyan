/**
 * settings['nav'] — what stands at the bottom of a યુવક's screen, and in what order.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why this row exists at all
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The four buttons on a phone's bottom bar are the whole app as far as a યુવક is
 * concerned: what he can reach in one thumb-press is what the app *is*. Which four they
 * are is not a fact about the code — it is a judgement about what a યુવક should be doing
 * this month, and that judgement belongs to the સંચાલક, who can watch a room full of them
 * and see that nobody is finding પુનરાવર્તન. So it is configuration, in the same row-shaped
 * place as every other judgement of his (§34, §36), and changing it costs no deploy.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why `settings` and not a table of its own
 * ────────────────────────────────────────────────────────────────────────────
 *
 * An `app_navigation_items` table was the obvious shape and is the wrong one here. This
 * project already has a configuration system with all four of the properties such a table
 * would have been built to get: one RLS policy that names `settings.update`
 * (0004_rbac.sql), one audit trigger that files every write as SETTINGS_UPDATED, one
 * server-side validation pattern (0018's BEFORE trigger), and one read the યુવક app is
 * already making. A second system would duplicate every one of them and add a second round
 * trip on a phone, to hold at most nine rows that change a few times a year.
 *
 * So `nav` joins `app`, `levels` and `journey` as a key in the same table. What a separate
 * table would have given — a column per field, a foreign key, a real `sort_order` — is
 * bought here with a resolver and a database trigger instead, which is what the three keys
 * beside it already do.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Its own key, though — not a field of `app`
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `app` is read on every visit by four different hooks and is written by the Settings page
 * as a merged patch. Navigation is a *list*, it is written by a page of its own with a
 * confirmation of its own, and it must be readable on its first paint before anything else
 * has resolved. Putting a list into the row that four hooks patch is how one of them
 * eventually drops it (settingsService.js merges, which is why nothing has yet — but the
 * merge is a convention, not a guarantee).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * The one rule that governs everything below
 * ────────────────────────────────────────────────────────────────────────────
 *
 * **A stored row may choose among destinations. It may never name one.**
 *
 * Every route, and every fact about whether a route exists, lives in NAV_REGISTRY below —
 * in code, beside src/App.jsx's <Route> list, where it can be checked by the build. The
 * stored row carries a *key* and the સંચાલક's opinions about it (shown or not, in what
 * order, under what word, with which icon). The resolver looks the key up and takes the
 * route from the registry, never from the row.
 *
 * That is not tidiness. `settings` is writable through PostgREST by anyone `has_permission
 * ('settings.update')` admits, with no obligation to go anywhere near admin/src — so if the
 * stored `route` were honoured, one curl would put an arbitrary path, or an off-site URL,
 * under a button that 2,000 people press without reading. The row is data; a destination is
 * not (§37).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Custom buttons, and why they do not break the rule above
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The સંચાલક can now make buttons of his own — his word, his picture, his position, pointed
 * at a page of his choosing. That last clause is the one that looks like it contradicts the
 * sentence in bold, and it does not, because "of his choosing" means *chosen from
 * NAV_ROUTES*: a second closed table, below the registry, holding every page this build
 * serves. A custom item's stored `route` is a SELECTOR into that table and the resolver takes
 * its answer from the frozen entry the lookup returns — so a route the table does not contain
 * resolves to no button at all, and `javascript:`, an off-site URL and an unrouted path are
 * all simply values the lookup misses.
 *
 * What changed is only that `key` stopped doing two jobs. It was the identity AND the
 * destination-chooser, which is why there could only ever be nine buttons: naming anything
 * meant naming one of nine keys. Now `key` is the identity alone (`home`, or `custom:btn-3`)
 * and `route` chooses the destination for the custom kind. Every built-in behaves exactly as
 * it did, down to the bytes in the row — see toStoredMobileNav().
 *
 * The developer still owns every page: NAV_ROUTES is in code, beside src/App.jsx's <Route>
 * list, and scripts/test-navigation.mjs checks both directions of the claim. A સંચાલક decides
 * WHERE, WHEN, WHETHER, in WHAT ORDER, under WHICH WORD and with WHICH PICTURE. He does not
 * decide what a page does, and he cannot invent one.
 */

/** The settings row. Sits beside 'app', 'levels' and 'journey' in the same table. */
export const NAV_SETTINGS_DOC = 'nav';

/**
 * settings['nav'].value.mobileBottom — the phone's bottom bar, and only that.
 *
 * A key rather than the whole row's value, because §9 asks for the desktop sidebar to be a
 * separate configuration and this is where that separation is actually made: a second
 * surface is a second key in this row (`desktopSidebar`), resolved by a second function,
 * sharing the registry and nothing else. Nothing here may be read as "the app's navigation"
 * in general — the resolver, the validator, the trigger and the hook all say `mobileBottom`
 * in their names so that a later surface cannot inherit this one's rules by accident.
 */
export const MOBILE_BOTTOM_KEY = 'mobileBottom';

/**
 * The icons a bottom-bar item may carry.
 *
 * A closed list, and that is the requirement rather than a simplification: the alternative
 * is the સંચાલક typing a name that becomes a component lookup or, worse, a URL — which is
 * markup injection with extra steps. He picks from these; the user app maps each name to an
 * inline SVG it drew itself (src/components/NavIcon.jsx), so nothing is fetched and nothing
 * is evaluated.
 *
 * The names describe the drawing, not the destination ('grid', not 'level4'), because the
 * whole point of making the icon configurable is that a સંચાલક may want a different picture
 * on a button without changing where it goes.
 *
 * The last four arrived with custom buttons (NAV_ROUTES below) and are the reason the list
 * grew at all: a સંચાલક who may now put his own word on his own button needs more than ten
 * pictures to tell one from another, and every one of them still has to be a name in this
 * list with a drawing behind it in src/components/NavIcon.jsx. Adding a name here without
 * adding the drawing is a blank square on a phone, which is what the assertion under PATHS
 * in that file exists to catch at build time.
 */
export const NAV_ICONS = Object.freeze([
  'home',
  'play',
  'darshan',
  'list',
  'grid',
  'person',
  'gear',
  'trophy',
  'star',
  'book',
  'chart',
  'users',
  'info',
  'help',
]);

/**
 * ────────────────────────────────────────────────────────────────────────────
 * THE REGISTRY — every destination a bottom-bar button may have.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Read this against src/App.jsx: `route` must be a path that file actually routes, and
 * `ready` is whether it does. `ready` is not an opinion anybody may hold and is deliberately
 * not stored — it is a fact about this build, which is why Home.jsx's LEVEL_CODE keeps the
 * same fact about levels in the same way and for the same reason.
 *
 * Fields:
 *
 *   key       the identity. What the stored row carries, what the audit trail names, and
 *             what survives a rename of the label.
 *   route     where the button goes. Code's, never the row's — see the file header.
 *   label     the સંચાલક's default wording, in Gujarati, for a યુવક to read. A stored row
 *             may replace it; it may not replace anything else in this table.
 *   icon      the default drawing, from NAV_ICONS.
 *   ready     does src/App.jsx route this path today? A `false` here cannot be made visible
 *             by any configuration — see validateMobileNav(). This is how ક્રમાંક and
 *             સેટિંગ sit in the panel as future items without being buttons that go nowhere.
 *   required  may this item ever be hidden? True for exactly one item, and §8 is the reason.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * On "Levels", which the brief lists and this table does not
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The મુખપૃષ્ઠ *is* this app's level list — the ring, then one tile per level offered
 * (src/pages/Home.jsx). A separate 'levels' entry would be a second button to `/`, which is
 * two answers to one question: a યુવક pressing either lands in the same place, and a
 * સંચાલક who hid one and showed the other would have changed nothing while believing he had.
 * The four levels themselves are here as what they actually are — ધ્યાન શરૂ કરો, દર્શન,
 * પુનરાવર્તન, લેવલ ૪ — so a bar can be built from the ladder without going through the
 * મુખપૃષ્ઠ at all.
 */
export const NAV_REGISTRY = Object.freeze([
  {
    key: 'home',
    route: '/',
    label: 'મુખપૃષ્ઠ',
    icon: 'home',
    ready: true,
    // §8. The one destination that may not be taken away — see NAV_REQUIRED_KEY below.
    required: true,
  },
  // લેવલ ૧. The path is /welcome and not /level/1: the વિડિયો lives on the પ્રવેશદ્વાર,
  // which replays without its two questions once they have been answered (src/App.jsx's
  // GateRoute). Home.jsx's LEVEL_CODE says the same thing, and for the same reason.
  { key: 'start', route: '/welcome', label: 'ધ્યાન', icon: 'play', ready: true },
  { key: 'darshan', route: '/darshan', label: 'દર્શન', icon: 'darshan', ready: true },
  /*
    લેવલ ૩ — the daily વર્ણન યાદી, and labelled as such.

    It read પુનરાવર્તન, after the brief's own registry. That is a fair description of what a
    યુવક does there and it was still the wrong word on a button: પુનરાવર્તન is also the name
    of લેવલ ૪'s revision screen (shared/domain/journey.js), so the bar offered one word for
    two different places while the level's own name — the one on the home tile, in the
    settings row and at the head of the page — appeared nowhere. The `key` stays `revision`:
    it is a stored identity and renaming it would orphan every bar a સંચાલક has saved.
  */
  { key: 'revision', route: '/level/3', label: 'વર્ણન યાદી', icon: 'list', ready: true },
  // લેવલ ૪'s front door — the પ્રવૃત્તિ list, never a particular કસોટી. Whether it is *open*
  // to this યુવક is earned per-person against the gate (§7) and is decided on the page
  // itself; a button in the bar is not permission and never has been (§37).
  { key: 'level4', route: '/level/4', label: 'લેવલ ૪', icon: 'grid', ready: true },
  { key: 'profile', route: '/profile', label: 'મારું', icon: 'person', ready: true },
  /*
    સેટિંગ became real, and this line is what that looks like.

    It shipped `ready: false` — a placeholder for a screen that did not exist — and the યુવક's
    own આપોઆપ speed is what gave it something to hold (src/pages/Settings.jsx, and
    shared/domain/viewing-speed.js for the four presets it offers). `ready` is a fact about
    src/App.jsx and nothing else, so the day the route was added this had to change with it or
    the two would be describing different builds. scripts/test-navigation.mjs asserts both
    directions of that, which is how it is kept honest rather than remembered.

    Note what did NOT change: the સંચાલક still decides whether it stands in the bar. `ready`
    only means "this app has the screen"; visible/enabled are still his, and the default four
    do not include સેટિંગ — it is reached from મારું, where a યુવક looks for it.
  */
  { key: 'settings', route: '/settings', label: 'સેટિંગ', icon: 'gear', ready: true },
  /*
    ક્રમાંક became real, and this line is what that looks like.

    It stood here as a placeholder for a long time — `ready: false`, listed rather than
    omitted so that a panel which simply never mentioned ક્રમાંક would not invite the same
    question every month. The sentence it carried said points and the leaderboard were a
    separate piece of work and that turning this on was that task's business. That task has
    now run: `/leaderboard` is a route src/App.jsx serves, `public.leaderboard()` is the
    function behind it, and `ready` is a fact about this build rather than an intention, so it
    had to change with the route or the two would be describing different apps. 0023 carries
    the same flip on the database's copy and scripts/test-navigation.mjs asserts both
    directions, which is how it stays honest rather than remembered. સેટિંગ crossed this same
    line in 0020 and the reasoning is identical.

    What did NOT change: the સંચાલક still decides whether it stands in the bar, and the
    default four do not include it. `ready` only ever meant "this app has the screen".

    One thing about this entry is unlike every other in the table, and it is worth knowing
    before anybody moves it: this is the only destination that shows a યુવક another યુવક's
    name. The exposure is one SECURITY DEFINER function returning a name and a total and
    nothing else, and it stays dark until the સંચાલક switches it on — see the §13 essay at the
    top of shared/domain/leaderboard.js, which is where that decision is written down.
  */
  { key: 'leaderboard', route: '/leaderboard', label: 'ક્રમાંક', icon: 'trophy', ready: true },
  /*
    મારી પ્રગતિ — every day a યુવક has done, and what it earned.

    Not the ક્રમાંક line above it, and the difference is the whole reason this is a separate
    key. A leaderboard is a comparison between યુવકો; this is a record of one યુવક's own days,
    with nobody else's number anywhere on it. Folding the two together would have meant a
    button labelled ક્રમાંક opening a page that ranks nothing — and would have spent the slot
    the leaderboard is still waiting for. So ક્રમાંક stays exactly as it was, `ready: false`,
    reserved for the work that will build it.

    `star` rather than `trophy` for the same reason: the trophy is spoken for, and a star is
    what the gold `+ગુણ` line on this page already reads as. `list` was the other candidate
    and is taken by પુનરાવર્તન.
  */
  { key: 'history', route: '/history', label: 'પ્રગતિ', icon: 'star', ready: true },
]);

/**
 * ────────────────────────────────────────────────────────────────────────────
 * THE DESTINATION REGISTRY — every page a button of ANY kind may open.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * NAV_REGISTRY above answers "which nine buttons does this app ship with". This answers a
 * different and smaller question — "which pages exist to be pointed at" — and the two are
 * separated because a custom button needs the second without inheriting the first.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * What a custom button actually is
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Until this list existed, `key` was doing two jobs at once: it was the item's identity AND
 * it was how the destination got chosen. That conflation is the whole reason the panel could
 * only ever offer nine buttons — there was no way to say "a second button, to a page that
 * already has one" or "a button to /learn, which no registry entry names", because saying
 * anything at all meant naming one of the nine keys.
 *
 * So the two jobs are now separate fields:
 *
 *   key      the identity. `home`, `darshan`, … for the nine built-ins, exactly as before;
 *            `custom:btn-3` for one the સંચાલક made. Nothing about a stored built-in row
 *            changed, which is why every configuration saved before this list existed goes on
 *            resolving byte for byte the same way.
 *   route    the destination, and ONLY meaningful on a custom item. It is looked up in the
 *            table below and the answer is taken from the frozen entry that lookup returns —
 *            never from the row. A built-in still takes its route from NAV_REGISTRY and its
 *            stored `route` is still refused if it disagrees.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why this is still not "the row may name a destination"
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The file header's one rule is intact and this is the paragraph that has to prove it. A
 * stored `route` is a *selector*, not a destination: it is matched against this table, and a
 * value that is not in it resolves to nothing at all. `javascript:`, `https://evil.example`,
 * `/admin`, `/level/4/../../wherever` — none of them is in the list, so none of them can come
 * out of the resolver, and the row that carried one is refused at write time by
 * validateMobileNav() and by the database trigger besides. What comes out of navRouteEntry()
 * is one of the frozen objects below, defined in code, beside src/App.jsx's <Route> list,
 * where the build can check it (scripts/test-navigation.mjs, acceptance 15).
 *
 * The practical difference between a closed table of ten and a closed table of nine keys is
 * that the સંચાલક may now aim a button at a page which has no built-in entry — /learn is the
 * one this ships with — and may have two buttons to one page under two different words. What
 * he still cannot do is invent a page. A tenth destination arrives the way the ninth did: a
 * developer writes the screen, routes it in src/App.jsx, and adds a line here.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * `label` and `icon` on a destination
 * ────────────────────────────────────────────────────────────────────────────
 *
 * They are the fallback, not the answer. A custom item carries the સંચાલક's own word and
 * picture and both are required of him at write time; these are what the resolver falls back
 * to if a row arrives from somewhere that is not the panel with a label it cannot use. Same
 * argument as the registry's own label: a cell with an icon and no word is a button whose
 * meaning a યુવક has to learn by pressing it.
 */
/**
 * The destinations that are NOT already a built-in's — the whole of what this table adds.
 *
 * Written out, while the nine built-in destinations below are derived, and the asymmetry is
 * the point: a route that a built-in already points at is the same page under the same word
 * with the same picture, and writing those out again would be nine Gujarati labels that can
 * drift from the registry's. Deriving them means the drift cannot happen and costs nothing —
 * this module is in the યુવક app's entry chunk, and nine duplicated strings there are bytes
 * every phone downloads to hold the same words twice.
 *
 * /learn is a route src/App.jsx has served since long before any of this and no registry entry
 * names it: the guided journey is reached from the મુખપૃષ્ઠ and from nowhere else. That is not
 * an oversight there — a tenth built-in would spend one of five bar slots on a screen most સંઘો
 * do not want a button for. It is exactly the case a custom button answers, and it is the proof
 * that this table is not merely the registry's routes copied out.
 */
const EXTRA_NAV_ROUTES = Object.freeze([
  Object.freeze({ route: '/learn', label: 'યાત્રા', icon: 'book' }),
]);

export const NAV_ROUTES = Object.freeze([
  /*
    Every built-in destination this build actually serves, in the registry's own order.

    `ready` is what filters it, and that filter is load-bearing rather than tidy: a custom
    button pointed at a page the app has not built yet is the same button-that-goes-nowhere
    that `ready` exists to prevent on a built-in, arriving by the other door. There is
    deliberately no `ready` column on this table — every row in it is a page that exists, so
    a not-yet-built destination is one that is simply absent until it is built.
  */
  ...NAV_REGISTRY.filter((r) => r.ready).map((r) =>
    Object.freeze({ route: r.route, label: r.label, icon: r.icon })
  ),
  ...EXTRA_NAV_ROUTES,
]);

/**
 * The prefix that says "this item is the સંચાલક's, not the app's".
 *
 * A prefix rather than a `type` field beside the key, and that is a deliberate choice about
 * where identity lives. A `type: 'custom'` next to `key: 'home'` is two fields that can
 * disagree, and the one that would win is whichever the reader looked at — the resolver, the
 * trigger, the panel and a psql session would each have to be told which. A key that carries
 * its own kind cannot disagree with itself. No registry key contains a colon, so the two
 * namespaces cannot collide, and `key.startsWith('custom:')` is the whole of the test in all
 * four places.
 *
 * The resolved item still carries `isCustom` and `type` for a panel that wants to render a
 * badge — but they are DERIVED from the key on the way out, and they are not stored.
 */
export const NAV_CUSTOM_PREFIX = 'custom:';

/**
 * What may stand after that prefix.
 *
 * Lower-case letters, digits and inner hyphens, 1..24 characters. It is an identity and never
 * anything else: it is not shown to a યુવક, it is not shown to a સંચાલક except as the small
 * grey string on the row, and it is not a slug of the label — Gujarati does not survive being
 * slugified into ASCII, and a key that tried would either be empty or be a transliteration
 * nobody asked for. So keys are counted, not named (see makeCustomKey below).
 *
 * Constrained rather than accepted-as-typed because a key ends up in a DOM attribute
 * (`data-nav-key`), in a React `key`, in an `id=` on the panel's form controls and in an
 * audit trail. Any of those is a place where a hostile string is worth not having.
 */
export const NAV_CUSTOM_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,22}[a-z0-9])?$/;

/**
 * How many custom buttons may exist AT ALL — not how many may be shown.
 *
 * MOBILE_NAV_MAX is the ceiling on the bar and is a measurement of a 320px screen. This is a
 * different ceiling, on the LIST, and it is a bound on the settings row rather than on the
 * phone: hidden items are configuration a સંચાલક is keeping for later, they cost nothing on
 * any screen, and there is no reason to allow an unbounded number of them in a jsonb value
 * that is read on every visit by every યુવક. Twelve is a number nobody will reach for a bar
 * that shows five — it is a guard against a script, not a budget for a person.
 */
export const NAV_CUSTOM_MAX = 12;

/**
 * §8 — the item no configuration may hide.
 *
 * The bottom bar is the only chrome the app has on a phone: there is no sidebar, no
 * hamburger and no breadcrumb behind it. A યુવક deep in લેવલ ૪'s કસોટી with no મુખપૃષ્ઠ
 * button has one way back, and it is the browser's — which a PWA in standalone mode does not
 * draw. So hiding મુખપૃષ્ઠ is not a configuration, it is a trap, and it is refused in three
 * places: the panel's Save, validateMobileNav() below, and the trigger in 0019.
 *
 * One key rather than a list, because a second protected item is a second thing the સંચાલક
 * cannot arrange and the bar is at most five wide. If the app ever grows a second safe
 * landing route this becomes a list and §8's sentence changes with it.
 */
export const NAV_REQUIRED_KEY = 'home';

/**
 * How many buttons may stand in the bar.
 *
 * Five is a measurement, not a preference: at 320px — the iPhone SE and every cheap Android
 * in portrait, and the width tokens.css is designed against — five cells are 64px each. That
 * is a tap target above the 44px floor with room for an icon and one short Gujarati word
 * under it. Six cells are 53px, which is under the floor with the label already clipped.
 *
 * Two is the floor because one button is not navigation, it is a logo: with a single cell
 * there is nothing to move between and the bar costs 64px of a phone's screen to say where
 * you already are. A સંચાલક who wants no bottom bar wants a setting that does not exist yet,
 * and should be told so rather than left to express it by hiding everything.
 */
export const MOBILE_NAV_MIN = 2;
export const MOBILE_NAV_MAX = 5;

/**
 * The longest label that survives a 320px screen with five buttons on it.
 *
 * 64px of cell, minus 8px of padding either side, is 48px of text — about 6 Gujarati
 * characters at the bar's own size. Twelve is therefore not "what fits": it is the point past
 * which a label is certainly wrong, chosen so a bar of two or three items may carry a longer
 * word (પુનરાવર્તન is 8) without the rule refusing something that renders perfectly well.
 * What fits is CSS's problem, and .bnav-label truncates rather than wrapping — a bar whose
 * height depends on the સંચાલક's wording is a bar that moves the page under a thumb.
 */
export const NAV_LABEL_MAX = 12;

/** The registry, by key. Built once — the list is nine long and never changes at runtime. */
const BY_KEY = new Map(NAV_REGISTRY.map((r) => [r.key, r]));

/** The registry entry for a key, or null. Exported for the panel's read-only columns. */
export const navRegistryEntry = (key) => BY_KEY.get(key) || null;

/** The destination table, by path. Same reasoning as BY_KEY: ten entries, fixed at build. */
const BY_ROUTE = new Map(NAV_ROUTES.map((r) => [r.route, r]));

/** Is this key one the સંચાલક made? A prefix test, and the only one anywhere. */
export const isCustomKey = (key) =>
  typeof key === 'string' && key.startsWith(NAV_CUSTOM_PREFIX);

/**
 * …and is it a well-formed one. Both halves, because a key that merely starts with the
 * prefix has told us its kind and nothing about whether it is usable as an identity.
 */
export const isValidCustomKey = (key) =>
  isCustomKey(key) && NAV_CUSTOM_SLUG.test(key.slice(NAV_CUSTOM_PREFIX.length));

/**
 * One written route, reduced to the one spelling this project stores.
 *
 * Only two liberties are taken and both are typing, not meaning: surrounding whitespace, and
 * a trailing slash on anything longer than `/` itself. react-router treats `/darshan` and
 * `/darshan/` as the same place and a સંચાલક typing the second should not be told his page
 * does not exist — but the row must hold one of them or two items pointing at one page look
 * like two pages in every list that groups by route.
 *
 * Everything else is left exactly as written, because this is a normaliser and not a repair
 * shop: `//evil.example` comes back as `//evil.example` and NOT as `/`, which is the one
 * case where being clever would turn a protocol-relative URL into a legal path. It fails the
 * lookup, which is what it is supposed to do.
 *
 * The database's `nav_normalize_route()` (0028) is the same two rules and is tested against
 * this one.
 */
export function normalizeNavRoute(route) {
  if (typeof route !== 'string') return '';
  const trimmed = route.trim();
  if (trimmed.length <= 1) return trimmed;
  return trimmed.replace(/\/+$/, '');
}

/**
 * The frozen destination for a written route, or null.
 *
 * This is the lookup the whole custom-button feature rests on: what comes back is an object
 * from NAV_ROUTES — defined in code — and every field the resolver then uses is read off
 * THAT, never off the row that asked for it.
 */
export const navRouteEntry = (route) => BY_ROUTE.get(normalizeNavRoute(route)) || null;

/**
 * The destination of any item at all, built-in or custom, or null if it has none.
 *
 * One function so that a caller which does not care which kind of item it is holding — the
 * resolver's map, the panel's preview, scripts/verify-nav.mjs reading rendered anchors — is
 * not the place where the two rules get written down a second time.
 */
export function navDestination(item) {
  if (!item || typeof item !== 'object') return null;
  if (isCustomKey(item.key)) {
    return isValidCustomKey(item.key) ? navRouteEntry(item.route) : null;
  }
  const reg = BY_KEY.get(item.key);
  return reg && reg.ready ? reg : null;
}

/**
 * Why a written route cannot be used, in the સંચાલક's own terms — or null if it can.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why validateMobileNav() does NOT call this, though it is about to ask the same question
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The set-membership test at the bottom is the only line here that is load-bearing: a route
 * that is not in NAV_ROUTES is refused, and every dangerous string is refused by that line
 * alone. Everything above it exists to produce a better SENTENCE — "this app has no page at
 * javascript:alert(1)" is true and useless, and a સંચાલક who pasted a link has made a
 * different mistake from one who mistyped a path.
 *
 * Those sentences are worth their bytes in the panel, where somebody is looking at the field,
 * and they are dead weight in the યુવક app — which imports this module into its ENTRY CHUNK
 * (BottomNav is mounted beside every route, so nothing about the bar can be lazy) and which
 * has no screen that could ever display them. So the validator asks `navRouteEntry()` and says
 * one short thing, this function is reached only from the panel's dialog, and Rollup drops it
 * from the phone's bundle entirely. scripts/verify-admin-separation.mjs enforces the budget
 * that makes that matter.
 *
 * Nothing is lost where it counts. The dialog runs this on every keystroke, so the specific
 * sentence arrives before Save is even reachable; and for a write that never went near the
 * panel, `nav_config_error()` in 0028 carries the same five refusals in the same order and is
 * the copy a curl actually meets.
 *
 * Order matters: the scheme test runs before the leading-slash test, because `https://x` fails
 * both and "that is a link to another site" is the more useful of the two sentences.
 */
export function navRouteError(route) {
  const raw = typeof route === 'string' ? route.trim() : '';
  if (!raw) return 'Choose the page this button opens.';

  // `scheme:` — javascript:, data:, http:, https:, mailto:, anything. A URL with a scheme is
  // by definition not a page of this app, whatever the scheme happens to be.
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    return `"${raw}" is a link to somewhere outside this app. A button may only open a page of this app.`;
  }
  // `//host/path` — protocol-relative, and a browser treats it as another site with no scheme
  // to give it away. It is the one external URL that looks like a path.
  if (raw.startsWith('//')) {
    return `"${raw}" is a link to another site. A button may only open a page of this app.`;
  }
  if (!raw.startsWith('/')) {
    return `"${raw}" is not a page of this app - a page starts with /.`;
  }
  // A query or a fragment is not a destination, it is an instruction to one, and nothing in
  // the app reads either from the bar. Accepting them would store text that changes nothing.
  if (/[?#]/.test(raw)) {
    return `"${raw}" cannot carry a ? or a # - choose the page itself.`;
  }
  if (!navRouteEntry(raw)) {
    return `This app has no page at "${normalizeNavRoute(raw)}" yet. It has to be built and routed before a button can open it.`;
  }
  return null;
}

/**
 * The next unused custom key, given the keys already in the list.
 *
 * Counted rather than named, for the reason NAV_CUSTOM_SLUG gives: the label is Gujarati and
 * a slug of it would be either empty or a transliteration. Counted from 1 and skipping what
 * is taken, rather than "highest + 1", so a list that has had `btn-2` deleted reuses the
 * number instead of climbing forever — the key is an identity within one settings row and
 * nothing outside that row ever refers to it, so reuse costs nothing.
 *
 * Deterministic, and that is worth stating: no clock and no random source, so
 * scripts/test-navigation.mjs can assert the exact key this returns.
 *
 * @returns a key, or null if NAV_CUSTOM_MAX has already been reached.
 */
export function makeCustomKey(takenKeys = []) {
  const taken = new Set(takenKeys);
  for (let n = 1; n <= NAV_CUSTOM_MAX; n++) {
    const key = `${NAV_CUSTOM_PREFIX}btn-${n}`;
    if (!taken.has(key)) return key;
  }
  return null;
}

/**
 * A new custom item, ready for the panel's working list.
 *
 * It arrives `visible: false`, and that is the same decision navigationService.js makes about
 * the registry items it appends: an item that has just been created is not something anybody
 * asked to be in the bar yet, the bar holds at most five, and a form whose Save silently
 * pushed the bar over its ceiling would refuse the whole write for a reason the સંચાલક did
 * not choose. He switches it on when he means to, and the preview shows him the count.
 *
 * @returns the item, or null if the route is not one this app has.
 */
export function newCustomItem({ route, label, icon, visible = false, enabled = true }, takenKeys = []) {
  const dest = navRouteEntry(route);
  if (!dest) return null;
  const key = makeCustomKey(takenKeys);
  if (!key) return null;

  const word = String(label ?? '').replace(/\s+/g, ' ').trim();
  return {
    key,
    type: 'custom',
    isCustom: true,
    route: dest.route,
    label: word && word.length <= NAV_LABEL_MAX ? word : dest.label,
    icon: NAV_ICONS.includes(icon) ? icon : dest.icon,
    visible: visible === true,
    enabled: enabled !== false,
    required: false,
    ready: true,
  };
}

/**
 * A copy of any item — built-in or custom — as a NEW custom item.
 *
 * Copying a built-in is the useful half of this and is why it is not restricted to custom
 * rows: "the same destination, under a second word, further along the bar" is a thing a
 * સંચાલક may want, and it is precisely what a built-in cannot express on its own because its
 * key is its identity and there is only one of it.
 *
 * The copy is switched off, for the reason newCustomItem() gives, and it takes a new key from
 * makeCustomKey() — never the source's. A duplicate that shared a key would not be a
 * duplicate, it would be the same item twice, which validateMobileNav() refuses and which is
 * exactly the fault "do not rely on array index as identity" is about.
 *
 * @returns the copy, or null if there is no room or the source has no destination.
 */
export function duplicateNavItem(item, takenKeys = []) {
  const dest = navDestination(item);
  if (!dest) return null;
  return newCustomItem(
    {
      route: dest.route,
      label: item.label || dest.label,
      icon: item.icon,
      visible: false,
      enabled: item.enabled !== false,
    },
    takenKeys
  );
}

/**
 * The four the app opens with, and the four it falls back to.
 *
 * મુખપૃષ્ઠ, દર્શન, પુનરાવર્તન, મારું — the brief's Home / Darshan / Levels / Profile, in
 * this app's own vocabulary, with પુનરાવર્તન standing where the brief says "Levels" because
 * the મુખપૃષ્ઠ already is the level list (see the registry note above).
 *
 * This is the same list in three roles, deliberately: what a project that has never opened
 * the panel gets, what Restore Default writes, and what resolveMobileNav() returns when the
 * row is absent, unreadable or damaged (§16). One list, so the three can never disagree —
 * a fallback that differs from the default is a bar that changes shape during an outage and
 * teaches a યુવક that buttons move.
 *
 * Order is 1..4 and written out rather than derived from the array index, because the whole
 * point of `sortOrder` is that position in an array is not an order anything may rely on:
 * jsonb round-trips, a merge, or a panel that maps before it sorts would all silently
 * reshuffle a bar that was only ever ordered by where it sat in a list.
 */
export const DEFAULT_MOBILE_NAV = Object.freeze([
  Object.freeze({ key: 'home', visible: true, enabled: true, sortOrder: 1 }),
  Object.freeze({ key: 'darshan', visible: true, enabled: true, sortOrder: 2 }),
  Object.freeze({ key: 'revision', visible: true, enabled: true, sortOrder: 3 }),
  Object.freeze({ key: 'profile', visible: true, enabled: true, sortOrder: 4 }),
]);

/*
  પ્રગતિ is NOT in the list above, and the omission is the considered answer rather than an
  oversight. It follows સેટિંગ exactly (see its entry in NAV_REGISTRY): `ready: true` makes it
  a destination the panel offers and the trigger admits; whether it stands in the bar is the
  સંચાલક's, and he adds it in one click.

  Two reasons it is not defaulted in. The first is that it would change nothing where it
  matters: 0019 seeded `settings['nav']` with these four under `on conflict do nothing`, so
  every project already running holds a stored row that wins over this list, and a deploy that
  reached into a configuration somebody had already made would be doing the one thing a
  migration must never do to a settings row. The second is that five is MOBILE_NAV_MAX, so
  defaulting a fifth spends the last cell on behalf of every future project — and which five
  destinations a સંઘ wants in its bar is precisely the judgement this whole settings row
  exists to leave with him.

  A યુવક whose સંચાલક has not added it still reaches મારી પ્રગતિ from મારું, which is where
  સેટિંગ is reached from and where he already looks for his own record.
*/

/**
 * `sortOrder`, and why `sort_order` is read too.
 *
 * The brief names the field `sort_order`. Every other key in this table is camelCase
 * (`levelId`, `youtubeUrl`, `driveFolderId`, `tickWord`), because they are JSON object keys
 * read straight into JavaScript and not database columns — so `sortOrder` is what this
 * writes, and it is what the panel and the trigger agree on.
 *
 * Snake case is *accepted* on read, though, and that is not politeness: this is a jsonb row
 * that an integration or a hand-run SQL patch may have written from the brief's own spelling,
 * and a nav item whose order silently became 0 because the key was spelled the other way is
 * a bar that reorders itself with nothing on any screen to say why. Read both, write one.
 */
const readOrder = (item) => (item.sortOrder !== undefined ? item.sortOrder : item.sort_order);

/**
 * settings['nav'].value.mobileBottom → the bar the યુવક app actually renders.
 *
 * Forgiving, in the same shape and for the same reasons as resolveLevels() and
 * resolveSlideshow() beside it: this is jsonb that anybody holding `settings.update` once
 * wrote, it is not a typed value, and §16 says a bad configuration must never be able to
 * produce an empty bar. So every branch ends at something renderable —
 *
 *   absent / not an array / empty   → DEFAULT_MOBILE_NAV. Nothing has been configured.
 *   fails validateMobileNav()       → DEFAULT_MOBILE_NAV, whole. A list that hides
 *                                     મુખપૃષ્ઠ, or has six visible items, or names a key
 *                                     this build has no route for, is not a configuration
 *                                     with a bad entry in it — it is a configuration that
 *                                     was written by something other than the panel, and
 *                                     honouring the half of it that parses is how a યુવક
 *                                     ends up with a bar that is missing its way home.
 *   an unknown key                  → dropped before validation. A row saved by a later
 *                                     build may name a destination this one has never heard
 *                                     of, and that must cost one button, not the whole bar.
 *   a key whose route is not ready  → dropped, same reasoning. ક્રમાંક in a stored row from
 *                                     the day the leaderboard ships must not become a
 *                                     button that goes nowhere on a phone that has not
 *                                     updated.
 *   visible/enabled absent          → true. Absence is not "off"; `false` is how that is
 *                                     said, exactly as resolveLevels() argues.
 *   label absent or unusable        → the registry's own word. Never empty: a bar cell with
 *                                     an icon and no word is a button whose meaning a યુવક
 *                                     has to learn by pressing it.
 *   icon not in NAV_ICONS           → the registry's own icon. An unknown name would render
 *                                     as nothing at all, which is worse than the wrong
 *                                     picture.
 *   sortOrder not an integer        → its position among the entries that do have one, so a
 *                                     half-ordered list still comes out in a stable order
 *                                     rather than collapsing to a single value.
 *
 * @returns items in the order they must be drawn, each carrying its registry `route` — never
 *   the stored one. Only the visible-and-enabled ones: this returns *the bar*, not the
 *   configuration. The panel wants the configuration and calls resolveMobileNavConfig().
 */
export function resolveMobileNav(stored) {
  return resolveMobileNavConfig(stored).filter((i) => i.visible && i.enabled);
}

/**
 * The same resolution, without the last filter — every configured item, including the ones
 * the સંચાલક has switched off.
 *
 * The panel needs this and the app must not have it: a page that lists what is hidden is
 * doing its job, and a bar that renders what is hidden is a bug. Two functions rather than
 * a boolean argument, because the boolean would eventually be passed the wrong way round by
 * a caller that could not see it at the call site.
 */
export function resolveMobileNavConfig(stored) {
  // Non-objects first, before anything reads `.key` off them. A single null in the array
  // must not be able to throw away the bar.
  const clean = Array.isArray(stored) ? stored.filter((i) => i && typeof i === 'object') : [];

  /*
    Unknown and not-yet-built keys go before validation, not after: they are the two ways a
    perfectly good configuration can arrive at a build that is older or newer than the one
    that wrote it, and neither is damage.

    navDestination() is what makes that sentence cover custom items too, and it covers them
    with the SAME rule rather than a parallel one. A custom row whose route this build has
    never heard of is the identical situation to a built-in key it has never heard of — a
    newer panel wrote a destination an older phone does not serve — and it must cost that one
    button and not the bar. It is also, incidentally, the line that makes an injected route
    unrenderable: no destination, no item, whatever the row claims.
  */
  const known = clean.filter((i) => navDestination(i));

  const list = known.length && validateMobileNav(known).ok ? known : DEFAULT_MOBILE_NAV;

  return (
    list
      .map((s, i) => {
        // The frozen entry — NAV_REGISTRY's for a built-in, NAV_ROUTES' for a custom one.
        // Both are defined in code; neither is the row. Every field taken off `dest` below
        // is therefore the app's answer and not the સંચાલક's.
        const dest = navDestination(s);
        const custom = isCustomKey(s.key);
        const label = typeof s.label === 'string' ? s.label.replace(/\s+/g, ' ').trim() : '';
        const order = readOrder(s);
        return {
          key: custom ? s.key : dest.key,
          // Code's, always. The whole file header is about this line.
          route: dest.route,
          label: label && label.length <= NAV_LABEL_MAX ? label : dest.label,
          icon: NAV_ICONS.includes(s.icon) ? s.icon : dest.icon,
          visible: s.visible !== false,
          enabled: s.enabled !== false,
          sortOrder: Number.isInteger(order) && order >= 1 ? order : i + 1,
          // A custom item is never `required` and never can be: NAV_REQUIRED_KEY is a
          // registry key, and §8's guarantee is about the way home rather than about
          // whichever button a સંચાલક happens to have made.
          required: !custom && dest.required === true,
          // Derived here and stored nowhere — see NAV_CUSTOM_PREFIX. Both spellings because
          // the panel reads one as a flag and renders the other as a word.
          isCustom: custom,
          type: custom ? 'custom' : 'builtin',
        };
      })
      // Ties fall back to the key so the order is total and never depends on sort stability —
      // the same rule resolveLevels() applies, for the same reason: two items sharing an order
      // must come out in the same sequence on every device, or the bar is arranged differently
      // on two phones from one saved configuration.
      .sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key))
  );
}

/**
 * Refuses what resolveMobileNavConfig() would silently correct.
 *
 * Same division of labour as validateLevels()/resolveLevels(): the resolver forgives, because
 * a stored row must always yield a bar; this refuses, because a સંચાલક who has just hidden
 * મુખપૃષ્ઠ should be told so at the moment he presses Save rather than discover it by
 * watching the preview quietly ignore him.
 *
 * The messages name the rule and the number. `saveError()` in the panel surfaces the database
 * trigger's version of these same sentences, which is why 0019 spells them out too — a
 * refusal that says only "invalid configuration" is a refusal the next person works around.
 *
 * Called with the *whole* configuration, hidden items included: "at most five visible" cannot
 * be checked from a list of the visible ones, and "મુખપૃષ્ઠ is present" is a different
 * question from "મુખપૃષ્ઠ is shown".
 */
export function validateMobileNav(items) {
  if (!Array.isArray(items) || !items.length) {
    return { ok: false, gu: 'The navigation list is empty.' };
  }

  let customCount = 0;
  const seen = new Set();
  for (const item of items) {
    if (!item || typeof item !== 'object') {
      return { ok: false, gu: 'The navigation list has an entry that is not an item.' };
    }

    const custom = isCustomKey(item.key);
    const reg = custom ? null : BY_KEY.get(item.key);

    if (custom) {
      /*
        A custom key is refused on its shape rather than looked up, because there is nothing
        to look it up in: it is an identity the સંચાલક's panel invented, and the only facts
        about it that can be checked are that it is well-formed and that it is not already
        in use. NAV_CUSTOM_SLUG says what well-formed is and why it is constrained at all.
      */
      if (!isValidCustomKey(item.key)) {
        return { ok: false, gu: `"${item.key}" is not a usable id for a button.` };
      }
      customCount++;
      if (customCount > NAV_CUSTOM_MAX) {
        return {
          ok: false,
          gu: `At most ${NAV_CUSTOM_MAX} custom buttons - the bar shows ${MOBILE_NAV_MAX} and the rest are a list nobody can read.`,
        };
      }
    } else if (!reg) {
      return { ok: false, gu: `"${item.key}" is not a navigation item this app has.` };
    }

    /*
      The word this item's refusals are spoken in.

      A built-in is named by the registry, never by `item.label`: the સંચાલક may be halfway
      through renaming it, and a message about "મા" while he types મારું is a message about
      nothing. A custom item has no registry word, so its own label is the only name it has —
      and the label checks below run before it is used for anything that matters.
    */
    const name = reg ? reg.label : String(item.label ?? '').trim() || item.key;

    if (seen.has(item.key)) {
      return { ok: false, gu: `"${name}" appears twice in the list.` };
    }
    seen.add(item.key);

    if (typeof item.visible !== 'boolean' || typeof item.enabled !== 'boolean') {
      return { ok: false, gu: `"${name}": shown and enabled must each be set.` };
    }

    const order = readOrder(item);
    if (!Number.isInteger(order) || order < 1) {
      return { ok: false, gu: `"${name}" has no position in the order.` };
    }

    if (custom) {
      /*
        THE line. Everything else in this function is a bound; this is the boundary.

        A custom item's route is the one field of any stored item that actually decides where
        a button goes, so it is checked against NAV_ROUTES here, checked again by the database
        trigger (0028), and — the part that makes the other two belts rather than the trousers
        — ignored entirely by the resolver unless the same lookup succeeds there too. An
        external URL, a `javascript:` string or a path this app does not route cannot become a
        button by any of the three routes into this row.

        A membership test and one short sentence, rather than navRouteError()'s five specific
        ones — see that function's own comment for why the specific ones must not be reachable
        from here. This is the check; the diagnosis lives in the panel's dialog, where somebody
        is looking at the field, and in the database trigger, which is what a write that
        bypassed the panel actually meets.
      */
      if (!navRouteEntry(item.route)) {
        return { ok: false, gu: `"${name}" does not open a page this app has.` };
      }

      /*
        Required of a custom item, optional on a built-in, and the asymmetry is the whole
        difference between the two kinds. A built-in that carries no label falls back to the
        registry's own word, which is a word the app chose and stands behind. A custom button
        has no such word — the resolver falls back to the destination's, which is the name of
        the PAGE and not of the button, and a સંચાલક who meant to write "લીડરબોર્ડ" and saved
        nothing would get a button reading ક્રમાંક with no indication that his name was
        dropped. So it is refused at the moment he saves rather than replaced behind him.
      */
      if (typeof item.label !== 'string' || !item.label.replace(/\s+/g, ' ').trim()) {
        return { ok: false, gu: 'A custom button needs a name to show under its icon.' };
      }
      if (!NAV_ICONS.includes(item.icon)) {
        return { ok: false, gu: `"${name}" needs a picture this app can draw.` };
      }
    } else {
      /*
        A route may be stored — the brief asks for the field — but on a BUILT-IN it may only
        be the one the registry already holds. The resolver ignores it entirely, so this
        refusal is not what keeps a yuvak safe; it is what stops the panel from *displaying* a
        destination that no button will ever go to. A row whose route disagrees with the
        registry is a row something other than the panel wrote, and saying so is more useful
        than correcting it.

        This is also what keeps the two kinds honestly separate: the way to point a button
        somewhere else is to make a custom one, not to edit a built-in's destination out from
        under the key that names it.
      */
      if (item.route !== undefined && item.route !== reg.route) {
        return { ok: false, gu: `"${name}" cannot be pointed at a different page.` };
      }

      if (item.icon !== undefined && !NAV_ICONS.includes(item.icon)) {
        return { ok: false, gu: `"${name}" has an icon this app cannot draw.` };
      }
    }

    if (item.label !== undefined) {
      /*
        Refused rather than coerced, and this is not pedantry about types.

        `String(null)` is the four-character word 'null', which passes every length check
        below and is then thrown away by resolveMobileNavConfig() — whose test is
        `typeof s.label === 'string'` — in favour of the registry's own word. So a coercing
        check here would accept a value the resolver silently replaces, which is the exact
        fault every validator in shared/domain/settings.js is written to avoid: the સંચાલક is
        told "Saved", and the name on the button is not the name he saved.

        The trigger in 0019 refuses the same value, by testing `jsonb_typeof(...) = 'string'`.
        Two copies of one rule that disagree are worse than one rule, so they agree.
      */
      if (typeof item.label !== 'string') {
        return { ok: false, gu: `"${name}" must have a name written as text.` };
      }
      const label = item.label.replace(/\s+/g, ' ').trim();
      if (!label) return { ok: false, gu: `"${name}" cannot have an empty name.` };
      if (label.length > NAV_LABEL_MAX) {
        return {
          ok: false,
          gu: `"${name}": ${NAV_LABEL_MAX} characters or fewer - the name has to fit under an icon on a phone.`,
        };
      }
    }

    /*
      §4 — a future item may sit in the list; it may not stand in the bar.

      Checked against the registry's `ready`, which is a fact about src/App.jsx and not
      anything the row can claim. This is what kept ક્રમાંક a placeholder for as long as it was
      one: the panel can show such a row, the સંચાલક can read why it is off, and no save and
      no curl can turn it into a button that navigates to a route that does not exist.

      A custom item has no `ready` and needs none. Its equivalent question was asked and
      answered above, by navRouteError(): every entry in NAV_ROUTES is a route src/App.jsx
      serves — scripts/test-navigation.mjs asserts exactly that, in both directions — so an
      item that survived the route check is pointing at a page this build has.
    */
    if (!custom && item.visible && item.enabled && !reg.ready) {
      return { ok: false, gu: `"${name}" is not built yet, so it cannot be shown.` };
    }
  }

  const shown = items.filter((i) => i.visible && i.enabled);

  if (shown.length < MOBILE_NAV_MIN) {
    return {
      ok: false,
      gu: `Show at least ${MOBILE_NAV_MIN} items - one button is not a navigation bar.`,
    };
  }
  if (shown.length > MOBILE_NAV_MAX) {
    return {
      ok: false,
      gu: `Show at most ${MOBILE_NAV_MAX} items - more than that and the labels stop fitting on a 320px phone.`,
    };
  }

  /*
    §8, and the reason it is checked here as well as in the panel and in the database.

    `find(...)?.visible` is not enough on its own — an item may be present, visible and
    `enabled: false`, which renders nothing. All three have to hold, because all three are
    ways of taking the way home off the screen.
  */
  const req = items.find((i) => i.key === NAV_REQUIRED_KEY);
  const reqLabel = BY_KEY.get(NAV_REQUIRED_KEY).label;
  if (!req || !req.visible || !req.enabled) {
    return {
      ok: false,
      gu: `"${reqLabel}" cannot be switched off - it is the way back from every other page.`,
    };
  }

  return { ok: true };
}

/**
 * A configuration ready to be written, from whatever the panel is holding.
 *
 * Renumbers `sortOrder` to 1..n in the order given and drops everything the row has no
 * business carrying. The panel's list is a React state object with drag handles and dirty
 * flags attached; what goes into jsonb is these six fields, in this order, and nothing else.
 *
 * Renumbering rather than saving the numbers already there is the point of §6's "do not rely
 * on array position alone": the સંચાલક has just dragged rows around, so the *positions* are
 * the truth and the old numbers are stale. This is the one place array position is allowed to
 * decide an order, and it is allowed because it is immediately turned into a stored number
 * that nothing downstream may re-derive.
 *
 * `route` is written even though the resolver ignores it, because the brief asks the stored
 * item to carry one and because a row that can be read on its own — in psql, in a backup, in
 * the audit trail's `after` blob — is worth more than four saved bytes. It is taken from the
 * registry, never from the caller.
 */
export function toStoredMobileNav(items) {
  return items
    .filter((i) => navDestination(i))
    .map((i, idx) => {
      const custom = isCustomKey(i.key);
      const dest = navDestination(i);
      const label = String(i.label ?? '').replace(/\s+/g, ' ').trim();
      return {
        key: custom ? i.key : dest.key,
        label: label && label.length <= NAV_LABEL_MAX ? label : dest.label,
        icon: NAV_ICONS.includes(i.icon) ? i.icon : dest.icon,
        // The registry's for a built-in, the destination table's for a custom one. Both are
        // read off a frozen object in code; what the caller handed in was only ever used to
        // FIND that object, never copied out of. That is the sentence the whole file header
        // is about, and it is why a `route` written here can be trusted by whoever reads the
        // row next in psql.
        route: dest.route,
        visible: i.visible !== false,
        enabled: i.enabled !== false,
        sortOrder: idx + 1,
      };
    });
}

/*
  Nothing here writes `type` or `isCustom`, and that is deliberate rather than an omission.

  The key already says which kind an item is, and a second field saying the same thing is a
  second field that can disagree with the first — see NAV_CUSTOM_PREFIX. The panel gets
  `type` and `isCustom` from the RESOLVER, derived, on every read. What goes into jsonb is the
  seven fields above and nothing else, exactly as it was before custom items existed: for a
  built-in row the output of this function is byte for byte what it always was, which is what
  makes the panel's saved-vs-working comparison, and every configuration already stored,
  survive this change untouched.
*/

/**
 * Move one item to a new index, returning a new list — the whole of what a drag, or an
 * arrow key, does to the order.
 *
 * Here rather than in the panel because it is the one piece of reordering that has a wrong
 * answer: splicing out before computing the destination index shifts every position after the
 * source by one, so dragging an item downward lands it one row short of where it was dropped.
 * That is a bug you fix twice — once for the mouse and once for the keyboard — unless both
 * call the same function, and it is testable here without a browser (scripts/test-navigation.mjs).
 *
 * Out-of-range indices are clamped rather than refused: a drop past the end of the list is a
 * perfectly clear instruction, and a keyboard user pressing ↓ on the last row should be a
 * no-op rather than an error.
 */
export function reorder(items, from, to) {
  const list = [...items];
  if (!Number.isInteger(from) || from < 0 || from >= list.length) return list;
  const dest = Math.max(0, Math.min(list.length - 1, to));
  if (dest === from) return list;
  const [moved] = list.splice(from, 1);
  list.splice(dest, 0, moved);
  return list;
}
