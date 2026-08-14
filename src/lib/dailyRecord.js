import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import { useAuth } from './auth';
import { isSupabaseConfigured, supabaseConfigFromEnv } from '../../shared/supabase/client.js';
import { LEVEL_LABEL, isISODay } from '../../shared/domain/history.js';

/**
 * આજની પ્રગતિ — the daily record, its per-level counts, and the 24-hour edit window
 * (migration 0034_daily_records.sql).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * This module carries the RPCs and the shapes. It computes no points.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Every figure on the screen behind this file — a level's points, the bonus, the total — is
 * computed by the server and read here, never derived. docs/DAILY_RECORD_ARCHITECTURE.md §3
 * states the property this protects: *"There is no second scoring computation anywhere, and
 * that property is the one this work must not break."* A multiplication in this file would be
 * that second computation, and it would be the one a યુવક is looking at — so the screen shows
 * what the last save returned and says plainly that a changed count is scored when it is saved,
 * rather than guessing at the number a moment early.
 *
 * The same rule from the other side: **the window is the server's**. `remaining_seconds` is
 * asked for and counted down from; nothing here decides whether an edit is allowed. The
 * countdown reaching zero closes the form because that is the honest thing to show, but a save
 * refused at the boundary is accepted as the answer and the record is re-read — see `save()`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Three functions, none of which takes a user
 * ────────────────────────────────────────────────────────────────────────────
 *
 *   daily_record_get(p_date)                      the day, its counts, its window
 *   daily_record_save(p_date, p_counts, p_token)  validates the window, clamps, scores, returns
 *   daily_record_status()                         which days are still open
 *
 * All three derive the યુવક from `auth.uid()`, exactly as `my_point_history()` does, so there
 * is no uid in any call below and there must not be one — a filter written here would be a
 * second, weaker copy of a rule the database already keeps.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * 0034 may not be migrated yet, and that is a state this module renders
 * ────────────────────────────────────────────────────────────────────────────
 *
 * PostgREST answers 404/PGRST202 for a function that does not exist. `guDailyError()` words
 * that as `આ નોંધ હમણાં ખૂલી નથી` — the same sentence src/lib/history.js uses for an
 * unmigrated 0033 — so the screen shows one quiet line rather than a blank page, and every
 * other route is untouched.
 *
 * **No localStorage.** A count is a claim the server clamps, scores and time-bounds; a copy on
 * the handset could only ever be a second answer to a question that has one, and would be
 * restorable into a window that has since closed.
 */

const configured = isSupabaseConfigured(supabaseConfigFromEnv(import.meta.env));

/**
 * What a level is called, for a payload that does not name it.
 *
 * The server is allowed to send a label — the daily record is per level and 0034 may well
 * carry the સંચાલક's own wording — and when it does, that wins. This is the fallback, and it
 * is the same map `/history` prints, so one level cannot read two ways in one app.
 */
export const levelLabel = (levelId, given) =>
  (typeof given === 'string' && given.trim()) || LEVEL_LABEL[levelId] || `લેવલ ${levelId}`;

// ---------------------------------------------------------------- the window, said as a clock

/**
 * How many whole seconds are left before `deadlineAt` (epoch ms), never below zero.
 *
 * `Math.ceil`, so the final second is displayed as `૦૦:૦૦:૦૧` and the switch to locked happens
 * when the time is actually gone rather than a second early.
 */
export function secondsLeft(deadlineAt, now = Date.now()) {
  if (!Number.isFinite(deadlineAt)) return 0;
  return Math.max(0, Math.ceil((deadlineAt - now) / 1000));
}

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * `31335` → `૦૮:૪૨:૧૫`. The requirement's own format, in the app's own digits.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why zero and only zero returns an empty string
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `totalMinutes()` in shared/domain/viewing-speed.js returns 0 and leaves the caller to render
 * nothing, because *"a confident zero is worse than a missing line"*. The same rule lands here
 * in two different places and it is worth being precise about which is which:
 *
 *   * `૦૦:૧૨:૩૪` is NOT a confident zero. It is a clock, and the hours column of a clock
 *     reading 00 is information — it says the window closes within the hour. Trimming it to
 *     `૧૨:૩૪` would make the same six glyphs mean hours-and-minutes on one screen and
 *     minutes-and-seconds on another, which is the drift the fixed width exists to prevent.
 *   * `૦૦:૦૦:૦૦` IS one. There is no time left, so there is no line to print; the caller shows
 *     the locked state instead. This function returns `''` and the caller renders nothing.
 *
 * Written here rather than in shared/domain/, which this task does not own — and, as
 * History.jsx says of GU_MONTHS, a helper with one caller belongs beside its caller. It moves
 * down there the day the સંચાલક panel needs to print a window too.
 */
