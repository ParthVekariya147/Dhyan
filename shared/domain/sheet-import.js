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
import { driveImageUrl } from './drive.js';

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
 * One candidate header row → `{ index, file, caption }`, each a column number or null.
 *
 * Roles are claimed in a fixed order and a column can only be claimed once, so a header
 * like `ફોટો ફાઈલ` cannot end up as both the file column and (because it contains no વર્ણન)
 * anything else. A role that matches nothing stays null — this function never falls back to
 * a position, because a wrong guess writes the વર્ણન column into `image_url` on 109 દ્રશ્યો
 * and there is no undo for that beyond a second import.
 */
export function detectColumns(cells = []) {
  const out = { index: null, file: null, caption: null };
  const taken = new Set();
  for (const role of COLUMN_ROLES) {
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
const score = (cols) => COLUMN_ROLES.filter((r) => cols[r] !== null).length;

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
 * @returns {{ headerRow: number, columns: {index: number|null, file: number|null, caption: number|null} }}
 *   `headerRow` is -1 when nothing convincing was found — the panel then asks the સંચાલક to
 *   point at the columns himself rather than guessing (§12: he is the one who knows).
 */
export function findHeaderRow(rows = []) {
  const limit = Math.min(rows.length, 25);
  for (let r = 0; r < limit; r++) {
    const cols = detectColumns(rows[r]);
    if (score(cols) >= 2) return { headerRow: r, columns: cols };
  }
  return { headerRow: -1, columns: { index: null, file: null, caption: null } };
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
  const { headerRow, columns } = findHeaderRow(rows);
  return {
    delimiter,
    delimiterLabel: delimiter === '\t' ? 'tab-separated' : delimiter === ';' ? 'semicolon-separated' : 'comma-separated',
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
 * Raw rows + a column mapping → the normalised `{ line, n, file, caption }` records the
 * plan is built from.
 *
 * `line` is the 1-based row number **in the pasted text**, so an error can name the row the
 * સંચાલક can see on his own screen. It is not the ક્રમ and the two are frequently different.
 *
 * Trimming happens here and only here. The live sheet has trailing spaces on several વર્ણન
 * and a trailing newline inside row 88's quoted field; untrimmed, each of those is a diff
 * against the stored caption that is invisible on screen, so the preview would promise a
 * change that changes nothing a યુવક can see.
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
    };
    // Wholly empty rows are spacing in the sheet, not દ્રશ્યો, and reporting 30 of them as
    // "no such દ્રશ્ય" would bury the ones that matter.
    if (rec.n === null && !rec.file && !rec.caption) continue;
    out.push(rec);
  }
  return out;
}

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
