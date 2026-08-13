import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './supabase';
import { useAuth } from './auth';
import { isSupabaseConfigured, supabaseConfigFromEnv } from '../../shared/supabase/client.js';
import { LEVELS_SETTINGS_DOC } from '../../shared/domain/settings.js';
import {
  LEADERBOARD_KEY,
  normaliseLeaderboard,
  resolveLeaderboard,
} from '../../shared/domain/leaderboard.js';

/**
 * ક્રમાંક — the યુવક side of the leaderboard (migration 0023).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * This module reads a name and a number, and there is nothing else to read
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Read the header of shared/domain/leaderboard.js first; it governs everything here. The short
 * of it: `leaderboard()` is the single SECURITY DEFINER aperture through which one યુવક may see
 * another, no RLS policy anywhere is widened by this feature, and the function answers with a
 * display name and a total — no user id, no SMK, no મોબાઈલ, no સબઝોન, no dates. A row of this
 * list cannot be joined to anything, and this module must not try.
 *
 * So there is exactly one request in this file, it takes one argument (the window), and
 * `normaliseLeaderboard()` is what turns its jsonb into what a screen renders. That function
 * **drops anything a row arrives carrying beyond those three fields**, which is the client half
 * of the rule above: if a later migration widened the function's SELECT, this would go on
 * rendering a name and a number until somebody added the extra column here on purpose.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Off is the ordinary state, not a failure
 * ────────────────────────────────────────────────────────────────────────────
 *
 * DEFAULT_LEADERBOARD is `enabled: false` with no window chosen, so a project that never opened
 * this field has a board that shows nothing — permanently, and correctly. The RPC agrees: a
 * disabled board answers `rows: []`, `me: null`, `participants: 0` rather than raising. Nothing
 * in this module treats either of those as an error, and the page draws them as a plain
 * sentence rather than as something broken.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * §27, again — only the /leaderboard route may call this
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The same rule src/lib/history.js states for the same reason. મુખપૃષ્ઠ is where a યુવક lands
 * after signing in on a weak connection (§14), and a settings read plus an RPC mounted there
 * would be paid for by every visit to the app. A ક્રમાંક is somewhere a યુવક goes, and it must
 * never be something he is handed on a screen he opened for another purpose.
 */

const configured = isSupabaseConfigured(supabaseConfigFromEnv(import.meta.env));

/**
 * The whole of shared/domain/leaderboard.js, re-exported.
 *
 * The convention src/lib/history.js:50 and src/lib/level4.js follow: a screen imports
 * `../lib/leaderboard` and never reaches across into shared/ itself. LEADERBOARD_PERIOD,
 * LEADERBOARD_PERIODS, PERIOD_LABEL, resolveLeaderboard and normaliseLeaderboard all arrive
 * through here, so the page has one import for the whole feature.
 */
export * from '../../shared/domain/leaderboard.js';

// ---------------------------------------------------------------- errors

/**
 * The two refusals `leaderboard()` raises, in Gujarati — the shape L4_ERRORS takes in
 * src/lib/level4.js, and for the same reasons.
 *
 * Neither is a mistake the યુવક made. `leaderboard_not_signed_in` is a session that expired
 * between opening the page and asking for the list; he is not signed out of the app, only out
 * of this request. `leaderboard_not_active` is the account lifecycle every other read is
 * subject to through RLS, asked for explicitly because SECURITY DEFINER bypasses it — it is
 * the સંચાલક's decision and not something to explain to a યુવક in the middle of his ધ્યાન.
 *
 * Nothing here is red and nothing here is worded as his doing (§1 rule 4). This is the one page
 * in the app where that is easiest to get wrong, so it is the one where every string was
 * reread before it was kept.
 */
const LB_ERRORS = {
  leaderboard_not_signed_in: 'ફરી લોગિન કરો, પછી ક્રમાંક દેખાશે. તમારું ધ્યાન સચવાયેલું છે.',
  leaderboard_not_active: 'તમારું ખાતું હમણાં ચાલુ નથી. સંચાલકને એક વાર જણાવી દેજો.',
};

/** ક્રમાંક હજુ તૈયાર થઈ રહ્યું છે — said in one place so every state that means it says it alike. */
const LB_PREPARING_GU = 'ક્રમાંક હજુ તૈયાર થઈ રહ્યું છે. થોડા વખતમાં અહીં આવશે.';

/** Every field PostgREST might carry the identifier in — see the note in src/lib/level4.js. */
const errorText = (e) =>
  [e?.code, e?.message, e?.details, e?.hint].filter(Boolean).join(' | ').toLowerCase();

