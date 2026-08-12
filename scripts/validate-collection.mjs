/**
 * Collection validation (§34, §35) — `npm run validate`.
 *
 * Proves that content/darshan.json is internally coherent AND that the links in it actually
 * serve images, rather than assuming either. Every check here is one that fails *silently*
 * in production: a duplicate ક્રમ, an id that disagrees with its number, a gap in the
 * sequence, a Drive file whose sharing was never set to "Anyone with the link".
 *
 * That last one is the reason this script still exists now that there is no encoder to
 * check. A link is not a file: it can be well-formed, present in the manifest, and still
 * answer with an HTML "you need permission" page — which a browser renders as a broken
 * frame and nothing in the app can explain. The only way to know is to ask, so `--fetch`
 * asks, for every દ્રશ્ય.
 *
 *   npm run validate              structure only, no network
 *   npm run validate -- --fetch   also fetch every image link and check what comes back
 *   npm run validate -- --fetch --limit 20    the first 20 only, for a quick look
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { isLearnable } from '../shared/domain/darshan.js';
import { isGoogleImageCdn } from '../shared/domain/drive.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA = path.join(ROOT, 'content', 'darshan.json');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const flag = (f) => {
  const i = argv.indexOf(f);
  return i === -1 ? null : argv[i + 1];
};

const problems = [];
const notes = [];
const fail = (m) => problems.push(m);

const scenes = JSON.parse(fs.readFileSync(DATA, 'utf8'));
console.log(`scenes in content/darshan.json : ${scenes.length}`);

// ---------------------------------------------------------------- identity
const ids = new Set();
const indexes = new Set();
for (const s of scenes) {
  if (!s.id) fail(`scene at index ${s.index ?? s.n} has no id`);
  if (ids.has(s.id)) fail(`duplicate item id: ${s.id}`);
  ids.add(s.id);

  const n = s.index ?? s.n;
  if (!Number.isInteger(n)) fail(`${s.id}: number is not an integer`);
  if (indexes.has(n)) fail(`duplicate number: ${n}`);
  indexes.add(n);

  // §34 — never assume the id encodes the number; assert it.
  const expected = `darshan-${String(n).padStart(3, '0')}`;
  if (s.id !== expected) fail(`${s.id}: id does not match its number (${n})`);
}

const sorted = [...indexes].sort((a, b) => a - b);
const gaps = [];
for (let n = sorted[0]; n < sorted.at(-1); n++) if (!indexes.has(n)) gaps.push(n);
if (gaps.length) fail(`missing numbers: ${gaps.join(', ')}`);

console.log(`number range                   : ${sorted[0]}..${sorted.at(-1)}`);
console.log(`duplicate ids / numbers        : none`);

// ---------------------------------------------------------------- the three fields
//
// A દ્રશ્ય is a link, a વર્ણન and a number. Each of the first two is checked separately,
// because "not shown to યુવકો" has two quite different causes and the સંચાલક acts on them
// in different places — one in Drive, one in the sheet.
const noLink = scenes.filter((s) => !s.url);
const noText = scenes.filter((s) => !s.t);
const learnable = scenes.filter(isLearnable);

console.log(`link + વર્ણન (what યુવકો see)   : ${learnable.length}`);
if (noLink.length) fail(`${noLink.length} scene(s) have no image link: ${noLink.map((s) => s.n).join(', ')}`);
if (noText.length) notes.push(`${noText.length} scene(s) have no વર્ણન yet: ${noText.map((s) => s.n).join(', ')}`);

// ---------------------------------------------------------------- the links themselves
for (const s of scenes) {
  if (!s.url) continue;

  // The one substitution that silently costs twelve times the bytes. `-rj` is what makes
  // Google re-encode the PNG master as JPEG; without it every card ships ~1.6 MB.
  if (isGoogleImageCdn(s.url) && !/-rj/.test(s.url)) {
    fail(`${s.id}: link asks the CDN for the master's own format — expect a huge PNG`);
  }

  // The download route is the quota-metered one, and it answers with an HTML page rather
  // than bytes once that quota is met. It must never reach a manifest.
  if (/uc\?export=download|drive\.google\.com\/file\//.test(s.url)) {
    fail(`${s.id}: link is a Drive download/viewer URL, which a browser cannot render`);
  }

  if (s.driveId && !s.url.includes(s.driveId)) {
    fail(`${s.id}: driveId does not appear in its own url — the two have drifted apart`);
  }
  if (s.fullUrl && s.driveId && !s.fullUrl.includes(s.driveId)) {
    fail(`${s.id}: fullUrl points at a different file than url — the lightbox would show the wrong image`);
  }
}

// ---------------------------------------------------------------- reachability
//
// Opt-in because it is 109 network requests. Worth running before a deploy and after any
// change to the Drive folder's sharing, which is the failure this cannot be talked out of:
// a folder set back to "Restricted" leaves every link in place and every image blank.
if (has('--fetch')) {
  const limit = Number(flag('--limit')) || scenes.length;
  const targets = scenes.filter((s) => s.url).slice(0, limit);
  console.log(`\nfetching ${targets.length} image link(s) …`);

  // In the OS temp directory, not the repository. curl needs somewhere to write the body
  // it downloads, and a scratch file in ROOT shows up as an untracked file — or worse, gets
  // committed — whenever a run is interrupted before the cleanup below.
  const tmp = path.join(os.tmpdir(), `dhyan-validate-${process.pid}.tmp`);
  let ok = 0;
  const bytes = [];

  for (const s of targets) {
    let out;
    try {
      out = execFileSync(
        'curl.exe',
        ['-sSL', '-o', tmp, '-w', '%{http_code} %{content_type} %{size_download}', '--max-time', '40', s.url],
        { maxBuffer: 1 << 24 }
      )
        .toString()
        .trim();
    } catch {
      fail(`${s.id}: could not be fetched at all`);
      continue;
    }
    const [code, type, size] = out.split(' ');
    // Drive answers an unshared file with 200 OK and an HTML page, so the status alone
    // proves nothing — the content type is what tells a picture from a refusal.
    if (code !== '200' || !/^image\//.test(type || '')) {
      fail(`${s.id}: replied ${code} ${type} — is the file still shared "Anyone with the link"?`);
      continue;
    }
    if (Number(size) < 5000) {
      fail(`${s.id}: replied with only ${size} bytes, which is not a real image`);
      continue;
    }
    ok++;
    bytes.push(Number(size));
  }

  fs.rmSync(tmp, { force: true });

  if (bytes.length) {
    bytes.sort((a, b) => a - b);
    const kb = (n) => `${Math.round(n / 1024)} KB`;
    console.log(`reachable                      : ${ok}/${targets.length}`);
    console.log(`bytes per image                : min ${kb(bytes[0])}, median ${kb(bytes[bytes.length >> 1])}, max ${kb(bytes.at(-1))}`);
    // Not a failure — a warning with a number attached. The feed is lazy, so this is what a
    // યુવક who scrolls the whole collection would spend, not what the first paint costs.
    const total = bytes.reduce((a, b) => a + b, 0);
    console.log(`whole collection, if scrolled  : ${(total / 1048576).toFixed(1)} MB`);
    if (bytes[bytes.length >> 1] > 400 * 1024) {
      notes.push('the median image is over 400 KB — check that the links carry the -rj-v1 suffix');
    }
  }
} else {
  notes.push('links were not fetched — run `npm run validate -- --fetch` to check they still serve images');
}

// ---------------------------------------------------------------- report
if (notes.length) {
  console.log('');
  for (const n of notes) console.log(`  note: ${n}`);
}

if (problems.length) {
  console.log(`\n✖ ${problems.length} problem(s):`);
  for (const p of problems.slice(0, 30)) console.log(`   - ${p}`);
  if (problems.length > 30) console.log(`   … and ${problems.length - 30} more`);
  process.exit(1);
}

console.log('\n✓ the collection is coherent');
