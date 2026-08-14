import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './supabase';
import { useAuth } from './auth';
import { isSupabaseConfigured, supabaseConfigFromEnv } from '../../shared/supabase/client.js';
import { todayIST } from './daily';

/**
 * લેવલ ૩'s પુનરાવર્તન — the ticks in progress, saved by themselves, and the revisions behind them.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why this exists beside src/lib/progress.js rather than inside it
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `useDailyProgress()` answers "how much of today has he done", writes one integer to
 * `progress.level3_score`, and is what the લેવલ ૪ gate reads. It is deliberately phone-first: a
 * tick is a localStorage write and the day's *score* reaches Postgres within the minute. That is
 * still exactly right for what it does, and none of it changes.
 *
 * What it cannot do — and was never asked to — is any of the four things લેવલ ૩ now needs:
 *
 *   * **Keep the ticked દ્રશ્યો**, not their count. `progress` has one column and it is a number,
 *     so a યુવક who opened the app on a second phone got a score with no boxes (progress.js:152-164
 *     explains that trade honestly). §12 asks for the unfinished session to come back; there was
 *     nowhere for it to come back from.
 *   * **Produce an event.** Nothing on the tick path writes an `activity_attempts` row, so a
 *     યુવક who ticked ૫૦ and walked away left nothing the ledger, the board or any report could
 *     ever see. Points existed only if he pressed the button.
 *   * **Separate the current પુનરાવર્તન from the day's history.** `scoreOf()` is a monotonic
 *     floor by design — a ધ્યાન already done is never taken away — so after a reset it goes on
 *     reporting the larger number and the second પુનરાવર્તન's ૪૦ can never be read off it.
 *   * **Measure attention.** There was nothing anywhere that could tell સાધના from scrolling.
 *
 * So this module owns the *session*, `useDailyProgress()` goes on owning the *day*, and the two
 * do not overlap: this one never writes `progress`, and that one never learns what is ticked.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * What this module does NOT do, and must never learn to
 * ────────────────────────────────────────────────────────────────────────────
 *
 * * **It computes no points and measures no time.** Both are the server's, and the second is the
 *   whole of §17 for this feature: `level3_draft_save()` accumulates attention from Postgres's
 *   own `now()` between one save and the next, so there is no duration on the wire and no
 *   request this file could send that would make the number larger than the time that passed.
 *   Every figure rendered — the eligible ticks, this પુનરાવર્તન's award, the cumulative total —
 *   is read out of the snapshot the server returned.
 * * **It never deletes.** There is no code path here that removes an attempt or lowers a total.
 *   `reset()` calls `level3_reset()`, which *finishes* the current પુનરાવર્તન before clearing the
 *   board — §3 and §11, and the single most important sentence in this work.
 */

const configured = isSupabaseConfigured(supabaseConfigFromEnv(import.meta.env));

/**
 * 2.5 seconds after the last tick, and never longer than 12 from the first unsaved one.
 *
 * The debounce is what stops ૧૦૮ ticks being ૧૦૮ round trips on Surat mobile data — the same
 * arithmetic progress.js §12 opens with. The ceiling is what stops a યુવક who ticks steadily,
 * one box every two seconds for ten minutes, from never crossing the idle threshold and having
 * nothing saved at all: without it the debounce would keep deferring for the whole sitting.
 *
 * Shorter than progress.js's 60 seconds, and deliberately. There, a lost minute costs *lag* and
 * never data, because the outbox survives in localStorage and the score is a floor that only
 * rises. Here the interval is also the clock: attention is measured between saves, so a longer
 * window makes the pace rule coarser, and a યુવક who read carefully for fifty seconds and then
 * closed the app would have banked one long gap rather than the seconds he actually spent.
 */
const IDLE_MS = 2_500;
const MAX_MS = 12_000;

/** Backoff for a failed save: never silently lose a tick, never hammer a dead connection. */
const RETRY_MS = [2_000, 5_000, 15_000, 30_000];

/**
 * The boxes, on this phone, so a refresh with no signal still shows what he ticked.
 *
 * A cache and never the truth: `level3_drafts` is the truth, and it is what a second phone, a
 * cleared browser and every report read. This exists for the one gap the server cannot cover —
 * the moment between a tick and the save that carries it — and `dirty` is what says the gap is
 * open. Keyed by યુવક and stamped with the day, so a record left by yesterday is discarded
 * rather than re-dated: the ticks belong to the day they were made.
 */
export const draftKey = (uid) => `varni:l3:${uid}`;

