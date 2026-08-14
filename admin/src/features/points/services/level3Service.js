import { supabase } from '../../../lib/supabase';
import { filterOptions } from './ledgerService';

/**
 * §29 — the લેવલ ૩ report: one row per યુવક, with what his પુનરાવર્તન added up to.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why this is a report of its own and not four more columns on Progress
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The Progress page already shows Level 3 revisions, ticks and points. It gets them from
 * `admin_level3_report()`, which is handed **the page of user ids the progress report has
 * already returned** — the same shape `activityCounts()` uses, and for the same good reason
 * (§39): the report decides who is on screen, and re-deciding it in a second call is two
 * implementations of one selection waiting to drift apart.
 *
 * That is exactly what makes the §29 questions unanswerable there. "Show the yuvaks with 50 or
 * more Level 3 points" filtered on the Progress page could only mean *of the twenty rows this
 * page happens to be showing*, because the Level 3 figures are merged on after the paging and
 * the sorting have already happened. The count under the table would keep saying 2,000, the
 * pager would keep offering page 4 of 100, and the twenty rows would be a filter of one page.
 * A report that is silently a filter of a page is a wrong answer that looks like a right one
 * (§62), so §29 gets a reader of its own.
 *
 * `admin_level3_users()` (0035) is that reader: every threshold, the search, the city, the
 * મંડળ, the status, the window, the sort, the count and the page are decided in Postgres, and
 * the browser receives the answer rather than the rows it was computed from.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * "Who did NOT do Level 3 today" is why the function LEFT JOINs from profiles
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Every other reporting function in this section starts from something a યુવક did — an attempt,
 * a ledger row, a daily record — so a યુવક who did nothing is simply absent from the result,
 * and DailyActivityPage says so on screen in as many words. An absence cannot be listed from a
 * table of events, and §29 asks for it to be listed.
 *
 * 0035 answers that by starting the query at `profiles` and joining the attempts on, so a યુવક
 * with no પુનરાવર્તન at all is a row with zeroes in it rather than no row. `p_active` is then a
 * predicate over `today_revisions`, and it is **three-valued on purpose**: true is "did", false
 * is "did not", null is "do not ask". See `DAY_ACTIVITY` below for why false cannot be spelled
 * as a minimum instead.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Two honest counts of the same ticks, and neither may be labelled as the other
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `ticks` is **additive** across પુનરાવર્તન: ૫૦ then ૪૦ then ૩૦ is ૧૨૦, and it is the figure the
 * points follow since 0035 made a repeated પુનરાવર્તન earn again. `scenesDistinct` is the
 * **de-duplicated** set behind those ticks, so the same yuvak at the same instant is ૧૨૦ and ૫૦.
 * Both are true and they answer different questions: how much પુનરાવર્તન he did, and how much of
 * the collection he brought to mind. They are mapped under names that cannot be confused and the
 * page carries both columns, because showing one under the other's heading would read as the
 * ledger disagreeing with itself.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * An empty result and a refusal are not the same thing
 * ────────────────────────────────────────────────────────────────────────────
 *
 * admin/src/lib/errors.js sets out the panel's usual rule: an RLS *read* denial returns no rows
 * rather than an error, so a page normally cannot tell "nobody matched" from "you may not ask".
 * `admin_level3_users()` is SECURITY DEFINER and **raises** `level3_report_forbidden` (42501)
 * when `progress.read` is missing, so nothing here inspects a permission and nothing treats
 * emptiness as suspicious: an empty array means nobody matched the filter, and nothing else.
 */

/** The list page's default. Matches the Pager's smallest option (§18). */
export const PAGE_SIZE = 20;

/**
 * The server clamps `p_page_size` to 1..200, and the same ceiling is applied here so a caller
 * asking for more is answered with the number it will actually get rather than being silently
 * corrected somewhere it cannot see.
 */
export const MAX_PAGE_SIZE = 200;

/**
 * How much of a filtered report one export may pull, and in what size bites.
 *
 * One row per યુવક rather than one per award, so this is the progress report's shape and not the
 * ledger's — five hundred યુવકો today and fifty thousand later (§32). 5,000 at 200 a call is
 * twenty-five round trips in the worst case and one in the ordinary one, because the loop stops
 * as soon as a short page arrives.
 *
 * A cap that is reached comes back as `truncated` and is said out loud by the page, with the
 * figure it fell short of. A file that quietly holds the first 5,000 of 8,300 યુવકો is worse than
 * no file, because somebody reconciles a total from it (§62).
 */
export const EXPORT_CAP = 5000;
const EXPORT_CHUNK = MAX_PAGE_SIZE;

