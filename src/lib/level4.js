import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from './supabase';
import { useAuth } from './auth';
import { useScenes } from './useScenes';
import { isSupabaseConfigured, supabaseConfigFromEnv } from '../../shared/supabase/client.js';
/*
  The status vocabulary and the gate's default, both from the one file that defines them
  (§3.1). `DEFAULT_GATE_THRESHOLD` is `LEVEL4_UNLOCK_THRESHOLD` re-exported, which is the
  same number 0008's level4_unlock_threshold() and 0010's `gate_threshold default 80` are
  mirroring — so a configuration that does not say what its threshold is falls back to the
  shared constant rather than to a number typed here.
*/
import { DEFAULT_GATE_THRESHOLD, L4_ACTIVITY_STATUS } from '../../shared/domain/level4.js';

/**
 * લેવલ ૪ — the યુવક side of the dynamic sub-level system (LEVEL4.md §3.3).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * The one rule that shapes this file
 * ────────────────────────────────────────────────────────────────────────────
 *
 * **The database is the authority, and it is the only writer.** §2.4 gives
 * `level4_activity_progress` and `level4_attempts` no INSERT or UPDATE policy for
 * `authenticated` at all — the four SECURITY DEFINER functions are the only way a row
 * comes into existence. So this module is thin on purpose: it asks
 * `level4_published_config()` what exists, asks `level4_state()` where this યુવક stands,
 * and hands `level4_submit` / `level4_mark_revision` the two things he can do. It decides
 * nothing that the server has already decided.
 *
 * That is also what makes §21 and §33 true without any work: a યુવક who refreshes, signs
 * out, or picks up a different phone gets his place back because his place was never on
 * the phone. There is **no localStorage here and there must not be** — `src/lib/progress.js`
 * owns the daily ticks and their outbox, and a second progress system would be two answers
 * to one question (§21: "DO NOT create duplicate progress systems"). The two do not
 * overlap: progress.js writes `progress.level4_score` for the IST day, and `level4_submit`
 * raises that same column server-side (§2.3 step 8) with `greatest(...)`, never lowering
 * a banked score. Nothing here writes `public.progress`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * What "nothing went wrong" looks like
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Three states that read like failures are ordinary here, and none of them is an error:
 *
 *   * **No published configuration.** The સંચાલક is still building it, or has archived
 *     the last one. `config` is null, `error` is null, and the screen says લેવલ ૪ is
 *     being prepared. §1 rule 4 — never a dead end, never a rebuke.
 *   * **The RPCs are not in the database yet.** A build deployed ahead of
 *     `0010_level4_activities.sql` gets `42883` / `PGRST202` back, which is the same
 *     situation from the યુવક's side and is presented the same way. Anything else would
 *     be a white page or a Postgres string in Gujarati text.
 *   * **The build has no Supabase keys.** Handled the way useScenes() and progress.js
 *     handle it — the guard lives inside the effect, because hooks cannot be skipped, and
 *     touching the lazy client would throw before anything could report it.
 */

const configured = isSupabaseConfigured(supabaseConfigFromEnv(import.meta.env));

/**
 * The five statuses of §2.2 — the `check` constraint on `level4_activity_progress.status`
 * plus the two that are **derived and never stored**, LOCKED and AVAILABLE.
 *
 * Re-exported rather than restated. There is one definition of this vocabulary
 * (`shared/domain/level4.js`, §3.1) and the SQL mirrors it; a second copy here would be a
 * third place for it to drift. Re-exporting means the યુવક screens have a single import
 * for the whole of લેવલ ૪ and never reach past this module for anything.
 */
export { L4_ACTIVITY_STATUS };

const S = L4_ACTIVITY_STATUS;
const KNOWN_STATUS = new Set(Object.values(S));

// ---------------------------------------------------------------- errors

