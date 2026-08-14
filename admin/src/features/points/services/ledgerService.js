import { supabase } from '../../../lib/supabase';
import { progressFilterOptions } from '../../progress/services/progressService';

/**
 * §16, §22, §23, §24 — the reading side of the point ledger.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * What this module is, and what it deliberately is not
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Five functions in `supabase/migrations/0032_admin_points_reporting.sql`, mapped to
 * camelCase and nothing more. There is no aggregation in this file and there is no filtering
 * in this file: every filter, every count, every sum and every rank is computed in Postgres
 * and the browser receives the answer rather than the rows it was computed from.
 *
 * That is not a preference. `point_transactions` holds one row per (યુવક, day, level,
 * activity) for the day-scoped kinds and one row per event for the repeatable ones, so it is
 * the fastest-growing table in the project: five hundred યુવકો today and fifty thousand
 * later (§32). A screen that fetched the ledger and filtered it in JavaScript would work in
 * development and fail silently in production, and the failure would be a phone holding a
 * hundred thousand rows in order to print twenty.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Read only, and there is no other kind
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The ledger is append-only: `point_transactions` has a read policy and no write policy, and
 * `insert, update, delete` are revoked from `anon` and `authenticated` (0021). Nothing in
 * this module writes, and no page built on it offers an edit or a delete for a ledger row —
 * a correction is a **new** MANUAL row with a reason and an admin's name on it, written by
 * `admin_award_manual_points()`, which lives in the settings side of the panel and not here.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * An empty result and a refusal are not the same thing
 * ────────────────────────────────────────────────────────────────────────────
 *
 * admin/src/lib/errors.js sets out the panel's usual rule: an RLS *read* denial returns no
 * rows rather than an error, so a page normally cannot tell "nobody matched" from "you may
 * not ask". Every function below is `SECURITY DEFINER` and calls
 * `admin_assert_progress_reader()` on its first line, which **raises** 42501 (§31). So
 * nothing here inspects a permission and nothing treats emptiness as suspicious: an empty
 * array means nobody matched the filter, and it means nothing else.
 */

/** The list pages' default. Matches the Pager's smallest option (§18). */
export const PAGE_SIZE = 20;

/**
 * The server caps `p_page_size` at 200 and the same ceiling is applied here, so a caller
 * asking for more is answered with the number it will actually get rather than being
 * silently corrected somewhere it cannot see.
 */
export const MAX_PAGE_SIZE = 200;

/**
 * How much of a filtered ledger one export may pull, and in what size bites.
 *
 * Higher than the progress report's 2,000 and for a stated reason: that report holds one row
 * per યુવક, and this one holds one row per *award*, so the same question ("this month, all
 * levels") is an order of magnitude more rows. 5,000 at 200 a call is twenty-five round trips
 * in the worst case and two in the ordinary one, because the loop stops as soon as a short
 * page arrives.
 *
 * A cap that is reached is returned as `truncated` and said out loud by the page, with the
 * figure it fell short of. A file that quietly holds the first 5,000 of 8,300 awards is worse
 * than no file, because somebody reconciles a total from it (§62).
 */
export const EXPORT_CAP = 5000;
const EXPORT_CHUNK = MAX_PAGE_SIZE;

/**
 * The daily view's per-person list is capped in SQL at 2,000 and defaults to 500. The default
 * is repeated here so the page can offer the same choices the server will honour instead of
 * asking for a number that is silently clamped.
 */
export const DAILY_LIMIT = 500;
export const DAILY_MAX = 2000;

/** `admin_leaderboard`'s own bounds — default 20, hard ceiling 500. */
export const BOARD_LIMIT = 20;
export const BOARD_MAX = 500;

/**
 * Every value `point_transactions.award_kind` may hold, plus the one the *filter* adds.
 *
 * The five kinds are the check constraint in 0031, verbatim. `LEGACY` is not among them and
 * is not a value: `award_kind is null` means the row was written before 0031 and no kind,
 * rule version or reason was ever recorded. `admin_point_transactions()` accepts 'LEGACY' as
 * `p_kind` and translates it to `award_kind is null` in SQL, because "show me everything from
 * before the new system" is the question §0 makes worth asking — those rows are the historical
 * total that must never move, and a screen that cannot select them cannot check that.
 *
 * `tone` is the badge tint and never the only signal: the word beside it says the same thing
 * (§43). Nothing here is red. A MANUAL adjustment is an administrative act, not a fault, and
 * a legacy row is history rather than a problem.
 */