const readLocal = (key) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null; // private mode, quota, or a value some other version wrote
  }
};

const writeLocal = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage denied. The server still receives every save, so nothing is lost except the
    // ability to redraw the boxes before the first fetch comes back.
  }
};

/** Whatever localStorage handed back → `{ date, ids, dirty }`, or null if it is not that. */
export function sanitiseDraft(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.date !== 'string') return null;
  const ids = Array.isArray(raw.ids) ? raw.ids.filter((s) => typeof s === 'string' && s) : [];
  return { date: raw.date, ids: [...new Set(ids)], dirty: raw.dirty === true };
}

// ---------------------------------------------------------------- errors

/**
 * Any failure against 0035 → one quiet Gujarati sentence.
 *
 * Modelled on `activityError()` in src/lib/activity.js, and the same division of labour: machine
 * codes on the wire, sentences here, because a `raise exception` reaches the browser as an
 * English string from PostgREST and a યુવક must never read one.
 *
 * `level3_missing` is the unmigrated case. PostgREST answers 404/PGRST202 for a function that
 * does not exist, and until 0035 is applied every call here is that — so the page says one quiet
 * line and goes on working from `useDailyProgress()`, exactly as it did before this file existed.
 * None of these is phrased as his mistake (§1 rule 4).
 */
const ERRORS = {
  level3_not_signed_in: 'ફરી એક વાર લોગિન કરી લો.',
  level3_not_active: 'આ ખાતું અત્યારે બંધ છે. સંચાલકને એક વાર જણાવી દેજો.',
  PGRST202: 'આ સુવિધા હમણાં ખૂલી નથી.',
};

const FALLBACK = 'અત્યારે સચવાયું નહીં. જાતે જ ફરી પ્રયાસ થશે.';

export function level3Error(err) {
  const raw = `${err?.message || ''} ${err?.details || ''} ${err?.hint || ''} ${err?.code || ''}`;
  for (const [code, gu] of Object.entries(ERRORS)) {
    if (raw.includes(code)) return gu;
  }
  return FALLBACK;
}

/** Is this the "0035 has not been applied here" failure, rather than a real one? */
const isMissing = (err) => {
  const raw = `${err?.message || ''} ${err?.code || ''}`;
  return raw.includes('PGRST202') || raw.includes('does not exist');
};

// ---------------------------------------------------------------- the snapshot

const int = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.floor(Number(v)) : 0);
const ids = (v) => (Array.isArray(v) ? v.filter((s) => typeof s === 'string' && s) : []);

/**
 * The RPC's jsonb → the shape a screen renders.
 *
 * Tolerant on the way in, in the manner of `normaliseResult()` in src/lib/activity.js: a reply
 * missing a field gives a zero rather than an `undefined` that reaches the DOM as the word
 * "undefined". Nothing here recomputes a number the server sent — it only fails softly when one
 * is absent.
 *
 * `eligibleTicks` is the one field allowed to be null, and the distinction is load-bearing: null
 * means *no pace rule is configured*, which is not the same as *the clock has earned nothing*,
 * and the page renders nothing at all rather than a confident zero.
 */
export function normaliseSnapshot(data) {
  const d = data && typeof data === 'object' ? data : {};
  const cur = d.current && typeof d.current === 'object' ? d.current : {};
  const pace = d.pace && typeof d.pace === 'object' ? d.pace : {};
  const today = d.today && typeof d.today === 'object' ? d.today : {};
  const total = d.total && typeof d.total === 'object' ? d.total : {};

  return {
    date: typeof d.date === 'string' ? d.date : null,

    sceneIds: ids(cur.sceneIds),
    ticks: int(cur.ticks),
    engagedMs: int(cur.engagedMs),
    eligibleTicks: cur.eligibleTicks === null || cur.eligibleTicks === undefined
      ? null
      : int(cur.eligibleTicks),

    pace: {
      secondsPerTick: int(pace.secondsPerTick),
      graceSeconds: int(pace.graceSeconds),
      requiredSeconds: int(pace.requiredSeconds),
    },

    today: {
      revisions: int(today.revisions),
      ticks: int(today.ticks),
      // The day's DISTINCT દ્રશ્યો, counted from finished પુનરાવર્તન only. This — and never
      // `ticks` — is the number the લેવલ ૪ gate asks about, because its sentence is "એક જ
      // દિવસમાં N દ્રશ્યો યાદ કરો" and ticking the same ૪૦ twice is not eighty દ્રશ્યો.
      scenes: int(today.scenes),
      points: int(today.points),
    },
    total: {
      revisions: int(total.revisions),
      ticks: int(total.ticks),
      days: int(total.days),
      points: int(total.points),
      lastAt: typeof total.lastAt === 'string' ? total.lastAt : null,
    },

    revisions: Array.isArray(d.revisions)
      ? d.revisions.map((r) => ({
        n: int(r?.n),
        ticks: int(r?.ticks),
        points: int(r?.points),
        at: typeof r?.at === 'string' ? r.at : null,
        engagedMs: int(r?.engagedMs),
      }))
      : [],

    // Only present on a finalise. `awarded` is read back from the ledger by the server and is
    // never `award_points()`'s return value — a keyed award already written returns 0.
    saved: d.saved === true,
    awarded: int(d.awarded),
  };
}