/**
 * Every refusal `level4_submit` and `level4_mark_revision` raise (0010, §2.3), in Gujarati.
 *
 * Each one is a *state*, not a mistake: the સંચાલક has not published yet, લેવલ ૩ has not
 * opened the gate, or the previous કસોટી is still ahead of this one. None of them is
 * anything the યુવક did wrong, so none of them is worded as though it were (§1 rule 4),
 * and none of them is red. This map is the whole reason a raw Postgres string cannot reach
 * a યુવક: the message he sees is chosen here, from the identifier, and the original goes
 * to `.cause` for the console.
 *
 * The gate message deliberately names no number. The threshold is the સંચાલક's
 * (`gate_threshold`, §2.1) and `useLevel4()` returns it, so a screen that wants to print
 * it has it — but this map is static and would have to guess, and a wrong promise is worse
 * than a general one.
 *
 * The last two are not §2.3's three. `level4_not_signed_in` is a session that expired
 * between opening the page and answering it — he is not signed out of the app, only out of
 * this request, and the fix is to sign in again. `level4_not_active` is the account
 * lifecycle every other write is subject to through RLS, asked for explicitly because
 * SECURITY DEFINER bypasses it (0010's own note); it is the સંચાલક's decision and not
 * something to explain to the યુવક in the middle of his ધ્યાન.
 */
const L4_ERRORS = {
  level4_not_published: 'આ કસોટી હમણાં ખુલ્લી નથી. લેવલ ૪ તૈયાર થઈ રહ્યું છે — થોડા વખતમાં ફરી જુઓ.',
  level4_gate_closed: 'લેવલ ૩ પૂરું થયા પછી આ કસોટી ખૂલશે. પહેલાં લેવલ ૩ કરો.',
  level4_locked: 'આ પહેલાંની કસોટી પૂરી થાય પછી આ ખૂલશે. એક પછી એક, ક્રમ પ્રમાણે.',
  /*
    Kept, and unreachable — deliberately.

    0016 refused a submission on a કસોટી already passed; 0017 reversed that, and nothing in
    the database raises this identifier any more. The sentence stays because a browser holding
    yesterday's bundle can still be talking to a database that has not been migrated yet, and
    the cost of the wrong Gujarati line in that window is higher than the cost of five lines
    of dead map. Delete it once no deployment predates 0017.
  */
  level4_already_passed: 'આ કસોટી તમે પૂરી કરી લીધી છે — એ કાયમ પૂરી જ રહેશે. દર્શન ફરી જોવાં હોય તો ખુશીથી જુઓ.',
  level4_not_signed_in: 'ફરી લોગિન કરો, પછી આ કસોટી ચાલુ રહેશે. તમારું ધ્યાન સચવાયેલું છે.',
  level4_not_active: 'તમારું ખાતું હમણાં ચાલુ નથી. સંચાલકને જણાવો.',
};

/** લેવલ ૪ હજુ તૈયાર થઈ રહ્યું છે — said in one place so every screen says it the same way. */
export const L4_PREPARING_GU = 'લેવલ ૪ હજુ તૈયાર થઈ રહ્યું છે. થોડા વખતમાં અહીં આવશે.';

/**
 * Every field PostgREST might carry the identifier in.
 *
 * 0010 raises them bare — `raise exception 'level4_locked'` — which PostgREST returns as
 * `{ code: 'P0001', message: 'level4_locked' }`, so `message` is where they are today. All
 * four are scanned anyway, because a later `using errcode = …` would move the identifier to
 * `code` and a `using detail = …` to `details`, and the sentence a યુવક reads should not
 * depend on which of those a migration picked.
 */
const errorText = (e) =>
  [e?.code, e?.message, e?.details, e?.hint].filter(Boolean).join(' | ').toLowerCase();

/**
 * The function is not in the database yet.
 *
 * `42883` is Postgres's "function does not exist"; `PGRST202` is PostgREST failing to find
 * it in its schema cache, which is what a client actually sees for a few seconds after a
 * migration lands. Both mean the same thing to a યુવક — લેવલ ૪ is not ready — and neither
 * is worth a different sentence.
 */
const isMissingRpc = (e) => {
  const t = errorText(e);
  return t.includes('42883') || t.includes('pgrst202') || t.includes('pgrst203');
};

/**
 * Any failure from a લેવલ ૪ RPC → one Gujarati sentence.
 *
 * Shaped to be reachable through `guError()` in src/lib/auth.jsx as well: that function
 * returns `e.gu` before it looks at anything else, and every error thrown from this module
 * carries one. So a screen that already does `catch (e) { setMsg(guError(e)) }` — the house
 * idiom — gets the right words without importing this.
 */