/**
 * The function is not in the database yet.
 *
 * A build deployed ahead of 0023 gets `42883` (Postgres: no such function) or `PGRST202`
 * (PostgREST's schema cache has not caught up, which is what a client actually sees for a few
 * seconds after a migration lands). To a યુવક both mean the board is not ready, which is the
 * same thing an unconfigured board means and is said the same calm way.
 */
const isMissingRpc = (e) => {
  const t = errorText(e);
  return t.includes('42883') || t.includes('pgrst202') || t.includes('pgrst203');
};

/** Any failure reading the board → one quiet Gujarati sentence. */
function guLeaderboardError(e) {
  if (!e) return 'ક્રમાંક હમણાં ખૂલ્યું નથી. થોડી વાર પછી ફરી જુઓ.';
  if (e.gu) return e.gu;

  const text = errorText(e);
  for (const [code, gu] of Object.entries(LB_ERRORS)) {
    if (text.includes(code)) return gu;
  }
  if (isMissingRpc(e)) return LB_PREPARING_GU;
  // The two ordinary network shapes. `Failed to fetch` is a dropped connection; 429 is
  // Supabase throttling, which walks a retrying યુવક straight back into the same wall
  // unless it is named.
  if (text.includes('failed to fetch') || text.includes('networkerror')) {
    return 'નેટ બરાબર નથી. ફરી પ્રયત્ન કરો.';
  }
  if (e?.status === 429) return 'ઘણી વાર પ્રયત્ન થયો. થોડી વાર પછી ફરી કરો.';
  return 'ક્રમાંક હમણાં ખૂલ્યું નથી. થોડી વાર પછી ફરી જુઓ.';
}

// ---------------------------------------------------------------- the સંચાલક's config

/**
 * settings.levels.leaderboard — whether there is a board at all, which windows it offers, which
 * one opens first, and how many names stand on it.
 *
 * The same `settings` row `useLevels()` and `useLevel4GateSetting()` read (src/lib/useSettings.js),
 * read the same way and resolved through the same shared resolver both apps use, so the panel
 * and the યુવક app cannot disagree about what the સંચાલક ticked. It is a local read rather than
 * a call into useSettings.js because `useSettingsRow()` is private to that module and this
 * feature is not a reason to widen it.
 *
 * **Every failure degrades to the disabled default**, and that is sharper here than in any
 * other settings hook. Elsewhere a failed read costs a fallback description or the code's own
 * level list; here `enabled` decides whether one યુવક sees another યુવક's name. A read that
 * cannot be understood must therefore fall closed — which is exactly what resolveLeaderboard()
 * does with `null`, so the error branch and the missing-row branch are one line rather than two.
 *
 * @returns {{ setting: { enabled, periods, defaultPeriod, topN }, loading: boolean }}
 *   Never null and never partial on the first paint. `loading` matters on this page and is not
 *   optional to honour: rendering `enabled: false` for the width of one round trip would tell a
 *   યુવક the board is switched off and then take it back.
 */
export function useLeaderboardSetting() {
  const [state, setState] = useState({ raw: null, loading: configured });

  useEffect(() => {
    // Inside the effect, because hooks cannot be skipped — the shape useSettingsRow(),
    // useScenes() and level4.js all use. Touching the lazy client on a build with no Supabase
    // keys would throw before anything could report it, and a board that cannot be configured
    // is a board that is off.
    if (!configured) {
      setState({ raw: null, loading: false });
      return;
    }

    let alive = true;
    setState((s) => ({ ...s, loading: true }));

    supabase
      .from('settings')
      .select('value')
      .eq('key', LEVELS_SETTINGS_DOC)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!alive) return;
        setState({ raw: error ? null : data?.value?.[LEADERBOARD_KEY] ?? null, loading: false });
      })
      .catch(() => {
        if (alive) setState({ raw: null, loading: false });
      });

    return () => {
      alive = false;
    };
  }, []);

  const setting = useMemo(() => resolveLeaderboard(state.raw), [state.raw]);
  return { setting, loading: state.loading };
}

// ---------------------------------------------------------------- the board

/**
 * The board itself, for whichever window is on screen.
 *
 * @returns {{ loading, error, enabled, periods, period, setPeriod, board, retry }}
 *   `board` is `normaliseLeaderboard()`'s output — `{ period, rows, me, participants }`, where a
 *   row is `{ rank, name, points, isMe }` and nothing else — or null before the first answer
 *   arrives. `error` is a Gujarati sentence or null. `enabled: false` is the સંચાલક's setting,
 *   not a failure, and `periods` is empty in that state so the page draws no tabs.
 *
 * **The `/leaderboard` route only** — see the §27 note at the top of this file.
 */
