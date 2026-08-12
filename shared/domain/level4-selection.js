/**
 * લેવલ ૪ — which દ્રશ્યો go into which પ્રવૃત્તિ, and whether that division holds together.
 *
 * A લેવલ ૪ configuration is a partition of the દર્શન: ૪.૧ holds some દ્રશ્યો, ૪.૨ holds
 * others, and a યુવક passes one by ticking every number in it. Everything on this page is
 * about that partition and nothing else — no React, no Supabase, no DOM. The સંચાલક panel
 * builds an assignment with these functions and the યુવક app reads a published one with the
 * same functions, so "is this range valid?" cannot be answered one way in the builder and
 * another way on the screen (§46).
 *
 * Two things are load-bearing everywhere below:
 *
 *  1. **Identity is the id, never the array position** (§25). A દ્રશ્ય's *printed* number is
 *     what a સંચાલક types and what a યુવક ticks, but it is a property he may renumber — so
 *     ranges are read in printed numbers and immediately turned into stable ids.
 *
 *  2. **Nothing here knows a total.** Not 110, not 109, not 108, and no `'4.1'` (§6 rules
 *     1–2). Every count comes from the collection or from the activity's own item list; a
 *     collection of 12 or of 400 needs no edit here.
 *
 * `collection` is whatever `useScenes()` or `listDarshan()` hands back. The two disagree
 * about field names — the manifest calls them `n`/`t`/`url`, the panel's DarshanItem calls
 * them `index`/`caption`/`imageUrl` — so every read goes through the small accessors below
 * and both shapes work. That is not defensive coding; both callers are real.
 */

import { darshanId, isLearnable } from './darshan.js';
// The ક્રમ column is allowed to be written in Gujarati digits, and so is the સંચાલક's range
// box and his search box — `૧૦૯` and `109` are the same number and refusing one of them
// would be a mystery to whoever typed it. That rule already exists, once, for the sheet
// importer; reusing it is how it stays one rule.
import { toNumber } from './sheet-import.js';
import { gu } from './constants.js';

// ==================================================================== reading a collection

/** The printed number. `index` in the panel's shape, `n` in the manifest's. */
const entryIndex = (e) =>
  Number.isInteger(e?.index) ? e.index : Number.isInteger(e?.n) ? e.n : null;

/** Presentation order, which defaults to the printed number but may diverge (§32). */
const entryOrder = (e) => (Number.isInteger(e?.order) ? e.order : entryIndex(e));

/** The વર્ણન. */
const entryText = (e) => String(e?.t ?? e?.caption ?? '');

/** The image link. */
const entryImage = (e) => String(e?.url ?? e?.imageUrl ?? '');

/** Stable identity, synthesised from the printed number only when the entry carries none. */
const entryId = (e) => {
  if (e?.id) return String(e.id);
  const n = entryIndex(e);
  return n === null ? '' : darshanId(n);
};

/**
 * May a યુવક be asked to recall this દ્રશ્ય?
 *
 * The same `isLearnable` the feed and the panel apply, fed a normalised view of whichever
 * shape arrived — stated once so the panel's idea of "assignable" cannot drift from the
 * app's idea of "visible". A દ્રશ્ય with no picture or no વર્ણન has never been shown to
 * anybody, so putting it in a પ્રવૃત્તિ would ask him to remember something he was never
 * taught: an unpassable પ્રવૃત્તિ, and every later one locked behind it.
 */
const isPublished = (e) =>
  isLearnable({ active: e?.active, t: entryText(e), url: entryImage(e) });

/** Order last, never first: a દ્રશ્ય the સંચાલક has not numbered still has to appear. */
const orderKey = (row) => (Number.isInteger(row.order) ? row.order : Number.MAX_SAFE_INTEGER);

/**
 * The collection, read once into the three lookups every function here wants.
 *
 * `ordered` is the collection's own order (`order ?? n`, §26) — the order the સંચાલક set
 * and the યુવક sees. It is never a re-sort by id, by index, or by anything else, because
 * ક્રમ કદી તૂટે નહીં: a stored id list re-ordered through `rank` comes back in exactly the
 * order the દર્શન is presented in.
 *
 * A repeated id keeps its first appearance. `validateDarshanItems` already reports a
 * duplicate id as an error against the content itself; silently letting the second row win
 * here would change which વર્ણન the સંચાલક is looking at while he divides.
 */
