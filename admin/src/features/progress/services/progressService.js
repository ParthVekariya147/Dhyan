import { supabase } from '../../../lib/supabase';

/**
 * §38 — organisation-wide progress, read from the tables the app actually writes.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why this file exists at all
 * ────────────────────────────────────────────────────────────────────────────
 *
 * There are two progress systems in this project and the panel used to read the wrong one.
 * `learning_state` and `learning_sessions` shipped in 0001 and hold **zero rows** in
 * production; nothing has written them for as long as the current levels have existed.
 * What levels ૧–૪ really write is `activity_attempts`, `daily_activity_progress`,
 * `level4_attempts`, `level4_activity_progress`, `progress` and `point_transactions` — and
 * those tables are full. A panel that renders an empty table over a busy database is worse
 * than a panel with no page: someone believes it.
 *
 * 0030_admin_progress_live_scenes.sql holds the read-only, admin-gated functions this module
 * calls. Nothing here queries `learning_state` or `learning_sessions`, and nothing here
 * aggregates.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why every count is computed in Postgres and none of it in React
 * ────────────────────────────────────────────────────────────────────────────
 *
 * "Show me the યુવકો who have passed at least two કસોટીઓ, newest activity first, page 3"
 * cannot be answered by a browser without first downloading every attempt of every યુવક:
 * the filter is over a count, and a count cannot reach a LIMIT until it exists. At 500
 * યુવકો that is the whole history on every page load, over a free-tier budget that has to
 * serve 2,000 of them (§84). Counted in the database, the answer is twenty rows.
 *
 * So the search, the thresholds, the city, the મંડળ, the date window, the level, the status,
 * the sort, the page and the page size all travel to the server, and what comes back is
 * exactly what the table renders. `total_rows` rides on every row — the same figure on each
 * — because a pager needs the size of the whole filtered set and a second COUNT query could
 * disagree with the rows beside it.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * The one number that CANNOT come from Postgres: the denominator
 * ────────────────────────────────────────────────────────────────────────────
 *
 * "૮૭ of ૧૦૮" needs the second figure, and the database has never seen it. The collection is
 * `content/darshan.json` — a file — overlaid by `public.scenes`, which withholds some દ્રશ્યો
 * and adds others. Only a browser holding the manifest can resolve the membership, which is
 * why every function below takes a `liveIds` and forwards it as `p_live_scene_ids`.
 *
 * With that array the server intersects each યુવક's submitted scene ids against exactly what
 * the app shows today: "remembered" becomes a membership test rather than a count, and a
 * યુવક who ticked 108 દ્રશ્યો of which one has since been withheld reads as 107 of 108
 * because that is what he holds — not because he missed one.
 *
 * Without it the functions fall back to 0029's rule, which can only subtract the દ્રશ્યો
 * Postgres happens to know were withheld. That fallback is honest but coarse, and the
 * summary says which one it used in `contentSource`. The page treats a manifest it could not
 * read as an error, never as a denominator it can guess (§62).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * An empty result and a refusal are not the same thing
 * ────────────────────────────────────────────────────────────────────────────
 *
 * admin/src/lib/errors.js sets out the panel's usual rule: an RLS *read* denial returns no
 * rows rather than an error, so a page cannot tell "nobody matched" from "you may not ask".
 * These functions deliberately break that pattern — they check the permission on their first
 * line and **raise** 42501 — which is why nothing in this file inspects a permission or
 * treats emptiness as suspicious. An empty array here means nobody matched the filter, and
 * it means nothing else.
 */

/** The list page's default. Matches the Pager's smallest option (§18). */
export const PAGE_SIZE = 20;

/**
 * The server caps `p_page_size` at 200 and the same ceiling is applied here, so a caller
 * asking for more is answered with the number it will actually get rather than being
 * silently corrected somewhere it cannot see.
 */
export const MAX_PAGE_SIZE = 200;

/**
 * How much of a filtered set one export may pull, and in what size bites.
 *
 * The export deliberately breaks the "never hold more than one page" rule that governs the
 * table — §11 asks for a file the સંચાલક can act on, and a file holding only the twenty rows
 * that happened to be on screen would be a report that lies. It does not break it without a
 * bound: ten calls of 200. A cap that is reached is returned as `truncated` and said out
 * loud by the page, because silent truncation of a report someone acts on is worse than no
 * export at all (§62).
 */
