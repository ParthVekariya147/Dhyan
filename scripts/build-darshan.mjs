/**
 * Builds content/darshan.json — the entire દર્શન collection, in one step.
 *
 * A દ્રશ્ય is three things and nothing else:
 *
 *     { number, Drive link, વર્ણન }
 *
 * The number and the વર્ણન come from the સંચાલક's sheet. The link comes from his Drive
 * folder. This script puts the two together and writes the result. Nothing is downloaded,
 * nothing is re-encoded, and no image byte is committed to the repository — the યુવક's
 * browser fetches each image straight from Google's image CDN.
 *
 * That is a deliberate replacement for what used to be here. The old path ingested 549 MB
 * of masters, then re-encoded all 109 into six widths × three formats searching for an SSIM
 * floor at every step; the last full run reported ~13 hours remaining and was killed after
 * 12 images, which is exactly why the app has been showing 12 દ્રશ્યો. A pipeline that
 * cannot finish is not a slow pipeline, it is a broken one.
 *
 *   node scripts/build-darshan.mjs                        live sheet + the Settings folder
 *   node scripts/build-darshan.mjs --folder <id|url>      a different Drive folder
 *   node scripts/build-darshan.mjs --file data.xlsx       a local .xlsx / .csv / .tsv
 *   node scripts/build-darshan.mjs --sheet <id> --gid <gid>
 *   node scripts/build-darshan.mjs --dry-run              report, write nothing
 *
 * The ક્રમ→image binding is never a hardcoded `Varni (N).png` regex. scripts/lib/naming.mjs
 * resolves it, preferring what the ફોટો ફાઇલ column *declares* and only falling back to
 * inferring from the filename — so an arbitrarily named batch works by declaring itself.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadScenes } from './lib/spreadsheet.mjs';
import { resolveFiles, indexFromFilename } from './lib/naming.mjs';
// Straight from shared/, not a copy: the panel, the app and this script must agree on what
// a Drive link turns into, and the repo is `"type": "module"` so Node imports them as-is.
import {
  DEFAULT_DRIVE_FOLDER_ID,
  driveFolderListingUrl,
  driveImageUrl,
  parseDriveFolderLink,
} from '../shared/domain/drive.js';
import { darshanId } from '../shared/domain/darshan.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'content', 'darshan.json');

/**
 * Default source — workbook: Nilkanth_Varni_Dhyan_100_Scenes
 *                   tab:      gid 1288355861  — 109 rows, ક્રમ 1..109
 *
 * The tab that carries a ટૂંકું વાક્ય column and a differently worded વર્ણન for 44 scenes
 * (`Sheet1`, gid 2008841484) is deliberately NOT used. Do not switch tabs without asking —
 * a silent tab change is indistinguishable from a data change.
 */
const SHEET_ID = '1BF6P269rFTHCTZCE1KOFovgXhwjWCI1iYwTtY-3oUb0';
const GID = '1288355861';

/** Only files a browser could ever paint. A Drive folder also holds the odd PDF. */
const IMAGE_RE = /\.(png|jpe?g|webp|avif|gif|bmp)$/i;

/**
 * The listing's shape. `id="entry-<id>"` and `flip-entry-title">name<` are separated by a
 * variable amount of markup, hence the bounded lazy gap — bounded so that a malformed page
 * cannot pair one entry's id with the next entry's name.
 */
const ENTRY_RE = /id="entry-([-\w]{20,50})"[\s\S]{0,1500}?flip-entry-title">([^<]+)</g;

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Drive escapes `&` in filenames, and the સંચાલક's filenames are otherwise ASCII + digits. */
const unescapeHtml = (s) =>
  s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return XML_ENTITIES[body] ?? whole;
  });

// ------------------------------------------------------------------ CLI
const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? null : argv[i + 1];
};
const has = (name) => argv.includes(name);

if (has('--help') || has('-h')) {
  console.log(`
  npm run darshan                              live sheet + the default Drive folder
  npm run darshan -- --folder <id|url>         a different Drive folder
  npm run darshan -- --file <path>             local .xlsx / .csv / .tsv instead of the sheet
  npm run darshan -- --sheet <id> --gid <gid>
  npm run darshan -- --dry-run                 report, write nothing
`);
  process.exit(0);
}

const dryRun = has('--dry-run');

/**
 * Which folder. The flag wins, then DRIVE_FOLDER_ID from the environment (which is how a
 * CI run or a `.env` supplies it), then the shared default. Whatever it is, it is parsed
 * rather than trusted: the id is interpolated into a drive.google.com URL, so anything not
 * id-shaped is refused before that happens.
 */
const folderInput = flag('--folder') ?? process.env.DRIVE_FOLDER_ID ?? DEFAULT_DRIVE_FOLDER_ID;
const folder = parseDriveFolderLink(folderInput);
if (!folder.ok) throw new Error(`--folder: ${folder.gu}`);
const folderId = folder.id;

// ------------------------------------------------------------------ read the sheet
const sheetOpts = flag('--file')
  ? { file: flag('--file') }
  : { sheetId: flag('--sheet') ?? SHEET_ID, gid: flag('--gid') ?? GID };

const { rows, source } = await loadScenes(sheetOpts);
console.log(`sheet : ${source}  (${rows.length} rows)`);
if (!rows.length) throw new Error('the sheet has a header but no data rows');

