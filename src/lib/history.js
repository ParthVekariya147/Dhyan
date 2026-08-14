import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './supabase';
import { useAuth } from './auth';
import { isSupabaseConfigured, supabaseConfigFromEnv } from '../../shared/supabase/client.js';
/*
  Named imports as well as the `export *` below. The star re-export is what lets a page write
  `import { LEVEL_LABEL } from '../lib/history'`, but it puts nothing in this module's own
  scope — these four are used by the normalisers here and so have to be asked for directly.
*/
import {
  ACTIVITY_LABEL,
  groupByDate,
  isISODay,
  normalisePointSummary,
} from '../../shared/domain/history.js';

/**
 * મારી પ્રગતિ — the યુવક side of the history views (migration 0021).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * This module reads. It does not write, and it does not decide.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Everything here is a `select` over a view the server already narrowed to one યુવક by RLS.
 * There is no uid in any filter below and there must not be one: `activity_history` and
 * `point_ledger` answer `auth.uid()`'s rows and nobody else's, so a filter written here would
 * be a second, weaker copy of a rule the database already keeps — and the day the two
 * disagreed, the database's answer would be the right one anyway.
 *
 * Nothing is derived from a day's UI events. §20 forbids walking the screen to reach a
 * lifetime total, and `my_point_summary` — and now `my_point_totals()` — exist precisely so
 * the figures arrive already summed. The shapes come from shared/domain/history.js, which is
 * pure and has a test.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Two readings of the same facts, and why there are two
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `activity_history` answers **what did I do**: a day per (યુવક, level, activity), with the
 * day's payments summed onto it. `my_point_history()` answers **what was I paid, and for
 * what**: a row per transaction in `point_transactions`, which since the bonus engine is no
 * longer the same thing — one day can now hold a first-of-day award, a repeat, and a milestone
 * bonus against a single activity, and the day view collapses all three into one figure by
 * design. Neither view is derivable from the other on the phone, so both are asked for.
 *
 * **No localStorage.** src/lib/progress.js keeps a phone-side record because a tick has to
 * feel instant on Surat mobile data and must survive a dead connection; history has neither
 * property. It is a record of what the server already accepted, so a cached copy could only
 * ever be a second answer to a question that has one — §21's "do not create duplicate
 * progress systems", arriving from the reading side.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * §27 — the home page must not load history
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Both hooks below belong to the `/history` route **and to nothing else**. મુખપૃષ્ઠ is where a યુવક
 * lands after signing in on a weak connection (§14), and every request mounted there is paid
 * for by every visit to the app; a page of days and a points summary are two more round trips
 * for a screen that shows neither. Nothing on મુખપૃષ્ઠ, on a level page, or in the bottom bar
 * may call these — the scoreboard is somewhere a યુવક goes, not something he is handed.
 */

const configured = isSupabaseConfigured(supabaseConfigFromEnv(import.meta.env));

/**
 * The whole of shared/domain/history.js, re-exported.
 *
 * The convention src/lib/journey.js:12 and src/lib/level4.js follow, for the reason journey.js
 * gives: a screen imports `../lib/history` and never reaches across into shared/ itself. That
 * keeps one import per domain on every page and keeps the domain modules free to move.
 */
export * from '../../shared/domain/history.js';

/**
 * The two vocabularies a history row is made of, from the module that defines them.
 *
 * `LEVEL_LABEL` and `STATUS_LABEL` are already above; these are the identities underneath
 * them — the strings stored in `activity_key` and in `status`. A screen that wants to say
 * something about દર્શન specifically has them here rather than a second import of points.js,
 * which is where the point *values* live and is not a screen's business at all.
 */
export { ACTIVITY_KEY, ATTEMPT_STATUS } from '../../shared/domain/points.js';

// ---------------------------------------------------------------- errors

/**
 * Any failure reading history → one quiet Gujarati sentence.
 *
 * Three cases and two sentences, which is the right ratio: a dropped connection is worth
 * naming because retrying immediately is the useful thing to do, and everything else — a view
 * that is not migrated yet, a permission answer, a Postgres string nobody should ever read —
 * is the app's problem and is said as one. Nothing here is phrased as something the યુવક did
 * (§1 rule 4), and nothing here is red; a history page is *read*, so there is no action of his
 * that could have caused this and nothing for him to correct.
 */
