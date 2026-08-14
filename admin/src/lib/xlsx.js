/**
 * §11 — a real .xlsx, written by hand, in the browser.
 *
 * `./export.js` explains why the panel shipped CSV first and why CSV must keep working: a
 * CSV opens on double-click and costs nothing. What it costs is *type*. Every cell in a CSV
 * is text until Excel guesses otherwise, and Excel guesses badly on exactly the two columns
 * a સંચાલક wants to work with — a count he wants to SUM, and a date he wants to sort or
 * filter by. `2026-08-11` in a CSV lands as text on a machine whose locale is dd/mm/yyyy,
 * and then August sorts before February. That is the whole reason this file exists.
 *
 * Why hand-written and not a library
 * ----------------------------------
 * The panel has three dependencies (react, react-router, supabase-js) and the app is served
 * to phones on a budget. A .xlsx writer from npm is 500 KB to a megabyte of parser for
 * something we only ever ask to do one thing: emit one flat sheet with a bold header. An
 * .xlsx is a ZIP of six small XML parts; that is roughly two hundred lines we control and
 * can read, which is the same trade `shared/domain/xlsx-read.js` already made for reading.
 * Those two are deliberate mirror images — the reader is the strongest test this writer has,
 * and `scripts/test-xlsx.mjs` feeds every workbook it builds straight back through it.
 *
 * Why STORE and not DEFLATE
 * -------------------------
 * ZIP method 0 — the bytes go in as they are. `CompressionStream` exists in a browser but is
 * asynchronous, which would make `buildXlsx()` return a Promise and force every call site to
 * become async for no benefit the person downloading the file can perceive. A progress
 * report is a few hundred rows; stored XML is tens of kilobytes and the saving would be
 * invisible next to the photos this app already ships. Excel opens a stored archive without
 * complaint, and an uncompressed member is a member a test can read back byte for byte.
 *
 * Browser code only
 * -----------------
 * `Uint8Array`, `TextEncoder`, `Blob`. No `Buffer`, no `zlib`, no `fs` — this module is
 * bundled into the panel by `admin/vite.config.js`, and anything node-only would either
 * break the build or quietly pull a polyfill into a bundle we watch the size of.
 */

import { istDate } from './export.js';

// ------------------------------------------------------------------ text

/** One encoder, reused. Every byte this module writes is UTF-8 — part names included. */
const utf8 = new TextEncoder();

/**
 * Characters XML 1.0 cannot carry at all, at any escaping.
 *
 * This is not politeness, it is the difference between a file that opens and a file that
 * does not. `&#1;` is not a legal escape — there is no way to spell a control character in
 * XML 1.0 — so a stray U+0001 pasted into a યુવક's name from a badly-copied WhatsApp
 * message would make Excel refuse the entire workbook with "unreadable content", and the
 * સંચાલક would have no idea which of two thousand rows did it. They are removed instead.
 * Tab, LF and CR are the three that are legal and are deliberately kept.
 */
const XML_ILLEGAL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;

/**
 * A string, safe to place in XML content or in an attribute value.
 *
 * Stripping runs before escaping so that a control character cannot survive as the body of
 * an entity, and `&` is escaped before the others so `<` never becomes `&amp;lt;`.
 */
