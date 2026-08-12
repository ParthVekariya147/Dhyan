/**
 * Tests for the Excel modules — `node scripts/test-darshan-excel.mjs`.
 *
 * Same shape as scripts/test-domain.mjs and scripts/test-level4.mjs, and for the same
 * reason: `shared/domain/darshan-excel.js` and `shared/domain/xlsx-read.js` are pure
 * functions over plain data, so they can be tested exactly, cheaply and without a framework.
 * Exit code is the result: 0 green, 1 red.
 *
 * What this protects, specifically — every one of these fails *silently* in production:
 *
 *   1. **The round trip** (EXCEL_CONTRACT §3). Export the collection, import it back, and
 *      nothing must change. It is the one property that makes the whole feature safe to use:
 *      if a no-op import reports 109 updates, then a real import's report is noise and the
 *      operator learns to click through it. So the round trip below runs over the real
 *      `content/darshan.json` — every વર્ણન the સંચાલક has actually written, including row 88
 *      with its newline inside a quoted field — and through the real CSV encoder in
 *      `admin/src/lib/export.js`, BOM, formula guard and all.
 *
 *   2. **Gujarati surviving the journey.** ઈ and ઇ are different characters, the corpus
 *      contains both, and a stray `.normalize()` anywhere in the pipeline would silently
 *      rewrite a hundred વર્ણન into something *nearly* right — the hardest kind of damage to
 *      notice and the hardest to undo.
 *
 *   3. **Duplicates never being resolved quietly.** §7 exists because an imported ક્રમ 27
 *      landing on darshan-027 has two defensible meanings, and the wrong one overwrites a
 *      દ્રશ્ય nobody meant to touch. The default is skip, and that is asserted rather than
 *      trusted.
 *
 *   4. **Header detection over real layouts** — a merged banner above the header, headers in
 *      Gujarati, and columns in an order nobody planned. Detection by position passes every
 *      test written against a tidy file and then writes the વર્ણન column into `image_url`.
 *
 *   5. **The .xlsx reader.** It is a ZIP parser and an XML parser written by hand, so the
 *      fixtures below are real ZIP archives — central directory, local headers, CRCs — built
 *      here byte by byte, in both the stored and the deflated flavour, because the browser's
 *      inflate is the one part that could not be ported from the node reader unchanged.
 *
 * No literal collection size appears anywhere below as an expectation; every count is
 * derived from the manifest that was actually read (§62).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

import { buildDarshanItems, withDisplayIndex, darshanId } from '../shared/domain/darshan.js';
import { driveImageUrl } from '../shared/domain/drive.js';
import { parseDelimited } from './lib/spreadsheet.mjs';
import { csvCell, toCsv } from '../admin/src/lib/export.js';
import {
  EXCEL_COLUMNS,
  IMPORTABLE_COLUMNS,
  IMPORT_MODES,
  CONFLICT_RESOLUTIONS,
  SCENE_STATUSES,
  excelHeaderRow,
  itemToRow,
  rowToPatch,
  detectDarshanColumns,
  findExcelHeaderRow,
  buildExcelPlan,
  writableExcelEntries,
  templateRows,
  instructionsText,
  driveFileUrl,
} from '../shared/domain/darshan-excel.js';
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

/** Await-friendly assertion for the one module that had to become async. */
const throws = async (name, fn, fragment) => {
  try {
    await fn();
    fails.push(`${name}\n       got  no error\n       want an error containing ${JSON.stringify(fragment)}`);
  } catch (err) {
    if (String(err.message).includes(fragment)) pass++;
    else fails.push(`${name}\n       got  ${JSON.stringify(err.message)}\n       want one containing ${JSON.stringify(fragment)}`);
  }
};

// ==================================================================== fixtures

const DRIVE_A = '1AnOf5K9Ab0kjmOs2gd_arx9CAqYxdK9a';
const DRIVE_B = '1WEOZT7wDhrmBnW5ZuD9uKRzsQQYquGLV';

/** The real collection. Whatever it holds is the truth — nothing below assumes a size. */
const MANIFEST = JSON.parse(
  readFileSync(fileURLToPath(new URL('../content/darshan.json', import.meta.url)), 'utf8')
);

/** One DarshanItem, in the shape the panel's list actually holds. */
const item = (over = {}) => ({
  id: 'darshan-007',
  index: 7,
  order: 7,
  active: true,
  status: 'ACTIVE',
  title: '',
  caption: 'સાતમા દ્રશ્યનું વર્ણન',
  imageUrl: driveImageUrl(DRIVE_A),
  fullUrl: driveImageUrl(DRIVE_A, 2560),
  thumbUrl: driveImageUrl(DRIVE_A, 400),
  driveId: DRIVE_A,
  file: 'Varni(7).png',
  updatedAt: null,
  ...over,
});

/** rows + a header, ready for buildExcelPlan. Columns are always detected, never assumed. */
const plan = (header, dataRows, opts = {}) => {
  const rows = [header, ...dataRows];
  return buildExcelPlan({
    rows,
    headerRow: 0,
    columns: detectDarshanColumns(header),
    ...opts,
  });
};

/** The eight importable headers, in English, as a plain header row. */
const EN_HEADER = IMPORTABLE_COLUMNS.map((c) => c.en);
const GU_HEADER = IMPORTABLE_COLUMNS.map((c) => c.gu);

/** One data row for the eight importable columns, given by key. */
const row8 = (values = {}) => IMPORTABLE_COLUMNS.map((c) => values[c.key] ?? '');

// ==================================================================== the columns

group('EXCEL_COLUMNS — the contract, as data');
eq('the eight importable columns, in §1 order', IMPORTABLE_COLUMNS.map((c) => c.key), [
  'id', 'index', 'title', 'caption', 'driveId', 'driveUrl', 'order', 'status',
]);
eq('the four export-only ones follow', EXCEL_COLUMNS.filter((c) => !c.importable).map((c) => c.key), [
  'imageUrl', 'displayIndex', 'file', 'updatedAt',
]);
eq('every column carries both languages', EXCEL_COLUMNS.every((c) => c.en && c.gu), true);
eq('only the ક્રમ is required — a missing title is reported, never enforced',
  EXCEL_COLUMNS.filter((c) => c.required).map((c) => c.key), ['index']);