export const EXPORT_CAP = 2000;
const EXPORT_CHUNK = MAX_PAGE_SIZE;

/**
 * The sorts the function will accept, and the only ones it will accept.
 *
 * Anything else falls back to `remembered` here rather than travelling to Postgres to be
 * silently coerced there: a mistyped sort is a bug in this panel and should not read to a
 * સંચાલક as the list ordering itself being unreliable.
 */
export const SORT_FIELDS = [
  'name',
  'remembered',
  'l4_passed',
  'l4_attempts',
  'points',
  'percentage',
  'registered',
  'last_active',
];
const DEFAULT_SORT = 'remembered';

/**
 * A number that came off the wire, never a coercion.
 *
 * `Number(null)` is 0 and `Number('')` is 0, and a 0 in this file is a claim about a યુવક —
 * "remembered nothing", "passed nothing". activityService.js makes the same argument about
 * the points ledger, and it holds harder here because these figures are shown beside a
 * person's name. The string branch is not a coercion: PostgREST may serialise `bigint`
 * (`total_rows`, `points_total`) and `numeric` (`remembered_pct`) as JSON strings, and an
 * all-digits string is that exact number and nothing else.
 */
const int = (v) => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^-?\d+$/.test(v)) return Number(v);
  return 0;
};

/** Same rule, for a figure that is allowed to be genuinely absent (`avgRemembered`). */
const numOrNull = (v) => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return null;
};

/**
 * A rank, or nothing — and never a 0.
 *
 * `admin_activity_counts()` returns a null `rank` for a યુવક who has earned nothing, and its
 * comment says why in as many words: that is "not ranked", not last place. `int()` would turn
 * it into 0 and the table would print a standing nobody holds, which is exactly the kind of
 * invented judgement the report is not allowed to make. So this is the one count in the file
 * that keeps its null, and the page renders it as '-'.
 */
const rankOrNull = (v) => {
  const n = numOrNull(v);
  return n === null || n <= 0 ? null : Math.floor(n);
};

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A date bound, or nothing.
 *
 * `<input type="date">` gives '' until a whole day has been picked, and a half-typed value
 * never reaches this function — but a bound that is not a plain YYYY-MM-DD must not become a
 * filter either. The RPC parameters are Postgres `date`, not `timestamptz`, so there is no
 * instant to get wrong and no IST offset to apply: the columns behind them are already the
 * IST business day the server filed the work under (§9). export.js's istRange() is therefore
 * not used here — it builds instants, which is the mistake in the other direction.
 */
const day = (v) => (ISO_DAY.test(String(v || '')) ? String(v) : null);

/** '' and undefined mean "no filter"; a 0 the સંચાલક typed is a real threshold. */
const optInt = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : null;
};

/** The percentage threshold keeps its decimals — "at least 87.5%" is a thing to ask. */
const optNum = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const text = (v) => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
};

/**
 * The live collection, as the array the functions take — or null.
 *
 * Null and an empty array mean the same thing to the server (it says so, in the `live`
 * declaration of every function): fall back to the estimate rather than report every યુવક at
 * zero against a collection of nothing. Normalising here means a caller that passed `[]` by
 * accident gets the fallback and the summary tells it so, instead of a page full of zeroes
 * that look like data.
 */
const sceneIds = (ids) => {
  if (!Array.isArray(ids) || ids.length === 0) return null;
  const out = ids.map((id) => String(id ?? '')).filter(Boolean);
  return out.length ? out : null;
};

/**
 * Postgres is snake_case, this panel is camelCase, and the mapping lives here so no page has
 * to think about it — activityService.js and learningService.js do the same.
 *
 * Two names in this mapping are inverted on purpose and it is not a mistake to fix. The
 * business calls `profiles.zone_id` the **city** (surat) and `profiles.sub_zone_id` the
 * **zone** or મંડળ (varachha), so the function returns them as `city_id` and `zone_id` and
 * they are carried through under those names. Label them with `zoneNameEn()` and
 * `subZoneNameEn()` respectively — the label helpers are keyed on the shared constants, not
 * on the report's vocabulary.
 *
 * Every count is `int()`; every timestamp is passed through untouched as the ISO string
 * PostgREST returned, because format.js is where an instant becomes words.
 */
