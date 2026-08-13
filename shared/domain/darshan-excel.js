/**
 * દર્શન ⇄ spreadsheet — the column contract, and what an import *would* do.
 *
 * Why this is a separate module
 * ----------------------------
 * `shared/domain/sheet-import.js` already reads the સંચાલક's Google Sheet: ક્રમ, ફોટો ફાઈલ,
 * વર્ણન — the three columns that sheet has always had, matched against a Drive folder. It is
 * a *paste* pipeline for the master sheet, and it is deliberately conservative: it never
 * creates a દ્રશ્ય, never touches status, and treats an empty cell as "no change".
 *
 * This is the other direction. The panel now exports the collection as a file, the સંચાલક
 * edits it in Excel — including the new `title`, the `status` and the presentation order —
 * and uploads it back. That round trip needs things the paste pipeline does not have and
 * should not grow:
 *
 *   - a **stable join key**. The paste pipeline joins on ક્રમ, which is exactly the column a
 *     સંચાલક renumbers; renumbering 27 → 28 in a sheet joined on ક્રમ silently retargets the
 *     row at a different દ્રશ્ય. `Item ID` is the join key here (DARSHAN_DATA_CONTRACT §1)
 *     and it never changes, so a renumber is a renumber and not a reassignment.
 *   - **creating**, under an explicit mode the operator picks and has the permission for.
 *   - **status**, which the paste pipeline has no column for.
 *   - **duplicate handling that asks** rather than picking a winner (EXCEL_CONTRACT §7).
 *
 * Nothing here writes. Every function is a value → value transform; `buildExcelPlan` returns
 * a *plan* that the panel renders as a table of current-vs-new, and only an explicit confirm
 * turns it into calls to `saveScene` / `createScene`. That split is the whole reason the
 * mandatory preview (EXCEL_CONTRACT §5) is possible at all: the plan is a value, so it can
 * be shown before anybody commits to it.
 *
 * Two rules that shape everything below
 * -------------------------------------
 *  1. **Columns are found by name, never by position** — the rule `sheet-import.js` states
 *     and the reason it states it: a wrong guess writes the વર્ણન column into `image_url` on
 *     every દ્રશ્ય at once, and there is no undo for that beyond a second import. A column
 *     that matches nothing is ignored, not guessed at.
 *
 *  2. **The round trip must be lossless** (EXCEL_CONTRACT §3). Gujarati is passed through
 *     byte for byte — no NFC pass, no ઈ→ઇ folding, no trimming of `title`/`caption` — because
 *     every one of those is a change the સંચાલક did not ask for, applied to 109 rows, that
 *     no screen would show him. The structural columns (id, ક્રમ, ક્રમાંક, status, Drive
 *     reference) *are* trimmed, because whitespace around a database identifier is never
 *     content.
 *
 * Pure. No DOM, no fetch, no supabase, no React — the same constraint every module in
 * `shared/domain/` is held to, so both apps and `npm test` can use it unchanged.
 */
import { darshanId } from './darshan.js';
import { isDriveId, parseDriveLink } from './drive.js';

// ==================================================================== the five statuses

/**
 * `scenes.status`, exactly as 0004_rbac.sql constrains it.
 *
 * Repeated here rather than imported because there is nowhere to import it from: the
 * constraint lives in SQL and `src/lib/useScenes.js` keeps only the *visible* subset
 * (`PUBLISHED`, `ACTIVE`). Repeating it is safe in the one direction that matters — a value
 * outside this list is rejected before it reaches the database, so a drift shows up as an
 * import error and never as a constraint violation halfway through applying 109 rows.
 *
 * Import may set a status. Import may not invent one (DARSHAN_DATA_CONTRACT §4).
 */
export const SCENE_STATUSES = ['DRAFT', 'VALIDATED', 'PUBLISHED', 'ACTIVE', 'DISABLED'];

/** EXCEL_CONTRACT §4. `UPSERT` is the default because it is what "import my sheet" means. */
export const IMPORT_MODES = {
  CREATE_ONLY: 'CREATE_ONLY',
  UPDATE_ONLY: 'UPDATE_ONLY',
  UPSERT: 'UPSERT',
};

/**
 * §7's two per-row answers. "Cancel the import" is deliberately absent: cancelling is not a
 * property of a row, it is the operator declining to apply the plan at all, and modelling it
 * here would invite a caller to apply a plan that contains a row saying "cancel".
 */
export const CONFLICT_RESOLUTIONS = { SKIP: 'skip', UPDATE: 'update' };

// ==================================================================== small helpers

/** Gujarati digits — the ક્રમ column is allowed to be written in them (sheet-import.js). */
const GU_DIGITS = '૦૧૨૩૪૫૬૭૮૯';

/**
 * The four characters Excel reads as "this cell is a formula", as `admin/src/lib/export.js`
 * lists them. Kept in step with that file by hand; the round-trip test is what catches drift.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * Undo the export's formula guard.
 *
 * `csvCell()` writes `'=SUM(A1)` for a cell reading `=SUM(A1)`, because Excel evaluates the
 * unguarded version and quoting does not stop it. Reading that cell back must therefore drop
 * the apostrophe, or the round trip turns a વર્ણન into a *different* વર્ણન one character
 * longer — an edit nobody made, on whichever rows happened to start with the wrong character.
 *
 * Only an apostrophe standing in front of one of those four characters is removed. An
 * apostrophe in front of ordinary text is content and stays.
 */
const unfreeze = (s) => (s.startsWith("'") && FORMULA_START.test(s.slice(1)) ? s.slice(1) : s);

const str = (v) => (v === null || v === undefined ? '' : String(v));

/** A positive integer for display, or '' — `index` and `order` are both nullable (0004). */
const intCell = (v) => (Number.isInteger(v) && v > 0 ? String(v) : '');

/**
 * A cell → the positive integer it names, or null. **Strict**, unlike `toNumber()` in
 * sheet-import.js.
 *
 * That function strips every non-digit, so `-3` reads as 3 and `3.5` as 35. For a pasted
 * sheet full of `૧.` and `1)` that tolerance is right. Here it is wrong: EXCEL_CONTRACT §6
 * makes "not a positive integer" a row-blocking **error**, and a validator that quietly
 * turned `-3` into 3 would report no error and write a number the સંચાલક never typed.
 *
 * Gujarati digits are still accepted — `૮૮` and `88` are the same ક્રમ — and a trailing
 * `.0` is tolerated because some writers render an integer cell that way. Nothing else is.
 */