function guHistoryError(e) {
  const text = [e?.code, e?.message, e?.details, e?.hint].filter(Boolean).join(' | ').toLowerCase();
  if (text.includes('failed to fetch') || text.includes('networkerror')) {
    return 'નેટ બરાબર નથી. ફરી પ્રયત્ન કરો.';
  }
  if (e?.status === 429) return 'ઘણી વાર પ્રયત્ન થયો. થોડી વાર પછી ફરી કરો.';
  return 'નોંધ હમણાં ખૂલી નથી. થોડી વાર પછી ફરી જુઓ.';
}

// ---------------------------------------------------------------- paging by day

/** The columns of `activity_history`, named rather than `*` — the view may grow, this need not. */
const ROW_COLUMNS =
  'activity_date, level_id, activity_key, title, attempt_count, completed_items, total_items, status, points';

/**
 * How many rows one probe of the date column asks for.
 *
 * A guess at nothing. It is only a batch size for the loop below — too small costs an extra
 * round trip, too large costs a few hundred bytes of dates — and it is deliberately **not** a
 * claim about how many activities a day holds. It cannot be: લેવલ ૪ is a list the સંચાલક
 * composes, so a day is worth as many rows as he has published કસોટીઓ plus three, and §62
 * forbids that number living anywhere but the collection it comes from. The loop keeps asking
 * until it has the days it needs, whatever a day turns out to weigh.
 */
const PROBE_ROWS = 120;

/** A stop, so a view answering strangely cannot spin the loop. See fetchDateWindow(). */
const MAX_PROBES = 20;

/**
 * The next `pageSize` days he has anything on, oldest-bound first.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why this asks twice, and why paging on rows would be wrong
 * ────────────────────────────────────────────────────────────────────────────
 *
 * **A day is the unit this page renders**, not a row: the screen is a heading with the day's
 * activities under it. `range(0, 13)` over the rows would therefore cut a day in half at every
 * page boundary the moment somebody had four activities on a Tuesday — the yuvak would read
 * ૧૩ ઓગસ્ટ with two rows under it, press વધુ જુઓ, and find ૧૩ ઓગસ્ટ again with the other
 * two. Worse, `groupByDate()` would build **two** day objects for one date and the second
 * would carry only part of the day's points, so the figures on screen would be wrong and not
 * merely oddly split.
 *
 * So the window is chosen on **distinct dates** and the rows are fetched to fill it. PostgREST
 * has no DISTINCT, so the first ask reads the date column alone — one small string per row,
 * ordered newest first, which means equal dates arrive adjacent and de-duplicating is a
 * comparison with the previous value. It walks until it holds `pageSize + 1` of them: the
 * extra one is `hasMore`, answered from data rather than guessed at.
 *
 * The second ask then reads whole rows for the closed date range. Because it is a range and
 * not a row limit, **a day inside the window arrives whole** however many activities it holds,
 * which is the property the whole arrangement exists for.
 *
 * @returns {{ dates: string[], hasMore: boolean }} `dates` newest first, at most pageSize.
 */
async function fetchDateWindow(before, pageSize) {
  const dates = [];
  let offset = 0;

  for (let probe = 0; probe < MAX_PROBES && dates.length <= pageSize; probe += 1) {
    let q = supabase
      .from('activity_history')
      .select('activity_date')
      .order('activity_date', { ascending: false })
      .range(offset, offset + PROBE_ROWS - 1);
    // Strictly older than the last day already on screen. `lt` and not `lte`, or the page
    // boundary day would be fetched, grouped and rendered a second time.
    if (before) q = q.lt('activity_date', before);

    const { data, error } = await q;
    if (error) throw error;

    const batch = Array.isArray(data) ? data : [];
    for (const r of batch) {
      const d = r?.activity_date;
      // Ordered desc, so the rows of one date are adjacent — including across batches, which
      // is why this compares against the accumulated list and not against the batch's own.
      if (d && dates[dates.length - 1] !== d) dates.push(d);
    }

    if (batch.length < PROBE_ROWS) break; // the end of his history, not a full batch
    offset += PROBE_ROWS;
  }

  return { dates: dates.slice(0, pageSize), hasMore: dates.length > pageSize };
}

const EMPTY = { loading: false, error: null, rows: [], hasMore: false };