const fromReportRow = (r) => ({
  uid: r.user_id,
  name: r.name || '',
  mobile: r.mobile || '',
  smk: r.smk || '',
  // profiles.zone_id — 'surat'. Label with zoneNameEn().
  cityId: r.city_id || '',
  // profiles.sub_zone_id — 'varachha'. Label with subZoneNameEn().
  zoneId: r.zone_id || '',
  status: r.account_status || '',
  registeredAt: r.registered_at || null,

  level1Status: r.level1_status || '',
  level1Attempts: int(r.level1_attempts),
  level2Status: r.level2_status || '',
  level2Attempts: int(r.level2_attempts),
  level3Status: r.level3_status || '',
  level3Attempts: int(r.level3_attempts),
  level3LastAt: r.level3_last_at || null,

  remembered: int(r.remembered_count),
  rememberedL3: int(r.remembered_l3),
  rememberedL4: int(r.remembered_l4),
  // The denominator this row was actually scored against — the live collection when the
  // caller supplied one, the server's estimate when it could not. Carried per row rather
  // than read off the summary so a cell can never divide by a number from a different query.
  contentTotal: int(r.content_total),
  rememberedPct: numOrNull(r.remembered_pct),

  gateOpen: r.gate_open === true,
  level4Total: int(r.level4_total),
  level4Unlocked: int(r.level4_unlocked),
  level4Completed: int(r.level4_completed),
  level4Passed: int(r.level4_passed),
  level4Revision: int(r.level4_revision),
  level4Attempts: int(r.level4_attempts),
  level4LastAt: r.level4_last_at || null,

  lastActiveAt: r.last_active_at || null,
  points: int(r.points_total),

  /**
   * The five columns `admin_progress_report()` does not carry (§19).
   *
   * Neutral here and filled in by `withCounts()` below, because they come from a second
   * function — `admin_activity_counts()` — keyed on the page of ids this report just decided.
   * Zero is the right neutral for a count of sessions nobody has had; `rank` is null because
   * "not ranked" and "ranked 0th" are different claims and only one of them is true.
   *
   * A row that was never enriched therefore reads as a યુવક with no sessions rather than as a
   * broken cell, and `counted` says which of the two it is.
   */
  counted: false,
  darshanSessions: 0,
  revisionSessions: 0,
  ticks: 0,
  attemptsAll: 0,
  rank: null,

  /**
   * 0035's લેવલ ૩ columns, from a third function — `admin_level3_report()` — and neutral here
   * for exactly the reason the five above are: a row nobody enriched must read as a યુવક with
   * no પુનરાવર્તન rather than as a broken cell, and `l3Counted` is what tells the two apart.
   *
   * `l3LastAt` is null and not a date, because "he has never submitted one" is an absence and
   * an invented instant would be a claim.
   */
  l3Counted: false,
  l3Revisions: 0,
  l3Ticks: 0,
  l3ScenesDistinct: 0,
  l3Points: 0,
  l3Days: 0,
  l3LastAt: null,
  l3TodayRevisions: 0,
  l3TodayTicks: 0,
  l3TodayPoints: 0,
  l3EngagedMs: 0,
});

/**
 * One row of `admin_activity_counts()`.
 *
 * `points_total` is deliberately dropped. The counts function computes it over the whole
 * ledger while the report's own `points_total` is the figure the table is already sorting on,
 * and carrying both would put two numbers called "points" on one row with no way for a
 * સંચાલક to know which he is reading. The report's is the one the page shows; this one is not
 * a second opinion worth having.
 *
 * `video_sessions`, `exam_attempts` and `exam_passed` are dropped for the same reason — the
 * report already carries `level1Attempts` and `level4Attempts`/`level4Passed`, and a second
 * spelling of a column that exists is how two cells come to disagree.
 */