function toPositiveInteger(raw) {
  const s = str(raw).trim();
  if (!s) return null;
  let out = '';
  for (const ch of s) {
    const gu = GU_DIGITS.indexOf(ch);
    out += gu >= 0 ? String(gu) : ch;
  }
  if (!/^\d+(\.0+)?$/.test(out)) return null;
  const n = Math.trunc(Number(out));
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * The Drive "share" link for a file id — the URL a person recognises and can click.
 *
 * Not `driveImageUrl()`: that is the lh3 CDN URL an `<img>` renders, which is the right
 * thing in a page and the wrong thing in a spreadsheet, where the column exists so the
 * સંચાલક can open the file in Drive and check he has the right artwork.
 */
export const driveFileUrl = (id) => (id ? `https://drive.google.com/file/d/${id}/view` : '');

// ==================================================================== the columns

/**
 * EXCEL_CONTRACT §1, as data.
 *
 * `en` and `gu` are the headers the export writes and the template offers; `names` and
 * `guNames` are everything else a real file has been seen to call the same column, matched
 * whole-cell. `loose` is the second chance — a regular expression tried only for columns
 * that nothing matched exactly, so a hand-made sheet still lands without letting a fuzzy
 * pattern out-bid an exact header.
 *
 * `importable: false` marks the four export-only columns. They are listed here rather than
 * left out for a reason that is easy to miss: `Production Image URL` contains the word URL
 * and `Display Number` contains the word Display, so if detection did not know about them
 * they would be claimed by `Google Drive URL` and `Display Order` respectively — an import
 * that wrote the derived display number into the presentation order of every દ્રશ્ય. Being
 * named is what makes them safely ignorable.
 *
 * `required` means "a row that *creates* a દ્રશ્ય cannot do without it". Only the ક્રમ
 * qualifies: a new દ્રશ્ય with no number has no id to be created under and no place in the
 * sequence. Everything else, `title` included, may be filled in later — a missing title is
 * reported and never enforced (DARSHAN_DATA_CONTRACT §2.1).
 *
 * Both spellings of ફાઈલ/ફાઇલ and આઈડી/આઇડી are listed rather than normalised away, for
 * sheet-import.js's reason: folding Gujarati vowel signs is a much bigger claim than this
 * needs to make.
 */
export const EXCEL_COLUMNS = [
  {
    key: 'id',
    en: 'Item ID',
    gu: 'આઈડી',
    importable: true,
    required: false,
    names: ['item id', 'id', 'itemid', 'item_id', 'darshan id', 'scene id', 'દ્રશ્ય આઈડી', 'દ્રશ્ય આઇડી'],
    guNames: ['આઈડી', 'આઇડી', 'ઓળખ'],
    loose: /^\s*(item|scene|darshan|દ્રશ્ય)?\s*(id|આઈડી|આઇડી)\s*$/i,
    value: (item) => str(item.id),
  },
  {
    key: 'index',
    en: 'Index Number',
    gu: 'ક્રમ',
    importable: true,
    required: true,
    names: [
      'index number', 'index', 'index no', 'number', 'n', 'no', 'no.', 'nr', 'sr', 'sr no',
      'srno', 's.no', 's.no.', '#', 'idx', 'seq', 'sequence',
    ],
    guNames: ['ક્રમ', 'ક્રમ નંબર', 'નંબર'],
    // `^ક્રમ(\s|$)` and not a prefix match: `ક્રમાંક` (the presentation order) also begins
    // with ક્રમ, and mistaking the two swaps the printed number for the sort position.
    loose: /^\s*(index|number)\b|^\s*(n|no\.?|nr|sr\.?|s\.?\s?no\.?|#|idx|seq)\s*$|^ક્રમ(\s|$)|નંબર/i,
    value: (item) => intCell(item.index),
  },
  {
    key: 'title',
    en: 'Title',
    gu: 'શીર્ષક',
    importable: true,
    required: false,
    names: ['title', 'heading', 'શીર્ષક'],
    guNames: ['શીર્ષક', 'મથાળું', 'નામ'],
    loose: /^\s*(title|heading)\s*$|શીર્ષક|મથાળ/i,
    value: (item) => str(item.title),
  },
  {
    key: 'caption',
    en: 'Description',
    gu: 'વર્ણન',
    importable: true,
    required: false,
    // `caption` IS the description (DARSHAN_DATA_CONTRACT §3) — one field, two names, and
    // no third spelling anywhere in the domain.
    names: ['description', 'caption', 'desc', 'desc.', 'text', 'details', 'detail'],
    guNames: ['વર્ણન', 'દ્રશ્ય-વર્ણન', 'દ્રશ્ય વર્ણન', 'દૃશ્ય-વર્ણન', 'લખાણ'],
    loose: /વર્ણન|દ્રશ્ય|દૃશ્ય|લખાણ|^\s*(description|caption|desc\.?|text|details?)\s*$/i,
    value: (item) => str(item.caption),
  },
  {
    key: 'driveId',
    en: 'Google Drive File ID',
    gu: 'ડ્રાઈવ ફાઈલ આઈડી',
    importable: true,
    required: false,
    names: ['google drive file id', 'drive file id', 'file id', 'driveid', 'drive id'],
    guNames: ['ડ્રાઈવ ફાઈલ આઈડી', 'ડ્રાઇવ ફાઇલ આઇડી', 'ડ્રાઈવ આઈડી', 'ડ્રાઇવ આઇડી'],
    loose: /(drive|ડ્રાઈવ|ડ્રાઇવ)[^]*(file\s*)?(id|આઈડી|આઇડી)|^\s*file\s*id\s*$/i,
    value: (item) => str(item.driveId),
  },
  {
    key: 'driveUrl',
    en: 'Google Drive URL',
    gu: 'ડ્રાઈવ લિંક',
    importable: true,
    required: false,
    names: ['google drive url', 'drive url', 'drive link', 'google drive link', 'url', 'link'],
    guNames: ['ડ્રાઈવ લિંક', 'ડ્રાઇવ લિંક', 'લિંક'],
    loose: /(drive|ડ્રાઈવ|ડ્રાઇવ)[^]*(url|link|લિંક)|^\s*(url|link|લિંક)\s*$/i,
    // Derived, not stored: the id is the record and the URL is a convenience for a person
    // who wants to open the file. Import extracts the id back out of it (§1).
    value: (item) => driveFileUrl(str(item.driveId)),
  },
  {
    key: 'order',
    en: 'Display Order',
    gu: 'ક્રમાંક',
    importable: true,
    required: false,
    names: ['display order', 'order', 'position', 'sort order', 'sort'],
    guNames: ['ક્રમાંક', 'ગોઠવણી'],
    loose: /^\s*(display\s*)?(order|position|sort)\s*$|^ક્રમાંક|ગોઠવણ/i,
    value: (item) => intCell(item.order),
  },
  {
    key: 'status',
    en: 'Status',
    gu: 'સ્થિતિ',
    importable: true,
    required: false,
    names: ['status', 'state'],
    guNames: ['સ્થિતિ', 'દરજ્જો'],
    loose: /^\s*(status|state)\s*$|સ્થિતિ|દરજ્જ/i,
    // Only one of the five ever leaves this module. An item carrying something else — or
    // nothing, which is the ordinary case before A's migration lands — exports blank, and a
    // blank status cell means "leave it alone" rather than "set it to nothing".
    value: (item) => (SCENE_STATUSES.includes(item.status) ? item.status : ''),
  },

  // ---------------------------------------------------------------- export-only (§1)
  {
    key: 'imageUrl',
    en: 'Production Image URL',
    gu: 'ચિત્ર લિંક',
    importable: false,
    required: false,
    names: ['production image url', 'image url', 'image link', 'imageurl'],
    guNames: ['ચિત્ર લિંક', 'છબી લિંક'],
    loose: /production|પ્રકાશિત|^\s*image\s*(url|link)\s*$|ચિત્ર\s*લિંક/i,
    value: (item) => str(item.imageUrl),
  },
  {
    key: 'displayIndex',
    en: 'Display Number',
    gu: 'દર્શાવેલ ક્રમ',
    importable: false,
    required: false,
    // Derived by withDisplayIndex(), stored nowhere, and **never importable**
    // (DARSHAN_DATA_CONTRACT §1). It is exported because it is the number a યુવક actually
    // sees, which is the number the સંચાલક is talking about when he reports a problem.
    names: ['display number', 'display no', 'display index', 'displayindex'],
    guNames: ['દર્શાવેલ ક્રમ', 'દેખાતો ક્રમ'],
    loose: /display\s*(number|no\.?|index)|દર્શાવેલ|દેખાતો/i,
    value: (item) => intCell(item.displayIndex),
  },
  {
    key: 'file',
    en: 'Image File',
    gu: 'ફોટો ફાઈલ',
    importable: false,
    required: false,
    names: ['image file', 'file name', 'filename', 'file', 'photo', 'image'],
    guNames: ['ફોટો ફાઈલ', 'ફોટો ફાઇલ', 'ફોટો', 'ફાઈલ', 'ફાઇલ'],
    loose: /^\s*(image\s*file|file\s*name|filename|file|photo|image)\s*$|ફોટો|^ફાઈલ|^ફાઇલ/i,
    value: (item) => str(item.file),
  },
  {
    key: 'updatedAt',
    en: 'Updated At',
    gu: 'છેલ્લે સુધાર્યું',
    importable: false,
    required: false,
    names: ['updated at', 'updated', 'modified', 'last updated', 'updatedat'],
    guNames: ['છેલ્લે સુધાર્યું', 'સુધાર્યું'],
    loose: /^\s*(updated(\s*at)?|modified|last\s*updated)\s*$|સુધાર/i,
    value: (item) => str(item.updatedAt),
  },
];

/** The eight a file may set. The template and every "which columns matter" message use it. */
export const IMPORTABLE_COLUMNS = EXCEL_COLUMNS.filter((c) => c.importable);

/** The patch fields, in the order they are reported. `driveUrl` resolves into `driveId`. */
const PATCH_FIELDS = ['index', 'title', 'caption', 'driveId', 'order', 'status'];

// ==================================================================== header detection

/**
 * One header cell → every label it could reasonably be read as.
 *
 * A real header cell is not always one label. The template this module produces writes
 * `Index Number (ક્રમ)` so that a સંચાલક reading Gujarati and a colleague reading English
 * see the same sheet; somebody else writes `Order / ક્રમાંક`. Splitting on the separators
 * people actually use, and trying each part, is what lets both land on the same column
 * without a regular expression that would also match half the row.
 *
 * The leading apostrophe is stripped for `unfreeze`'s reason, and a trailing `*` because
 * marking a column as required with a star is a thing people do to their own sheets.
 */
function headerLabels(cell) {
  const raw = str(cell).replace(/^\uFEFF/, '').trim().replace(/^'/, '').replace(/\*+$/, '').trim();
  if (!raw) return [];
  const out = new Set([raw]);
  for (const part of raw.split(/[/|·—–]+/)) {
    const p = part.trim();
    if (p) out.add(p);
  }
  const paren = raw.match(/^([^(]*)\(([^)]*)\)\s*$/);
  if (paren) {
    const before = paren[1].trim();
    const inside = paren[2].trim();
    if (before) out.add(before);
    if (inside) out.add(inside);
  }
  return [...out];
}

/** English is case- and spacing-insensitive; Gujarati has no case and is compared as typed. */
const enNorm = (label) => label.toLowerCase().replace(/[_\s]+/g, ' ').trim();

const matchesExactly = (labels, col) =>
  labels.some((label) => col.guNames.includes(label) || col.names.includes(enNorm(label)) || enNorm(label) === enNorm(col.en));

const matchesLoosely = (labels, col) => labels.some((label) => col.loose.test(label));

/**
 * A header row → `{ [key]: colIndex | null }` for all twelve columns.
 *
 * Two passes, and the order is the whole design. Pass one takes only exact whole-cell
 * matches, so a file whose headers this module wrote — or whose headers anyone wrote in
 * either language — maps with no interpretation at all. Pass two runs the loose patterns
 * over what is left, which is where a hand-made sheet gets its tolerance.
 *
 * A cell can be claimed once. Without that, `ડ્રાઈવ ફાઈલ આઈડી` would be claimed by both the
 * Drive id column and the file-name column, and whichever ran second would end up pointing
 * at a cell that means something else. A role that matches nothing stays `null` and the
 * planner simply never touches that field — EXCEL_CONTRACT §1: a column that matches nothing
 * is ignored, not guessed at.
 */
export function detectDarshanColumns(headerCells = []) {
  const out = {};
  for (const col of EXCEL_COLUMNS) out[col.key] = null;

  const cells = Array.isArray(headerCells) ? headerCells : [];
  const labels = cells.map(headerLabels);
  const taken = new Set();

  for (const test of [matchesExactly, matchesLoosely]) {
    for (const col of EXCEL_COLUMNS) {
      if (out[col.key] !== null) continue;
      for (let c = 0; c < labels.length; c++) {
        if (taken.has(c) || !labels[c].length) continue;
        if (test(labels[c], col)) {
          out[col.key] = c;
          taken.add(c);
          break;
        }
      }
    }
  }
  return out;
}

/** How much of a header row this looks like — counted over importable columns only. */
const headerScore = (cols) => IMPORTABLE_COLUMNS.filter((c) => cols[c.key] !== null).length;

/**
 * Find the header row, tolerating whatever sits above it.
 *
 * Not "row 0": the live sheet carries a merged title banner over its header, an Excel export
 * may carry any amount of preamble, and `scripts/lib/spreadsheet.mjs` and
 * `shared/domain/sheet-import.js` both make this same judgement for the same reason.
 *
 * Two columns is the bar, as in sheet-import.js. One is too low — a data row whose વર્ણન
 * contains the word દ્રશ્ય scores 1, and promoting it to header would silently drop the real
 * first દ્રશ્ય. Three is too high for a legitimate two-column file (Item ID + Title, to fill
 * in the titles and nothing else).
 *
 * @returns {{ headerRow: number, columns: object }} `headerRow` is -1 when nothing convincing
 *   was found, and the panel then asks the સંચાલક to point at the columns himself.
 */
export function findExcelHeaderRow(rows = []) {
  const limit = Math.min(rows.length, 25);
  let best = { headerRow: -1, columns: detectDarshanColumns([]), score: 0 };
  for (let r = 0; r < limit; r++) {
    const columns = detectDarshanColumns(rows[r]);
    const score = headerScore(columns);
    // Strictly greater, so the first convincing row wins a tie — a banner repeated below the
    // real header is not promoted over it.
    if (score > best.score) best = { headerRow: r, columns, score };
  }
  return best.score >= 2 ? { headerRow: best.headerRow, columns: best.columns } : { headerRow: -1, columns: detectDarshanColumns([]) };
}

// ==================================================================== rows ⇄ items

/**
 * One DarshanItem → one row of cells, in EXCEL_COLUMNS order.
 *
 * Strings, not values: this is the row an encoder turns into CSV. It does **no** escaping
 * and no BOM — that is `admin/src/lib/export.js`'s job and reimplementing either of its two
 * traps here is exactly the duplication EXCEL_CONTRACT §2 warns against.
 *
 * @param {import('./types.js').DarshanItem} item
 * @returns {string[]}
 */
export function itemToRow(item = {}) {
  return EXCEL_COLUMNS.map((col) => col.value(item));
}

/** The header row an export writes — every column, in order. */
export const excelHeaderRow = () => EXCEL_COLUMNS.map((col) => col.en);

/**
 * One row of cells + a column mapping → the fields it asks to set.
 *
 * This is a *literal* reading of the row. It does not know what exists, what mode is in
 * force or whether anything would actually change; it reports what the row says and what is
 * wrong with it. `buildExcelPlan` is what decides consequences.
 *
 * The empty-cell rule, which differs by field on purpose:
 *
 *   - `title` and `caption` come back as `''` when the column is present and the cell is
 *     empty. An empty string is a value here, not an absence (EXCEL_CONTRACT §3) — the
 *     planner is the one that decides an empty વર્ણન means "not written yet" rather than
 *     "blank this દ્રશ્ય", which is the convention `shared/domain/darshan.js` has always used.
 *   - every other field is simply **absent** when its cell is empty. There is no meaningful
 *     empty ક્રમ, order, status or Drive id; a blank one means the સંચાલક left that column
 *     alone, and inventing a value for it is how an import erases things nobody asked it to.
 *
 * @param {string[]} cells    one row
 * @param {object}   columns  from detectDarshanColumns(), possibly corrected by the operator
 * @returns {{ id?: string, index?: number, title?: string, caption?: string, driveId?: string,
 *            order?: number, status?: string, issues: Array<{severity:string,field:string,message:string}> }}
 */
export function rowToPatch(cells = [], columns = {}) {
  const issues = [];
  const patch = { issues };
  const fail = (field, message) => issues.push({ severity: 'error', field, message });
  const warn = (field, message) => issues.push({ severity: 'warning', field, message });

  /** The cell for a column, or undefined when the file has no such column at all. */
  const cellOf = (key) => {
    const c = columns?.[key];
    if (!Number.isInteger(c) || c < 0) return undefined;
    // Gujarati is preserved exactly here — no trim, no normalisation. Only the CR that a
    // Windows line ending leaves inside a quoted field is dropped, because it is an artefact
    // of the file format and never something a person typed.
    return unfreeze(str(cells?.[c]).replace(/\r\n?/g, '\n'));
  };

  const id = cellOf('id');
  if (id !== undefined && id.trim()) patch.id = id.trim();

  // ---------------------------------------------------------------- ક્રમ and ક્રમાંક
  for (const [key, label] of [['index', 'Index Number (ક્રમ)'], ['order', 'Display Order (ક્રમાંક)']]) {
    const raw = cellOf(key);
    if (raw === undefined || !raw.trim()) continue;
    const n = toPositiveInteger(raw);
    if (n === null) fail(key, `${label} must be a positive whole number - “${raw.trim()}” is not.`);
    else patch[key] = n;
  }

  // ---------------------------------------------------------------- the text
  const title = cellOf('title');
  if (title !== undefined) patch.title = title;
  const caption = cellOf('caption');
  if (caption !== undefined) patch.caption = caption;

  // ---------------------------------------------------------------- the Drive reference
  //
  // Two columns naming one file. §1 settles the disagreement in advance — the id wins —
  // because the id is what the database stores and the URL is a rendering of it; a URL that
  // has drifted from the id is a stale copy of the same fact, not a second fact.
  const driveIdCell = cellOf('driveId');
  const driveUrlCell = cellOf('driveUrl');
  let fromId = '';
  let fromUrl = '';

  if (driveIdCell !== undefined && driveIdCell.trim()) {
    const raw = driveIdCell.trim();
    // A whole Drive URL pasted into the id column is the commonest way this goes wrong, and
    // it is unambiguous, so it is read rather than refused.
    const parsed = parseDriveLink(raw);
    if (isDriveId(raw)) fromId = raw;
    else if (parsed.ok) fromId = parsed.id;
    else fail('driveId', `“${raw}” is not a Google Drive file id. ${parsed.gu}`);
  }

  if (driveUrlCell !== undefined && driveUrlCell.trim()) {
    const raw = driveUrlCell.trim();
    const parsed = parseDriveLink(raw);
    if (parsed.ok) fromUrl = parsed.id;
    else fail('driveUrl', `${parsed.gu} (“${raw}”)`);
  }

  if (fromId && fromUrl && fromId !== fromUrl) {
    warn('driveUrl', `The Drive file id and the Drive link name different files - the id (${fromId}) was used.`);
  }
  if (fromId || fromUrl) patch.driveId = fromId || fromUrl;

  // ---------------------------------------------------------------- status
  const status = cellOf('status');
  if (status !== undefined && status.trim()) {
    const upper = status.trim().toUpperCase();
    if (SCENE_STATUSES.includes(upper)) patch.status = upper;
    else fail('status', `“${status.trim()}” is not a status. Use one of: ${SCENE_STATUSES.join(', ')}.`);
  }

  return patch;
}

// ==================================================================== the plan

/** The item's current value for a patch field, in the same shape the patch carries. */
function currentValue(item, field) {
  if (!item) return undefined;
  if (field === 'index' || field === 'order') return Number.isInteger(item[field]) ? item[field] : null;
  if (field === 'status') return SCENE_STATUSES.includes(item.status) ? item.status : '';
  return str(item[field]);
}

/**
 * §57, §29 — what *would* happen, as a value, before anything happens.
 *
 * An import touches the whole collection at once, and a mass overwrite that nobody previewed
 * is the one failure this screen exists to prevent: a mis-mapped column or a stale file would
 * replace every વર્ણન with the wrong text, and the audit trail would faithfully record a
 * hundred deliberate-looking edits. So the plan is computed, rendered as current-vs-new, and
 * only then carried out.
 *
 * The decisions encoded here, each of which is a decision and not a detail:
 *
 *  - **The join key depends on the sheet's shape (§3a).** When the file has an `Item ID`
 *    column, that is the key: a filled cell names a દ્રશ્ય, a blank one means a new દ્રશ્ય, and
 *    a ક્રમ that belongs to somebody else is the §7 conflict the operator answers rather than
 *    a silent update. When the file has **no `Item ID` column at all**, the key is the
 *    `Index Number`, and a row whose number matches an existing દ્રશ્ય is an ordinary update.
 *
 *    That second rule is not a convenience, it is the whole workflow. The સંચાલક's live sheet
 *    has three columns — ક્રમ, ફોટો ફાઈલ, દ્રશ્ય-વર્ણન — and no id anywhere in it. Under the
 *    first rule alone every one of its rows was a new દ્રશ્ય colliding with an existing ક્રમ,
 *    every collision defaulted to Skip, and importing the organisation's own sheet applied
 *    nothing at all: ten edited rows, ten conflicts, zero writes. A feature that cannot read
 *    the file it was built to read is not conservative, it is broken.
 *
 *    The trade §3a accepts in exchange: renumber ક્રમ in a sheet with no id column and that
 *    row now updates a different દ્રશ્ય. What makes it safe enough to be the default is the
 *    mandatory preview — every field that would change is on screen, named, before anything
 *    is written. The absence of an id column is also the absence of any *other* answer: there
 *    is nothing else in such a file that identifies a row.
 *
 *    The trigger is the **column** being unmapped, never an individual blank cell. A sheet
 *    that has the column and leaves it blank is saying "this દ્રશ્ય is new"; a sheet without
 *    the column is not saying anything about identity at all, and those are different claims.
 *
 *  - **A row that changes nothing is `skip`, not `update`.** It is what makes
 *    EXCEL_CONTRACT §3's round trip observable: export → import must report zero changes.
 *    Writing them anyway would fire `audit_scene()` once per row and bury the edits that
 *    matter under a hundred that edited nothing (§41).
 *
 *  - **An empty `title`/`caption` cell means "no change", never "blank it."**
 *    `shared/domain/darshan.js` already treats `caption: ''` as *absent* rather than as an
 *    override, because the column is `not null default ''` and every row the સંચાલક has ever
 *    toggled carries one. Clearing a વર્ણન stays a deliberate single-દ્રશ્ય act on the detail
 *    page. It is reported as a warning so the row is still visible in the preview.
 *
 *  - **A duplicate is never resolved by this function.** It attaches a `conflict` and
 *    defaults to skipping; the operator's answer comes back in `resolutions` and the plan is
 *    rebuilt. Nothing is written until the whole plan is confirmed (§7).
 *
 * The patch deliberately carries no `imageUrl`. `driveId` is the record; the URL an `<img>`
 * renders is derived from it by `driveImageUrl()` at the moment of writing, so there is one
 * place that derivation happens and an imported દ્રશ્ય renders exactly like a built one.
 *
 * @param {object}   args
 * @param {string[][]} args.rows     the whole grid, header and banner included
 * @param {number}   args.headerRow  index of the header row; -1 ⇒ the data starts at row 0
 * @param {object}   args.columns    from detectDarshanColumns(); omitted ⇒ detected here.
 *   Whether `columns.id` is mapped is what picks the join key (§3a), so a caller that lets the
 *   operator correct the mapping by hand changes the join key by unmapping that column — which
 *   is the right behaviour and worth knowing about.
 * @param {Array}    args.existing   DarshanItem[] — the collection as it is right now
 * @param {string}   args.mode       one of IMPORT_MODES; anything else is read as UPSERT
 * @param {object}   [args.resolutions] `{ [rowNumber]: 'skip' | 'update' }` — §7's answers.
 *   Additive to EXCEL_CONTRACT §9's five arguments, and the reason is that without it §7's
 *   three buttons have nowhere to send the operator's choice; omitting it changes nothing.
 * @param {string}   [args.defaultResolution] the answer for rows he has not answered. 'skip'.
 */
export function buildExcelPlan({
  rows = [],
  headerRow = -1,
  columns = null,
  existing = [],
  mode = IMPORT_MODES.UPSERT,
  resolutions = {},
  defaultResolution = CONFLICT_RESOLUTIONS.SKIP,
} = {}) {
  const grid = Array.isArray(rows) ? rows : [];
  const start = Number.isInteger(headerRow) && headerRow >= 0 ? headerRow + 1 : 0;
  const cols = columns && typeof columns === 'object' ? columns : detectDarshanColumns(grid[Math.max(0, start - 1)] ?? []);

  // An unrecognised mode is read as UPSERT rather than thrown at the operator: the panel
  // offers three buttons and cannot produce a fourth, so a bad value here is a programming
  // slip, and defaulting to the mode the buttons default to keeps the preview showing.
  const importMode = Object.values(IMPORT_MODES).includes(mode) ? mode : IMPORT_MODES.UPSERT;
  const canCreate = importMode !== IMPORT_MODES.UPDATE_ONLY;
  const canUpdate = importMode !== IMPORT_MODES.CREATE_ONLY;

  /**
   * §3a — the join key, decided once for the whole file.
   *
   * Once, and not per row, because it is a property of the *file*: either it carries
   * identities or it does not, and a sheet cannot be half one thing. Deciding it per row
   * would make a blank Item ID cell mean "join on ક્રમ instead", which is precisely the
   * distinction §3a keeps: a blank cell in a column that exists is a claim ("this દ્રશ્ય is
   * new"), and the column's absence is the lack of any claim.
   */
  const joinsOnIndex = !Number.isInteger(cols?.id) || cols.id < 0;

  // The collection, indexed three ways. First writer wins in each — a collection that
  // already contains two દ્રશ્યો numbered 27 is a separate problem that
  // `validateDarshanItems()` reports, and picking the later one here would make the import's
  // idea of "who owns 27" differ from the તપાસ page's.
  const byId = new Map();
  const indexOwner = new Map();
  for (const item of existing || []) {
    if (!item?.id) continue;
    if (!byId.has(item.id)) byId.set(item.id, item);
    if (Number.isInteger(item.index) && !indexOwner.has(item.index)) indexOwner.set(item.index, item);
  }

  const seenId = new Map();
  const seenIndex = new Map();
  const seenOrder = new Map();
  const entries = [];

  for (let r = start; r < grid.length; r++) {
    const cells = grid[r] ?? [];
    // A wholly empty row is spacing in the sheet, never a દ્રશ્ય, and counting thirty of them
    // as errors would bury the rows that matter.
    if (!cells.some((c) => str(c).trim())) continue;

    const rowNumber = r + 1; // 1-based: the row number Excel shows the સંચાલક on his screen
    const raw = rowToPatch(cells, cols);
    const issues = raw.issues.map((i) => ({ ...i }));
    const note = (severity, field, message) => issues.push({ severity, field, message });

    // ------------------------------------------------------------ duplicates in the file
    // §6: these block the row. Two rows claiming one ક્રમ means the file disagrees with
    // itself, and choosing between them is a guess about which edit is the newer one.
    if (raw.id) {
      if (seenId.has(raw.id)) note('error', 'id', `Item ID ${raw.id} already appeared on row ${seenId.get(raw.id)}.`);
      else seenId.set(raw.id, rowNumber);
    }
    if (raw.index !== undefined) {
      if (seenIndex.has(raw.index)) note('error', 'index', `Index Number ${raw.index} already appeared on row ${seenIndex.get(raw.index)}.`);
      else seenIndex.set(raw.index, rowNumber);
    }
    if (raw.order !== undefined) {
      if (seenOrder.has(raw.order)) note('error', 'order', `Display Order ${raw.order} already appeared on row ${seenOrder.get(raw.order)}.`);
      else seenOrder.set(raw.order, rowNumber);
    }

    // ------------------------------------------------------------ which દ્રશ્ય is this?
    //
    // §3a. Two join keys, chosen by the shape of the file rather than by the content of a
    // cell — see `joinsOnIndex` above and the note at the head of this function.
    const owner = raw.index === undefined ? null : indexOwner.get(raw.index) ?? null;
    let target = null;
    let conflict = null;

    if (joinsOnIndex) {
      // The ક્રમ *is* the identity here, so a number that matches is simply this દ્રશ્ય. No
      // conflict is possible: a conflict is a row naming one identity while carrying another
      // one's number, and a file with no id column names no identity but the number itself.
      target = owner;
      if (!target && raw.index !== undefined && importMode === IMPORT_MODES.UPDATE_ONLY) {
        // The same rule §6 states for a missing Item ID, applied to whichever column is
        // actually the key: an import that only updates cannot resolve this row at all.
        note('error', 'index', `There is no દ્રશ્ય numbered ${raw.index}, and this import updates only.`);
      }
    } else {
      target = raw.id ? byId.get(raw.id) ?? null : null;
      if (raw.id && !target && importMode === IMPORT_MODES.UPDATE_ONLY) {
        note('error', 'id', `There is no દ્રશ્ય with Item ID ${raw.id}, and this import updates only.`);
      }

      // §7 — the imported ક્રમ already belongs to somebody else. Compared against the row's
      // *explicit* target, so a new row (blank Item ID) landing on an existing number is a
      // conflict rather than a silent create alongside it.
      const explicitId = target?.id ?? raw.id ?? '';
      if (owner && owner.id !== explicitId) {
        conflict = {
          field: 'index',
          value: raw.index,
          existingId: owner.id,
          existingTitle: str(owner.title) || str(owner.caption),
          resolution: CONFLICT_RESOLUTIONS.SKIP,
          message: `Index ${raw.index} already belongs to ${owner.id}.`,
        };
        note('warning', 'index', conflict.message);
      }
    }

    const hasError = issues.some((i) => i.severity === 'error');

    // ------------------------------------------------------------ create · update · skip
    let action;
    let applyTo = target;

    if (hasError) {
      action = 'error';
    } else if (conflict) {
      const asked = resolutions?.[rowNumber] ?? defaultResolution;
      if (asked === CONFLICT_RESOLUTIONS.UPDATE && canUpdate) {
        // "Update the existing item" means: apply this row to the દ્રશ્ય that already holds
        // the number, rather than making a second one that claims it.
        conflict.resolution = CONFLICT_RESOLUTIONS.UPDATE;
        applyTo = owner;
        action = 'update';
      } else {
        conflict.resolution = CONFLICT_RESOLUTIONS.SKIP;
        action = 'skip';
        note('info', 'index', asked === CONFLICT_RESOLUTIONS.UPDATE
          ? `Skipped - updating ${owner.id} is not possible in ${importMode}.`
          : `Skipped - ${owner.id} was left as it is.`);
      }
    } else if (target) {
      action = canUpdate ? 'update' : 'skip';
      if (!canUpdate) note('info', 'id', `Skipped - ${target.id} already exists and this import creates only.`);
    } else {
      action = canCreate ? 'create' : 'skip';
      if (!canCreate) note('info', 'id', 'Skipped - this row is a new દ્રશ્ય and this import updates only.');
    }

    if (action === 'create' && raw.index === undefined) {
      note('error', 'index', 'A new દ્રશ્ય needs an Index Number (ક્રમ) - leave Item ID blank, but not the number.');
      action = 'error';
    }

    // ------------------------------------------------------------ what would be written
    const patch = {};
    const before = {};
    if (action === 'create' || action === 'update') {
      for (const field of PATCH_FIELDS) {
        if (!(field in raw)) continue;
        const next = raw[field];

        if ((field === 'title' || field === 'caption') && next === '') {
          // §6 makes this a warning, never an error — but only when the empty cell actually
          // withheld something. An empty cell over an already-empty field withheld nothing,
          // and warning about it would put a warning on all 109 rows of a round trip (every
          // દ્રશ્ય ships with an empty title by decision, DARSHAN_DATA_CONTRACT §2), which is
          // how a preview full of real warnings becomes a preview nobody reads.
          const label = field === 'title' ? 'Title (શીર્ષક)' : 'Description (વર્ણન)';
          if (action === 'create') note('warning', field, `${label} is empty - the new દ્રશ્ય starts without one.`);
          else if (currentValue(applyTo, field)) {
            note('warning', field, `${label} is empty, so it was left as it is. Clear it on the દ્રશ્ય's own page instead.`);
          }
          continue;
        }

        if (action === 'update') {
          const now = currentValue(applyTo, field);
          if (now === next) continue;
          before[field] = now;
        }
        patch[field] = next;
      }
    }

    if (action === 'update' && !Object.keys(patch).length) {
      action = 'skip';
      note('info', '', 'Nothing to change - this row already matches the દ્રશ્ય.');
    }

    entries.push({
      rowNumber,
      // For a create with no Item ID, the id a create *would* be given. Derived the one way
      // ids are ever derived (darshanId), so the preview names the same id the write will.
      id: applyTo?.id || raw.id || (raw.index !== undefined ? darshanId(raw.index) : ''),
      action,
      patch,
      before,
      issues,
      ...(conflict ? { conflict } : {}),
    });
  }

  // `joinedOn` is reported rather than left implicit: it is the one decision in this plan the
  // operator cannot read off the preview table, and "these rows were matched by ક્રમ because
  // your sheet has no Item ID column" is the sentence that makes the rest of it make sense.
  return {
    entries,
    counts: countEntries(entries),
    mode: importMode,
    columns: cols,
    joinedOn: joinsOnIndex ? 'index' : 'id',
  };
}

/** §29 — every number in the preview is counted from the entries, never assumed. */
function countEntries(entries) {
  const counts = { total: entries.length, create: 0, update: 0, skip: 0, error: 0 };
  for (const e of entries) counts[e.action]++;
  return counts;
}

/**
 * The rows an apply would actually write. Everything else in the plan is report-only —
 * the same split `writableEntries()` makes in sheet-import.js, for the same reason.
 */
export const writableExcelEntries = (entries = []) => entries.filter((e) => e.action === 'create' || e.action === 'update');

// ==================================================================== the template

/**
 * EXCEL_CONTRACT §8 — the eight importable headers, then three worked examples.
 *
 * Bilingual headers (`Index Number (ક્રમ)`) rather than one language: the સંચાલક reads
 * Gujarati and the file is frequently prepared by somebody who does not, and
 * `detectDarshanColumns` splits the parenthesis so either half alone still maps.
 *
 * Every example row is numbered 901–903 and none of them names a real Item ID. That is the
 * one decision in this function worth arguing about, and it goes this way because a template
 * is a file people forget to finish tidying. An example row illustrating an edit with a real
 * id — `darshan-001`, the obvious choice — would, left in place and confirmed in a hurry,
 * rewrite the title of the first દ્રશ્ય in the collection. Numbers out beyond anything real
 * cannot: the worst they can do is offer three junk creates, each labelled ઉદાહરણ, in a
 * preview the operator has to confirm.
 *
 * The three cover the three shapes: a new દ્રશ્ય, an edit to one that already exists, and a
 * Drive link given instead of a file id.
 *
 * @returns {string[][]} the header row followed by the example rows
 */
export function templateRows() {
  const header = IMPORTABLE_COLUMNS.map((c) => `${c.en} (${c.gu})`);
  const examples = [
    {
      // New: Item ID blank. This is the row that says "leave the id empty and give a ક્રમ".
      id: '',
      index: '901',
      title: 'ઉદાહરણ - આ પંક્તિ કાઢી નાખો',
      caption: 'નવા દ્રશ્યનું વર્ણન અહીં લખો. નવા દ્રશ્ય માટે Item ID ખાલી રાખો.',
      driveId: '1AnOf5K9Ab0kjmOs2gd_arx9CAqYxdK9a',
      driveUrl: '',
      order: '901',
      status: 'DRAFT',
    },
    {
      // Existing: the id is filled in and the cells he does not want to change are empty.
      id: 'darshan-902',
      index: '902',
      title: 'ઉદાહરણ - હાલના દ્રશ્યનું શીર્ષક બદલવું',
      caption: '',
      driveId: '',
      driveUrl: '',
      order: '',
      status: '',
    },
    {
      id: '',
      index: '903',
      title: 'ઉદાહરણ - ડ્રાઈવ લિંક વડે',
      caption: 'ફાઈલ આઈડીને બદલે આખી ડ્રાઈવ લિંક પણ ચાલે છે.',
      driveId: '',
      driveUrl: 'https://drive.google.com/file/d/1AnOf5K9Ab0kjmOs2gd_arx9CAqYxdK9a/view',
      order: '903',
      status: 'VALIDATED',
    },
  ];
  return [header, ...examples.map((row) => IMPORTABLE_COLUMNS.map((c) => row[c.key] ?? ''))];
}

/** §8 — the companion file. CSV cannot carry a second sheet, so the notes ship beside it. */
export const TEMPLATE_FILENAME = 'darshan-template.csv';
export const INSTRUCTIONS_FILENAME = 'darshan-instructions.txt';

/**
 * The instructions that ship with the template.
 *
 * English with the Gujarati column names in it, which is the voice `shared/domain/drive.js`
 * and `shared/domain/sheet-import.js` already use for messages a સંચાલક reads: the nouns he
 * knows the sheet by are Gujarati, the surrounding sentence is not.
 *
 * Every paragraph answers a question §8 names, and one more the contract does not: what
 * happens to a column this file does not list. It is ignored — which is worth saying, because
 * the answer a person expects is "it breaks", and knowing otherwise is what lets him keep his
 * own working columns in the sheet.
 */
export function instructionsText() {
  const columnLines = IMPORTABLE_COLUMNS.map(
    (c) => `  ${c.en} (${c.gu})${c.required ? '   - required for a new દ્રશ્ય' : ''}`
  ).join('\n');

  return `દર્શન - how to fill in this file
================================

THE COLUMNS
${columnLines}

Column order does not matter: each column is found by its heading, not by its position, and
either language works. Extra columns of your own are ignored, not rejected - keep them.

Four more columns appear in an export and are ignored when you upload it back:
${EXCEL_COLUMNS.filter((c) => !c.importable).map((c) => `  ${c.en} (${c.gu})`).join('\n')}

WHICH દ્રશ્ય A ROW MEANS
  · If your file HAS an Item ID column, that column decides:
      - a filled-in Item ID means that દ્રશ્ય,
      - an empty Item ID means a NEW દ્રશ્ય.
  · If your file has NO Item ID column at all - the સંચાલક's own sheet, with ક્રમ, ફોટો ફાઈલ
    and દ્રશ્ય-વર્ણન - then the Index Number decides, and a row whose ક્રમ already exists
    simply updates that દ્રશ્ય. Nothing extra is needed; upload the sheet as it is.
    One thing to know: in such a file, changing a row's ક્રમ makes that row update a
    different દ્રશ્ય. The preview shows you exactly that before anything is saved.

WHAT IS REQUIRED
  · To change an existing દ્રશ્ય: the columns you want to change, and nothing else.
    Leave every other cell empty. An empty cell means "leave this as it is".
  · To add a new દ્રશ્ય: give it an Index Number, and leave Item ID EMPTY if that column
    is in your file. Filling in an Item ID for a દ્રશ્ય that does not exist does not create
    it under that id.

INDEX NUMBER AND DISPLAY ORDER ARE NOT THE SAME THING
  · Index Number (ક્રમ) is the number printed inside the artwork. It belongs to the picture.
  · Display Order (ક્રમાંક) is the position the દ્રશ્ય appears in. It is yours to arrange.
  · The number a યુવક actually sees is derived from the order of the published દ્રશ્યો and is
    not in this file - you cannot set it, and nothing you type here will.
Both must be positive whole numbers. Gujarati digits (૧૨૩) are fine.

THE PICTURE
  Give either the Google Drive File ID or the Google Drive URL - not both, unless they name
  the same file. If they disagree, the File ID is used and you are told so.
  A share link looks like  https://drive.google.com/file/d/<id>/view

STATUS
  One of exactly these five, in any capitalisation:
    ${SCENE_STATUSES.join(' · ')}
  Only PUBLISHED and ACTIVE are visible to a યુવક. A new દ્રશ્ય is normally DRAFT until its
  picture is in place. Leave the cell empty to keep the status the દ્રશ્ય already has.

DUPLICATES
  Two rows with the same Index Number, Display Order or Item ID stop each other: the second
  row is reported as an error and neither is guessed at.
  If a row names one દ્રશ્ય by its Item ID but carries an Index Number belonging to a
  *different* one, nothing is overwritten. You are shown "Index 27 already belongs to
  darshan-027" and asked, per row, whether to skip it, update that દ્રશ્ય instead, or cancel
  the whole upload. Skipping is the default.
  (This can only happen in a file that has an Item ID column. Without one, the Index Number
  is simply which દ્રશ્ય the row is about - see above.)

BEFORE ANYTHING IS SAVED
  You always see a preview first - how many rows are new, how many change, how many are
  skipped and how many have errors, and what each one would change. Nothing is written until
  you confirm it.

FINALLY
  · Delete the three example rows (numbered 901–903) before you upload.
  · Save as CSV UTF-8 or .xlsx. A plain "CSV" saved from an old Excel loses Gujarati.
  · Do not rename the Item ID column, and never edit an Item ID by hand.
`;
}
