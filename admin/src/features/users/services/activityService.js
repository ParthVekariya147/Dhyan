import { supabase } from '../../../lib/supabase';
import { istRange } from '../../../lib/export';
import { todayIST } from '../../../../../shared/domain/constants.js';

/**
 * One yuvak's record: every attempt he has submitted, and every point he has been paid.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * What this reads, and why it is three views and not three tables
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Migration 0021 exposes three `security_invoker` views:
 *
 *   public.activity_history   one row per (yuvak, day, level, activity) - the day's summary
 *   public.attempt_history    one row per submission - what he actually did, and when
 *   public.point_ledger       one row per award - what he was paid, and for which attempt
 *
 * `security_invoker` is the whole reason no new permission appears anywhere in this file:
 * the view runs as the caller, so the RLS policies already on the underlying tables decide
 * what comes back. A role holding `progress.read` sees every yuvak; a role holding none
 * sees only his own rows, which arrives as an empty list rather than as an error
 * (admin/src/lib/errors.js explains why a read denial is not an error). Nothing here
 * checks a permission, because checking one here would be a second, weaker copy of a rule
 * the database already enforces.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Three questions, three functions, and why they are not one
 * ────────────────────────────────────────────────────────────────────────────
 *
 * shared/domain/history.js opens by insisting these are different things: what he did, and
 * what he was paid, are not two renderings of one row. A yuvak may sit the same કસોટી
 * three times in a day and be paid once (points.js: the unique index on
 * `(user_id, activity_date, level_id, activity_key)` is what makes points un-farmable), so
 * a single query that tried to answer both would have to either drop attempts or invent
 * payments. Two reads, two lists, and the panel says which is which.
 */

const ATTEMPTS = 'attempt_history';
const LEDGER = 'point_ledger';

/** The default page for a per-user history. Wider than a list page: this is one person. */
export const PAGE_SIZE = 25;

/**
 * A bounded read, because there is no RPC for another yuvak's totals.
 *
 * The યુવક app has `point_summary` for the person asking about himself; nothing on the
 * server sums a *different* user's ledger for a સંચાલક, and adding one is a migration this
 * work is not allowed to write. So getUserPointTotals() scans, the way reportService.js's
 * two reports scan, and returns `truncated` with the figures rather than swallowing it -
 * see the note on that function for what an unexplained empty result costs.
 */
export const POINT_SCAN_CAP = 5000;
const POINT_SCAN_CHUNK = 1000;

/**
 * Postgres is snake_case, this panel is camelCase, and the mapping lives here so no query
 * and no page has to think about it - learningService.js's `fromRow` pair, same shape.
 *
 * `points` is read with `typeof`, never `Number()`. A view column arriving as anything but
 * a number can only mean the view and this file disagree about the schema, and
 * `Number(null)` is 0 - a real, spendable zero that would be silently added to a total. The
 * same rule shared/domain/points.js states for the stored setting applies to the figure
 * that setting produced.
 */
const int = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

const fromAttemptRow = (r) => ({
  id: r.id,
  uid: r.user_id,
  // A plain `date`, already the IST business day the server filed the attempt under.
  activityDate: r.activity_date,
  levelId: int(r.level_id),
  activityKey: r.activity_key || '',
  // લેવલ ૪ carries the કસોટી's own name; levels 1-3 have one fixed activity each and the
  // page labels them. Never blanked to a dash here - a service does not format.
  title: r.title || '',
  attemptNumber: int(r.attempt_number),
  completedItems: int(r.completed_items),
  totalItems: int(r.total_items),
  status: r.status || '',
  selectedSceneIds: r.selected_scene_ids || [],
  submittedAt: r.submitted_at || null,
});

const fromLedgerRow = (r) => ({
  id: r.id,
  uid: r.user_id,
  activityDate: r.activity_date,
  levelId: int(r.level_id),
  activityKey: r.activity_key || '',
  title: r.title || '',
  attemptNumber: int(r.attempt_number),
  // The number that was actually paid, stored on the row rather than a pointer to the rule
  // that decided it (shared/domain/points.js). Lowering a value tomorrow cannot reach back
  // and change what this row says, which is what makes the ledger history.
  points: int(r.points),
  createdAt: r.created_at || null,
});