export const AWARD_KINDS = Object.freeze([
  { id: 'DAY_FIRST', label: 'First of the day', tone: 'ok', hint: "The activity's own value, paid once for that day" },
  { id: 'REPEAT', label: 'Repeat', tone: 'info', hint: 'A test sat again after the day was already paid' },
  /*
    The two લેવલ ૩ kinds, and both hints were rewritten by 0035 rather than tidied.

    TICK used to say "newly brought to mind that day", which described one of the two tick
    counting modes as though it were the kind's meaning. It is not: `earn.tickCount` chooses
    between FRESH - only દ્રશ્યો not already counted that day - and ALL, where every valid tick
    of every submission is paid. Under ALL a repeated પુનરાવર્તન **accumulates**: ૫૦ then ૪૦ then
    ૩૦ is ૧૨૦ ticks and ૧૨૦ ticks' worth of points, on દ્રશ્યો he may have named before. A
    સંચાલક reading the old hint beside a row like that would have concluded the ledger was
    wrong.

    REVISION said "paid once per submission", which was right and read as a limit because it sat
    beside a system where everything was paid once a day. It is a rate: every submission is paid,
    with no ceiling but the daily cap.
  */
  { id: 'TICK', label: 'Per tick', tone: 'info', hint: 'Level 3, paid per darshan ticked - every revision, or only the first time each is named that day' },
  { id: 'REVISION', label: 'Per revision', tone: 'info', hint: 'Level 3, paid for every submission - a repeated revision earns again' },
  { id: 'MANUAL', label: 'Manual adjustment', tone: 'warn', hint: 'Entered by an admin, with a reason' },
  { id: 'LEGACY', label: 'Before the new engine', tone: 'off', hint: 'Written before migration 0031 - no kind was recorded' },
]);

const KIND_BY_ID = Object.freeze(
  Object.fromEntries(AWARD_KINDS.map((k) => [k.id, k]))
);

/**
 * One award kind, said in words — including the two cases that are not a kind at all.
 *
 * `is_legacy` arrives from the server as its own boolean rather than being inferred here,
 * because 0032 makes that interpretation once in SQL for all four screens that read the
 * ledger. A null kind on a row the server did not flag can only come from a later migration:
 * it is shown raw rather than as a blank, which would read as "this field is empty" when the
 * truth is "this field was never asked".
 */
export function awardKind(row) {
  if (row?.isLegacy) return KIND_BY_ID.LEGACY;
  const k = KIND_BY_ID[row?.awardKind];
  if (k) return k;
  return { id: row?.awardKind || '', label: row?.awardKind || '-', tone: 'off', hint: '' };
}

/**
 * `point_transactions.source` — which writer produced the row. The three values are 0031's
 * check constraint; 0021 knew only the first two.
 */
export const SOURCES = Object.freeze([
  { id: 'ACTIVITY_ATTEMPT', label: 'Levels 1-3 submission' },
  { id: 'LEVEL4_ATTEMPT', label: 'Level 4 test' },
  { id: 'MANUAL_ADJUSTMENT', label: 'Manual adjustment' },
]);

const SOURCE_BY_ID = Object.freeze(Object.fromEntries(SOURCES.map((s) => [s.id, s])));

/** The source in words, falling back to the raw value so a new writer is visible. */
export const sourceLabel = (id) => SOURCE_BY_ID[id]?.label || id || '-';

/**
 * The ladder in English, keyed on the level ids the ledger stores.
 *
 * 0 is not a level and is not a mistake: `point_transactions_level_id_check` allows 0..4 and
 * 0031 reserves 0 for a manual adjustment, which belongs to no level. It is outside 1..4 so
 * it can never be confused with one, and it is spelled out here rather than rendered as
 * "Level 0", which would read as a rung of the ladder that does not exist.
 */
export const LEVEL_EN = Object.freeze({
  0: 'No level',
  1: 'Level 1 - Meditation',
  2: 'Level 2 - Darshan',
  3: 'Level 3 - Revision',
  4: 'Level 4',
});

export const levelLabel = (id) => LEVEL_EN[id] || (id == null ? '-' : `Level ${id}`);

