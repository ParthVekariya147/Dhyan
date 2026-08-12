import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './supabase';
import { useAuth } from './auth';
import { STAGE, canTransition, safeStage } from './stages';
import { TOTAL, inOrder, keepKnown, sceneIds } from './scenes';

/**
 * User progress (§21, §28).
 *
 * Two separations do the real work here:
 *
 *  1. MASTER CONTENT vs USER PROGRESS. Progress stores stable scene ids and nothing
 *     else — never a copy of the scene, its image urls or its વર્ણન. Re-encoding the
 *     images or rewording a વર્ણન therefore cannot invalidate a single user document.
 *
 *  2. CHECKBOX STATE vs AUTHORITATIVE STATE (§12). Ticks during the recognition stage
 *     are a draft held on the phone. They become remembered/pending only at submit.
 *     This is not only tidiness: 2,000 yuvaks ticking 100 boxes is 200,000 writes a day
 *     against a 20,000/day free quota, so a tick must never reach Firestore. One
 *     submit is one write.
 *
 * Firestore is authoritative; localStorage is a mirror so that a refresh, a dead tunnel
 * or a closed browser loses nothing (§29).
 */

const LearningCtx = createContext(null);
export const useLearning = () => useContext(LearningCtx);

/**
 * Postgres columns are snake_case; the state this module works in is camelCase.
 * Mapping lives in these two functions so no other line has to think about it.
 */
const toStateRow = (uid, s) => ({
  user_id: uid,
  current_stage: s.currentStage,
  session_id: s.sessionId,
  remembered_item_ids: s.rememberedItemIds,
  pending_item_ids: s.pendingItemIds,
  mastered_item_ids: s.masteredItemIds,
  completed_sessions: s.completedSessions,
  total_at_submit: s.totalAtSubmit,
  updated_at: new Date().toISOString(),
});

const fromStateRow = (r) => ({
  currentStage: r.current_stage,
  sessionId: r.session_id,
  rememberedItemIds: r.remembered_item_ids,
  pendingItemIds: r.pending_item_ids,
  masteredItemIds: r.mastered_item_ids,
  completedSessions: r.completed_sessions,
  totalAtSubmit: r.total_at_submit,
});

/** upsert, so a retried write overwrites its own row rather than failing on the PK. */
const saveState = (uid, s) =>
  supabase.from('learning_state').upsert(toStateRow(uid, s), { onConflict: 'user_id' });

const saveSession = (uid, sessionId, fields) =>
  supabase.from('learning_sessions').upsert(
    { id: sessionId, user_id: uid, ...fields },
    { onConflict: 'id' }
  );

const localKey = (uid) => `varni:progress:${uid}`;
const draftKey = (uid, sessionId) => `varni:draft:${uid}:${sessionId}`;

const readLocal = (key) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};
const writeLocal = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode or quota — Firestore is still authoritative, so this is not fatal */
  }
};

const EMPTY = {
  currentStage: STAGE.NOT_STARTED,
  sessionId: null,
  rememberedItemIds: [],
  pendingItemIds: [],
  masteredItemIds: [],
  completedSessions: 0,
  totalAtSubmit: 0,
};

/**
 * Deterministic session id (§15).
 *
 * Derived from the uid and the round number, so the id a retry computes is the id the
 * first attempt used. A random id would create a second session document every time a
 * yuvak double-tapped submit or a flaky connection retried underneath us.
 */
const makeSessionId = (uid, round) => `${uid.slice(0, 8)}-r${String(round + 1).padStart(3, '0')}`;

/** Discard anything that is not a currently known, active scene id (§30). */
function sanitize(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  return {
    currentStage: safeStage(s.currentStage),
    sessionId: typeof s.sessionId === 'string' ? s.sessionId : null,
    rememberedItemIds: keepKnown(s.rememberedItemIds),
    pendingItemIds: keepKnown(s.pendingItemIds),
    masteredItemIds: keepKnown(s.masteredItemIds),
    completedSessions: Number.isInteger(s.completedSessions) ? s.completedSessions : 0,
    totalAtSubmit: Number.isInteger(s.totalAtSubmit) ? s.totalAtSubmit : 0,
  };
}