eq('displayIndex can never be imported', EXCEL_COLUMNS.find((c) => c.key === 'displayIndex').importable, false);
eq('the five statuses are 0004_rbac.sql\'s five', SCENE_STATUSES, ['DRAFT', 'VALIDATED', 'PUBLISHED', 'ACTIVE', 'DISABLED']);

// ==================================================================== header detection

group('detectDarshanColumns — English headers');
{
  const cols = detectDarshanColumns(excelHeaderRow());
  eq('every column of an export is found', EXCEL_COLUMNS.every((c) => cols[c.key] !== null), true);
  eq('…each at its own position', EXCEL_COLUMNS.map((c) => cols[c.key]), EXCEL_COLUMNS.map((_, i) => i));
}

group('detectDarshanColumns — the decoy columns');
{
  // The trap this exists for: "Production Image URL" contains URL and "Display Number"
  // contains Display. Claimed by the wrong column, an import writes the derived display
  // number into the presentation order of every દ્રશ્ય.
  const cols = detectDarshanColumns(['Production Image URL', 'Google Drive URL', 'Display Number', 'Display Order']);
  eq('the production URL does not steal the Drive URL column', cols.driveUrl, 1);
  eq('…and is itself recognised, so it can be ignored', cols.imageUrl, 0);
  eq('the display number does not steal Display Order', cols.order, 3);
  eq('…and is itself recognised', cols.displayIndex, 2);
}

group('detectDarshanColumns — ગુજરાતી headers');
{
  const cols = detectDarshanColumns(GU_HEADER);
  eq('all eight importable columns land', IMPORTABLE_COLUMNS.map((c) => cols[c.key]), [0, 1, 2, 3, 4, 5, 6, 7]);
}
eq(
  'ક્રમ is the printed number and ક્રમાંક is the order — never each other',
  (() => {
    const cols = detectDarshanColumns(['ક્રમાંક', 'ક્રમ']);
    return [cols.order, cols.index];
  })(),
  [0, 1]
);
eq(
  'both spellings of ફાઈલ/ફાઇલ આઈડી are accepted',
  detectDarshanColumns(['ડ્રાઇવ ફાઇલ આઇડી']).driveId,
  0
);

group('detectDarshanColumns — shuffled and bilingual');
{
  const shuffled = ['Status', 'વર્ણન', 'Item ID', 'Display Order', 'Title', 'ક્રમ', 'Google Drive File ID', 'Google Drive URL'];
  const cols = detectDarshanColumns(shuffled);
  eq('position means nothing', [cols.status, cols.caption, cols.id, cols.order, cols.title, cols.index, cols.driveId, cols.driveUrl],
    [0, 1, 2, 3, 4, 5, 6, 7]);
}
{
  const cols = detectDarshanColumns(templateRows()[0]);
  eq('the template\'s own bilingual headers map back to all eight',
    IMPORTABLE_COLUMNS.every((c) => cols[c.key] !== null), true);
}
eq('a column nobody recognises is ignored, not guessed at', detectDarshanColumns(['ઝોન', 'SMK']).caption, null);

group('findExcelHeaderRow — a merged banner above the header');
{
  // What the live sheet actually looks like: a title row, a blank row, then the headers.
  const rows = [
    ['દર્શન યાદી — ૨૦૨૬'],
    [],
    EN_HEADER,
    row8({ id: 'darshan-001', index: '1' }),
  ];
  const found = findExcelHeaderRow(rows);
  eq('the header is found by content, not by line number', found.headerRow, 2);
  eq('…and the columns come with it', found.columns.index, 1);
}
{
  const rows = [['Prepared by the સંચાલક', '', ''], GU_HEADER, row8({ index: '1' })];
  eq('a Gujarati header under a note is found too', findExcelHeaderRow(rows).headerRow, 1);
}
eq('no header at all is said out loud, not guessed', findExcelHeaderRow([['a', 'b'], ['c', 'd']]).headerRow, -1);

// ==================================================================== rows ⇄ items

group('itemToRow');
{
  const cells = itemToRow(item({ title: 'સાતમું દ્રશ્ય', displayIndex: 4 }));
  const at = (key) => cells[EXCEL_COLUMNS.findIndex((c) => c.key === key)];
  eq('one cell per column', cells.length, EXCEL_COLUMNS.length);
  eq('the id', at('id'), 'darshan-007');
  eq('the printed number', at('index'), '7');
  eq('the title', at('title'), 'સાતમું દ્રશ્ય');
  eq('the description is scenes.caption — one field, never a third spelling', at('caption'), 'સાતમા દ્રશ્યનું વર્ણન');
  eq('the Drive URL is the share link a person can click, not the CDN one', at('driveUrl'), driveFileUrl(DRIVE_A));
  eq('…while the production URL stays the CDN one', at('imageUrl'), driveImageUrl(DRIVE_A));
  eq('the derived display number is exported', at('displayIndex'), '4');
  eq('every cell is a string, so an encoder never has to guess', cells.every((c) => typeof c === 'string'), true);
}
eq('a null order exports blank rather than "null"', itemToRow(item({ order: null }))[6], '');
eq('a status outside the five never leaves this module', itemToRow(item({ status: 'ARCHIVED' }))[7], '');
eq('an item with no title yet exports an empty cell', itemToRow(item())[2], '');