export function escapeXml(value) {
  return String(value ?? '')
    .replace(XML_ILLEGAL, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * The same two rules `csvCell()` in ./export.js applies, minus the CSV quoting.
 *
 * Kept as its own function rather than reusing `csvCell` because that one also wraps the
 * result in quotes and doubles the quotes inside it — correct for RFC 4180 and wrong inside
 * an `<is><t>`, where the quotes would become part of the name. The *decision* is identical
 * and `scripts/test-xlsx.mjs` asserts the two agree cell for cell, so they cannot drift.
 *
 * The threat is identical too: Excel evaluates a cell whose text begins =, +, - or @ as a
 * formula whichever container it arrived in. A name typed `=cmd` gets a leading apostrophe,
 * which is visible and therefore worth seeing. A value that is entirely a number is left
 * alone, so `-5` stays a number the spreadsheet can sum.
 */
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;
const FORMULA_START = /^[=+\-@\t\r]/;

export function guardText(value) {
  // Stripping happens *before* the guard, not after, and the order is the whole point: a
  // value of "=cmd" does not start with = while the control character is still on the
  // front, so a guard that ran first would wave it through and the stripper would then hand
  // Excel a live formula. This is the one ordering in the file that is a security property.
  const s = String(value ?? '').replace(XML_ILLEGAL, '');
  if (s === '') return '';
  return FORMULA_START.test(s) && !PLAIN_NUMBER.test(s) ? `'${s}` : s;
}

// ------------------------------------------------------------------ dates

/**
 * Excel's day zero is 1899-12-30, not 1899-12-31.
 *
 * The one-day gap is Lotus 1-2-3's 1900 leap-year bug, which Excel copied on purpose for
 * compatibility and has carried ever since. Anchoring here rather than at 1900-01-01 makes
 * the arithmetic a plain subtraction with no special case: 1900-01-01 is serial 2, the Unix
 * epoch is 25569, and everything after that is right without a correction term.
 */
const EPOCH_OFFSET = 25569; // days from 1899-12-30 to 1970-01-01
const MS_PER_DAY = 86400000;
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A timestamptz, a Date or a `YYYY-MM-DD` → the Excel serial for that **IST** day.
 *
 * The IST part is not decoration. A row created at 23:10 in Ahmedabad is 17:40 UTC on the
 * same date, but a row created at 01:00 IST is 19:30 UTC on the *previous* one, and a report
 * whose dates silently shift backwards for everything before half past five in the morning
 * is a report nobody can reconcile. `istDate()` from ./export.js is the single place that
 * decides which day an instant belongs to, and both formats ask it, so the .xlsx and the
 * .csv of the same query can never disagree about a date.
 *
 * Whole days only — no fractional part. §11's columns are calendar days, and a serial with
 * a time on it renders as `2026-08-11 00:00` in some locales, which is noise.
 *
 * @returns {number|null} the serial, or null when there is no date to write
 */
export function excelSerial(value) {
  const ymd = ISO_DAY.test(String(value ?? '')) ? String(value) : istDate(value);
  const m = ISO_DAY.exec(ymd);
  if (!m) return null;
  // Date.UTC here is calendar arithmetic, never an instant: the IST day has already been
  // chosen above, and this only asks how many days that calendar date is from the epoch.
  return Date.UTC(+m[1], +m[2] - 1, +m[3]) / MS_PER_DAY + EPOCH_OFFSET;
}

// ------------------------------------------------------------------ CRC-32

/**
 * The standard reflected CRC-32 (polynomial 0xEDB88320), table-driven.
 *
 * A ZIP entry carries its checksum twice, in the local header and in the central directory,
 * and Excel verifies it. Get one byte of this wrong and the workbook is "corrupt" with no
 * further explanation, so `scripts/test-xlsx.mjs` pins it against the known answer for
 * "123456789" (0xCBF43926) as well as recomputing every entry from the archive it produced.
 *
 * The table is built once, lazily — 256 entries is nothing, but this module is imported by
 * pages that may never export anything.
 */
let CRC_TABLE = null;

function crcTable() {
  if (CRC_TABLE) return CRC_TABLE;
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  CRC_TABLE = table;
  return table;
}

export function crc32(bytes) {
  const table = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ------------------------------------------------------------------ ZIP

/**
 * A fixed DOS timestamp: 1980-01-01 00:00, the earliest the format can express.
 *
 * Deliberately not `new Date()`. The same rows must produce the same bytes every time, so a
 * test can compare two builds and a reviewer can diff a fixture; a wall clock inside the
 * output makes both impossible. Nothing reads a ZIP member's mtime here — the filename
 * carries the date the report was cut on (see `reportFilename()` in ./export.js).
 */
const DOS_DATE = 0x0021; // year 1980, month 1, day 1
const DOS_TIME = 0x0000;

/** Little-endian writers. A ZIP is little-endian throughout, on every platform. */
const put16 = (out, at, v) => {
  out[at] = v & 0xff;
  out[at + 1] = (v >>> 8) & 0xff;
};
const put32 = (out, at, v) => {
  out[at] = v & 0xff;
  out[at + 1] = (v >>> 8) & 0xff;
  out[at + 2] = (v >>> 16) & 0xff;
  out[at + 3] = (v >>> 24) & 0xff;
};

/**
 * `[{ name, bytes }]` → one ZIP archive, every member stored (method 0).
 *
 * Bit 11 of the general-purpose flag is set on every entry: it declares the filename to be
 * UTF-8 rather than the ancient CP437, which costs nothing here (our part names are all
 * ASCII) and is what a reader looks at before trusting a non-ASCII name.
 *
 * The layout is the one `shared/domain/xlsx-read.js` walks in reverse: local header + data
 * for each member, then the central directory, then the end-of-central-directory record
 * pointing back at it. Sizes are known up front because nothing is compressed, so no entry
 * needs a trailing data descriptor.
 */
export function zipStore(files) {
  const entries = files.map((f) => {
    const name = utf8.encode(f.name);
    return { name, bytes: f.bytes, crc: crc32(f.bytes), offset: 0 };
  });

  const LOCAL = 30;
  const CENTRAL = 46;
  const EOCD = 22;

  let localSize = 0;
  let centralSize = 0;
  for (const e of entries) {
    localSize += LOCAL + e.name.length + e.bytes.length;
    centralSize += CENTRAL + e.name.length;
  }

  const out = new Uint8Array(localSize + centralSize + EOCD);
  let at = 0;

  for (const e of entries) {
    e.offset = at;
    put32(out, at, 0x04034b50); // local file header signature
    put16(out, at + 4, 20); // version needed to extract — 2.0, plain stored/deflated
    put16(out, at + 6, 0x0800); // flags: bit 11, the name is UTF-8
    put16(out, at + 8, 0); // method 0 — stored
    put16(out, at + 10, DOS_TIME);
    put16(out, at + 12, DOS_DATE);
    put32(out, at + 14, e.crc);
    put32(out, at + 18, e.bytes.length); // compressed size == uncompressed, stored
    put32(out, at + 22, e.bytes.length);
    put16(out, at + 26, e.name.length);
    put16(out, at + 28, 0); // no extra field
    out.set(e.name, at + 30);
    out.set(e.bytes, at + 30 + e.name.length);
    at += LOCAL + e.name.length + e.bytes.length;
  }

  const cdOffset = at;
  for (const e of entries) {
    put32(out, at, 0x02014b50); // central directory header signature
    put16(out, at + 4, 20); // version made by
    put16(out, at + 6, 20); // version needed
    put16(out, at + 8, 0x0800);
    put16(out, at + 10, 0);
    put16(out, at + 12, DOS_TIME);
    put16(out, at + 14, DOS_DATE);
    put32(out, at + 16, e.crc);
    put32(out, at + 20, e.bytes.length);
    put32(out, at + 24, e.bytes.length);
    put16(out, at + 28, e.name.length);
    put16(out, at + 30, 0); // extra
    put16(out, at + 32, 0); // comment
    put16(out, at + 34, 0); // disk number start
    put16(out, at + 36, 0); // internal attributes
    put32(out, at + 38, 0); // external attributes
    put32(out, at + 42, e.offset);
    out.set(e.name, at + 46);
    at += CENTRAL + e.name.length;
  }

  put32(out, at, 0x06054b50); // end of central directory
  put16(out, at + 4, 0); // this disk
  put16(out, at + 6, 0); // disk with the central directory
  put16(out, at + 8, entries.length);
  put16(out, at + 10, entries.length);
  put32(out, at + 12, at - cdOffset);
  put32(out, at + 16, cdOffset);
  put16(out, at + 20, 0); // no archive comment

  return out;
}

// ------------------------------------------------------------------ the parts

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const CONTENT_TYPES = `${XML_DECL}
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

const ROOT_RELS = `${XML_DECL}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const WORKBOOK_RELS = `${XML_DECL}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="${NS_REL}/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="${NS_REL}/styles" Target="styles.xml"/>
</Relationships>`;

/**
 * Three cell formats, which is all this panel has ever needed.
 *
 *   s="0"  plain — text and numbers
 *   s="1"  bold — the header row (requirement: the સંચાલક must be able to see where the
 *          data starts when he prints it, and Excel's own "format as table" is not applied)
 *   s="2"  the date format, `yyyy-mm-dd`, matching `istDate()` exactly so the cell reads the
 *          same as the CSV of the same query while still being a real date underneath.
 *
 * numFmtId 164 is the first id available to a document; everything below 164 is reserved for
 * Excel's built-ins. Colours are given as explicit rgb rather than `theme="1"` so that no
 * theme part is needed — one fewer part, one fewer thing to get wrong.
 */
const STYLES = `${XML_DECL}
<styleSheet xmlns="${NS_MAIN}">
<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts>
<fonts count="2">
<font><sz val="11"/><color rgb="FF000000"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FF000000"/><name val="Calibri"/><family val="2"/></font>
</fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="3">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/** Style ids, named so the sheet builder does not read as a row of magic numbers. */
const S_PLAIN = 0;
const S_HEADER = 1;
const S_DATE = 2;

/**
 * Excel's own rules for a tab name, applied here rather than discovered on open.
 *
 * `: \ / ? * [ ]` are refused by Excel outright and 31 characters is the hard limit; a
 * workbook that breaks either is rejected as corrupt, which reads to the સંચાલક as "the
 * export is broken" when in fact the sheet was called something reasonable in Gujarati and
 * one character too long. Gujarati is fine in a tab name and is not touched.
 */
function safeSheetName(name) {
  const s = String(name ?? '').replace(/[\\/?*[\]:]/g, ' ').trim();
  return s ? s.slice(0, 31) : 'Sheet1';
}

/** 0 → A, 25 → Z, 26 → AA. The inverse of `colOf()` in shared/domain/xlsx-read.js. */
export function colName(index) {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - r) / 26);
  }
  return out;
}

// ------------------------------------------------------------------ cells

/**
 * One column spec + one row → what actually goes in the cell.
 *
 * The column shape is `./export.js`'s, unchanged — `{ label, value, key, type }` — so the
 * *same* array can be handed to `toCsv()` and to `buildXlsx()` and the two files hold the
 * same columns in the same order. That is the point of mirroring it: a column added for one
 * format is a column present in the other, and there is no second list to forget.
 */
function readCell(column, row) {
  return typeof column.value === 'function' ? column.value(row) : row?.[column.key];
}

/**
 * A raw value + a declared type → `{ xml, text }`.
 *
 * `text` is the rendered width contribution and nothing else; `xml` is the cell. The two are
 * produced together so a column can never be measured as one thing and written as another.
 *
 *   number → `<c t="n"><v>103</v></c>`. Not an inline string: the whole reason this file
 *            exists is that a count must be summable. A value that is not a finite number
 *            falls back to text rather than writing `NaN` into a numeric cell, which Excel
 *            reads as a corrupt workbook.
 *   date   → a bare serial with s="2". No `t` attribute, because a date *is* a number in
 *            Excel and the number format is what makes it render as one.
 *   text   → `t="inlineStr"` with `<is><t>`. Inline rather than a shared-strings table:
 *            no second part, no index to keep in step, and one export is not written twice.
 *   empty  → `<c r="A1"/>`, a cell that exists and holds nothing. Emitting the ref keeps the
 *            row dense for a reader that decodes column letters, and an empty `<t></t>` would
 *            be a value where the સંચાલક wants a blank he can filter on.
 */
function cellXml(ref, value, type) {
  if (type === 'number') {
    // NaN and ±Infinity are numbers that no cell can hold. Falling through to the text
    // branch would write the *word* "NaN" into a column of counts, which reads as data.
    if (typeof value === 'number' && !Number.isFinite(value)) return { xml: `<c r="${ref}"/>`, text: '' };

    const n = typeof value === 'number' ? value : Number(String(value ?? '').trim());
    if (value !== null && value !== undefined && String(value).trim() !== '' && Number.isFinite(n)) {
      return { xml: `<c r="${ref}" s="${S_PLAIN}" t="n"><v>${n}</v></c>`, text: String(n) };
    }
  }

  if (type === 'date') {
    const serial = excelSerial(value);
    if (serial !== null) {
      return { xml: `<c r="${ref}" s="${S_DATE}"><v>${serial}</v></c>`, text: '0000-00-00' };
    }
  }

  const text = guardText(value);
  if (text === '') return { xml: `<c r="${ref}"/>`, text: '' };

  // xml:space="preserve" or Excel eats a leading/trailing space, which matters for a name
  // somebody typed with one and would otherwise silently differ from the CSV of the same row.
  return {
    xml: `<c r="${ref}" s="${S_PLAIN}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`,
    text,
  };
}

/** Widths, clamped. Roughly one character per unit, plus room for the filter arrow. */
const MIN_WIDTH = 8;
const MAX_WIDTH = 60;

const clampWidth = (chars) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round((chars + 2) * 10) / 10));

