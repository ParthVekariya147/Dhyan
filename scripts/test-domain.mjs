/**
 * Tests for the pure domain logic — `npm test`.
 *
 * Why these and not others: everything here is a pure function with no database, no
 * network and no React, so it can be tested exactly and cheaply. The rest of the system is
 * verified differently — `npm run verify` measures real delivery in Chrome, and the panel
 * is checked by resolving its module graph — so this file deliberately does not try to
 * cover them.
 *
 * What it protects, specifically:
 *
 *   1. **The manifest/overlay merge.** `applyOverlay` decides what a યુવક actually sees:
 *      which વર્ણન, which image, which number, in what order. Its edge cases are the kind
 *      that fail silently — an empty caption read as "blank this scene", a replaced image
 *      that loses its srcset, a published ladder flattened to one file. None of those throw;
 *      they just quietly show the wrong thing to 2,000 people.
 *
 *   2. **Drive link parsing.** The સંચાલક pastes whatever Drive gave him, and a folder link
 *      looks almost identical to a file link. Refusing it clearly is the difference between
 *      a useful error and a mystery.
 *
 * No test framework, because adding one to run assertions on two modules is not worth a
 * dependency. Exit code is the result: 0 green, 1 red.
 */
import { readFileSync } from 'node:fs';
import {
  applyOverlay,
  toDarshanItem,
  isLearnable,
  hasImage,
  sceneRowEntry,
  buildDarshanItems,
  validateDarshanItems,
  withDisplayIndex,
} from '../shared/domain/darshan.js';
import { resolveLevel4Gate, validateLevel4Gate } from '../shared/domain/settings.js';
import {
  parseDriveLink,
  parseDriveFolderLink,
  driveImageUrl,
  resolveImageInput,
  isGoogleImageCdn,
} from '../shared/domain/drive.js';
import {
  parseDelimited,
  detectDelimiter,
  detectColumns,
  findHeaderRow,
  readSheet,
  toSheetRows,
  toNumber,
  fileKey,
  indexDriveFiles,
  matchDriveFile,
  buildImportPlan,
  writableEntries,
} from '../shared/domain/sheet-import.js';

let pass = 0;
const fails = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) pass++;
  else fails.push(`${name}\n       got  ${g}\n       want ${w}`);
};

const group = (name) => console.log(`\n  ${name}`);

// ==================================================================== fixtures

const DRIVE_007 = '1AnOf5K9Ab0kjmOs2gd_arx9CAqYxdK9a';

/** A manifest entry in the shape `npm run darshan` actually writes. */
const entry = () => ({
  id: 'darshan-007',
  index: 7,
  order: 7,
  n: 7,
  t: 'સાતમા દ્રશ્યનું વર્ણન',
  driveId: DRIVE_007,
  url: driveImageUrl(DRIVE_007),
  fullUrl: driveImageUrl(DRIVE_007, 2560),
  file: 'Varni(7).png',
});

/** A દ્રશ્ય whose picture is in Drive but whose વર્ણન has not been written. */
const bare = () => ({ ...entry(), id: 'darshan-105', n: 105, index: 105, order: 105, t: '' });

/** A દ્રશ્ય created in the panel: a row before it is a picture. */
const placeholder = () => ({
  ...entry(),
  id: 'darshan-200',
  n: 200,
  index: 200,
  order: 200,
  url: '',
  fullUrl: '',
  driveId: '',
});

// ==================================================================== the merge

group('applyOverlay — no row');
{
  const e = entry();
  eq('returns the same object, so nothing re-renders needlessly', applyOverlay(e, null) === e, true);
}

group('applyOverlay — વર્ણન');
eq(
  "an empty caption is 'not written', never 'blank this scene'",
  applyOverlay(entry(), { caption: '' }).t,
  'સાતમા દ્રશ્યનું વર્ણન'
);
eq(
  'a written caption overrides the sheet',
  applyOverlay(entry(), { caption: 'સંચાલકે લખેલું' }).t,
  'સંચાલકે લખેલું'
);

group('applyOverlay — numbering and order');
{
  const out = applyOverlay(entry(), { index: 12 });
  eq('a renumber moves both index and the printed n', [out.index, out.n], [12, 12]);
  eq('…and leaves presentation order alone', out.order, 7);
}
eq('order moves independently', applyOverlay(entry(), { order: 3 }).order, 3);
eq('a null index — the ordinary case — changes nothing', applyOverlay(entry(), { index: null }).n, 7);

