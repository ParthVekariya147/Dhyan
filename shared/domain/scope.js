/**
 * ────────────────────────────────────────────────────────────────────────────
 * WHOSE DATA — the zones a સંચાલક is limited to
 * ────────────────────────────────────────────────────────────────────────────
 *
 * 0043 answered *what* a person may do. This is the other half of the same question, which the
 * panel had no way to express at all until 0051: `users.read` is one bit, and it has always
 * meant every યુવક in every zone. A સંઘ that wants "he looks after વરાછા" had to choose between
 * giving him everybody and giving him nobody.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * NO ZONES MEANS EVERY ZONE
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The single rule this whole module exists to state once, in a place both apps read, rather
 * than have each screen decide for itself:
 *
 *     null / []   →  unrestricted. He sees the whole સંઘ.
 *     ['varachha'] →  he sees વરાછા and nothing else.
 *
 * Read the other way round — empty meaning "nothing" — 0051 would have taken every યુવક away
 * from every સંચાલક on the day it applied, and the panel would have come up empty for the
 * person who deployed it with no error anywhere to explain why. `caller_scope()` in the
 * database returns NULL for the unrestricted case for exactly this reason, and everything here
 * agrees with it.
 *
 * The consequence worth stating: **this file cannot tell you that somebody is restricted by
 * looking at a shorter list.** Only the presence of rows does that, which is why
 * `isUnrestricted()` is a named function rather than a `.length` check written out at each
 * call site.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * It decides what is printed, and never what is allowed
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Nothing here is a security boundary, in exactly the way `can()` in permissions.js is not.
 * The narrowing happens in `public.scoped_profiles`, in twelve restrictive policies and in
 * `admin_assert_in_scope()` — all of them inside the database, all of them reading
 * `auth.uid()`, none of them reachable from a browser. A યુવક who edits this file out of his
 * own copy of the bundle changes which banner he is shown and nothing about which rows he gets.
 *
 * What it is for is the sentence on screen. A report that is quietly about part of the સંઘ is
 * worse than no report, so every screen that can be narrowed says so in words — and it says it
 * the same way on all of them because the wording is here.
 */

import { GEO_ID_RE } from './geography.js';

/**
 * The scope as the server sent it, in the one shape every screen reads.
 *
 * `null` out for unrestricted, and an array of zone ids otherwise. PostgREST hands back a
 * Postgres `text[]` as a JSON array, and NULL as `null`, so the common path is already the
 * right shape — this exists for the edges: an empty array (which some clients produce for an
 * empty aggregate), a value that never arrived, duplicates, and ids that are not ids.
 *
 * Sorted, so two reads of the same scope compare equal and a list does not reorder itself
 * between renders.
 */
export function normaliseScope(raw) {
  if (!Array.isArray(raw)) return null;
  const ids = [...new Set(raw.filter((z) => typeof z === 'string' && GEO_ID_RE.test(z.trim())).map((z) => z.trim()))];
  // The empty array collapses to null, which is the same statement said the shorter way. Every
  // reader below then has one case to handle instead of two that mean the same thing.
  return ids.length ? ids.sort() : null;
}

/** Does this person see everything? True for null, for [], and for anything unreadable. */
export const isUnrestricted = (scope) => normaliseScope(scope) === null;

/** Is this zone one he may see? True for everybody unrestricted - mirrors in_caller_scope(). */
export function inScope(scope, zoneId) {
  const s = normaliseScope(scope);
  return s === null || s.includes(zoneId);
}

/**
 * The zones he may see, out of the ones that exist.
 *
 * For a filter dropdown: an unrestricted સંચાલક is offered all of them, and a scoped one is
 * offered his own rather than being offered a zone whose every result would come back empty.
 * An empty option list that filters to nothing looks exactly like a zone with nobody in it,
 * which is the confusion 0050's header spends a paragraph on.
 */
export const visibleZones = (scope, zones) =>
  (Array.isArray(zones) ? zones : []).filter((z) => inScope(scope, z.id));

/**
 * One sentence naming the limit, for a banner.
 *
 * Names the zones while there are few enough to read and counts them after that. The threshold
 * is three because that is what fits on a phone's topbar, and because past three the count is
 * the useful fact and the list is not.
 *
 * Returns '' for an unrestricted person — deliberately an empty string rather than "every
 * zone", so a caller can write `{banner && …}` and have the whole element disappear. Telling
 * somebody unrestricted that he is unrestricted is noise on every page of the panel.
 */
export function scopeSummary(scope, zones = []) {
  const s = normaliseScope(scope);
  if (s === null) return '';

  const named = s.map((id) => (Array.isArray(zones) ? zones : []).find((z) => z.id === id)?.name || id);
  if (named.length === 1) return named[0];
  if (named.length <= 3) return `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`;
  return `${named.length} zones`;
}

/**
 * The full sentence the panel prints where a scoped person can see it.
 *
 * English, because this panel is English throughout (admin/src/lib/errors.js). It says what is
 * being shown rather than what is being withheld: "these are વરાછા's numbers" is a fact he can
 * use, and "some yuvaks are hidden from you" is an accusation he can do nothing about.
 */
export function scopeNotice(scope, zones = []) {
  const summary = scopeSummary(scope, zones);
  if (!summary) return '';
  return `Every count, list and report on this screen covers ${summary} only.`;
}

/**
 * Is this a scope somebody may save?
 *
 * The asymmetry with `normaliseScope()` is the one every validator in this project has, and
 * geography.js states it for both: a resolver reading a stored value has nobody to tell, so it
 * falls back and carries on; a save is the one moment a mistake can be explained to the person
 * who can fix it. Saving a zone id that does not exist would be refused by the foreign key
 * with a constraint name, which tells a સંચાલક nothing he can act on.
 *
 * The empty case is valid and is the important one to word carefully: it is not an error, it is
 * the way a limit is removed.
 *
 * @param {string[]} zoneIds  what was ticked
 * @param {Array}    zones    the zones that exist, so an unknown one is named rather than thrown
 */
export function validateScope(zoneIds, zones = []) {
  const list = Array.isArray(zoneIds) ? zoneIds : [];
  const known = new Set((Array.isArray(zones) ? zones : []).map((z) => z.id));

  const bad = list.find((z) => typeof z !== 'string' || !known.has(z));
  if (bad !== undefined) return { ok: false, gu: `There is no zone called "${bad}".` };

  return { ok: true, zoneIds: [...new Set(list)].sort() };
}

/**
 * What changed between the scope that is stored and the scope that was ticked.
 *
 * The panel saves a diff rather than replacing the set, for the two reasons adminService's
 * `setRolePermissions()` gives: `audit_admin_scope()` writes one row per zone moved, so a
 * delete-all/insert-all would record every zone as removed and re-added each time somebody
 * ticked one box — and for a moment mid-save the person would be scoped to nothing, which under
 * this module's own rule is not "nothing" but *everything*. A save that briefly hands somebody
 * the whole સંઘ is not a save anybody would accept if it were written down, so it is written
 * down here.
 */
export function scopeDiff(current, next) {
  const before = new Set(normaliseScope(current) || []);
  const after = new Set(Array.isArray(next) ? next : []);
  return {
    added: [...after].filter((z) => !before.has(z)).sort(),
    removed: [...before].filter((z) => !after.has(z)).sort(),
  };
}
