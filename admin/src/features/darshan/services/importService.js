import { supabase } from '../../../lib/supabase';
import { listDarshan, saveScene } from './darshanService';
import { indexDriveFiles, readSheet, toSheetRows, buildImportPlan, writableEntries } from '../../../../../shared/domain/sheet-import.js';
import { DEFAULT_DRIVE_FOLDER_ID } from '../../../../../shared/domain/drive.js';

/**
 * The writing half of the bulk import (§12) — the half that touches the network.
 *
 * Everything that *decides* anything lives in shared/domain/sheet-import.js, which is pure
 * and tested by `npm test`. This file only does the three things that cannot be pure:
 * ask the server which files are in the Drive folder, hand each planned patch to
 * `saveScene`, and keep count while it happens.
 *
 * There is no second write path here on purpose. `saveScene` upserts the row, and the
 * `scenes_sync_status` and `audit_scene` triggers fire inside that same statement — so an
 * import is 109 ordinary, individually audited edits by the સંચાલક who pressed the button,
 * indistinguishable in the log from the same edits made one at a time on the detail page.
 * A bulk endpoint that wrote them all in one statement would be one audit row for a hundred
 * changes, which is the trail §41 asks for turned into a summary of itself.
 */

/**
 * The folder-listing endpoint.
 *
 * Called at its real path rather than through a short `/api/…` alias, because netlify.toml
 * — where those aliases are declared — is not this feature's to edit. Nothing is lost: the
 * alias exists so a function can be renamed without touching the client, and this path is
 * what Netlify serves either way.
 */
const LIST_FN = '/.netlify/functions/list-drive-folder';

/**
 * The folder the સંચાલક named in પેનલ → સેટિંગ્સ, or the default if he never has.
 *
 * Read here rather than passed down from the page, so every caller resolves it the same way
 * and a folder set once is in force everywhere. An unreadable settings row falls back to the
 * default instead of failing: the import is still useful against the folder the collection
 * actually lives in, and refusing to list anything because one row would not load is the
 * dead end §1 forbids.
 */
export async function configuredDriveFolderId() {
  try {
    const { data } = await supabase.from('settings').select('value').eq('key', 'app').maybeSingle();
    const id = data?.value?.driveFolderId;
    return typeof id === 'string' && id.trim() ? id.trim() : DEFAULT_DRIVE_FOLDER_ID;
  } catch {
    return DEFAULT_DRIVE_FOLDER_ID;
  }
}

/**
 * The Drive folder, as `{ files: [{id, name}] }`.
 *
 * A browser cannot fetch drive.google.com at all (no CORS header on any Drive endpoint), so
 * this is not an optimisation — it is the only way the filename in the ફોટો ફાઈલ column can
 * become a file id.
 */
export async function listDriveFolder(folderId) {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error('Your session has expired. Log in again and retry.');

  let res;
  try {
    res = await fetch(LIST_FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(folderId ? { folderId } : {}),
    });
  } catch {
    throw new Error('Network problem while reaching the server. Please try again.');
  }

  // Under `vite dev` there is no function server and the SPA fallback answers every unknown
  // path with index.html and status **200** — so `res.ok` is true and `res.json()` throws a
  // syntax error about an unexpected `<`. The publish path learned this the hard way; the
  // content type is what tells the two apart before anything tries to parse it.
  const type = res.headers.get('content-type') || '';
  if (!type.includes('application/json')) {
    throw new Error(
      res.status === 404 || res.status === 200
        ? 'The Drive listing service is not running. It only exists on the deployed site — locally, run `netlify dev` instead of `npm run dev:admin`.'
        : `The Drive listing service replied unexpectedly (${res.status}).`
    );
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.gu || `The Drive listing service refused the request (${res.status}).`);
  if (!Array.isArray(body.files) || !body.files.length) {
    throw new Error('The Drive folder listing came back empty.');
  }
  return body.files;
}

/**
 * Pasted text + the live collection (+ optionally the Drive folder) → the plan to preview.
 *
 * Re-run from scratch on every change the સંચાલક makes to the mapping or the two switches,
 * because a plan built from a stale mapping is exactly the thing the preview is there to
 * prevent. It is 109 rows of string comparison; there is nothing to memoise.
 *
 * `mapping` is what the panel's three selects hold. It overrides detection rather than
 * replacing it: detection seeds those selects, and if detection found nothing the selects
 * start empty and the સંચાલક points at the columns himself.
 */
export function planFromText(text, { items, driveFiles, mapping, headerRow, applyCaptions = true, applyImages = true } = {}) {
  const sheet = readSheet(text);
  const columns = mapping || sheet.columns;
  // `headerRow` is the same kind of override as `mapping`: detection seeds it, and the
  // સંચાલક can say "the first row is a header after all" (or "it is not") when a paste
  // without a recognisable header would otherwise lose its first દ્રશ્ય or gain a junk row.
  const hr = headerRow === undefined || headerRow === null ? sheet.headerRow : headerRow;
  const rows = toSheetRows(sheet.rows, hr, columns);
  const driveIndex = driveFiles?.length ? indexDriveFiles(driveFiles) : null;
  const plan = buildImportPlan({ rows, items: items || [], driveIndex, applyCaptions, applyImages });
  return { sheet, columns, headerRow: hr, rows, ...plan };
}

/** The collection as it is right now — read once, immediately before the preview is built. */
export const loadCollection = () => listDarshan();

/**
 * Carry out the plan, one દ્રશ્ય at a time, reporting as it goes.
 *
 * Sequential rather than parallel. 109 upserts take about half a minute, which is slow
 * enough to need a progress bar and fast enough not to need a queue — and a serial run is
 * the only one whose progress count is honest and whose failures are attributable in order.
 *
 * **One bad row must not stop the rest.** A single દ્રશ્ય rejected by RLS, or one caption
 * that trips a constraint, would otherwise abandon the remaining hundred halfway through
 * and leave the collection in a state nobody chose. So every failure is caught, recorded
 * against its id and the loop continues; the caller reports all of them together at the end.
 *
 * @param {Array} entries        the full plan — only `status: 'update'` rows are written
 * @param {(p: {done: number, total: number, id: string}) => void} [onProgress]
 * @returns {Promise<{ok: Array, failed: Array, total: number}>}
 */
export async function applyImportPlan(entries, onProgress) {
  const todo = writableEntries(entries);
  const ok = [];
  const failed = [];

  for (let i = 0; i < todo.length; i++) {
    const e = todo[i];
    try {
      await saveScene(e.id, e.patch);
      ok.push({ id: e.id, patch: e.patch });
    } catch (err) {
      // The raw PostgREST message is kept here rather than passed through saveError(): this
      // is a per-row line in a report the સંચાલક will forward to whoever built the panel,
      // and "there was a problem" repeated eleven times names nothing.
      failed.push({ id: e.id, line: e.line, message: err?.message || String(err) });
    }
    onProgress?.({ done: i + 1, total: todo.length, id: e.id });
  }

  return { ok, failed, total: todo.length };
}