/**
 * A number that came off the wire, never a coercion.
 *
 * `Number(null)` is 0 and `Number('')` is 0, and a 0 in this file is a claim about a યુવક.
 * The string branch is not a coercion: PostgREST serialises `bigint` (`total_rows`, a
 * leaderboard total) as a JSON string, and an all-digits string is that exact number and
 * nothing else. The sign is kept — a MANUAL row may be negative, and that is the one place in
 * this project where a stored point value is allowed to be.
 */
const int = (v) => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^-?\d+$/.test(v)) return Number(v);
  return 0;
};

/** Same rule, for a figure that is allowed to be genuinely absent (a rank, a rule version). */
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
 * apply: `point_transactions.activity_date` is already the IST business day the server filed
 * the award under (§9). export.js's istRange() builds instants and is therefore the mistake in
 * the other direction — it is not used here.
 */
const day = (v) => (ISO_DAY.test(String(v || '')) ? String(v) : null);

/** '' and undefined mean "no filter"; a 0 the સંચાલક typed is a real bound. */
const optInt = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : null;
};

const text = (v) => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
};

/**
 * A uuid, or nothing — and this one is a guard rather than tidiness.
 *
 * `p_user` is a Postgres `uuid`. A half-pasted id reaches the server as `22P02` (invalid text
 * representation), which errors.js renders as "The details entered are not in the right
 * format" — a sentence about a filter the સંચાલક most likely arrived at through a link. So a
 * value that is not a uuid is dropped, and the page says the filter was ignored rather than
 * turning a typo into a failed read of the whole ledger.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (v) => UUID_RE.test(String(v || '').trim());

const uuid = (v) => (isUuid(v) ? String(v).trim().toLowerCase() : null);

/** A list of uuids for `admin_activity_counts`, deduplicated. Null when there is nobody. */
const uuidList = (ids) => {
  if (!Array.isArray(ids)) return null;
  const out = [...new Set(ids.map((id) => uuid(id)).filter(Boolean))];
  return out.length ? out : null;
};

// ------------------------------------------------------------------ §24 the ledger

/**
 * One ledger row, camelCase.
 *
 * Two names are inverted on purpose and it is not a mistake to fix. The business calls
 * `profiles.zone_id` the **city** (surat) and `profiles.sub_zone_id` the **zone** or મંડળ
 * (varachha), so 0032 returns them as `city_id` and `zone_id` and they are carried through
 * under those names — the same convention progressService.js documents at length. Label them
 * with `zoneNameEn()` and `subZoneNameEn()` respectively.
 *
 * `awardKind`, `ruleVersion` and `reason` are left null rather than defaulted, because on a
 * legacy row they were never recorded and '' would be indistinguishable from a value somebody
 * left blank. `isLegacy` is the server's own interpretation of that (see the note above
 * AWARD_KINDS).
 */
const fromLedgerRow = (r) => ({
  id: r.id,
  uid: r.user_id,
  name: r.name || '',
  smk: r.smk || '',
  // profiles.zone_id — 'surat'. Label with zoneNameEn().
  cityId: r.city_id || '',
  // profiles.sub_zone_id — 'varachha'. Label with subZoneNameEn().
  zoneId: r.zone_id || '',
  activityDate: r.activity_date || null,
  levelId: int(r.level_id),
  activityKey: r.activity_key || '',
  title: r.title || '',
  points: int(r.points),
  source: r.source || '',
  sourceId: intOrNull(r.source_id),
  attemptNumber: int(r.attempt_number),
  awardKind: r.award_kind ?? null,
  ruleVersion: intOrNull(r.rule_version),
  reason: r.reason ?? null,
  adminName: r.admin_name || '',
  isLegacy: r.is_legacy === true,
  createdAt: r.created_at || null,
});

/**
 * Every filter the ledger understands, in one shape, so the table and the file share it.
 *
 * One function and not two. The export's whole purpose is to be the same query the સંચાલક is
 * looking at; building its parameters anywhere else is how an export comes to hold a different
 * set from the screen that produced it, and nobody would ever notice.
 */
export function ledgerParams(f = {}, { page = 0, pageSize = PAGE_SIZE } = {}) {
  return {
    p_user: uuid(f.user),
    p_level: optInt(f.level),
    p_activity: text(f.activity),
    p_from: day(f.from),
    p_to: day(f.to),
    p_min: optInt(f.min),
    p_max: optInt(f.max),
    p_kind: text(f.kind),
    p_source: text(f.source),
    p_page: Math.max(0, Math.floor(Number(page) || 0)),
    p_page_size: Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(Number(pageSize) || PAGE_SIZE))),
  };
}

