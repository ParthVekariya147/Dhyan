/**
 * Source-agnostic reader for the દ્રશ્ય list.
 *
 * The scene list used to have exactly one home — a Google Sheet, fetched as CSV by
 * the content build. That was fine while one person maintained one tab. It stops being
 * fine the moment a batch of new દ્રશ્યો arrives as an Excel attachment, because then the
 * only way to publish it is to paste it into the sheet first, and a paste is a chance to
 * lose a row or mangle a વર્ણન.
 *
 * So the reader is now the boundary: `loadScenes()` takes either a URL's worth of sheet
 * coordinates or a local file, and everything downstream sees the same normalised
 * `{ n, file, t }` rows regardless. Adding a new input format means adding a decoder
 * here and nothing else.
 *
 * Two deliberate constraints:
 *
 *   1. **Zero dependencies.** An .xlsx is a ZIP of XML, and node ships both `zlib` and
 *      enough string handling to read one. A ~150-line reader we control beats pulling a
 *      1 MB parser into a project whose entire build is four scripts. The reader handles
 *      the shapes Excel and LibreOffice actually emit; if it meets anything else it says
 *      so and tells the સંચાલક to export CSV, because a *wrong* વર્ણન is far worse than a
 *      failed build.
 *
 *   2. **Layout tolerance, not layout assumptions.** The header row is found by looking
 *      for ક્રમ, never by counting lines — the live sheet has a merged title banner above
 *      it and the સંચાલક is free to add more. Columns are found by name, so inserting a
 *      column breaks nothing. English header names are accepted too, because an Excel
 *      export prepared by someone else will not necessarily be in Gujarati.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';

// ------------------------------------------------------------------ delimited text

/**
 * RFC-4180-ish parser: the વર્ણન column contains commas inside quotes.
 *
 * Used for TSV as well. Excel's "Text (Tab delimited)" export quotes any field holding a
 * tab, newline or quote by exactly these rules, so one parser covers both.
 */
export function parseDelimited(text, delimiter = ',') {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** Back-compat alias — this function has been `parseCSV` since the first version. */
export const parseCSV = (text) => parseDelimited(text, ',');

/**
 * Decode a text export to a JS string.
 *
 * Excel is the reason this exists. Its CSV exports carry a UTF-8 BOM (which would glue
 * itself to the first header cell and make `ક્રમ` unfindable), and "Unicode Text" exports
 * are UTF-16LE. Guessing wrong here is exactly how Gujarati turns into mojibake, so the
 * byte-order mark is honoured rather than assumed away.
 */
function decodeText(buf) {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf)
    return buf.toString('utf8', 3);
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.toString('utf16le', 2);
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff)
    throw new Error('file is UTF-16BE — re-export it as CSV UTF-8 and try again');
  return buf.toString('utf8');
}

// ------------------------------------------------------------------ xlsx (ZIP + XML)

/** Every failure in the xlsx path ends here, with the same escape hatch. */
const xlsxFail = (why) =>
  new Error(`cannot read .xlsx (${why}) — open it in Excel and "Save As → CSV UTF-8", then pass that file instead`);

/**
 * Index a ZIP by reading its central directory.
 *
 * Not by scanning for local file headers: local headers may declare sizes of zero and
 * defer them to a trailing data descriptor (streamed writers do this), whereas the
 * central directory is always authoritative. Reading it is also the only way to be sure
 * we have the *whole* archive rather than a truncated download.
 */
function zipIndex(buf) {
  const EOCD = 0x06054b50;
  // The EOCD is last, but a trailing comment (max 65535 bytes) can push it back.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66_000); i--) {
    if (buf.readUInt32LE(i) === EOCD) { eocd = i; break; }
  }
  if (eocd === -1) throw xlsxFail('not a ZIP archive, or truncated');

  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff) throw xlsxFail('ZIP64 archives are not supported');

  const entries = new Map();
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50)
      throw xlsxFail('central directory is malformed');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.set(name, { method, compSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Inflate one member. Method 0 (stored) is real: small XML parts are often not deflated. */
function zipRead(buf, entries, name) {
  const e = entries.get(name);
  if (!e) return null;
  if (buf.readUInt32LE(e.localOffset) !== 0x04034b50) throw xlsxFail(`local header for ${name} is malformed`);
  // The local header's own name/extra lengths are used, not the central directory's:
  // writers routinely put different extra fields in the two places.
  const nameLen = buf.readUInt16LE(e.localOffset + 26);
  const extraLen = buf.readUInt16LE(e.localOffset + 28);
  const start = e.localOffset + 30 + nameLen + extraLen;
  const raw = buf.subarray(start, start + e.compSize);
  if (e.method === 0) return raw.toString('utf8');
  if (e.method === 8) {
    try {
      return zlib.inflateRawSync(raw).toString('utf8');
    } catch {
      throw xlsxFail(`${name} did not inflate`);
    }
  }
  throw xlsxFail(`${name} uses compression method ${e.method}`);
}

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** `&#2709;` matters here — some writers escape non-ASCII, and Gujarati is all non-ASCII. */
const unescapeXml = (s) =>
  s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return XML_ENTITIES[body] ?? whole;
  });