function indexed(collection) {
  const rows = (Array.isArray(collection) ? collection : [])
    .filter((e) => e && typeof e === 'object')
    .map((entry, at) => ({
      at,
      entry,
      id: entryId(entry),
      index: entryIndex(entry),
      order: entryOrder(entry),
      text: entryText(entry),
      published: isPublished(entry),
    }))
    .filter((r) => r.id);

  const byId = new Map();
  for (const r of rows) if (!byId.has(r.id)) byId.set(r.id, r);

  const unique = [...byId.values()];
  // `at` breaks ties so the result does not depend on sort stability, the way resolveLevels
  // falls back to levelId.
  const ordered = [...unique].sort((a, b) => orderKey(a) - orderKey(b) || a.at - b.at);
  const rank = new Map(ordered.map((r, i) => [r.id, i]));

  return { rows: unique, ordered, byId, rank };
}

/** A list of usable scene ids — whatever arrived, with the holes taken out. */
const cleanIds = (ids) =>
  (Array.isArray(ids) ? ids : []).map((id) => String(id ?? '').trim()).filter(Boolean);

/** …and each one only once, first occurrence winning. */
const uniqueIds = (ids) => [...new Set(cleanIds(ids))];

/** `[{ activityKey, sceneIds }]` → the pairs it actually contains. */
function* pairs(assignments) {
  for (const a of Array.isArray(assignments) ? assignments : []) {
    if (!a || typeof a !== 'object') continue;
    const key = a.activityKey ?? '';
    for (const sceneId of cleanIds(a.sceneIds)) yield { key, sceneId };
  }
}

/** Every id assigned anywhere, in first-appearance order. */
const assignedIds = (assignments) => [...new Set([...pairs(assignments)].map((p) => p.sceneId))];

/** A number as a person may have typed it: `7`, `'7'`, `' ૭ '`. */
const toIndexNumber = (value) => toNumber(value);

// ==================================================================== building a selection

/**
 * "દ્રશ્ય ૧ થી ૩૦" → the thirty ids that names.
 *
 * Read in **printed numbers**, returned as ids. Array position is never identity (§25), so
 * a range is not `slice(from - 1, to)`: with one દ્રશ્ય renumbered or one withdrawn, that
 * silently selects a different thirty than the one the સંચાલક typed.
 *
 * Three tolerances, each because a person is typing:
 *
 *   - `from > to` is the same range said backwards, so the two are swapped rather than
 *     returning nothing and looking broken.
 *   - Gujarati digits are accepted, as everywhere else a number is typed.
 *   - A number that names no દ્રશ્ય is simply not in the result. `૧–૨૦૦` over a collection
 *     that stops at ૧૦૯ selects what exists; it never invents ids for the rest, which
 *     would put ninety-one દ્રશ્યો that do not exist into a પ્રવૃત્તિ nobody could pass.
 *
 * Withheld દ્રશ્યો inside the range are **kept**, not quietly dropped, so `validateAssignment`
 * can tell the સંચાલક they are in there. Dropping them would leave him with a range that
 * silently shrank and no reason given.
 */
export function expandRange(collection, fromIndex, toIndex) {
  const a = toIndexNumber(fromIndex);
  const b = toIndexNumber(toIndex);
  if (a === null || b === null) return [];

  const lo = Math.min(a, b);
  const hi = Math.max(a, b);

  return indexed(collection)
    .ordered.filter((r) => r.index !== null && r.index >= lo && r.index <= hi)
    .map((r) => r.id);
}

/**
 * n દ્રશ્યો into k પ્રવૃત્તિઓ — a convenience, and only that (§6).
 *
 * It is a button that fills the boxes, not a rule about how લેવલ ૪ works: the સંચાલક may
 * change every one of them afterwards, and nothing downstream asks whether an assignment
 * came from here. Read as a business rule it would be wrong — the natural division of the
 * દર્શન is a matter of meaning, not arithmetic.
 *
 * What it does guarantee is the arithmetic: every id appears **exactly once**, in the
 * collection's given order, and no two parts differ in size by more than one. The remainder
 * goes to the earliest parts, so ૧૦૯ into ૪ is 28/27/27/27 rather than 27/27/27/28 — the
 * heavier ones first, which is how a person dividing a book by hand does it.
 *
 * `parts` greater than the number of દ્રશ્યો still returns `parts` lists; the last ones are
 * empty. That is the same rule, not an exception (base 0, remainder spread over the first
 * few), and returning fewer lists than were asked for would silently drop પ્રવૃત્તિઓ the
 * સંચાલક had already named. An empty પ્રવૃત્તિ is reported by `validateAssignment`.
 */