/**
 * One page of the ledger, and the size of the whole filtered set beside it.
 *
 * `total` comes off the first row (`count(*) over ()`, repeated on every row) rather than
 * from a second query, so the pager can never describe a different set from the rows under
 * it. An empty page answers `total: 0`, which is correct for page one and harmless past it:
 * `page === 0` is what the caller uses to decide whether "nothing matched" is a fact about
 * the filter or about having walked off the end of it.
 */
export async function pointTransactions(filters = {}, { page = 0, pageSize = PAGE_SIZE } = {}) {
  const size = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(Number(pageSize) || PAGE_SIZE)));
  const { data, error } = await supabase.rpc(
    'admin_point_transactions',
    ledgerParams(filters, { page, pageSize: size })
  );
  if (error) throw error;

  const raw = Array.isArray(data) ? data : [];
  const total = raw.length ? int(raw[0].total_rows) : 0;

  return {
    rows: raw.map(fromLedgerRow),
    total,
    page,
    pageSize: size,
    pageCount: size > 0 ? Math.ceil(total / size) : 0,
    hasNext: (page + 1) * size < total,
  };
}

/**
 * The whole filtered ledger, for the file (§11) — and the only place either export fetches.
 *
 * Both buttons on the page call this one function. That is the point of it: "Export CSV" and
 * "Export Excel" must be the same rows in two containers, and two fetches — however carefully
 * written — are two chances for a filter to differ between them. The formats diverge at the
 * last step, in the page, where one set of rows is handed to `exportCsv()` and to
 * `exportXlsx()` with the same `columns` array.
 *
 * Walks the same predicate the table is showing, 200 at a time, and stops at `cap`. It also
 * stops as soon as a short page arrives, so the ordinary case of a few hundred awards costs
 * two calls rather than twenty-five.
 */
export async function buildLedgerReport(filters = {}, { cap = EXPORT_CAP, chunk = EXPORT_CHUNK } = {}) {
  const size = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(Number(chunk) || EXPORT_CHUNK)));
  const rows = [];
  let total = 0;
  let page = 0;
  let truncated = false;

  for (;;) {
    const res = await pointTransactions(filters, { page, pageSize: size });
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

// ------------------------------------------------------------------ §22 the timeline

/**
 * One row of one યુવક's day, in the order it happened.
 *
 * `kind` is the *event* kind and is a different vocabulary from `awardKind`, which is the
 * *payment* kind. ATTEMPT and EXAM are things the યુવક did; MANUAL is something a સંચાલક did.
 * They are kept apart because a row can carry both — a passed test (EXAM) paid as a REPEAT —
 * and collapsing them would make the two unreadable.
 *
 * `passed` may be genuinely null: a manual adjustment did not pass or fail anything, and 0032
 * returns null rather than false so the panel can print nothing instead of a verdict.
 */
const fromTimelineRow = (r) => ({
  at: r.at || null,
  activityDate: r.activity_date || null,
  levelId: int(r.level_id),
  activityKey: r.activity_key || '',
  title: r.title || '',
  kind: r.kind || '',
  attemptNumber: int(r.attempt_number),
  completedItems: int(r.completed_items),
  totalItems: int(r.total_items),
  status: r.status || '',
  passed: r.passed === true ? true : r.passed === false ? false : null,
  points: int(r.points),
  awardKind: r.award_kind ?? null,
  reason: r.reason ?? null,
  actorName: r.actor_name || '',
});

/**
 * One યુવક's activity in the order it happened, one page at a time.
 *
 * There is no `id` on these rows: the three streams 0032 unions are numbered independently,
 * so a key has to be built from the instant plus what happened at it. `rowKey` below is that
 * key, made here rather than in the page so both the table and any future export agree on it.
 */
export async function userTimeline(userId, { from = '', to = '', page = 0, pageSize = PAGE_SIZE } = {}) {
  const id = uuid(userId);
  if (!id) return { rows: [], total: 0, page: 0, pageSize, pageCount: 0, hasNext: false };

  const size = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(Number(pageSize) || PAGE_SIZE)));
  const { data, error } = await supabase.rpc('admin_user_timeline', {
    p_user: id,
    p_from: day(from),
    p_to: day(to),
    p_page: Math.max(0, Math.floor(Number(page) || 0)),
    p_page_size: size,
  });
  if (error) throw error;

  const raw = Array.isArray(data) ? data : [];
  const total = raw.length ? int(raw[0].total_rows) : 0;

  return {
    rows: raw.map(fromTimelineRow),
    total,
    page,
    pageSize: size,
    pageCount: size > 0 ? Math.ceil(total / size) : 0,
    hasNext: (page + 1) * size < total,
  };
}