group('rowToPatch — what one row asks for');
{
  const cols = detectDarshanColumns(EN_HEADER);
  const patch = rowToPatch(row8({ id: 'darshan-007', index: '9', title: 'શીર્ષક', caption: 'વર્ણન', order: '3', status: 'published' }), cols);
  eq('no issues', patch.issues, []);
  eq('the id', patch.id, 'darshan-007');
  eq('numbers arrive as numbers', [patch.index, patch.order], [9, 3]);
  eq('status is case-insensitive and comes back canonical', patch.status, 'PUBLISHED');
}
{
  const cols = detectDarshanColumns(EN_HEADER);
  eq('a column the file does not have is simply absent from the patch',
    'status' in rowToPatch(row8({ id: 'darshan-007' }), { id: cols.id }), false);
  eq('an empty ક્રમ cell is "left alone", not zero',
    'index' in rowToPatch(row8({ id: 'darshan-007' }), cols), false);
  eq('an empty title cell IS a value — empty, not null (§3)',
    rowToPatch(row8({ id: 'darshan-007' }), cols).title, '');
}
{
  const cols = detectDarshanColumns(EN_HEADER);
  eq('ગુજરાતી digits are the same ક્રમ', rowToPatch(row8({ index: '૮૮' }), cols).index, 88);
  eq('a spreadsheet\'s "27.0" is 27', rowToPatch(row8({ index: '27.0' }), cols).index, 27);
}

group('rowToPatch — the Drive reference');
{
  const cols = detectDarshanColumns(EN_HEADER);
  eq('a bare file id', rowToPatch(row8({ driveId: DRIVE_A }), cols).driveId, DRIVE_A);
  eq('a URL in the URL column', rowToPatch(row8({ driveUrl: driveFileUrl(DRIVE_A) }), cols).driveId, DRIVE_A);
  eq('a whole URL pasted into the id column is read, not refused',
    rowToPatch(row8({ driveId: driveFileUrl(DRIVE_A) }), cols).driveId, DRIVE_A);
  {
    const patch = rowToPatch(row8({ driveId: DRIVE_A, driveUrl: driveFileUrl(DRIVE_B) }), cols);
    eq('when the two disagree the id wins (§1)', patch.driveId, DRIVE_A);
    eq('…and the સંચાલક is told, not silently overruled', patch.issues.map((i) => i.severity), ['warning']);
  }
  {
    const patch = rowToPatch(row8({ driveUrl: 'https://drive.google.com/drive/folders/1qwZibCk9IaU_fmVi8hDJ4hfmCkY3UGfw' }), cols);
    eq('a folder link is a malformed reference, not an image', patch.issues[0].severity, 'error');
    eq('…named by field', patch.issues[0].field, 'driveUrl');
  }
}

// ==================================================================== validation (§6)

group('validation — the errors that block a row');
{
  const { entries, counts } = plan(EN_HEADER, [
    row8({ id: 'darshan-007', status: 'PUBLISH' }),
    row8({ id: 'darshan-007', index: '3.5' }),
    row8({ index: '-2' }),
    row8({ index: '5', order: '-1' }),
  ], { existing: [item()] });

  eq('a status outside the five is an error', entries[0].issues[0].severity, 'error');
  eq('…and names the field', entries[0].issues[0].field, 'status');
  eq('…and lists the five it will accept', entries[0].issues[0].message.includes('DRAFT, VALIDATED, PUBLISHED, ACTIVE, DISABLED'), true);
  eq('a non-integer ક્રમ is an error, never rounded', entries[1].issues.some((i) => i.severity === 'error' && i.field === 'index'), true);
  eq('a negative ક્રમ is an error, never made positive', entries[2].issues.some((i) => i.severity === 'error' && i.field === 'index'), true);
  eq('a negative order likewise', entries[3].issues.some((i) => i.severity === 'error' && i.field === 'order'), true);
  eq('all four are blocked', counts.error, 4);
  eq('…and none of them would write anything', writableExcelEntries(entries).length, 0);
}

group('validation — duplicates within the file');
{
  const { entries, counts } = plan(EN_HEADER, [
    row8({ index: '11', title: 'ક' }),
    row8({ index: '11', title: 'ખ' }),
    row8({ index: '12', order: '5' }),
    row8({ index: '13', order: '5' }),
    row8({ id: 'darshan-007', title: 'ગ' }),
    row8({ id: 'darshan-007', title: 'ઘ' }),
  ], { existing: [item()] });

  eq('the second row claiming a ક્રમ is an error', entries[1].issues.some((i) => i.severity === 'error' && i.field === 'index'), true);
  eq('…and it names the row the સંચાલક can see on his own screen', entries[1].issues.find((i) => i.field === 'index').message.includes('row 2'), true);
  eq('the first one is untouched by the second\'s mistake', entries[0].action, 'create');
  eq('a duplicate Display Order is an error too', entries[3].issues.some((i) => i.severity === 'error' && i.field === 'order'), true);
  eq('a duplicate Item ID is an error', entries[5].issues.some((i) => i.severity === 'error' && i.field === 'id'), true);
  eq('three blocked rows', counts.error, 3);
}

group('validation — a missing title or વર્ણન is a warning, never an error');
{
  const existing = [item({ id: 'darshan-007', title: 'જૂનું શીર્ષક', caption: 'જૂનું વર્ણન' })];
  const { entries } = plan(EN_HEADER, [row8({ id: 'darshan-007', title: '', caption: '', order: '4' })], { existing });
  const e = entries[0];
  eq('the row still applies', e.action, 'update');
  eq('…writing only what was filled in', e.patch, { order: 4 });
  eq('nothing is an error', e.issues.filter((i) => i.severity === 'error'), []);
  eq('both empties are reported as warnings', e.issues.filter((i) => i.severity === 'warning').map((i) => i.field), ['title', 'caption']);
  eq('…and say where a real erasure is done instead', e.issues.find((i) => i.field === 'caption').message.includes("દ્રશ્ય's own page"), true);
}
{
  const { entries } = plan(EN_HEADER, [row8({ index: '400', caption: 'નવું' })], { existing: [] });
  eq('a new દ્રશ્ય with no title is created anyway', entries[0].action, 'create');
  eq('…with the gap reported', entries[0].issues.filter((i) => i.severity === 'warning').map((i) => i.field), ['title']);
}
{
  const { entries } = plan(EN_HEADER, [row8({ caption: 'નવું' })], { existing: [] });
  eq('a new દ્રશ્ય with no ક્રમ cannot be created', entries[0].action, 'error');
  eq('…and the reason names the column', entries[0].issues.some((i) => i.field === 'index'), true);
}

