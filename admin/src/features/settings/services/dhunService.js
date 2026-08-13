import { supabase } from '../../../lib/supabase';
import { updateAppSettings } from './settingsService';

/**
 * §8 — the two ધૂન: uploading the bytes, and recording which two they are.
 *
 * Two stores, one operation. The MP3 goes into the `dhun` bucket
 * (supabase/migrations/0007_dhun_storage.sql); the name and the resulting URL go into the
 * `dhun` field of the settings['app'] row that 0001_init.sql:263 seeded as `[]` and that
 * nothing has written until now. The યુવક app reads that same row on every visit
 * (src/lib/useSettings.js), so a save here changes what 2,000 phones play — without a
 * redeploy, which is the entire point of §8.
 *
 * Both halves are guarded by the same predicate, `has_permission('settings.update')`:
 * the RLS policy on `settings` (0004_rbac.sql:649) and the storage policy on the bucket.
 * Nothing in this file is a security boundary — it is where the boundary becomes visible.
 */

export const DHUN_BUCKET = 'dhun';

/** §8: "exactly two". Not a soft cap — the panel offers two slots and no more. */
export const MAX_DHUN = 2;

/**
 * Must stay in step with `file_size_limit` on the bucket in 0007_dhun_storage.sql.
 * Checked here first so the સંચાલક is told before the upload starts rather than after
 * 8 MB have crawled up a phone connection and been refused.
 */
export const MAX_DHUN_BYTES = 8 * 1024 * 1024;

/**
 * Every upload is stored and served as audio/mpeg regardless of what the OS reported.
 * Windows says `audio/mp3` and some Linux browsers say nothing at all for the same file,
 * and the bucket allows exactly one mime type — normalising here is what keeps a valid
 * MP3 from being refused for the name its OS happens to give it. The type is also what
 * the bucket will serve it back as, so it can never be rendered as a page.
 */
const DHUN_MIME = 'audio/mpeg';

/**
 * A name the સંચાલક typed, not a filename. §8 says the dhun are "uploaded **and named**"
 * by him, because the યુવક picks between them by name — "શ્રીજી ધૂન", not "track2_final.mp3".
 */
const MAX_NAME = 60;

export function validateDhunName(input) {
  const s = String(input || '').trim();
  if (!s) return { ok: false, msg: 'Give the dhun a name - the yuvak chooses between the two by name.' };
  if (s.length > MAX_NAME) return { ok: false, msg: `The name is too long (at most ${MAX_NAME} characters).` };
  return { ok: true, name: s };
}

export function validateDhunFile(file) {
  if (!file) return { ok: false, msg: 'Choose an MP3 file.' };
  // `type` is empty for some browser/OS combinations, so the extension is the fallback
  // rather than the rule. The bucket enforces the real limit either way.
  const looksMp3 = /^audio\/(mpeg|mp3|mpeg3|x-mpeg-3)$/i.test(file.type || '') || /\.mp3$/i.test(file.name || '');
  if (!looksMp3) return { ok: false, msg: 'Only MP3 files can be used for the dhun.' };
  if (file.size > MAX_DHUN_BYTES) {
    return {
      ok: false,
      msg: `This file is ${(file.size / 1048576).toFixed(1)} MB. Keep the dhun under ${MAX_DHUN_BYTES / 1048576} MB - most yuvaks are on mobile data.`,
    };
  }
  if (!file.size) return { ok: false, msg: 'This file is empty.' };
  return { ok: true };
}

/**
 * What the app will accept as a usable dhun. A half-written entry — a name with no URL,
 * an object that failed to upload — is dropped rather than shown, because the યુવક app's
 * own reader (src/lib/dhun.js) applies the same rule and a slot it silently ignores would
 * otherwise sit in the panel looking configured.
 */
export function normalizeDhunList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((d) => d && typeof d === 'object' && String(d.url || '').trim() && String(d.name || '').trim())
    .slice(0, MAX_DHUN)
    .map((d) => ({
      id: String(d.id || d.path || d.url),
      name: String(d.name).trim(),
      url: String(d.url).trim(),
      path: d.path ? String(d.path) : null,
      size: Number.isFinite(d.size) ? d.size : null,
      updatedAt: d.updatedAt || null,
    }));
}

/**
 * Uploads the bytes and hands back the entry to record.
 *
 * The object name carries a timestamp and is never reused, which buys two things: the URL
 * can be cached for a year (a yuvak who opens the app daily downloads the dhun once, not
 * once a day — the §14 slow-network argument), and replacing a track can never be served
 * stale from a CDN that is still holding the old bytes under the same name.
 */
export async function uploadDhunFile(slot, file) {
  const path = `dhun-${slot}-${Date.now().toString(36)}.mp3`;

  const { error } = await supabase.storage.from(DHUN_BUCKET).upload(path, file, {
    contentType: DHUN_MIME,
    // Immutable name → immutable bytes → a year is safe. See above.
    cacheControl: '31536000',
    // Never overwrite. If this name somehow existed, the upload should fail loudly rather
    // than silently replace a dhun that is currently playing for 2,000 people.
    upsert: false,
  });
  if (error) throw error;

  const { data } = supabase.storage.from(DHUN_BUCKET).getPublicUrl(path);
  return { path, url: data.publicUrl, size: file.size };
}

/**
 * Best effort, and deliberately so. The old object is rubbish the moment the settings row
 * stops pointing at it; failing the whole save because 3 MB could not be swept up would
 * turn a successful change into a reported failure. What is left behind costs a few MB in
 * a bucket capped at 8 MB per object.
 */
export async function removeDhunObject(path) {
  if (!path) return;
  try {
    await supabase.storage.from(DHUN_BUCKET).remove([path]);
  } catch {
    /* ignore — see above */
  }
}

/**
 * Writes the list back. Merge-only through settingsService, so the youtubeUrl the Video
 * page owns in the same row is not dropped by a dhun save (settingsService.js:33 makes
 * the same argument in the other direction).
 *
 * Audited by the `audit_settings` trigger (0004_rbac.sql:460) as SETTINGS_UPDATED, with
 * the before/after value — so the trail names the dhun that was replaced, not just that
 * something changed.
 */
export async function saveDhunList(list) {
  await updateAppSettings({ dhun: normalizeDhunList(list) });
}