export function formatCountdown(seconds, gu) {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  if (total <= 0) return '';

  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return gu(`${pad2(h)}:${pad2(m)}:${pad2(s)}`);
}

// ---------------------------------------------------------------- errors

/**
 * Any failure against 0034 → one quiet Gujarati sentence.
 *
 * Modelled on `guHistoryError()` in src/lib/history.js and extended by one case, which is the
 * case this feature adds: the window has closed. That one is not an app problem and not a
 * network problem — it is the ordinary end of a day's editing, and it is worded as such rather
 * than as a refusal. Nothing here says `નિષ્ફળ`, nothing here is red, and nothing here is
 * phrased as something the યુવક did wrong (§1 rule 4).
 *
 * The default is the same sentence a missing function gets. That is deliberate: an unmigrated
 * 0034, a permission answer and a Postgres string nobody should read are all the app's problem
 * and are all said as one.
 */
export function guDailyError(e) {
  if (isWindowClosed(e)) return 'આ દિવસનો સમય પૂરો થયો છે. હવે એ નોંધ વાંચી શકાય છે.';

  const text = [e?.code, e?.message, e?.details, e?.hint].filter(Boolean).join(' | ').toLowerCase();
  if (text.includes('failed to fetch') || text.includes('networkerror')) {
    return 'નેટ બરાબર નથી. ફરી પ્રયત્ન કરો.';
  }
  if (e?.status === 429) return 'ઘણી વાર પ્રયત્ન થયો. થોડી વાર પછી ફરી કરો.';
  return 'આ નોંધ હમણાં ખૂલી નથી. થોડી વાર પછી ફરી જુઓ.';
}

/**
 * Did the server refuse because the 24-hour window has closed?
 *
 * Read liberally, and on purpose. 0034 is being written in parallel and the exact wording of
 * its `raise exception` is not this file's to fix; what is certain is that a refusal of this
 * kind carries one of these words, in the message, the detail or a hint. Being generous here
 * costs a few `includes()` and buys the one behaviour that matters: a save the server refused
 * at the boundary is shown as a closed window and the record is re-read, rather than as a
 * mysterious app failure the યુવક is invited to retry forever.
 *
 * A false positive is cheap — the record is re-read either way, so the screen still ends up
 * showing whatever the server actually thinks. A false negative is the expensive one, and it is
 * why the list is long rather than short.
 */
export function isWindowClosed(e) {
  const text = [e?.code, e?.message, e?.details, e?.hint].filter(Boolean).join(' | ').toLowerCase();
  if (!text) return false;
  return (
    text.includes('edit_until') ||
    text.includes('edit window') ||
    text.includes('window closed') ||
    text.includes('window has closed') ||
    text.includes('not editable') ||
    text.includes('no longer editable') ||
    text.includes('locked') ||
    text.includes('expired')
  );
}

// ---------------------------------------------------------------- the shapes

const int = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
};

/** A count: a whole number, never negative. A negative count is not a smaller count. */
const count = (v, fallback = 0) => Math.max(0, int(v, fallback));

/**
 * A per-level daily maximum, or `null` when the server did not state one.
 *
 * **`null` and never a number this file chose.** §7 of the architecture is explicit that the
 * bound is *"admin-configurable"* and that *"nothing is hardcoded"* — so a level whose maximum
 * has not arrived gets no dropdown at all rather than a range invented here. The screen renders
 * that level's counts as text and says the limit is not set yet, which is true, checkable, and
 * cannot silently cap a યુવક at a number nobody chose.
 */