group('applyOverlay — a replaced image');
{
  const NEW_ID = '1WEOZT7wDhrmBnW5ZuD9uKRzsQQYquGLV';
  const out = applyOverlay(entry(), { imageUrl: driveImageUrl(NEW_ID), driveId: NEW_ID });
  eq('the feed follows the new link', out.url, driveImageUrl(NEW_ID));
  eq('the enlarged view re-asks the CDN for the NEW file, not the old one', out.fullUrl, driveImageUrl(NEW_ID, 2560));
}
{
  // No Drive id — a URL the સંચાલક typed by hand, or hosted himself.
  const out = applyOverlay(entry(), { imageUrl: 'https://cdn.example/new-007.jpg' });
  eq('a hand-typed URL is used as it stands', out.url, 'https://cdn.example/new-007.jpg');
  eq('…and the lightbox reuses it, having nothing to re-ask with', out.fullUrl, 'https://cdn.example/new-007.jpg');
}
eq('an absent imageUrl leaves the manifest link alone', applyOverlay(entry(), { caption: 'x' }).url, entry().url);

group('isLearnable — a દ્રશ્ય needs BOTH a link and a વર્ણન');
eq('a picture with no વર્ણન is not taught', isLearnable(bare()), false);
eq('an empty panel caption does not change that', isLearnable(applyOverlay(bare(), { caption: '' })), false);
eq(
  'writing the વર્ણન publishes it — active is re-derived, no rebuild',
  isLearnable(applyOverlay(bare(), { caption: 'નવું વર્ણન' })),
  true
);
eq('a વર્ણન with no link is still withheld — that would be an empty frame', isLearnable(placeholder()), false);
eq('an untouched scene is not promoted by an unrelated edit', !!applyOverlay(bare(), { index: 105 }).active, false);
eq('hasImage is the link and nothing else', [hasImage(entry()), hasImage(placeholder())], [true, false]);

// ==================================================================== the panel's view

group('toDarshanItem');
eq(
  'the panel lists back what the સંચાલક wrote, not the sheet',
  toDarshanItem(entry(), { id: 'darshan-007', caption: 'નવું' }).caption,
  'નવું'
);
eq(
  'imageUrl follows a replacement',
  toDarshanItem(entry(), { id: 'darshan-007', imageUrl: 'https://cdn.example/x.jpg' }).imageUrl,
  'https://cdn.example/x.jpg'
);
eq('imageUrl falls back to the manifest link', toDarshanItem(entry(), undefined).imageUrl, entry().url);
eq(
  'the grid gets a narrow encode of the same Drive file, not the feed’s copy',
  toDarshanItem(entry(), undefined).thumbUrl,
  driveImageUrl(DRIVE_007, 400)
);
eq('an image-only દ્રશ્ય reports the real gap', toDarshanItem(bare(), undefined).reason, 'No caption written');
eq(
  'and stops reporting it once described',
  toDarshanItem(bare(), { id: 'darshan-105', caption: 'નવું' }).reason,
  ''
);
eq(
  'a missing link outranks a missing વર્ણન — it is what blocks everything else',
  toDarshanItem({ ...placeholder(), t: '' }, undefined).reason,
  'No image link'
);
eq('the Drive file name reaches the panel', toDarshanItem(entry(), undefined).file, 'Varni(7).png');

group('buildDarshanItems / validateDarshanItems');
{
  const items = buildDarshanItems([entry(), bare()], {});
  eq('every દ્રશ્ય is listed, described or not', items.length, 2);
  const report = validateDarshanItems(items);
  eq('the total is counted, never a literal', report.total, 2);
  eq('the missing વર્ણન is named as the real gap', report.missingCaptionIds, ['darshan-105']);
  eq(
    'a દ્રશ્ય with a link is not reported as missing an image',
    report.issues.filter((i) => i.code === 'missing-image').length,
    0
  );
}
{
  const report = validateDarshanItems(buildDarshanItems([entry(), placeholder()], {}));
  eq(
    'a દ્રશ્ય with no link IS reported',
    report.issues.filter((i) => i.code === 'missing-image').map((i) => i.id),
    ['darshan-200']
  );
}
{
  // Presentation order, not array position, decides the feed (§1 rule 2).
  const items = buildDarshanItems([entry(), bare()], { 'darshan-105': { order: 1 } });
  eq('an overlay reorder actually reorders', items.map((i) => i.id), ['darshan-105', 'darshan-007']);
}

// ==================================================================== the શીર્ષક
//
// `title` (0013) is the short name a દ્રશ્ય is listed under. Two things about it are worth
// more than the feature itself, and both are tested here rather than trusted:
//
//   1. It folds like `caption`. `not null default ''` means every row that has ever been
//      touched carries one and almost all of them carry '', so an empty title has to mean
//      "not written yet" and never "blank this દ્રશ્ય's title". The failure is silent and
//      total: one `out.title = scene.title` without the guard erases every title the moment
//      anybody toggles a દ્રશ્ય's visibility.
//
//   2. **It is not part of the content gate** (DARSHAN_DATA_CONTRACT.md §2.1). Every દ્રશ્ય in
//      the collection ships with an empty title, so folding it into `isLearnable` — or into
//      the `isNumbered` rule inside `withDisplayIndex` — would withhold the entire collection
//      from the યુવક app and null every `displayIndex`, which would in turn empty every
//      લેવલ ૪ કસોટી range. Nothing would throw. The app would simply be blank.