const fromCountsRow = (r) => ({
  counted: true,
  darshanSessions: int(r.darshan_sessions),
  revisionSessions: int(r.revision_sessions),
  ticks: int(r.ticks),
  attemptsAll: int(r.attempts_all),
  rank: rankOrNull(r.rank),
});

/**
 * One row of `admin_level3_report()` (0035).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Two numbers called "ticks", both true, and neither may become the other
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `admin_activity_counts.ticks` — mapped above as `ticks` — is the **distinct set** of દ્રશ્યો
 * a યુવક has brought to mind, minus the withheld ones. It answers "how much of the collection
 * does he hold", and it is by construction never larger than the collection.
 *
 * `admin_level3_report.ticks` — mapped here as `l3Ticks` — is the **sum across પુનરાવર્તન**.
 * Since 0035 a યુવક who ticks ૫૦, then ૪૦, then ૩૦ has done ૧૨૦ ticks of સાધના on ૫૦ or fewer
 * દ્રશ્યો, and is paid for ૧૨૦. It answers "how much work has he done", and it has no ceiling.
 *
 * They are different questions with different answers and the report needs both, which is why
 * this mapper keeps them under two names rather than letting the later call overwrite the
 * earlier one. `scenes_distinct` is carried too — it is this function's own de-duplicated
 * count, cut on the same date window as its other figures, and so is the honest thing to
 * compare `l3Ticks` against when a સંચાલક asks how the two can differ so widely.
 *
 * `points` is deliberately **not** dropped the way `admin_activity_counts.points_total` is.
 * That one was a second opinion about the same quantity the report already carries; this is a
 * different quantity — the ledger's લેવલ ૩ rows only — and it is the number §20 asks the panel
 * to be able to show beside the પુનરાવર્તન that produced it.
 */
const fromLevel3Row = (r) => ({
  l3Counted: true,
  l3Revisions: int(r.revisions),
  l3Ticks: int(r.ticks),
  l3ScenesDistinct: int(r.scenes_distinct),
  l3Points: int(r.points),
  l3Days: int(r.days),
  // A timestamptz or null, passed through as the ISO string PostgREST returned — format.js is
  // where an instant becomes words (§62).
  l3LastAt: r.last_at || null,
  l3TodayRevisions: int(r.today_revisions),
  l3TodayTicks: int(r.today_ticks),
  l3TodayPoints: int(r.today_points),
  l3EngagedMs: int(r.engaged_ms),
});

/**
 * Every filter the report understands, in one shape, so the table and the file share it.
 *
 * One function and not two. The export's whole purpose is to be the same query the સંચાલક is
 * looking at; building its parameters anywhere else is how an export comes to hold a
 * different set from the screen that produced it, and nobody would ever notice.
 */
export function reportParams(f = {}, { page = 0, pageSize = PAGE_SIZE } = {}) {
  const sort = SORT_FIELDS.includes(f.sort) ? f.sort : DEFAULT_SORT;
  return {
    p_search: text(f.search),
    p_min_remembered: optInt(f.minRemembered),
    p_min_l4_passed: optInt(f.minL4Passed),
    p_from: day(f.from),
    p_to: day(f.to),
    p_level: optInt(f.level),
    p_status: text(f.status),
    p_sort: sort,
    p_dir: f.dir === 'asc' ? 'asc' : 'desc',
    p_page: Math.max(0, Math.floor(Number(page) || 0)),
    p_page_size: Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(Number(pageSize) || PAGE_SIZE))),
    p_city: text(f.city),
    p_zone: text(f.zone),
    p_min_l4_attempts: optInt(f.minL4Attempts),
    p_min_percentage: optNum(f.minPercentage),
    p_active_since: day(f.activeSince),
    p_live_scene_ids: sceneIds(f.liveIds),
  };
}

/**
 * One page of the report, and the size of the whole filtered set beside it.
 *
 * `total` comes off the first row rather than from a second query, so the pager can never
 * describe a different set from the rows under it. An empty page answers `total: 0`, which
 * is correct for page one and harmless past it: the pager cannot show a Next it does not
 * have, and `page === 0` is what the caller uses to decide whether "nothing matched" is a
 * fact about the filter or about having walked off the end of it.
 */