const maxOrNull = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** The status strings that mean the day can no longer be edited, however 0034 spells it. */
const CLOSED_STATUS = new Set(['locked', 'closed', 'expired', 'final', 'readonly', 'read_only']);

/**
 * One level of the day, in the shape the screen renders.
 *
 * `reported` falls back to `recorded` and that fallback is the requirement: *"the counts are
 * prefilled from what the app actually recorded"*. A day with no saved record yet therefore
 * arrives with the dropdowns already showing what the app observed, and the યુવક's only work is
 * to raise a figure where he did something away from the phone.
 */
function normaliseLevel(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const levelId = Number(raw.levelId ?? raw.level_id ?? raw.level);
  if (!Number.isInteger(levelId)) return null;

  const recorded = count(raw.recordedCount ?? raw.recorded_count ?? raw.recorded);
  const reported = count(
    raw.reportedCount ?? raw.reported_count ?? raw.reported ?? raw.count,
    recorded
  );

  return {
    levelId,
    /**
     * The activity this count belongs to, exactly as the server named it.
     *
     * Carried rather than derived, and that is the whole point of it. A level is not an
     * activity: લેવલ ૪ is several કસોટીઓ, each with its own code, and deriving `'video'` /
     * `'darshan'` / `'revision'` from a level number here would put 0021's vocabulary into a
     * file that has no business knowing it — and would have nothing at all to say about ૪.૧.
     * `daily_record_save` takes an array of `{level, activity, count}` for this reason, so the
     * key has to survive the round trip untouched.
     */
    activity: typeof (raw.activity ?? raw.activity_key ?? raw.activityKey) === 'string'
      ? (raw.activity ?? raw.activity_key ?? raw.activityKey)
      : '',
    label: levelLabel(levelId, raw.label ?? raw.title ?? raw.name),
    /** What the app saw. Never editable, and shown beside his own figure rather than instead. */
    recorded,
    /** His figure — what the dropdown holds and what is sent back. */
    reported,
    /** The dropdown's ceiling, from the સંચાલક's setting. `null` when it has not arrived. */
    max: maxOrNull(raw.maxCount ?? raw.max_count ?? raw.dailyMax ?? raw.daily_max ?? raw.max),
    /** What the server last computed for this level. Read, never derived. */
    points: int(raw.points ?? raw.pointsEarned ?? raw.points_earned),
  };
}

/**
 * `daily_record_get()`'s answer, in the shape the screen renders — or null.
 *
 * Read across several spellings for each field for the reason the payload block in
 * src/lib/level4.js gives: whether 0034 is declared `returns jsonb` or `returns table(...)`,
 * and whether it names a column `edit_until` or `editUntil`, is decided in SQL and is a
 * spelling of one fact rather than a different fact.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * The deadline is anchored to `remaining_seconds`, not to `edit_until`
 * ────────────────────────────────────────────────────────────────────────────
 *
 * A phone's clock is not the server's. `edit_until` is an instant, and turning it into "how
 * much longer" on a handset whose clock is four minutes fast shows a countdown four minutes
 * short — and locks the form four minutes early, which is four minutes of a યુવક's day taken
 * from him by a clock he never set. `remaining_seconds` is a *duration*, so anchoring it to
 * this device's own `Date.now()` at the moment the answer arrived cancels the skew entirely:
 * only the elapsed time on this device is measured, and that is the one thing it does measure
 * correctly.
 *
 * `edit_until` is still read, as the fallback for a server that sends only the instant. It is
 * the weaker of the two and is used only when the stronger is absent.
 */
