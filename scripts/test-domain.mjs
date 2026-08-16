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
import {
  DEFAULT_DHUN_AUTOPLAY,
  DEFAULT_SLIDESHOW,
  DEFAULT_TICK_WORD,
  SLIDESHOW_MAX_SECONDS,
  SLIDESHOW_MIN_SECONDS,
  TICK_WORD_MAX,
  resolveDhunAutoplay,
  resolveLevel4Gate,
  resolveSlideshow,
  resolveTickWord,
  validateLevel4Gate,
  validateSlideshow,
  validateTickWord,
} from '../shared/domain/settings.js';
import { nextLevelAfter } from '../shared/domain/journey.js';
import {
  DEFAULT_DAILY_PROMPT,
  resolveDailyPrompt,
  validateDailyPrompt,
} from '../shared/domain/daily-prompt.js';
import {
  GEO_STATUS,
  activeOnly,
  canRetireCity,
  geoName,
  isGeoId,
  normaliseGeography,
  validateCity,
  validateZone,
  zonesOf,
} from '../shared/domain/geography.js';
import {
  ENTRY_ROUTE,
  ENTRY_STATE,
  guardRoute,
  resolveEntryRoute,
  resolveEntryState,
} from '../shared/domain/entry-route.js';
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
{
  /*
    A THIRD spelling of an already-ambiguous name.

    `Varni (1).png`, `Varni(1).png` and `Varni_(1).png` are three distinct strict keys that
    all reduce to the one loose key `varni(1)` — the ordinary residue of a folder that has
    been re-uploaded and renamed a few times. indexDriveFiles() marked the key ambiguous on
    the second file, then dereferenced that null on the third and threw `Cannot read
    properties of null (reading 'id')`.

    The cost was the whole feature, not one row: this runs while the folder is being indexed,
    before any row is planned, so the import screen died with a raw TypeError and no Gujarati
    sentence for a folder the સંચાલક could see was fine. The assertion is therefore first that
    it *returns at all*, and only then what it returns.
  */
  const drive = indexDriveFiles([
    { id: 'a', name: 'Varni (1).png' },
    { id: 'b', name: 'Varni(1).png' },
    { id: 'c', name: 'Varni_(1).png' },
  ]);
  eq('a third spelling of an ambiguous name does not throw', drive.count, 3);
  eq('…and the loose key stays ambiguous rather than resolving to the last file',
    matchDriveFile(drive, 'Varni  (1)').how, 'ambiguous');
  eq('…while each exact spelling still resolves to its own file',
    matchDriveFile(drive, 'Varni_(1)').file.id, 'c');

  // Six spellings, to prove the guard is not a one-deep patch.
  const many = indexDriveFiles(
    ['Varni (1).png', 'Varni(1).png', 'Varni_(1).png', 'Varni-(1).png', 'Varni  (1).png', 'varni.(1).jpg']
      .map((name, i) => ({ id: `f${i}`, name }))
  );
  eq('six spellings of one loose name do not throw either', many.count, 6);
  eq('…and none of them is guessed at', matchDriveFile(many, 'Varni   (1)').file, null);
}
{
  // The same file listed twice is not an ambiguity — it is one file. The loose branch has
  // always compared ids for this; the strict branch is what actually decides an exact name.
  const drive = indexDriveFiles([
    { id: 'same', name: 'Varni(7).png' },
    { id: 'same', name: 'Varni(7).png' },
  ]);
  eq('one file listed twice still resolves to itself', matchDriveFile(drive, 'Varni(7)').file?.id, 'same');
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

/*
  `resolveTickWord()` / `validateTickWord()` — the word a ticked લેવલ ૪ row carries.

  Two things are being protected here, and neither is cosmetic.

  The first is that the word reaches the row as a **CSS string**, set once on the list as a
  custom property. Whitespace therefore has to be collapsed before it gets there: a newline
  inside a CSS string is not a line break, it is an escape sequence for the letter that
  follows it, so a pasted two-line value would render as 'ન' rather than wrapping. The
  resolver is the only place that can guarantee it, because it is the only thing both the
  panel and the app agree to go through.

  The second is that resolve and validate must not disagree. If validate accepted something
  the resolver then replaced, the panel would say "Saved" and show the સંચાલક his own word
  while every યુવક read a different one — the same fault the Level 4 gate pair exists to
  prevent, one screen along.
*/
group('resolveTickWord — a settings row that could say anything');
{
  const w = (stored) => resolveTickWord(stored);

  eq('absent', w(undefined), { show: true, text: DEFAULT_TICK_WORD.text });
  eq('not an object', w('સ્વામિનારાયણ'), { show: true, text: DEFAULT_TICK_WORD.text });
  eq('the ordinary case', w({ show: true, text: 'જય સ્વામિનારાયણ' }), { show: true, text: 'જય સ્વામિનારાયણ' });

  // Only an explicit `false` turns it off. A missing key means "never configured", and the
  // feature was asked for, so absence resolves to on.
  eq('show absent', w({ text: 'નીલકંઠ' }), { show: true, text: 'નીલકંઠ' });
  eq('show false', w({ show: false, text: 'નીલકંઠ' }).show, false);
  eq('show a string is not false', w({ show: 'no', text: 'નીલકંઠ' }).show, true);

  // The word falls back to the default rather than to nothing: an empty band is what
  // `show: false` means, and the two must stay distinguishable.
  eq('text empty', w({ show: true, text: '   ' }).text, DEFAULT_TICK_WORD.text);
  eq('text not a string', w({ show: true, text: 42 }).text, DEFAULT_TICK_WORD.text);
  eq('text too long', w({ show: true, text: 'ક'.repeat(TICK_WORD_MAX + 1) }).text, DEFAULT_TICK_WORD.text);
  eq('text exactly at the cap', w({ show: true, text: 'ક'.repeat(TICK_WORD_MAX) }).text, 'ક'.repeat(TICK_WORD_MAX));

  // The CSS-string reason above. A newline must never survive this function.
  eq('a newline is collapsed', w({ show: true, text: 'જય\nસ્વામિનારાયણ' }).text, 'જય સ્વામિનારાયણ');
  eq('tabs and runs of spaces collapse', w({ show: true, text: ' જય\t\t સ્વામિ ' }).text, 'જય સ્વામિ');
}

group('validateTickWord — refuses exactly what the resolver would have replaced');
{
  const ok = (word) => validateTickWord(word).ok;

  eq('the ordinary case', ok({ show: true, text: 'સ્વામિનારાયણ' }), true);
  // Off means the word decides nothing, so refusing a save over it would be refusing over a
  // field that does not apply — same as the gate's threshold when `require` is false.
  eq('off, with an empty word', ok({ show: false, text: '' }), true);

  eq('missing', ok(null), false);
  eq('show not a boolean', ok({ show: 'yes', text: 'સ્વામિનારાયણ' }), false);
  eq('on, no word', ok({ show: true, text: '   ' }), false);
  eq('on, word not a string', ok({ show: true, text: 7 }), false);
  eq('on, over the cap', ok({ show: true, text: 'ક'.repeat(TICK_WORD_MAX + 1) }), false);
  eq('at the cap', ok({ show: true, text: 'ક'.repeat(TICK_WORD_MAX) }), true);

  // The pair must agree: anything validate() lets through has to survive resolve() unchanged,
  // or the panel and the row would be showing two different words with nothing to say so.
  for (const text of ['સ્વામિનારાયણ', 'જય સ્વામિનારાયણ', 'નીલકંઠ', 'ક'.repeat(TICK_WORD_MAX)]) {
    const word = { show: true, text };
    eq(`accepted, and kept: ${text}`, resolveTickWord(word).text, validateTickWord(word).text);
  }
}

// ==================================================================== the slideshow

/*
  `resolveSlideshow()` — how long લેવલ ૨'s fullscreen આપોઆપ holds each દ્રશ્ય.

  Same shape of problem as the લેવલ ૪ gate above and the same reason for testing every branch
  rather than the happy path: this is `value -> 'slideshow'` out of a jsonb column, and the
  number it produces is handed straight to `setTimeout`. Two failures matter and neither
  announces itself —

    * a value that resolves to 0 or NaN makes `setTimeout` fire immediately, so ૧૦૯ દ્રશ્યો
      flicker past as fast as they decode. That is not a fast slideshow, it is a broken one,
      and it is what a coercing check would produce from `null`, `''` or `[]`.
    * a value that resolves to something enormous looks exactly like an આપોઆપ that has hung.

  `settings_slideshow_seconds()` in 0018 mirrors these branch for branch, and the trigger in
  the same migration refuses on write what this corrects on read. If the two disagree, this
  one is wrong.
*/
group('resolveSlideshow — a settings row that could say anything');
{
  const s = (stored) => resolveSlideshow(stored);
  const D = DEFAULT_SLIDESHOW.seconds;

  eq('nothing configured', s(undefined), { seconds: D });
  eq('null', s(null), { seconds: D });
  eq('not an object', s(8), { seconds: D });
  eq('the ordinary case', s({ seconds: 10 }), { seconds: 10 });

  // Both bounds are inclusive and both are real settings, not edge cases to be nudged off.
  eq('the floor', s({ seconds: SLIDESHOW_MIN_SECONDS }), { seconds: 1 });
  eq('the ceiling', s({ seconds: SLIDESHOW_MAX_SECONDS }), { seconds: 60 });

  /*
    Every one of these would be 0 under `Number()`, and 0 is the flicker. They must reach the
    default instead — which is what testing with `typeof` buys, and the only reason the
    resolver is written the way it is.
  */
  eq('seconds absent', s({}), { seconds: D });
  eq('seconds null', s({ seconds: null }), { seconds: D });
  eq('seconds an empty string', s({ seconds: '' }), { seconds: D });
  eq('seconds a numeric string', s({ seconds: '10' }), { seconds: D });
  eq('seconds an array', s({ seconds: [] }), { seconds: D });
  eq('seconds a boolean', s({ seconds: true }), { seconds: D });

  // NaN survives Math.min and Math.max unchanged, so a clamp alone would let it through to
  // setTimeout — which fires immediately. Refused before either clamp sees it.
  eq('seconds NaN', s({ seconds: NaN }), { seconds: D });
  eq('seconds Infinity', s({ seconds: Infinity }), { seconds: D });
  eq('seconds -Infinity', s({ seconds: -Infinity }), { seconds: D });

  // Out of range is clamped, not defaulted: a સંચાલક who wrote 0 was asking for "as fast as
  // possible", and the fastest this is allowed to go is the honest answer to that.
  eq('zero clamps up to the floor', s({ seconds: 0 }), { seconds: 1 });
  eq('negative clamps up to the floor', s({ seconds: -30 }), { seconds: 1 });
  eq('above the ceiling clamps down', s({ seconds: 600 }), { seconds: 60 });

  // Rounded, not floored — 1.6s is nearer 2 than 1, and nothing here is safer either way.
  eq('fractional rounds', s({ seconds: 8.4 }), { seconds: 8 });
  eq('fractional rounds up', s({ seconds: 8.6 }), { seconds: 9 });
  // …and rounding must not be able to land outside the bound it was clamped into.
  eq('0.4 rounds to 0 and is then clamped to the floor', s({ seconds: 0.4 }), { seconds: 1 });
  eq('60.4 rounds to 60', s({ seconds: 60.4 }), { seconds: 60 });

  /*
    The invariant that keeps the panel's field and the યુવક's dwell the same number: anything
    validateSlideshow() accepts, resolveSlideshow() must return unchanged. If these ever
    diverge, a સંચાલક is told "Saved" and the slideshow runs at a speed he did not choose.
  */
  let agree = true;
  for (let n = SLIDESHOW_MIN_SECONDS; n <= SLIDESHOW_MAX_SECONDS; n++) {
    if (!validateSlideshow({ seconds: n }).ok) agree = false;
    if (resolveSlideshow({ seconds: n }).seconds !== n) agree = false;
  }
  eq('every accepted value survives the resolver untouched', agree, true);
}

group('validateSlideshow — refusing what the resolver would quietly correct');
{
  const v = (x) => validateSlideshow(x).ok;

  eq('the ordinary case', v({ seconds: 8 }), true);
  eq('the floor', v({ seconds: 1 }), true);
  eq('the ceiling', v({ seconds: 60 }), true);

  eq('missing', v(null), false);
  eq('not an object', v(8), false);
  eq('seconds absent', v({}), false);
  // Refused rather than coerced, matching the resolver. A validator that accepted '8' while
  // the resolver replaced it with the default is how a saved value silently becomes another.
  eq('a numeric string', v({ seconds: '8' }), false);
  eq('NaN', v({ seconds: NaN }), false);
  eq('Infinity', v({ seconds: Infinity }), false);
  eq('fractional', v({ seconds: 8.5 }), false);

  // The bounds the brief names, refused on the wrong side of each.
  eq('zero', v({ seconds: 0 }), false);
  eq('negative', v({ seconds: -1 }), false);
  eq('just over the ceiling', v({ seconds: 61 }), false);
  eq('far over the ceiling', v({ seconds: 600 }), false);

  // The message names the bound rather than saying only "invalid" — it is what the સંચાલક
  // reads at the moment he is wrong about it.
  const msg = validateSlideshow({ seconds: 90 }).gu;
  eq('the refusal names both ends', msg.includes('1') && msg.includes('60'), true);
}

// ==================================================================== dhun autoplay

/*
  `resolveDhunAutoplay()` — whether the ધૂન starts by itself when a યુવક signs in.

  One boolean, and a section of its own, because the direction it falls in when it is *absent*
  is the whole of it. Every settings row in the database predates this key, so "absent" is not
  an edge case here — it is the state of every live project on the day this ships. Resolve it
  the wrong way and the deploy silently switches the music off for all 2,000 of them, with
  nothing on any screen able to say why.

  The failure would also be invisible in the other direction. `Boolean(a.on)` reads absence as
  off; `a.on !== false` reads only a stored, literal `false` as off. Both are one expression,
  both look right, and only one of them keeps §8's "ધીમેથી શરૂ થાય" true for a project that
  has never opened the field.
*/
group('resolveDhunAutoplay — a settings row that could say anything');
{
  const a = (stored) => resolveDhunAutoplay(stored).on;

  // The branch that matters most: nothing configured is the shipped behaviour, not silence.
  eq('nothing configured', a(undefined), true);
  eq('null', a(null), true);
  eq('not an object', a(true), true);
  eq('not an object — a string', a('off'), true);
  eq('the key absent from a row that exists', a({}), true);
  eq('the default agrees with the resolver', DEFAULT_DHUN_AUTOPLAY.on, a(undefined));

  // Both deliberate answers, round-tripped.
  eq('switched on', a({ on: true }), true);
  eq('switched off', a({ on: false }), false);

  /*
    Only a literal `false` switches it off. Everything below is a way of *failing* to say
    anything — and each would read as "off" under a coercing check, which is the same
    all-projects-go-quiet failure as absence.
  */
  eq('on is null', a({ on: null }), true);
  eq('on is 0', a({ on: 0 }), true);
  eq('on is an empty string', a({ on: '' }), true);
  eq('on is the string "false"', a({ on: 'false' }), true);
  eq('on is undefined', a({ on: undefined }), true);

  // The switch is about who presses play, not about which tracks exist — so it cannot depend
  // on the dhun list sitting in the same row, and a row carrying both resolves to the same
  // answer as one carrying neither.
  eq('unaffected by the rest of the row', a({ on: false, dhun: [{ id: 'x' }], appName: 'x' }), false);
}

// ==================================================================== the way onward

/*
  `nextLevelAfter()` — the door at the end of a level.

  It decides what લેવલ ૪'s completion panel offers, and the two ways it can be wrong are both
  quiet. Offering a level with no screen sends a યુવક to a URL that redirects him home one
  tap later — the app taking back what it just promised. Offering nothing when a level *is*
  configured strands him at the end of the સાધના with no way on.

  The order is the સંચાલક's, not levelId + 1, because he may reorder the levels (§36).
*/
group('nextLevelAfter — the સંચાલક orders the levels, the code decides what exists');
{
  const L = (levelId, order, enabled = true) => ({
    levelId,
    order,
    enabled,
    name: `L${levelId}`,
  });
  const FOUR = [L(1, 1), L(2, 2), L(3, 3), L(4, 4)];
  const to = (r) => (r ? r.to : null);

  eq('after લેવલ ૧ comes લેવલ ૨', to(nextLevelAfter(FOUR, 1)), '/darshan');
  eq('after લેવલ ૩ comes લેવલ ૪', to(nextLevelAfter(FOUR, 3)), '/level/4');

  // The answer that matters most, because it is the one on screen today: લેવલ ૪ is the last
  // level with a page, so the completion panel must render an ending and not a door.
  eq('after લેવલ ૪ — nothing', nextLevelAfter(FOUR, 4), null);

  // A level the સંચાલક turned off is skipped rather than offered and then refused.
  eq(
    'a disabled level is stepped over',
    to(nextLevelAfter([L(1, 1), L(2, 2, false), L(3, 3)], 1)),
    '/level/3'
  );

  // Reordered: લેવલ ૩ placed before લેવલ ૨. "Next" follows the order he set, not the number.
  eq(
    'the order is his, not the levelId',
    to(nextLevelAfter([L(1, 1), L(3, 2), L(2, 3), L(4, 4)], 1)),
    '/level/3'
  );

  // A fifth level enabled in settings has no screen, so it is not offered — §37, and the
  // reason this function checks LEVEL_ROUTE rather than trusting the list.
  eq(
    'a configured level with no page is not a destination',
    nextLevelAfter([...FOUR, L(5, 5)], 4),
    null
  );

  eq('an unknown level', nextLevelAfter(FOUR, 9), null);
  eq('no list at all', nextLevelAfter(null, 1), null);
}

/*
  The entry-route decision (§10) — where a યુવક belongs, and what routing may never do.

  This is the one piece of logic in the app that every single visit passes through, and
  every way it can be wrong is a way of losing somebody: sending a returning યુવક to
  નોંધણી, holding a signed-in one on લોગિન, marching a યુવક with three years of સાધના back
  to the વિડિયો because one profile read timed out, or answering two different things in a
  row and producing a redirect loop. None of those throw. They are asserted here.
*/
group('resolveEntryState / resolveEntryRoute / guardRoute — §10');
{
  const NOBODY = {};
  const NEW = { user: { id: 'u1' }, profile: { id: 'u1' } };
  const GATED = { user: { id: 'u1' }, profile: { id: 'u1', gate_passed_at: '2026-01-04T00:00:00Z' } };
  const DONE = {
    user: { id: 'u1' },
    profile: { id: 'u1', gate_passed_at: '2026-01-04T00:00:00Z', level4_unlocked: true },
  };

  // ---- the four states of §10, and each one has exactly one meaning ----------
  eq('no session is UNAUTHENTICATED', resolveEntryState(NOBODY), ENTRY_STATE.UNAUTHENTICATED);
  eq('no gate stamp is NEW_USER', resolveEntryState(NEW), ENTRY_STATE.NEW_USER);
  eq('gate passed is IN_PROGRESS', resolveEntryState(GATED), ENTRY_STATE.IN_PROGRESS);
  eq('લેવલ ૪ open is COMPLETED', resolveEntryState(DONE), ENTRY_STATE.COMPLETED);
  eq('nothing at all is UNAUTHENTICATED', resolveEntryState(), ENTRY_STATE.UNAUTHENTICATED);

  /*
    The distinction the whole of §23 rests on.

    A signed-in યુવક with no profile row means one of two opposite things, and `profile ==
    null` cannot tell them apart. Genuinely absent → he is mid-registration and belongs at
    લેવલ ૧. Read FAILED → he may have years behind him, and answering "new user" would walk
    him back to the વિડિયો he watched in 2023. That is progress reset by routing, which is
    the one thing this module is forbidden to do.
  */
  eq(
    'a missing profile row is a new યુવક',
    resolveEntryState({ user: { id: 'u1' }, profile: null }),
    ENTRY_STATE.NEW_USER
  );
  eq(
    'a FAILED profile read is not a new યુવક',
    resolveEntryState({ user: { id: 'u1' }, profile: null, profileError: true }),
    ENTRY_STATE.IN_PROGRESS
  );

  // ---- §4 — the two doors ---------------------------------------------------
  eq('a first visitor is shown નોંધણી', resolveEntryRoute(NOBODY), ENTRY_ROUTE.REGISTER);
  eq(
    'somebody who has been here before is shown લોગિન',
    resolveEntryRoute({ ...NOBODY, returning: true }),
    ENTRY_ROUTE.LOGIN
  );

  // §5 — REGISTER → AUTO LOGIN → મુખપૃષ્ઠ. This used to assert લેવલ ૧: a new યુવક was put
  // on the વિડિયો and held there. He now lands on the મુખપૃષ્ઠ and chooses for himself.
  eq('a new યુવક lands on the મુખપૃષ્ઠ', resolveEntryRoute(NEW), ENTRY_ROUTE.HOME);

  /*
    The resume of §7/§25 is gone: signing in lands on the મુખપૃષ્ઠ, whoever he is.

    This block used to assert the opposite — that a returning યુવક was put back at the last
    front door recorded on the device, with the મુખપૃષ્ઠ only as the fallback. Every
    signed-in state now gives the same answer, so that is what is asserted, including for a
    `lastRoute` that is still passed in: a caller that has not been updated cannot resurrect
    the old behaviour by accident.
  */
  eq('a climber lands on the મુખપૃષ્ઠ', resolveEntryRoute(GATED), ENTRY_ROUTE.HOME);
  eq('a finisher lands on the મુખપૃષ્ઠ', resolveEntryRoute(DONE), ENTRY_ROUTE.HOME);
  for (const lastRoute of ['/level/4', '/level/3', '/darshan', '/welcome', '/nonsense', null]) {
    eq(
      `a recorded '${lastRoute}' no longer changes the answer`,
      resolveEntryRoute({ ...GATED, lastRoute }),
      ENTRY_ROUTE.HOME
    );
  }
  eq(
    'and a new યુવક is no exception',
    resolveEntryRoute({ ...NEW, lastRoute: '/level/4' }),
    ENTRY_ROUTE.HOME
  );

  // ---- §11 — knowing a URL has never been permission ------------------------
  eq('the root, with no session, opens નોંધણી', guardRoute({ path: '/', ...NOBODY }).to, ENTRY_ROUTE.REGISTER);
  for (const path of ['/welcome', '/darshan', '/level/3', '/level/4', '/level/4/a1/revision']) {
    eq(`${path} is refused without a session`, guardRoute({ path, ...NOBODY }).allow, false);
    eq(`${path} sends him to લોગિન`, guardRoute({ path, ...NOBODY }).to, ENTRY_ROUTE.LOGIN);
  }

  /* ---- the installed app opens લોગિન, never નોંધણી -------------------------

     The manifest's `start_url` is '/', so every launch of the app from the home screen
     asks this function about the root with no session in hand — which is the same question
     a brand-new visitor's first click asks. The two are only distinguishable by `installed`,
     and getting it wrong has a direction: a યુવક who put the app on his phone did so
     BECAUSE he has an account, and he was being handed a registration form every morning.

     Asserted for the root specifically, because the root is the only path whose answer this
     changes — everything else was already લોગિન — and asserted in both directions so that a
     future edit cannot make નોંધણી unreachable for the browser visitor who needs it. */
  eq(
    'the installed app, with no session, opens લોગિન',
    guardRoute({ path: '/', ...NOBODY, installed: true }).to,
    ENTRY_ROUTE.LOGIN
  );
  eq(
    'the same launch in a browser still opens નોંધણી',
    guardRoute({ path: '/', ...NOBODY, installed: false }).to,
    ENTRY_ROUTE.REGISTER
  );
  eq(
    'and an installed app is a returning visitor to resolveEntryRoute() too',
    resolveEntryRoute({ ...NOBODY, installed: true }),
    ENTRY_ROUTE.LOGIN
  );
  for (const path of ['/welcome', '/darshan', '/level/3', '/level/4']) {
    eq(
      `${path} is unaffected by installed — already લોગિન`,
      guardRoute({ path, ...NOBODY, installed: true }).to,
      ENTRY_ROUTE.LOGIN
    );
  }
  // It is a fact about the window, not about the યુવક: nobody who IS signed in may be
  // redirected anywhere by it. This is the check that keeps `installed` from becoming a
  // second opinion about who somebody is.
  for (const who of [NEW, GATED, DONE]) {
    for (const path of ['/', '/welcome', '/level/4']) {
      eq(
        `a signed-in યુવક reaches ${path} whether installed or not`,
        guardRoute({ path, ...who, installed: true }).allow,
        guardRoute({ path, ...who, installed: false }).allow
      );
    }
  }

  /* ---- the પ્રવેશદ્વાર is no longer a wall --------------------------------
     This block used to assert the opposite — that a યુવક without a gate stamp was
     refused /level/4 and redirected to લેવલ ૧. Routing no longer holds him anywhere:
     he lands on the મુખપૃષ્ઠ and goes where he likes. What still stops him reaching
     લેવલ ૪'s કસોટી is the level's own gate and `level4_submit`'s server-side re-check
     (§37) — never this function, which has never granted anything. */
  eq('a યુવક who has not passed the ગેટ is not redirected',
    guardRoute({ path: '/level/4', ...NEW }).allow, true);
  eq('…and લેવલ ૧ is still his to see',
    guardRoute({ path: '/welcome', ...NEW }).allow, true);
  eq('…and so is the મુખપૃષ્ઠ, which is where he now starts',
    guardRoute({ path: ENTRY_ROUTE.HOME, ...NEW }).allow, true);

  // ---- §12 — a refresh must land where it started ---------------------------
  for (const path of ['/welcome', '/darshan', '/level/3', '/level/4', '/level/4/a1']) {
    eq(`a refresh on ${path} stays there`, guardRoute({ path, ...GATED }).allow, true);
  }
  eq(
    'a refresh survives a failed profile read',
    guardRoute({ path: '/level/4', user: { id: 'u1' }, profile: null, profileError: true }).allow,
    true
  );

  /*
    §16 — no redirect may need a second redirect.

    Every destination this module produces must be one the same યુવક is allowed, or the
    guard fires again on arrival and the two answers ping-pong. Asserted rather than
    reasoned about, across every combination of state and path the app has.
  */
  const PATHS = ['/', '/welcome', '/darshan', '/level/3', '/level/4', '/level/4/a1'];
  const WHO = [NOBODY, NEW, GATED, DONE, { user: { id: 'u1' }, profile: null, profileError: true }];
  let settles = true;
  for (const who of WHO) {
    for (const path of PATHS) {
      const first = guardRoute({ path, ...who });
      if (first.allow) continue;
      // The destination of a redirect must itself be allowed — unless it is one of the two
      // public pages, which this module does not guard (PublicOnly does, and it sends the
      // yuvak to resolveEntryRoute's answer, checked immediately below).
      if (first.to === ENTRY_ROUTE.LOGIN || first.to === ENTRY_ROUTE.REGISTER) continue;
      if (!guardRoute({ path: first.to, ...who }).allow) settles = false;
    }
  }
  eq('every redirect lands somewhere that does not redirect again', settles, true);

  let publicSettles = true;
  for (const who of [NEW, GATED, DONE]) {
    for (const lastRoute of [null, '/darshan', '/level/4', '/level/4/a1']) {
      const to = resolveEntryRoute({ ...who, lastRoute });
      if (!guardRoute({ path: to, ...who }).allow) publicSettles = false;
    }
  }
  eq('a signed-in યુવક leaving લોગિન/નોંધણી lands somewhere he is allowed', publicSettles, true);

  // ---- §23 — routing reads, and only reads ---------------------------------
  const frozen = Object.freeze({
    id: 'u1',
    gate_passed_at: '2026-01-04T00:00:00Z',
    level4_unlocked: true,
  });
  let readOnly = true;
  try {
    resolveEntryRoute({ user: Object.freeze({ id: 'u1' }), profile: frozen, lastRoute: '/level/3' });
    guardRoute({ path: '/level/4', user: Object.freeze({ id: 'u1' }), profile: frozen });
  } catch {
    readOnly = false;
  }
  eq('no progress is touched by deciding a route', readOnly, true);
}

// ====================================================================
/*
  `resolveDailyPrompt()` / `validateDailyPrompt()` — whether ક્રમાંક asks about today.

  A small block with one sharp edge: the stored value is jsonb, so the string 'false' is truthy
  in JavaScript, and an ABSENT key has to mean the default rather than "off". Three different
  facts — missing, malformed, and genuinely no — collapse into one under a truthiness test, and
  the collapse is silent in the direction that annoys two thousand people: a sheet that keeps
  appearing on a project that switched it off.
*/
group('resolveDailyPrompt / validateDailyPrompt — settings[levels].dailyPrompt');
{
  const r = resolveDailyPrompt;

  // ---- the default, from every shape of nothing -----------------------------
  for (const nothing of [undefined, null, {}, [], 'dailyPrompt', 42, true]) {
    eq(`${JSON.stringify(nothing)} resolves to the default`, r(nothing), {
      enabled: true,
      autoOpen: true,
    });
  }
  eq('and the default is on, unlike the board beside it', DEFAULT_DAILY_PROMPT.enabled, true);

  // ---- off means off -------------------------------------------------------
  eq('enabled:false switches it off', r({ enabled: false }), { enabled: false, autoOpen: false });
  eq(
    'and autoOpen cannot survive it being off',
    r({ enabled: false, autoOpen: true }),
    { enabled: false, autoOpen: false }
  );

  // ---- autoOpen alone ------------------------------------------------------
  eq('autoOpen:false keeps the button and drops the sheet', r({ autoOpen: false }), {
    enabled: true,
    autoOpen: false,
  });

  /*
    The jsonb trap, both fields. `'false'` is a string a checkbox may have been serialised as,
    and `0` is what a tool that stored a flag as a number writes. Neither is the boolean false,
    so neither may switch anything off — the panel and the trigger refuse them, and a row that
    already holds one must read as the default rather than as a decision nobody made.
  */
  for (const truthy of ['false', 'no', 0, '', null, undefined]) {
    const want = truthy === false;
    eq(
      `enabled: ${JSON.stringify(truthy)} is not the boolean false`,
      r({ enabled: truthy }).enabled,
      !want
    );
  }

  // ---- the validator refuses what the resolver would correct ---------------
  eq('a missing block is refused', validateDailyPrompt(undefined).ok, false);
  eq('a non-boolean enabled is refused', validateDailyPrompt({ enabled: 'yes', autoOpen: true }).ok, false);
  eq('a non-boolean autoOpen is refused', validateDailyPrompt({ enabled: true, autoOpen: 1 }).ok, false);
  eq(
    'off-but-opening-itself is refused rather than narrowed',
    validateDailyPrompt({ enabled: false, autoOpen: true }).ok,
    false
  );
  eq(
    'both off is a perfectly good answer',
    validateDailyPrompt({ enabled: false, autoOpen: false }).ok,
    true
  );
  eq('and so is both on', validateDailyPrompt({ enabled: true, autoOpen: true }).ok, true);

  /*
    The round trip, which is what actually stops the panel and the app disagreeing: anything
    validateDailyPrompt() accepts, resolveDailyPrompt() must return unchanged. The same property
    the slideshow block above asserts, and it is the one that catches a future edit tightening
    one of the two without the other.
  */
  let stable = true;
  for (const enabled of [true, false]) {
    for (const autoOpen of [true, false]) {
      const v = validateDailyPrompt({ enabled, autoOpen });
      if (!v.ok) continue;
      const back = r(v.dailyPrompt);
      if (back.enabled !== v.dailyPrompt.enabled || back.autoOpen !== v.dailyPrompt.autoOpen) {
        stable = false;
      }
    }
  }
  eq('everything the validator accepts survives the resolver unchanged', stable, true);

  // Frozen input, because a resolver that mutated the settings row would be editing the
  // સંચાલક's stored document from a render.
  let readOnlyPrompt = true;
  try {
    r(Object.freeze({ enabled: false, autoOpen: false }));
    validateDailyPrompt(Object.freeze({ enabled: true, autoOpen: true }));
  } catch {
    readOnlyPrompt = false;
  }
  eq('neither function writes to what it was given', readOnlyPrompt, true);
}

// ====================================================================
/*
  `shared/domain/geography.js` — cities and zones, once they are rows rather than an array.

  What this block is really protecting is the release problem the module exists to end: the
  three zone ids used to live in a JS array AND in a CHECK constraint, so adding રાંધેર meant a
  migration and a bundle deployed together — and if they were not, a યુવક registering in the new
  zone was accepted by the form and refused by the database.

  Every assertion here is about what is true of ANY place. If a place name ever appears in this
  group, or in the module it tests, the problem is back.
*/
group('geography — cities and zones as data, not as an array');
{
  // ---- ids: what can go in a foreign key, a query string and a CSV column ----
  for (const good of ['surat', 'navsari-rural', 'z9', 'a1-b2-c3']) {
    eq(`"${good}" is a usable id`, isGeoId(good), true);
  }
  for (const bad of [
    'S',                    // one character — the RE needs at least two
    'Surat',                // capitals do not survive a URL round trip everywhere
    'સુરત',                  // Gujarati belongs in `name`, which is what screens print
    'surat city',           // a space breaks a query string
    '9surat',               // must start with a letter, so it never reads as a number
    '-surat',
    'surat_city',           // underscore is not in the alphabet the panel groups on
    '',
    null,
    undefined,
    42,
  ]) {
    eq(`${JSON.stringify(bad)} is refused as an id`, isGeoId(bad), false);
  }

  // ---- reading what is stored ---------------------------------------------
  const geo = normaliseGeography({
    cities: [
      { id: 'surat', name: 'સુરત', status: 'ACTIVE', sort_order: 1 },
      { id: 'navsari', name: 'નવસારી', status: 'RETIRED', sort_order: 2 },
      { id: 'BROKEN', name: 'x' },
      null,
    ],
    zones: [
      { id: 'varachha', city_id: 'surat', name: 'વરાછા', sort_order: 2 },
      { id: 'randher', city_id: 'surat', name: 'રાંધેર', sort_order: 1 },
      { id: 'orphan', name: 'no city' },
    ],
  });

  eq('a city with an unusable id is dropped', geo.cities.map((c) => c.id), ['surat', 'navsari']);
  eq('a zone with no city is dropped', geo.zones.map((z) => z.id), ['randher', 'varachha']);
  eq('and the સંચાલક’s order is what sorts them', geo.zones[0].id, 'randher');

  /*
    A name that did not arrive falls back to the id, and the row SURVIVES. Dropping it would be
    the worse failure by far: a યુવક is registered in that place either way, so a list that
    quietly loses it is a list nobody can reconcile against the database.
  */
  const nameless = normaliseGeography({ cities: [{ id: 'surat' }], zones: [] });
  eq('a city with no name prints its id rather than vanishing', nameless.cities[0].name, 'surat');

  // An absent status is ACTIVE, because every row written before the column existed is one.
  eq('an absent status reads as ACTIVE', geo.zones[0].status, GEO_STATUS.ACTIVE);
  eq('and a stored one is kept', geo.cities[1].status, GEO_STATUS.RETIRED);

  // ---- what a screen asks of the list -------------------------------------
  eq('zonesOf() groups by city', zonesOf(geo.zones, 'surat').length, 2);
  eq('and answers nothing for a city with none', zonesOf(geo.zones, 'navsari'), []);
  eq('activeOnly() is what નોંધણી may offer', activeOnly(geo.cities).map((c) => c.id), ['surat']);
  eq('geoName() prints the name', geoName(geo.zones, 'varachha'), 'વરાછા');
  eq('…the id when the place is unknown', geoName(geo.zones, 'nowhere'), 'nowhere');
  eq('…and a dash when there is no place at all', geoName(geo.zones, ''), '-');

  // ---- the validator refuses what the resolver would paper over ------------
  eq('a city needs an id', validateCity({ name: 'સુરત', status: 'ACTIVE' }).ok, false);
  eq('a city needs a name', validateCity({ id: 'surat', status: 'ACTIVE' }).ok, false);
  eq('a city needs a status', validateCity({ id: 'surat', name: 'સુરત' }).ok, false);
  eq(
    'a name that only the resolver would accept is refused here',
    validateCity({ id: 'surat', name: '   ', status: 'ACTIVE' }).ok,
    false
  );
  eq('a good city is accepted', validateCity({ id: 'surat', name: 'સુરત', status: 'ACTIVE' }).ok, true);

  const cities = [{ id: 'surat' }];
  eq('a zone needs a city', validateZone({ id: 'varachha', name: 'વરાછા', status: 'ACTIVE' }, cities).ok, false);
  eq(
    'and the city has to exist, named in words rather than as a constraint',
    validateZone({ id: 'varachha', cityId: 'nowhere', name: 'વરાછા', status: 'ACTIVE' }, cities).gu,
    'There is no city called "nowhere".'
  );
  eq(
    'a good zone is accepted',
    validateZone({ id: 'varachha', cityId: 'surat', name: 'વરાછા', status: 'ACTIVE' }, cities).ok,
    true
  );

  /*
    The round trip. Anything the validator accepts, the resolver must return unchanged — the
    property that stops the panel and the app disagreeing about a row that was just saved.
  */
  const okCity = validateCity({ id: 'surat', name: 'સુરત', status: 'ACTIVE', sort: 3 });
  const backCity = normaliseGeography({ cities: [okCity.city], zones: [] }).cities[0];
  eq('a saved city survives the resolver unchanged', [backCity.id, backCity.name, backCity.status, backCity.sort],
    ['surat', 'સુરત', 'ACTIVE', 3]);

  // ---- retiring, which is the only kind of removal there is ---------------
  /*
    There is no delete anywhere in this module, deliberately: a zone id is written into every
    profile in it, into the records behind those profiles, into audit rows and into exports
    already printed. Deleting would orphan those or cascade into deleting યુવકો.
  */
  const openZones = [
    { id: 'varachha', cityId: 'surat', name: 'વરાછા', status: 'ACTIVE', sort: 0 },
    { id: 'randher', cityId: 'surat', name: 'રાંધેર', status: 'ACTIVE', sort: 0 },
  ];
  eq('a city with open zones cannot be retired', canRetireCity('surat', openZones).ok, false);
  eq(
    'and the refusal counts them rather than naming one',
    canRetireCity('surat', openZones).gu,
    "Retire this city's 2 open zones first."
  );
  eq(
    'one open zone is named, because he can act on a name',
    canRetireCity('surat', openZones.slice(0, 1)).gu,
    'Retire the zone "વરાછા" first - it is still open in this city.'
  );
  eq(
    'a city whose zones are all retired may be retired',
    canRetireCity('surat', openZones.map((z) => ({ ...z, status: 'RETIRED' }))).ok,
    true
  );
  eq('and so may a city with no zones at all', canRetireCity('navsari', openZones).ok, true);

  // Frozen input: a resolver that mutated its argument would be editing the સંચાલક's stored row
  // from inside a render.
  let geoReadOnly = true;
  try {
    normaliseGeography(Object.freeze({ cities: Object.freeze([]), zones: Object.freeze([]) }));
    validateCity(Object.freeze({ id: 'surat', name: 'સુરત', status: 'ACTIVE' }));
    validateZone(Object.freeze({ id: 'z', cityId: 'surat', name: 'ઝ', status: 'ACTIVE' }), cities);
  } catch {
    geoReadOnly = false;
  }
  eq('nothing here writes to what it was given', geoReadOnly, true);
}

// ==================================================================== result

console.log(`\n  ${pass} passed, ${fails.length} failed\n`);
if (fails.length) {
  console.log(fails.map((f) => `  ✗ ${f}`).join('\n\n') + '\n');
  process.exit(1);
}
