/**
 * .xlsx, read in a browser — the same reader as `scripts/lib/spreadsheet.mjs`, minus node.
 *
 * Why this exists
 * ---------------
 * The build pipeline has been able to read an Excel file since the day the સંચાલક first
 * sent one as an attachment. The panel could not: `scripts/lib/spreadsheet.mjs` opens with
 * `import fs`, `import zlib` and `execFileSync('curl.exe')`, none of which exists in a tab,
 * so `DarshanImportPage` accepted `.csv/.tsv/.txt` and told anyone holding an `.xlsx` to go
 * and re-save it first. That instruction is the failure: re-saving is where a row gets lost
 * and where a વર્ણન gets mangled, and it is asked of the one person least equipped to
 * notice either.
 *
 * So the reader is ported rather than the file re-invented. The ZIP walk, the XML text
 * extraction, the shared-string table, the column-letter decode and the "if this is not a
 * shape we know, say so and ask for CSV" posture are all the node reader's, line for line,
 * because they were arrived at by feeding it what Excel and LibreOffice actually emit. Two
 * small readers that agree beats one that has to run in both worlds — the same trade
 * `shared/domain/sheet-import.js` documents for its own parser.
 *
 * The one real difference
 * -----------------------
 * A browser has no `zlib`. It has `DecompressionStream('deflate-raw')`, which is the same
 * inflate and is **asynchronous**, so `readXlsx` returns a Promise where the node version
 * returns an array. That is a deviation from EXCEL_CONTRACT §9's signature and it is forced
 * by the platform: there is no synchronous inflate in a browser that does not mean shipping
 * one, and shipping one means a new dependency in a panel that has three.
 *
 * Everything else here is the same trade the node reader makes: ~200 lines we control and
 * can read, rather than a megabyte of parser, for a project whose entire build is four
 * scripts. Zero dependencies, no DOM, no network — the module is as testable as any other
 * in `shared/domain/`.
 */

/**
 * Every failure in this file ends here, with the same escape hatch the node reader offers.
 *
 * The escape hatch is the point. A malformed workbook has exactly two possible responses:
 * guess at it, or refuse and name a route that always works. Guessing puts the wrong વર્ણન
 * under the wrong દ્રશ્ય for 109 rows and nothing on screen says so, whereas "Save As →
 * CSV UTF-8" is a menu item the સંચાલક can find and a format this panel has read since the
 * first version. A wrong વર્ણન is far worse than a refused file.
 */
const xlsxFail = (why) =>
  new Error(
    `cannot read this .xlsx (${why}) — open it in Excel and "Save As → CSV UTF-8", then upload that file instead`
  );

/** One decoder, reused. Every part of an .xlsx is UTF-8 XML, and so are the ZIP names. */
const utf8 = new TextDecoder('utf-8');

// ------------------------------------------------------------------ bytes

/**
 * Whatever the caller had → a `Uint8Array`.
 *
 * `File.arrayBuffer()` gives an ArrayBuffer, `FileReader.readAsArrayBuffer` gives one too,
 * and a test fixture is usually already a typed array. Accepting all three costs four lines
 * and removes a class of "it worked in the test" bug. A view's `byteOffset` is honoured
 * rather than assumed to be zero — `Buffer`s handed over from node are frequently slices of
 * a larger pool, and ignoring the offset would read somebody else's bytes.
 */
function bytesOf(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw xlsxFail('that was not file data — expected an ArrayBuffer from File.arrayBuffer()');
}

/**
 * Little-endian reads with a bounds check, because a truncated download is a real input.
 *
 * `DataView` throws its own `RangeError` past the end, but the message ("Offset is outside
 * the bounds of the DataView") would reach the સંચાલક as a mystery. Checking first lets
 * every path end at `xlsxFail`, which tells him what to do instead.
 */
const u16 = (view, at) => {
  if (at + 2 > view.byteLength) throw xlsxFail('the file ends mid-record — it is truncated');
  return view.getUint16(at, true);
};
const u32 = (view, at) => {
  if (at + 4 > view.byteLength) throw xlsxFail('the file ends mid-record — it is truncated');
  return view.getUint32(at, true);
};

// ------------------------------------------------------------------ ZIP

/**
 * Index a ZIP by reading its central directory.
 *
 * Not by scanning for local file headers: local headers may declare sizes of zero and defer
 * them to a trailing data descriptor (streamed writers do this), whereas the central
 * directory is always authoritative. Reading it is also the only way to be sure we have the
 * *whole* archive rather than a truncated upload — an incomplete `.xlsx` dragged out of a
 * half-finished download otherwise parses as an empty workbook, which would import as
 * "0 rows" and read like an empty sheet rather than like a broken file.
 */
