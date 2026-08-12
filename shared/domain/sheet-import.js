/**
 * The સંચાલક's spreadsheet, read as data — one દ્રશ્ય per row, ક્રમ + ફોટો ફાઈલ + વર્ણન.
 *
 * Why this exists
 * ---------------
 * The collection is 109 દ્રશ્યો and every one of them has a વર્ણન the સંચાલક wrote in a
 * Google Sheet. Until now the only way that text reached a યુવક was `npm run content &&
 * npm run optimize` — a fifty-minute re-encode and a deploy — or typing 109 વર્ણન into the
 * detail page one at a time. Neither is something the સંચાલક can do himself on the day the
 * sheet changes. This module is the reading half of the third route: he selects the rows in
 * the sheet, presses Ctrl-C, and pastes.
 *
 * Pure, dependency-free, and deliberately *not* the writing half. Everything here is a
 * function from text to a described plan; the panel decides whether to carry it out and
 * `saveScene` is what actually writes (§7 — one write path, so the audit triggers cannot be
 * bypassed). That split is what makes "preview before write" possible at all: the plan is a
 * value that can be rendered in a table before anybody commits to it.
 *
 * What arrives, in practice
 * -------------------------
 * A paste out of Google Sheets is **tab**-separated, not comma-separated — the clipboard
 * flavour Sheets writes is TSV. A file the સંચાલક downloads is CSV. Both are handled, and
 * which one it is is detected rather than asked, because a સંચાલક who has just pasted has
 * no idea what a delimiter is.
 *
 * Either way the quoting rules are RFC-4180's, which is the whole reason this is a real
 * parser and not `text.split('\n').map(l => l.split('\t'))`. Row 88 of the live sheet is:
 *
 *     88<TAB>Varni(88)<TAB>"ઘોર વનમાં વૃક્ષ નીચે નિદ્રાધીન વર્ણીરાજની પાસે શાંતચિતે બેઠેલું હિંસક પ્રાણી
 *     "
 *
 * — a newline *inside* a quoted field. A line-by-line split turns that one દ્રશ્ય into two
 * broken rows, and the second of them (a lone `"`) would then shift every subsequent row's
 * meaning if anything downstream counted lines. The parser below is the only defence, and
 * that exact row is in `npm test`.
 *
 * scripts/lib/spreadsheet.mjs has a parser of the same shape for the *build* pipeline. It
 * is not imported here and must not be: it is a Node script that reads files, unzips xlsx
 * and shells out to curl, none of which exists in a browser. Two small parsers that agree
 * beats one that has to run in both worlds.
 */
import { darshanId } from './darshan.js';
import { detectDarshanColumns } from './darshan-excel.js';
import { driveImageUrl, resolveImageInput } from './drive.js';

// ==================================================================== delimited text

/**
 * Gujarati digits, because the ક્રમ column is allowed to be written in them.
 *
 * The live sheet uses Latin digits today — the pasted sample is `1`, `88`, `109` — so this
 * is tolerance rather than a feature. `૮૮` and `88` are the same ક્રમ and refusing one of
 * them would be a mystery to the person who typed it.
 */
const GU_DIGITS = '૦૧૨૩૪૫૬૭૮૯';

/**
 * A cell → the whole number it names, or null.
 *
 * Non-digits are stripped rather than rejected: `૧.` , `1)` and ` 1 ` all mean ક્રમ ૧, and
 * a sheet maintained by hand for two years contains all three. Anything with no digit at
 * all returns null and is reported as an unusable row — never silently treated as zero,
 * which would collide every such row onto one imaginary દ્રશ્ય.
 */
export function toNumber(cell) {
  const s = String(cell ?? '').trim();
  if (!s) return null;
  let out = '';
  for (const ch of s) {
    const gu = GU_DIGITS.indexOf(ch);
    if (gu >= 0) out += String(gu);
    else if (ch >= '0' && ch <= '9') out += ch;
  }
  if (!out) return null;
  const n = Number(out);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Tab or comma, decided by looking at the text rather than by asking.
 *
 * Counted **outside quotes only**, which is the point: a CSV whose વર્ણન contains a tab, or
 * a TSV whose વર્ણન contains a comma (Gujarati prose is full of them), would otherwise vote
 * for the wrong delimiter from inside a quoted field. A tab is essentially never a literal
 * character in this data and a comma very often is, so any unquoted tab settles it.
 */
export function detectDelimiter(text) {
  const s = String(text || '');
  let quoted = false;
  let tabs = 0;
  let commas = 0;
  let semis = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') i++;
        else quoted = false;
      }
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === '\t') tabs++;
    else if (c === ',') commas++;
    else if (c === ';') semis++;
  }
  if (tabs) return '\t';
  // A semicolon export is what a European Excel locale produces; it only wins if it is
  // clearly the structure rather than punctuation.
  if (semis > commas) return ';';
  return ',';
}

/**
 * RFC-4180, with the two deviations real spreadsheets actually need.
 *
 *  1. **A quote only opens a field at its start.** The letter-perfect rule is that a quoted
 *     field is quoted from its first character; a `"` appearing mid-field is a literal one.
 *     Treating every `"` as a state toggle (the shorter way to write this loop) means a
 *     વર્ણન containing a single quotation mark swallows the rest of the sheet into one
 *     field. With 109 rows of hand-written Gujarati prose that is not a hypothetical.
 *
 *  2. **`""` inside a quoted field is one literal quote** — that part *is* the standard, and
 *     it is how Sheets escapes a quotation mark on the clipboard.
 *
 * Line endings are normalised first: CRLF (Excel, Windows clipboard) and a bare CR (very old
 * Mac exports) both become LF, including inside quoted fields, so a multi-line વર્ણન comes
 * back with the newlines a person would expect rather than with stray \r characters that
 * later fail an equality check against the same text typed in the panel.
 *
 * @param {string} text
 * @param {string} delimiter
 * @returns {string[][]} rows of raw cells — nothing trimmed, nothing interpreted
 */