/**
 * The sorts `p_sort` accepts, verbatim from 0035's whitelist.
 *
 * Listed here so the page can offer nothing the server would silently fall back from. The
 * function does not raise on an unrecognised token — it orders by points instead, which is the
 * right behaviour for a panel from a later bundle and the wrong thing for a column header to
 * rely on: a header that appeared to sort and did not is worse than a header that does not sort.
 *
 * `today_revisions` is deliberately absent. 0035 whitelists `today_points` and `today_ticks` and
 * not the third, so the column exists and its header is not a button.
 */
export const SORT_FIELDS = Object.freeze([
  'points',
  'ticks',
  'revisions',
  'scenes',
  'days',
  'last',
  'today_points',
  'today_ticks',
  'name',
  'smk',
]);

const SORT_SET = new Set(SORT_FIELDS);

/** The default the server would choose anyway, stated so the page never has an empty sort. */
export const DEFAULT_SORT = 'points';
export const DEFAULT_DIR = 'desc';

/**
 * The three answers to "what happened on the chosen day", and why there are three of them.
 *
 * `p_active` is a nullable boolean and the panel must be able to send all three values, so this
 * is a select with three options rather than a checkbox. A checkbox has two states and would
 * make "do not ask" and one of the two answers the same press.
 *
 * **"Did not" cannot be spelled as a minimum of zero, and that is the whole reason this control
 * exists.** The three numeric filters below are all `>=` bounds: `p_min_ticks = 0` matches
 * everybody, because every count is zero or more. There is no maximum parameter and there is no
 * "exactly" parameter, so an absence cannot be expressed as a threshold at all — asking for it
 * has to be asking for it. `NOT` sends `false`, which 0035 reads as `today_revisions = 0` over a
 * set that starts at `profiles`, so a યુવક who has never opened લેવલ ૩ is in the answer rather
 * than missing from it.
 *
 * The words avoid a verdict. "Did not" is a fact about a day; "inactive", "missed" or "pending"
 * would be a fact about a person, and this panel does not say those about a યુવક (§10, §14).
 */
export const DAY_ACTIVITY = Object.freeze([
  {
    id: 'ANY',
    label: 'Any',
    value: null,
    hint: 'Everybody, whatever they did on that day',
  },
  {
    id: 'DID',
    label: 'Did Level 3',
    value: true,
    hint: 'At least one revision submitted on that day',
  },
  {
    id: 'NOT',
    label: 'Did not',
    value: false,
    hint: 'No revision submitted on that day, including yuvaks who have never done one',
  },
]);

const DAY_ACTIVITY_BY_ID = Object.freeze(
  Object.fromEntries(DAY_ACTIVITY.map((d) => [d.id, d]))
);

/**
 * One of the three tokens as the boolean the RPC wants, defaulting to "do not ask".
 *
 * An id this bundle does not know about becomes null rather than false: a filter that arrived
 * from a stale bookmark must widen the report, never narrow it to an answer nobody asked for.
 */
export const dayActivityValue = (id) => {
  const d = DAY_ACTIVITY_BY_ID[String(id || '').toUpperCase()];
  return d ? d.value : null;
};

/** The chosen option in words, for a filter chip. */
export const dayActivityLabel = (id) => DAY_ACTIVITY_BY_ID[String(id || '').toUpperCase()]?.label || '';

/**
 * A number that came off the wire, never a coercion.
 *
 * `Number(null)` is 0 and `Number('')` is 0, and a 0 in this file is a claim about a યુવક — "he
 * did no પુનરાવર્તન". The string branch is not a coercion: PostgREST serialises `bigint` (every
 * count this function returns, and `total_rows`) as a JSON string, and an all-digits string is
 * that exact number and nothing else. The sign is kept, because a MANUAL correction can pull a
 * લેવલ ૩ points total downward.
 */
const int = (v) => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^-?\d+$/.test(v)) return Number(v);
  return 0;
};

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A date bound, or nothing.
 *
 * `<input type="date">` gives '' until a whole day has been picked. The RPC parameters are
 * Postgres `date` and not `timestamptz`, so there is no instant to get wrong and no IST offset to
 * apply: `activity_attempts.activity_date` is already the IST business day the server filed the
 * work under (§9). export.js's istRange() builds instants and is therefore the mistake in the
 * other direction — it is not used here.
 *
 * `p_day` goes through the same helper, which is what lets it be left blank: null means "today in
 * IST **on the server**", and that is where the boundary of the business day belongs. A date
 * computed in this browser would let a laptop in another timezone move it at half past midnight
 * in Surat.
 */
const day = (v) => (ISO_DAY.test(String(v || '')) ? String(v) : null);

/** '' and undefined mean "no filter"; a 0 the સંચાલક typed is a real bound, useless as it is. */
const optInt = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : null;
};

const text = (v) => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
};