export function autoDivide(sceneIds, parts) {
  const ids = uniqueIds(sceneIds);
  const n = Math.floor(Number(parts));
  if (!Number.isFinite(n) || n < 1) return [];

  const base = Math.floor(ids.length / n);
  const remainder = ids.length % n;

  const out = [];
  let at = 0;
  for (let i = 0; i < n; i++) {
    const size = base + (i < remainder ? 1 : 0);
    out.push(ids.slice(at, at + size));
    at += size;
  }
  return out;
}

// ==================================================================== what is wrong with it

/**
 * §7 A — a દ્રશ્ય in two પ્રવૃત્તિઓ.
 *
 * The partition is the whole idea: a યુવક who has passed ૪.૧ has been credited with those
 * દ્રશ્યો, and §2.2's coverage rule then counts them towards every other પ્રવૃત્તિ that
 * contains them — so a દ્રશ્ય in both ૪.૧ and ૪.૨ hands out ૪.૨ for free, or half of it.
 *
 * Repeats **within** one પ્રવૃત્તિ are reported too, with that key appearing twice in
 * `activityKeys`. The database's primary key `(activity_id, scene_id)` makes them
 * impossible to store, which is exactly why the builder should say so before the save
 * rather than let Postgres phrase the complaint.
 *
 * @param {Array<{activityKey: *, sceneIds: string[]}>} assignments
 * @returns {Array<{sceneId: string, activityKeys: *[]}>} in first-appearance order
 */
export function findDuplicates(assignments) {
  const keysOf = new Map();
  const order = [];

  for (const { key, sceneId } of pairs(assignments)) {
    if (!keysOf.has(sceneId)) {
      keysOf.set(sceneId, []);
      order.push(sceneId);
    }
    keysOf.get(sceneId).push(key);
  }

  return order
    .filter((sceneId) => keysOf.get(sceneId).length > 1)
    .map((sceneId) => ({ sceneId, activityKeys: keysOf.get(sceneId) }));
}

/**
 * §7 B — દ્રશ્યો the division forgot.
 *
 * Only દ્રશ્યો a યુવક can actually be shown are counted. A દ્રશ્ય with no picture or no વર્ણન
 * is not "missing from લેવલ ૪"; it is missing from દર્શન, which `validateDarshanItems`
 * already says in the place where it can be fixed. Counting it here would leave the સંચાલક
 * with an unsatisfiable job: assigning it raises §7 E, and not assigning it raises §7 B.
 *
 * @returns {string[]} in collection order (§26)
 */
export function findMissing(assignments, collection) {
  const taken = new Set(assignedIds(assignments));
  return indexed(collection)
    .ordered.filter((r) => r.published && !taken.has(r.id))
    .map((r) => r.id);
}

/**
 * §7 D and E — an assigned id that no યુવક could be asked about.
 *
 * Two different problems with one shape: the id names nothing in the collection at all (a
 * દ્રશ્ય deleted or renamed after the config was written), or it names a દ્રશ્ય that is there
 * but withheld — hidden, or still without its picture or its વર્ણન. Both are returned here
 * because the contract's return is a flat id list; `validateAssignment` is where they part
 * company, because "does not exist" and "not published" send the સંચાલક to two different
 * screens.
 *
 * This is the check that stands in for the foreign key `level4_activity_items.scene_id`
 * deliberately does not have (§1): `public.scenes` is a sparse overlay, so most દ્રશ્યો have
 * no row to point at and a FK would reject nearly all of them.
 *
 * @returns {string[]} in first-appearance order
 */
export function findInvalid(assignments, collection) {
  const { byId } = indexed(collection);
  return assignedIds(assignments).filter((id) => {
    const row = byId.get(id);
    return !row || !row.published;
  });
}

/** One error/warning. Gujarati for a યુવક-facing surface, English for the panel (§6 rule 6). */
const issue = (code, gujarati, english, extra = {}) => ({ code, gu: gujarati, en: english, ...extra });

/** `1 scene` / `2 scenes`, so no message reads like a machine wrote it. */
const s = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The whole division, judged at once — what the સંચાલક sees before he saves and before he
 * publishes.
 *
 * `ok` means *this configuration is sound*, not *this keystroke is allowed*: a half-built
 * draft legitimately fails, and the builder is free to save it anyway and act on `errors`
 * as advice. Publishing is where `ok` has to be obeyed, because everything below is a way
 * for a યુવક to reach a પ્રવૃત્તિ he cannot pass — and a પ્રવૃત્તિ that cannot be passed locks
 * every later one behind it forever (§2.2). ફક્ત આનંદ, નિરાશા નહીં begins here, before he
 * ever opens the screen.
 *
 * `requireFullCoverage` is the સંચાલક's own decision and the only thing that changes
 * severity: a config that deliberately teaches ૧–૫૦ this month has fifty-nine દ્રશ્યો in no
 * પ્રવૃત્તિ and that is not a fault. When he has said the division must cover દર્શન, it is.
 *
 * @param {object}  input
 * @param {Array<{activityKey: *, sceneIds: string[]}>} input.assignments
 * @param {Array}   input.collection
 * @param {boolean} [input.requireFullCoverage]
 * @returns {{ok: boolean, errors: object[], warnings: object[]}}
 */
