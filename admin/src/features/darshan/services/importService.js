import { supabase } from '../../../lib/supabase';
import { listDarshan, saveScene } from './darshanService';
import {
  DEFAULT_CONFLICT_CHOICE,
  DEFAULT_IMPORT_MODE,
  attachDriveImages,
  attachDriveReferences,
  countPlan,
  indexDriveFiles,
  inspectRows,
  isCancelled,
  planResolutions,
  readSheet,
  toSheetRows,
  withCreateDefaults,
  writablePlanEntries,
} from '../../../../../shared/domain/sheet-import.js';
import { buildExcelPlan } from '../../../../../shared/domain/darshan-excel.js';
import { readXlsx } from '../../../../../shared/domain/xlsx-read.js';
import { DEFAULT_DRIVE_FOLDER_ID } from '../../../../../shared/domain/drive.js';

/**
 * The writing half of the bulk import (§12) — the half that touches the network.
 *
 * Everything that *decides* anything lives in three pure modules, all covered by `npm test`:
 *
 *   shared/domain/darshan-excel.js   the eight columns, the three modes, the duplicate rule
 *   shared/domain/sheet-import.js    delimited text, the Drive folder match, the images
 *   shared/domain/xlsx-read.js       a workbook's first worksheet, as cells
 *
 * This file only does the four things that cannot be pure: read the file the સંચાલક chose,
 * ask the server which files are in the Drive folder, hand each planned patch to `saveScene`,
 * and keep count while it happens.
 *
 * There is no second write path here on purpose. `saveScene` upserts the row, and the
 * `scenes_sync_status` and `audit_scene` triggers fire inside that same statement — so an
 * import is N ordinary, individually audited edits by the સંચાલક who pressed the button,
 * indistinguishable in the log from the same edits made one at a time on the detail page.
 * A bulk endpoint that wrote them all in one statement would be one audit row for a hundred
 * changes, which is the trail §41 asks for turned into a summary of itself. It would also
 * lose the property that makes a half-failed import recoverable: every row that succeeded
 * stays succeeded, so importing the same file again retries only what is still outstanding.
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

// ==================================================================== reading the file

/** The two bytes every ZIP — and therefore every `.xlsx` — begins with. */
const ZIP_MAGIC = 'PK';

/**
 * Whatever the સંચાલક chose → a grid of cells, or a sentence telling him what to do instead.
 *
 * Three formats arrive here and only one of them is text:
 *
 *   `.xlsx`         a ZIP of XML. `readXlsx` unpacks it in the browser with
 *                   `DecompressionStream`, which is why no dependency was needed and why the
 *                   call is async — there is no synchronous inflate in a browser.
 *   `.csv` / `.tsv` text, parsed by `readSheet` with the delimiter detected rather than asked.
 *   `.xls`          the pre-2007 binary format, which is a different thing entirely and is
 *                   refused with the two steps that fix it, rather than parsed into nonsense.
 *
 * The `.xlsx`-renamed-to-`.csv` case is checked for explicitly. It happens — a સંચાલક told
 * "save as CSV" renames the file instead — and without the check the ZIP's bytes read as a
 * few hundred lines of mojibake, produce a plausible-looking "no columns recognised" screen,
 * and give him nothing to act on.
 *
 * @param {File} file
 * @returns {Promise<{kind: 'xlsx'|'text', rows: string[][]|null, text: string, name: string}>}
 */
export async function readImportFile(file) {
  const name = file?.name || 'the file';

  if (/\.xls$/i.test(name)) {
    throw new Error(
      `“${name}” is the old Excel format (.xls). Open it in Excel and use File → Save As → ` +
      '“Excel Workbook (.xlsx)” or “CSV UTF-8”, then choose it here.'
    );
  }

  const isXlsx = /\.xlsx$/i.test(name) || String(file?.type || '').includes('spreadsheetml');
  if (isXlsx) {
    const rows = await readXlsx(await file.arrayBuffer());
    return { kind: 'xlsx', rows, text: '', name };
  }

  const text = await file.text();
  if (text.startsWith(ZIP_MAGIC)) {
    throw new Error(
      `“${name}” is an Excel workbook that has been renamed rather than saved as text. ` +
      'Rename it back to .xlsx and choose it again — workbooks are read directly now.'
    );
  }
  return { kind: 'text', rows: null, text, name };
}

// ==================================================================== the plan

/**
 * Text or cells + the live collection → the plan to preview.
 *
 * Rebuilt from scratch on every change the સંચાલક makes — to the mapping, the mode, the Drive
 * folder or a duplicate's answer. A plan carried over from a previous mapping is precisely the
 * stale artefact the preview exists to rule out, and it is a few hundred rows of string
 * comparison; there is nothing here worth caching against the risk of showing one file's
 * numbers over another file's data.
 *
 * The order of the four passes is load-bearing:
 *
 *   1. `buildExcelPlan`         the eight columns, the mode, the duplicates, the errors.
 *   2. `withCreateDefaults`     a new દ્રશ્ય with no Status starts DRAFT, as `createScene` does.
 *   3. `attachDriveReferences`  the Drive id/URL columns → drive_id + source_drive_url +
 *                               image_url, derived only through `resolveImageInput`.
 *   4. `attachDriveImages`      the ફોટો ફાઈલ column → the same three, by way of the folder
 *                               listing. Skipped for any row that already named its file by
 *                               id or URL, so the two never disagree.
 *
 * Counts are taken after all four, because 3 and 4 can turn a row the planner called "no
 * change" into a change — a દ્રશ્ય whose વર્ણન is already right but whose artwork has moved.
 *
 * @param {object} args
 * @param {string} [args.text]  a paste, or the contents of a .csv/.tsv
 * @param {string[][]} [args.rows] cells, when the file was a workbook
 * @param {Array}  args.items   the collection as it is right now
 * @param {object} [args.mapping]  the સંચાલક's column overrides; null ⇒ what detection found
 * @param {number} [args.headerRow] his header-row override; undefined ⇒ what detection found
 * @param {string} [args.mode]   CREATE_ONLY | UPDATE_ONLY | UPSERT
 * @param {Array}  [args.driveFiles] from listDriveFolder(); null when the folder is unread
 * @param {object} [args.conflictChoices] `{ [rowNumber]: 'skip'|'update'|'cancel' }`
 * @param {string} [args.conflictFallback] the "apply to all remaining" answer
 */