/**
 * His days, newest first, a page at a time.
 *
 * @param {object} [opts]
 * @param {number} [opts.pageSize=14]  days per page, not rows. A fortnight is what a યુવક
 *   opening this screen is actually looking for, and it is short enough that the second page
 *   is a decision he makes rather than something that happens while he scrolls.
 * @returns {{ loading, error, days, hasMore, loadMore, retry }}
 *   `days` is `groupByDate()`'s output — `[{ date, rows, points }]`, days descending and each
 *   day's rows in ladder order. `error` is a Gujarati sentence or null.
 *
 * **The `/history` route only** — see the §27 note at the top of this file.
 */
export function useHistory({ pageSize = 14 } = {}) {
  const { user } = useAuth();
  const uid = user?.id ?? null;

  const [state, setState] = useState({ ...EMPTY, loading: configured });
  /*
    Which page is being fetched: `null` is the first (replace what is on screen), a date is
    "the days strictly older than this one" (append to it). `nonce` re-asks the same page,
    which is what retry is — a failed second page must not silently become a first one and
    throw away the days he can already read.
  */
  const [cursor, setCursor] = useState(null);
  const [nonce, setNonce] = useState(0);
  /** Whose days are in `state.rows`. See the top of the effect for what it prevents. */
  const ownerRef = useRef(null);

  const retry = useCallback(() => setNonce((n) => n + 1), []);

  const loadMore = useCallback(() => {
    if (state.loading || !state.hasMore || !state.rows.length) return;
    /*
      The oldest day on screen, read off the fetched rows rather than off `days` so the cursor
      cannot disagree with what was actually fetched. A `reduce` and not `rows[rows.length-1]`,
      because the ordering of the array is the server's promise and the cursor is the one place
      where trusting it would be silently wrong rather than merely untidy — a cursor one day too
      new repeats a day, one day too old loses one.
    */
    const oldest = state.rows.reduce(
      (min, r) => (r.activity_date < min ? r.activity_date : min),
      state.rows[0].activity_date
    );
    setCursor(oldest);
    setState((s) => ({ ...s, loading: true }));
  }, [state]);

  useEffect(() => {
    /*
      A different યુવક starts again from the first page.

      The cursor is state and would otherwise outlive the session it was built in: sign out on
      page three and back in, and the effect would ask for "the days older than 3 જુલાઈ" for
      somebody whose history it knows nothing about, then *append* that page to an empty list —
      a યુવક shown a hole where his last fortnight should be. Resetting it here rather than in a
      second effect keeps the two pieces of paging state changing in one place; the early return
      simply lets the run with `cursor === null` do the fetching.
    */
    if (ownerRef.current !== uid) {
      ownerRef.current = uid;
      if (cursor !== null) {
        setCursor(null);
        return;
      }
    }

    /*
      Inside the effect, because hooks cannot be skipped — the same shape useScenes(),
      useSettings() and level4.js use. Touching the lazy client on an unconfigured build would
      throw before anything could report it, and a signed-out visitor has no history to read.
    */
    if (!configured || !uid) {
      setState({ ...EMPTY });
      return;
    }

    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));

    (async () => {
      const { dates, hasMore } = await fetchDateWindow(cursor, pageSize);

      // He has nothing older. Not an error and not an empty page — simply the end of the
      // list, with whatever is already on screen left exactly as it is.
      if (!dates.length) return { rows: [], hasMore: false };

      const { data, error } = await supabase
        .from('activity_history')
        .select(ROW_COLUMNS)
        .gte('activity_date', dates[dates.length - 1])
        .lte('activity_date', dates[0])
        .order('activity_date', { ascending: false });
      if (error) throw error;

      return { rows: Array.isArray(data) ? data : [], hasMore };
    })()
      .then(({ rows, hasMore }) => {
        if (!alive) return;
        setState((s) => ({
          loading: false,
          error: null,
          // A first page replaces, a later one appends. `groupByDate()` sorts and groups
          // whatever it is given, so appending cannot disorder the list.
          rows: cursor ? [...s.rows, ...rows] : rows,
          hasMore,
        }));
      })
      .catch((e) => {
        if (!alive) return;
        // The days already fetched stay on screen. A failed second page is a page he did not
        // get, not a reason to take back the fortnight he was already reading (§1: never a
        // dead end), and `retry` re-asks for exactly the page that failed.
        setState((s) => ({ ...s, loading: false, error: guHistoryError(e) }));
      });

    return () => {
      alive = false;
    };
    /*
      `uid` is in here so signing in or out re-reads from the first page, `cursor` so વધુ જુઓ
      fetches the next one, and `nonce` so retry re-asks for the page that failed. Anything in
      flight when one of them changes is cancelled by the cleanup above rather than allowed to
      land on a list it no longer describes.
    */
  }, [uid, cursor, nonce, pageSize]);

  const days = useMemo(() => groupByDate(state.rows), [state.rows]);

  return { loading: state.loading, error: state.error, days, hasMore: state.hasMore, loadMore, retry };
}