export function parseDelimited(text, delimiter = ',') {
  // The BOM Excel writes would otherwise glue itself to the first header cell and make
  // `ક્રમ` unfindable — the same trap scripts/lib/spreadsheet.mjs documents.
  const s = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');

  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let started = false; // has anything (even an empty quoted field) been seen in this cell?

  const endField = () => {
    row.push(field);
    field = '';
    started = false;
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < s.length; i++) {
    const c = s[i];

    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        // A newline here is content, not a row break. This single branch is what keeps
        // row 88 one row.
        field += c;
      }
      continue;
    }

    if (c === '"' && !started) {
      quoted = true;
      started = true;
    } else if (c === delimiter) {
      endField();
    } else if (c === '\n') {
      endRow();
    } else {
      field += c;
      started = true;
    }
  }

  // A file ending in a newline has already closed its last row; anything left over is a
  // final row with no trailing newline.
  if (field || row.length) endRow();

  // Trailing blank rows are an artefact of the paste (Sheets adds one), never a દ્રશ્ય.
  while (rows.length && rows[rows.length - 1].every((c) => !String(c).trim())) rows.pop();

  return rows;
}

// ==================================================================== columns

/**
 * §62 — which column is which is *found*, never assumed to be 1, 2, 3.
 *
 * The live sheet's header is Gujarati (`ક્રમ`, `ફોટો ફાઈલ`, `દ્રશ્ય-વર્ણન (વિગતવાર)`), but an
 * export prepared by somebody else will not be, and the સંચાલક is free to add a column
 * tomorrow. So each role carries the words that have ever plausibly named it, in both
 * scripts, and matching is done on the header text.
 *
 * The short English names are anchored on purpose. An unanchored `/n/` would match the
 * word "વર્ણન" transliterated, "Name", "Notes" and half the header row; `^n$` matches the
 * column somebody actually labelled `n`.
 *
 * Two spellings of ફાઈલ/ફાઇલ appear in the wild (ઈ vs ઇ) and both are listed rather than
 * normalised away, because normalising Gujarati vowel signs is a much bigger claim than
 * this needs to make.
 */
