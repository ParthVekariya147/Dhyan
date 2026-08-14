/**
 * Tests for the .xlsx writer — `node scripts/test-xlsx.mjs`.
 *
 * Same shape as scripts/test-darshan-excel.mjs and scripts/test-points.mjs, and for the same
 * reason: `admin/src/lib/xlsx.js` is a pure function from rows to bytes — no DOM, no clock,
 * no network — so it can be tested exactly and cheaply, and adding a framework to run
 * assertions on one module is not worth a dependency. Exit code is the result: 0 green, 1 red.
 *
 * Why this file is unusually paranoid
 * -----------------------------------
 * Excel does not exist on this machine and will never run in CI, so "it opens" cannot be
 * asserted. What *can* be asserted is every property that, if broken, makes it not open — and
 * a hand-written ZIP has a lot of those. Each one below fails **silently** here and loudly in
 * the સંચાલક's hands, days later, with no way to tell which of two thousand rows did it:
 *
 *   1. **The CRC.** A ZIP carries each member's checksum twice and Excel verifies both. One
 *      wrong byte and the whole workbook is "corrupt" with no further explanation — not one
 *      bad cell, the entire file. So the CRC is pinned against the standard known answer
 *      (CRC-32 of "123456789" is 0xCBF43926) *and* recomputed from the archive's own stored
 *      bytes for every part, by an unzipper written here rather than by the writer's own code.
 *
 *   2. **Numbers arriving as text.** This is the whole reason the .xlsx exists — a count the
 *      સંચાલક cannot SUM is a count he has to add up by hand, and a text cell holding "103"
 *      looks *identical* on screen to a number holding 103. Asserted as `t="n"` present and
 *      `inlineStr` absent, on the cell itself.
 *
 *   3. **Dates arriving as text, or as the wrong day.** `2026-08-11` as text sorts August
 *      before February on a dd/mm/yyyy machine. And the serial is an off-by-one waiting to
 *      happen: Excel's day zero is 1899-12-30, not 1899-12-31, because it copied Lotus's 1900
 *      leap-year bug. Both ends are pinned to exact integers.
 *
 *   4. **Gujarati.** નામ, ઝોન, સબઝોન — the reason ./export.js carries a BOM. Here it is UTF-8
 *      all the way down, and a workbook that mangles a યુવક's name is worthless to the person
 *      who asked for it. Asserted byte-exact through the encoder and back through the reader.
 *
 *   5. **A control character killing the file.** `&#1;` is not a legal XML 1.0 escape; there
 *      is *no* way to spell U+0001 in XML. One pasted out of a WhatsApp copy makes Excel
 *      refuse the workbook. Asserted stripped, not escaped.
 *
 *   6. **Formula injection.** `csvCell()` neutralises `=cmd` for the CSV; a cell that begins
 *      =, +, - or @ is evaluated by Excel whichever container it arrived in, so the .xlsx must
 *      do the same. Asserted, and asserted to *agree with csvCell cell for cell* so the two
 *      encoders cannot drift apart.
 *
 *   7. **The empty report.** A filter that matched nothing must still produce a workbook that
 *      opens and shows its columns, not a zero-byte file the સંચાલક reports as "broken".
 *
 * The strongest assertion here is the last group: every workbook is fed straight back through
 * `shared/domain/xlsx-read.js`, the reader the Darshan importer already uses in production.
 * Writer and reader were written apart and agree on the format or neither works.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { csvCell } from '../admin/src/lib/export.js';
import {
  buildXlsx,
  exportXlsx,
  crc32,
  colName,
  escapeXml,
  guardText,
  excelSerial,
  xlsxFilename,
} from '../admin/src/lib/xlsx.js';
import { readXlsx } from '../shared/domain/xlsx-read.js';

let pass = 0;
const fails = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) pass++;
  else fails.push(`${name}\n       got  ${g}\n       want ${w}`);
};

const group = (name) => console.log(`\n  ${name}`);

// ==================================================================== an unzipper of our own

/**
 * A second, independent ZIP reader — deliberately not the writer's and not the panel's.
 *
 * `shared/domain/xlsx-read.js` is used further down as the real-world consumer, but it is
 * forgiving by design (it falls back to sheet1.xml when rels are missing, it ignores the CRC
 * entirely). Checking the archive with the same forgiving code that has to survive Excel's
 * output would let a broken header through. This one is strict and checks the things a
 * reader normally trusts: both copies of every size, both copies of every CRC, and that the
 * central directory's offsets land on real local headers.
 */