export function normaliseDailyRecord(raw, receivedAt = Date.now()) {
  const payload = Array.isArray(raw) ? raw[0] : raw;
  if (!payload || typeof payload !== 'object') return null;

  const rowsIn =
    (Array.isArray(payload.levels) && payload.levels) ||
    (Array.isArray(payload.counts) && payload.counts) ||
    (Array.isArray(payload.rows) && payload.rows) ||
    [];

  // Ladder order, always — the order he climbed it, which is the order groupByDate() gives a
  // day's rows in /history and the order the મુખપૃષ્ઠ lists the levels in.
  const levels = rowsIn.map(normaliseLevel).filter(Boolean).sort((a, b) => a.levelId - b.levelId);

  const statusRaw = String(payload.status ?? payload.window_status ?? '').toLowerCase();

  const explicitEditable =
    typeof payload.editable === 'boolean'
      ? payload.editable
      : typeof payload.is_editable === 'boolean'
        ? payload.is_editable
        : typeof payload.canEdit === 'boolean'
          ? payload.canEdit
          : typeof payload.can_edit === 'boolean'
            ? payload.can_edit
            : null;

  const remainingRaw = payload.remainingSeconds ?? payload.remaining_seconds;
  const remainingSeconds = remainingRaw === null || remainingRaw === undefined
    ? null
    : Math.max(0, int(remainingRaw));

  const editUntilRaw = payload.editUntil ?? payload.edit_until;
  const editUntilMs = editUntilRaw ? Date.parse(String(editUntilRaw)) : NaN;

  const deadlineAt = remainingSeconds !== null
    ? receivedAt + remainingSeconds * 1000
    : Number.isFinite(editUntilMs)
      ? editUntilMs
      : null;

  /*
    Editable, decided in the order the answers are trustworthy: an explicit boolean from the
    server, then its status word, and only then the clock. A day that has never been saved
    carries no window at all — no `edit_until`, no `remaining_seconds` — and is editable
    because the twenty-four hours begin at the first save, not at midnight.
  */
  const editable = explicitEditable !== null
    ? explicitEditable
    : statusRaw
      ? !CLOSED_STATUS.has(statusRaw)
      : deadlineAt === null || secondsLeft(deadlineAt, receivedAt) > 0;

  const bonus = int(payload.bonus ?? payload.bonus_points ?? payload.bonusPoints);
  const statedTotal = payload.total ?? payload.total_points ?? payload.totalPoints;

  return {
    date: isISODay(payload.date ?? payload.activity_date ?? payload.record_date)
      ? String(payload.date ?? payload.activity_date ?? payload.record_date)
      : null,
    levels,
    bonus,
    /*
      The total is the server's whenever the server states one. The fallback adds up the levels
      and the bonus **this same call returned**, which is a different act from deriving one —
      one read of one record, arithmetic over its own answer, so it cannot disagree with the
      figures printed directly above it. It exists only so a function that returns the parts
      without the sum still renders a total rather than nothing. (normalisePointTotals() in
      src/lib/history.js makes the same distinction, for the same reason.)
    */
    total: statedTotal === null || statedTotal === undefined
      ? levels.reduce((sum, l) => sum + l.points, 0) + bonus
      : int(statedTotal),
    status: statusRaw || (editable ? 'open' : 'locked'),
    editable,
    remainingSeconds,
    deadlineAt,
    /** Has anything been saved for this day yet? Decides which sentence the window line uses. */
    saved: Boolean(
      payload.id ?? payload.record_id ?? payload.savedAt ?? payload.saved_at ??
      payload.createdAt ?? payload.created_at ?? payload.firstSavedAt ?? payload.first_saved_at ??
      remainingSeconds !== null
    ),
  };
}

/**
 * A day with no record and no server answer to shape — the empty form.
 *
 * Not a special case in the renderer, which is the point: `daily_record_get()` for a day
 * nothing has happened on may legitimately answer null, and the screen must then show the same
 * four dropdowns at zero rather than an empty panel that reads as a failure.
 */
export const emptyRecord = (date) => ({
  date,
  levels: [],
  bonus: 0,
  total: 0,
  status: 'open',
  editable: true,
  remainingSeconds: null,
  deadlineAt: null,
  saved: false,
});

// ---------------------------------------------------------------- what is sent back