// ---------------------------------------------------------------- the two numbers

const EMPTY_SUMMARY = { today: 0, total: 0 };

/**
 * `my_point_summary()` — આજે, and કુલ.
 *
 * One RPC returning both numbers already summed, which is the whole of §20's requirement: no
 * expression in this file adds a row to a total, so there is no way for the lifetime figure to
 * be derived from what happens to be on screen.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * There is no `error` in the return, and that is the point
 * ────────────────────────────────────────────────────────────────────────────
 *
 * **Every failure reads as zero.** A missing function, a view not migrated yet, a dropped
 * connection, a malformed payload — all of them end at `{ today: 0, total: 0 }` and none of
 * them is surfaced. §1 rule 4 and the brief's §20 both say the same thing from opposite ends:
 * the સાધના does not depend on the scoreboard. A યુવક who has just finished his દર્શન must
 * not be shown a failure notice about a number, and a points system that is switched off
 * (DEFAULT_POINTS: `enabled: false`) answers zero legitimately anyway — so an error here would
 * be indistinguishable from the ordinary configuration and is not worth a line of the screen.
 *
 * The caller decides what zero looks like: History.jsx draws no band at all when both are
 * zero, because a scoreboard reading ૦ / ૦ on a project that never turned points on is noise.
 *
 * @returns {{ today: number, total: number, loading: boolean }}
 *
 * **The `/history` route only** — see the §27 note at the top of this file.
 */
export function usePointSummary() {
  const { user } = useAuth();
  const uid = user?.id ?? null;

  const [summary, setSummary] = useState({ ...EMPTY_SUMMARY, loading: configured });

  useEffect(() => {
    // The guard inside the effect again, for the same reason as above.
    if (!configured || !uid) {
      setSummary({ ...EMPTY_SUMMARY, loading: false });
      return;
    }

    let alive = true;
    setSummary((s) => ({ ...s, loading: true }));

    supabase
      .rpc('my_point_summary')
      .then(({ data, error }) => {
        if (!alive) return;
        /*
          Both shapes a function returning one pair can arrive in: a jsonb object, and the
          one-row table PostgREST hands back as `[{ today, total }]`. Read defensively for the
          reason the payload block in src/lib/level4.js gives — whether the RPC is declared
          `returns jsonb` or `returns table(...)` is decided in SQL, and the two are spellings
          of the same fact rather than different facts.

          `normalisePointSummary(null)` is already `{ today: 0, total: 0 }`, so the error branch
          and the malformed-payload branch are the same line rather than two.
        */
        const payload = Array.isArray(data) ? data[0] : data;
        setSummary({ ...normalisePointSummary(error ? null : payload), loading: false });
      })
      .catch(() => {
        if (alive) setSummary({ ...EMPTY_SUMMARY, loading: false });
      });

    return () => {
      alive = false;
    };
  }, [uid]);

  return summary;
}

// ---------------------------------------------------------------- the ledger, one row per payment

/**
 * What a ledger row was paid for — `point_transactions.award_kind` (0031, extended by 0033).
 *
 * Local to this file rather than taken from shared/domain/points.js, and the departure from the
 * usual rule is deliberate. points.js holds the સંચાલક's vocabulary — the modes a rule may be
 * *set* to — while an award kind is the outcome the engine already wrote, which only a reader
 * ever sees. Keeping the strings here means the `/history` chunk does not pull the whole rules
 * module to render six words, and it means an engine that gains a seventh kind tomorrow does
 * not break this screen: an unrecognised string falls to the ordinary case in `awardNote()`.
 *
 * **`null` is a seventh member and it is not an error.** Every transaction written before the
 * engine existed carries no kind at all — 0031's header says so in as many words — and those
 * are ordinary earnings, the oldest ones a યુવક has. Nothing on this screen may call them
 * unknown, missing, or anything else; they render exactly as a DAY_FIRST does.
 *
 * These move to shared/domain/history.js the day the સંચાલક panel needs to print an award kind
 * too, for the reason GU_MONTHS gives in History.jsx: a vocabulary with one caller lives beside
 * its caller.
 */