// ==================================================================== the three modes (§4)

group('import modes');
{
  const existing = [item()];
  const rows = [
    row8({ id: 'darshan-007', title: 'બદલાયેલું' }), // a row that exists
    row8({ index: '400', title: 'નવું' }),           // a row that does not
  ];

  const upsert = plan(EN_HEADER, rows, { existing, mode: IMPORT_MODES.UPSERT });
  eq('UPSERT updates the known row and creates the new one',
    upsert.entries.map((e) => e.action), ['update', 'create']);
  eq('…counted', [upsert.counts.total, upsert.counts.create, upsert.counts.update, upsert.counts.skip, upsert.counts.error], [2, 1, 1, 0, 0]);

  const createOnly = plan(EN_HEADER, rows, { existing, mode: IMPORT_MODES.CREATE_ONLY });
  eq('CREATE_ONLY skips the known row', createOnly.entries.map((e) => e.action), ['skip', 'create']);
  eq('…and says why, rather than dropping it from the report',
    createOnly.entries[0].issues.some((i) => i.severity === 'info'), true);

  const updateOnly = plan(EN_HEADER, rows, { existing, mode: IMPORT_MODES.UPDATE_ONLY });
  eq('UPDATE_ONLY skips the new row', updateOnly.entries.map((e) => e.action), ['update', 'skip']);
  eq('…and nothing new is written', writableExcelEntries(updateOnly.entries).map((e) => e.action), ['update']);

  eq('the default mode is UPSERT', buildExcelPlan({ rows: [EN_HEADER, ...rows], headerRow: 0, existing }).mode, 'UPSERT');
}
{
  const { entries } = plan(EN_HEADER, [row8({ id: 'darshan-999', title: 'ક' })], {
    existing: [item()],
    mode: IMPORT_MODES.UPDATE_ONLY,
  });
  eq('an Item ID that does not exist is an error in UPDATE_ONLY (§6)', entries[0].action, 'error');
  eq('…named by field', entries[0].issues.find((i) => i.severity === 'error').field, 'id');
}
{
  const { entries } = plan(EN_HEADER, [row8({ id: 'darshan-999', index: '999', title: 'ક' })], {
    existing: [item()],
    mode: IMPORT_MODES.UPSERT,
  });
  eq('…but in UPSERT the same row is a create under the id it names', [entries[0].action, entries[0].id], ['create', 'darshan-999']);
}
{
  const { entries } = plan(EN_HEADER, [row8({ index: '400', title: 'ક' })], { existing: [] });
  eq('a create with no Item ID is previewed under the id it will get', entries[0].id, darshanId(400));
}

// ==================================================================== duplicates (§7)

group('§7 — an imported ક્રમ that already belongs to somebody else');
{
  const existing = [item({ id: 'darshan-027', index: 27, order: 27, caption: 'હાલનું વર્ણન' })];
  const rows = [row8({ index: '27', title: 'નવું શીર્ષક', caption: 'નવું વર્ણન' })];

  const skipped = plan(EN_HEADER, rows, { existing });
  const e = skipped.entries[0];
  eq('the row carries a conflict rather than an answer', !!e.conflict, true);
  eq('…naming the દ્રશ્ય that holds the number', [e.conflict.field, e.conflict.value, e.conflict.existingId], ['index', 27, 'darshan-027']);
  eq('…in the words §7 asks for', e.conflict.message, 'Index 27 already belongs to darshan-027.');
  eq('the default is Skip', e.conflict.resolution, CONFLICT_RESOLUTIONS.SKIP);
  eq('…so nothing is written', [e.action, e.patch], ['skip', {}]);
  eq('and it is NOT silently overwritten', writableExcelEntries(skipped.entries).length, 0);

  const updated = plan(EN_HEADER, rows, {
    existing,
    resolutions: { 2: CONFLICT_RESOLUTIONS.UPDATE },
  });
  eq('answering "update the existing item" applies the row to that દ્રશ્ય', updated.entries[0].action, 'update');
  eq('…to darshan-027, not to a second દ્રશ્ય claiming 27', updated.entries[0].id, 'darshan-027');
  eq('…with the row\'s own text', updated.entries[0].patch.caption, 'નવું વર્ણન');
  eq('…and the preview can show what it replaces', updated.entries[0].before.caption, 'હાલનું વર્ણન');

  const all = plan(EN_HEADER, rows, { existing, defaultResolution: CONFLICT_RESOLUTIONS.UPDATE });
  eq('"apply to all remaining" is the same answer with no row named', all.entries[0].action, 'update');
}
{
  // Moving a number from one દ્રશ્ય onto another is the same conflict, seen from the other end.
  const existing = [item({ id: 'darshan-027', index: 27 }), item({ id: 'darshan-005', index: 5 })];
  const { entries } = plan(EN_HEADER, [row8({ id: 'darshan-005', index: '27' })], { existing });
  eq('renumbering darshan-005 onto 27 asks first', entries[0].conflict.existingId, 'darshan-027');
  eq('…and skips by default', entries[0].action, 'skip');
}
{
  const existing = [item({ id: 'darshan-027', index: 27, order: 27, caption: 'ક' })];
  const { entries } = plan(EN_HEADER, [row8({ id: 'darshan-027', index: '27', caption: 'ખ' })], { existing });
  eq('a દ્રશ્ય keeping its own number is not a conflict', 'conflict' in entries[0], false);
  eq('…and updates normally', [entries[0].action, entries[0].patch.caption], ['update', 'ખ']);
}
{
  const existing = [item({ id: 'darshan-027', index: 27 })];
  const { entries } = plan(EN_HEADER, [row8({ index: '27', title: 'ક' })], {
    existing,
    mode: IMPORT_MODES.CREATE_ONLY,
    resolutions: { 2: CONFLICT_RESOLUTIONS.UPDATE },
  });
  eq('"update the existing item" is not on offer in CREATE_ONLY', entries[0].action, 'skip');
  eq('…and the reason is stated', entries[0].issues.some((i) => i.severity === 'info' && i.message.includes('CREATE_ONLY')), true);
}

