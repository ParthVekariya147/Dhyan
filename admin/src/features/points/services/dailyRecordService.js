import { supabase } from '../../../lib/supabase';
import { resolvePoints } from '../../../../../shared/domain/points.js';
import { progressFilterOptions } from '../../progress/services/progressService';

/**
 * The reading side of the daily activity **records** - one row per (yuvak, day) - and of the
 * point configuration history.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * What a daily record is, and why it is not the daily activity view
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `admin_daily_activity()` (0032, read by ledgerService.js) answers "what did the project do on
 * one day" from the *attempts* the app observed. A daily record is a different document: it is
 * the row the yuvak himself fills in for his day, holding a **reported** count per level beside
 * the **recorded** count the app saw, inside a 24-hour edit window, with the ledger reconciled
 * to it by a compensating row rather than by a rewrite.
 *
 * The two are deliberately separate reports and this module serves only the second.
 * docs/DAILY_RECORD_ARCHITECTURE.md §9 warns about the name collision; the page above this
 * service states the difference on screen so a sanchalak never has to work it out.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * A reported count above a recorded one is a product decision, not an anomaly
 * ────────────────────────────────────────────────────────────────────────────
 *
 * §7 of the design: a yuvak may report more than the app observed, because work done away from
 * the phone still happened. Nothing in this module treats that as an error, flags it as a
 * discrepancy or computes a "shortfall". Both figures are carried through untouched, and the
 * page marks the figure - never the person - as resting on self-report.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Read only, and there is no other kind
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Nothing here writes. There is no edit path and no delete path for a daily record or for a
 * ledger row anywhere in this panel - not hidden behind a permission, not disabled, absent. A
 * correction to a day is an **additional** ledger row; the record's own audit trail is what says
 * a count moved, and the money moved separately and additively beside it.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Every filter, count and page is asked of Postgres
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `point_transactions` and the record table both grow one row per yuvak per day, so a screen
 * that fetched them and filtered in JavaScript would work in development and fail silently in
 * production. There is no aggregation and no filtering in this file. `total_rows` rides on
 * every row as a window count, so the pager can never describe a different set from the rows
 * under it.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE CONTRACT THIS FILE IS WRITTEN AGAINST
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `supabase/migrations/0034_daily_records.sql` is being written in parallel and was **not on
 * disk** when this module was written. The names below are therefore the panel's half of an
 * agreed contract rather than a reading of the SQL, and they are listed in one block so that
 * whoever lands 0034 has a single list to match rather than a file to search.
 *
 *   admin_daily_records(
 *     p_search text, p_city text, p_zone text, p_from date, p_to date,
 *     p_min_points int, p_min_level1 int, p_min_level2 int, p_min_level3 int, p_min_level4 int,
 *     p_page int, p_page_size int)
 *   → user_id, name, smk, city_id, zone_id, record_date,
 *     level1_reported … level4_reported, level1_recorded … level4_recorded,
 *     reported_total, recorded_total, base_points, bonus_points, total_points,
 *     first_submitted_at, last_updated_at, edit_until, locked_at, status, total_rows
 *
 *   admin_daily_record_detail(p_user uuid, p_date date)
 *   → one jsonb document: { record, levels[], audit[], ledger[] }
 *
 *   point_config_versions
 *   → id, version, points (the jsonb snapshot of settings['levels'].value.points),
 *     effective_from, effective_until, changed_by, changed_by_name, created_at
 *     read through admin_point_config_versions() when 0034 exposes one, and directly otherwise.
 *
 * Both functions are expected to be SECURITY DEFINER and to open with
 * `admin_assert_progress_reader()`, which **raises** 42501 rather than answering with an empty
 * result. So nothing here inspects a permission and nothing treats emptiness as suspicious: an
 * empty array means nobody matched the filter, and it means nothing else.
 */

/** The list page's default. Matches the Pager's smallest option (§18). */
export const PAGE_SIZE = 20;

/**
 * The server is expected to cap `p_page_size` at 200, and the same ceiling is applied here so a
 * caller asking for more is answered with the number it will actually get rather than being
 * silently corrected somewhere it cannot see.
 */
export const MAX_PAGE_SIZE = 200;

/**
 * How much of a filtered set one export may pull, and in what size bites.
 *
 * One row per (yuvak, day), so a month across five hundred yuvaks is fifteen thousand rows and
 * the cap is reached in ordinary use rather than in theory. That is why it is stated on screen
 * with the figure it fell short of: a file that quietly holds the first 5,000 of 15,000 days is
 * worse than no file, because somebody reconciles a total from it (§62).
 */