/**
 * The counts, as the jsonb array `daily_record_save(p_counts …)` takes.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * An array, and it was a map until 0034 landed
 * ────────────────────────────────────────────────────────────────────────────
 *
 * This was written before the migration existed and sent `{"1": 0, "2": 3, …}` — level id to
 * count. That shape is wrong for one reason worth keeping written down: **a level is not an
 * activity.** લેવલ ૪ is several કસોટીઓ, each with its own code, so a map keyed by level cannot
 * say which one a count belongs to, and the only way to make it work would be to derive the
 * activity key from the level number — putting `'video'`/`'darshan'`/`'revision'` into this
 * file, which is exactly the hardcoding 0021 owns and this feature is required not to repeat.
 *
 * 0034 refuses a non-array with a message naming the shape rather than reading it as an empty
 * day, which is why this was caught as a diagnosable error instead of a youth's Saturday
 * quietly saving as zero.
 *
 * `sceneIds` is deliberately NOT sent. The server treats ids, when present, as *being* the
 * count — they are more specific than a number beside them. This screen edits a number in a
 * dropdown, so the number is the honest thing to send; the tick ids belong to લેવલ ૩'s own
 * નોંધાવો, which already sends them and already deduplicates them.
 *
 * Values are numbers and keys are the server's own strings — `gu()` never comes near this
 * function. Gujarati digits are for display only, never for a value sent to, compared in or
 * parsed from the database, and a payload is the sharpest instance of that rule.
 */
export function countsPayload(levels) {
  return levels.map((l) => ({
    level: l.levelId,
    activity: l.activity || '',
    count: count(l.reported),
  }));
}

/**
 * A fresh idempotency key for one save.
 *
 * `daily_record_save` takes a `p_client_token uuid` because a save is retryable: a યુવક on
 * Surat mobile data taps ડેટા સેવ કરો, the request lands, the answer does not, and he taps
 * again. Both requests carry the same token, so the second is recognised as the first rather
 * than reconciled into the ledger twice — §6 of the architecture, where a delta row is written
 * per edit, is exactly the mechanism that would double.
 *
 * The token is therefore the identity of an *intention*, not of a tap: it survives a retry of
 * the same counts and is replaced the moment the counts change. The page owns that lifecycle,
 * because only the page knows when a dropdown moved.
 *
 * `crypto.randomUUID()` is on every browser this app supports; the fallback is for an insecure
 * origin (plain http on a LAN, where `crypto.randomUUID` is undefined), and it produces a
 * correctly shaped v4 string so the `uuid` parameter still accepts it.
 */