/** The same manifest entry with a title already written on it, as applyOverlay leaves it. */
const named = () => applyOverlay(entry(), { title: 'વનવિચરણ' });

group('title — folded exactly as the વર્ણન is');
eq('a written title reaches the merged scene', named().title, 'વનવિચરણ');
eq('Gujarati survives the merge byte for byte', named().title === 'વનવિચરણ', true);
eq(
  "an empty title is 'not written', never 'blank this દ્રશ્ય'",
  applyOverlay(named(), { title: '' }).title,
  'વનવિચરણ'
);
eq('a manifest entry with no row has no title to lose', applyOverlay(entry(), null).title, undefined);
eq('a title does not arrive from an unrelated edit', applyOverlay(entry(), { caption: 'ક' }).title, undefined);
eq('a દ્રશ્ય that exists only as a row starts unnamed', sceneRowEntry({ id: 'darshan-200', index: 200 }).title, '');

group('title — NOT a gate (DARSHAN_DATA_CONTRACT.md §2.1)');
eq('naming a દ્રશ્ય does not make it learnable', isLearnable(applyOverlay(bare(), { title: 'નામ' })), false);
eq('…and a picture with a વર્ણન stays learnable without one', isLearnable(entry()), true);
eq('…and adding one does not change that either', isLearnable(named()), true);
eq('a named દ્રશ્ય with no picture is still withheld', isLearnable(applyOverlay(placeholder(), { title: 'નામ' })), false);
{
  // `isNumbered` is internal to withDisplayIndex, so it is tested through the number it
  // produces — which is the thing that actually matters anyway.
  const untitled = withDisplayIndex([entry(), bare()]);
  const titled = withDisplayIndex([named(), applyOverlay(bare(), { title: 'નામ' })]);
  eq(
    'numbering ignores the title entirely',
    titled.map((s) => s.displayIndex),
    untitled.map((s) => s.displayIndex)
  );
  eq('…the described દ્રશ્ય is numbered', titled[0].displayIndex, 1);
  eq('…and the one with no વર્ણન is not, title or no title', titled[1].displayIndex, null);
}

group('title — the panel’s view and the report');
eq('toDarshanItem exposes it', toDarshanItem(entry(), { id: 'darshan-007', title: 'વનવિચરણ' }).title, 'વનવિચરણ');
eq('…as \'\' when none has been written', toDarshanItem(entry(), undefined).title, '');
eq('…and it does not displace the વર્ણન', toDarshanItem(entry(), { id: 'darshan-007', title: 'વનવિચરણ' }).caption, entry().t);
{
  const items = buildDarshanItems([entry(), bare()], { 'darshan-007': { id: 'darshan-007', title: 'વનવિચરણ' } });
  const report = validateDarshanItems(items);
  const titleIssues = report.issues.filter((i) => i.code === 'missing-title');
  eq('the unnamed દ્રશ્યો are counted', report.missingTitles, 1);
  eq('…and named, so the તપાસ page can link to each one', report.missingTitleIds, ['darshan-105']);
  eq('…reported as a warning', titleIssues.map((i) => i.severity), ['warn']);
  eq('…never as an error', titleIssues.some((i) => i.severity === 'error'), false);
  eq('…so a missing title does not make a દ્રશ્ય invalid', report.invalid, 0);
  eq('a title does not stand in for a વર્ણન in the report', report.missingCaptionIds, ['darshan-105']);
}

group('title — the whole real collection, unnamed, still numbered 1…N');
{
  /*
    The one that would have caught the mistake §2.1 forbids, run against the real thing.

    Every entry in content/darshan.json ships without a title, so if `title` had leaked into
    the content gate this collection would number nothing at all. The size is read from the
    manifest and never written down (§62 / ORDERING.md §8 rule 2) — the sheet decides what it
    is, and the assertion is "1…N over whatever is there", not "1…109".
  */
  const manifest = JSON.parse(readFileSync(new URL('../content/darshan.json', import.meta.url), 'utf8'));
  const items = buildDarshanItems(manifest, {});
  const sequenced = withDisplayIndex(items);
  const numbered = sequenced.filter((s) => s.displayIndex != null);

  eq('the collection is not empty, or this test proves nothing', items.length > 0, true);
  eq('not one દ્રશ્ય has a title yet', items.every((i) => i.title === ''), true);
  eq('every one of them is still numbered', numbered.length, items.length);
  eq(
    'and the sequence is a gapless 1…N',
    sequenced.map((s) => s.displayIndex).join(','),
    items.map((_, i) => i + 1).join(',')
  );
  eq('N is the collection size, counted', numbered[numbered.length - 1].displayIndex, items.length);
  eq('the report says the same: every દ્રશ્ય unnamed…', validateDarshanItems(items).missingTitles, items.length);
  eq('…and none of them invalid because of it', validateDarshanItems(items).invalid, 0);
}