export const EXPORT_CAP = 5000;
const EXPORT_CHUNK = MAX_PAGE_SIZE;

/** The rungs a daily record carries a count for. Never spelled as a literal below. */
export const LEVEL_IDS = Object.freeze([1, 2, 3, 4]);

/**
 * The ladder in English. Kept here rather than imported from ledgerService so that this module
 * has no dependency on the ledger's own vocabulary - the ledger's map carries a "No level" entry
 * for manual adjustments, which a daily record cannot hold.
 */
export const LEVEL_EN = Object.freeze({
  1: 'Level 1 - Meditation',
  2: 'Level 2 - Darshan',
  3: 'Level 3 - Revision',
  4: 'Level 4',
});

export const levelLabel = (id) => LEVEL_EN[id] || (id == null ? '-' : `Level ${id}`);

/**
 * The edit window, in the panel's own words and its quietest tones.
 *
 * Neither is a fault and neither is red. "Locked" is the ordinary end of a record's life - the
 * 24 hours passed and the day is now history - so it takes plain grey rather than amber, which
 * would read as a warning about a yuvak who simply did not come back. "Editable" is `info` for
 * the same reason in the other direction: it is a state, not an achievement.
 */
export const WINDOW_EN = Object.freeze({
  EDITABLE: { id: 'EDITABLE', label: 'Editable', tone: 'info' },
  LOCKED: { id: 'LOCKED', label: 'Locked', tone: 'off' },
});

/**
 * Which of the two a row is in - **from the server, never from this browser's clock.**
 *
 * A laptop whose clock is an hour fast would otherwise paint a still-editable record as locked,
 * and a sanchalak would tell a yuvak his day was closed when the server would still accept an
 * edit. So the state is read off `locked_at` and `status`, both of which the server decided, and
 * `edit_until` is carried beside it as a deadline to *display* rather than to evaluate.
 *
 * A status token this bundle does not recognise is treated as editable only when the row also
 * carries no `locked_at`: an unknown token from a later migration must not be able to unlock a
 * record that the server has plainly closed.
 */
const LOCKED_TOKENS = new Set(['LOCKED', 'CLOSED', 'FINAL', 'EXPIRED']);

export function editWindow(row) {
  const locked = !!row?.lockedAt || LOCKED_TOKENS.has(String(row?.status || '').toUpperCase());
  return locked ? WINDOW_EN.LOCKED : WINDOW_EN.EDITABLE;
}

/**
 * A number that came off the wire, never a coercion.
 *
 * `Number(null)` is 0 and `Number('')` is 0, and a 0 in this file is a claim about a yuvak -
 * "reported nothing", "earned nothing". The string branch is not a coercion: PostgREST
 * serialises `bigint` (`total_rows`, a points total) as a JSON string, and an all-digits string
 * is that exact number and nothing else. The sign is kept, because a compensating row may be
 * negative and a day's bonus total may be too.
 */
const int = (v) => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^-?\d+$/.test(v)) return Number(v);
  return 0;
};

/** Same rule, for a figure that is allowed to be genuinely absent (a rule version, an id). */
const intOrNull = (v) => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^-?\d+$/.test(v)) return Number(v);
  return null;
};

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A date bound, or nothing.
 *
 * `<input type="date">` gives '' until a whole day has been picked. The RPC parameters are
 * Postgres `date`, not `timestamptz`, so there is no instant to get wrong and no IST offset to
 * apply: a record's `record_date` is already the IST business day the server filed it under
 * (§9). export.js's istRange() builds instants and is the mistake in the other direction.
 */
const day = (v) => (ISO_DAY.test(String(v || '')) ? String(v) : null);

/** '' and undefined mean "no filter"; a 0 the sanchalak typed is a real threshold. */
const optInt = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : null;
};

const text = (v) => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (v) => UUID_RE.test(String(v || '').trim());

const uuid = (v) => (isUuid(v) ? String(v).trim().toLowerCase() : null);

/* ---------------------------------------------------------------------------
 * The refusals that are not errors
 * ------------------------------------------------------------------------- */

/**
 * `42501` - insufficient_privilege, raised by name rather than answered with an empty result.
 *
 * The same test pointsService.js and bonusService.js make, repeated as one expression rather
 * than imported so this module has no cycle with either of them.
 */