// ------------------------------------------------------------------ public API

/**
 * Rows + a column spec → the bytes of a complete .xlsx.
 *
 * Synchronous and pure: no DOM, no clock, no network. The same input gives the same bytes,
 * which is what lets `scripts/test-xlsx.mjs` unzip the result and check it against
 * `shared/domain/xlsx-read.js` instead of against a screenshot of Excel.
 *
 * An empty `rows` array is a legitimate export and produces a valid workbook holding just
 * the header — a report that matched nothing must still open, and hand the સંચાલક a file
 * that visibly says "these are the columns, and none of them had a row today".
 *
 * @param {object} spec
 * @param {string} [spec.sheetName] tab name; sanitised to Excel's rules
 * @param {Array<{label:string,value?:Function,key?:string,type?:'text'|'number'|'date'}>} spec.columns
 * @param {Array<object>} spec.rows
 * @returns {Uint8Array} the file
 */
export function buildXlsx({ sheetName, columns, rows } = {}) {
  const cols = Array.isArray(columns) ? columns : [];
  const list = Array.isArray(rows) ? rows : [];

  const widths = cols.map((c) => String(c?.label ?? '').length);
  const body = [];

  // Row 1 is the header. Bold, and frozen below (see the pane in the sheetView).
  const header = cols
    .map((c, i) => `<c r="${colName(i)}1" s="${S_HEADER}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(guardText(c?.label))}</t></is></c>`)
    .join('');
  body.push(`<row r="1">${header}</row>`);

  list.forEach((row, r) => {
    const n = r + 2; // 1-based, and row 1 is the header
    const cells = cols
      .map((c, i) => {
        const cell = cellXml(`${colName(i)}${n}`, readCell(c, row), c?.type);
        if (cell.text.length > widths[i]) widths[i] = cell.text.length;
        return cell.xml;
      })
      .join('');
    body.push(`<row r="${n}">${cells}</row>`);
  });

  const colsXml = cols.length
    ? `<cols>${cols
        .map((_, i) => `<col min="${i + 1}" max="${i + 1}" width="${clampWidth(widths[i])}" customWidth="1"/>`)
        .join('')}</cols>`
    : '';

  // ySplit="1" freezes exactly the header row: scroll two thousand યુવકો and the column
  // names stay on screen, which is the difference between a usable report and a guess at
  // which column is which by the two hundredth row.
  const sheet = `${XML_DECL}
<worksheet xmlns="${NS_MAIN}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>${colsXml}<sheetData>${body.join('')}</sheetData></worksheet>`;

  const workbook = `${XML_DECL}
<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><sheets><sheet name="${escapeXml(safeSheetName(sheetName))}" sheetId="1" r:id="rId1"/></sheets></workbook>`;

  return zipStore([
    { name: '[Content_Types].xml', bytes: utf8.encode(CONTENT_TYPES) },
    { name: '_rels/.rels', bytes: utf8.encode(ROOT_RELS) },
    { name: 'xl/workbook.xml', bytes: utf8.encode(workbook) },
    { name: 'xl/_rels/workbook.xml.rels', bytes: utf8.encode(WORKBOOK_RELS) },
    { name: 'xl/styles.xml', bytes: utf8.encode(STYLES) },
    { name: 'xl/worksheets/sheet1.xml', bytes: utf8.encode(sheet) },
  ]);
}