const dv = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const decoder = new TextDecoder('utf-8');

function unzip(bytes) {
  const view = dv(bytes);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error('no end-of-central-directory record');

  const count = view.getUint16(eocd + 10, true);
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);

  const parts = new Map();
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error(`central header ${i} is malformed`);
    const method = view.getUint16(p + 10, true);
    const crc = view.getUint32(p + 16, true);
    const compSize = view.getUint32(p + 20, true);
    const size = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));

    if (view.getUint32(local, true) !== 0x04034b50) throw new Error(`local header for ${name} is malformed`);
    const lFlags = view.getUint16(local + 6, true);
    const lMethod = view.getUint16(local + 8, true);
    const lCrc = view.getUint32(local + 14, true);
    const lComp = view.getUint32(local + 18, true);
    const lSize = view.getUint32(local + 22, true);
    const lNameLen = view.getUint16(local + 26, true);
    const lExtraLen = view.getUint16(local + 28, true);
    const start = local + 30 + lNameLen + lExtraLen;
    const data = bytes.subarray(start, start + lComp);

    parts.set(name, {
      method,
      lMethod,
      crc,
      lCrc,
      compSize,
      size,
      lComp,
      lSize,
      utf8Flag: (lFlags & 0x0800) !== 0,
      data,
      text: method === 0 ? decoder.decode(data) : null,
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return { parts, count, cdSize, cdOffset, cdSizeReal: p - cdOffset, eocd };
}

/**
 * Well-formedness, checked without an XML parser (node ships none).
 *
 * Not a schema check and not pretending to be one — it catches the failures a string-built
 * XML file actually has: an unbalanced tag, a stray `<` or `&` that escaped escaping, and a
 * character XML 1.0 cannot carry. Those are precisely what a typo in this writer produces.
 */
function xmlWellFormed(text) {
  if (!text.startsWith('<?xml ')) return 'no XML declaration';
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text)) return 'holds a character XML 1.0 forbids';
  // Every & must open a real entity.
  const stray = text.match(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/);
  if (stray) return `unescaped & near "${text.slice(Math.max(0, stray.index - 20), stray.index + 20)}"`;

  const stack = [];
  for (const m of text.matchAll(/<(\/?)([A-Za-z_][\w:.-]*)([^>]*?)(\/?)>/g)) {
    const [, closing, tag, attrs, selfClose] = m;
    if (closing) {
      if (stack.pop() !== tag) return `</${tag}> does not close what is open`;
    } else if (!selfClose && !attrs.endsWith('/')) {
      stack.push(tag);
    }
  }
  if (stack.length) return `never closed: ${stack.join(', ')}`;
  // Nothing outside a tag may hold a bare <.
  if (/<[^!?/A-Za-z]/.test(text)) return 'a bare < survived escaping';
  return null;
}

const REQUIRED_PARTS = [
  '[Content_Types].xml',
  '_rels/.rels',
  'xl/workbook.xml',
  'xl/_rels/workbook.xml.rels',
  'xl/worksheets/sheet1.xml',
  'xl/styles.xml',
];

/** The columns a §11 progress report actually has: a name, a count, a day. */
const COLUMNS = [
  { label: 'નામ', value: (r) => r.name },
  { label: 'Zone', value: (r) => r.zone },
  { label: 'Darshan seen', value: (r) => r.seen, type: 'number' },
  { label: 'Last seen', value: (r) => r.at, type: 'date' },
];

const ROWS = [
  { name: 'પરેશ', zone: 'Surat', seen: 103, at: '2026-08-14T09:12:00+05:30' },
  { name: 'ભુપતભાઈ ભીમાભાઇ કાતરીયા', zone: 'Rajkot', seen: 7, at: '2026-08-11T22:40:00Z' },
  { name: '', zone: null, seen: 0, at: null },
];

const book = buildXlsx({ sheetName: 'પ્રગતિ', columns: COLUMNS, rows: ROWS });
const zip = unzip(book);
const sheet = zip.parts.get('xl/worksheets/sheet1.xml').text;

// ==================================================================== CRC-32