/**
 * The five extra columns, for the યુવકો already on the screen.
 *
 * `p_users` is a page and not a filter, which is the whole reason this is a second call rather
 * than five more columns on `admin_progress_report()`. That function's predicate has already
 * decided who is on the screen; asking a second function to re-derive the same set is two
 * implementations of one filter, and they drift apart the first time somebody fixes only one
 * of them (§39). So the ids travel instead.
 *
 * The date window travels too, and it is the report's own `from`/`to`. A page of sessions
 * counted over all time beside a report cut to one week would be two answers in one row.
 * `rank` is the documented exception on the server side — it is computed over everybody,
 * because a rank inside a page of twenty is not a rank.
 *
 * Returns a Map so the merge below is a lookup rather than a scan, and an empty Map for an
 * empty page — the RPC is not called at all in that case, since `unnest('{}')` costs a round
 * trip to be told nothing.
 */
export async function activityCounts(userIds = [], { from = '', to = '' } = {}) {
  const ids = (Array.isArray(userIds) ? userIds : []).map((id) => String(id ?? '')).filter(Boolean);
  if (ids.length === 0) return new Map();

  const { data, error } = await supabase.rpc('admin_activity_counts', {
    p_users: ids,
    p_from: day(from),
    p_to: day(to),
  });
  if (error) throw error;

  const out = new Map();
  for (const r of Array.isArray(data) ? data : []) {
    if (r?.user_id) out.set(r.user_id, fromCountsRow(r));
  }
  return out;
}

/**
 * The લેવલ ૩ columns, for the યુવકો already on the screen (0035).
 *
 * `activityCounts()`'s twin, deliberately built the same way and for the same three reasons:
 * `p_users` is the page the report has already decided rather than a filter re-derived here
 * (§39), the date window is the report's own so no cell answers a different question from the
 * row it sits in, and an empty page costs no round trip at all.
 *
 * `p_day` is the one parameter with no counterpart. It decides which day the three `today_*`
 * figures describe and defaults to today in IST **on the server**, which is where it belongs:
 * a browser in another timezone must not be able to move the boundary of the business day, and
 * a date computed here would do exactly that at half past midnight in Surat. It is passed only
 * when a caller genuinely means a different day.
 *
 * `admin_level3_report()` is SECURITY DEFINER and, unlike its neighbours, does **not** assert a
 * permission of its own — so it may only be called from a screen already gated on
 * `progress.read`. Every caller in this panel reaches it through the Progress route, which is.
 *
 * Returns a Map for the lookup, as above.
 */
export async function level3Report(userIds = [], { from = '', to = '', day: forDay = '' } = {}) {
  const ids = (Array.isArray(userIds) ? userIds : []).map((id) => String(id ?? '')).filter(Boolean);
  if (ids.length === 0) return new Map();

  // `day: forDay` because `day()` is this module's date-bound helper and a plain `day` in the
  // parameter list would shadow it for the whole body - the three calls below would then be
  // calling a string.
  const { data, error } = await supabase.rpc('admin_level3_report', {
    p_users: ids,
    p_from: day(from),
    p_to: day(to),
    p_day: day(forDay),
  });
  if (error) throw error;

  const out = new Map();
  for (const r of Array.isArray(data) ? data : []) {
    if (r?.user_id) out.set(r.user_id, fromLevel3Row(r));
  }
  return out;
}

/**
 * One page of the report, and the size of the whole filtered set beside it.
 *
 * `total` comes off the first row rather than from a second query, so the pager can never
 * describe a different set from the rows under it. An empty page answers `total: 0`, which
 * is correct for page one and harmless past it: the pager cannot show a Next it does not
 * have, and `page === 0` is what the caller uses to decide whether "nothing matched" is a
 * fact about the filter or about having walked off the end of it.
 *
 * `withCounts` adds the §19 columns, and it is opt-in for one reason: it is a second round
 * trip. A page that is not showing any of those five columns should not pay for them, and the
 * export — which walks up to ten chunks — pays once per chunk only when the file asked for
 * them. The counts are merged onto the rows here rather than carried alongside so that no cell
 * can ever read a count from a different query than the row it sits in.
 *
 * `withLevel3` is the same bargain over `admin_level3_report()` (0035) and is a **separate**
 * flag rather than a widening of the first, because the two answer to different columns: a
 * સંચાલક reading "Level 3 revisions" should not pay for a leaderboard rank computed over the
 * whole ledger, and one reading the rank should not pay for a scan of every પુનરાવર્તન. Both
 * on is two extra round trips and is what a file holding both sets of columns costs.
 */