/**
 * The save, sent by hand so it can carry `keepalive`.
 *
 * supabase-js issues an ordinary `fetch`, and an ordinary fetch started while the page is being
 * torn down is cancelled with it — which is the one moment a save matters most, because it is
 * exactly the "user left without pressing the button" this whole feature exists to survive.
 * `keepalive: true` tells the browser to finish the request after the document is gone.
 *
 * `navigator.sendBeacon` cannot be used instead: it sets no headers, and PostgREST needs `apikey`
 * and `Authorization` to run the function as this યુવક. The same reasoning, and the same shape,
 * as `upsertKeepalive()` in src/lib/progress.js:255-269.
 */
async function saveKeepalive(sceneIds, token) {
  const { url, key } = supabaseConfigFromEnv(import.meta.env);
  const res = await fetch(`${url}/rest/v1/rpc/level3_draft_save`, {
    method: 'POST',
    keepalive: true,
    headers: {
      apikey: key,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_scene_ids: sceneIds }),
  });
  if (!res.ok) throw new Error(`level3_draft_save failed: ${res.status}`);
}

// ---------------------------------------------------------------- the hook

/**
 * The પુનરાવર્તન in progress, and everything the page says about it.
 *
 * @returns {{
 *   ready: boolean, available: boolean,
 *   ticked: Set<string>, ticks: number,
 *   eligibleTicks: number|null, pace: object,
 *   today: object, total: object, revisions: object[],
 *   saveState: 'idle'|'saving'|'saved'|'error',
 *   busy: boolean, outcome: object|null, error: string|null,
 *   toggle: (id: string) => void, flush: () => Promise<void>,
 *   finalize: () => Promise<void>, reset: () => Promise<void>,
 *   prune: (validIds: Set<string>) => void,
 * }}
 */
