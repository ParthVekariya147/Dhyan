import { supabase } from '../../../lib/supabase';
import { countUsers } from '../../users/services/userService';
import { SUBZONES } from '../../../../../shared/domain/constants.js';

/**
 * §11's two aggregate અહેવાલ — the ones the spec names and the panel did not have:
 *
 *   rememberedAtLeast()   '૫૦+ યાદ રાખનારા', one click. Directly useful when saints visit.
 *   subZoneRegularity()   which મંડળ is more regular, over a date range.
 *
 * Both are reports and not list views, which is why they live here rather than in
 * learningService.js: that module is the data access the Progress and Sessions *tables*
 * are built on, and mixing "one page of rows" with "scan and summarise" in one file makes
 * it impossible to see which functions are cheap.
 *
 * Why these are client-side scans and not RPCs
 * --------------------------------------------
 * 0003_learning_reports.sql already shows the right answer for an aggregate: a GROUP BY
 * inside a SECURITY INVOKER function, because PostgREST cannot express one. The same would
 * be true here — `count(*) filter (where array_length(remembered_item_ids, 1) >= 50)` is
 * one index-free scan in Postgres and would transfer four rows instead of two thousand.
 *
 * That is a migration, and this work is not allowed to add one. So both functions do the
 * honest second-best: a **bounded, chunked, capped** scan whose cost is stated on screen,
 * with `truncated` returned rather than swallowed. Neither pretends to be an aggregate.
 * When an RPC is added, these two function bodies change and no caller does.
 *
 * What neither of them touches
 * ----------------------------
 * `public.progress` (0001_init.sql:46-60) — the `date`/`level3_score`/`level4_score` table
 * §9's midnight-IST reset is built around. **Nothing in this codebase writes it**, so
 * there is no per-day score history to report over and these functions do not pretend
 * there is. Both read what the યુવક app actually records: `learning_state` (lifetime
 * position) and `learning_sessions.submitted_at` (when a round happened).
 *
 * Tone (§10, §14)
 * ---------------
 * Nothing here counts consecutive days, and nothing returns a "missed" or "failed" figure.
 * `submitters` is how many યુવકો were present in the window; a યુવક who was not is simply
 * absent from that count, which is emptiness, not a mark against him.
 */

const LEARNING = 'learning_state';
const SESSIONS = 'learning_sessions';

/**
 * §11 — '૫૦+ યાદ રાખનારા'. The number is the spec's, not a tunable.
 *
 * It is deliberately *not* LEVEL4_UNLOCK_THRESHOLD (80, shared/domain/constants.js). That
 * one is a gate in the યુવક app; this is a list a સંચાલક hands to a saint. Two different
 * questions that happen to both be numbers, and tying them together would mean changing
 * who appears on this list every time the unlock rule moved.
 */
export const REMEMBERED_THRESHOLD = 50;

/** A scan is not a list view. These bounds are what keep it from becoming one. */
export const SCAN_CAP = 4000;
const SCAN_CHUNK = 1000;

/**
 * The embed that puts a name next to a row.
 *
 * `!inner` is safe here and loses nothing: `learning_state.user_id` is a NOT NULL foreign
 * key to `public.profiles`, so a matching row always exists, and every role in
 * `permissions_for()` (0004_rbac.sql) that holds `progress.read` also holds `users.read` —
 * so a caller who can see the learning row can see the profile behind it. What `!inner`
 * buys is the સબઝોન filter running in Postgres instead of in the browser.
 */
const WITH_PROFILE = 'profiles!inner(smk, name, sub_zone_id)';

/**
 * યુવકો who have remembered `threshold` દ્રશ્યો or more, most remembered first.
 *
 * The count is `array_length(remembered_item_ids)`, measured here rather than in the
 * database — PostgREST has no operator for the length of a text[], so there is no `gte`
 * to write. That is the whole reason this is a scan, and why the caller is told how many
 * rows were looked at.
 *
 * `remembered_item_ids` is the one expensive column in the select: up to 109 ids per row,
 * ~2,000 rows. It is fetched because the threshold cannot be applied without it, and the
 * page runs this on an explicit press rather than on load, so the cost is paid when a
 * સંચાલક actually wants the list.
 */
export async function rememberedAtLeast({
  threshold = REMEMBERED_THRESHOLD,
  subZoneId = '',
  cap = SCAN_CAP,
  chunk = SCAN_CHUNK,
} = {}) {
  const rows = [];
  let scanned = 0;
  let offset = 0;
  let truncated = false;

  for (;;) {
    let q = supabase
      .from(LEARNING)
      .select(`user_id, remembered_item_ids, total_at_submit, current_stage, updated_at, ${WITH_PROFILE}`);
    // Filtering an embedded column narrows the top-level rows because the embed is
    // `!inner` — one query, and the browser never receives a મંડળ it did not ask for.
    if (subZoneId) q = q.eq('profiles.sub_zone_id', subZoneId);

    const { data, error } = await q
      // user_id is the primary key of learning_state (0001_init.sql:70), so it is a total
      // order. Ordering by updated_at would tie — every row a single save writes shares a
      // clock — and a tie straddling a chunk boundary shows one yuvak twice and hides
      // another, which in a report is a wrong number rather than a cosmetic glitch.
      .order('user_id', { ascending: true })
      .range(offset, offset + chunk - 1);
    if (error) throw error;

    const batch = data || [];
    scanned += batch.length;

    for (const r of batch) {
      const remembered = Array.isArray(r.remembered_item_ids) ? r.remembered_item_ids.length : 0;
      if (remembered < threshold) continue;
      rows.push({
        id: r.user_id,
        uid: r.user_id,
        remembered,
        // total_at_submit is the scene count as it stood when he submitted. Null when he
        // has not submitted yet, and shown as unknown rather than as today's count — an
        // old row must not be re-scored against content added since (§62).
        total: r.total_at_submit || 0,
        currentStage: r.current_stage,
        updatedAt: r.updated_at || null,
        smk: r.profiles?.smk || '',
        name: r.profiles?.name || '',
        subZoneId: r.profiles?.sub_zone_id || '',
      });
    }

    if (batch.length < chunk) break;
    if (scanned >= cap) {
      truncated = true;
      break;
    }
    offset += chunk;
  }

  // Most remembered first — that is the order the list is read in. Ties fall back to the
  // name so the file is stable between runs.
  rows.sort((a, b) => b.remembered - a.remembered || a.name.localeCompare(b.name, 'gu'));

  return { rows, threshold, scanned, truncated, cap };
}