export function guLevel4Error(e) {
  if (!e) return 'કંઈક ગડબડ થઈ. ફરી પ્રયત્ન કરો.';
  if (e.gu) return e.gu;

  const text = errorText(e);
  for (const [code, gu] of Object.entries(L4_ERRORS)) {
    if (text.includes(code)) return gu;
  }
  if (isMissingRpc(e)) return L4_PREPARING_GU;
  // The two ordinary network shapes. `Failed to fetch` is a dropped connection; 429 is
  // Supabase throttling, which sends a retrying યુવક straight back into the same wall
  // unless it is named.
  if (text.includes('failed to fetch') || text.includes('networkerror')) {
    return 'નેટ બરાબર નથી. ફરી પ્રયત્ન કરો.';
  }
  if (e.status === 429) return 'ઘણી વાર પ્રયત્ન થયો. થોડી વાર પછી ફરી કરો.';
  return 'કંઈક ગડબડ થઈ. ફરી પ્રયત્ન કરો.';
}

/**
 * A PostgrestError → an Error a screen can render.
 *
 * The original is kept on `.cause` and the identifier on `.code`, because the console is
 * where whoever deployed this needs the truth — but nothing of it reaches the screen.
 */
function l4Error(e) {
  const text = errorText(e);
  const code = Object.keys(L4_ERRORS).find((c) => text.includes(c)) || e?.code || 'level4_failed';
  return Object.assign(new Error(e?.message || 'level4 rpc failed'), {
    code,
    gu: guLevel4Error(e),
    cause: e,
  });
}

/** The unconfigured build, and the signed-out call. Same calm sentence, never a throw site. */
const notReady = (gu = L4_PREPARING_GU) =>
  Object.assign(new Error('level4 unavailable'), { code: 'level4_not_published', gu });

// ---------------------------------------------------------------- payload shapes

/*
  Everything below reads the RPCs' jsonb defensively.

  `level4_published_config()` and `level4_state()` return `jsonb`, and jsonb has no schema
  the bundler can check: whether a key is `sceneIds` or `scene_ids`, whether the activities
  arrive beside the config or inside it, is decided in SQL. §2.3 fixes what the payload
  *means* and this file is written against that — the alternatives read here are spellings
  of the same fact, not guesses at different facts. The cost is a few lines; the thing it
  buys is that a `select … as scene_ids` does not blank the revision screen.
*/

const pick = (obj, ...keys) => {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
};

const str = (v) => (typeof v === 'string' ? v : '');
const arr = (v) => (Array.isArray(v) ? v : []);
const posInt = (v, fallback = 0) => (Number.isInteger(v) && v >= 0 ? v : fallback);
const ids = (v) => arr(v).filter((x) => typeof x === 'string' && x);

/**
 * An activity's items → an ordered array of scene ids.
 *
 * §26: the order is the સંચાલક's, stored as `level4_activity_items.position`, and the RPC
 * is specified to hand it back already ordered. Objects are still sorted by their own
 * position before being flattened — an `order by` that was written on the outer query and
 * not the inner aggregate is a real and quiet way for that promise to break.
 */
function itemIds(raw) {
  const list = arr(raw);
  if (!list.length) return [];
  if (typeof list[0] === 'string') return ids(list);
  return [...list]
    .sort((a, b) => posInt(pick(a, 'position'), 0) - posInt(pick(b, 'position'), 0))
    .map((it) => str(pick(it, 'sceneId', 'scene_id', 'id')))
    .filter(Boolean);
}

