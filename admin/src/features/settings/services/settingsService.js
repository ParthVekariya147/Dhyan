import { supabase } from '../../../lib/supabase';
import {
  APP_SETTINGS_DOC,
  LEVEL4_GATE_KEY,
  LEVELS_SETTINGS_DOC,
  resolveLevel4Gate,
  resolveLevels,
} from '../../../../../shared/domain/settings.js';
/* Point values share the `levels` row - they are a property of the ladder, not of a viewing
   surface, and 0014's argument for moving the લેવલ ૪ gate here applies to them unchanged. */
import { POINTS_KEY } from '../../../../../shared/domain/points.js';
import { LEADERBOARD_KEY } from '../../../../../shared/domain/leaderboard.js';
/* The two switches behind "આજે તમે શું કર્યું?" — in the `levels` row for the same reason the
   point values are: it is a property of the ladder a યુવક is reporting on, not of a surface. */
import {
  DAILY_PROMPT_KEY,
  resolveDailyPrompt,
} from '../../../../../shared/domain/daily-prompt.js';

/**
 * §34 — controlled configuration instead of settings scattered through source files.
 *
 * `settings` is a key/jsonb table, and the keys are unchanged from the Firestore document
 * ids ('app', 'levels'). src/lib/useSettings.js reads the same 'app' row on every yuvak
 * visit; renaming it would break a working read path to gain nothing (§43).
 */

async function readSetting(key) {
  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('key', key)
    .maybeSingle();
  if (error) throw error;
  return data?.value ?? {};
}

/**
 * Merge, never replace. The યુવક app reads youtubeUrl from this same row, so writing the
 * whole object from the settings page would silently drop a field the video page owns.
 *
 * The merge happens here rather than in SQL because the caller already holds the current
 * value; jsonb_set per key would be a round trip per field for no gain.
 */
async function writeSetting(key, patch) {
  const current = await readSetting(key);
  const { error } = await supabase
    .from('settings')
    .upsert(
      { key, value: { ...current, ...patch }, updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    );
  if (error) throw error;
}

export const getAppSettings = () => readSetting(APP_SETTINGS_DOC);
export const updateAppSettings = (patch) => writeSetting(APP_SETTINGS_DOC, patch);

/**
 * The whole of what the Levels page configures: the list, and what opens લેવલ ૪.
 *
 * One read rather than two, because they are one row — and one *write*, further down, for a
 * reason that matters more: the `audit_settings` trigger (0004) records a settings write, so
 * saving the list and the gate separately would put two entries in the log for one press of
 * one button, and a reader of the audit trail would see an edit that never happened.
 *
 * Both halves go through the same resolvers the યુવક app uses, never a looser check of this
 * panel's own. `Array.isArray(stored) && stored.length` would accept a list resolveLevels()
 * rejects — a missing levelId, an entry that is not an object, an order that collides — and
 * the panel would then render that damaged list as in force while યુવકો silently fell back
 * to the defaults, with nothing on screen to say the two disagreed.
 */
export async function getLevelsConfig() {
  const stored = await readSetting(LEVELS_SETTINGS_DOC);
  return {
    levels: resolveLevels(stored?.levels),
    gate: resolveLevel4Gate(stored?.[LEVEL4_GATE_KEY]),
    /*
      The third thing in this row, and the one that is handed back **raw**.

      `levels` and `gate` are resolved here because their callers render them and a screen must
      never be handed a value it has to make sense of itself. `points` is different: PointsCard
      is the only caller, and it needs the *stored* slice rather than the resolved one to
      answer a question the resolver has thrown away — "has anybody ever configured this?".
      resolvePoints() maps an absent key and a deliberate all-zeroes to the same object, and
      the card offers to pre-fill the brief's ૧૦૦/૨૦૦/૩૦૦ only in the first case. Resolving it
      here would make a સંચાલક who had deliberately set every level to zero be offered a
      pre-fill that undid it.

      It resolves the slice itself, through the same shared resolvePoints() the server mirrors,
      so nothing about that rule is duplicated — only the decision about emptiness is local,
      and it is a question about the row rather than about the values in it.
    */
    points: stored?.[POINTS_KEY],
    // Raw for the same reason `points` is: LeaderboardCard has to tell "never configured"
    // from "deliberately switched off", and resolveLeaderboard() maps both to `enabled: false`.
    leaderboard: stored?.[LEADERBOARD_KEY],
    /*
      Resolved, unlike the two above, and the difference is the question each card has to
      answer. `points` and `leaderboard` both need to tell "never configured" from "deliberately
      switched off", because each offers a pre-fill in the first case only. This one has no such
      offer to make: its default is ON, so an absent key and an explicit `{enabled: true,
      autoOpen: true}` mean exactly the same thing to every screen and to the app, and handing
      the card a raw value would give it a distinction with nothing behind it.
    */
    dailyPrompt: resolveDailyPrompt(stored?.[DAILY_PROMPT_KEY]),
  };
}

/** Just the list — kept for callers that do not touch the gate. */
export async function getLevels() {
  return (await getLevelsConfig()).levels;
}

/**
 * Both halves, in one write.
 *
 * `writeSetting` merges rather than replaces, so this cannot drop a field belonging to
 * something else in the same row — but it is still passed both keys together, because the
 * gate and the list are saved by one button and one confirmation.
 */
export const updateLevelsConfig = ({ levels, gate }) =>
  writeSetting(LEVELS_SETTINGS_DOC, { levels, [LEVEL4_GATE_KEY]: gate });

export const updateLevels = (levels) => writeSetting(LEVELS_SETTINGS_DOC, { levels });

/**
 * Whether ક્રમાંક asks a યુવક about today, and whether it asks by opening.
 *
 * Through `writeSetting`, which MERGES rather than replaces, so saving these two booleans
 * cannot drop `levels`, `points`, `leaderboard` or the લેવલ ૪ gate sharing the same row. The
 * database refuses a malformed pair regardless — `settings_check_daily_prompt()` (0049) mirrors
 * `validateDailyPrompt()` message for message, because a disabled control is not a rule.
 */
export const updateDailyPrompt = (dailyPrompt) =>
  writeSetting(LEVELS_SETTINGS_DOC, { [DAILY_PROMPT_KEY]: dailyPrompt });