// ------------------------------------------------------------------ list the Drive folder
//
// curl rather than fetch(): every other network call in this repo goes through it, it
// follows Google's redirects, and --fail turns an HTML error page into a non-zero exit
// instead of a silent parse of a login screen.
console.log(`drive : listing folder ${folderId} …`);
let html;
try {
  html = execFileSync(
    'curl.exe',
    ['-sSL', '--fail', '--max-time', '90', '-A', 'Mozilla/5.0', driveFolderListingUrl(folderId)],
    { maxBuffer: 1 << 28 }
  ).toString('utf8');
} catch {
  throw new Error(
    `could not list Drive folder ${folderId}. Open it in Drive → Share → General access → ` +
      '"Anyone with the link", then try again.'
  );
}

/** @type {Array<{ id: string, name: string }>} */
const files = [];
const seenIds = new Set();
for (const [, id, rawName] of html.matchAll(ENTRY_RE)) {
  const name = unescapeHtml(rawName).trim();
  if (!IMAGE_RE.test(name)) continue;
  // The listing repeats each entry in its grid and list views; the id is what makes them
  // the same file.
  if (seenIds.has(id)) continue;
  seenIds.add(id);
  files.push({ id, name });
}

if (!files.length) {
  throw new Error(
    'the folder listing came back empty — check that the folder is shared as ' +
      '"Anyone with the link" and that it still holds the images'
  );
}
console.log(`drive : ${files.length} image files`);

// ------------------------------------------------------------------ bind ક્રમ → file
const byName = new Map(files.map((f) => [f.name, f]));
const { mapping, problems, unclaimedFiles } = resolveFiles({ files: files.map((f) => f.name), rows });

// ------------------------------------------------------------------ validate
//
// A missing image is not fatal — that દ્રશ્ય simply ships inactive until the artwork
// arrives, and the panel names it as a gap. A duplicate ક્રમ is fatal: it means the sheet
// contradicts itself, and building on it would bind a વર્ણન to the wrong artwork.
const fatal = [];
const seenN = new Set();
for (const r of rows) {
  if (seenN.has(r.n)) fatal.push(`duplicate ક્રમ ${r.n}`);
  seenN.add(r.n);
}

// ------------------------------------------------------------------ build records
//
// The whole record. `url` is what the app renders, `driveId` is what produced it — kept so
// the panel can show the source link back to the સંચાલક and so a change of CDN width is a
// rebuild rather than a re-derivation from a URL nobody parsed.
const records = rows.map((r) => {
  const hit = mapping.get(r.n);
  const file = hit ? byName.get(hit.file) : null;
  return {
    id: darshanId(r.n),
    n: r.n,
    order: r.n,
    t: r.t,
    driveId: file?.id ?? '',
    url: file ? driveImageUrl(file.id) : '',
    // The enlarged view. A second URL rather than a second file: same id, wider encode,
    // fetched only for the one દ્રશ્ય a યુવક actually opens.
    fullUrl: file ? driveImageUrl(file.id, 2560) : '',
    // Kept for the panel's "which file in Drive is this?" line. Purely informational.
    file: hit?.file ?? '',
  };
});

const written = !dryRun && !fatal.length;
if (written) fs.writeFileSync(OUT, JSON.stringify(records, null, 2), 'utf8');

// ------------------------------------------------------------------ report
const withImage = records.filter((r) => r.url);
const withoutImage = records.filter((r) => !r.url).map((r) => r.n);
const withoutText = unclaimedFiles
  .map((f) => indexFromFilename(f))
  .filter(Boolean)
  .map((g) => g.n)
  .sort((a, b) => a - b);

const list = (a, cap = 30) =>
  a.length ? a.slice(0, cap).join(',') + (a.length > cap ? ` …+${a.length - cap}` : '') : 'none';

console.log(`\nrows in sheet        : ${rows.length}`);
console.log(`images in Drive      : ${files.length}`);
console.log(`ક્રમ range            : ${rows[0].n}..${rows.at(-1).n}`);
console.log(`વર્ણન + image         : ${withImage.length}  ← these are what a યુવક sees`);
console.log(`વર્ણન, no image       : ${list(withoutImage)}`);
console.log(`image, no વર્ણન       : ${list(withoutText)}`);

// How each binding was made. This is the line that tells the સંચાલક the convention has
// changed: a batch that used to read `inferred:parens` and now reads `inferred:trailing`
// is a naming change, and one reading `declared` is the sheet doing its job properly.
const viaCounts = new Map();
for (const { via } of mapping.values()) viaCounts.set(via, (viaCounts.get(via) ?? 0) + 1);
console.log(
  `binding via          : ${[...viaCounts].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ') || 'nothing bound'}`
);
if (unclaimedFiles.length) console.log(`  images bound to no row: ${unclaimedFiles.length}`);

if (problems.length) {
  console.log(`\n⚠ ${problems.length} binding issue(s):`);
  for (const p of problems.slice(0, 20)) console.log(`   - ${p}`);
  if (problems.length > 20) console.log(`   … and ${problems.length - 20} more`);
}

if (fatal.length) {
  console.log(`\n✖ ${fatal.length} fatal issue(s) — nothing written:`);
  for (const f of fatal.slice(0, 20)) console.log(`   - ${f}`);
  process.exit(1);
}

console.log(`\n${written ? `wrote ${path.relative(ROOT, OUT)}` : 'dry run — nothing written'}`);