/**
 * The date range, applied to `activity_date`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why istRange() is called, and why its instants are not what gets filtered on
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The panel's rule, set out in admin/src/lib/export.js and used by
 * learningService.applySessionRange(): a range over a **timestamptz** must be built by
 * istRange() and applied as `.gte(col, fromIso)` / `.lt(col, toIsoExclusive)`. A bare
 * 'YYYY-MM-DD' handed to Postgres for a timestamptz comparison is parsed as midnight
 * **UTC**, which moves the cut-off 5½ hours and quietly drops the first part of an Indian
 * evening into the day before. Both views here carry such a column - `submitted_at` on
 * attempt_history, `created_at` on point_ledger - and either would need that treatment.
 *
 * Neither is what a સંચાલક is asking about. `activity_date` is a plain `date`, written by
 * the server as the IST business day the attempt belongs to, and it is the column the
 * once-per-day unique index is built on. It has **no time and no zone**, so there is no
 * instant to get wrong: `gte('activity_date', '2026-08-11')` compares a date to a date and
 * means exactly the eleventh, in the same India the yuvak was in. Converting the bound to
 * an instant first and then comparing it to a date would be the mistake in the other
 * direction - Postgres would have to cast one side back, and the 5½ hours would reappear.
 *
 * So istRange() is called for its **refusal**, not for its instants: it returns null for
 * anything that is not a YYYY-MM-DD, which is precisely the shape check a half-typed date
 * field needs before it becomes a filter. The bounds it builds are deliberately unused, and
 * the plain strings are what reach the query.
 *
 * `.lte(to)` and not `.lt()`: an exclusive upper bound is what an *instant* range needs, so
 * that 23:59 on the last day is inside it. A date column has no such tail - "up to the
 * eleventh" is `<= '2026-08-11'`, and `.lt()` here would silently drop the whole last day.
 */
function applyDayRange(q, { from = '', to = '' } = {}) {
  const { fromIso, toIsoExclusive } = istRange(from, to);
  if (fromIso) q = q.gte('activity_date', from);
  if (toIsoExclusive) q = q.lte('activity_date', to);
  return q;
}

/**
 * The offset a cursor carries.
 *
 * `typeof`, not `Number()`: `Number(null)` and `Number('')` are both 0, so a coercing read
 * turns a malformed cursor into "start from the top" without anybody noticing the list
 * restarted. A cursor this function does not recognise is page one, said once, here.
 */
const offsetOf = (cursor) => (typeof cursor === 'number' && Number.isFinite(cursor) && cursor > 0 ? Math.floor(cursor) : 0);

/**
 * One page, from a result set fetched with one extra row.
 *
 * The house pagination contract (learningService.js): `.range(offset, offset + pageSize)`
 * asks for pageSize + 1 rows, and whether the extra one arrived is the whole answer to "is
 * there a next page?" - no count query, no total, and nothing that has to be kept in step
 * with the rows themselves.
 */
function paginate(data, pageSize, offset, map) {
  const all = data || [];
  const page = all.slice(0, pageSize);
  return {
    rows: page.map(map),
    cursor: page.length ? offset + page.length : null,
    hasNext: all.length > pageSize,
  };
}

/**
 * Every attempt this yuvak has submitted, newest first.
 *
 * Ordered by `submitted_at` descending, then by `id` descending. The second key is not
 * decoration: with `.range()` offsets a non-unique sort double-counts across a page
 * boundary - one attempt appears twice and another is never shown - and two submissions can
 * share a `submitted_at` to the microsecond when a retry lands. reportService.js makes the
 * same argument for ordering its scans by a primary key.
 *
 * There is no `points` column on this view, and that is correct rather than an omission:
 * points are awarded once per business day per activity, so a *per-attempt* points figure
 * does not exist. The second and third attempts of one day earn nothing and are not
 * failures - listUserPoints() is where what he was paid is recorded.
 */