/** One of the whitelisted sorts, or the server's own default rather than a token it would drop. */
const sortField = (v) => {
  const s = String(v || '').toLowerCase();
  return SORT_SET.has(s) ? s : DEFAULT_SORT;
};

const sortDir = (v) => (String(v || '').toLowerCase() === 'asc' ? 'asc' : 'desc');

/**
 * The refusal this report can actually meet, told apart from every other failure.
 *
 * 0035 raises `level3_report_forbidden` with SQLSTATE 42501, and errors.js already renders 42501
 * as "You do not have permission to view this." — which is true and is all a સંચાલક needs. This
 * predicate exists for the page rather than for the sentence: a refusal is not a state a Try
 * again can clear, so the page offers an explanation instead of a retry button (§34).
 */
export const isLevel3Forbidden = (e) =>
  e?.code === '42501' || String(e?.message || '').includes('level3_report_forbidden');

/**
 * A migration that has not landed, which is a deployment state rather than a failure.
 *
 * `42883` is undefined_function and `PGRST202` is PostgREST's "could not find the function in the
 * schema cache" — both mean 0035 has not been applied to this database. Same predicate
 * dailyRecordService.js uses, kept here rather than imported so this module owes nothing to the
 * daily-record contract.
 */
export const isReportMissing = (e) => e?.code === '42883' || e?.code === 'PGRST202';

/**
 * What went wrong, in one sentence, for a page that needs to say it beside its own controls.
 *
 * Only the two conditions worth naming are named; everything else is left to `dataError()` in the
 * page, which is where the panel's one calm fallback sentence lives. Returning null for the
 * ordinary case is what keeps this from becoming a second error vocabulary (§12, §53).
 */
export function level3Error(e) {
  if (isLevel3Forbidden(e)) {
    return 'You do not have permission to read the Level 3 report. It needs the same permission as the Progress section.';
  }
  if (isReportMissing(e)) {
    return 'This database has no Level 3 report yet - the migration that creates it has not been applied here.';
  }
  return null;
}

/**
 * One row of the report, camelCase.
 *
 * Two names are inverted on purpose and it is not a mistake to fix. The business calls
 * `profiles.zone_id` the **city** (surat) and `profiles.sub_zone_id` the **zone** or મંડળ
 * (varachha), so 0035 returns them as `city_id` and `zone_id` and they are carried through under
 * those names — the same convention progressService.js and ledgerService.js document at length.
 * Label them with `zoneNameEn()` and `subZoneNameEn()` respectively.
 *
 * `ticks` and `scenesDistinct` are the additive and the de-duplicated count of the same ticks;
 * see the header of this file for why both are carried and neither is renamed to the other.
 *
 * `lastAt` stays null rather than becoming '' or an epoch: a યુવક who has submitted no
 * પુનરાવર્તન in the window has no last one, and that is an absence rather than a date. The page
 * prints a dash for it and the file leaves the cell empty.
 */
const fromRow = (r) => ({
  uid: r.user_id,
  name: r.name || '',
  smk: r.smk || '',
  // profiles.zone_id — 'surat'. Label with zoneNameEn().
  cityId: r.city_id || '',
  // profiles.sub_zone_id — 'varachha'. Label with subZoneNameEn().
  zoneId: r.zone_id || '',
  status: r.account_status || '',
  // How many times he pressed submit in the window. Since 0035 every one of them is paid on its
  // own terms, so this is a count of awards as much as of acts.
  revisions: int(r.revisions),
  // Additive: 50 + 40 + 30 = 120. The figure the points follow, with no ceiling.
  ticks: int(r.ticks),
  // The de-duplicated set behind those ticks: 50. Withheld દ્રશ્યો are already excluded by 0035.
  scenesDistinct: int(r.scenes_distinct),
  points: int(r.points),
  days: int(r.days),
  lastAt: r.last_at || null,
  // The three figures for `p_day`, which is the server's IST today unless one was asked for.
  todayRevisions: int(r.today_revisions),
  todayTicks: int(r.today_ticks),
  todayPoints: int(r.today_points),
});

/**
 * Every filter the report understands, in one shape, so the table and the file share it.
 *
 * One function and not two. The export's whole purpose is to be the same query the સંચાલક is
 * looking at; building its parameters anywhere else is how an export comes to hold a different
 * set from the screen that produced it, and nobody would ever notice.
 */