export function useLevel3Session() {
  const { user, session } = useAuth();
  const uid = user?.id ?? null;

  const [snap, setSnap] = useState(() => normaliseSnapshot(null));
  const [ticked, setTicked] = useState(() => new Set());
  const [ready, setReady] = useState(false);
  // False when 0035 has not been applied here. The page then falls back to what it always did,
  // rather than showing a યુવક an error about a feature he did not ask for.
  const [available, setAvailable] = useState(true);
  const [saveState, setSaveState] = useState('idle');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState(null);
  const [error, setError] = useState(null);

  // Read from callbacks that must not be rebuilt on every tick — a handler whose identity
  // changed 108 times a sitting would add and remove 108 window listeners (progress.js's rule).
  const tickedRef = useRef(ticked);
  const uidRef = useRef(uid);
  const tokenRef = useRef(null);
  const idleTimer = useRef(0);
  const maxTimer = useRef(0);
  const retryAt = useRef(0);
  const inFlight = useRef(false);
  const dirtyRef = useRef(false);
  const aliveRef = useRef(true);

  uidRef.current = uid;
  tokenRef.current = session?.access_token ?? null;

  const cache = useCallback((set, dirty) => {
    const id = uidRef.current;
    if (!id) return;
    dirtyRef.current = dirty;
    writeLocal(draftKey(id), { date: todayIST(), ids: [...set], dirty });
  }, []);

  // ---------------------------------------------------------------- save
  const clearTimers = () => {
    clearTimeout(idleTimer.current);
    clearTimeout(maxTimer.current);
    idleTimer.current = 0;
    maxTimer.current = 0;
  };

  const save = useCallback(async ({ keepalive = false } = {}) => {
    const id = uidRef.current;
    if (!id || !configured || !aliveRef.current) return;
    if (!dirtyRef.current) return;
    // One save in the air at a time. The keepalive path ignores this: the page is leaving and
    // there is no "later" for it to be deferred to.
    if (inFlight.current && !keepalive) return;

    clearTimers();
    const sending = [...tickedRef.current];

    inFlight.current = true;
    if (!keepalive) setSaveState('saving');

    try {
      if (keepalive && tokenRef.current) {
        await saveKeepalive(sending, tokenRef.current);
      } else {
        const { data, error: err } = await supabase.rpc('level3_draft_save', { p_scene_ids: sending });
        if (err) throw err;
        if (!aliveRef.current) return;
        setSnap(normaliseSnapshot(data));
      }

      // Clean only if nothing was ticked while this was in the air — otherwise the newer set is
      // still owed and marking it saved would be the one lie this module must not tell.
      const now = [...tickedRef.current];
      const same = now.length === sending.length && now.every((x) => sending.includes(x));
      if (same) cache(tickedRef.current, false);

      retryAt.current = 0;
      if (!keepalive) { setSaveState('saved'); setError(null); }
    } catch (err) {
      if (isMissing(err)) { setAvailable(false); return; }
      if (!aliveRef.current) return;
      setSaveState('error');
      setError(level3Error(err));

      // Retried by itself, with a widening gap. The ticks are on the phone and in `ticked`,
      // so nothing is lost by this failing — which is exactly what the wording says (§28).
      const wait = RETRY_MS[Math.min(retryAt.current, RETRY_MS.length - 1)];
      retryAt.current += 1;
      idleTimer.current = setTimeout(() => save(), wait);
    } finally {
      inFlight.current = false;
    }
  }, [cache]);

  /** A tick is owed a save: soon, and in any case before MAX_MS is out. */
  const schedule = useCallback(() => {
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => save(), IDLE_MS);
    if (!maxTimer.current) maxTimer.current = setTimeout(() => save(), MAX_MS);
  }, [save]);

  // ---------------------------------------------------------------- load
  useEffect(() => {
    aliveRef.current = true;

    /*
      Nothing to talk to, or nobody to talk about.

      `available: false` and not merely `ready: true`, and the difference is the whole of the
      fallback. This module answers "is the 0035 session usable here", and with no Supabase
      configured — a local build, a preview with no env — the answer is no. Leaving it `true`
      would hand the page an empty session as though it were an empty પુનરાવર્તન: the boxes
      would be blank, the button dead, and `useDailyProgress()`'s perfectly good localStorage
      day would sit unused beside it. The same shape src/lib/activity.js and useSettings() take
      for the same case: the screen goes on working, and nothing is claimed that is not true.
    */
    if (!uid || !configured) {
      if (!configured) setAvailable(false);
      setReady(true);
      return () => { aliveRef.current = false; };
    }

    setReady(false);

    // The phone first, so the boxes are on screen before the round trip comes back. A record
    // from another day is discarded rather than carried: the ticks belong to the day they were
    // made, and the server rolls its own draft the same way.
    const local = sanitiseDraft(readLocal(draftKey(uid)));
    const fresh = local && local.date === todayIST() ? local : null;
    if (fresh) {
      const set = new Set(fresh.ids);
      tickedRef.current = set;
      setTicked(set);
      dirtyRef.current = fresh.dirty;
    }

    supabase.rpc('level3_draft_get').then(({ data, error: err }) => {
      if (!aliveRef.current) return;

      if (err) {
        if (isMissing(err)) setAvailable(false);
        else setError(level3Error(err));
        setReady(true);
        return;
      }

      const s = normaliseSnapshot(data);
      setSnap(s);

      /*
        Whose boxes win.

        `dirty` means this phone holds ticks that never reached the server, and they are the
        most recent intention there is — so they win, and are sent at once. It is not a merge:
        a union would resurrect a દ્રશ્ય he had just unticked, and unticking has to work.

        Otherwise the server's set wins, which is what makes §12 true — a યુવક who ticked ૫૦ on
        one phone and opened another finds his ૫૦ waiting, and one who cleared his browser
        finds them too.
      */
      if (dirtyRef.current && tickedRef.current.size) {
        setReady(true);
        schedule();
        return;
      }

      const set = new Set(s.sceneIds);
      tickedRef.current = set;
      setTicked(set);
      cache(set, false);
      setReady(true);
    });

    return () => { aliveRef.current = false; };
  }, [uid, schedule, cache]);

  // ---------------------------------------------------------------- leaving
  useEffect(() => {
    if (!uid) return;

    const onVisible = () => {
      // Leaving. `beforeunload` is unreliable on mobile — Safari and Chrome for Android may
      // never fire it — and this is the event that does, including on backgrounding. It is the
      // single most important save in this file: it is the one that catches the યુવક who never
      // presses the button, which is the whole complaint this work started from.
      if (document.visibilityState === 'hidden') save({ keepalive: true });
    };
    const onHide = () => save({ keepalive: true });
    const onOnline = () => save();

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pagehide', onHide);
    window.addEventListener('online', onOnline);

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('online', onOnline);
      clearTimers();
      // Navigating away inside the app fires no visibility or pagehide event at all — tapping
      // મુખપૃષ્ઠ is exactly "leaving the page" for this purpose.
      save();
    };
  }, [uid, save]);

  // ---------------------------------------------------------------- actions
  const toggle = useCallback((id) => {
    const next = new Set(tickedRef.current);
    if (next.has(id)) next.delete(id);
    else next.add(id);

    tickedRef.current = next;
    setTicked(next);
    cache(next, true);
    setSaveState('saving');
    schedule();
  }, [cache, schedule]);

  /**
   * Drop ticks for દ્રશ્યો that are no longer shown.
   *
   * The valid set comes from the caller because it comes from useScenes(), which applies the
   * સંચાલક's overlay and the content gate (§62) — the same division `prune()` in progress.js
   * keeps, and for the same reason. Compares sizes first so it can be called from an effect on
   * every render without looping.
   */
  const prune = useCallback((validIds) => {
    if (!validIds?.size) return;
    const cur = tickedRef.current;
    const next = new Set([...cur].filter((id) => validIds.has(id)));
    if (next.size === cur.size) return;
    tickedRef.current = next;
    setTicked(next);
    cache(next, true);
    schedule();
  }, [cache, schedule]);

  const flush = useCallback(() => save(), [save]);

  /**
   * One id per intent, held across retries.
   *
   * `activity.js`'s `newToken()`, and the same reasoning: a lost reply that the યુવક answers by
   * pressing again must reach the server carrying the token the first press minted, so it is
   * recognised as the retry it is. A *new* પુનરાવર્તન gets a new token, and the server empties
   * the draft on every finalise — so there is no state in which one token could finish two.
   */
  const mintToken = () => {
    try {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
      }
    } catch { /* some webviews expose crypto and throw on the method */ }
    const hex = (n) => Math.floor(Math.random() * 16 ** n).toString(16).padStart(n, '0');
    return `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(8)}${hex(4)}`;
  };

  const commit = useCallback(async (fn) => {
    if (busy || !configured) return;
    setBusy(true);
    setError(null);
    try {
      // The ticks first, always. Finalising reads the draft, so a set that never reached it
      // would be finished as the *previous* set — the one bug that would look exactly like the
      // one this work exists to fix.
      clearTimers();
      if (dirtyRef.current) {
        const { error: e1 } = await supabase.rpc('level3_draft_save', { p_scene_ids: [...tickedRef.current] });
        if (e1) throw e1;
        cache(tickedRef.current, false);
      }

      const { data, error: err } = await supabase.rpc(fn, { p_client_token: mintToken() });
      if (err) throw err;

      const s = normaliseSnapshot(data);
      setSnap(s);
      setOutcome(s);

      // The board is the server's answer, not an assumption: finalising empties the draft, and
      // `s.sceneIds` is what it holds afterwards.
      const set = new Set(s.sceneIds);
      tickedRef.current = set;
      setTicked(set);
      cache(set, false);
      setSaveState('saved');
    } catch (err) {
      if (isMissing(err)) setAvailable(false);
      else setError(level3Error(err));
    } finally {
      setBusy(false);
    }
  }, [busy, cache]);

  const finalize = useCallback(() => commit('level3_finalize'), [commit]);
  const reset = useCallback(() => commit('level3_reset'), [commit]);

  return useMemo(() => ({
    ready,
    available,
    ticked,
    ticks: ticked.size,
    // What finalising right now would be worth, at the pace rule — the server's arithmetic,
    // read back and never recomputed. Null when no rule is configured, which the page renders
    // as nothing rather than as a limit of zero.
    eligibleTicks: snap.eligibleTicks,
    engagedMs: snap.engagedMs,
    pace: snap.pace,
    today: snap.today,
    total: snap.total,
    revisions: snap.revisions,
    saveState,
    busy,
    outcome,
    error,
    toggle,
    prune,
    flush,
    finalize,
    reset,
  }), [ready, available, ticked, snap, saveState, busy, outcome, error, toggle, prune, flush, finalize, reset]);
}