export const AWARD_KIND = Object.freeze({
  DAY_FIRST: 'DAY_FIRST',
  REPEAT: 'REPEAT',
  TICK: 'TICK',
  REVISION: 'REVISION',
  MANUAL: 'MANUAL',
  BONUS: 'BONUS',
});

/**
 * The short note beside a payment, for the kinds where the kind says something the row does not.
 *
 * Four entries and not seven, because three of the kinds are better left silent:
 *
 *   DAY_FIRST  the ordinary case. Almost every row is one, and a word repeated down forty rows
 *              stops being information and becomes furniture.
 *   null       a legacy row, which is a DAY_FIRST that predates the column. Absent here for
 *              exactly the same reason and — this is the point — through exactly the same code
 *              path, so there is no branch that could ever word it as unknown.
 *   BONUS      says itself, and says it with its rule's name in a pill of its own. A second
 *              word in the meta line would be the same fact twice.
 *
 * `ફરી યાદ કર્યું` and not `પુનરાવર્તન`: shared/domain/history.js's STATUS_LABEL note explains
 * why that word is avoided in a યુવક-facing list — it is the name of a લેવલ ૪ *screen*, and a
 * યુવક reading his own ledger would meet it here meaning something else. Nothing in this map is
 * a judgement either; `નિષ્ફળ` and any count of what is missing are out by §1 rule 4.
 */
const AWARD_NOTE = Object.freeze({
  [AWARD_KIND.REPEAT]: 'ફરી કર્યું',
  [AWARD_KIND.TICK]: 'નવાં વર્ણન',
  [AWARD_KIND.REVISION]: 'ફરી યાદ કર્યું',
  [AWARD_KIND.MANUAL]: 'સંચાલક તરફથી',
});

/** The note for one transaction, or `''` when the kind is better left unsaid. See AWARD_NOTE. */
export function awardNote(tx) {
  return AWARD_NOTE[tx?.awardKind] ?? '';
}

/**
 * A signed whole number.
 *
 * Deliberately **not** shared/domain/history.js's `int()`, which floors anything below zero to
 * 0. That is right for a day's coverage figures, where a negative is meaningless, and wrong
 * here: a MANUAL correction is allowed to be negative (0031's `points >= 0 or award_kind =
 * 'MANUAL'` check exists to permit exactly that) and a bonus rule's value may be too. Clamping
 * one to 0 would not hide it — it would print a payment of nothing where the ledger records a
 * deduction, and the level totals above it would then fail to add up on screen.
 */
const signedInt = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
};

/**
 * One row of `my_point_history()`, in the shape the screen renders.
 *
 * Read across several spellings for each field for the reason the payload block in
 * src/lib/level4.js gives: whether the function is declared `returns table(...)` or `returns
 * jsonb`, and whether it names a column `title` or `activity_title`, is decided in SQL and is a
 * spelling of one fact rather than a different fact. Being liberal here costs four `??` and
 * removes a whole class of "the screen went blank when the migration landed".
 *
 * Unlike `normaliseHistoryRow()` this does **not** drop a row whose level is outside 1-4. A
 * manual adjustment and a project-wide bonus belong to no level at all, and dropping them would
 * quietly hide payments a યુવક actually received while the level totals beside them still
 * counted them — the two halves of the screen would disagree and neither would say why.
 */
export function normaliseTransaction(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const date = raw.activityDate ?? raw.activity_date ?? raw.date;
  if (!isISODay(date)) return null;

  const levelId = Number(raw.levelId ?? raw.level_id);
  const activityKey = String(raw.activityKey ?? raw.activity_key ?? '');

  /*
    A kind the engine has never heard of, and `null`, are the same thing to this screen: an
    ordinary earning. Normalising the unknown string to null here rather than in the renderer is
    what guarantees there is exactly one ordinary path and no branch left to word badly.
  */
  const kindRaw = String(raw.awardKind ?? raw.award_kind ?? '');
  const awardKind = Object.values(AWARD_KIND).includes(kindRaw) ? kindRaw : null;

  // Either spelling proves it. The boolean is the contract's, the kind is the column's, and a
  // row that carries only one of them is still a bonus.
  const isBonus = raw.isBonus === true || raw.is_bonus === true || awardKind === AWARD_KIND.BONUS;

  return {
    id: raw.id ?? raw.transaction_id ?? null,
    activityDate: date,
    levelId: Number.isInteger(levelId) ? levelId : 0,
    activityKey,
    // લેવલ ૪ carries the કસોટી's own name; the first three fall back to the fixed label, the
    // same fallback normaliseHistoryRow() applies so one activity cannot read two ways.
    title: String(raw.title ?? raw.activity_title ?? ACTIVITY_LABEL[activityKey] ?? ''),
    awardKind,
    isBonus,
    /** The milestone rule's own name, e.g. `૫ દર્શન પૂરાં`. Empty when the row is not a bonus. */
    bonusRule: String(
      raw.bonusRule ?? raw.bonus_rule_name ?? raw.bonus_rule ?? raw.rule_name ?? ''
    ),
    attemptNumber: signedInt(raw.attemptNumber ?? raw.attempt_number),
    points: signedInt(raw.points),
  };
}