// ==================================================================== Drive links

const FILE_ID = '1qwZibCk9IaU_fmVi8hDJ4hfmCkY3UGfw';

group('parseDriveLink — the forms a સંચાલક pastes');
eq('share link', parseDriveLink(`https://drive.google.com/file/d/${FILE_ID}/view?usp=sharing`), { ok: true, id: FILE_ID });
eq('edit link', parseDriveLink(`https://drive.google.com/file/d/${FILE_ID}/edit`), { ok: true, id: FILE_ID });
eq('open?id=', parseDriveLink(`https://drive.google.com/open?id=${FILE_ID}`), { ok: true, id: FILE_ID });
eq('uc download', parseDriveLink(`https://drive.google.com/uc?export=download&id=${FILE_ID}`), { ok: true, id: FILE_ID });
eq('docs /d/ form', parseDriveLink(`https://docs.google.com/presentation/d/${FILE_ID}/edit`), { ok: true, id: FILE_ID });
eq('a bare id', parseDriveLink(FILE_ID), { ok: true, id: FILE_ID });
eq('surrounding whitespace', parseDriveLink(`  https://drive.google.com/file/d/${FILE_ID}/view  `), { ok: true, id: FILE_ID });

group('parseDriveLink — refusals that have to be legible');
{
  // The likeliest wrong paste: the folder the collection lives in.
  const r = parseDriveLink(`https://drive.google.com/drive/folders/${FILE_ID}?usp=sharing`);
  eq('a folder link is refused', r.ok, false);
  eq('…and says it is a folder', /folder/i.test(r.gu), true);
}
{
  const r = parseDriveLink('https://drive.google.com/');
  eq('a Drive URL with no id is refused', r.ok, false);
  eq('…naming the id as what is missing', /file id/i.test(r.gu), true);
}
eq('an empty box is refused', parseDriveLink('').ok, false);
eq('a non-Drive URL is refused', parseDriveLink('https://example.com/a.jpg').ok, false);

group('parseDriveFolderLink — the Settings box');
eq(
  'the folder link a સંચાલક copies out of Drive',
  parseDriveFolderLink(`https://drive.google.com/drive/folders/${FILE_ID}?usp=sharing`),
  { ok: true, id: FILE_ID }
);
eq('a bare folder id', parseDriveFolderLink(FILE_ID), { ok: true, id: FILE_ID });
{
  // The mirror-image wrong paste: one image, where the folder was asked for.
  const r = parseDriveFolderLink(`https://drive.google.com/file/d/${FILE_ID}/view`);
  eq('a file link is refused', r.ok, false);
  eq('…and says it wants the folder', /folder/i.test(r.gu), true);
}
eq('an empty folder box is refused', parseDriveFolderLink('').ok, false);

group('driveImageUrl — the form a browser can actually render');
eq(
  'Google’s image CDN, never the quota-metered download route',
  driveImageUrl(FILE_ID),
  `https://lh3.googleusercontent.com/d/${FILE_ID}=w1600-rj-v1`
);
eq(
  'width is requestable',
  driveImageUrl(FILE_ID, 960).startsWith(`https://lh3.googleusercontent.com/d/${FILE_ID}=w960`),
  true
);
// The suffix is what turns a 1.6 MB PNG master into a 132 KB JPEG. Dropping it silently
// would multiply every યુવક's data bill by twelve with nothing on screen to say so.
eq('re-encodes to JPEG rather than serving the master’s own format', /-rj/.test(driveImageUrl(FILE_ID)), true);
eq('the CDN host is recognised as renderable', isGoogleImageCdn(driveImageUrl(FILE_ID)), true);
eq('the download route is NOT', isGoogleImageCdn(`https://drive.google.com/uc?export=download&id=${FILE_ID}`), false);
eq('a random https url is not', isGoogleImageCdn('https://example.com/a.jpg'), false);

group('resolveImageInput — one entry point for whatever is pasted');
{
  const r = resolveImageInput(`https://drive.google.com/file/d/${FILE_ID}/view`);
  eq('a Drive link is converted, not refused', [r.ok, r.url], [true, driveImageUrl(FILE_ID)]);
  eq('…and the id travels with it', r.driveId, FILE_ID);
}
{
  const r = resolveImageInput('https://cdn.example/a.jpg');
  eq('a plain https image is accepted as it stands', [r.ok, r.url, r.driveId], [true, 'https://cdn.example/a.jpg', '']);
}
eq('an empty image box is refused', resolveImageInput('').ok, false);
eq('a folder link is refused', resolveImageInput(`https://drive.google.com/drive/folders/${FILE_ID}`).ok, false);