// ==================================================================== §3a the join key

/**
 * The સંચાલક's own sheet, header for header.
 *
 * These are the three headings the live Google Sheet has carried for two years, spelled the
 * way it spells them — `ફાઈલ` with ઈ, the વર્ણન column with its parenthesised qualifier. No
 * Item ID anywhere, which is the whole point of §3a: under the first draft of §1 every row of
 * this file was a new દ્રશ્ય colliding with an existing ક્રમ, every collision defaulted to
 * Skip, and importing the organisation's own sheet wrote nothing at all.
 */
const LIVE_HEADER = ['ક્રમ', 'ફોટો ફાઈલ', 'દ્રશ્ય-વર્ણન (વિગતવાર)'];

group('§3a — the live sheet has no Item ID column, so ક્રમ is the key');
{
  const cols = detectDarshanColumns(LIVE_HEADER);
  eq('the three live headings map', [cols.index, cols.file, cols.caption], [0, 1, 2]);
  eq('and there is no id column to join on', cols.id, null);
}
{
  // The case that was broken, against the real collection.
  const items = withDisplayIndex(buildDarshanItems(MANIFEST, {}));
  const edited = items.slice(0, 10);
  const rows = edited.map((it, i) => [String(it.index), it.file, `${it.caption} — સુધારેલું ${i + 1}`]);

  const { entries, counts, joinedOn } = plan(LIVE_HEADER, rows, { existing: items });
  eq('the plan says which column it joined on', joinedOn, 'index');
  eq('every edited row applies straight through', [counts.total, counts.update, counts.skip, counts.error], [10, 10, 0, 0]);
  eq('…with no conflicts at all', entries.filter((e) => e.conflict).length, 0);
  eq('…each aimed at the દ્રશ્ય its ક્રમ names', entries.map((e) => e.id), edited.map((it) => it.id));
  eq('…changing only the વર્ણન', entries.map((e) => Object.keys(e.patch).join()), edited.map(() => 'caption'));
  eq('…and the ક્રમ it matched on is not reported as a change', entries.every((e) => !('index' in e.patch)), true);
}
{
  // Same sheet, unedited: the no-op rule still applies on top of the new join key.
  const items = withDisplayIndex(buildDarshanItems(MANIFEST, {}));
  const rows = items.map((it) => [String(it.index), it.file, it.caption]);
  const { counts } = plan(LIVE_HEADER, rows, { existing: items });
  eq('an unedited live sheet is still a complete no-op', [counts.total, counts.update, counts.create, counts.error], [items.length, 0, 0, 0]);
  eq('…every row skipped', counts.skip, items.length);
}
{
  const items = withDisplayIndex(buildDarshanItems(MANIFEST, {}));
  const unmatched = Math.max(...items.map((i) => i.index)) + 1;
  const rows = [[String(unmatched), 'Varni(new)', 'નવા દ્રશ્યનું વર્ણન']];

  eq('a number nothing matches is a create in UPSERT',
    plan(LIVE_HEADER, rows, { existing: items }).entries[0].action, 'create');
  eq('…under the id that number derives',
    plan(LIVE_HEADER, rows, { existing: items }).entries[0].id, darshanId(unmatched));
  eq('…a create in CREATE_ONLY too',
    plan(LIVE_HEADER, rows, { existing: items, mode: IMPORT_MODES.CREATE_ONLY }).entries[0].action, 'create');

  const updateOnly = plan(LIVE_HEADER, rows, { existing: items, mode: IMPORT_MODES.UPDATE_ONLY });
  eq('…but an error in UPDATE_ONLY, where the key resolves to nothing', updateOnly.entries[0].action, 'error');
  eq('…named against the column that is the key', updateOnly.entries[0].issues.find((i) => i.severity === 'error').field, 'index');
  eq('…and nothing is written', writableExcelEntries(updateOnly.entries).length, 0);
}
{
  // CREATE_ONLY still means create only, even when ક્રમ is the key.
  const existing = [item({ id: 'darshan-027', index: 27, caption: 'હાલનું' })];
  const { entries } = plan(LIVE_HEADER, [['27', 'Varni(27)', 'નવું']], { existing, mode: IMPORT_MODES.CREATE_ONLY });
  eq('a row matching an existing ક્રમ is skipped in CREATE_ONLY', entries[0].action, 'skip');
  eq('…and it is not dressed up as a conflict', 'conflict' in entries[0], false);
}
{
  // Two rows for one ક્રમ is still the file disagreeing with itself, key or no key.
  const existing = [item({ id: 'darshan-027', index: 27 })];
  const { counts } = plan(LIVE_HEADER, [['27', '', 'ક'], ['27', '', 'ખ']], { existing });
  eq('a duplicate ક્રમ within the file is still an error', counts.error, 1);
}