/**
 * Text of one `<si>` / `<is>` element: the concatenation of its `<t>` children.
 *
 * A string that was edited mid-cell is stored as several `<r>` runs, one per formatting
 * change, and taking only the first `<t>` would silently truncate a વર્ણન. `<rPh>` holds
 * furigana for Japanese and must be dropped, not concatenated.
 */
function xmlText(fragment) {
  const body = fragment.replace(/<rPh[\s\S]*?<\/rPh>/g, '');
  let out = '';
  for (const m of body.matchAll(/<t(?:\s[^>]*)?\/>|<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) out += m[1] ?? '';
  return unescapeXml(out);
}

/** `BC12` → column 54 (0-based). Decoded rather than counted, so blank cells don't shift columns. */
function colOf(ref) {
  let n = 0;
  for (let i = 0; i < ref.length; i++) {
    const c = ref.charCodeAt(i);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

/**
 * Read the first worksheet of an .xlsx into a dense array of rows of strings.
 *
 * "First worksheet" means first in `xl/workbook.xml`'s `<sheets>` — tab order, which is
 * what a person means by "the first tab" — resolved through the relationship id, because
 * `sheet1.xml` is a storage name and is not required to be the leftmost tab.
 */
export function readXlsx(buf) {
  const entries = zipIndex(buf);

  const workbook = zipRead(buf, entries, 'xl/workbook.xml');
  if (!workbook) throw xlsxFail('no xl/workbook.xml — is this really an Excel file?');

  const first = workbook.match(/<sheet\b[^>]*\/?>/);
  if (!first) throw xlsxFail('workbook declares no sheets');
  const rid = first[0].match(/r:id="([^"]+)"/)?.[1];

  let target = null;
  const rels = zipRead(buf, entries, 'xl/_rels/workbook.xml.rels');
  if (rels && rid) {
    for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
      if (m[0].includes(`Id="${rid}"`)) target = m[0].match(/Target="([^"]+)"/)?.[1] ?? null;
    }
  }
  // Fall back to the conventional path: a hand-built or minimal workbook may ship no rels.
  const sheetPath = target
    ? `xl/${target.replace(/^\/?(xl\/)?/, '')}`
    : 'xl/worksheets/sheet1.xml';

  const sheet = zipRead(buf, entries, sheetPath);
  if (!sheet) throw xlsxFail(`${sheetPath} is missing`);

  const shared = [];
  const sst = zipRead(buf, entries, 'xl/sharedStrings.xml');
  if (sst) for (const m of sst.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(xmlText(m[1]));

  const rows = [];
  let cursor = 0; // used only when a <row> carries no r=, which is legal
  for (const rowM of sheet.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const rIdx = Number(rowM[1].match(/\br="(\d+)"/)?.[1]);
    const y = Number.isInteger(rIdx) && rIdx > 0 ? rIdx - 1 : cursor;
    cursor = y + 1;
    const row = rows[y] ?? (rows[y] = []);

    let x = 0;
    for (const cellM of rowM[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cellM[1];
      const inner = cellM[2] ?? '';
      const ref = attrs.match(/\br="([A-Z]+)\d+"/)?.[1];
      const at = ref ? colOf(ref) : x;
      x = at + 1;

      const type = attrs.match(/\bt="([^"]+)"/)?.[1] ?? 'n';
      let value = '';
      if (type === 's') {
        const i = Number(xmlText(inner) || inner.match(/<v>([\s\S]*?)<\/v>/)?.[1]);
        value = shared[i] ?? '';
      } else if (type === 'inlineStr') {
        value = xmlText(inner.match(/<is>([\s\S]*?)<\/is>/)?.[1] ?? inner);
      } else {
        // `str` is a formula's cached text result; `n`/`b`/anything else lands in <v> raw.
        value = unescapeXml(inner.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? '');
      }
      row[at] = value;
    }
  }

  // Holes exist wherever a row index was skipped; the header scanner must not trip on them.
  return Array.from(rows, (r) => Array.from(r ?? [], (c) => c ?? ''));
}

// ------------------------------------------------------------------ header location

/**
 * How each column is recognised.
 *
 * `gu` is matched by prefix and `en` by whole word after lower-casing, which is the split
 * that reflects reality: the Gujarati headers are long and get edited ("ફોટો ફાઈલ" is
 * spelled with ઈ in the live sheet and ઇ elsewhere), while an English export writes one
 * terse word. `ક્રમ` is deliberately not a prefix match — `ક્રમાંક` is listed explicitly so
 * that a stray "ક્રમશઃ" heading cannot be mistaken for the index column.
 */
const COLUMNS = {
  n: { gu: ['ક્રમ', 'ક્રમાંક'], guExact: true, en: ['n', 'no', 'no.', 'index', 'sr', 'sr no', 'srno', 'number'] },
  file: { gu: ['ફોટો'], en: ['file', 'filename', 'file name', 'image', 'photo', 'img'] },
  t: { gu: ['દ્રશ્ય-વર્ણન', 'દ્રશ્ય વર્ણન', 'વર્ણન'], en: ['caption', 'description', 'text', 'desc', 't'] },
};

const matches = (cell, spec) => {
  const raw = String(cell ?? '').trim();
  if (!raw) return false;
  if (spec.guExact ? spec.gu.includes(raw) : spec.gu.some((g) => raw.startsWith(g))) return true;
  const lower = raw.toLowerCase().replace(/[_\s]+/g, ' ').trim();
  return spec.en.includes(lower);
};

/**
 * Find the header row and the three columns in it.
 *
 * Scanned top-down for the first row containing an index header rather than assuming a
 * line number: the live sheet has a merged title banner on row 1, and an Excel export may
 * carry any amount of preamble above the table.
 */
function locate(grid, source) {
  const headerIdx = grid.findIndex((r) => r.some((c) => matches(c, COLUMNS.n)));
  if (headerIdx === -1) {
    throw new Error(
      `no header row found in ${source} — expected a cell reading ક્રમ (or n / index / no).\n` +
        `First rows seen:\n` +
        grid.slice(0, 5).map((r, i) => `  ${i + 1}: ${r.join(' | ')}`).join('\n')
    );
  }

  const header = grid[headerIdx];
  const col = {
    n: header.findIndex((c) => matches(c, COLUMNS.n)),
    file: header.findIndex((c) => matches(c, COLUMNS.file)),
    t: header.findIndex((c) => matches(c, COLUMNS.t)),
  };
  // `file` stays optional on purpose: it is the authoritative mapping *when present*, and
  // a sheet that omits it still builds, falling back to filename inference (naming.mjs).
  if (col.n === -1 || col.t === -1) {
    throw new Error(
      `could not find the required columns in ${source}.\n` +
        `Headers actually found: ${header.map((c) => c.trim()).filter(Boolean).join(' | ') || '(row is blank)'}\n` +
        `Expected: ક્રમ (or n/index/no) and દ્રશ્ય-વર્ણન (or caption/description/text).`
    );
  }
  return { headerIdx, col, header };
}

// ------------------------------------------------------------------ public API

/**
 * Load the scene list from whichever source was asked for.
 *
 * @param {{ file?: string, sheetId?: string, gid?: string }} opts
 * @returns {Promise<{ rows: Array<{ n: number, file: string, t: string }>, source: string, header: string[] }>}
 */
export async function loadScenes({ file, sheetId, gid } = {}) {
  let grid;
  let source;

  if (file) {
    const abs = path.resolve(file);
    if (!fs.existsSync(abs)) throw new Error(`no such file: ${abs}`);
    const buf = fs.readFileSync(abs);
    const ext = path.extname(abs).toLowerCase();
    source = abs;

    if (ext === '.xlsx') grid = readXlsx(buf);
    else if (ext === '.tsv' || ext === '.tab') grid = parseDelimited(decodeText(buf), '\t');
    else if (ext === '.csv' || ext === '.txt') grid = parseDelimited(decodeText(buf), ',');
    else if (ext === '.xls')
      throw new Error('.xls is the pre-2007 binary format — open it in Excel and save as .xlsx or CSV UTF-8');
    else throw new Error(`unsupported file type "${ext}" — use .csv, .tsv or .xlsx`);
  } else {
    if (!sheetId || !gid) throw new Error('loadScenes needs either { file } or { sheetId, gid }');
    // curl rather than fetch(): every other network call in this repo goes through it, it
    // follows Google's export redirect, and --fail turns an HTML error page into a non-zero
    // exit instead of a CSV parse of a login screen.
    const url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
    source = `Google Sheet ${sheetId} tab ${gid}`;
    const out = execFileSync('curl.exe', ['-sSL', '--fail', '--max-time', '60', url], { maxBuffer: 1 << 28 });
    grid = parseDelimited(decodeText(out), ',');
  }

  const { headerIdx, col, header } = locate(grid, source);

  const rows = grid
    .slice(headerIdx + 1)
    .filter((r) => r.some((c) => c && String(c).trim()))
    .map((r) => ({
      n: Number(String(r[col.n] ?? '').trim()),
      file: String((col.file === -1 ? '' : r[col.file]) ?? '').trim(),
      t: String(r[col.t] ?? '').trim(),
    }))
    .filter((s) => Number.isInteger(s.n) && s.n > 0)
    .sort((a, b) => a.n - b.n);

  return { rows, source, header: header.map((c) => String(c).trim()) };
}