function normaliseActivity(raw) {
  const id = str(pick(raw, 'id', 'activityId', 'activity_id'));
  if (!id) return null;
  return {
    id,
    // The code is the સંચાલક's label ('4.1'), rendered and never branched on (rule 2).
    code: str(pick(raw, 'code')),
    title: str(pick(raw, 'title')),
    description: str(pick(raw, 'description')),
    position: posInt(pick(raw, 'position'), 0),
    sceneIds: itemIds(pick(raw, 'sceneIds', 'scene_ids', 'items')),
    /*
      How many of them must be recalled to pass (0016). The server sends it already clamped
      to what the કસોટી actually holds, so it is never larger than `sceneIds`.

      Falls back to "all of them" when absent, which is both the pre-0016 rule and the safe
      direction: a client talking to an older database would otherwise read `0` and offer
      'પૂરું કરો' before a single box was ticked, on a submission the server would refuse.
    */
    requiredCount: posInt(
      pick(raw, 'requiredCount', 'required_count'),
      itemIds(pick(raw, 'sceneIds', 'scene_ids', 'items')).length
    ),
  };
}

function normaliseConfig(raw) {
  if (!raw || typeof raw !== 'object') return null;
  // Tolerates both `{ config: {…}, activities: […] }` and a flat config carrying its own
  // `activities` — the two natural ways to build this jsonb.
  const c = raw.config && typeof raw.config === 'object' ? raw.config : raw;
  const id = str(pick(c, 'id', 'configId', 'config_id'));
  if (!id) return null;
  return {
    id,
    version: posInt(pick(c, 'version'), 0),
    title: str(pick(c, 'title')),
    // Default `true` (§2.1), so an absent key reproduces today's behaviour rather than
    // silently opening લેવલ ૪ to everyone.
    requireGate: pick(c, 'requireGate', 'require_gate') !== false,
    gateThreshold: posInt(pick(c, 'gateThreshold', 'gate_threshold'), DEFAULT_GATE_THRESHOLD),
  };
}

const configActivities = (raw) => {
  const c = raw?.config && typeof raw.config === 'object' ? raw.config : null;
  return arr(pick(raw, 'activities') ?? pick(c, 'activities'))
    .map(normaliseActivity)
    .filter(Boolean)
    // §1 rule 2 — ક્રમ કદી તૂટે નહીં. Sorted here as well as in SQL because the order the
    // cards appear in is the order the ladder is climbed in, and it is not a detail.
    .sort((a, b) => a.position - b.position);
};

/** `level4_state()`'s jsonb → what withStatuses() needs, and nothing more. */
function normaliseState(raw) {
  const out = { gateOpen: false, byActivity: new Map(), covered: new Set() };
  if (!raw || typeof raw !== 'object') return out;

  out.gateOpen = Boolean(pick(raw, 'gateOpen', 'gate_open'));
  for (const id of ids(pick(raw, 'coveredSceneIds', 'covered_scene_ids', 'covered'))) {
    out.covered.add(id);
  }

  for (const row of arr(pick(raw, 'activities', 'progress', 'statuses'))) {
    const id = str(pick(row, 'activityId', 'activity_id', 'id'));
    if (!id) continue;
    const status = str(pick(row, 'status')).toUpperCase();
    out.byActivity.set(id, {
      status: KNOWN_STATUS.has(status) ? status : null,
      attemptCount: posInt(pick(row, 'attemptCount', 'attempt_count'), 0),
      revisionCount: posInt(pick(row, 'revisionCount', 'revision_count'), 0),
      completedAt: pick(row, 'completedAt', 'completed_at') ?? null,
    });
  }

  return out;
}

/**
 * §2.2, mirrored — for the screen only.
 *
 * The server sends a status per activity and that status wins wherever it is present.
 * This exists for the gaps: "no row = not started" is the ordinary state for every
 * activity a યુવક has not reached yet, and a payload that lists only the rows that exist
 * would otherwise leave the cards with no status to render. The rule is evaluated in
 * exactly §2.2's order, including the two things that look like details and are not:
 *
 *   * **completion is asked first** (0012), ahead of the gate and ahead of ક્રમ. A કસોટી
 *     he has passed reads પૂરું થયું and stays open whatever happens afterwards — including
 *     the સંચાલક raising `gate_threshold` past where this યુવક stands, which would
 *     otherwise paint કસોટીઓ he finished in March with a તાળું he did nothing to earn.
 *     Everything he has *not* completed is still governed by the gate and still by ક્રમ,
 *     so this takes nothing away from the sequence — it only stops the sequence taking
 *     something back;
 *   * **coverage counts as completion** (decision #4) — a new version's activity whose
 *     દ્રશ્યો were all covered by activities the યુવક already passed is already done, and
 *     he is not asked to sit it again.
 *
 * Repetition needs no rule of its own here, and deliberately has none (0017). A COMPLETED
 * કસોટી is simply not LOCKED, so every screen that asks "may he open this?" already says yes,
 * as many times as he likes — `level4_submit` holds no attempt limit and 0012 removed the two
 * ways access could be withdrawn from underneath one. What a later attempt cannot do is
 * *lower* anything: a COMPLETED row is never demoted, so practising a કસોટી and ticking
 * eleven of twelve leaves it passed.
 *
 * `level4_submit` re-derives all of this server-side before it writes anything (§2.3
 * steps 1–3), so nothing here can grant access; it can only fail to *offer* it, which is
 * the safe direction.
 */