export function level3Params(f = {}, { page = 0, pageSize = PAGE_SIZE } = {}) {
  return {
    p_search: text(f.search),
    p_city: text(f.city),
    p_zone: text(f.zone),
    p_status: text(f.status),
    p_from: day(f.from),
    p_to: day(f.to),
    // Blank hands the choice of "today" to the server. See day() above for why that matters.
    p_day: day(f.day),
    /*
      Three-valued, and it goes through the map rather than through a truthiness test on the way.
      `f.active || null` would fold a deliberate `false` into null and turn "who did NOT do
      Level 3" into "everybody" - a filter that silently widens is the one failure this control
      exists to prevent.
    */
    p_active: dayActivityValue(f.active),
    p_min_points: optInt(f.minPoints),
    p_min_ticks: optInt(f.minTicks),
    p_min_revs: optInt(f.minRevisions),
    p_sort: sortField(f.sort),
    p_dir: sortDir(f.dir),
    p_page: Math.max(0, Math.floor(Number(page) || 0)),
    p_page_size: Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(Number(pageSize) || PAGE_SIZE))),
  };
}

/**
 * One page of the report, and the size of the whole filtered set beside it.
 *
 * `total` comes off the first row (`count(*) over ()`, repeated on every row) rather than from a
 * second query, so the pager can never describe a different set from the rows under it — the same
 * arrangement `admin_progress_report()` and `admin_daily_records()` already use. An empty page
 * answers `total: 0`, which is correct for page one and harmless past it: `page === 0` is what
 * the caller uses to decide whether "nothing matched" is a fact about the filter or about having
 * walked off the end of it.
 *
 * Two conditions come back as a flag rather than thrown, because neither is something a Try again
 * can clear (§34) and `useAsync` hands a page the *sentence* rather than the error it came from:
 *
 *   `missing`    0035 has not been applied to this database. A deployment state, not a failure.
 *   `forbidden`  the report refused. The route is already gated on `progress.read`, so meeting
 *                this means the panel's permission table and the database disagree - which is
 *                worth its own sentence rather than the generic "you do not have permission",
 *                and worth not offering a retry that will refuse identically.
 *
 * Everything else is thrown and becomes errors.js's one calm sentence with a Try again beside it,
 * which is right for a network failure and for a statement timeout.
 */
export async function level3Users(filters = {}, { page = 0, pageSize = PAGE_SIZE } = {}) {
  const size = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(Number(pageSize) || PAGE_SIZE)));
  const empty = { rows: [], total: 0, page, pageSize: size, pageCount: 0, hasNext: false };
  const { data, error } = await supabase.rpc(
    'admin_level3_users',
    level3Params(filters, { page, pageSize: size })
  );
  if (error) {
    if (isReportMissing(error)) return { ...empty, missing: true };
    if (isLevel3Forbidden(error)) return { ...empty, forbidden: true };
    throw error;
  }

  const raw = Array.isArray(data) ? data : [];
  const total = raw.length ? int(raw[0].total_rows) : 0;

  return {
    rows: raw.map(fromRow),
    total,
    page,
    pageSize: size,
    pageCount: size > 0 ? Math.ceil(total / size) : 0,
    hasNext: (page + 1) * size < total,
  };
}

/**
 * The whole filtered report, for the file (§11) — and the only place either export fetches.
 *
 * Both buttons on the page call this one function. That is the point of it: "Export CSV" and
 * "Export Excel" must be the same rows in two containers, and two fetches — however carefully
 * written — are two chances for the sort, the page size or a filter to differ between them. The
 * formats diverge at the last step, in the page, where one set of rows is handed to `exportCsv()`
 * and to `exportXlsx()` with the same `columns` array.
 *
 * Walks the same predicate **and the same sort** the table is showing, 200 at a time, and stops at
 * `cap`. It also stops as soon as a short page arrives, so the ordinary case of a few hundred
 * યુવકો costs one call rather than twenty-five.
 */
export async function buildLevel3Report(filters = {}, { cap = EXPORT_CAP, chunk = EXPORT_CHUNK } = {}) {
  const size = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(Number(chunk) || EXPORT_CHUNK)));
  const rows = [];
  let total = 0;
  let page = 0;
  let truncated = false;

  for (;;) {
    const res = await level3Users(filters, { page, pageSize: size });
    /*
      Nothing to export from a database that has no report in it, and nothing to export from one
      that refused the read. Both are carried out as the same flag the table already showed, so
      the file's notice repeats what is on screen instead of introducing a second explanation of
      one condition.
    */
    if (res.missing) return { rows: [], total: 0, truncated: false, cap, missing: true };
    if (res.forbidden) return { rows: [], total: 0, truncated: false, cap, forbidden: true };

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

/**
 * The City, મંડળ and Status lists, re-exported rather than reimplemented.
 *
 * `admin_progress_filter_options()` already answers exactly this question with the counts beside
 * each option, and this report filters the same `profiles.zone_id` / `profiles.sub_zone_id` /
 * `profiles.status` the progress report does. ledgerService.js re-exports it under this feature's
 * own name for that reason; taking it from there rather than reaching into progress/ again keeps
 * the coupling one line in one file — and a second wrapper over one RPC is a second place for the
 * city and the zone to be inverted the wrong way round.
 */
export { filterOptions };