export function LearningProvider({ children }) {
  const { user } = useAuth();
  /*
    `id`, not `uid`. The Supabase user object has no `uid` — that was the Firestore shape
    this module was ported from, and the whole file is downstream of this one line: with
    `uid` permanently null the load effect took its signed-out branch, `ready` never
    became true, and every yuvak who reached the journey watched three dots forever.
    src/lib/auth.jsx and src/lib/progress.js both read `user.id`; so does this.
  */
  const uid = user?.id ?? null;

  const [state, setState] = useState(EMPTY);
  const [ready, setReady] = useState(false);
  const [draft, setDraft] = useState(() => new Set());
  const [syncError, setSyncError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(null);
  // Bumped by retryLoad. The load lives in an effect, so re-running it means re-keying it
  // — that way a retry takes exactly the path the first attempt took, cached copy and all,
  // instead of being a second, subtly different copy of the same request.
  const [loadAttempt, setLoadAttempt] = useState(0);

  // Latest state, readable from callbacks without adding it to their dependencies.
  const latest = useRef(state);
  latest.current = state;

  // ---------------------------------------------------------------- load
  useEffect(() => {
    if (!uid) {
      setState(EMPTY);
      setDraft(new Set());
      setLoadError(null);
      setReady(false);
      return;
    }

    let alive = true;
    setReady(false);
    setLoadError(null);

    // The cached copy renders immediately so the first screen after login is not a
    // spinner (§5, §24); the server copy replaces it a moment later.
    const cached = readLocal(localKey(uid));
    if (cached) setState(sanitize(cached));

    /*
      One exit for every outcome, because there is no third state a yuvak can be left in.

      A read can fail two ways that look nothing alike in code: Postgrest can *return* an
      error, or the promise can *reject* — a dead tunnel, a CORS refusal, a throw inside
      the SDK — in which case no `error` field is ever inspected. The original code handled
      only the first and had no .catch at all, so the second left `ready` false with nobody
      left to set it.

      Whether a failure is fatal depends on the phone, not on the error: §29 makes the
      local mirror a complete copy of the progress, so a yuvak who has been here before
      carries on with it and never sees a failure at all. Only a first visit that cannot
      read the server has nothing to show — and there, continuing from EMPTY would be worse
      than stopping, because the first save would overwrite the very row we failed to read.
      So that case, and only that case, holds `ready` false and reports loadError; the
      screen turns it into a message with ફરી પ્રયત્ન કરો instead of an endless spinner.
    */
    const settle = (failure) => {
      if (!alive) return;
      if (failure && !cached) {
        setLoadError(failure);
        return;
      }
      setLoadError(null);
      setReady(true);
    };

    supabase
      .from('learning_state')
      .select('*')
      .eq('user_id', uid)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) {
          settle(error.code || 'load-failed');
          return;
        }
        if (!alive) return;
        if (data) {
          const server = sanitize(fromStateRow(data));
          setState(server);
          writeLocal(localKey(uid), server);
        } else if (!cached) {
          // maybeSingle() answers data:null, error:null for a yuvak who simply has no row
          // yet. That is the first morning, not a failure — he starts at NOT_STARTED.
          setState(EMPTY);
        }
        settle(null);
      })
      .catch((err) => settle(err?.code || 'load-failed'));

    return () => {
      alive = false;
    };
  }, [uid, loadAttempt]);

  /** Re-run the load. The counterpart of retrySync, for the read rather than the write. */
  const retryLoad = useCallback(() => setLoadAttempt((n) => n + 1), []);

  // Restore the tick draft whenever the session changes (§29 — a refresh mid-stage
  // must not clear what the yuvak has already ticked).
  useEffect(() => {
    if (!uid || !state.sessionId) {
      setDraft(new Set());
      return;
    }
    const saved = readLocal(draftKey(uid, state.sessionId));
    setDraft(new Set(keepKnown(saved)));
  }, [uid, state.sessionId]);

  // ---------------------------------------------------------------- persist
  const persist = useCallback(
    async (next) => {
      if (!uid) return;
      writeLocal(localKey(uid), next); // local first: survives a failed network write
      setSaving(true);
      try {
        { const { error } = await saveState(uid, next); if (error) throw error; }
        setSyncError(null);
      } catch (err) {
        setSyncError(err?.code || 'sync-failed');
      } finally {
        setSaving(false);
      }
    },
    [uid]
  );

  const apply = useCallback(
    (patch) => {
      const next = { ...latest.current, ...patch };
      latest.current = next;
      setState(next);
      persist(next);
      return next;
    },
    [persist]
  );

  // ---------------------------------------------------------------- actions
  const goTo = useCallback(
    (target) => {
      const from = latest.current.currentStage;
      if (from === target) return true;
      if (!canTransition(from, target)) return false; // §30: no illegal jumps
      apply({ currentStage: target });
      return true;
    },
    [apply]
  );

  /** Begin the journey, or a fresh round after completion. */
  const begin = useCallback(() => {
    const cur = latest.current;
    const round = cur.completedSessions ?? 0;
    apply({
      currentStage: STAGE.VIDEO_DARSHAN,
      sessionId: cur.sessionId && cur.currentStage !== STAGE.COMPLETED
        ? cur.sessionId
        : makeSessionId(uid, round),
    });
  }, [apply, uid]);

  /** A tick. Local only — deliberately never a Firestore write. */
  const toggleRemember = useCallback(
    (id) => {
      setDraft((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        if (uid && latest.current.sessionId) {
          writeLocal(draftKey(uid, latest.current.sessionId), [...next]);
        }
        return next;
      });
    },
    [uid]
  );

  /**
   * Submit (§14, §15).
   *
   * Idempotent in three independent ways, because a yuvak on a weak connection will
   * retry: the session id is deterministic, the session document is written with
   * `merge`, and a submit for a session already past RECOGNITION returns the stored
   * result instead of recomputing one. Double-tapping cannot create a second session
   * or move anybody's counts.
   */
  const submit = useCallback(async () => {
    const cur = latest.current;
    if (!uid || !cur.sessionId) return null;

    // Already submitted — hand back what was stored rather than writing again.
    if (cur.currentStage !== STAGE.RECOGNITION && cur.rememberedItemIds.length + cur.pendingItemIds.length > 0) {
      return { remembered: cur.rememberedItemIds, pending: cur.pendingItemIds, replayed: true };
    }

    const all = sceneIds();
    const remembered = inOrder([...draft]);
    const rememberedSet = new Set(remembered);
    const pending = all.filter((id) => !rememberedSet.has(id));

    const next = {
      ...cur,
      currentStage: STAGE.SUBMITTED,
      rememberedItemIds: remembered,
      pendingItemIds: pending,
      totalAtSubmit: all.length,
    };
    latest.current = next;
    setState(next);
    writeLocal(localKey(uid), next);

    setSaving(true);
    try {
      // The session record is history (§20) and carries the deterministic id, so a
      // replayed submit overwrites itself instead of accumulating.
      {
        const { error } = await saveSession(uid, cur.sessionId, {
          remembered_item_ids: remembered,
          pending_item_ids: pending,
          total: all.length,
          submitted_at: new Date().toISOString(),
        });
        if (error) throw error;
      }
      { const { error } = await saveState(uid, next); if (error) throw error; }
      setSyncError(null);
    } catch (err) {
      // §29: the selection is already on the phone and in state. Nothing is lost;
      // the screen offers ફરી પ્રયત્ન કરો and the same call replays safely.
      setSyncError(err?.code || 'sync-failed');
    } finally {
      setSaving(false);
    }

    return { remembered, pending, replayed: false };
  }, [uid, draft]);

  /** Retry whatever failed, using the state already held. */
  const retrySync = useCallback(async () => {
    const cur = latest.current;
    if (!uid) return;
    setSaving(true);
    try {
      if (cur.sessionId && cur.rememberedItemIds.length + cur.pendingItemIds.length > 0) {
        const { error } = await saveSession(uid, cur.sessionId, {
          remembered_item_ids: cur.rememberedItemIds,
          pending_item_ids: cur.pendingItemIds,
          total: cur.totalAtSubmit || TOTAL,
          submitted_at: new Date().toISOString(),
        });
        if (error) throw error;
      }
      { const { error } = await saveState(uid, cur); if (error) throw error; }
      setSyncError(null);
    } catch (err) {
      setSyncError(err?.code || 'sync-failed');
    } finally {
      setSaving(false);
    }
  }, [uid]);

  /** Finishing the recall stage. Everything reached becomes mastered (§20). */
  const complete = useCallback(async () => {
    const cur = latest.current;
    const mastered = inOrder([...cur.masteredItemIds, ...cur.rememberedItemIds]);
    const next = {
      ...cur,
      currentStage: STAGE.COMPLETED,
      masteredItemIds: mastered,
      completedSessions: (cur.completedSessions ?? 0) + 1,
    };
    latest.current = next;
    setState(next);
    writeLocal(localKey(uid), next);

    try {
      if (cur.sessionId) {
        await saveSession(uid, cur.sessionId, { completed_at: new Date().toISOString() });
      }
      { const { error } = await saveState(uid, next); if (error) throw error; }
      setSyncError(null);
    } catch (err) {
      setSyncError(err?.code || 'sync-failed');
    }
  }, [uid]);

  // A failed write — or a failed first read, which strands the yuvak far more visibly —
  // is retried as soon as the device says it is back online, so the commonest cause of
  // both (a tunnel that dropped) fixes itself without anybody being asked to tap anything.
  useEffect(() => {
    if (!uid || (!syncError && !loadError)) return;
    const onOnline = () => {
      if (loadError) retryLoad();
      if (syncError) retrySync();
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [syncError, loadError, uid, retrySync, retryLoad]);

  const value = useMemo(() => {
    const remembered = state.rememberedItemIds;
    const pending = state.pendingItemIds;
    return {
      ready,
      stage: state.currentStage,
      sessionId: state.sessionId,
      remembered,
      pending,
      mastered: state.masteredItemIds,
      completedSessions: state.completedSessions,
      // Every count is derived — nothing here is ever a literal (§13).
      total: TOTAL,
      totalAtSubmit: state.totalAtSubmit || TOTAL,
      rememberedCount: remembered.length,
      pendingCount: pending.length,
      draft,
      draftCount: draft.size,
      isTicked: (id) => draft.has(id),
      toggleRemember,
      goTo,
      begin,
      submit,
      complete,
      retrySync,
      syncError,
      saving,
      // The read's own pair, deliberately separate from syncError: one says "what you did
      // is not saved yet", the other "there is nothing to show you yet". They are answered
      // by different screens and must not be collapsed into one flag.
      retryLoad,
      loadError,
    };
  }, [
    state, ready, draft, toggleRemember, goTo, begin, submit, complete,
    retrySync, syncError, saving, retryLoad, loadError,
  ]);

  return <LearningCtx.Provider value={value}>{children}</LearningCtx.Provider>;
}