group('§3a — an Item ID column that IS present still takes precedence');
{
  const existing = [item({ id: 'darshan-027', index: 27, caption: 'હાલનું' }), item({ id: 'darshan-005', index: 5, caption: 'પાંચ' })];

  // The header carries an Item ID column, so §7 is live again and a row naming darshan-005
  // while carrying 27 is the genuine ambiguity §7 exists for.
  const conflicted = plan(EN_HEADER, [row8({ id: 'darshan-005', index: '27', caption: 'નવું' })], { existing });
  eq('the id column decides the join', conflicted.joinedOn, 'id');
  eq('…and the borrowed number is still a §7 conflict', conflicted.entries[0].conflict.existingId, 'darshan-027');
  eq('…skipped by default, never overwritten', conflicted.entries[0].action, 'skip');

  // A blank cell in a column that exists still means "new દ્રશ્ય", which is a different claim
  // from the column being absent — and still collides.
  const blank = plan(EN_HEADER, [row8({ index: '27', caption: 'નવું' })], { existing });
  eq('a blank Item ID cell is a new દ્રશ્ય, not a join on ક્રમ', blank.joinedOn, 'id');
  eq('…so landing on an existing number is still a conflict', !!blank.entries[0].conflict, true);
  eq('…and still skips', blank.entries[0].action, 'skip');

  // Drop only the Item ID column, keep everything else, and the same row updates instead.
  const noIdHeader = EN_HEADER.filter((h) => h !== 'Item ID');
  const noIdRow = row8({ index: '27', caption: 'નવું' }).filter((_, i) => i !== 0);
  const joined = plan(noIdHeader, [noIdRow], { existing });
  eq('removing the column — and nothing else — switches the key', joined.joinedOn, 'index');
  eq('…and the identical row now updates darshan-027', [joined.entries[0].action, joined.entries[0].id], ['update', 'darshan-027']);
  eq('…with no conflict raised', 'conflict' in joined.entries[0], false);
  eq('…writing what the row said', joined.entries[0].patch.caption, 'નવું');
}
{
  // An export round trip carries the Item ID column, so §3a never disturbs §3.
  const items = withDisplayIndex(buildDarshanItems(MANIFEST, {}));
  const header = excelHeaderRow();
  const { joinedOn, counts } = buildExcelPlan({
    rows: [header, ...items.map(itemToRow)],
    headerRow: 0,
    columns: detectDarshanColumns(header),
    existing: items,
  });
  eq('an export still joins on the id it exported', joinedOn, 'id');
  eq('…and is still a no-op', [counts.update, counts.create, counts.error], [0, 0, 0]);
}

// ==================================================================== no-op detection

group('a row that changes nothing is skipped, not written');
{
  const existing = [item({ id: 'darshan-007', index: 7, order: 7, title: 'શીર્ષક', caption: 'વર્ણન', status: 'ACTIVE', driveId: DRIVE_A })];
  const { entries, counts } = plan(EN_HEADER, [
    row8({ id: 'darshan-007', index: '7', title: 'શીર્ષક', caption: 'વર્ણન', driveId: DRIVE_A, order: '7', status: 'ACTIVE' }),
  ], { existing });
  eq('nothing to write', entries[0].action, 'skip');
  eq('…and nothing claimed', entries[0].patch, {});
  eq('…so the audit log stays about real edits', counts.update, 0);
  eq('…and the row is still in the report', counts.total, 1);
}
group('blank rows are spacing, not દ્રશ્યો');
{
  const { counts } = plan(EN_HEADER, [row8({ index: '400' }), ['', '', '', '', '', '', '', ''], []], { existing: [] });
  eq('only the real row is counted', counts.total, 1);
}

// ==================================================================== §3 round trip

group('§3 — export → import is a no-op, over the real collection');
{
  const items = withDisplayIndex(buildDarshanItems(MANIFEST, {}));
  const header = excelHeaderRow();
  const rows = items.map(itemToRow);
  const { entries, counts } = buildExcelPlan({
    rows: [header, ...rows],
    headerRow: 0,
    columns: detectDarshanColumns(header),
    existing: items,
    mode: IMPORT_MODES.UPSERT,
  });

  eq('every દ્રશ્ય comes back as a row', counts.total, items.length);
  eq('and the import would write nothing at all', [counts.create, counts.update, counts.error], [0, 0, 0]);
  eq('…every row skipped as unchanged', counts.skip, items.length);
  eq('…so a real change would be visible in a report of zero', writableExcelEntries(entries).length, 0);
}
{
  // The same journey, through the encoder and parser a real download and upload use.
  const items = withDisplayIndex(buildDarshanItems(MANIFEST, {}));
  const header = excelHeaderRow();
  const csv = toCsv(header.map((label) => ({ label, key: label })), items.map((it) => {
    const cells = itemToRow(it);
    return Object.fromEntries(header.map((label, i) => [label, cells[i]]));
  }));

  eq('the file starts with the BOM Excel needs for Gujarati', csv.charCodeAt(0), 0xfeff);

  const grid = parseDelimited(csv.replace(/^\uFEFF/, ''), ',');
  const { counts } = buildExcelPlan({
    rows: grid,
    headerRow: 0,
    columns: detectDarshanColumns(grid[0]),
    existing: items,
    mode: IMPORT_MODES.UPSERT,
  });
  eq('CSV in the middle changes nothing either', [counts.total, counts.create, counts.update, counts.error], [items.length, 0, 0, 0]);

  // And the text itself, character for character.
  const cols = detectDarshanColumns(grid[0]);
  const captions = grid.slice(1).map((r) => rowToPatch(r, cols).caption);
  eq('every વર્ણન survives byte for byte', captions.join(' '), items.map((i) => i.caption).join(' '));
  eq('…including the one with a newline inside a quoted field',
    captions.some((c) => c.includes('\n')) === items.some((i) => i.caption.includes('\n')), true);
}

group('§3 — Gujarati is never normalised');
{
  const cols = detectDarshanColumns(EN_HEADER);
  // ઈ (U+0A88 as a matra, ી) and ઇ (િ) are different characters. Both spellings of ફાઈલ/ફાઇલ
  // are in the wild; folding one into the other would silently rewrite a hundred વર્ણન.
  const text = 'ફાઈલ અને ફાઇલ — બંને';
  const back = rowToPatch(row8({ caption: text }), cols).caption;
  eq('ઈ and ઇ come back as they went in', back, text);
  eq('…and the codepoints are identical', [...back].map((c) => c.codePointAt(0)), [...text].map((c) => c.codePointAt(0)));
  eq('a title with a combining mark is untouched', rowToPatch(row8({ title: 'નીલકંઠ' }), cols).title, 'નીલકંઠ');
}