export const isPermissionDenied = (e) => e?.code === '42501';

/**
 * The daily-record report is not in this database yet.
 *
 * `42883` is Postgres's undefined_function; `PGRST202` is PostgREST answering that no function
 * of that name and signature is in its schema cache, which is what a caller actually sees for a
 * migration that has not been applied. Separated from a real error because production runs
 * migrations on its own schedule: an ErrorState with a Try again would be telling the sanchalak
 * to retry something that cannot succeed until somebody deploys.
 */
export const isReportMissing = (e) => e?.code === '42883' || e?.code === 'PGRST202';

/**
 * The same state for a **table** rather than a function. `42P01` is undefined_table and
 * `PGRST205` is PostgREST's "could not find the table in the schema cache"; `42703` and
 * `PGRST204` are the column-level versions, which is what a partially applied 0034 would give.
 */
export const isTableMissing = (e) =>
  e?.code === '42P01' || e?.code === 'PGRST205' || e?.code === '42703' || e?.code === 'PGRST204';

/* ---------------------------------------------------------------------------
 * The records report
 * ------------------------------------------------------------------------- */

/**
 * One daily record, camelCase.
 *
 * Two names are inverted on purpose and it is not a mistake to fix. The business calls
 * `profiles.zone_id` the **city** (surat) and `profiles.sub_zone_id` the **zone** or mandal
 * (varachha), so the report returns them as `city_id` and `zone_id` and they are carried through
 * under those names - the convention progressService.js documents at length. Label them with
 * `zoneNameEn()` and `subZoneNameEn()` respectively.
 *
 * `reported` and `recorded` are kept as two separate maps rather than folded into one "count"
 * with a flag. They are two different facts - what the yuvak says his day held, and what the app
 * saw of it - and a single figure with an asterisk is the shape that loses the second one.
 *
 * The four timestamps stay as the ISO strings PostgREST returned; format.js is where an instant
 * becomes words. `editUntil` in particular is never compared here (see `editWindow()`).
 */
const fromRecordRow = (r) => {
  const reported = {};
  const recorded = {};
  for (const id of LEVEL_IDS) {
    reported[id] = int(r[`level${id}_reported`]);
    recorded[id] = int(r[`level${id}_recorded`]);
  }

  return {
    uid: r.user_id,
    name: r.name || '',
    smk: r.smk || '',
    // profiles.zone_id - 'surat'. Label with zoneNameEn().
    cityId: r.city_id || '',
    // profiles.sub_zone_id - 'varachha'. Label with subZoneNameEn().
    zoneId: r.zone_id || '',

    // The IST business day this record belongs to, as a plain YYYY-MM-DD.
    recordDate: r.record_date || '',

    reported,
    recorded,
    reportedTotal: int(r.reported_total),
    recordedTotal: int(r.recorded_total),

    basePoints: int(r.base_points),
    bonusPoints: int(r.bonus_points),
    totalPoints: int(r.total_points),

    firstSubmittedAt: r.first_submitted_at || null,
    lastUpdatedAt: r.last_updated_at || null,
    editUntil: r.edit_until || null,
    // Null means "the server has not closed this record", which is the whole of what the panel
    // is allowed to conclude about the window. See editWindow().
    lockedAt: r.locked_at || null,
    status: r.status || '',
  };
};

/**
 * Which levels on this row rest on the yuvak's own count rather than on what the app observed.
 *
 * A comparison of two numbers already sitting on the row, made for **display** only - it decides
 * nothing about which rows are shown, which is the server's job and stays there. §7 of the
 * design is explicit that this is not a fault to be counted: the answer is a list of levels to
 * label, never a score, a flag or a total of "unverified" days.
 */
export function selfReportedLevels(row) {
  return LEVEL_IDS.filter((id) => int(row?.reported?.[id]) > int(row?.recorded?.[id]));
}

/**
 * Every filter the report understands, in one shape, so the table and the file share it.
 *
 * One function and not two. The export's whole purpose is to be the same query the sanchalak is
 * looking at; building its parameters anywhere else is how an export comes to hold a different
 * set from the screen that produced it, and nobody would ever notice.
 */