function zipIndex(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const EOCD = 0x06054b50;

  // The EOCD is last, but a trailing comment (max 65535 bytes) can push it back.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 66_000); i--) {
    if (view.getUint32(i, true) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw xlsxFail('not a ZIP archive, or truncated');

  const count = u16(view, eocd + 10);
  const cdOffset = u32(view, eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff) throw xlsxFail('ZIP64 archives are not supported');

  const entries = new Map();
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.length || u32(view, p) !== 0x02014b50) throw xlsxFail('central directory is malformed');
    const method = u16(view, p + 10);
    const compSize = u32(view, p + 20);
    const nameLen = u16(view, p + 28);
    const extraLen = u16(view, p + 30);
    const commentLen = u16(view, p + 32);
    const localOffset = u32(view, p + 42);
    const name = utf8.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    entries.set(name, { method, compSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return { view, entries };
}

/**
 * Raw DEFLATE → bytes, via the platform.
 *
 * `DecompressionStream` is the browser's own inflate; asking for it is what keeps this file
 * dependency-free. `'deflate-raw'` and not `'deflate'`: a ZIP member holds a bare DEFLATE
 * stream with no zlib header, and feeding it to the wrapped variant fails on the first byte.
 *
 * The write is deliberately not awaited. A stream that rejects its input (because the member
 * is corrupt) rejects `write()` *and* errors the readable side; awaiting the write would
 * surface a raw `TypeError` from the platform, whereas swallowing it lets `read()` throw and
 * every failure end at `xlsxFail` with the CSV escape hatch attached.
 */
async function inflateRaw(bytes, name) {
  if (typeof DecompressionStream !== 'function') {
    throw xlsxFail('this browser cannot unzip files — it has no DecompressionStream');
  }

  const stream = new DecompressionStream('deflate-raw');
  const writer = stream.writable.getWriter();
  writer.write(bytes).catch(() => {});
  writer.close().catch(() => {});

  const reader = stream.readable.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
  } catch {
    throw xlsxFail(`${name} did not inflate`);
  }

  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/** Read one member as text. Method 0 (stored) is real: small XML parts are often not deflated. */
async function zipRead(bytes, { view, entries }, name) {
  const e = entries.get(name);
  if (!e) return null;
  if (u32(view, e.localOffset) !== 0x04034b50) throw xlsxFail(`local header for ${name} is malformed`);

  // The local header's own name/extra lengths are used, not the central directory's:
  // writers routinely put different extra fields in the two places.
  const nameLen = u16(view, e.localOffset + 26);
  const extraLen = u16(view, e.localOffset + 28);
  const start = e.localOffset + 30 + nameLen + extraLen;
  const raw = bytes.subarray(start, start + e.compSize);

  if (e.method === 0) return utf8.decode(raw);
  if (e.method === 8) return utf8.decode(await inflateRaw(raw, name));
  throw xlsxFail(`${name} uses compression method ${e.method}`);
}

// ------------------------------------------------------------------ XML

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** `&#2709;` matters here — some writers escape non-ASCII, and Gujarati is all non-ASCII. */
const unescapeXml = (s) =>
  s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
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
  const body = String(fragment ?? '').replace(/<rPh[\s\S]*?<\/rPh>/g, '');
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

// ------------------------------------------------------------------ public API

/**
 * The first worksheet of an .xlsx, as a dense array of rows of strings.
 *
 * "First worksheet" means first in `xl/workbook.xml`'s `<sheets>` — tab order, which is what
 * a person means by "the first tab" — resolved through the relationship id, because
 * `sheet1.xml` is a storage name and is not required to be the leftmost tab.
 *
 * Everything comes back as a **string**, including numbers. That is not laziness: a ક્રમ is
 * a label as often as it is a quantity, `27` and `27.0` are the same દ્રશ્ય, and the column
 * parsers in `shared/domain/darshan-excel.js` already have to accept the text a CSV gives
 * them. One representation, one set of parsers.
 *
 * @param {ArrayBuffer|Uint8Array} arrayBuffer the file's bytes
 * @returns {Promise<string[][]>} rows of raw cells — nothing trimmed, nothing interpreted
 */
export async function readXlsx(arrayBuffer) {
  const bytes = bytesOf(arrayBuffer);
  const zip = zipIndex(bytes);

  const workbook = await zipRead(bytes, zip, 'xl/workbook.xml');
  if (!workbook) throw xlsxFail('no xl/workbook.xml — is this really an Excel file?');

  const first = workbook.match(/<sheet\b[^>]*\/?>/);
  if (!first) throw xlsxFail('the workbook declares no sheets');
  const rid = first[0].match(/r:id="([^"]+)"/)?.[1];

  let target = null;
  const rels = await zipRead(bytes, zip, 'xl/_rels/workbook.xml.rels');
  if (rels && rid) {
    for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
      if (m[0].includes(`Id="${rid}"`)) target = m[0].match(/Target="([^"]+)"/)?.[1] ?? null;
    }
  }
  // Fall back to the conventional path: a hand-built or minimal workbook may ship no rels.
  const sheetPath = target ? `xl/${target.replace(/^\/?(xl\/)?/, '')}` : 'xl/worksheets/sheet1.xml';

  const sheet = await zipRead(bytes, zip, sheetPath);
  if (!sheet) throw xlsxFail(`${sheetPath} is missing`);

  const shared = [];
  const sst = await zipRead(bytes, zip, 'xl/sharedStrings.xml');
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