// ==================================================================== sheet import
//
// The bulk importer reads the સંચાલક's spreadsheet and rewrites the વર્ણન and the image of
// every દ્રશ્ય it names. Everything it decides is decided by shared/domain/sheet-import.js,
// and every one of those decisions fails *silently* when it is wrong: a mis-parsed row does
// not throw, it just teaches 2,000 યુવકો the wrong sentence under the wrong picture.
//
// The fixture below is the live sheet, copied verbatim — including row 88, whose વર્ણન
// contains a newline inside a quoted field. A line-by-line split turns that one દ્રશ્ય into
// two broken rows, which is exactly why the parser exists.

/** Pasted out of Google Sheets: tab-separated, RFC-4180 quoting, one embedded newline. */
const SHEET_TSV =
  'ક્રમ\tફોટો ફાઈલ\tદ્રશ્ય-વર્ણન (વિગતવાર)\n' +
  '1\tVarni(1)\tસમુદ્રના પ્રચંડ મોજાં અને ખડકની કમાન પર કોતરાયેલી નીલકંઠ વર્ણીની વનવિચરણ-મુદ્રાનું દર્શન\n' +
  '2\tVarni(2)\tસાગરકિનારે પથ્થર પર ઊભા રહી, ઊછળતાં પ્રચંડ મોજાં વચ્ચે નિર્ભય ઊભેલા વર્ણીનું દર્શન\n' +
  '88\tVarni(88)\t"ઘોર વનમાં વૃક્ષ નીચે નિદ્રાધીન વર્ણીરાજની પાસે શાંતચિતે બેઠેલું હિંસક પ્રાણી \n"\n' +
  '109\tVarni(109)\tસાગરનાં પ્રચંડ મોજાં વચ્ચે તેજોમય વર્ણી-દર્શન\n';

const ROW_88 = 'ઘોર વનમાં વૃક્ષ નીચે નિદ્રાધીન વર્ણીરાજની પાસે શાંતચિતે બેઠેલું હિંસક પ્રાણી';

group('detectDelimiter — a Sheets paste is TSV, a download is CSV');
eq('a paste out of Google Sheets is tab-separated', detectDelimiter(SHEET_TSV), '\t');
eq('a downloaded export is comma-separated', detectDelimiter('n,file,t\n1,a,b\n'), ',');
eq(
  'a comma inside a quoted વર્ણન does not vote for a delimiter',
  detectDelimiter('n\tfile\tt\n1\ta\t"એક, બે, ત્રણ"\n'),
  '\t'
);

group('parseDelimited — RFC-4180, because row 88 has a newline inside its વર્ણન');
{
  const rows = parseDelimited(SHEET_TSV, '\t');
  eq('the header and four દ્રશ્યો, not five rows', rows.length, 5);
  eq('row 88 stays one row', rows[3][0], '88');
  eq('…with its newline kept inside the field', rows[3][2].includes('\n'), true);
  eq('…and its text intact', rows[3][2].trim(), ROW_88);
  eq('the row after it is still દ્રશ્ય ૧૦૯', rows[4][0], '109');
  eq('every row has three cells', rows.every((r) => r.length === 3), true);
}
eq('CRLF is not left on the end of a cell', parseDelimited('a,b\r\nc,d\r\n', ',')[0][1], 'b');
eq('"" inside a quoted field is one literal quote', parseDelimited('a,"he said ""hi""" \n', ',')[0][1], 'he said "hi" ');
eq(
  'a quote in the middle of an unquoted field is a literal quote, not a state change',
  parseDelimited('a,5" x 7",c\n', ',')[0].length,
  3
);
eq('a trailing blank line is not a દ્રશ્ય', parseDelimited('a,b\n\n\n', ',').length, 1);
eq('a UTF-8 BOM does not glue itself to the first heading', parseDelimited('\uFEFFક્રમ,ફોટો\n', ',')[0][0], 'ક્રમ');