/** A stable key for a timeline row — see userTimeline() for why one has to be built. */
export const timelineKey = (r, i) =>
  `${r.at || ''}|${r.kind}|${r.levelId}|${r.activityKey}|${r.attemptNumber}|${i}`;

// ------------------------------------------------------------------ §23 one day

/**
 * One date across everybody: the totals and the per-person list, from one call.
 *
 * `admin_daily_activity()` returns a single jsonb object built by `jsonb_build_object`, so the
 * keys arrive camelCase and there is no snake_case mapping to do — only the coercion rule
 * above, applied so a missing key becomes 0 here rather than `undefined` on screen.
 *
 * `examFailed` is the server's key and it is carried, but nothing in this panel renders that
 * word: an attempt that ended with દર્શન still to revise is `REVISION_REQUIRED`, which is
 * "Revision remaining" everywhere in the panel and never "failed" (§10, §14). The number is
 * useful; the noun is not ours to use.
 *
 * `truncated` is the server's own answer to "were there more people than the cap", and it is
 * returned rather than swallowed so the page can say so. A day list that silently holds the
 * top 500 of 900 is a report claiming a completeness it does not have (§32).
 */
export async function dailyActivity({ date = '', city = '', zone = '', limit = DAILY_LIMIT } = {}) {
  const { data, error } = await supabase.rpc('admin_daily_activity', {
    p_date: day(date),
    p_city: text(city),
    p_zone: text(zone),
    p_limit: Math.min(DAILY_MAX, Math.max(1, Math.floor(Number(limit) || DAILY_LIMIT))),
  });
  if (error) throw error;

  const d = data || {};
  const t = d.totals || {};

  return {
    // The day the server actually reported on. Echoed back rather than assumed, because
    // `p_date` null means "today in IST" and only the server knows what that is right now.
    date: d.date || '',
    totals: {
      activeUsers: int(t.activeUsers),
      darshanSessions: int(t.darshanSessions),
      revisionSessions: int(t.revisionSessions),
      videoSessions: int(t.videoSessions),
      ticks: int(t.ticks),
      examAttempts: int(t.examAttempts),
      examPassed: int(t.examPassed),
      // Tests with darshan still to revise. See the note above about the word.
      examRevision: int(t.examFailed),
      points: int(t.points),
    },
    truncated: d.truncated === true,
    cap: int(d.cap),
    rows: (Array.isArray(d.rows) ? d.rows : []).map((r) => ({
      uid: r?.userId || '',
      name: r?.name || '',
      smk: r?.smk || '',
      cityId: r?.cityId || '',
      zoneId: r?.zoneId || '',
      darshanSessions: int(r?.darshanSessions),
      revisionSessions: int(r?.revisionSessions),
      videoSessions: int(r?.videoSessions),
      ticks: int(r?.ticks),
      examAttempts: int(r?.examAttempts),
      examPassed: int(r?.examPassed),
      examRevision: int(r?.examFailed),
      points: int(r?.points),
    })),
  };
}

// ------------------------------------------------------------------ §16 the board

/**
 * The board, as the સંચાલક needs to see it.
 *
 * The same `sum(point_transactions.points)` that `leaderboard()` (0023) computes — 0032 is
 * explicit that there must not be two scoring systems. What the admin function adds is what
 * the યુવક's own board must never carry: the user id, the city, the મંડળ, and a free date
 * window instead of the four fixed periods.
 *
 * Two figures need reading carefully and the page says so on screen:
 *
 *   `rank`         the whole project's place, computed **before** the city/zone filter. A
 *                  સંચાલક narrowing to સુરત sees each યુવક's standing in the project, not a
 *                  renumbering inside his filter, so the board agrees with the one the યુવક
 *                  himself sees.
 *   `participants` how many યુવકો earned anything in the window at all — the denominator of
 *                  that rank, and not the length of `rows`, which is the top N after filtering.
 */
