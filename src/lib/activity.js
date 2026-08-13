/**
 * નોંધાવો — the one way a લેવલ ૧, ૨ or ૩ attempt comes into existence.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why this is an RPC and not an insert
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `public.activity_attempts` has a read policy and no write policy, for anyone, and behind
 * that a `revoke insert, update, delete ... from anon, authenticated`. That is the same shape
 * 0010 gave `level4_attempts`, and the reason is the same one it states: the difference
 * between progression that is unforgeable and progression that is merely inconvenient to
 * forge. Everything a submission is judged by — which day it belongs to, which attempt number
 * it gets, whether it counts as પૂર્ણ, and what it is worth — is computed inside
 * `activity_submit()` from values the browser cannot supply.
 *
 * So this module posts what the યુવક ticked and nothing else. It does not compute a date, does
 * not compute an attempt number, does not decide a status, and above all does not send a point
 * value. §19 and §30 of the brief both say so; the enforcement is that there is no column for
 * any of it to arrive in.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * The token, and the failure it exists for
 * ────────────────────────────────────────────────────────────────────────────
 *
 * A યુવક on Surat mobile data presses નોંધાવો, the request goes out, and the reply never
 * comes back. He presses it again. Without a token that is two attempts and — before the
 * ledger's unique index caught it — would have been two awards.
 *
 * `newToken()` mints one id per *intent*, and the caller holds it across retries: the retry
 * carries the token the first press generated, `activity_submit()` finds the row already
 * there, and returns that row's result unchanged. The database guarantee under it is a partial
 * unique index on `(user_id, client_token)`, so the property survives a client that forgets to
 * hold the token, two tabs, and a browser that replays the request on its own.
 *
 * A new token is minted only when the ticks change — see `LevelPage`'s use — because a second
 * *deliberate* submission of a different answer is attempt #2 and must not be swallowed as a
 * retry of #1. That distinction is the whole difficulty of idempotency here, and it is decided
 * by the caller because only the caller knows whether the yuvak meant it again.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * What this module deliberately does not do
 * ────────────────────────────────────────────────────────────────────────────
 *
 * * **It does not touch `progress`.** લેવલ ૩'s daily score is still `useDailyProgress()`'s,
 *   still a tick-count flushed from the phone, and still the thing the લેવલ ૪ gate reads
 *   (`level4_gate_open()` reads `progress.level3_score`). Recording an attempt is a second,
 *   additive fact about the day. Wiring the gate to attempts instead would silently change who
 *   can reach લેવલ ૪, which is not this work's decision to make.
 * * **It holds no localStorage.** `src/lib/progress.js` is phone-first because a tick must be
 *   instant and must survive a dead connection; a submission is a deliberate act the યુવક
 *   waits on, and an outbox for it would mean showing him "સાચવાયું" for something that had
 *   not been saved.
 * * **It counts no streaks** (§10), and it never lowers or removes anything.
 */

import { supabase } from './supabase';
import { isSupabaseConfigured, supabaseConfigFromEnv } from '../../shared/supabase/client.js';
import { ACTIVITY_KEY, ACTIVITY_LEVEL, ATTEMPT_STATUS } from '../../shared/domain/points.js';

export { ACTIVITY_KEY, ACTIVITY_LEVEL, ATTEMPT_STATUS };

const configured = isSupabaseConfigured(supabaseConfigFromEnv(import.meta.env));

/**
 * What `activity_submit()` can refuse, in Gujarati.
 *
 * Machine codes on the wire, sentences here — the division `src/lib/level4.js` draws and for
 * its stated reason: a `raise exception` reaches the client as an English string from
 * PostgREST, and a યુવક must never read one. The mapping lives beside the caller because the
 * database has no business holding Gujarati.
 *
 * None of these is phrased as his mistake (§1 rule 4). `activity_not_active` is the sharpest
 * thing here and it still describes a state rather than blaming him for it.
 */
const ERRORS = {
  activity_not_signed_in: 'ફરી એક વાર લોગિન કરી લો.',
  activity_not_active: 'આ ખાતું અત્યારે બંધ છે. સંચાલકને એક વાર જણાવી દેજો.',
  activity_unknown: 'આ પ્રવૃત્તિ ઓળખાઈ નહીં.',
};

/** The quiet fallback: something went wrong, it is ours, and pressing again is reasonable. */
const FALLBACK = 'અત્યારે સચવાયું નહીં. ફરી પ્રયત્ન કરો.';

/**
 * A PostgREST failure → a sentence.
 *
 * Scans the message for a known code rather than matching it exactly: PostgREST wraps a
 * `raise exception` in its own envelope, so the code arrives as a substring and an equality
 * test would fall through to the fallback for every real refusal.
 */