/**
 * §11 — which મંડળ is more regular, over a date range.
 *
 * "Regular" is answered as **participation**, not as score: how many યુવકો of each સબઝોન
 * submitted at least one round in the window, and how many rounds they submitted between
 * them. That is what the spec's question means, and it is also the only version of it the
 * recorded data can answer honestly — there is no per-day score history to average (see
 * the header).
 *
 * Deliberately not a score comparison. §10 forbids streaks and §1/§14 keep the whole panel
 * encouraging; ranking મંડળો by average marks would turn a report into a league table of
 * how well yuvaks did, which is a different thing from how regularly they came.
 *
 * Every figure is derived (§62): `registered` is a head count from the same predicate the
 * યુવક list uses, `submitters` is the size of a Set of user ids, `rounds` is the length of
 * the filtered rows, and `share` is computed from those two — nothing is stored or cached.
 */
export async function subZoneRegularity({
  fromIso = null,
  toIsoExclusive = null,
  cap = SCAN_CAP,
  chunk = SCAN_CHUNK,
} = {}) {
  const rounds = new Map(); // subZoneId → rounds submitted in the window
  const people = new Map(); // subZoneId → Set of user ids seen in the window
  let scanned = 0;
  let offset = 0;
  let truncated = false;

  for (;;) {
    // Only three fields. Unlike the ૫૦+ scan there is no array to fetch here, because the
    // question is who came and how often, not what they scored — so this stays cheap even
    // at the cap.
    let q = supabase.from(SESSIONS).select(`id, user_id, submitted_at, profiles!inner(sub_zone_id)`);
    // Same IST bounds as the Sessions page uses on the same column, built by
    // admin/src/lib/export.js istRange(). See learningService.js applySessionRange() for
    // why `submitted_at` and not `created_at`.
    if (fromIso) q = q.gte('submitted_at', fromIso);
    if (toIsoExclusive) q = q.lt('submitted_at', toIsoExclusive);

    const { data, error } = await q
      // `id` is the primary key (0001_init.sql:83) and therefore a total order. Same tie
      // reasoning as above — with .range() offsets, a non-unique sort double-counts.
      .order('id', { ascending: true })
      .range(offset, offset + chunk - 1);
    if (error) throw error;

    const batch = data || [];
    scanned += batch.length;

    for (const r of batch) {
      const sz = r.profiles?.sub_zone_id || '';
      rounds.set(sz, (rounds.get(sz) || 0) + 1);
      if (!people.has(sz)) people.set(sz, new Set());
      people.get(sz).add(r.user_id);
    }

    if (batch.length < chunk) break;
    if (scanned >= cap) {
      truncated = true;
      break;
    }
    offset += chunk;
  }

  // The denominator. One head request per મંડળ — the rows are never transferred (§15) —
  // and it counts everyone registered, not only those who appear above, so a મંડળ where
  // nobody submitted still shows its size instead of vanishing from the comparison.
  const registered = await Promise.all(
    SUBZONES.map(async (s) => [s.id, await countUsers({ subZoneId: s.id })])
  );

  const rows = registered.map(([id, total]) => {
    const submitters = people.get(id)?.size || 0;
    return {
      id,
      subZoneId: id,
      registered: total,
      submitters,
      rounds: rounds.get(id) || 0,
      // Derived, never stored. Guarded because a મંડળ with no registrations yet would
      // otherwise divide by zero and report NaN as a percentage.
      share: total ? submitters / total : 0,
    };
  });

  // Most participation first. A મંડળ at the bottom is shown with its real numbers and no
  // colour, wording or mark suggesting it failed at anything (§10, §14).
  rows.sort((a, b) => b.share - a.share || b.submitters - a.submitters);

  // Rows whose profile carries a સબઝોન that SUBZONES does not list — impossible under the
  // 0001 CHECK constraint today, and reported rather than silently dropped if that
  // constraint ever changes, so the totals below always add up to what was scanned.
  const known = new Set(SUBZONES.map((s) => s.id));
  const unknownRounds = [...rounds.entries()]
    .filter(([id]) => !known.has(id))
    .reduce((sum, [, n]) => sum + n, 0);

  return { rows, scanned, truncated, cap, unknownRounds };
}
