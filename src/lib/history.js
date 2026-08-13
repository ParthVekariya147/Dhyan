import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './supabase';
import { useAuth } from './auth';
import { isSupabaseConfigured, supabaseConfigFromEnv } from '../../shared/supabase/client.js';
import { groupByDate, normalisePointSummary } from '../../shared/domain/history.js';

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
 * lifetime total, and `my_point_summary` exists precisely so the two numbers arrive already
 * summed. The shapes come from shared/domain/history.js, which is pure and has a test.
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