group('column detection — Gujarati headings, found by name and never by position');
{
  const cols = detectColumns(['ક્રમ', 'ફોટો ફાઈલ', 'દ્રશ્ય-વર્ણન (વિગતવાર)']);
  eq('ક્રમ is the number column', cols.index, 0);
  eq('ફોટો ફાઈલ is the file column', cols.file, 1);
  eq('દ્રશ્ય-વર્ણન is the વર્ણન column', cols.caption, 2);
}
{
  const cols = detectColumns(['Description', 'Image file', 'No.']);
  eq('English headings work in any order — number', cols.index, 2);
  eq('…file', cols.file, 1);
  eq('…description', cols.caption, 0);
}
eq(
  'a heading above the header row does not become the header',
  findHeaderRow([['નીલકંઠ વર્ણી — દર્શન યાદી'], [], ['ક્રમ', 'ફોટો ફાઈલ', 'વર્ણન']]).headerRow,
  2
);
{
  // The failure that matters: nothing recognisable. The panel must ask rather than guess,
  // because guessing writes the વર્ણન column into image_url on 109 દ્રશ્યો.
  const r = findHeaderRow([['ક', 'ખ', 'ગ'], ['1', 'x', 'y']]);
  eq('unrecognisable headings are reported, not guessed at', r.headerRow, -1);
  eq('…and no column is assumed', [r.columns.index, r.columns.file, r.columns.caption], [null, null, null]);
}
eq(
  'one recognisable word is not enough to promote a data row to the header',
  findHeaderRow([['1', 'Varni(1)', 'સાગરકિનારે… દ્રશ્ય']]).headerRow,
  -1
);

group('readSheet / toSheetRows — the live paste, end to end');
{
  const sheet = readSheet(SHEET_TSV);
  eq('read as tab-separated', sheet.delimiter, '\t');
  eq('header found on the first line', sheet.headerRow, 0);
  eq('columns mapped', [sheet.columns.index, sheet.columns.file, sheet.columns.caption], [0, 1, 2]);

  const rows = toSheetRows(sheet.rows, sheet.headerRow, sheet.columns);
  eq('four દ્રશ્યો, header excluded', rows.length, 4);
  eq('ક્રમ is a number', rows[0].n, 1);
  eq('the filename carries no extension, as the sheet writes it', rows[0].file, 'Varni(1)');
  eq('row 88 is one દ્રશ્ય', rows[2].n, 88);
  eq('…its trailing space and newline are trimmed away', rows[2].caption, ROW_88);
  eq('…and it is not confused with દ્રશ્ય ૧૦૯', rows[3].n, 109);
  eq('the line number is the sheet line, for a legible error', rows[3].line, 5);
}
eq('a wholly empty row is not reported as a broken દ્રશ્ય', toSheetRows([['', '', '']], -1, { index: 0, file: 1, caption: 2 }).length, 0);

group('toNumber — the ક્રમ column as people actually write it');
eq('a plain number', toNumber('88'), 88);
eq('spaces and punctuation around it', toNumber(' 12. '), 12);
eq('Gujarati digits', toNumber('૧૦૯'), 109);
eq('no digits at all is null, never 0', toNumber('ક્રમ'), null);
eq('an empty cell is null', toNumber(''), null);

group('Drive matching — a filename with no extension against the real folder');
{
  const drive = indexDriveFiles([
    { id: '17dayguvK91e9oR4CWj_4pcs4SNpCuPSf', name: 'Varni(1).png' },
    { id: 'id-two', name: 'Varni(2).PNG' },
    { id: 'id-88', name: 'Varni(88).png' },
    { id: 'id-109', name: 'varni(109).jpg' },
  ]);
  eq('the sheet name matches the file, extension ignored', matchDriveFile(drive, 'Varni(1)').file.id, '17dayguvK91e9oR4CWj_4pcs4SNpCuPSf');
  eq('case is ignored on the extension', matchDriveFile(drive, 'Varni(2)').how, 'exact');
  eq('case is ignored on the name', matchDriveFile(drive, 'Varni(109)').file.id, 'id-109');
  eq('surrounding whitespace is ignored', matchDriveFile(drive, '  Varni(88)  ').file.id, 'id-88');
  eq('a stray space inside the name still resolves, and says it was loose', matchDriveFile(drive, 'Varni (1)').how, 'loose');
  eq('a name that is not there is reported, not guessed', matchDriveFile(drive, 'Varni(999)').file, null);
  eq('…as "none", so the panel can name it', matchDriveFile(drive, 'Varni(999)').how, 'none');
  eq('an extension in the sheet is harmless', fileKey('Varni(1).png'), fileKey('varni(1)'));
}
{
  // Drive allows two files with the same name in one folder. Picking one silently would
  // point a દ્રશ્ય at whichever the listing returned first.
  const drive = indexDriveFiles([
    { id: 'a', name: 'Varni(5).png' },
    { id: 'b', name: 'varni(5).jpg' },
  ]);
  eq('two files with one name resolve to neither', matchDriveFile(drive, 'Varni(5)').file, null);
  eq('…and say why', matchDriveFile(drive, 'Varni(5)').how, 'ambiguous');
}