/**
 * `my_point_totals()` — base, bonus and total per level, and the grand total.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * The grand total is asked for, not assembled
 * ────────────────────────────────────────────────────────────────────────────
 *
 * §20 again, and this is the sharpest instance of it: the moment a lifetime figure is built by
 * adding up what happens to be on screen, it can differ from the ledger — a dropped row, a
 * level the function did not return, a page boundary — and the number a યુવક trusts most is the
 * one that drifted. So an explicit grand total from the payload is used whenever there is one,
 * in any of the three spellings a function returning "levels plus a total" might use.
 *
 * The fallback sums the per-level totals **this same call returned**, and that is a different
 * act from deriving one: it is one read of one ledger, arithmetic over the function's own
 * answer, so it cannot disagree with the levels printed directly above it. It exists only so a
 * function declared `returns table(level_id, base, bonus, total)` with no total row still
 * renders, rather than the screen showing four levels and no sum.
 */
export function normalisePointTotals(payload) {
  /*
    0033 answers `returns jsonb`: `{ levels: [{ level, base, bonus, total }], base, bonus,
    total }`. The array branch is for a server that spells the same fact as a row set — see the
    payload note in src/lib/level4.js — and it is the only branch in which a level-less row can
    mean "the grand total", because in the object form the grand total is a sibling field and a
    null level could only be a payment.
  */
  const fromArray = Array.isArray(payload);
  const rowsIn = fromArray ? payload : Array.isArray(payload?.levels) ? payload.levels : [];

  const levels = [];
  /** A grand total spelled as a row of the table, rather than as a field. */
  let grandRow = null;

  for (const r of rowsIn) {
    if (!r || typeof r !== 'object') continue;

    const rawLevel = r.levelId ?? r.level_id ?? r.level;
    const base = signedInt(r.base ?? r.base_points ?? r.basePoints);
    const bonus = signedInt(r.bonus ?? r.bonus_points ?? r.bonusPoints);
    const total = signedInt(r.total ?? r.total_points ?? r.totalPoints ?? base + bonus);

    const missingLevel = rawLevel === null || rawLevel === undefined || rawLevel === '';

    if (fromArray && missingLevel) {
      grandRow = { base, bonus, total };
      continue;
    }

    /*
      A level *outside* 1-4 is not a grand total and is not dropped. 0033 emits `level: 0` for a
      સંચાલક's correction, which belongs to no ladder — keeping it as a row of its own is what
      makes the lines on screen add up to the sum beneath them. Dropping it would lose points a
      યુવક was really paid; folding it into the grand total would show a sum nothing explains.
    */
    const levelId = Number(rawLevel);
    levels.push({ levelId: Number.isInteger(levelId) ? levelId : 0, base, bonus, total });
  }

  /*
    લેવલ ૧ to ૪ in ladder order, then anything that belongs to no level. The ladder is the order
    he climbed it, the same reasoning groupByDate() gives for the rows inside a day; a manual
    adjustment leading the list would put the rarest line first.
  */
  const rank = (l) => (l.levelId >= 1 && l.levelId <= 4 ? l.levelId : 99);
  levels.sort((a, b) => rank(a) - rank(b) || a.levelId - b.levelId);

  const stated =
    payload && !Array.isArray(payload)
      ? payload.total ?? payload.grand_total ?? payload.grandTotal ?? payload.total_points
      : undefined;

  const total =
    stated !== undefined && stated !== null
      ? signedInt(stated)
      : grandRow
        ? grandRow.total
        : levels.reduce((sum, l) => sum + l.total, 0);

  return { levels, total };
}