export function recordParams(f = {}, { page = 0, pageSize = PAGE_SIZE } = {}) {
  return {
    p_search: text(f.search),
    p_city: text(f.city),
    p_zone: text(f.zone),
    p_from: day(f.from),
    p_to: day(f.to),
    p_min_points: optInt(f.minPoints),
    p_min_level1: optInt(f.minLevel1),
    p_min_level2: optInt(f.minLevel2),
    p_min_level3: optInt(f.minLevel3),
    p_min_level4: optInt(f.minLevel4),
    p_page: Math.max(0, Math.floor(Number(page) || 0)),
    p_page_size: Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(Number(pageSize) || PAGE_SIZE))),
  };
}

/**
 * One page of the report, and the size of the whole filtered set beside it.
 *
 * `total` comes off the first row (`count(*) over ()`, repeated on every row) rather than from a
 * second query, so the pager can never describe a different set from the rows under it. An empty
 * page answers `total: 0`, which is correct for page one and harmless past it: `page === 0` is
 * what the caller uses to decide whether "nothing matched" is a fact about the filter or about
 * having walked off the end of it.
 *
 * A migration that has not landed is returned as `{ missing: true }` rather than thrown, so the
 * page can say so in a sentence instead of offering a Try again that cannot succeed.
 */
export async function dailyRecords(filters = {}, { page = 0, pageSize = PAGE_SIZE } = {}) {
  const size = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(Number(pageSize) || PAGE_SIZE)));
  const { data, error } = await supabase.rpc(
    'admin_daily_records',
    recordParams(filters, { page, pageSize: size })
  );
  if (error) {
    if (isReportMissing(error)) return { missing: true, rows: [], total: 0, page, pageSize: size, pageCount: 0, hasNext: false };
    throw error;
  }

  const raw = Array.isArray(data) ? data : [];
  const total = raw.length ? int(raw[0].total_rows) : 0;

  return {
    rows: raw.map(fromRecordRow),
    total,
    page,
    pageSize: size,
    pageCount: size > 0 ? Math.ceil(total / size) : 0,
    hasNext: (page + 1) * size < total,
  };
}

/**
 * The whole filtered set, for the file (§11) - and the only place either export fetches.
 *
 * Both buttons on the page call this one function. That is the point of it: "Export CSV" and
 * "Export Excel" must be the same rows in two containers, and two fetches - however carefully
 * written - are two chances for a filter to differ between them. The formats diverge at the last
 * step, in the page, where one set of rows is handed to `exportCsv()` and to `exportXlsx()` with
 * the same `columns` array.
 *
 * Walks the same predicate the table is showing, 200 at a time, and stops at `cap`. It also
 * stops as soon as a short page arrives, so the ordinary case of a few hundred days costs two
 * calls rather than twenty-five.
 */