export function planFromSheet({
  text = '',
  rows = null,
  items = [],
  mapping = null,
  headerRow,
  mode = DEFAULT_IMPORT_MODE,
  driveFiles = null,
  conflictChoices = {},
  conflictFallback = DEFAULT_CONFLICT_CHOICE,
} = {}) {
  // A workbook has no delimiter to detect and nothing to parse; everything after that point
  // — find the header, map the columns, measure the table — is identical work, which is why
  // both routes converge on `inspectRows`.
  const sheet = rows
    ? { delimiter: '', delimiterLabel: 'an Excel workbook', ...inspectRows(rows) }
    : readSheet(text);

  const columns = mapping || sheet.columns;
  // `headerRow` is the same kind of override as `mapping`: detection seeds it, and the
  // સંચાલક can say "the first row is a header after all" (or "it is not") when a file
  // without a recognisable header would otherwise lose its first દ્રશ્ય or gain a junk row.
  const hr = headerRow === undefined || headerRow === null ? sheet.headerRow : headerRow;

  const records = toSheetRows(sheet.rows, hr, columns);
  const byId = new Map(items.map((i) => [i.id, i]));

  const plan = buildExcelPlan({
    rows: sheet.rows,
    headerRow: hr,
    columns,
    existing: items,
    mode,
    resolutions: planResolutions(conflictChoices),
    defaultResolution: conflictFallback === 'update' ? 'update' : 'skip',
  });

  let entries = withCreateDefaults(plan.entries);
  entries = attachDriveReferences({ entries, records, byId, mode });
  const driveIndex = driveFiles?.length ? indexDriveFiles(driveFiles) : null;
  entries = attachDriveImages({ entries, records, driveIndex, byId, mode });

  return {
    sheet,
    columns,
    headerRow: hr,
    records,
    entries,
    counts: countPlan(entries),
    mode,
    /** §7's third button. Answered here rather than by the planner — see `isCancelled`. */
    cancelled: isCancelled(conflictChoices, conflictFallback),
    /** True when a mapped ફોટો ફાઈલ column is waiting on the folder listing. */
    needsDriveFolder: !driveIndex && records.some((r) => r.file && !r.driveId && !r.driveUrl),
  };
}

/** The collection as it is right now — read once, immediately before the preview is built. */
export const loadCollection = () => listDarshan();

// ==================================================================== the write

/**
 * Carry out the plan, one દ્રશ્ય at a time, reporting as it goes.
 *
 * Sequential rather than parallel. A hundred upserts take about half a minute, which is slow
 * enough to need a progress bar and fast enough not to need a queue — and a serial run is
 * the only one whose progress count is honest and whose failures are attributable in order.
 *
 * **One bad row must not stop the rest.** A single દ્રશ્ય rejected by RLS, or one caption
 * that trips a constraint, would otherwise abandon the remaining hundred halfway through
 * and leave the collection in a state nobody chose. So every failure is caught, recorded
 * against its id and the loop continues; the caller reports all of them together at the end.
 *
 * Creating and updating are the same statement here, and that is not a shortcut. `saveScene`
 * upserts on the primary key, so a row whose id is not yet in `scenes` is inserted with the
 * columns this patch names and no others — which is exactly what a create is. The triggers
 * fire either way, so a દ્રશ્ય created by an import is audited identically to one added from
 * the list page, and RLS still applies `darshan.create` or `darshan.update` per row.
 *
 * @param {Array} entries        the full plan — only writable rows are touched
 * @param {(p: {done: number, total: number, id: string}) => void} [onProgress]
 * @returns {Promise<{ok: Array, failed: Array, total: number, created: number, updated: number}>}
 */
export async function applyImportPlan(entries, onProgress) {
  const todo = writablePlanEntries(entries);
  const ok = [];
  const failed = [];
  let created = 0;
  let updated = 0;

  for (let i = 0; i < todo.length; i++) {
    const e = todo[i];
    try {
      await saveScene(e.id, e.patch);
      ok.push({ id: e.id, patch: e.patch, action: e.action || 'update' });
      if (e.action === 'create') created++;
      else updated++;
    } catch (err) {
      // The raw PostgREST message is kept here rather than passed through saveError(): this
      // is a per-row line in a report the સંચાલક will forward to whoever built the panel,
      // and "there was a problem" repeated eleven times names nothing.
      failed.push({ id: e.id, row: e.rowNumber ?? e.line, message: err?.message || String(err) });
    }
    onProgress?.({ done: i + 1, total: todo.length, id: e.id });
  }

  return { ok, failed, total: todo.length, created, updated };
}
