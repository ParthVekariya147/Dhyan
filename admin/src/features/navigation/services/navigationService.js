import { supabase } from '../../../lib/supabase';
import {
  MOBILE_BOTTOM_KEY,
  NAV_REGISTRY,
  NAV_SETTINGS_DOC,
  navRegistryEntry,
  resolveMobileNavConfig,
  toStoredMobileNav,
  validateMobileNav,
} from '../../../../../shared/domain/navigation.js';

/**
 * §34, §9 — the phone's bottom bar, read and written the same way every other setting is.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why this is a service of its own and not two more exports on settingsService.js
 * ────────────────────────────────────────────────────────────────────────────
 *
 * It reads and writes a different row. `settings/app` is the row four yuvak hooks patch;
 * `settings/nav` is a list written by one page behind one confirmation, and
 * shared/domain/navigation.js is explicit that keeping the two apart is what stops a list
 * from being dropped by a merge that was only ever thinking about scalar fields. A service
 * per row keeps that separation visible at the import line rather than only in a comment.
 *
 * What it does *not* do differently is the write itself: readSetting/writeSetting below are
 * the same two functions settingsService.js has, deliberately duplicated rather than
 * exported from there and shared. Two files agreeing on four lines of upsert is cheaper than
 * one file that both a settings page and a navigation page have to be read against, and the
 * duplication is nine lines long. If a third row ever needs them, that is the moment to
 * lift them — not now, on the strength of one caller.
 */

async function readSetting(key) {
  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('key', key)
    .maybeSingle();
  if (error) throw error;
  return data?.value ?? {};
}

/**
 * Merge, never replace — settingsService.js's rule, and here it is not a precaution but a
 * dated appointment.
 *
 * shared/domain/navigation.js says in as many words that §9's desktop sidebar becomes a
 * second key in *this* row (`desktopSidebar`), resolved by a second function. So a whole-
 * object write from this page is not a hypothetical loss of a field somebody else owns: it
 * is the guaranteed deletion of the sidebar configuration on the first save after that key
 * ships, with nothing on any screen to say the panel had just thrown it away.
 *
 * The merge happens here rather than in SQL for the reason settingsService.js gives: the
 * caller already holds the current value, and a jsonb_set per key would be a round trip per
 * field for no gain.
 */