export async function leaderboard({ from = '', to = '', city = '', zone = '', limit = BOARD_LIMIT } = {}) {
  const { data, error } = await supabase.rpc('admin_leaderboard', {
    p_from: day(from),
    p_to: day(to),
    p_city: text(city),
    p_zone: text(zone),
    p_limit: Math.min(BOARD_MAX, Math.max(1, Math.floor(Number(limit) || BOARD_LIMIT))),
  });
  if (error) throw error;

  const d = data || {};

  return {
    from: d.from || '',
    to: d.to || '',
    participants: int(d.participants),
    shown: int(d.shown),
    totalPoints: int(d.totalPoints),
    rows: (Array.isArray(d.rows) ? d.rows : []).map((r) => ({
      rank: intOrNull(r?.rank),
      uid: r?.userId || '',
      name: r?.name || '',
      smk: r?.smk || '',
      cityId: r?.cityId || '',
      zoneId: r?.zoneId || '',
      points: int(r?.points),
    })),
  };
}

// ------------------------------------------------------------------ §19 the counts

/**
 * What a named page of યુવકો actually did, for the ids that are already on screen.
 *
 * `p_users` is a page and not a filter: the board has already decided who is shown, and
 * re-deciding it here would be two implementations of one selection drifting apart on the day
 * somebody fixes only the first (§39).
 *
 * **Two of the ten columns ignore the date window, and this is the one thing a caller has to
 * know.** `points_total` and `rank` are computed in 0032 by a `board` CTE that carries no date
 * predicate at all, so they are lifetime figures whatever `from` and `to` say; the session,
 * tick and attempt columns do respect the window. They are mapped under names that state it —
 * `lifetimePoints` and `lifetimeRank` — so a page cannot print a lifetime total in a column
 * headed by a date range. LeaderboardPage uses only the windowed columns for exactly this
 * reason: its own `points` is the window's sum, and showing a second, larger total beside it
 * would read as one of the two being wrong.
 *
 * Returned as a Map keyed by user id, because that is how a caller uses it — one lookup per
 * row it is already rendering.
 */
export async function activityCounts(userIds, { from = '', to = '' } = {}) {
  const ids = uuidList(userIds);
  if (!ids) return new Map();

  const { data, error } = await supabase.rpc('admin_activity_counts', {
    p_users: ids,
    p_from: day(from),
    p_to: day(to),
  });
  if (error) throw error;

  const out = new Map();
  for (const r of Array.isArray(data) ? data : []) {
    if (!r?.user_id) continue;
    out.set(r.user_id, {
      darshanSessions: int(r.darshan_sessions),
      revisionSessions: int(r.revision_sessions),
      videoSessions: int(r.video_sessions),
      ticks: int(r.ticks),
      attemptsAll: int(r.attempts_all),
      examAttempts: int(r.exam_attempts),
      examPassed: int(r.exam_passed),
      // Lifetime, never the window. See the header of this function.
      lifetimePoints: int(r.points_total),
      // Null means "has earned nothing", which is not last place — 0032 says so beside the
      // column, and the panel prints a dash rather than inventing a standing.
      lifetimeRank: intOrNull(r.rank),
    });
  }
  return out;
}

// ------------------------------------------------------------------ the filter lists

/**
 * The લેવલ ૪ કસોટીઓ the ledger's activity filter may offer, from the PUBLISHED configuration.
 *
 * Not a hardcoded 4.1 … 4.4 (§11): a ૪.૫ published next month appears here the moment it
 * exists, and a retired code keeps its awards in the ledger without being offered again —
 * which is correct, because the ledger is keyed by code and an award for a code nobody can
 * sit is still an award that happened.
 */
export async function pointActivities() {
  const { data, error } = await supabase.rpc('admin_point_activities');
  if (error) throw error;

  return (Array.isArray(data) ? data : [])
    .map((a) => ({
      code: String(a?.code || ''),
      title: String(a?.title || ''),
      position: int(a?.position),
      active: a?.active === true,
    }))
    .filter((a) => a.code);
}

/**
 * The City and મંડળ lists, read from the rows that exist.
 *
 * Re-exported from the progress feature rather than reimplemented. `admin_progress_filter_options()`
 * already answers exactly this question with the counts beside each option, and both of these
 * pages filter the same `profiles.zone_id` / `profiles.sub_zone_id` the progress report does.
 * A second wrapper over one RPC is a second place for the two names to be inverted the wrong
 * way round (see fromLedgerRow above for why that is a real risk here).
 *
 * Re-exported under a name of this feature's own, so a page in points/ never has to reach
 * into progress/ and the coupling is one line in one file.
 */
export const filterOptions = progressFilterOptions;