group('§3 — commas, quotes, newlines and formula guards');
{
  const nasty = 'એક, બે "ત્રણ" — ચાર\nપાંચ, છ';
  const it = item({ caption: nasty, title: '=SUM(A1:A9)' });
  const header = excelHeaderRow();
  const csv = toCsv(header.map((label) => ({ label, key: label })), [Object.fromEntries(
    header.map((label, i) => [label, itemToRow(it)[i]])
  )]);

  eq('the formula guard fires on the way out', csv.includes("'=SUM(A1:A9)"), true);
  eq('…so Excel shows the text instead of evaluating it', csvCell('=SUM(A1:A9)'), "'=SUM(A1:A9)");

  const grid = parseDelimited(csv.replace(/^\uFEFF/, ''), ',');
  const cols = detectDarshanColumns(grid[0]);
  const patch = rowToPatch(grid[1], cols);
  eq('the comma, the quotes and the newline all come back', patch.caption, nasty);
  eq('and the guard is undone, so the round trip does not grow an apostrophe', patch.title, '=SUM(A1:A9)');

  const { counts } = buildExcelPlan({ rows: grid, headerRow: 0, columns: cols, existing: [it] });
  eq('…which is what makes it a no-op', [counts.skip, counts.update], [1, 0]);
}
{
  const cols = detectDarshanColumns(EN_HEADER);
  eq("an apostrophe in front of ordinary text is content and stays",
    rowToPatch(row8({ caption: "'ઓગણીસ" }), cols).caption, "'ઓગણીસ");
}

// ==================================================================== the template (§8)

group('templateRows and instructionsText');
{
  const rows = templateRows();
  eq('the header plus three examples', rows.length, 4);
  eq('eight columns wide', rows[0].length, IMPORTABLE_COLUMNS.length);
  eq('headers are bilingual', rows[0][1], 'Index Number (ક્રમ)');
  eq('every example row is the same width', rows.every((r) => r.length === rows[0].length), true);

  const items = withDisplayIndex(buildDarshanItems(MANIFEST, {}));
  const cols = detectDarshanColumns(rows[0]);
  const { entries, counts } = buildExcelPlan({ rows, headerRow: 0, columns: cols, existing: items });
  eq('the template parses as three creates', [counts.total, counts.create, counts.error], [3, 3, 0]);
  eq('…and no example row can touch a real દ્રશ્ય',
    entries.every((e) => !items.some((i) => i.id === e.id)), true);
  eq('…nor collide with a real ક્રમ', entries.every((e) => !e.conflict), true);
  eq('the first example shows a new દ્રશ્ય: Item ID blank', rows[1][0], '');
  eq('the second shows an edit: Item ID filled in', rows[2][0].startsWith('darshan-'), true);
}
{
  const text = instructionsText();
  const has = (s) => text.includes(s);
  eq('names all five statuses', SCENE_STATUSES.every((s) => has(s)), true);
  eq('says Item ID is blank for a new દ્રશ્ય', has('leave Item ID EMPTY'), true);
  eq('separates ક્રમ from ક્રમાંક', has('INDEX NUMBER AND DISPLAY ORDER ARE NOT THE SAME THING'), true);
  eq('explains how a Drive reference is written', has('https://drive.google.com/file/d/'), true);
  eq('explains what happens to duplicates', has('already belongs to'), true);
  eq('names the required column', has('required for a new દ્રશ્ય'), true);
  eq('tells him to delete the examples', has('901'), true);
  eq('and to save as CSV UTF-8', has('CSV UTF-8'), true);
}

// ==================================================================== the .xlsx reader

/**
 * A real ZIP, built here.
 *
 * Not a hand-waved fixture: `xlsx-read.js` walks the central directory, cross-checks the
 * local header and inflates raw DEFLATE, so anything less than a genuine archive would test
 * the test rather than the reader. Both flavours are produced — stored and deflated — because
 * `DecompressionStream('deflate-raw')` is the one part that could not be ported from
 * `scripts/lib/spreadsheet.mjs` unchanged and is therefore the part most worth exercising.
 */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function zipOf(parts, { deflate = false } = {}) {
  const locals = [];
  const central = [];
  let offset = 0;

  for (const [name, text] of parts) {
    const nameBuf = Buffer.from(name, 'utf8');
    const body = Buffer.from(text, 'utf8');
    const stored = deflate ? zlib.deflateRawSync(body) : body;
    const method = deflate ? 8 : 0;
    const crc = crc32(body);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, stored);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(stored.length, 20);
    cd.writeUInt32LE(body.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);

    offset += 30 + nameBuf.length + stored.length;
  }

  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(parts.length, 8);
  eocd.writeUInt16LE(parts.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, cdBuf, eocd]);
}