function withStatuses(activities, state) {
  let prefixComplete = true;

  return activities.map((a) => {
    const row = state.byActivity.get(a.id) || null;
    const covered = a.sceneIds.length > 0 && a.sceneIds.every((id) => state.covered.has(id));
    const completed = row?.status === S.COMPLETED || covered;

    let status;
    if (completed) status = S.COMPLETED;
    else if (!state.gateOpen) status = S.LOCKED;
    else if (!prefixComplete) status = S.LOCKED;
    else status = row?.status ?? S.AVAILABLE;

    // Read off completion, not off the displayed status: a closed gate paints the unfinished
    // કસોટીઓ LOCKED, and that must not make the ladder look unclimbed underneath.
    prefixComplete = prefixComplete && completed;

    return {
      ...a,
      status,
      attemptCount: row?.attemptCount ?? 0,
      revisionCount: row?.revisionCount ?? 0,
      completedAt: row?.completedAt ?? null,
    };
  });
}

const EMPTY = {
  loading: false,
  error: null,
  config: null,
  activities: [],
  gateOpen: false,
  gateThreshold: DEFAULT_GATE_THRESHOLD,
};

/**
 * What useLevel4Gate() reports before it knows, and whenever it cannot find out.
 *
 * `ready: false` is the load-bearing field — see that hook. The threshold beside it is the
 * shared default and exists only so a caller that reads it anyway gets a number rather
 * than undefined; it is not a claim about this project's gate.
 */
const EMPTY_GATE = {
  ready: false,
  published: false,
  gateOpen: false,
  requireGate: true,
  gateThreshold: DEFAULT_GATE_THRESHOLD,
};

// ---------------------------------------------------------------- the hooks

/**
 * The published લેવલ ૪ and this યુવક's place in it.
 *
 * Two RPCs, asked together: `level4_published_config()` for what exists and
 * `level4_state()` for where he stands. They are separate functions because they have
 * different lifetimes — the configuration is the same jsonb for all 2,000 યુવકો and the
 * state is his alone — and they are awaited together because a screen that shows the
 * cards before it knows which are open would show the wrong thing first and correct
 * itself, which on a Surat connection is a visible flicker of a wrong answer.
 *
 * `retry` is both the retry after a failure and the refresh after a submit: an attempt
 * changes a status, and the card list has to be re-read from the authority rather than
 * patched from the reply. Agent 4 calls it after `submitAttempt()` resolves.
 *
 * @returns {{ loading, error, retry, config, activities, gateOpen, gateThreshold, allComplete }}
 *   `error` is a Gujarati sentence or null. `config === null` with no error is the calm
 *   "not published yet" state, not a failure.
 *   `activities` is `[{ id, code, title, description, position, sceneIds, status,
 *   attemptCount, revisionCount, completedAt }]`, in ક્રમ order.
 */