export function validateAssignment({ assignments, collection, requireFullCoverage = false } = {}) {
  const { byId } = indexed(collection);
  const errors = [];
  const warnings = [];

  // §7 C's JS half. The database's unique (config_id, code) refuses this outright; caught
  // here because otherwise every id the two share is reported as "assigned to ૪.૧ and ૪.૧",
  // which sends the સંચાલક looking for a duplicate that is not the real fault.
  const keys = [];
  const repeatedKeys = [];
  for (const a of Array.isArray(assignments) ? assignments : []) {
    if (!a || typeof a !== 'object') continue;
    const key = a.activityKey ?? '';
    if (keys.includes(key) && !repeatedKeys.includes(key)) repeatedKeys.push(key);
    keys.push(key);
  }
  if (repeatedKeys.length) {
    errors.push(
      issue(
        'duplicate-activity-key',
        `${gu(repeatedKeys.length)} પ્રવૃત્તિ બે વાર આવે છે.`,
        `${s(repeatedKeys.length, 'activity')} appear more than once — each must be listed once.`,
        { activityKeys: repeatedKeys }
      )
    );
  }

  // §7 A
  const duplicates = findDuplicates(assignments);
  if (duplicates.length) {
    errors.push(
      issue(
        'duplicate-scene',
        `${gu(duplicates.length)} દ્રશ્ય એક કરતાં વધુ પ્રવૃત્તિમાં છે. દરેક દ્રશ્ય એક જ પ્રવૃત્તિમાં હોવું જોઈએ.`,
        `${s(duplicates.length, 'scene')} assigned to more than one activity — each scene belongs to exactly one.`,
        {
          sceneIds: duplicates.map((d) => d.sceneId),
          activityKeys: [...new Set(duplicates.flatMap((d) => d.activityKeys))],
        }
      )
    );
  }

  // §7 D and §7 E, told apart. One is content that vanished, the other is content that is
  // not ready — the first is fixed in this builder, the second on the દર્શન screen.
  const assigned = assignedIds(assignments);
  const unknown = assigned.filter((id) => !byId.has(id));
  const withheld = assigned.filter((id) => byId.has(id) && !byId.get(id).published);

  if (unknown.length) {
    errors.push(
      issue(
        'unknown-scene',
        `${gu(unknown.length)} દ્રશ્ય દર્શનમાં નથી.`,
        `${s(unknown.length, 'scene')} in this configuration no longer exist in the collection.`,
        { sceneIds: unknown }
      )
    );
  }
  if (withheld.length) {
    errors.push(
      issue(
        'unpublished-scene',
        `${gu(withheld.length)} દ્રશ્ય પ્રકાશિત નથી — ચિત્ર કે વર્ણન નથી, અથવા છુપાવેલું છે.`,
        `${s(withheld.length, 'scene')} not published — no image, no description, or hidden. A yuvak has never seen them.`,
        { sceneIds: withheld }
      )
    );
  }

  // An empty પ્રવૃત્તિ can never be completed: §2.2 requires items ≠ ∅, and `level4_submit`
  // passes only when the required list is non-empty. Published, it is a wall.
  const emptyKeys = (Array.isArray(assignments) ? assignments : [])
    .filter((a) => a && typeof a === 'object' && cleanIds(a.sceneIds).length === 0)
    .map((a) => a.activityKey ?? '');
  if (emptyKeys.length) {
    errors.push(
      issue(
        'empty-activity',
        `${gu(emptyKeys.length)} પ્રવૃત્તિમાં એકપણ દ્રશ્ય નથી — ખાલી પ્રવૃત્તિ કદી પૂરી થઈ શકે નહીં.`,
        `${s(emptyKeys.length, 'activity')} have no scenes — an empty activity can never be completed, and it locks every activity after it.`,
        { activityKeys: emptyKeys }
      )
    );
  }

  // §7 B — an error or a warning depending on what the સંચાલક said he was building.
  const missing = findMissing(assignments, collection);
  if (missing.length) {
    const m = issue(
      'missing-scene',
      `${gu(missing.length)} દ્રશ્ય કોઈ પ્રવૃત્તિમાં નથી.`,
      `${s(missing.length, 'scene')} in the collection are not in any activity.`,
      { sceneIds: missing }
    );
    (requireFullCoverage ? errors : warnings).push(m);
  }

  return { ok: errors.length === 0, errors, warnings };
}