async function writeSetting(key, patch) {
  const current = await readSetting(key);
  const { error } = await supabase
    .from('settings')
    .upsert(
      { key, value: { ...current, ...patch }, updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    );
  if (error) throw error;
}

/**
 * ────────────────────────────────────────────────────────────────────────────
 * What the panel is given to edit: the configuration, plus everything not yet in it
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `resolveMobileNavConfig()` answers "what has been configured" — every stored item
 * including the switched-off ones. That is the right half of the question and only the right
 * half: a row that was saved with four items resolves to four, and the panel would then show
 * four rows and no way at all to reach દર્શન or લેવલ ૪. The સંચાલક would have to conclude
 * that the five he cannot see do not exist, which is the exact failure the registry's own
 * note about ક્રમાંક argues against — a panel that simply does not mention an item invites
 * the question every month.
 *
 * So the list handed to the page is the union, and the order of the union is decided rather
 * than incidental:
 *
 *   1. the configured items, in the order the resolver sorted them into. Their order is the
 *      સંચાલક's own arrangement and is the one thing here that must survive a round trip
 *      untouched — appending to it is safe, interleaving anything into it is not.
 *   2. every registry item the stored row does not name, in NAV_REGISTRY's order, at the
 *      end, switched off. Registry order rather than alphabetical or "ready first", because
 *      the registry is already written in the order a યુવક meets these things and the two
 *      not-built items already sit last in it.
 *
 * They arrive `visible: false, enabled: false` rather than defaulting to on. An item the
 * panel invented for the list is not something anybody asked to be in the bar, and a screen
 * that opens with two more buttons than the row it just read is a screen that changed the
 * app by being looked at.
 *
 * `ready` is carried on each item because the page has to disable a control and explain why,
 * and `ready` is the fact that decides it. It is attached here rather than looked up per
 * render in the page so there is one place where "this came from the registry, not from the
 * row" is true. `toStoredMobileNav()` drops it on the way out, along with every other field
 * the row has no business carrying.
 */
export async function getMobileNav() {
  const stored = await readSetting(NAV_SETTINGS_DOC);
  const configured = resolveMobileNavConfig(stored?.[MOBILE_BOTTOM_KEY]);

  /*
    Only the BUILT-INS are appended, and that asymmetry is the point of the two halves.

    A registry item the row does not name is an item the app has and the સંચાલક has not
    arranged yet — it exists whether or not anybody configured it, so the panel invents a
    switched-off row for it rather than leaving દર્શન apparently non-existent.

    A custom item is the opposite: it exists ONLY because somebody made it, so there is
    nothing to append. What the row holds is the complete list of them, and one that is not in
    `configured` is one that was deleted or one whose destination this build no longer serves —
    in both cases an item the panel must not resurrect.
  */
  const seen = new Set(configured.map((i) => i.key));
  const rest = NAV_REGISTRY.filter((r) => !seen.has(r.key)).map((r) => ({
    key: r.key,
    // Code's route, exactly as the resolver takes it — this list must not have two
    // provenances for one field depending on which half of it you are looking at.
    route: r.route,
    label: r.label,
    icon: r.icon,
    visible: false,
    enabled: false,
    required: r.required === true,
    isCustom: false,
    type: 'builtin',
  }));

  return [...configured, ...rest].map((item, idx) => ({
    ...item,
    // Renumbered across the whole union. The resolver numbered the configured half from the
    // stored values and the appended half has never had a number at all, so leaving the two
    // as they came would produce a list whose positions collide — and `sortOrder` is the
    // field the panel's position column, its arrows and its preview all read.
    sortOrder: idx + 1,
    /*
      `ready` is a fact about src/App.jsx, and for a built-in the registry is where that fact
      is written down. A custom item has no registry entry, so navRegistryEntry() answers null
      for it — and `false` would be the wrong reading of that null: it would put "This page
      does not exist in the app yet" on a row whose destination the resolver has just looked
      up in NAV_ROUTES and found. Every route in that table is one this build serves, so an
      item that survived resolution is ready by construction.
    */
    ready: item.isCustom ? true : navRegistryEntry(item.key)?.ready === true,
  }));
}

/**
 * One write, for one press of one button.
 *
 * settingsService.js explains why that matters and it applies here unchanged: the
 * `audit_settings` trigger (0004_rbac.sql) records a settings write as one SETTINGS_UPDATED,
 * so saving the order and then the labels — or the four visible items and then the five
 * hidden ones — would put two entries in the log for one edit, and a reader of the audit
 * trail would see a change that never happened. Everything the page holds goes into a single
 * upsert.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Validated here as well as in the page, and neither of those is the guarantee
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The page validates as he types and again when he presses Save, because a refusal is only
 * useful next to the control that caused it. This one exists because a service that will
 * write anything it is handed is a service that can be called from somewhere that forgot —
 * a future bulk action, a "copy from another project" import, a keyboard path nobody
 * measured. The database trigger in 0019 is the actual guarantee, and it has to be: the row
 * is writable through PostgREST by anyone `settings.update` admits, with no obligation to go
 * anywhere near this file.
 *
 * The refusal is thrown rather than returned so a caller cannot ignore it by not reading the
 * result, and it is tagged `navInvalid` so the page can show the sentence itself. Without the
 * tag it would arrive at `saveError()` as a plain Error with no code and be replaced by
 * "There was a problem saving. Please try again." — which is precisely the "invalid
 * configuration" non-answer shared/domain/navigation.js spells its messages out to avoid.
 */
export async function updateMobileNav(items) {
  const rows = toStoredMobileNav(items);

  // Validated on the rows that are about to be *written*, not on the panel's working copy.
  // toStoredMobileNav() renumbers, trims labels and substitutes the registry's own values
  // for anything unusable, so the two lists are not the same list — and the only one worth
  // refusing is the one that would end up in the row.
  const v = validateMobileNav(rows);
  if (!v.ok) {
    const err = new Error(v.gu);
    err.navInvalid = true;
    throw err;
  }

  await writeSetting(NAV_SETTINGS_DOC, { [MOBILE_BOTTOM_KEY]: rows });
}