export function useLevel4() {
  const { user } = useAuth();
  const uid = user?.id ?? null;

  const [data, setData] = useState({ ...EMPTY, loading: configured });
  // Bumped to re-ask. A counter rather than a boolean so two refreshes in a row both land.
  const [nonce, setNonce] = useState(0);
  const retry = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    // The guard lives inside the effect because hooks cannot be skipped — the same shape
    // useScenes() and useSettings() use. An unconfigured build shows the preparing line.
    if (!configured) {
      setData({ ...EMPTY });
      return;
    }

    let alive = true;
    setData((d) => ({ ...d, loading: true }));

    /*
      `level4_state()` takes no uid and never will (§2.3) — it reads auth.uid(). Asked
      only when there is a session, because with none it can only answer "nobody", and a
      signed-out visitor should still see that લેવલ ૪ exists rather than an error. The
      route is guarded anyway; this is the belt.
    */
    const wanted = [
      supabase.rpc('level4_published_config'),
      uid ? supabase.rpc('level4_state') : Promise.resolve({ data: null, error: null }),
    ];

    Promise.all(wanted)
      .then(([cfgRes, stateRes]) => {
        if (!alive) return;

        // Not published, or not migrated yet. Both are "લેવલ ૪ તૈયાર થઈ રહ્યું છે" and
        // neither is an error the યુવક can act on (§1 rule 4).
        if (cfgRes.error && !isMissingRpc(cfgRes.error)) {
          setData({ ...EMPTY, error: guLevel4Error(cfgRes.error) });
          return;
        }

        const config = cfgRes.error ? null : normaliseConfig(cfgRes.data);
        if (!config) {
          setData({ ...EMPTY });
          return;
        }

        /*
          A state read that failed is survivable and the config read is not, so they are
          treated differently. Without the state every activity derives as LOCKED — which
          is the honest answer when we do not know, and is exactly what the server would
          enforce on a submit anyway. The cards still render, with their titles and their
          counts, so the screen is never blank.
        */
        const state = normaliseState(stateRes?.error ? null : stateRes?.data);

        // §2.2: `require_gate = false` is the સંચાલક saying the ladder is open to everyone,
        // and then there is nothing to ask `progress` about.
        const gateOpen = config.requireGate ? state.gateOpen : true;

        const activities = withStatuses(configActivities(cfgRes.data), { ...state, gateOpen });

        setData({
          loading: false,
          error: null,
          config,
          activities,
          gateOpen,
          gateThreshold: config.gateThreshold,
        });
      })
      .catch((err) => {
        if (!alive) return;
        setData({ ...EMPTY, error: guLevel4Error(err) });
      });

    return () => {
      alive = false;
    };
  }, [uid, nonce]);

  return useMemo(
    () => ({
      ...data,
      retry,
      /*
        Every કસોટી done. Derived from the list, never from a count: LEVEL4.md rule 1
        forbids a total living anywhere but the collection, and an empty configuration is
        not "all complete" — it is nothing to do yet.
      */
      allComplete:
        data.activities.length > 0 && data.activities.every((a) => a.status === S.COMPLETED),
    }),
    [data, retry]
  );
}

/**
 * Just the gate — for the two screens that must *mention* લેવલ ૪ without rendering it.
 *
 * મુખપૃષ્ઠ and લેવલ ૩ both say what opens લેવલ ૪, and both used to say **૮૦**, because that
 * is the literal in `LEVEL4_UNLOCK_THRESHOLD` and in 0008's `level4_unlock_threshold()`.
 * Since LEVEL4.md decision #3 that number is the સંચાલક's: `gate_threshold` on the published
 * configuration, which he may set to ૭૫, to ૫૦, or to anything else — and the promise
 * printed on those two screens has to be the promise the database actually keeps. A યુવક
 * told "૮૦ પૂરાં કરો" who finds લેવલ ૪ already open at ૫૦ has been told the wrong thing;
 * one told ૮૦ when the real gate is ૧૦૦ has been told a worse one.
 *
 * One RPC, not `useLevel4()`'s two: neither screen draws a કસોટી card, so
 * `level4_published_config()`'s activity list is bytes neither of them will read — and
 * મુખપૃષ્ઠ is where a યુવક lands on a Surat connection (§14).
 *
 * `ready` is the thing to render against, not `!loading`: while the answer is in flight
 * there is no honest threshold to print, so the callers print nothing rather than a number
 * they would have to take back. Nothing is granted here either way — `level4_submit`
 * re-checks the gate server-side on every attempt (§37).
 *
 * @returns {{ ready, published, gateOpen, requireGate, gateThreshold }}
 *   `published` false = no configuration is live yet, so there is no gate to describe.
 */