const HEADER_PATTERNS = {
  index: /ક્રમ|ક્રમાંક|નંબર|number|^\s*(n|no\.?|nr|sr\.?|s\.?no\.?|#|idx|index|seq)\s*$/i,
  file: /ફોટો|ફાઈલ|ફાઇલ|છબી|ચિત્ર|તસવીર|image|file|photo|picture|url|link/i,
  caption: /વર્ણન|દ્રશ્ય|દૃશ્ય|લખાણ|caption|description|^\s*desc\.?\s*$|^\s*text\s*$|^\s*title\s*$/i,
};

/** The roles a column can play, in the order the panel offers them. */
export const COLUMN_ROLES = ['index', 'file', 'caption'];

/**
 * Every role a column can play, in EXCEL_CONTRACT §1's column order — with the live sheet's
 * `ફોટો ફાઈલ` at the end, because it is not one of the eight: it is a *filename*, which means
 * nothing until the Drive folder has been listed.
 *
 * `COLUMN_ROLES` is deliberately left as the original three. It is what the older paste-only
 * planner enumerates and what the existing tests name; widening that constant in place would
 * have changed the meaning of every caller silently.
 */
export const SHEET_ROLES = ['id', 'index', 'title', 'caption', 'driveId', 'driveUrl', 'order', 'status', 'file'];

/**
 * One candidate header row → a column number (or null) for every role.
 *
 * **`detectDarshanColumns` is the authority**, and this function is a wrapper around it rather
 * than a second implementation. That module is EXCEL_CONTRACT §9's, it carries both languages
 * and every alias for all twelve columns an export writes, and — the part that is easy to miss
 * and expensive to get wrong — it *names the four export-only columns* so they can be safely
 * ignored. Without knowing about them, `Production Image URL` is claimed by anything matching
 * "url" and `Display Number` by anything matching "number", and an import writes the derived
 * display number into the presentation order of every દ્રશ્ય. Being named is what makes them
 * ignorable, and re-deriving that knowledge here would be a copy that drifts.
 *
 * What this adds is the fallback below: the headings the live Google Sheet has used for two
 * years (`ક્રમ`, `ફોટો ફાઈલ`, `દ્રશ્ય-વર્ણન (વિગતવાર)`) predate the contract, are matched by
 * substring rather than whole-cell, and are what a paste out of Sheets still carries. A role
 * the contract's detector left unclaimed gets one more chance against those older patterns,
 * over the columns nothing has taken.
 *
 * A role that matches nothing stays null. Neither half ever falls back to a position, because
 * a wrong guess writes the વર્ણન column into `image_url` on 109 દ્રશ્યો and there is no undo
 * for that beyond a second import.
 */
export function detectColumns(cells = []) {
  const contract = detectDarshanColumns(cells);

  const out = {};
  for (const role of SHEET_ROLES) out[role] = contract[role] ?? null;

  // Every column the contract's detector claimed — including for the export-only columns,
  // which are absent from SHEET_ROLES but must stay unavailable to the fallback.
  const taken = new Set(Object.values(contract).filter((c) => Number.isInteger(c)));

  for (const role of COLUMN_ROLES) {
    if (out[role] !== null) continue;
    for (let c = 0; c < cells.length; c++) {
      if (taken.has(c)) continue;
      if (HEADER_PATTERNS[role].test(String(cells[c] ?? ''))) {
        out[role] = c;
        taken.add(c);
        break;
      }
    }
  }
  return out;
}

/** How much of a header row this looks like. Two roles is the threshold; see findHeaderRow. */
const score = (cols) => SHEET_ROLES.filter((r) => cols[r] !== null).length;

/**
 * Find the header row, tolerating whatever sits above it.
 *
 * Not "row 0": the live sheet carries a merged title banner over the header, and the
 * સંચાલક adds notes above his data the way anybody does. scripts/lib/spreadsheet.mjs makes
 * the same judgement for the build pipeline, for the same reason.
 *
 * Two roles is the bar. One is too low — a data row whose વર્ણન happens to contain the word
 * "દ્રશ્ય" scores 1, and promoting it to header would silently drop the real first દ્રશ્ય.
 * Three is too high: a sheet with only ક્રમ and વર્ણન (no artwork column) is a legitimate
 * captions-only import.
 *
 * **The best row wins, not the first one over the bar.** That changed when the role set grew
 * from three to nine: with nine patterns in play, a note the સંચાલક typed above his table is
 * measurably more likely to score 2 by accident than it was, and the real header — which
 * scores five, six or eight on an export of this panel's own making — is always further down.
 * Comparing scores costs one pass over at most 25 rows and removes the whole class of
 * "imported the wrong row as the header". Ties go to the earliest row, which is the old
 * behaviour and the right one: a table's header is above its data, never below it.
 *
 * @returns {{ headerRow: number, columns: Record<string, number|null> }}
 *   `headerRow` is -1 when nothing convincing was found — the panel then asks the સંચાલક to
 *   point at the columns himself rather than guessing (§12: he is the one who knows).
 */
export function findHeaderRow(rows = []) {
  const limit = Math.min(rows.length, 25);
  let best = { headerRow: -1, columns: detectColumns([]), score: 0 };
  for (let r = 0; r < limit; r++) {
    const cols = detectColumns(rows[r]);
    const s = score(cols);
    if (s >= 2 && s > best.score) best = { headerRow: r, columns: cols, score: s };
  }
  return { headerRow: best.headerRow, columns: best.columns };
}

/**
 * Text → everything the panel needs to show a mapping the સંચાલક can correct.
 *
 * Deliberately returns the raw rows as well. The preview screen offers a `<select>` per
 * role listing the header cells, seeded with what was detected, and re-derives the import
 * from whatever he chooses — so detection failing is a small inconvenience rather than a
 * dead end (§1).
 */
export function readSheet(text) {
  const delimiter = detectDelimiter(text);
  const rows = parseDelimited(text, delimiter);
  return {
    delimiter,
    delimiterLabel: delimiter === '\t' ? 'tab-separated' : delimiter === ';' ? 'semicolon-separated' : 'comma-separated',
    ...inspectRows(rows),
  };
}

/**
 * The same inspection, for rows that never were text.
 *
 * A `.xlsx` arrives as a ZIP of XML and comes back from `readXlsx()` already split into
 * cells — there is no delimiter to detect and nothing to parse, but everything *after* that
 * point is identical work: find the header, map the columns, measure the table. Splitting it
 * out is what lets the panel treat a pasted TSV, a downloaded CSV and an uploaded workbook as
 * one code path from here on, rather than growing a second preview that is nearly the same.
 *
 * @param {string[][]} rows
 */
export function inspectRows(rows = []) {
  const { headerRow, columns } = findHeaderRow(rows);
  return {
    rows,
    headerRow,
    columns,
    /** false ⇒ the panel must ask which column is which. */
    detected: headerRow >= 0,
    header: headerRow >= 0 ? rows[headerRow] : rows[0] || [],
    /** Widest row wins: a short row is a row with empty trailing cells, not a narrower table. */
    width: rows.reduce((m, r) => Math.max(m, r.length), 0),
  };
}

/**
 * Raw rows + a column mapping → the normalised records the plan is built from.
 *
 * `{ line, n, file, caption }` was the whole of it and still is the whole of what the
 * original planner reads; `id`, `title`, `driveId`, `driveUrl`, `order` and `status` are
 * carried alongside for the eight-column contract. Adding fields rather than changing the
 * three that were there means nothing downstream had to be touched to keep working.
 *
 * `line` is the 1-based row number **in the pasted text**, so an error can name the row the
 * સંચાલક can see on his own screen. It is not the ક્રમ and the two are frequently different.
 *
 * Trimming happens here and only here. The live sheet has trailing spaces on several વર્ણન
 * and a trailing newline inside row 88's quoted field; untrimmed, each of those is a diff
 * against the stored caption that is invisible on screen, so the preview would promise a
 * change that changes nothing a યુવક can see.
 *
 * Trimming is the *only* thing done to the text. Gujarati is not normalised, not case-folded
 * and not re-composed: `ઈ` and `ઇ` are different letters to the person who typed one of them,
 * and EXCEL_CONTRACT §3 requires a round-trip to come back byte-identical.
 */
export function toSheetRows(rows = [], headerRow = -1, columns = {}) {
  const start = headerRow >= 0 ? headerRow + 1 : 0;
  const cell = (row, c) => (c === null || c === undefined || c < 0 ? '' : String(row[c] ?? '').trim());
  const out = [];
  for (let r = start; r < rows.length; r++) {
    const row = rows[r];
    const rec = {
      line: r + 1,
      n: toNumber(cell(row, columns.index)),
      file: cell(row, columns.file),
      caption: cell(row, columns.caption),
      // The join key. Kept as written rather than parsed into a number: `darshan-027` is an
      // id and `27` is not, and leading zeros are load-bearing (EXCEL_CONTRACT §3).
      id: cell(row, columns.id),
      title: cell(row, columns.title),
      driveId: cell(row, columns.driveId),
      driveUrl: cell(row, columns.driveUrl),
      order: toNumber(cell(row, columns.order)),
      // Not upper-cased here. What the five allowed values are, and what an unrecognised one
      // costs, is the planner's judgement to make and to report against the field by name.
      status: cell(row, columns.status),
      /** The raw cells, so a planner that works on columns rather than roles can read them. */
      cells: row,
    };
    // Wholly empty rows are spacing in the sheet, not દ્રશ્યો, and reporting 30 of them as
    // "no such દ્રશ્ય" would bury the ones that matter.
    if (isBlankRecord(rec)) continue;
    out.push(rec);
  }
  return out;
}

/**
 * Nothing in any mapped column. Checked over every role, so a row carrying only a `Status`
 * or only an `Item ID` still counts as a row the સંચાલક meant to write — it is an error he
 * needs told about, not whitespace to be swallowed.
 */
const isBlankRecord = (rec) =>
  rec.n === null &&
  rec.order === null &&
  !rec.file &&
  !rec.caption &&
  !rec.id &&
  !rec.title &&
  !rec.driveId &&
  !rec.driveUrl &&
  !rec.status;

// ==================================================================== Drive matching

/**
 * The ફોટો ફાઈલ column holds `Varni(1)` — a **filename with no extension**, not a URL and
 * not a Drive id. The file in the folder is `Varni(1).png`. So matching has to be tolerant
 * in exactly three ways and no more:
 *
 *   - the extension is ignored (the sheet does not carry one, and .png/.jpg both occur);
 *   - surrounding whitespace is ignored (a spreadsheet cell collects it);
 *   - case is ignored (`varni(1)` and `Varni(1)` are the same file to a person).
 *
 * It is *not* tolerant about anything else. `Varni(1)` and `Varni (1)` differ by a space
 * that a person would call the same file, so a second, looser key exists — but it is only
 * consulted when the strict key misses AND it resolves to exactly one file, because
 * matching the wrong artwork onto a દ્રશ્ય is worse than reporting the name as unmatched
 * and letting the સંચાલક fix his sheet.
 */
export const stripExtension = (name) => String(name ?? '').trim().replace(/\.(png|jpe?g|webp|avif|gif|tiff?|bmp|heic)$/i, '');

/** Strict key: extension off, trimmed, case-folded. */
export const fileKey = (name) => stripExtension(name).toLowerCase();

/** Loose key: everything the strict key does, plus every space and separator removed. */
export const looseKey = (name) => fileKey(name).replace(/[\s._-]+/g, '');

/**
 * `[{id, name}]` from the Drive folder → the two lookups above.
 *
 * A key claimed by two different files is *dropped* rather than resolved to the first one.
 * Drive allows two files with the same name in one folder, and picking one of them silently
 * would point a દ્રશ્ય at whichever the listing happened to return first — a difference
 * nobody could see and nobody could debug.
 */
export function indexDriveFiles(files = []) {
  const strict = new Map();
  const loose = new Map();
  const dupes = new Set();
  for (const f of files) {
    if (!f?.id || !f?.name) continue;
    const k = fileKey(f.name);
    if (!k) continue;
    if (strict.has(k)) dupes.add(k);
    strict.set(k, f);
    const l = looseKey(f.name);
    if (loose.has(l) && loose.get(l).id !== f.id) loose.set(l, null); // ambiguous → unusable
    else if (!loose.has(l)) loose.set(l, f);
  }
  for (const k of dupes) strict.set(k, null);
  return { strict, loose, count: files.length };
}

/**
 * One sheet filename → the Drive file, or null.
 *
 * @returns {{ file: object|null, how: 'exact'|'loose'|'ambiguous'|'none' }}
 *   `how` is reported to the સંચાલક for the loose matches, because "we matched `Varni (7)`
 *   to `Varni(7).png`" is a thing he should be able to disagree with before it is written.
 */
export function matchDriveFile(index, name) {
  const raw = String(name ?? '').trim();
  if (!raw || !index) return { file: null, how: 'none' };

  const k = fileKey(raw);
  if (index.strict.has(k)) {
    const hit = index.strict.get(k);
    return hit ? { file: hit, how: 'exact' } : { file: null, how: 'ambiguous' };
  }

  const l = looseKey(raw);
  if (index.loose.has(l)) {
    const hit = index.loose.get(l);
    return hit ? { file: hit, how: 'loose' } : { file: null, how: 'ambiguous' };
  }

  return { file: null, how: 'none' };
}

// ==================================================================== the plan

/**
 * §57, §29 — what *would* happen, as a value, before anything happens.
 *
 * This is the heart of the feature. An import touches all 109 દ્રશ્યો at once, and a mass
 * overwrite that nobody previewed is the one failure this whole screen exists to prevent:
 * a mis-mapped column or a stale Drive folder would replace every વર્ણન in the collection
 * with the wrong text, and the audit trail would faithfully record 109 deliberate-looking
 * edits. So the plan is computed, rendered as a table of current-vs-new, and only then
 * carried out.
 *
 * The rules encoded here, each of which is a decision and not a detail:
 *
 *  - **An empty વર્ણન cell means "no change", never "blank it."** shared/domain/darshan.js
 *    already treats `caption: ''` as *absent* rather than as an override, because
 *    `caption` is `not null default ''` and every row the સંચાલક has ever toggled carries
 *    one. Writing '' from here would therefore not even do what it looked like it did — it
 *    would restore the sheet's text on the next build and read as an erasure in the audit
 *    log meanwhile. Clearing a વર્ણન stays a deliberate single-દ્રશ્ય act on the detail page.
 *
 *  - **A ક્રમ with no matching દ્રશ્ય is reported, never created.** createScene() exists and
 *    is not called: a દ્રશ્ય called into existence in bulk would arrive with no artwork, and
 *    §12's placeholder flow is a considered single act with a DRAFT status behind it. A
 *    typo'd `1099` must produce a line in the report, not a phantom દ્રશ્ય.
 *
 *  - **A name with no Drive file is reported, never skipped.** Silence there is the failure
 *    mode where the સંચાલક believes 109 images were set and 12 were not.
 *
 *  - **A row that changes nothing is marked "no change"** rather than written anyway. 109
 *    no-op upserts would each fire audit_scene() and fill the audit log with edits that
 *    edited nothing (§41), burying the ones that matter.
 *
 * @param {object}   args
 * @param {Array}    args.rows        from toSheetRows()
 * @param {Array}    args.items       DarshanItem[] — the collection as it is right now
 * @param {object}   [args.driveIndex] from indexDriveFiles(); omit for a captions-only import
 * @param {boolean}  [args.applyCaptions]
 * @param {boolean}  [args.applyImages]
 * @param {number}   [args.width]  the width asked of Google's image CDN. Deliberately
 *   undefined by default, so driveImageUrl's own default applies: an import must produce
 *   the same URL a rebuild would, and two independent defaults would drift apart silently.
 */
export function buildImportPlan({
  rows = [],
  items = [],
  driveIndex = null,
  applyCaptions = true,
  applyImages = true,
  width,
} = {}) {
  // Matched on the *printed* ક્રમ first, because that is the number in the સંચાલક's sheet
  // and the number drawn into the artwork. `index` is nullable and may have been renumbered
  // away from the id (§32), so the id is the fallback rather than the primary key here.
  const byIndex = new Map();
  const byId = new Map();
  for (const it of items) {
    if (Number.isInteger(it.index) && !byIndex.has(it.index)) byIndex.set(it.index, it);
    byId.set(it.id, it);
  }

  const seen = new Map(); // ક્રમ → the line that first claimed it
  const entries = [];

  for (const row of rows) {
    const e = {
      line: row.line,
      n: row.n,
      id: row.n ? darshanId(row.n) : '',
      item: null,
      status: 'unchanged',
      notes: [],
      caption: { from: '', to: '', changed: false },
      image: { name: row.file, from: '', to: '', changed: false, driveId: '', how: 'none' },
      patch: {},
    };

    // ---------------------------------------------------------- which દ્રશ્ય is this?
    if (row.n === null) {
      e.status = 'invalid';
      e.notes.push('No usable number (ક્રમ) in this row.');
      entries.push(e);
      continue;
    }

    if (seen.has(row.n)) {
      // The later row is refused rather than merged. Two rows for ક્રમ 42 means the sheet
      // disagrees with itself, and picking one is a guess about which edit is newer.
      e.status = 'duplicate';
      e.notes.push(`Number ${row.n} already appeared on row ${seen.get(row.n)}.`);
      entries.push(e);
      continue;
    }
    seen.set(row.n, row.line);

    const item = byIndex.get(row.n) || byId.get(e.id) || null;
    if (!item) {
      e.status = 'no-scene';
      e.notes.push(`There is no Darshan numbered ${row.n}. Nothing was created — add it from the Darshan list first.`);
      entries.push(e);
      continue;
    }
    e.item = item;
    e.id = item.id;

    // ---------------------------------------------------------- વર્ણન
    e.caption.from = item.caption || '';
    if (applyCaptions && row.caption) {
      e.caption.to = row.caption;
      if (row.caption !== e.caption.from) {
        e.caption.changed = true;
        e.patch.caption = row.caption;
      }
    }

    // ---------------------------------------------------------- ફોટો
    e.image.from = item.imageUrl || '';
    if (applyImages && row.file) {
      const { file, how } = matchDriveFile(driveIndex, row.file);
      e.image.how = how;
      if (!file) {
        // Reported, not skipped — and the વર્ણન half of this row still goes through, because
        // a missing picture is no reason to withhold text that is ready.
        e.notes.push(
          how === 'ambiguous'
            ? `The Drive folder holds more than one file called “${row.file}”. Rename one of them.`
            : driveIndex
              ? `No file named “${row.file}” in the Drive folder.`
              : 'The Drive folder has not been loaded, so images cannot be matched.'
        );
      } else {
        e.image.driveId = file.id;
        e.image.driveName = file.name;
        // driveImageUrl, never the `uc?export=download` route: shared/domain/drive.js
        // explains at length that the download route is the quota-metered one and answers
        // large files with an HTML page. lh3 is Google's image CDN and is what a browser
        // can actually paint.
        e.image.to = driveImageUrl(file.id, width);
        if (how === 'loose') e.notes.push(`Matched “${row.file}” to the Drive file “${file.name}”.`);
        if (e.image.to !== e.image.from) {
          e.image.changed = true;
          e.patch.imageUrl = e.image.to;
          // The id travels with the URL. Without it the enlarged view and the panel's grid
          // have nothing to re-ask the CDN with and would fall back to the feed's own file.
          e.patch.driveId = file.id;
        }
      }
    }

    e.status = Object.keys(e.patch).length ? 'update' : 'unchanged';
    entries.push(e);
  }

  return { entries, summary: summarise(entries, items) };
}

/** §29 — every number in the report is counted from the entries, never assumed. */
function summarise(entries, items) {
  const s = {
    rows: entries.length,
    update: 0,
    unchanged: 0,
    noScene: 0,
    invalid: 0,
    duplicate: 0,
    captionChanges: 0,
    imageChanges: 0,
    unmatchedFiles: [],
    collection: items.length,
  };
  for (const e of entries) {
    if (e.status === 'update') s.update++;
    else if (e.status === 'unchanged') s.unchanged++;
    else if (e.status === 'no-scene') s.noScene++;
    else if (e.status === 'invalid') s.invalid++;
    else if (e.status === 'duplicate') s.duplicate++;
    if (e.caption.changed) s.captionChanges++;
    if (e.image.changed) s.imageChanges++;
    if (e.image.name && !e.image.driveId && e.status !== 'no-scene' && e.status !== 'invalid' && e.status !== 'duplicate') {
      s.unmatchedFiles.push(e.image.name);
    }
  }
  // Untouched દ્રશ્યો: in the collection, named by no row. Worth stating out loud — a paste
  // that only covered the first 50 rows looks identical to a complete one until this is read.
  const named = new Set(entries.filter((e) => e.item).map((e) => e.id));
  s.untouched = Math.max(0, items.length - named.size);
  return s;
}

/** The rows an apply would actually write. Everything else is report-only. */
export const writableEntries = (entries = []) => entries.filter((e) => e.status === 'update');

// ==================================================================== import modes
//
// EXCEL_CONTRACT §4. Until now `writableEntries` above kept only `status === 'update'`, so
// an import could change a દ્રશ્ય and could not, under any circumstance, bring one into
// existence. That was the right default for a paste out of a sheet that only ever described
// દ્રશ્યો that already existed. It is the wrong one for a template a સંચાલક fills in, whose
// entire purpose is rows that are not there yet.
//
// Three modes, and the difference between them is what happens to a row the collection has
// never heard of — not a switch that makes the import more or less careful. Every mode goes
// through the same preview and the same confirmation.

/** In the order the panel offers them; `UPSERT` first because it is the default. */
export const IMPORT_MODES = ['UPSERT', 'CREATE_ONLY', 'UPDATE_ONLY'];

/**
 * The default, and it is the permissive one on purpose.
 *
 * The સંચાલક's mental model of a spreadsheet is "this file is what the list should say".
 * A default that silently ignored his four new rows, or silently ignored his 103 edits,
 * would be a preview full of SKIPPED lines he has to read an explanation for. UPSERT does
 * what the file appears to say, and the preview is what stops it being dangerous.
 */
export const DEFAULT_IMPORT_MODE = 'UPSERT';

/**
 * DARSHAN_DATA_CONTRACT §5 — mapped onto permissions that already exist and are already
 * enforced in RLS. There is no `darshan.import`: creating a દ્રશ્ય from a spreadsheet is
 * creating a દ્રશ્ય, and updating one is updating one.
 *
 * UPSERT needs both, because a single run of it can do either and the operator cannot know
 * in advance which rows are which. Offering it to somebody holding only one of the two would
 * mean a preview promising four new દ્રશ્યો and a database refusing them one at a time.
 */
export const MODE_PERMISSIONS = {
  CREATE_ONLY: ['darshan.create'],
  UPDATE_ONLY: ['darshan.update'],
  UPSERT: ['darshan.create', 'darshan.update'],
};

const MODE_COPY = {
  UPSERT: {
    label: 'Add new and update existing',
    detail: 'A row with a known Item ID updates that Darshan; a row with the Item ID left blank creates one.',
  },
  CREATE_ONLY: {
    label: 'Only add new',
    detail: 'Rows naming a Darshan that already exists are skipped, so nothing already published can change.',
  },
  UPDATE_ONLY: {
    label: 'Only update existing',
    detail: 'Rows naming a Darshan that does not exist are reported as errors, and nothing is created.',
  },
};

/**
 * The modes this operator may actually run, each with the reason when he may not.
 *
 * Disabled and explained, never hidden. A CONTENT_MANAGER holds both permissions and sees
 * three live choices; a COORDINATOR holds neither and sees three greyed ones and is told
 * which permission each would need — which is the difference between a panel that looks
 * broken and one that says what is missing (§1: never a dead end).
 *
 * `can` is passed in rather than imported: the panel hands it `useAdminAuth().can` and the
 * module stays pure. This adds no permission and no new check — it reads the existing matrix
 * through the existing accessor.
 *
 * @param {(permission: string) => boolean} can
 */
export function importModeOptions(can) {
  const held = typeof can === 'function' ? can : () => false;
  return IMPORT_MODES.map((mode) => {
    const missing = MODE_PERMISSIONS[mode].filter((p) => !held(p));
    return {
      mode,
      ...MODE_COPY[mode],
      allowed: missing.length === 0,
      reason: missing.length ? `Needs the “${missing.join('” and “')}” permission.` : '',
    };
  });
}

/** The first mode this operator may run, preferring the default. Null when he may run none. */
export function firstAllowedMode(can) {
  const options = importModeOptions(can);
  return options.find((o) => o.allowed && o.mode === DEFAULT_IMPORT_MODE)?.mode
    || options.find((o) => o.allowed)?.mode
    || null;
}

// ==================================================================== duplicates
//
// EXCEL_CONTRACT §7. An imported `Index Number` that already belongs to a *different* id is
// not an error and not a change to be made quietly — it is a question, because only the
// સંચાલક knows whether he is renumbering the collection on purpose or has pasted the wrong
// column. The planner marks such a row with a `conflict`; nothing here decides for him.

/** Skip is first because it is the default: the safe answer to a question nobody answered. */
export const CONFLICT_CHOICES = ['skip', 'update', 'cancel'];
export const DEFAULT_CONFLICT_CHOICE = 'skip';

export const CONFLICT_LABELS = {
  skip: 'Skip this row',
  update: 'Update the existing item',
  cancel: 'Cancel the import',
};

/** The rows waiting on an answer, in sheet order. */
export const conflictEntries = (entries = []) => entries.filter((e) => e && e.conflict);

/**
 * Skip and Update are answered by rebuilding the plan; Cancel is answered here.
 *
 * `buildExcelPlan` takes `resolutions` and `defaultResolution` and re-derives every entry from
 * them, which is the right place for the first two: "update the existing item" retargets the
 * row at whichever દ્રશ્ય already holds the number, and only the planner knows what that would
 * then change. Re-planning on each answer costs one pass over the file and keeps one authority.
 *
 * Cancel is not a property of a row and `CONFLICT_RESOLUTIONS` deliberately has no value for
 * it. It means "this is not the file I meant to upload", where carrying on with the other 108
 * rows is not a lesser version of what was asked for. So it is answered by the panel — the
 * plan is dropped and nothing is written — and this function only says whether that happened.
 *
 * @param {object} choices `{ [rowNumber]: 'skip'|'update'|'cancel' }`
 * @param {string} fallback the "apply to all remaining" answer
 */
export function isCancelled(choices = {}, fallback = DEFAULT_CONFLICT_CHOICE) {
  return fallback === 'cancel' || Object.values(choices).includes('cancel');
}

/** The answers `buildExcelPlan` understands — Cancel removed, having been dealt with above. */
export function planResolutions(choices = {}) {
  const out = {};
  for (const [row, choice] of Object.entries(choices)) if (choice === 'skip' || choice === 'update') out[row] = choice;
  return out;
}

// ==================================================================== the report
//
// EXCEL_CONTRACT §5 — TOTAL / NEW / UPDATED / SKIPPED / ERRORS, counted over the entries that
// are actually about to be carried out, never over the file's line count. The two differ
// every time a row is skipped, and the number the સંચાલક needs is the one describing what
// will happen.

/** @param {Array} entries */
export function countPlan(entries = []) {
  const counts = { total: 0, create: 0, update: 0, skip: 0, error: 0, conflicts: 0, warnings: 0 };
  for (const e of entries) {
    if (!e) continue;
    counts.total++;
    if (e.action === 'create') counts.create++;
    else if (e.action === 'update') counts.update++;
    else if (e.action === 'error') counts.error++;
    else counts.skip++;
    if (e.conflict) counts.conflicts++;
    for (const i of e.issues || []) if (i?.severity === 'warning') counts.warnings++;
  }
  return counts;
}

/**
 * The rows an apply would actually write.
 *
 * `writableExcelEntries` in darshan-excel.js makes the same split and is where the rule lives;
 * this adds one condition to it. An entry whose patch is empty is never written even when the
 * planner called it a change — 109 no-op upserts would each fire `audit_scene()` and fill the
 * log with edits that edited nothing (§41), burying the ones that matter. The planner already
 * demotes such a row, but the image passes below run *after* it and can move an action in
 * either direction, so the condition is re-checked here rather than assumed to still hold.
 *
 * `writableEntries` above is the same idea over the older entry shape and is left alone; the
 * two are not interchangeable and are deliberately named differently so a caller cannot pick
 * the wrong one by accident.
 */
export const writablePlanEntries = (entries = []) =>
  entries.filter((e) => e && (e.action === 'create' || e.action === 'update') && e.patch && Object.keys(e.patch).length);

// ==================================================================== images
//
// Two of the sheet's columns name a picture and neither of them holds a URL a browser can
// render:
//
//   `Google Drive File ID` / `Google Drive URL`   a reference to the file itself
//   `ફોટો ફાઈલ`                                    a *filename* — `Varni(1)`, no extension —
//                                                 which means nothing until the Drive folder
//                                                 has been listed, and only the server can
//                                                 list it (no CORS header on any Drive host).
//
// Both end at the same place: `resolveImageInput` / `driveImageUrl` in shared/domain/drive.js,
// the single conversion point (IMAGE_CONTRACT §4). Nothing here builds an lh3 URL by hand and
// nothing here lets a `drive.google.com` link through to `image_url` — that host is the
// quota-metered download route, and a blocked file on it answers with an HTML interstitial
// rather than an error, so every card would blank at once with nothing able to explain why.

/** The row record behind a plan entry, matched on the line number the planner reported. */
function pairRecords(entries, records) {
  const byLine = new Map();
  for (const r of records) byLine.set(r.line, r);
  // Falling back to position is only for a planner that numbers its rows differently, and only
  // when the two lists are the same length — a mismatched pairing would attach દ્રશ્ય ૧'s
  // artwork to દ્રશ્ય ૨, which is precisely the silent corruption the preview exists to stop.
  const aligned = entries.length === records.length;
  return (entry, i) => byLine.get(entry?.rowNumber) || (aligned ? records[i] : null);
}

/**
 * One resolved image → the entry, with the change recorded and the action moved if it must be.
 *
 * A row whose text is already right but whose picture is not was marked "no change" by a
 * planner that never saw the picture. It *is* a change, and refusing to say so would make the
 * commonest import of all — the સંચાલક's own sheet, whose વર્ણન rarely move but whose artwork
 * does — appear to do nothing. Only rows the mode is allowed to touch, and only rows that
 * already exist: CREATE_ONLY means what it says.
 */
function applyImageChange(entry, image, extra, { mode, byId }) {
  const out = { ...entry, image };
  if (!image.changed) return out;

  const patch = { ...(out.patch || {}), imageUrl: image.to, driveId: image.driveId, ...extra };
  if (out.action === 'create' || out.action === 'update') return { ...out, patch };

  // A conflict the operator answered with "update the existing item" is no longer holding the
  // row back — the planner marked it `skip` only because the *text* matched what is already
  // stored, which says nothing about the picture. An unanswered conflict still holds.
  const answered = out.conflict?.resolution === 'update';
  const heldBack = out.action === 'error' || (out.conflict && !answered) || (out.issues || []).some((x) => x?.severity === 'error');
  if (mode !== 'CREATE_ONLY' && !heldBack && byId.has(out.id)) return { ...out, action: 'update', patch };
  return out;
}

/**
 * `Google Drive File ID` and `Google Drive URL` → `drive_id`, `source_drive_url`, `image_url`.
 *
 * All three move together and are written in one statement, exactly as `setSceneImage` writes
 * them when a સંચાલક pastes a link on the detail page — one code path, so a દ્રશ્ય imported
 * from a spreadsheet renders identically to one linked by hand.
 *
 * EXCEL_CONTRACT §1: **the id wins** when both columns are filled in and they disagree. A bare
 * id is unambiguous; a URL has been through a chat client, a shortener and somebody's clipboard
 * and is the likelier of the two to be stale.
 *
 * A malformed reference is an error on that row (§6) and is named by its column, because
 * "row 41 is wrong" sends the સંચાલક looking through eight cells.
 *
 * @param {object} args
 * @param {Array}  args.entries
 * @param {Array}  args.records from toSheetRows()
 * @param {Map}    args.byId    the collection as it is now
 * @param {string} args.mode
 * @param {number} [args.width] left undefined so driveImageUrl's own default applies — an
 *   import must produce the URL a rebuild would, and two defaults would drift apart silently.
 */
export function attachDriveReferences({ entries = [], records = [], byId = new Map(), mode = DEFAULT_IMPORT_MODE, width } = {}) {
  const recordFor = pairRecords(entries, records);

  return entries.map((e, i) => {
    if (!e || e.action === 'error') return e;
    const rec = recordFor(e, i);
    const input = rec?.driveId || rec?.driveUrl || '';
    if (!input) return e;

    const field = rec.driveId ? 'driveId' : 'driveUrl';
    const resolved = resolveImageInput(input, width);
    if (!resolved.ok) {
      return {
        ...e,
        action: 'error',
        issues: [...(e.issues || []), { severity: 'error', field, message: resolved.gu }],
      };
    }

    const current = byId.get(e.id) || null;
    const image = {
      name: input,
      how: 'reference',
      from: current?.imageUrl || '',
      to: resolved.url,
      driveId: resolved.driveId,
      changed: resolved.url !== (current?.imageUrl || ''),
    };

    // Kept verbatim so the detail page's link box shows the સંચાલક what he actually wrote
    // rather than the derived lh3 URL, and so a reference that later needs re-checking still
    // has its original form on record.
    return applyImageChange(e, image, { sourceDriveUrl: input }, { mode, byId });
  });
}

/**
 * The `ફોટો ફાઈલ` column → the same three fields, by way of the Drive folder listing.
 *
 * The matching itself is the `indexDriveFiles` / `matchDriveFile` pair above, unchanged — the
 * three tolerances it allows (extension, whitespace, case) and the two it refuses (a loose
 * match that is ambiguous, and anything else) are documented there.
 *
 * This is where the live Google Sheet rejoins the column-driven plan, so the સંચાલક gets one
 * preview and one apply whether his file is the sheet he has always kept or an export of this
 * panel's own making.
 *
 * @param {object} args
 * @param {Array}  args.entries
 * @param {Array}  args.records    from toSheetRows(), carrying the `file` cell per row
 * @param {object} args.driveIndex from indexDriveFiles(); null when the folder is unread
 * @param {Map}    args.byId       the collection as it is now
 * @param {string} args.mode
 * @param {number} [args.width]
 */
export function attachDriveImages({ entries = [], records = [], driveIndex = null, byId = new Map(), mode = DEFAULT_IMPORT_MODE, width } = {}) {
  const recordFor = pairRecords(entries, records);

  return entries.map((e, i) => {
    if (!e || e.action === 'error') return e;
    const rec = recordFor(e, i);
    const name = rec?.file || '';
    // A row that named its file by id or URL has already been resolved; the filename column is
    // the fallback, not a second opinion, and re-resolving it could disagree with the id.
    if (!name || rec?.driveId || rec?.driveUrl) return e;

    const current = byId.get(e.id) || null;
    const image = { name, how: 'none', from: current?.imageUrl || '', to: '', driveId: '', changed: false };

    if (!driveIndex) {
      return withIssue(e, { severity: 'warning', field: 'file', message: 'The Drive folder has not been read, so image names could not be matched.' }, image);
    }

    const { file, how } = matchDriveFile(driveIndex, name);
    image.how = how;

    if (!file) {
      // Reported, never skipped. Silence here is the failure where the સંચાલક believes 109
      // images were set and twelve were not.
      return withIssue(
        e,
        {
          severity: 'warning',
          field: 'file',
          message:
            how === 'ambiguous'
              ? `The Drive folder holds more than one file called “${name}”. Rename one of them.`
              : `No file named “${name}” in the Drive folder.`,
        },
        image
      );
    }

    image.driveId = file.id;
    image.driveName = file.name;
    image.to = driveImageUrl(file.id, width);
    image.changed = image.to !== image.from;

    const noted =
      how === 'loose'
        ? withIssue(e, { severity: 'warning', field: 'file', message: `Matched “${name}” to the Drive file “${file.name}”.` }, image)
        : e;

    // No `source_drive_url`: the સંચાલક never pasted a link here, he named a file, and putting
    // a bare filename in the column that means "what he pasted" would show him a value he
    // cannot act on when he next opens the detail page.
    return applyImageChange(noted, image, {}, { mode, byId });
  });
}

const withIssue = (entry, issue, image) => ({
  ...entry,
  image: image || entry.image,
  issues: [...(entry.issues || []), issue],
});

/**
 * A દ્રશ્ય called into existence by an import starts DRAFT unless the sheet says otherwise.
 *
 * The same decision `createScene()` makes on the panel's "add" button, for the same reason: a
 * row created here has no artwork behind it yet, and ACTIVE would hand યુવકો a card with an
 * empty frame the moment a વર્ણન arrived. DRAFT is outside `useScenes`' visible set, so the
 * દ્રશ્ય stays withheld until somebody looks at it. §1: never a dead end, and never a surprise
 * in front of 2,000 people.
 *
 * `active` is deliberately not set alongside — `scenes_sync_status()` derives it from `status`
 * on insert, and writing both would put a value in the audit row that the trigger then changed.
 */
export function withCreateDefaults(entries = []) {
  return entries.map((e) => {
    if (!e || e.action !== 'create' || e.patch?.status) return e;
    return { ...e, patch: { ...(e.patch || {}), status: 'DRAFT' } };
  });
}