group('buildImportPlan — preview before write');
{
  const items = [
    { id: 'darshan-001', index: 1, caption: 'જૂનું વર્ણન', imageUrl: '/darshan/001-1400.abc.jpg' },
    { id: 'darshan-002', index: 2, caption: 'સાગરકિનારે પથ્થર પર ઊભા રહી, ઊછળતાં પ્રચંડ મોજાં વચ્ચે નિર્ભય ઊભેલા વર્ણીનું દર્શન', imageUrl: '/darshan/002-1400.abc.jpg' },
    { id: 'darshan-088', index: 88, caption: '', imageUrl: '/darshan/088-1400.abc.jpg' },
  ];
  const drive = indexDriveFiles([
    { id: FILE_ID, name: 'Varni(1).png' },
    { id: 'id-two', name: 'Varni(2).png' },
  ]);
  const sheet = readSheet(SHEET_TSV);
  const rows = toSheetRows(sheet.rows, sheet.headerRow, sheet.columns);
  const { entries, summary } = buildImportPlan({ rows, items, driveIndex: drive });

  eq('every row is accounted for', entries.length, 4);

  eq('દ્રશ્ય ૧ gets the new વર્ણન', entries[0].patch.caption, rows[0].caption);
  eq('…and the image CDN URL, not the download route', entries[0].patch.imageUrl, driveImageUrl(FILE_ID));
  eq('…and is marked as a change', entries[0].status, 'update');

  eq('દ્રશ્ય ૨ already has this વર્ણન, so it is not rewritten', entries[1].patch.caption, undefined);
  eq('…but its image still changes, so the row is a change', entries[1].status, 'update');

  eq('દ્રશ્ય ૮૮ has no file in the folder', entries[2].image.driveId, '');
  eq('…so no image is written', entries[2].patch.imageUrl, undefined);
  eq('…the unmatched name is reported rather than skipped', summary.unmatchedFiles, ['Varni(88)']);
  eq('…and its વર્ણન is still imported', entries[2].patch.caption, ROW_88);

  eq('દ્રશ્ય ૧૦૯ does not exist in this collection', entries[3].status, 'no-scene');
  eq('…and is NOT created', entries[3].patch, {});
  eq('…it is counted as a finding', summary.noScene, 1);

  eq('only the rows that change anything would be written', writableEntries(entries).length, 3);
  eq('દ્રશ્યો the sheet never named are counted, so a short paste is visible', summary.untouched, 0);
}
{
  // The rule shared/domain/darshan.js already enforces, restated where the bulk write is:
  // `caption: ''` is "no વર્ણન here", never "blank this દ્રશ્ય". Writing '' from an import
  // would read as 109 deliberate erasures in the audit log and would not even stick.
  const items = [{ id: 'darshan-003', index: 3, caption: 'લખેલું વર્ણન', imageUrl: '/darshan/003.jpg' }];
  const { entries, summary } = buildImportPlan({
    rows: [{ line: 2, n: 3, file: '', caption: '' }],
    items,
  });
  eq('an empty વર્ણન cell means "no change"', entries[0].patch, {});
  eq('…and the row is reported as unchanged, not written', entries[0].status, 'unchanged');
  eq('…so nothing is applied', summary.update, 0);
}
{
  const items = [{ id: 'darshan-004', index: 4, caption: 'ક', imageUrl: '' }];
  const { entries, summary } = buildImportPlan({
    rows: [
      { line: 2, n: 4, file: '', caption: 'નવું' },
      { line: 3, n: 4, file: '', caption: 'બીજું' },
      { line: 4, n: null, file: 'x', caption: 'y' },
    ],
    items,
  });
  eq('the second row for one ક્રમ is refused, not merged', entries[1].status, 'duplicate');
  eq('…so the first one still applies', entries[0].patch.caption, 'નવું');
  eq('a row with no usable ક્રમ is reported', entries[2].status, 'invalid');
  eq('…and counted', [summary.duplicate, summary.invalid], [1, 1]);
}
{
  // Turning one half off must not smuggle the other half through.
  const items = [{ id: 'darshan-001', index: 1, caption: 'જૂનું', imageUrl: '/darshan/001.jpg' }];
  const drive = indexDriveFiles([{ id: FILE_ID, name: 'Varni(1).png' }]);
  const rows = [{ line: 2, n: 1, file: 'Varni(1)', caption: 'નવું' }];
  const onlyText = buildImportPlan({ rows, items, driveIndex: drive, applyImages: false });
  eq('descriptions only: no image is written', onlyText.entries[0].patch.imageUrl, undefined);
  eq('descriptions only: the વર્ણન is', onlyText.entries[0].patch.caption, 'નવું');
  const onlyImages = buildImportPlan({ rows, items, driveIndex: drive, applyCaptions: false });
  eq('images only: no વર્ણન is written', onlyImages.entries[0].patch.caption, undefined);
  eq('images only: the image is', onlyImages.entries[0].patch.imageUrl, driveImageUrl(FILE_ID));
}

// ==================================================================== the લેવલ ૪ gate