export function useLevel4Gate() {
  const { user } = useAuth();
  const uid = user?.id ?? null;
  const [gate, setGate] = useState(EMPTY_GATE);

  useEffect(() => {
    if (!configured || !uid) {
      setGate(EMPTY_GATE);
      return;
    }

    let alive = true;

    supabase
      .rpc('level4_state')
      .then(({ data, error }) => {
        if (!alive) return;
        // An unreadable gate is not an error a યુવક can act on and is never shown as one
        // (§1 rule 4). It stays `ready: false`, so the invitation line is simply absent and
        // the tile behaves exactly as it does before the answer arrives.
        if (error || !data || typeof data !== 'object') {
          setGate(EMPTY_GATE);
          return;
        }
        const requireGate = pick(data, 'requireGate', 'require_gate');
        setGate({
          ready: true,
          published: true,
          gateOpen: Boolean(pick(data, 'gateOpen', 'gate_open')),
          // Absent means required: a configuration that does not say is the default one,
          // and defaulting to "open to everyone" would be the unsafe direction to guess in.
          requireGate: requireGate === undefined || requireGate === null ? true : Boolean(requireGate),
          gateThreshold: posInt(
            pick(data, 'gateThreshold', 'gate_threshold'),
            DEFAULT_GATE_THRESHOLD
          ),
        });
      })
      .catch(() => {
        if (alive) setGate(EMPTY_GATE);
      });

    return () => {
      alive = false;
    };
  }, [uid]);

  return gate;
}

/**
 * One activity, with the actual દર્શન behind it.
 *
 * The activity's `sceneIds` are stable ids (§21) and carry no content — the content comes
 * from `useScenes()`, which is the effective collection with the સંચાલક's overlay and both
 * gates applied. That indirection is the whole reason a re-encoded image or a reworded
 * વર્ણન cannot invalidate a configuration.
 *
 * A id `useScenes()` does not return is **dropped, not rendered as a hole**: it is a દ્રશ્ય
 * the સંચાલક has since withheld or emptied, and `inOrder()` in src/lib/scenes.js makes the
 * same choice for the same reason.
 *
 * That drop used to be able to strand a યુવક — he would tick everything on screen and still
 * not pass, because `level4_submit` counted an item he could no longer see. It cannot any
 * more: `level4_effective_items()` (0010) is now the single reader of an activity's
 * contents, and it applies the same withheld test this screen does, so `required`, the
 * `sceneIds` the કસોટી numbers, and the દ્રશ્યો rendered here are one list. The one
 * divergence left is deliberate and narrow — the database cannot see `isLearnable`
 * (a master image and a વર્ણન, which live in content/darshan.json), so a દ્રશ્ય that is
 * published but has no વર્ણન would still be required while `useScenes()` withholds it.
 * The લેવલ ૪ builder refuses to publish that configuration in the first place
 * (`unpublished-scene`, shared/domain/level4-selection.js).
 *
 * @returns {{ loading, error, activity, scenes, status, canOpen, retry }}
 *   `scenes` are full દર્શન entries `{ id, n, order, t, url, fullUrl, … }` in the
 *   configured order (§26). **The કસોટી screen must read only `id` and `n` off them**
 *   (rule 3) — the answer is not on that screen.
 */
export function useLevel4Activity(activityId) {
  const { loading: l4Loading, error, activities, retry } = useLevel4();
  const { scenes: collection, loading: scenesLoading } = useScenes();

  const activity = useMemo(
    () => activities.find((a) => a.id === activityId) ?? null,
    [activities, activityId]
  );

  const scenes = useMemo(() => {
    if (!activity) return [];
    const byId = new Map(collection.map((s) => [s.id, s]));
    return activity.sceneIds.map((id) => byId.get(id)).filter(Boolean);
  }, [activity, collection]);

  const status = activity?.status ?? null;

  return {
    loading: l4Loading || scenesLoading,
    error,
    activity,
    scenes,
    status,
    /*
      What the screen may offer. The server refuses a locked activity regardless (§2.3
      steps 1–3), but offering something that will be refused is its own small unkindness.

      The gate is **not** asked again here, and that is the correction 0012 makes. It is
      already inside `status`: withStatuses() paints an unfinished કસોટી LOCKED when the gate
      is shut, and leaves a completed one COMPLETED. Asking `gateOpen` a second time on top
      of that undid the second half — a યુવક whose gate had closed behind him (the સંચાલક
      raised `gate_threshold`) could see પૂરું થયું on the card and find the દર્શન behind it
      shut. One question, answered in one place.
    */
    canOpen: Boolean(activity) && status !== S.LOCKED,
    /*
      Whether the કસોટી may be *sat*, as opposed to merely opened.

      Since 0017 these are the same question again: there is no attempt limit, so anything
      that can be opened can be answered. It is kept as a separate field because the two are
      genuinely different questions — 0016 held them apart for an afternoon — and a caller
      that means "may he submit" should say so rather than lean on them coinciding.
    */
    canAttempt: Boolean(activity) && status !== S.LOCKED,
    retry,
  };
}

