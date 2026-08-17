import { supabase } from '../../../lib/supabase';
import { saveError } from '../../../lib/errors';
import { normaliseGeography } from '../../../../../shared/domain/geography.js';
import { scopeDiff } from '../../../../../shared/domain/scope.js';

/**
 * ────────────────────────────────────────────────────────────────────────────
 * Which zones a સંચાલક may see — the data access behind /access?tab=zones
 * ────────────────────────────────────────────────────────────────────────────
 *
 * All of it is ordinary PostgREST against two things 0050 and 0051 added: `public.geography()`,
 * which is the list of places, and `public.admin_scopes`, which is the set of rows saying who
 * may see which of them. There is no endpoint and no secret key here, because nothing in this
 * file creates an account — a scope is a row.
 *
 * What stops any of it being dangerous is that the browser is not trusted with one of these
 * decisions. `admin_scopes_guard()` re-applies every rule — scope.assign is required, nobody
 * may change his own scope, and a SUPER_ADMIN may not be scoped at all — and it is a BEFORE
 * trigger, so it binds service_role too. Everything below is a form over a table whose trigger
 * says no.
 *
 * Its own file rather than more of adminService.js, which already holds roles, the catalogue
 * and per-person grants. Those are all answers to "what may he do"; this is the answer to
 * "whose data", it is the only consumer of `geography()` in the panel today, and the two
 * questions are worth being able to read separately.
 */

/**
 * Every city and zone, with how many યુવકો are in each.
 *
 * One RPC rather than two selects on `cities` and `zones`, because every screen that wants one
 * wants the other and 0050 built the call for exactly that. The counts come from
 * `public.yuvaks` — administrators and test accounts excluded — and since 0051 they are the
 * CALLER'S counts: a scoped સંચાલક opening this screen is not told how many યુવકો are in a
 * zone he cannot look at.
 *
 * `normaliseGeography()` does the reading, so a row whose name failed to arrive prints its id
 * rather than an empty cell, and the sort is the સંચાલક's own.
 */
export async function loadGeography() {
  const { data, error } = await supabase.rpc('geography');
  if (error) throw error;
  return normaliseGeography(data);
}

/**
 * Everybody's scope in one read, as `{ adminId: [zoneId, …] }`.
 *
 * One call for the whole table rather than one per administrator. There are a handful of rows
 * — §12 sizes the સંઘ at a few administrators — and a request per row is how a list of five
 * becomes five round trips that can each fail separately, leaving a table in which some rows
 * know their scope and some do not.
 *
 * **An administrator missing from this object is unrestricted, not restricted to nothing.**
 * That is `caller_scope()`'s rule and shared/domain/scope.js states it once; every reader of
 * this function has to keep it, and `isUnrestricted()` is the function that does.
 *
 * RLS decides what comes back: `admin_id = auth.uid() or has_permission('admins.read')`. So a
 * COORDINATOR calling this gets exactly his own row, which is what the banner in AdminShell
 * needs and is not enough to render the editor - the tab is gated on `scope.assign` for that
 * reason rather than left to look empty.
 */
export async function listScopes() {
  const { data, error } = await supabase.from('admin_scopes').select('admin_id, zone_id');
  if (error) throw error;

  const out = {};
  for (const r of data || []) (out[r.admin_id] ||= []).push(r.zone_id);
  for (const k of Object.keys(out)) out[k].sort();
  return out;
}

/**
 * Save one administrator's zones as a diff, not as a replacement.
 *
 * The screen presents a row of tick boxes and it would be simpler to delete every row for the
 * person and insert the ticked ones. That is wrong here for two reasons, and the second is the
 * serious one:
 *
 *   · `audit_admin_scope()` writes one row per zone moved. A delete-all/insert-all would record
 *     every zone as removed and re-added every time somebody ticked one box, which buries the
 *     change that actually happened in the trail meant to show it.
 *   · **For the moment between the delete and the insert he would have no rows — and no rows
 *     means every zone.** A save that briefly hands somebody the whole સંઘ is not a save
 *     anybody would accept if it were written down, and `has_permission()` and `caller_scope()`
 *     are read live, on every query, by whatever he happens to be doing at that moment.
 *
 * The delete is issued before the insert only when it is a *narrowing* of an existing set, so
 * the window above never opens: removing zones from somebody who keeps at least one leaves him
 * scoped throughout. Removing his last zone is the deliberate "he sees everything again" case,
 * and it is the one the screen confirms in words.
 *
 * Each statement is independently subject to the guard, which is also why they are not wrapped
 * in one call: a zone the caller may not assign is refused on its own row and the rest still
 * apply, and the screen re-reads to show exactly what landed.
 */
export async function setAdminScope(adminId, zoneIds) {
  const current = (await listScopes())[adminId] || [];
  const { added, removed } = scopeDiff(current, zoneIds);

  if (added.length) {
    const { error } = await supabase
      .from('admin_scopes')
      // `granted_by` is deliberately not sent. admin_scopes_guard() takes it from auth.uid(),
      // which a browser cannot spoof, exactly as admins_guard() does with `created_by`.
      .insert(added.map((zone_id) => ({ admin_id: adminId, zone_id })));
    if (error) throw error;
  }

  if (removed.length) {
    const { error } = await supabase
      .from('admin_scopes')
      .delete()
      .eq('admin_id', adminId)
      .in('zone_id', removed);
    if (error) throw error;
  }

  return { added: added.length, removed: removed.length };
}

/**
 * ────────────────────────────────────────────────────────────────────────────
 * What the database refuses, said out loud
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The same technique adminService.js uses for `admins_guard()`'s eight refusals, and the same
 * justification: every one of these arrives as SQLSTATE P0001, for which errors.js has exactly
 * one sentence — "This change does not follow the rules. The server has blocked it." That is
 * right for a trigger whose message is developer English about an internal invariant, and wrong
 * for these three: each names a rule the person either has to accept or can act on, and
 * answering all of them with one shrug withholds the answer while appearing to give one.
 *
 * Matched on the message text, exact and never a prefix. 0051 states beside the guard that
 * these strings are asserted verbatim by scripts/test-scope.mjs and are part of the contract,
 * so they are identifiers that happen to read as English; a message that has drifted falls
 * through to the general sentence rather than being shown under a rule it no longer states.
 */
const GUARD_ERRORS = {
  'not permitted to limit an administrator to a zone':
    'You do not have permission to limit an administrator to a zone. Ask a Super Admin.',
  'an administrator cannot change their own access':
    'You cannot change your own zones. Another administrator has to make this change - which is what stops somebody from scoping himself out of the screen that would undo it.',
  'a Super Admin sees every zone and cannot be limited to one':
    'A Super Admin sees every zone and cannot be limited to one. Somebody has to be able to see the whole sangh, or a zone can become invisible to everybody at once. Give this person a different role first, then set his zones.',
};

export function scopeWriteError(e) {
  if (e?.code === 'P0001') {
    const key = String(e.message || '').trim();
    if (Object.prototype.hasOwnProperty.call(GUARD_ERRORS, key)) return GUARD_ERRORS[key];
  }
  /*
    23503 is the foreign key on `zone_id`, and it means the zone was retired and removed from
    the list between this page loading and the save. Worded here rather than left to errors.js's
    general "referenced row" sentence, because the fix is one press of Reload.
  */
  if (e?.code === '23503') {
    return 'One of these zones no longer exists. Reload the page to get the current list and try again.';
  }
  return saveError(e);
}