// ---------------------------------------------------------------- the two new reads

/**
 * How many transactions one page of the ledger holds.
 *
 * Rows here, not days — and that is why this hook is twenty lines where `useHistory()` is
 * ninety. `useHistory()` pages on distinct dates because a day is the thing it renders and a
 * row limit would cut one in half; the ledger renders a flat statement with nothing to cut, so
 * a plain `range` is not a shortcut but the correct unit. Thirty is roughly a fortnight of a
 * busy યુવક's payments, which keeps the first page the same "one screenful and a bit" that
 * fourteen days is on the other tab.
 */
const LEDGER_PAGE = 30;

/**
 * The first page number `my_point_history(p_page, …)` answers to.
 *
 * **Zero**, and it is worth naming rather than inlining because the two conventions are
 * indistinguishable from the call site and wrong by exactly one page. 0033 computes its offset
 * as `p_page * p_page_size` and defaults the parameter to 0, so page 0 is his newest payments;
 * starting at 1 would silently hide them and make વધુ જુઓ show what should have been the first
 * screenful. The same convention `admin_point_transactions()` uses, for the same reason.
 */
const FIRST_PAGE = 0;

const EMPTY_LEDGER = { loading: false, error: null, rows: [], hasMore: false };

/**
 * His payments, newest first, a page at a time — `my_point_history()`.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.active=true]  fetch nothing until this is true. The ગુણ પ્રમાણે panel
 *   is behind a tab, and §27's principle — the scoreboard is somewhere a યુવક *goes* — does not
 *   stop at the route boundary: two round trips he did not ask for are two round trips he did
 *   not ask for whether they are on મુખપૃષ્ઠ or under a tab he never opens. Once true it stays
 *   true, so tapping back and forth between the two views re-fetches nothing.
 * @param {number} [opts.pageSize=30]
 * @returns {{ loading, error, rows, hasMore, loadMore, retry }} `rows` are normalised
 *   transactions, newest first. `error` is a Gujarati sentence or null.
 *
 * A missing function is not special-cased: PostgREST answers a 404 for an RPC that has not been
 * migrated yet, `guHistoryError()` already words that as `નોંધ હમણાં ખૂલી નથી`, and the day
 * view on the other tab is untouched and one tap away. That is the degradation the brief asks
 * for, and it costs no code because the error vocabulary already covered the case.
 *
 * **The `/history` route only** — see the §27 note at the top of this file.
 */