// ==================================================================== reading it back

/**
 * A stored id list, back in the order the દર્શન is actually presented in (§26).
 *
 * ક્રમ કદી તૂટે નહીં — the same rule `inOrder()` applies on the યુવક side, for the same
 * reason: item positions are stored per-activity, but the સંચાલક may renumber or reorder
 * the દર્શન afterwards, and a list that keeps its old order would show ૧૨ before ૭.
 *
 * Ids the collection does not know are kept, at the end, in the order they arrived. The
 * યુવક-side `inOrder()` drops them, which is right for a screen; dropping them here would
 * hide from the સંચાલક exactly what `findInvalid` is trying to show him.
 */
export function orderSceneIds(sceneIds, collection) {
  const { rank } = indexed(collection);
  const ids = uniqueIds(sceneIds);
  return [
    ...ids.filter((id) => rank.has(id)).sort((a, b) => rank.get(a) - rank.get(b)),
    ...ids.filter((id) => !rank.has(id)),
  ];
}

/**
 * The builder's search box: a number, or words out of the વર્ણન.
 *
 * A number is matched on the **printed** number, and by prefix — typing `૧૦` while looking
 * for ૧૦૫ should not have to be finished before anything appears, and typing the whole
 * number still puts the exact દ્રશ્ય in the results. Gujarati and Latin digits are the same
 * query; `૧૦૯` and `109` are the same દ્રશ્ય.
 *
 * Anything else is a substring of the વર્ણન, matched case-insensitively (which does nothing
 * in Gujarati and everything for an ASCII note). An empty query is not "no દ્રશ્યો" but
 * "no filter yet" — it returns the whole collection, so the box opens onto the દર્શન rather
 * than onto nothing.
 *
 * @returns {Array} the matching collection entries, in collection order (§26)
 */
export function searchScenes(collection, query) {
  const { ordered } = indexed(collection);
  const q = String(query ?? '').trim();
  if (!q) return ordered.map((r) => r.entry);

  const digitsOnly = /^[0-9૦-૯]+$/.test(q);
  const n = digitsOnly ? toNumber(q) : null;
  const prefix = n === null ? '' : String(n);
  const needle = q.toLowerCase();

  return ordered
    .filter((r) => {
      if (n !== null && r.index !== null && String(r.index).startsWith(prefix)) return true;
      return r.text.toLowerCase().includes(needle);
    })
    .map((r) => r.entry);
}

/**
 * What a selection amounts to — the admin's preview line and the યુવક's card ("૧–૩૦").
 *
 * `contiguous` is the question the label depends on, and it is asked of the **collection**,
 * not of arithmetic: a selection is contiguous when it is precisely every દ્રશ્ય the
 * collection has between its first and last printed numbers. So a દર્શન numbered ૧…૧૦૯ with
 * ૪૭ never issued still reads "૧–૫૦" for the first fifty દ્રશ્યો that exist, which is what
 * the સંચાલક means and what the યુવક counts. A selection with an unknown id in it is not
 * contiguous — there is a દ્રશ્ય in there that has no number to print.
 *
 * `count` counts every distinct id in the selection, known or not, because that is how many
 * items the પ્રવૃત્તિ holds and how many ticks it will take to pass.
 *
 * @returns {{count: number, fromIndex: number|null, toIndex: number|null, contiguous: boolean}}
 */
export function summarise(sceneIds, collection) {
  const { byId, ordered } = indexed(collection);
  const ids = uniqueIds(sceneIds);

  const numbers = ids
    .map((id) => byId.get(id)?.index)
    .filter((i) => Number.isInteger(i))
    .sort((a, b) => a - b);

  if (!numbers.length) {
    return { count: ids.length, fromIndex: null, toIndex: null, contiguous: false };
  }

  const fromIndex = numbers[0];
  const toIndex = numbers[numbers.length - 1];

  const inWindow = ordered.filter((r) => r.index !== null && r.index >= fromIndex && r.index <= toIndex);
  const chosen = new Set(ids);
  const contiguous =
    ids.length === numbers.length && // nothing unknown or unnumbered is hiding in there
    inWindow.length === numbers.length &&
    inWindow.every((r) => chosen.has(r.id));

  return { count: ids.length, fromIndex, toIndex, contiguous };
}
