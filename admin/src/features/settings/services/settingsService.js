import { supabase } from '../../../lib/supabase';
import {
  APP_SETTINGS_DOC,
  LEVELS_SETTINGS_DOC,
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

export async function getLevels() {
  // Through the same resolver the યુવક app uses, not a looser check of its own.
  //
  // `Array.isArray(stored) && stored.length` accepts a list that resolveLevels would
  // reject — a missing levelId, an entry that is not an object, an order that collides —
  // and the panel would then render that damaged list as if it were in force while yુવકો
  // silently fell back to the defaults. The two would disagree with nothing on screen to
  // say so. One resolver means what the સંચાલક sees is what a યુવક gets.
  const stored = (await readSetting(LEVELS_SETTINGS_DOC))?.levels;
  return resolveLevels(stored);
}

export const updateLevels = (levels) => writeSetting(LEVELS_SETTINGS_DOC, { levels });