/** The one MIME type Windows, macOS and every browser agree means "this is a workbook". */
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Hand the file to the browser. Same shape, and the same reasoning, as `downloadCsv()`.
 *
 * The object URL is revoked on the next tick — revoking it synchronously can beat the
 * download in some browsers, and never revoking it holds the whole file in memory until the
 * tab closes.
 */
export function downloadXlsx(filename, bytes) {
  if (typeof document === 'undefined' || typeof URL?.createObjectURL !== 'function') return false;

  const url = URL.createObjectURL(new Blob([bytes], { type: XLSX_MIME }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return true;
}

/**
 * Build and download in one call, and answer how many rows went out.
 *
 * The count is returned rather than assumed by the caller, exactly as `exportCsv()` does, so
 * the sentence a page shows afterwards ("Exported 1,840 users") is derived from the file
 * that was actually written (§62) and cannot claim a number the export did not contain.
 */
export function exportXlsx({ filename, sheetName, columns, rows }) {
  const list = Array.isArray(rows) ? rows : [];
  downloadXlsx(filename, buildXlsx({ sheetName, columns, rows: list }));
  return list.length;
}

/**
 * `reportFilename()` with an .xlsx extension.
 *
 * That function is CSV's and ends in `.csv`; rather than change it — nine call sites depend
 * on the name it produces — the extension is swapped here, so both formats keep the same
 * ASCII-only, WhatsApp-safe stem for the same query and sort next to each other in a folder.
 */
export function xlsxFilename(csvName) {
  return String(csvName ?? '').replace(/\.(csv|xlsx)$/i, '') + '.xlsx';
}
