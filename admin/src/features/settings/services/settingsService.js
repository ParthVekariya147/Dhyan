import { supabase } from '../../../lib/supabase';
import {
  APP_SETTINGS_DOC,
  LEVEL4_GATE_KEY,
  LEVELS_SETTINGS_DOC,
  resolveLevel4Gate,
  resolveLevels,
} from '../../../../../shared/domain/settings.js';

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