const xmlEscape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const colName = (n) => {
  let out = '';
  for (let x = n + 1; x > 0; ) {
    const rem = (x - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    x = Math.floor((x - rem) / 26);
  }
  return out;
};

/** A grid → a workbook, with every string in the shared-string table, the way Excel writes it. */
function workbookOf(grid, opts = {}) {
  const shared = [];
  const idx = new Map();
  const sheetRows = grid.map((cells, r) => {
    const out = cells.map((value, c) => {
      if (value === '' || value === null || value === undefined) return '';
      const text = String(value);
      if (!idx.has(text)) {
        idx.set(text, shared.length);
        shared.push(text);
      }
      return `<c r="${colName(c)}${r + 1}" t="s"><v>${idx.get(text)}</v></c>`;
    });
    return `<row r="${r + 1}">${out.join('')}</row>`;
  });

  return zipOf([
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types/>'],
    ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8"?><workbook><sheets><sheet name="દ્રશ્યો" sheetId="1" r:id="rId1"/></sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships><Relationship Id="rId1" Target="worksheets/theOnlyTab.xml"/></Relationships>'],
    ['xl/sharedStrings.xml', `<?xml version="1.0" encoding="UTF-8"?><sst count="${shared.length}">${shared.map((s) => `<si><t>${xmlEscape(s)}</t></si>`).join('')}</sst>`],
    ['xl/worksheets/theOnlyTab.xml', `<?xml version="1.0" encoding="UTF-8"?><worksheet><sheetData>${sheetRows.join('')}</sheetData></worksheet>`],
  ], opts);
}

group('readXlsx — a stored archive');
{
  const grid = [['ક્રમ', 'વર્ણન'], ['1', 'પહેલું દ્રશ્ય']];
  const got = await readXlsx(workbookOf(grid));
  eq('the grid comes back as it went in', got, grid);
}

group('readXlsx — a deflated archive (the browser inflate)');
{
  const grid = [['Item ID', 'Description'], ['darshan-001', 'સમુદ્રના પ્રચંડ મોજાં અને ખડકની કમાન'.repeat(20)]];
  const got = await readXlsx(workbookOf(grid, { deflate: true }));
  eq('DecompressionStream("deflate-raw") reads what zlib wrote', got, grid);
}

group('readXlsx — the shapes Excel and LibreOffice actually emit');
{
  // The worksheet is NOT called sheet1.xml, so only the relationship gets us there — which
  // is the point: sheet1.xml is a storage name, not the leftmost tab.
  const got = await readXlsx(workbookOf([['ક્રમ'], ['1']]));
  eq('the first tab is resolved through r:id, not by filename', got[1][0], '1');
}
{
  const bytes = zipOf([
    ['xl/workbook.xml', '<workbook><sheets><sheet name="a" sheetId="1" r:id="rId1"/></sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="/xl/worksheets/sheet1.xml"/></Relationships>'],
    ['xl/worksheets/sheet1.xml',
      '<worksheet><sheetData>' +
      // An inline string, a rich-text run split mid-word, a numeric cell, and a hole at B.
      '<row r="1"><c r="A1" t="inlineStr"><is><t>ક્રમ</t></is></c><c r="C1" t="inlineStr"><is><r><t>વર્</t></r><r><t>ણન</t></r><rPh><t>ignore me</t></rPh></is></c></row>' +
      '<row r="2"><c r="A2"><v>27</v></c><c r="C2" t="inlineStr"><is><t>&#2709;&#2765;&#2736;&#2734;</t></is></c></row>' +
      '</sheetData></worksheet>'],
  ]);
  const got = await readXlsx(bytes);
  eq('inline strings are read', got[0][0], 'ક્રમ');
  eq('a rich-text run is concatenated, not truncated', got[0][2], 'વર્ણન');
  eq('…and furigana is dropped rather than glued on', got[0].length, 3);
  eq('a blank cell keeps the columns lined up', got[0][1], '');
  eq('a numeric cell arrives as its text', got[1][0], '27');
  eq('numeric character references decode to Gujarati', got[1][2], 'ક્રમ');
}

group('readXlsx — a file it cannot read says what to do instead');
await throws('not a ZIP at all', () => readXlsx(Buffer.from('ક્રમ,વર્ણન\n1,પહેલું', 'utf8')), 'Save As → CSV UTF-8');
await throws('…and says why', () => readXlsx(Buffer.from('ક્રમ,વર્ણન\n1,પહેલું', 'utf8')), 'not a ZIP archive');
await throws('a ZIP that is not a workbook', () => readXlsx(zipOf([['hello.txt', 'hi']])), 'is this really an Excel file?');
await throws('something that is not file data at all', () => readXlsx('/tmp/darshan.xlsx'), 'Save As → CSV UTF-8');
{
  const bytes = zipOf([['xl/workbook.xml', '<workbook><sheets/></workbook>']]);
  await throws('a workbook with no sheets', () => readXlsx(bytes), 'declares no sheets');
}

group('readXlsx → the whole import, end to end');
{
  const items = [item({ id: 'darshan-027', index: 27, order: 27, title: '', caption: 'હાલનું' })];
  const grid = [
    ['દર્શન યાદી — ૨૦૨૬'],                                    // the merged banner
    [],
    ['સ્થિતિ', 'આઈડી', 'વર્ણન', 'ક્રમ', 'શીર્ષક'],              // Gujarati, shuffled
    ['PUBLISHED', 'darshan-027', 'નવું વર્ણન', '27', 'નવું શીર્ષક'],
  ];
  const read = await readXlsx(workbookOf(grid, { deflate: true }));
  const { headerRow, columns } = findExcelHeaderRow(read);
  eq('the banner is skipped', headerRow, 2);

  const { entries, counts } = buildExcelPlan({ rows: read, headerRow, columns, existing: items });
  eq('one row, one update', [counts.total, counts.update], [1, 1]);
  eq('…row 4, which is the row number Excel shows him', entries[0].rowNumber, 4);
  eq('…changing exactly what the file said', entries[0].patch, { title: 'નવું શીર્ષક', caption: 'નવું વર્ણન', status: 'PUBLISHED' });
  eq('…and the ક્રમ it kept is not reported as a change', 'index' in entries[0].patch, false);
}

// ==================================================================== no hidden totals

group('neither module knows how many દ્રશ્યો there are (§62)');
for (const file of ['../shared/domain/darshan-excel.js', '../shared/domain/xlsx-read.js']) {
  const source = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8');
  // Comments are prose and may name ૧૦૯ as an example; code may not.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n');
  eq(`${file} holds no literal total`, /\b(108|109|110)\b/.test(code), false);
}

// ==================================================================== result

console.log(`\n  ${pass} passed, ${fails.length} failed\n`);
if (fails.length) {
  console.log(fails.map((f) => `  ✗ ${f}`).join('\n\n') + '\n');
  process.exit(1);
}
