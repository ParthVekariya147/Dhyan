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

  // Unknown and not-yet-built keys go before validation, not after: they are the two ways a
  // perfectly good configuration can arrive at a build that is older or newer than the one
  // that wrote it, and neither is damage.
  const known = clean.filter((i) => BY_KEY.get(i.key)?.ready);

  const list = known.length && validateMobileNav(known).ok ? known : DEFAULT_MOBILE_NAV;

  return (
    list
      .map((s, i) => {
        const reg = BY_KEY.get(s.key);
        const label = typeof s.label === 'string' ? s.label.replace(/\s+/g, ' ').trim() : '';
        const order = readOrder(s);
        return {
          key: reg.key,
          // Code's, always. The whole file header is about this line.
          route: reg.route,
          label: label && label.length <= NAV_LABEL_MAX ? label : reg.label,
          icon: NAV_ICONS.includes(s.icon) ? s.icon : reg.icon,
          visible: s.visible !== false,
          enabled: s.enabled !== false,
          sortOrder: Number.isInteger(order) && order >= 1 ? order : i + 1,
          required: reg.required === true,
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

  const seen = new Set();
  for (const item of items) {
    if (!item || typeof item !== 'object') {
      return { ok: false, gu: 'The navigation list has an entry that is not an item.' };
    }

    const reg = BY_KEY.get(item.key);
    if (!reg) {
      return { ok: false, gu: `"${item.key}" is not a navigation item this app has.` };
    }
    if (seen.has(item.key)) {
      return { ok: false, gu: `"${reg.label}" appears twice in the list.` };
    }
    seen.add(item.key);

    if (typeof item.visible !== 'boolean' || typeof item.enabled !== 'boolean') {
      return { ok: false, gu: `"${reg.label}": shown and enabled must each be set.` };
    }

    const order = readOrder(item);
    if (!Number.isInteger(order) || order < 1) {
      return { ok: false, gu: `"${reg.label}" has no position in the order.` };
    }

    /*
      A route may be stored — the brief asks for the field — but it may only be the one the
      registry already holds. The resolver ignores it entirely, so this refusal is not what
      keeps a yuvak safe; it is what stops the panel from *displaying* a destination that no
      button will ever go to. A row whose route disagrees with the registry is a row
      something other than the panel wrote, and saying so is more useful than correcting it.
    */
    if (item.route !== undefined && item.route !== reg.route) {
      return { ok: false, gu: `"${reg.label}" cannot be pointed at a different page.` };
    }

    if (item.icon !== undefined && !NAV_ICONS.includes(item.icon)) {
      return { ok: false, gu: `"${reg.label}" has an icon this app cannot draw.` };
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
        return { ok: false, gu: `"${reg.label}" must have a name written as text.` };
      }
      const label = item.label.replace(/\s+/g, ' ').trim();
      if (!label) return { ok: false, gu: `"${reg.label}" cannot have an empty name.` };
      if (label.length > NAV_LABEL_MAX) {
        return {
          ok: false,
          gu: `"${reg.label}": ${NAV_LABEL_MAX} characters or fewer - the name has to fit under an icon on a phone.`,
        };
      }
    }

    /*
      §4 — a future item may sit in the list; it may not stand in the bar.

      Checked against the registry's `ready`, which is a fact about src/App.jsx and not
      anything the row can claim. This is what keeps ક્રમાંક a placeholder: the panel can
      show it, the સંચાલક can read why it is off, and no save and no curl can turn it into a
      button that navigates to a route that does not exist.
    */
    if (item.visible && item.enabled && !reg.ready) {
      return { ok: false, gu: `"${reg.label}" is not built yet, so it cannot be shown.` };
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
    .filter((i) => BY_KEY.has(i.key))
    .map((i, idx) => {
      const reg = BY_KEY.get(i.key);
      const label = String(i.label ?? '').replace(/\s+/g, ' ').trim();
      return {
        key: reg.key,
        label: label && label.length <= NAV_LABEL_MAX ? label : reg.label,
        icon: NAV_ICONS.includes(i.icon) ? i.icon : reg.icon,
        route: reg.route,
        visible: i.visible !== false,
        enabled: i.enabled !== false,
        sortOrder: idx + 1,
      };
    });
}

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