export async function listUserAttempts(uid, { cursor = null, pageSize = PAGE_SIZE, from = '', to = '' } = {}) {
  const offset = offsetOf(cursor);

  const { data, error } = await applyDayRange(
    supabase.from(ATTEMPTS).select('*').eq('user_id', uid),
    { from, to }
  )
    .order('submitted_at', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + pageSize);
  if (error) throw error;

  return paginate(data, pageSize, offset, fromAttemptRow);
}

/**
 * Every award this yuvak has been paid, newest first.
 *
 * Ordered by `created_at` - when the award was written - rather than by `activity_date`,
 * for the same reason learningService.js orders rounds by `submitted_at`: a ledger row
 * backdated by a correction still happened when it happened, and a list headed "newest
 * first" must not reorder itself around a date somebody typed. `id` breaks the tie, as
 * above.
 */
export async function listUserPoints(uid, { cursor = null, pageSize = PAGE_SIZE, from = '', to = '' } = {}) {
  const offset = offsetOf(cursor);

  const { data, error } = await applyDayRange(
    supabase.from(LEDGER).select('*').eq('user_id', uid),
    { from, to }
  )
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + pageSize);
  if (error) throw error;

  return paginate(data, pageSize, offset, fromLedgerRow);
}

/**
 * Today's points and every point ever, for one yuvak.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why this is a scan
 * ────────────────────────────────────────────────────────────────────────────
 *
 * There is no server RPC that sums *another* user's ledger. The one that exists answers for
 * the caller himself, which is what the યુવક app needs and not what this page asks. Adding
 * one is a migration, and this work does not write migrations - so this does the honest
 * second-best that reportService.js already established: a bounded, chunked, capped read
 * whose cost is stated, with `truncated` returned beside the figures rather than swallowed.
 * When the RPC exists, this function body changes and no caller does.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Newest first, and what that buys when the cap is hit
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The scan walks the ledger from the newest row backwards, so if the cap is ever reached:
 *
 *   `today`   is still **exact** - today's awards are in the first chunk by construction
 *   `total`   is a **lower bound**, and `truncated` is what says so
 *
 * The other direction - oldest first - would have got today's figure wrong, which is the
 * number on screen most likely to be checked against a yuvak's own phone.
 *
 * `scanned` comes back with them for the reason rememberedAtLeast() returns `best`: a zero
 * total reads identically whether the ledger is genuinely empty or the policy withheld every
 * row, and one of those is the panel working while the other is the panel lying. The caller
 * can tell them apart without opening a console.
 */
export async function getUserPointTotals(uid, { cap = POINT_SCAN_CAP, chunk = POINT_SCAN_CHUNK } = {}) {
  // The IST day, from the same helper the date filters and the yuvak app use - the midnight
  // that matters is India's, not the browser's (§9).
  const day = todayIST();

  let today = 0;
  let total = 0;
  let scanned = 0;
  let offset = 0;
  let truncated = false;

  for (;;) {
    const { data, error } = await supabase
      .from(LEDGER)
      // Three columns, not `*`. The ledger's title and activity key are for the list below;
      // a total needs the number and the day it belongs to, and `id` only to break the tie.
      .select('id, activity_date, points, created_at')
      .eq('user_id', uid)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + chunk - 1);
    if (error) throw error;

    const batch = data || [];
    scanned += batch.length;

    for (const r of batch) {
      const p = int(r.points);
      total += p;
      // String equality on two plain 'YYYY-MM-DD' values. No Date is constructed, so there
      // is no zone for the comparison to slip through.
      if (r.activity_date === day) today += p;
    }

    if (batch.length < chunk) break;
    if (scanned >= cap) {
      truncated = true;
      break;
    }
    offset += chunk;
  }

  return { today, total, scanned, truncated, cap };
}