export function newClientToken() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const hex = (n) =>
    Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${'89ab'[Math.floor(Math.random() * 4)]}${hex(3)}-${hex(12)}`;
}

// ---------------------------------------------------------------- the countdown

/**
 * Seconds remaining before `deadlineAt`, ticking, and correct after a backgrounded tab.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Recomputed, never decremented — the pattern ForgotPassword.jsx:105-118 states
 * ────────────────────────────────────────────────────────────────────────────
 *
 * A backgrounded tab has its timers throttled to about once a minute and, on iOS, paused
 * outright. A counter that decrements resumes wherever it stopped counting: a યુવક who
 * switches to WhatsApp for ten minutes comes back to a window that claims ten more minutes than
 * it has, and — far worse — a form that is still open on a record the server will refuse.
 * Every tick here recomputes `deadlineAt - Date.now()`, so the number is right the instant the
 * tab is looked at again however long the timer was asleep.
 *
 * Two further pieces, both of which the plain interval does not give:
 *
 *   * **`visibilitychange` resyncs immediately.** Throttled to a minute, the first correct
 *     frame after returning could otherwise be up to a minute late — which is a minute of a
 *     visibly wrong clock at exactly the moment he is looking at it. src/lib/daily.js makes the
 *     same argument for the IST-midnight timer: "how much longer from now" is re-askable at any
 *     moment and is what the visibility handler re-asks on waking.
 *   * **The interval exists only while the countdown is running.** It is torn down at zero and
 *     on unmount, so a locked day and a page he has left cost nothing.
 */
export function useCountdown(deadlineAt) {
  const [left, setLeft] = useState(() => secondsLeft(deadlineAt));

  // A new deadline — a save that restarted the window, or another day chosen — is read at once
  // rather than at the next tick, so the clock never shows the previous day's figure.
  useEffect(() => {
    setLeft(secondsLeft(deadlineAt));
  }, [deadlineAt]);

  useEffect(() => {
    if (!Number.isFinite(deadlineAt) || left <= 0) return undefined;

    const tick = () => setLeft(secondsLeft(deadlineAt));
    const id = setInterval(tick, 1000);
    document.addEventListener('visibilitychange', tick);

    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
    // `left` is a dependency for the reason ForgotPassword.jsx gives: it is what lets the
    // interval end itself at zero instead of spinning for as long as the page is open.
  }, [deadlineAt, left]);

  return left;
}

// ---------------------------------------------------------------- the day

const EMPTY = { loading: false, error: null, record: null };

/**
 * One day's record, and the way to save it — `daily_record_get()` / `daily_record_save()`.
 *
 * @param {string} date  an IST calendar day, `YYYY-MM-DD`, from src/lib/daily.js. Never a
 *   `Date`: `progress.date` and `activity_date` are `date` columns and take the string
 *   verbatim, and constructing a `Date` from one is how a day west of Greenwich becomes the day
 *   before (History.jsx's `dayHeading()` note).
 * @returns {{ loading, error, record, retry, save, saving, saveError, savedAt }}
 *   `record` is `normaliseDailyRecord()`'s shape or null; `error` and `saveError` are Gujarati
 *   sentences or null; `save(counts, token)` resolves to `{ ok, closed }`.
 *
 * **The `/daily` route only.** §27's rule — the મુખપૃષ્ઠ must not load history — covers this
 * for the same reason: a day's record is two more round trips for a screen that shows neither,
 * and nothing on મુખપૃષ્ઠ, on a level page or in the bottom bar may call these.
 */
export function useDailyRecord(date) {
  const { user } = useAuth();
  const uid = user?.id ?? null;

  const [state, setState] = useState({ ...EMPTY, loading: configured });
  const [nonce, setNonce] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  /** The instant of the last accepted save, so the page can show its sentence and clear it. */
  const [savedAt, setSavedAt] = useState(0);

  const retry = useCallback(() => setNonce((n) => n + 1), []);

  /*
    The duplicate-tap guard, a ref and not `saving`, for the reason ForgotPassword.jsx:103
    states: `saving` is state, so two taps inside one React batch both read it as false and both
    send. On a phone that is not theoretical — a tap the browser also delivers as a click, or an
    impatient double tap, arrives well inside a single commit. `disabled={saving}` on the button
    is what the યુવક can see; this is what makes it true. The token would make a double send
    harmless anyway, and this makes it not happen.
  */
  const inFlight = useRef(false);

  useEffect(() => {
    // The guard inside the effect, because hooks cannot be skipped — the shape every hook in
    // src/lib/history.js uses. Touching the lazy client on an unconfigured build would throw
    // before anything could report it, and a signed-out visitor has no record to read.
    if (!configured || !uid || !isISODay(date)) {
      setState({ ...EMPTY });
      return undefined;
    }

    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));

    supabase
      .rpc('daily_record_get', { p_date: date })
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) throw error;
        // `receivedAt` is read HERE and not inside the normaliser's default, so the deadline is
        // anchored to the moment the answer actually arrived rather than to the moment the
        // component happened to re-render.
        setState({ loading: false, error: null, record: normaliseDailyRecord(data, Date.now()) });
      })
      .catch((e) => {
        if (!alive) return;
        // The record is dropped rather than kept: unlike a page of history, a stale day's counts
        // are a form somebody may submit, and submitting yesterday's numbers into today would be
        // worse than an empty screen with a sentence on it.
        setState({ ...EMPTY, error: guDailyError(e) });
      });

    return () => {
      alive = false;
    };
  }, [uid, date, nonce]);

  // A different day, or a different યુવક, is a different record: nothing from the last one may
  // survive into it, least of all a success sentence about a save that was not this day's.
  useEffect(() => {
    setSaveError(null);
    setSavedAt(0);
  }, [uid, date]);

  /**
   * Save the counts. The server validates the window, clamps, scores and answers.
   *
   * Three things this deliberately does not do:
   *
   *   * **It does not check the window first.** The client's clock is not the authority and a
   *     save at the boundary is exactly the case the requirement names. It is sent, and a
   *     refusal is accepted as the answer.
   *   * **It does not compute anything.** The returned record replaces the state wholesale, so
   *     the points on screen are the ones that were reconciled into the ledger and cannot drift
   *     from it.
   *   * **It does not clear the form on failure.** Whatever he chose stays chosen, so one tap
   *     retries — §1's "never a dead end".
   */
  const save = useCallback(
    async (counts, token) => {
      if (!configured || !uid || !isISODay(date)) return { ok: false, closed: false };
      if (inFlight.current) return { ok: false, closed: false };

      inFlight.current = true;
      setSaving(true);
      setSaveError(null);

      try {
        const { data, error } = await supabase.rpc('daily_record_save', {
          p_date: date,
          p_counts: counts,
          p_client_token: token,
        });
        if (error) throw error;

        const record = normaliseDailyRecord(data, Date.now());
        if (record) setState({ loading: false, error: null, record });
        // A save that was accepted but answered with a shape this file cannot read is still a
        // save. Re-asking is the honest repair: the server has the record, so go and get it.
        else setNonce((n) => n + 1);

        setSavedAt(Date.now());
        return { ok: true, closed: false };
      } catch (e) {
        const closed = isWindowClosed(e);
        setSaveError(guDailyError(e));
        // Whatever the refusal was, the server knows something this screen does not. Re-reading
        // is what turns "the save did not go through" into a window state the યુવક can see, and
        // it is the line that makes the boundary case safe rather than merely handled.
        setNonce((n) => n + 1);
        return { ok: false, closed };
      } finally {
        inFlight.current = false;
        setSaving(false);
      }
    },
    [uid, date]
  );

  return { ...state, retry, save, saving, saveError, savedAt };
}

// ---------------------------------------------------------------- which days are still open

const EMPTY_OPEN = { loading: false, days: [] };

/**
 * The days whose window has not closed — `daily_record_status()`.
 *
 * Today, yesterday and any other still-open record, each with whether it is editable and how
 * long remains. Only one thing is done with it: a quiet row of the OTHER open days beside the
 * one on screen, so a યુવક who opens this at 09:00 can see that yesterday's evening ધ્યાન is
 * still his to add. Without it the twenty-four hours are a promise nothing on the screen keeps
 * — he would have to guess a date into the picker to find out.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * There is no `error` in the return, and that is the point
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The same argument `usePointSummary()` makes. This feeds a convenience beside a form that
 * works perfectly without it; an unmigrated 0034, a dropped connection and "nothing else is
 * open" are indistinguishable to a યુવક and all three are honestly rendered as no row at all.
 * The screen's own error line belongs to `daily_record_get()`, which is the call that decides
 * whether there is anything to look at.
 */
export function useOpenDays() {
  const { user } = useAuth();
  const uid = user?.id ?? null;

  const [state, setState] = useState({ ...EMPTY_OPEN, loading: configured });
  /** Bumped by the page after a save, since saving a day is what opens its window. */
  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!configured || !uid) {
      setState({ ...EMPTY_OPEN });
      return undefined;
    }

    let alive = true;
    setState((s) => ({ ...s, loading: true }));

    supabase
      .rpc('daily_record_status')
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) throw error;

        const rows = Array.isArray(data) ? data : Array.isArray(data?.days) ? data.days : [];
        const days = rows
          .map((r) => {
            const d = r?.date ?? r?.activity_date ?? r?.record_date;
            if (!isISODay(d)) return null;
            const editable =
              typeof r.editable === 'boolean' ? r.editable
                : typeof r.is_editable === 'boolean' ? r.is_editable
                  : !CLOSED_STATUS.has(String(r.status ?? '').toLowerCase());
            return editable ? String(d) : null;
          })
          .filter(Boolean);

        // Newest first, and de-duplicated: today and yesterday may each arrive twice if the
        // function answers both a named row and a general one.
        setState({ loading: false, days: [...new Set(days)].sort().reverse() });
      })
      .catch(() => {
        if (alive) setState({ ...EMPTY_OPEN });
      });

    return () => {
      alive = false;
    };
  }, [uid, nonce]);

  return { ...state, refresh };
}