export async function buildDailyRecordReport(filters = {}, { cap = EXPORT_CAP, chunk = EXPORT_CHUNK } = {}) {
  const size = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(Number(chunk) || EXPORT_CHUNK)));
  const rows = [];
  let total = 0;
  let page = 0;
  let truncated = false;

  for (;;) {
    const res = await dailyRecords(filters, { page, pageSize: size });
    // Nothing to export from a database that has no report in it yet, and the page has already
    // said so - returning zero rows here rather than throwing keeps that one sentence the only
    // thing on screen about it.
    if (res.missing) return { rows: [], total: 0, truncated: false, cap, missing: true };

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

/* ---------------------------------------------------------------------------
 * One record, opened
 * ------------------------------------------------------------------------- */

/**
 * One row of the record's audit trail: a count moved, and what the day was worth either side.
 *
 * The two pairs are carried separately - `oldCount`/`newCount` and `pointsBefore`/`pointsAfter` -
 * because they are two different records of the same edit and the panel must not present the
 * second as a consequence it computed from the first. The count is what the yuvak changed; the
 * points are what the engine then made of it, and only the server knows the rules that were live
 * at that instant.
 */
const fromAuditRow = (r, i) => ({
  // The three streams a detail document may union are numbered independently, so a key is built
  // from the instant plus the position rather than read off an id that may not exist.
  key: `${r?.at || ''}|${r?.level_id ?? ''}|${i}`,
  at: r?.at || null,
  levelId: intOrNull(r?.level_id),
  oldCount: intOrNull(r?.old_count),
  newCount: intOrNull(r?.new_count),
  pointsBefore: intOrNull(r?.points_before),
  pointsAfter: intOrNull(r?.points_after),
  reason: r?.reason ?? null,
  actorName: r?.actor_name || '',
});

/**
 * One ledger row behind the day.
 *
 * Mapped to the same key names `ledgerService.js` uses for a ledger row, so the detail panel and
 * the Point ledger page describe the same record in the same words. `awardKind` and `reason` are
 * left null rather than defaulted: on a row written before the rules engine they were never
 * asked, and '' would be indistinguishable from a value somebody left blank.
 */
const fromLedgerRow = (r, i) => ({
  key: r?.id != null ? `l${r.id}` : `l${r?.created_at || ''}|${i}`,
  id: intOrNull(r?.id),
  levelId: intOrNull(r?.level_id),
  activityKey: r?.activity_key || '',
  title: r?.title || '',
  points: int(r?.points),
  awardKind: r?.award_kind ?? null,
  source: r?.source || '',
  ruleVersion: intOrNull(r?.rule_version),
  reason: r?.reason ?? null,
  adminName: r?.admin_name || '',
  isLegacy: r?.is_legacy === true,
  createdAt: r?.created_at || null,
});

/** One level's line inside the opened record: what was reported, what was recorded, what it paid. */
const fromLevelRow = (r) => ({
  levelId: intOrNull(r?.level_id),
  reported: int(r?.reported_count),
  recorded: int(r?.recorded_count),
  points: int(r?.points),
});

/**
 * One record, its per-level counts, its audit trail and the ledger rows behind that day.
 *
 * One call and one document, because they are one answer: the counts, the edits and the money
 * all have to be cut on the same (yuvak, day), and three round trips would let the audit trail
 * describe an edit the ledger below it does not show.
 *
 * Both arguments are validated before the call rather than after. `p_user` is a Postgres uuid
 * and a half-formed one comes back as 22P02, which errors.js words as "the details entered are
 * not in the right format" - a sentence about a detail panel the sanchalak opened by pressing a
 * button, which would tell him nothing he can act on.
 */
export async function dailyRecordDetail(userId, recordDate) {
  const id = uuid(userId);
  const d = day(recordDate);
  if (!id || !d) return { record: null, levels: [], audit: [], ledger: [] };

  const { data, error } = await supabase.rpc('admin_daily_record_detail', { p_user: id, p_date: d });
  if (error) {
    if (isReportMissing(error)) return { missing: true, record: null, levels: [], audit: [], ledger: [] };
    throw error;
  }

  // A jsonb document is the expected shape; a single-row set-returning function would arrive as
  // an array of one. Both are accepted so that a reasonable choice by 0034 either way does not
  // render an empty panel over a record that was read successfully.
  const doc = (Array.isArray(data) ? data[0] : data) || {};
  const list = (v) => (Array.isArray(v) ? v : []);

  return {
    record: doc.record ? fromRecordRow(doc.record) : null,
    levels: list(doc.levels).map(fromLevelRow),
    audit: list(doc.audit).map(fromAuditRow),
    ledger: list(doc.ledger).map(fromLedgerRow),
  };
}

/* ---------------------------------------------------------------------------
 * The configuration history
 * ------------------------------------------------------------------------- */

/** How many versions one read lists. A configuration nobody edits daily does not need more. */
export const CONFIG_LIMIT = 50;

/**
 * One version of `settings['levels'].value.points`, as it stood while it was in force.
 *
 * The stored snapshot is read through **`resolvePoints()`** - the same resolver PointsPage's form
 * uses, and the same one the engine's own rules mirror - rather than through a looser read of
 * this panel's own. A `level4` price stored as the string "100" is a price the engine does not
 * pay, and this history has to show what a yuvak was actually paid under, which is exactly when
 * the difference matters.
 *
 * `effectiveUntil` is genuinely null on the version currently in force, and that null is the
 * whole answer to "which one is live", so it is never defaulted to a date.
 */
const fromVersionRow = (r) => {
  const snapshot = r?.points ?? r?.value ?? null;
  return {
    id: r?.id ?? null,
    version: intOrNull(r?.version),
    snapshot,
    values: resolvePoints(snapshot),
    effectiveFrom: r?.effective_from || null,
    effectiveUntil: r?.effective_until || null,
    changedBy: r?.changed_by || null,
    changedByName: r?.changed_by_name || '',
    createdAt: r?.created_at || null,
  };
};

/**
 * Every recorded configuration version, newest first.
 *
 * Two ways in, tried in that order, because 0034 may expose either. The RPC is preferred: it can
 * resolve `changed_by` to a name through `profiles`, which a direct table read cannot do without
 * an embed this panel would have to guess the shape of. The table is the documented fallback.
 *
 * The two failure states are told apart and neither is an error the page may retry:
 *
 *   denied   42501, raised by name. Only the RPC can report it - an RLS *read* denial on the
 *            table answers with **no rows**, which is why a table read that comes back empty is
 *            reported as empty rather than as a refusal. The page words that carefully.
 *   missing  the migration has not been applied here. A deployment state, not a failure.
 */
export async function configVersions({ limit = CONFIG_LIMIT } = {}) {
  const n = Math.max(1, Math.floor(Number(limit) || CONFIG_LIMIT));

  const viaRpc = await supabase.rpc('admin_point_config_versions', { p_limit: n });
  if (!viaRpc.error) {
    return { versions: (Array.isArray(viaRpc.data) ? viaRpc.data : []).map(fromVersionRow), source: 'rpc' };
  }
  if (isPermissionDenied(viaRpc.error)) return { denied: true, versions: [] };
  if (!isReportMissing(viaRpc.error)) throw viaRpc.error;

  const viaTable = await supabase
    .from('point_config_versions')
    .select('*')
    // `effective_from` and not `created_at`: two versions written in one minute are ordered by
    // when they took effect, which is the order this history is read in. `id` breaks the tie so
    // the list cannot reorder itself between two identical reads.
    .order('effective_from', { ascending: false })
    .order('id', { ascending: false })
    .limit(n);

  if (viaTable.error) {
    if (isPermissionDenied(viaTable.error)) return { denied: true, versions: [] };
    if (isTableMissing(viaTable.error)) return { missing: true, versions: [] };
    throw viaTable.error;
  }

  return { versions: (Array.isArray(viaTable.data) ? viaTable.data : []).map(fromVersionRow), source: 'table' };
}

/**
 * What changed between one version and the one before it, in sentences.
 *
 * Computed from the two snapshots rather than read from a stored diff, and that is deliberate:
 * the snapshots are the record, a diff column would be a second description of the same fact,
 * and the two would disagree the first time somebody backfilled one of them. This is a
 * comparison of two small documents the page already holds, not a filter the browser is doing on
 * the server's behalf.
 *
 * `prev` is null for the oldest version in the list, which answers with an empty array - and the
 * card says "the earliest recorded configuration" rather than "nothing changed", because those
 * are different claims and only one of them is true.
 */
export function describeChange(cur, prev) {
  if (!cur || !prev) return [];
  const a = prev.values || {};
  const b = cur.values || {};
  const out = [];

  if (a.enabled !== b.enabled) {
    out.push(b.enabled ? 'Points switched on' : 'Points switched off');
  }

  for (const key of ['level1', 'level2', 'level3']) {
    if (int(a[key]) !== int(b[key])) {
      out.push(`${LEVEL_EN[Number(key.slice(-1))]}: ${int(a[key])} to ${int(b[key])}`);
    }
  }

  const a4 = a.level4 || {};
  const b4 = b.level4 || {};
  if (int(a4.default) !== int(b4.default)) {
    out.push(`Level 4 default: ${int(a4.default)} to ${int(b4.default)}`);
  }

  // Every code either side, so a price that was *removed* is reported as plainly as one that was
  // added. A removal is the change most likely to surprise somebody reading an old award, since
  // the test silently falls back to the default from that moment on.
  const codes = [...new Set([...Object.keys(a4), ...Object.keys(b4)])].filter((c) => c !== 'default').sort();
  for (const code of codes) {
    const was = a4[code];
    const now = b4[code];
    if (was === undefined && now !== undefined) out.push(`Test ${code} priced at ${int(now)}`);
    else if (was !== undefined && now === undefined) out.push(`Test ${code} price removed - it pays the Level 4 default from here`);
    else if (int(was) !== int(now)) out.push(`Test ${code}: ${int(was)} to ${int(now)}`);
  }

  return out;
}

/* ---------------------------------------------------------------------------
 * The filter lists
 * ------------------------------------------------------------------------- */

/**
 * The City and mandal lists, read from the rows that exist.
 *
 * Re-exported from the progress feature rather than reimplemented, exactly as ledgerService.js
 * does and for the same reason: `admin_progress_filter_options()` already answers this question
 * with counts beside each option, and a second wrapper over one RPC is a second place for the
 * two inverted names to be inverted the wrong way round.
 */
export const filterOptions = progressFilterOptions;