export function activityError(err) {
  const raw = `${err?.message || ''} ${err?.details || ''} ${err?.hint || ''}`;
  for (const [code, gu] of Object.entries(ERRORS)) {
    if (raw.includes(code)) return gu;
  }
  return FALLBACK;
}

/**
 * One id per intent.
 *
 * `crypto.randomUUID` is the right source and is present on every browser this app supports,
 * but it is absent on `http://` origins that are not localhost — which is exactly how this app
 * is opened on a phone during a hall test over a LAN address. The fallback is not
 * cryptographically anything and does not need to be: the value's only job is to be different
 * from the last one this યુવક minted, and it is scoped to his own row by the unique index.
 */
export function newToken() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // Some embedded webviews expose `crypto` but throw on the method. Fall through.
  }
  const hex = (n) => Math.floor(Math.random() * 16 ** n).toString(16).padStart(n, '0');
  return `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(8)}${hex(4)}`;
}

const int = (v) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

/**
 * The RPC's jsonb → the shape a screen renders.
 *
 * Tolerant on the way in, in the manner of `pick()` in src/lib/level4.js: a reply missing a
 * field it was expected to carry gives a zero rather than an `undefined` that reaches the DOM
 * as the word "undefined". The server is authoritative for every one of these numbers, so
 * nothing here recomputes one — it only fails softly if a number is not there.
 */
function normaliseResult(data) {
  const d = data && typeof data === 'object' ? data : {};
  return {
    attemptNumber: int(Number(d.attemptNumber)),
    activityDate: typeof d.activityDate === 'string' ? d.activityDate : null,
    completedItems: int(Number(d.completedItems)),
    totalItems: int(Number(d.totalItems)),
    status: d.status === ATTEMPT_STATUS.COMPLETED
      ? ATTEMPT_STATUS.COMPLETED
      : ATTEMPT_STATUS.REVISION_REQUIRED,
    pointsAwarded: int(Number(d.pointsAwarded)),
    todayPoints: int(Number(d.todayPoints)),
    totalPoints: int(Number(d.totalPoints)),
  };
}

/**
 * Record one attempt at લેવલ ૧, ૨ or ૩.
 *
 * @param {object}   opts
 * @param {string}   opts.activity  one of ACTIVITY_KEY — the level is derived from it, so the
 *                                  two can never be sent disagreeing
 * @param {string[]} [opts.selected] ticked scene ids. Empty for લેવલ ૧ and ૨, which have
 *                                  nothing to tick: for them the act is the completion
 * @param {number}   [opts.total]   how many the કસોટી asked for, from useScenes() and never a
 *                                  literal (§62). Ignored by the server when it is smaller
 *                                  than what arrived, so a stale total cannot mark a day short
 * @param {string}   [opts.token]   the idempotency key — see the header. Minted per intent by
 *                                  the caller, held across retries
 *
 * Returns the normalised result. Throws with a `.gu` sentence already attached, so a caller
 * can render `err.gu` without knowing what PostgREST is.
 */
export async function submitActivity({ activity, selected = [], total = 0, token = null } = {}) {
  const level = ACTIVITY_LEVEL[activity];
  if (!level) {
    const err = new Error(`unknown activity: ${activity}`);
    err.gu = ERRORS.activity_unknown;
    throw err;
  }

  if (!configured) {
    // Nothing to talk to. The same shape src/lib/progress.js and useSettings() take: the
    // screen goes on working, and nothing is claimed to have been saved that was not.
    const err = new Error('supabase not configured');
    err.gu = FALLBACK;
    throw err;
  }

  // Distinct, and only real ids. The server intersects against the collection anyway, so this
  // is not a validation — it is the smaller payload, which on a weak signal is the difference
  // between a submission that lands and one that times out.
  const ids = [...new Set((Array.isArray(selected) ? selected : []).filter((s) => typeof s === 'string' && s))];

  const { data, error } = await supabase.rpc('activity_submit', {
    p_level: level,
    p_activity: activity,
    p_selected: ids,
    p_total: int(Number(total)),
    p_token: token,
  });

  if (error) {
    const err = new Error(error.message || 'activity_submit failed');
    err.gu = activityError(error);
    err.cause = error;
    throw err;
  }

  return normaliseResult(data);
}

/**
 * લેવલ ૧ and લેવલ ૨'s shorthand: an activity that has happened, with nothing to count.
 *
 * Kept as its own name rather than a `submitActivity` call with two empty arguments, because
 * the two are different sentences about the સાધના. "He ticked ૮૨ of ૧૦૮" is a measurement;
 * "he sat and watched" is not, and §5 and §6 ask for the second to be counted as repetitions
 * rather than scored as coverage. `summariseRow()` in shared/domain/history.js renders the two
 * differently for the same reason.
 */
export const recordActivity = (activity, token = null) =>
  submitActivity({ activity, selected: [], total: 0, token });