group('CRC-32 - one wrong byte and Excel calls the whole workbook corrupt');
{
  eq('the known answer for "123456789" is 0xCBF43926', crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  eq('the empty input is 0', crc32(new Uint8Array(0)), 0);
  eq('a single zero byte is 0xD202EF8D', crc32(new Uint8Array([0])), 0xd202ef8d);
  eq('"a" is 0xE8B7BE43', crc32(new TextEncoder().encode('a')), 0xe8b7be43);
  // Table-driven and byte-at-a-time must agree over a long, high-byte input.
  const long = new TextEncoder().encode('ભુપતભાઈ '.repeat(500));
  let ref = 0xffffffff;
  for (const b of long) {
    ref ^= b;
    for (let k = 0; k < 8; k++) ref = ref & 1 ? 0xedb88320 ^ (ref >>> 1) : ref >>> 1;
    ref >>>= 0;
  }
  eq('…and agrees with a bit-at-a-time reference over 4 kB of Gujarati', crc32(long), (ref ^ 0xffffffff) >>> 0);
}

// ==================================================================== the archive

group('the ZIP itself');
{
  eq('the local file header signature opens the file', Array.from(book.slice(0, 4)), [0x50, 0x4b, 0x03, 0x04]);
  eq('every required part is present', REQUIRED_PARTS.filter((n) => zip.parts.has(n)), REQUIRED_PARTS);
  eq('…and nothing else is', zip.parts.size, REQUIRED_PARTS.length);
  eq('the central directory declares its own size correctly', zip.cdSize, zip.cdSizeReal);
  eq('the entry count matches the directory', zip.count, zip.parts.size);

  for (const name of REQUIRED_PARTS) {
    const e = zip.parts.get(name);
    eq(`${name} - stored, method 0`, [e.method, e.lMethod], [0, 0]);
    eq(`${name} - CRC recomputed from the stored bytes`, crc32(e.data), e.crc);
    eq(`${name} - the local header repeats the same CRC`, e.lCrc, e.crc);
    eq(`${name} - sizes agree in both headers`, [e.compSize, e.size, e.lComp, e.lSize], [e.data.length, e.data.length, e.data.length, e.data.length]);
    eq(`${name} - the UTF-8 name flag is set`, e.utf8Flag, true);
    eq(`${name} - well-formed XML`, xmlWellFormed(e.text), null);
  }
}

// ==================================================================== the parts

group('the six parts say what OOXML requires');
{
  const ct = zip.parts.get('[Content_Types].xml').text;
  eq('content types names the workbook part', ct.includes('PartName="/xl/workbook.xml"'), true);
  eq('…the worksheet part', ct.includes('PartName="/xl/worksheets/sheet1.xml"'), true);
  eq('…the styles part', ct.includes('PartName="/xl/styles.xml"'), true);
  eq('…and defaults .rels, or nothing resolves', ct.includes('Extension="rels"'), true);

  const rels = zip.parts.get('_rels/.rels').text;
  eq('the package points at the workbook', /Target="xl\/workbook\.xml"/.test(rels), true);

  const wbRels = zip.parts.get('xl/_rels/workbook.xml.rels').text;
  eq('rId1 is the worksheet', /Id="rId1"[^>]*Target="worksheets\/sheet1\.xml"/.test(wbRels), true);
  eq('rId2 is the stylesheet', /Id="rId2"[^>]*Target="styles\.xml"/.test(wbRels), true);

  const wb = zip.parts.get('xl/workbook.xml').text;
  eq('the workbook declares one sheet, by relationship id', /<sheet name="[^"]*" sheetId="1" r:id="rId1"\/>/.test(wb), true);
  eq('…named in Gujarati, unmangled', wb.includes('name="પ્રગતિ"'), true);
}

// ==================================================================== typed cells

group('a number stays a number - the whole reason this is not a CSV');
{
  const cell = sheet.match(/<c r="C2"[^>]*>[\s\S]*?<\/c>/)[0];
  eq('C2 is typed n', /\st="n">/.test(cell), true);
  eq('…and holds the bare value', cell.includes('<v>103</v>'), true);
  eq('…and is not an inline string', cell.includes('inlineStr'), false);
  eq('zero is written, not dropped as falsy', /<c r="C4"[^>]*t="n"><v>0<\/v><\/c>/.test(sheet), true);

  const negatives = buildXlsx({ columns: [{ label: 'n', value: (r) => r.n, type: 'number' }], rows: [{ n: -5 }, { n: 2.5 }] });
  const ns = unzip(negatives).parts.get('xl/worksheets/sheet1.xml').text;
  eq('a negative number is a number, not a guarded string', ns.includes('<v>-5</v>'), true);
  eq('a decimal survives', ns.includes('<v>2.5</v>'), true);

  const bad = buildXlsx({ columns: [{ label: 'n', value: (r) => r.n, type: 'number' }], rows: [{ n: 'about ten' }, { n: NaN }, { n: Infinity }, { n: null }] });
  const bs = unzip(bad).parts.get('xl/worksheets/sheet1.xml').text;
  eq('a value that is not a number falls back to text', bs.includes('<t xml:space="preserve">about ten</t>'), true);
  eq('…and NaN is never written, as a number or as the word', bs.includes('NaN'), false);
  eq('…nor is Infinity', bs.includes('Infinity'), false);
  eq('…they become empty cells instead', [/<c r="A3"\/>/.test(bs), /<c r="A4"\/>/.test(bs)], [true, true]);
  eq('…and so does a null', /<c r="A5"\/>/.test(bs), true);
}

group('a date stays a date, on the IST day it happened');
{
  // Excel's day zero is 1899-12-30, so 1900-01-01 is 2. This is the constant everyone gets
  // wrong by one, and every other serial in the file rides on it.
  eq('1900-01-01 is serial 2', excelSerial('1900-01-01'), 2);
  eq('1899-12-31 is serial 1', excelSerial('1899-12-31'), 1);
  eq('the Unix epoch is serial 25569', excelSerial('1970-01-01'), 25569);
  eq('2026-08-14 is serial 46248', excelSerial('2026-08-14'), 46248);
  // Derived independently of the module, from the same definition.
  eq('…which is what the definition gives', excelSerial('2026-08-14'), Date.UTC(2026, 7, 14) / 86400000 + 25569);
  eq('a leap day is a real day', excelSerial('2024-02-29') - excelSerial('2024-02-28'), 1);
  eq('nothing in, nothing out', [excelSerial(null), excelSerial(''), excelSerial('not a date')], [null, null, null]);

  // The IST rule. 2026-08-11T22:40Z is 12 August in Ahmedabad, and a report that said
  // 11 August would be a day out for every evening row.
  eq('an instant is placed on its IST day, not its UTC day', excelSerial('2026-08-11T22:40:00Z'), excelSerial('2026-08-12'));
  eq('…and just before IST midnight stays on the same day', excelSerial('2026-08-11T18:29:00Z'), excelSerial('2026-08-11'));

  eq('D2 carries the serial', /<c r="D2" s="2"><v>46248<\/v><\/c>/.test(sheet), true);
  eq('…with no t attribute - a date IS a number in Excel', /<c r="D2"[^>]*t="/.test(sheet), false);
  eq('D3 is the IST day, one after the UTC one', /<c r="D3" s="2"><v>46246<\/v><\/c>/.test(sheet), true);
  eq('a null date is an empty cell, not 1899-12-30', /<c r="D4"\/>/.test(sheet), true);

  const styles = zip.parts.get('xl/styles.xml').text;
  eq('numFmt 164 is yyyy-mm-dd', /<numFmt numFmtId="164" formatCode="yyyy-mm-dd"\/>/.test(styles), true);
  eq('…and style 2 applies it', /<xf numFmtId="164"[^>]*applyNumberFormat="1"\/>/.test(styles), true);
}

group('text is an inline string - no shared-strings table to keep in step');
{
  eq('A2 is an inline string', /<c r="A2" s="0" t="inlineStr"><is><t xml:space="preserve">પરેશ<\/t><\/is><\/c>/.test(sheet), true);
  eq('no sharedStrings part exists', zip.parts.has('xl/sharedStrings.xml'), false);
  eq('…and nothing references one', zip.parts.get('[Content_Types].xml').text.includes('sharedStrings'), false);
  eq('an empty cell is a cell, not a blank string', /<c r="A4"\/>/.test(sheet), true);
}

// ==================================================================== the sheet furniture

group('the header row is frozen and bold, and the columns are sized');
{
  eq(
    'the pane freezes exactly row 1',
    sheet.includes('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'),
    true
  );
  eq('…inside a sheetView', /<sheetViews><sheetView[^>]*><pane /.test(sheet), true);

  const styles = zip.parts.get('xl/styles.xml').text;
  eq('there is a bold font', /<font><b\/>/.test(styles), true);
  eq('…and style 1 is the one that uses it', /<xf numFmtId="0" fontId="1"[^>]*applyFont="1"\/>/.test(styles), true);
  eq('every header cell wears style 1', (sheet.match(/<row r="1">([\s\S]*?)<\/row>/)[1].match(/s="1"/g) || []).length, COLUMNS.length);
  eq('…and no body cell does', /<row r="[2-9]"[\s\S]*?s="1"/.test(sheet), false);

  const cols = sheet.match(/<cols>([\s\S]*?)<\/cols>/)[1];
  const widths = Array.from(cols.matchAll(/<col min="(\d+)" max="\1" width="([\d.]+)" customWidth="1"\/>/g), (m) => Number(m[2]));
  eq('one <col> per column, in order', widths.length, COLUMNS.length);
  eq('every width is inside the 8-60 clamp', widths.every((w) => w >= 8 && w <= 60), true);
  // The long Gujarati name is 24 characters; its column must be wider than the 12-character
  // header beside it, or auto-sizing is not measuring the rows at all.
  eq('the widest value drives its column', widths[0] > widths[1], true);
  eq('…and a very long value is clamped, not unbounded', (() => {
    const wide = buildXlsx({ columns: [{ label: 'x', value: (r) => r.x }], rows: [{ x: 'ક'.repeat(500) }] });
    const m = unzip(wide).parts.get('xl/worksheets/sheet1.xml').text.match(/width="([\d.]+)"/);
    return Number(m[1]);
  })(), 60);
}

// ==================================================================== hostile input

group('XML escaping - a stray character must not cost the whole workbook');
{
  eq('& becomes an entity', escapeXml('R&D'), 'R&amp;D');
  eq('< and > are escaped', escapeXml('a<b>c'), 'a&lt;b&gt;c');
  eq('" is escaped, because the same function writes attributes', escapeXml('say "hi"'), 'say &quot;hi&quot;');
  eq("' is escaped", escapeXml("it's"), 'it&apos;s');
  eq('& is escaped first, so < never becomes &amp;lt;', escapeXml('<'), '&lt;');
  eq('a control character is stripped, not escaped', escapeXml('પ\u0001રેશ'), 'પરેશ');
  eq('…and no numeric entity is invented for it', escapeXml('\u0001').includes('&#'), false);
  eq('tab, LF and CR are legal XML and are kept', escapeXml('a\tb\nc\rd'), 'a\tb\nc\rd');

  const nasty = buildXlsx({
    columns: [{ label: 'A & B <"C">', value: (r) => r.v }],
    rows: [{ v: 'પ\u0001રેશ' }, { v: 'Smith & Sons <ltd> "x"' }, { v: '\u0000\u001f' }],
  });
  const nz = unzip(nasty);
  const ns = nz.parts.get('xl/worksheets/sheet1.xml').text;
  eq('a hostile workbook is still well-formed XML', xmlWellFormed(ns), null);
  eq('…the control char never reaches the file', ns.includes('\u0001'), false);
  eq('…the name survives with the character removed', ns.includes('<t xml:space="preserve">પરેશ</t>'), true);
  eq('…a header full of markup is escaped too', ns.includes('A &amp; B &lt;&quot;C&quot;&gt;'), true);
  eq('…and the all-control value collapses to an empty cell', /<c r="A4"\/>/.test(ns), true);
}

group('formula injection - the same guard the CSV applies (./export.js)');
{
  eq('=cmd is neutralised', guardText('=cmd|calc'), "'=cmd|calc");
  eq('+1 too', guardText('+1+1'), "'+1+1");
  eq('@SUM too', guardText('@SUM(A1)'), "'@SUM(A1)");
  eq('a leading tab too', guardText('\t=1'), "'\t=1");
  eq('a plain negative number is left alone - Excel can sum it', guardText('-5'), '-5');
  eq('…and so is a decimal', guardText('-5.25'), '-5.25');
  eq('-5+3 is a formula and is neutralised', guardText('-5+3'), "'-5+3");
  eq('an ordinary name is untouched', guardText('પરેશ'), 'પરેશ');

  // The drift guard. csvCell() also quotes; the *decision* to prefix an apostrophe must be
  // identical, or the same row reads differently in the two files the same query produced.
  const probes = ['=cmd', '+1', '-5', '-5+3', '@x', 'પરેશ', '', '0', '3.5', '\r1', 'a=b'];
  const csvGuarded = probes.map((v) => /^"?'/.test(csvCell(v)));
  const xlsxGuarded = probes.map((v) => guardText(v).startsWith("'"));
  eq('csvCell and guardText agree on every probe', xlsxGuarded, csvGuarded);

  const injected = buildXlsx({ columns: [{ label: 'Name', value: (r) => r.n }], rows: [{ n: '=cmd|calc' }] });
  const is = unzip(injected).parts.get('xl/worksheets/sheet1.xml').text;
  eq('…and the guard reaches the cell', is.includes('<t xml:space="preserve">&apos;=cmd|calc</t>'), true);

  // The ordering that is a security property: strip first, then guard. A guard that ran
  // first would not see the = behind the control character, the stripper would remove the
  // character afterwards, and Excel would be handed a live formula.
  eq('a control character cannot smuggle a formula past the guard', guardText('\u0001=cmd|calc'), "'=cmd|calc");
  eq('…nor past the cell writer', unzip(buildXlsx({ columns: [{ label: 'n', value: (r) => r.n }], rows: [{ n: '\u0001=cmd' }] })).parts.get('xl/worksheets/sheet1.xml').text.includes('&apos;=cmd'), true);
}

// ==================================================================== edges

group('the empty report still opens');
{
  const empty = buildXlsx({ sheetName: 'Empty', columns: COLUMNS, rows: [] });
  const ez = unzip(empty);
  eq('every part is still there', REQUIRED_PARTS.filter((n) => ez.parts.has(n)).length, REQUIRED_PARTS.length);
  for (const n of REQUIRED_PARTS) eq(`${n} - still well-formed`, xmlWellFormed(ez.parts.get(n).text), null);
  const es = ez.parts.get('xl/worksheets/sheet1.xml').text;
  eq('…holding exactly one row', (es.match(/<row /g) || []).length, 1);
  eq('…which is the header', es.includes('<row r="1">'), true);
  eq('…still frozen', es.includes('state="frozen"'), true);
  eq('…and still sized', (es.match(/<col /g) || []).length, COLUMNS.length);

  const bare = buildXlsx();
  eq('no arguments at all still yields an archive', unzip(bare).parts.size, REQUIRED_PARTS.length);
  eq('…with an empty sheetData', unzip(bare).parts.get('xl/worksheets/sheet1.xml').text.includes('<sheetData><row r="1"></row></sheetData>'), true);
}

group('names, refs and filenames');
{
  eq('column letters run past Z', [colName(0), colName(25), colName(26), colName(27), colName(51), colName(52)], ['A', 'Z', 'AA', 'AB', 'AZ', 'BA']);
  eq('a tab name Excel refuses is sanitised', unzip(buildXlsx({ sheetName: 'a/b:c*d?[e]' })).parts.get('xl/workbook.xml').text.match(/name="([^"]*)"/)[1], 'a b c d  e');
  eq('…and one over 31 characters is cut', unzip(buildXlsx({ sheetName: 'x'.repeat(40) })).parts.get('xl/workbook.xml').text.match(/name="([^"]*)"/)[1].length, 31);
  eq('…an empty one falls back', unzip(buildXlsx({ sheetName: '  ' })).parts.get('xl/workbook.xml').text.includes('name="Sheet1"'), true);
  eq('the CSV filename becomes an xlsx one', xlsxFilename('varni-dhyan-yuvako-2026-08-11.csv'), 'varni-dhyan-yuvako-2026-08-11.xlsx');
  eq('…and is not doubled if it already is', xlsxFilename('report.xlsx'), 'report.xlsx');
}

group('exportXlsx answers with the count it actually wrote (§62)');
{
  // No DOM here, so downloadXlsx() declines and returns false; the count must still be the
  // rows that went into the file rather than a number the page guessed at.
  eq('three rows in, three reported', exportXlsx({ filename: 'x.xlsx', columns: COLUMNS, rows: ROWS }), 3);
  eq('none in, none reported', exportXlsx({ filename: 'x.xlsx', columns: COLUMNS, rows: [] }), 0);
  eq('undefined rows do not throw', exportXlsx({ filename: 'x.xlsx', columns: COLUMNS }), 0);
}

// ==================================================================== the real reader

/**
 * The strongest proof available without Excel: the panel's own importer reads it back.
 *
 * `shared/domain/xlsx-read.js` is production code — it is what `DarshanImportPage` runs on a
 * file the સંચાલક drags in. It was written months before this writer and knows nothing about
 * it. If it can resolve the relationship, find the sheet, decode the column letters and
 * recover every value, then the archive is a workbook by the only definition that matters
 * here. It returns everything as a string, including numbers and serials, which is why the
 * expectations below are strings.
 */
group('the panel’s own .xlsx reader reads it back (shared/domain/xlsx-read.js)');
{
  const read = await readXlsx(book);
  eq('four rows: a header and three', read.length, 4);
  eq('the header round-trips, Gujarati and all', read[0], ['નામ', 'Zone', 'Darshan seen', 'Last seen']);
  eq('પરેશ comes back byte-exact', read[1][0], 'પરેશ');
  eq('…and so does the long name', read[2][0], 'ભુપતભાઈ ભીમાભાઇ કાતરીયા');
  eq('…character for character, not merely normalised', [...read[2][0]].length, [...'ભુપતભાઈ ભીમાભાઇ કાતરીયા'].length);
  eq('the number is the number', read[1][2], '103');
  eq('the date is the serial', read[1][3], '46248');
  eq('the second row is its IST day', read[2][3], '46246');
  eq('an empty name is empty, and the row is not shortened', [read[3][0], read[3][1], read[3][2]], ['', '', '0']);

  const emptyRead = await readXlsx(buildXlsx({ sheetName: 'Empty', columns: COLUMNS, rows: [] }));
  eq('an empty report reads as one header row', emptyRead.length, 1);
  eq('…with all four column names', emptyRead[0].length, COLUMNS.length);

  const guardRead = await readXlsx(buildXlsx({ columns: [{ label: 'Name', value: (r) => r.n }], rows: [{ n: '=cmd|calc' }, { n: 'Smith & Sons <ltd> "x"' }, { n: 'પ\u0001રેશ' }] }));
  eq('the guarded value survives the round trip with its apostrophe', guardRead[1][0], "'=cmd|calc");
  eq('the escaped entities unescape back to the original', guardRead[2][0], 'Smith & Sons <ltd> "x"');
  eq('the control character is gone and the rest is intact', guardRead[3][0], 'પરેશ');

  // A wide sheet proves the column-letter encode and decode are inverses past Z, which is
  // where a report with thirty columns would otherwise silently shift every value one across.
  const wideCols = Array.from({ length: 30 }, (_, i) => ({ label: `c${i}`, value: () => `v${i}` }));
  const wideRead = await readXlsx(buildXlsx({ columns: wideCols, rows: [{}] }));
  eq('thirty columns survive the A→AA boundary', wideRead[1], wideCols.map((_, i) => `v${i}`));
}

// ==================================================================== house rules

group('house rules');
{
  const source = readFileSync(fileURLToPath(new URL('../admin/src/lib/xlsx.js', import.meta.url)), 'utf8');
  eq('the module was read', source.length > 0, true);
  // Comments are prose and may name Buffer as the thing this file refuses to use; code may not.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n');
  eq('no node built-ins - this is browser code', /from '(node:)?(fs|zlib|buffer|path|crypto)'/.test(code), false);
  eq('no Buffer', /\bBuffer\b/.test(code.replace(/ArrayBuffer/g, '')), false);
  eq('no require()', /\brequire\(/.test(code), false);
  // Comments are prose and keep their em dashes; nothing the સંચાલક sees may hold one.
  const strings = Array.from(source.matchAll(/'([^'\\\n]*)'|"([^"\\\n]*)"|`([^`\\\n]*)`/g), (m) => m[1] ?? m[2] ?? m[3]);
  eq('no em dash in any user-visible string', strings.filter((s) => s.includes('—')), []);
  eq('no literal total (§62)', /\b(108|109|110)\b/.test(source.replace(/\/\*[\s\S]*?\*\//g, '')), false);
}

// ==================================================================== result

console.log(`\n  ${pass} passed, ${fails.length} failed\n`);
if (fails.length) {
  console.log(fails.map((f) => `  ✗ ${f}`).join('\n\n') + '\n');
  process.exit(1);
}