export function usePointLedger({ active = true, pageSize = LEDGER_PAGE } = {}) {
  const { user } = useAuth();
  const uid = user?.id ?? null;

  const [state, setState] = useState({ ...EMPTY_LEDGER });
  const [page, setPage] = useState(FIRST_PAGE);
  const [nonce, setNonce] = useState(0);
  /*
    Latched. `active` going false again is a યુવક looking at the other tab, not a reason to
    forget what was fetched — and re-running the effect on every tap would refetch the page he
    is already reading. Nothing unlatches it; a different યુવક is handled by `uid` below, which
    resets the state that matters.
  */
  const [armed, setArmed] = useState(active);
  useEffect(() => {
    if (active) setArmed(true);
  }, [active]);

  const retry = useCallback(() => setNonce((n) => n + 1), []);

  const loadMore = useCallback(() => {
    if (state.loading || !state.hasMore) return;
    setPage((p) => p + 1);
    setState((s) => ({ ...s, loading: true }));
  }, [state.loading, state.hasMore]);

  useEffect(() => {
    // The guard inside the effect, for the reason useHistory()'s copy of it gives.
    if (!configured || !uid) {
      setState({ ...EMPTY_LEDGER });
      return;
    }
    // Not asked for yet. Deliberately leaves the state alone rather than clearing it.
    if (!armed) return;

    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));

    /*
      Both dates null: the whole ledger, newest first. The screen has no date filter to offer —
      it is a record he scrolls back through — and it cannot know his first day without asking,
      so an unbounded window is the honest argument rather than a guessed one.

      No uid in the call and there must not be one: the function is keyed on `auth.uid()`, which
      is the note at the top of this file.
    */
    supabase
      .rpc('my_point_history', {
        p_from: null,
        p_to: null,
        p_page: page,
        p_page_size: pageSize,
      })
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) throw error;

        const batch = Array.isArray(data) ? data : [];
        const rows = batch.map(normaliseTransaction).filter(Boolean);

        /*
          `total_rows` is a `count(*) over ()` the function puts on every row, so `hasMore` is
          answered from the ledger rather than guessed at: it is exactly how many payments the
          window holds, and the arithmetic below cannot be off by the one page that a
          "the batch was full, so there is probably another" heuristic is always wrong about —
          the case where the last page is exactly `pageSize` long and વધુ જુઓ then fetches
          nothing and disappears, having promised something.

          The fallback is that heuristic, for a server that answers without the column. Read off
          `batch` and not off the filtered `rows`, or one malformed transaction would end the
          list early and hide every payment older than it.
        */
        const totalRows = Number(batch[0]?.total_rows ?? batch[0]?.totalRows);
        const seen = (page - FIRST_PAGE + 1) * pageSize;

        setState((s) => ({
          loading: false,
          error: null,
          // A first page replaces, a later one appends — the same rule useHistory() follows so
          // retry after a failed page two cannot silently become a page one.
          rows: page === FIRST_PAGE ? rows : [...s.rows, ...rows],
          hasMore: Number.isFinite(totalRows) ? seen < totalRows : batch.length >= pageSize,
        }));
      })
      .catch((e) => {
        if (!alive) return;
        // Everything already fetched stays on screen; §1 says never a dead end.
        setState((s) => ({ ...s, loading: false, error: guHistoryError(e) }));
      });

    return () => {
      alive = false;
    };
  }, [uid, armed, page, nonce, pageSize]);

  /*
    A different યુવક starts at page one. Separate from the fetch effect, and after it, because
    the ledger's cursor is a single number rather than useHistory()'s date-plus-append pair —
    there is nothing here to coordinate, only a counter to put back.
  */
  const ownerRef = useRef(null);
  useEffect(() => {
    if (ownerRef.current !== uid) {
      ownerRef.current = uid;
      setPage(FIRST_PAGE);
    }
  }, [uid]);

  return { ...state, loadMore, retry };
}

const EMPTY_TOTALS = { levels: [], total: 0 };

/**
 * Base, bonus and total per level, and the grand total — `my_point_totals()`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * This one reports its errors, and usePointSummary() does not
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The difference is not an inconsistency, it is the same rule read in two situations.
 * `usePointSummary()` feeds a band at the top of a page a યુવક opened to read his days; a
 * project with points switched off answers zero there legitimately, so a failure and the
 * ordinary configuration are indistinguishable and neither is worth a line of the screen.
 *
 * Here he has tapped ગુણ પ્રમાણે on purpose. An unreported failure would draw an empty panel,
 * and an empty panel under that heading says *you have earned nothing* — a misleading zero,
 * which is the same failure the `+૦` rule exists to prevent, arriving by silence instead of by
 * a digit. So this one says, quietly, that the app could not open it, and offers to ask again.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.active=true]  as usePointLedger(): nothing is fetched until asked for.
 * @returns {{ loading, error, levels, total, retry }} `levels` is
 *   `[{ levelId, base, bonus, total }]` in ladder order. Nothing here is read from a stored
 *   total — the function computes from the ledger, which is the only figure that cannot drift.
 *
 * **The `/history` route only** — see the §27 note at the top of this file.
 */
export function usePointTotals({ active = true } = {}) {
  const { user } = useAuth();
  const uid = user?.id ?? null;

  const [state, setState] = useState({ ...EMPTY_TOTALS, loading: false, error: null });
  const [nonce, setNonce] = useState(0);
  const [armed, setArmed] = useState(active);
  useEffect(() => {
    if (active) setArmed(true);
  }, [active]);

  const retry = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!configured || !uid) {
      setState({ ...EMPTY_TOTALS, loading: false, error: null });
      return;
    }
    if (!armed) return;

    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));

    supabase
      .rpc('my_point_totals')
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) throw error;
        // Both shapes one function returning "levels plus a total" may arrive in — a jsonb
        // object, and PostgREST's row array. normalisePointTotals() takes either.
        setState({ ...normalisePointTotals(data), loading: false, error: null });
      })
      .catch((e) => {
        if (!alive) return;
        setState({ ...EMPTY_TOTALS, loading: false, error: guHistoryError(e) });
      });

    return () => {
      alive = false;
    };
  }, [uid, armed, nonce]);

  return { ...state, retry };
}