export async function progressReport(
  filters = {},
  { page = 0, pageSize = PAGE_SIZE, withCounts = false, withLevel3 = false } = {}
) {
  const size = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(Number(pageSize) || PAGE_SIZE)));
  const { data, error } = await supabase.rpc(
    'admin_progress_report',
    reportParams(filters, { page, pageSize: size })
  );
  if (error) throw error;

  const raw = Array.isArray(data) ? data : [];
  const total = raw.length ? int(raw[0].total_rows) : 0;
  const pageCount = size > 0 ? Math.ceil(total / size) : 0;
  let rows = raw.map(fromReportRow);

  if (withCounts && rows.length) {
    // `row` and not the usual one-letter name, on purpose. These are *mapped* rows, and a
    // single-letter `r` dereference in this file means "a raw column off the wire":
    // scripts/test-progress-mapping.mjs greps for exactly that spelling to check both mappers
    // against their function's declared columns, and reading a camelCase key through it here
    // would be reported as a column no RPC returns. The grep cannot tell a comment from code
    // either, which is why this note does not spell the pattern out.
    const counts = await activityCounts(rows.map((row) => row.uid), {
      from: filters.from,
      to: filters.to,
    });
    rows = rows.map((row) => {
      const c = counts.get(row.uid);
      return c ? { ...row, ...c } : row;
    });
  }

  if (withLevel3 && rows.length) {
    // Merged by uid and never by position, for the reason the block above gives: the two calls
    // are ordered independently and a positional merge would put one યુવક's પુનરાવર્તન beside
    // another's name the first time the sort changed between them. See the note above about
    // the deliberate spelling of `row`.
    const l3 = await level3Report(rows.map((row) => row.uid), {
      from: filters.from,
      to: filters.to,
    });
    rows = rows.map((row) => {
      const c = l3.get(row.uid);
      return c ? { ...row, ...c } : row;
    });
  }

  return {
    rows,
    total,
    page,
    pageSize: size,
    pageCount,
    hasNext: (page + 1) * size < total,
  };
}

/**
 * The cards at the top of the page, and the bands under them.
 *
 * One jsonb document rather than a dozen counts, because they are one answer: every figure
 * is cut on the same window and the same city, and a dozen round trips could not promise
 * that. The keys arrive camelCase from `jsonb_build_object`, so there is no mapping to do —
 * only the coercion rule above, applied so a missing key becomes 0 here rather than
 * `undefined` on screen.
 *
 * `contentSource` is the honest half of `contentTotal`. 'app-manifest' means the number is
 * the live collection this browser resolved; 'server-estimate' means the manifest never
 * arrived and the figure is the largest denominator a recent લેવલ ૩ submission reported —
 * close, but a guess, and the page must say so rather than print it as a fact.
 *
 * `buckets` is re-sorted here, widest band first. The function orders them by `lo desc` in
 * SQL already; sorting again costs one line and means a bar chart cannot silently reorder
 * itself if that ever changes.
 */