/*
  `resolveLevel4Gate()` — what opens લેવલ ૪, out of a jsonb column anybody could have written.

  This is settings, which means it is `value -> 'level4Gate'` from a row that has been
  written by however many versions of the panel, and it decides access to a whole level for
  ~2,000 યુવકો. Two failures matter more than the happy path and neither announces itself:

    * a malformed value that resolves to "no gate" hands લેવલ ૪ to everybody;
    * a malformed value that resolves to NaN shuts it for everybody, permanently, because no
      score is ever >= NaN.

  So every branch below is a way the row can be wrong, and each asserts which side it falls
  on. `level4_gate_setting()` in 0014 mirrors these branch for branch — same defaults, same
  direction of failure — and the SQL is the authority; if the two disagree, this one is wrong.
*/
group('resolveLevel4Gate — a settings row that could say anything');
{
  const g = (stored) => resolveLevel4Gate(stored);

  eq('nothing configured', g(undefined), { require: true, threshold: 80 });
  eq('null', g(null), { require: true, threshold: 80 });
  eq('not an object', g('80'), { require: true, threshold: 80 });

  eq('the ordinary case', g({ require: true, threshold: 50 }), { require: true, threshold: 50 });
  eq('the gate turned off', g({ require: false, threshold: 50 }), { require: false, threshold: 50 });

  // Absence must never read as "open to everyone" — that is the unsafe direction.
  eq('require absent', g({ threshold: 50 }), { require: true, threshold: 50 });
  eq('require null', g({ require: null, threshold: 50 }), { require: true, threshold: 50 });

  // …and a threshold that is not a number must never become NaN.
  eq('threshold absent', g({ require: true }), { require: true, threshold: 80 });
  eq('threshold a string', g({ require: true, threshold: 'eighty' }), { require: true, threshold: 80 });
  eq('threshold null', g({ require: true, threshold: null }), { require: true, threshold: 80 });
  eq('threshold negative', g({ require: true, threshold: -5 }), { require: true, threshold: 80 });
  eq('threshold fractional', g({ require: true, threshold: 49.7 }), { require: true, threshold: 49 });

  // Zero is a real setting — "any day he opens લેવલ ૩ at all" — and is distinguishable from
  // absence, so it is honoured rather than defaulted.
  eq('threshold zero is kept', g({ require: true, threshold: 0 }), { require: true, threshold: 0 });

  /*
    The three that would slip through a coercing check, and each is a real outage:

      Number(null) === 0, Number('') === 0, Number([]) === 0

    all of which are finite and >= 0, so `Number(x)` would resolve every one of them to a
    threshold of **zero** — a gate every યુવક passes on his first day. The resolver tests
    `typeof`, and these three are what that is for.
  */
  eq('threshold empty string', g({ require: true, threshold: '' }), { require: true, threshold: 80 });
  eq('threshold an array', g({ require: true, threshold: [] }), { require: true, threshold: 80 });

  // A numeric string is refused as well, so that this agrees with `level4_gate_setting()`'s
  // `jsonb_typeof(...) = 'number'`. Accepting it here would show ૭૫ in the panel while the
  // database gated at ૮૦.
  eq('a numeric string is not a number', g({ require: true, threshold: '75' }), { require: true, threshold: 80 });
}

group('validateLevel4Gate — what the સંચાલક is told instead of silently corrected');
{
  const ok = (gate) => validateLevel4Gate(gate).ok;

  eq('the ordinary case', ok({ require: true, threshold: 50 }), true);
  eq('zero', ok({ require: true, threshold: 0 }), true);
  // With the gate off the number is not asked about at all — it is kept, but it decides
  // nothing, so refusing a save over it would be refusing over a field that does not apply.
  eq('gate off, nonsense threshold', ok({ require: false, threshold: 'x' }), true);

  eq('missing', ok(null), false);
  eq('require not a boolean', ok({ require: 'yes', threshold: 50 }), false);
  eq('threshold a word', ok({ require: true, threshold: 'eighty' }), false);
  // Refused for the same reason the resolver refuses it — if validate accepted '75' the
  // save would succeed and the resolver would then replace it with ૮૦, having said "Saved".
  eq('threshold a numeric string', ok({ require: true, threshold: '75' }), false);
  eq('threshold null', ok({ require: true, threshold: null }), false);
  eq('threshold fractional', ok({ require: true, threshold: 49.7 }), false);
  eq('threshold negative', ok({ require: true, threshold: -1 }), false);

  // No upper bound, deliberately: a limit here would be a second total (§6 rule 1) and would
  // go stale the day a દ્રશ્ય is added to the collection.
  eq('an absurdly high threshold is allowed', ok({ require: true, threshold: 100000 }), true);
}

// ==================================================================== result

console.log(`\n  ${pass} passed, ${fails.length} failed\n`);
if (fails.length) {
  console.log(fails.map((f) => `  ✗ ${f}`).join('\n\n') + '\n');
  process.exit(1);
}