export function useLeaderboard() {
  const { user } = useAuth();
  const uid = user?.id ?? null;
  const { setting, loading: settingLoading } = useLeaderboardSetting();

  /*
    Which tab he pressed, or null for "whichever the સંચાલક opens the board on".

    Kept as the tap rather than as the resolved window so that the setting stays the authority:
    if the row arrives late, or is later changed to stop offering the window he is looking at,
    `period` below falls back to the સંચાલક's default instead of leaving the page pointed at a
    tab that is not on screen.
  */
  const [chosen, setChosen] = useState(null);
  const period = chosen && setting.periods.includes(chosen) ? chosen : setting.defaultPeriod;

  const [state, setState] = useState({ loading: false, error: null, board: null });
  // Bumped to re-ask. A counter rather than a boolean so two retries in a row both land.
  const [nonce, setNonce] = useState(0);

  /*
    One answer per window, kept for the length of the visit.

    Four tabs and a thumb is four requests, and then four more the second time he compares આજે
    with કુલ. On Surat mobile data that is a second of dots every time he presses a tab he has
    already read — for a list that does not change while he is looking at it. So a window that
    has answered once is answered from here, and tapping between tabs after that is instant and
    free. A `useRef` and not state: filling the cache must not itself cause a render.

    It is a *visit* cache, deliberately, not localStorage. It dies with the page, so opening
    ક્રમાંક again asks the server — and nothing about another યુવક's name is ever written to
    this phone (§13).
  */
  const cacheRef = useRef(new Map());
  /** Whose board is in the cache. See the top of the effect for what it prevents. */
  const ownerRef = useRef(null);

  const retry = useCallback(() => {
    // Drop what is held for this window first, so retry is a real re-ask rather than a
    // re-render of the same cached answer.
    cacheRef.current.delete(period);
    setNonce((n) => n + 1);
  }, [period]);

  const setPeriod = useCallback((p) => setChosen(p), []);

  useEffect(() => {
    /*
      A different યુવક gets a different board. `isMe` and `me` are answers about whoever was
      signed in when the request was made, so a cache surviving a sign-out would put somebody
      else's row under a "તમે" mark on the next યુવક's screen.
    */
    if (ownerRef.current !== uid) {
      ownerRef.current = uid;
      cacheRef.current.clear();
    }

    // The guard inside the effect, for the reason given in useLeaderboardSetting() above. A
    // board that is off, a signed-out visitor and an unconfigured build are the same quiet
    // nothing, and none of the three is an error.
    if (!configured || !uid || !setting.enabled) {
      setState({ loading: false, error: null, board: null });
      return;
    }

    const cached = cacheRef.current.get(period);
    if (cached) {
      setState({ loading: false, error: null, board: cached });
      return;
    }

    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));

    supabase
      .rpc('leaderboard', { p_period: period })
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) throw error;
        /*
          Both shapes a function returning one object can arrive in: the `returns jsonb` object,
          and the one-row table PostgREST hands back as `[{ … }]`. Read for either, for the
          reason the payload note in src/lib/level4.js gives — which of the two a migration
          declared is a spelling of the same fact, not a different fact.
        */
        const payload = Array.isArray(data) ? data[0] : data;
        const board = normaliseLeaderboard(payload);
        cacheRef.current.set(period, board);
        setState({ loading: false, error: null, board });
      })
      .catch((e) => {
        if (!alive) return;
        // Nothing is cached on failure, so the next retry or tab press asks again rather than
        // finding a hole where an answer should be.
        setState({ loading: false, error: guLeaderboardError(e), board: null });
      });

    return () => {
      alive = false;
    };
    /*
      `uid` so signing in or out re-reads, `period` so a tab press fetches its window, and
      `nonce` so retry re-asks. `setting.enabled` rather than the whole object, because the
      object is rebuilt by resolveLeaderboard() on every settings render and only this field
      changes whether there is anything to fetch.
    */
  }, [uid, period, setting.enabled, nonce]);

  return {
    /*
      Three things are "still loading", and collapsing them is what stops a flicker.

      The settings read is one. The RPC is the second. The third is the gap between them: the
      setting has just arrived saying the board is on, the effect has not run yet, and for one
      painted frame `board` is null with nothing in flight — which the page would otherwise draw
      as "there is nothing here". `enabled && !board && !error` closes exactly that window.

      `uid` is in the third clause and is not decoration: without it a signed-out render, where
      the effect deliberately fetches nothing, would satisfy the other two conditions for ever
      and leave three dots turning on a page that is never going to load. The route is guarded,
      so this is the belt.
    */
    loading:
      settingLoading ||
      state.loading ||
      (setting.enabled && Boolean(uid) && !state.board && !state.error),
    error: state.error,
    enabled: setting.enabled,
    periods: setting.periods,
    period,
    setPeriod,
    board: state.board,
    retry,
  };
}