// ---------------------------------------------------------------- the two writes

/**
 * The attempt (§2.3) — the only way one comes into existence.
 *
 * The selection is de-duplicated and cleaned here purely so the request is well formed;
 * it is **not** validated. `level4_submit` intersects it with the activity's own items
 * (`selected := distinct(p_selected) ∩ required`) and decides `passed` from the sizes, so
 * a client that sent every id in the collection would still not pass an activity it had
 * not covered. There is no correctness comparison anywhere on this side — rule 4: pass is
 * every required item checked, and nothing is ever marked wrong.
 *
 * @returns {{ passed, selectedCount, requiredCount, status, attemptCount, nextActivityId }}
 * @throws  an Error carrying `.gu` (a Gujarati sentence) and `.code`. Never a raw
 *          Postgres message — `guError()` in src/lib/auth.jsx reads `.gu` first, so the
 *          ordinary `catch (e) { setMsg(guError(e)) }` already does the right thing.
 */
export async function submitAttempt(activityId, selectedSceneIds) {
  if (!configured) throw notReady();
  if (!activityId) throw notReady();

  const selected = [...new Set(ids(selectedSceneIds))];

  const { data, error } = await supabase.rpc('level4_submit', {
    p_activity_id: activityId,
    p_selected: selected,
  });
  if (error) throw l4Error(error);

  const d = data && typeof data === 'object' ? data : {};
  return {
    passed: Boolean(pick(d, 'passed')),
    selectedCount: posInt(pick(d, 'selectedCount', 'selected_count'), 0),
    requiredCount: posInt(pick(d, 'requiredCount', 'required_count'), 0),
    itemCount: posInt(pick(d, 'itemCount', 'item_count'), 0),
    // The server's word for where he now stands. REVISION_REQUIRED is not a failure and is
    // never rendered as one (§1 rule 4) — it is the invitation to go and look again.
    status: KNOWN_STATUS.has(str(pick(d, 'status')).toUpperCase())
      ? str(pick(d, 'status')).toUpperCase()
      : null,
    attemptCount: posInt(pick(d, 'attemptCount', 'attempt_count'), 0),
    // Null when this was the last one, or when the next is not his yet. The screen offers
    // it as a next step; it does not assume it exists.
    nextActivityId: str(pick(d, 'nextActivityId', 'next_activity_id')) || null,
  };
}

/**
 * `revision_count + 1` — he went and looked (§18, §22).
 *
 * A count, not a permission: nothing anywhere reads it to decide what a યુવક may do, and
 * §17's revision screen is reachable whether or not this call succeeds. RevisionPage
 * therefore navigates on regardless of what this returns — a failed count must never be
 * the reason someone cannot go back to the કસોટી.
 *
 * @returns {{ status, revisionCount }} the RPC's own result, normalised.
 */
export async function markRevision(activityId) {
  if (!configured) throw notReady();
  if (!activityId) throw notReady();

  const { data, error } = await supabase.rpc('level4_mark_revision', {
    p_activity_id: activityId,
  });
  if (error) throw l4Error(error);

  const d = data && typeof data === 'object' ? data : {};
  const status = str(pick(d, 'status')).toUpperCase();
  return {
    status: KNOWN_STATUS.has(status) ? status : null,
    revisionCount: posInt(pick(d, 'revisionCount', 'revision_count'), 0),
  };
}