export async function progressSummary({ from = '', to = '', city = '', zone = '', liveIds = null } = {}) {
  const { data, error } = await supabase.rpc('admin_progress_summary', {
    p_from: day(from),
    p_to: day(to),
    p_city: text(city),
    p_zone: text(zone),
    p_live_scene_ids: sceneIds(liveIds),
  });
  if (error) throw error;

  const s = data || {};
  const buckets = (Array.isArray(s.buckets) ? s.buckets : [])
    .map((b) => ({ key: String(b?.key || ''), lo: int(b?.lo), hi: int(b?.hi), count: int(b?.count) }))
    .sort((a, b) => b.lo - a.lo);

  return {
    contentTotal: int(s.contentTotal),
    /**
     * 0029 called this key `totalContent` and DashboardPage still reads that spelling. The
     * alias is two words and it keeps the dashboard's "out of ૧૦૮" from quietly vanishing
     * while its own feature is owned elsewhere; it is the same number, never a second one.
     */
    totalContent: int(s.contentTotal),
    contentSource: String(s.contentSource || ''),
    level4Total: int(s.level4Total),
    totalUsers: int(s.totalUsers),
    activeUsers: int(s.activeUsers),
    activeToday: int(s.activeToday),
    level1Completed: int(s.level1Completed),
    level2Completed: int(s.level2Completed),
    level3Completed: int(s.level3Completed),
    level4GateOpen: int(s.level4GateOpen),
    level4AnyPassed: int(s.level4AnyPassed),
    level4AllPassed: int(s.level4AllPassed),
    // The figure the whole brief turns on: how many યુવકો hold the entire live collection.
    fullyRemembered: int(s.fullyRemembered),
    // Genuinely absent when nobody has remembered anything yet — `avg` over no rows is null,
    // and a 0 there would be a statement about 2,000 people that no read supports.
    avgRemembered: numOrNull(s.avgRemembered),
    participants: int(s.participants),
    buckets,
  };
}

/**
 * What the City, મંડળ and Status lists may offer, read from the rows that exist.
 *
 * Not a hardcoded list. `shared/domain/constants.js` names three મંડળ and production uses
 * two; a filter offering an option that can never match teaches the સંચાલક to distrust the
 * filter, and a filter *missing* an option that exists is worse — it hides યુવકો from a
 * report someone acts on. Counts ride along so a list can read "Varachha (88)".
 *
 * `cities` are `profiles.zone_id`, `zones` are `profiles.sub_zone_id` and each zone carries
 * the `cityId` it belongs to, which is what lets the second list narrow when the first one
 * is chosen. See fromReportRow() above for why those two names are inverted.
 */
export async function progressFilterOptions() {
  const { data, error } = await supabase.rpc('admin_progress_filter_options');
  if (error) throw error;

  const o = data || {};
  const list = (v) => (Array.isArray(v) ? v : []);

  return {
    cities: list(o.cities)
      .map((c) => ({ id: String(c?.id || ''), count: int(c?.count) }))
      .filter((c) => c.id),
    zones: list(o.zones)
      .map((z) => ({ id: String(z?.id || ''), cityId: String(z?.cityId || ''), count: int(z?.count) }))
      .filter((z) => z.id),
    statuses: list(o.statuses)
      .map((s) => ({ id: String(s?.id || ''), count: int(s?.count) }))
      .filter((s) => s.id),
    level4Total: int(o.level4Total),
    contentTotal: int(o.contentTotal),
  };
}

/**
 * The whole filtered set, for the file (§11) — and the only place either export fetches.
 *
 * Both buttons on the page call this one function. That is the point of it: "Export CSV" and
 * "Export Excel" must be the same rows in two containers, and two fetches — however
 * carefully written — are two chances for the sort, the page size or a filter to differ
 * between them. The formats diverge at the last step, in the page, where one set of rows is
 * handed to `exportCsv()` and to `exportXlsx()` with the same `columns` array.
 *
 * Walks the same predicate the table is showing, 200 at a time, and stops at `cap`. Two
 * things come back beside the rows and neither is decoration: `truncated` says the cap was
 * reached, and `total` says how many rows the filter really matches — so the page can report
 * "the first 2,000 of 3,140" instead of a number that reads like the whole answer.
 *
 * The loop also stops as soon as a short page arrives, so the common case of a few hundred
 * યુવકો costs two calls rather than ten.
 */
export async function buildProgressReport(
  filters = {},
  { cap = EXPORT_CAP, chunk = EXPORT_CHUNK, withCounts = false, withLevel3 = false } = {}
) {
  const size = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(Number(chunk) || EXPORT_CHUNK)));
  const rows = [];
  let total = 0;
  let page = 0;
  let truncated = false;

  for (;;) {
    const res = await progressReport(filters, { page, pageSize: size, withCounts, withLevel3 });
    total = res.total;
    rows.push(...res.rows);

    if (!res.hasNext) break;
    if (rows.length >= cap) {
      truncated = true;
      break;
    }
    page += 1;
  }

  return { rows: rows.slice(0, cap), total, truncated, cap };
}
