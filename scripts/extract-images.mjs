/**
 * One-time extraction of the 100 દર્શન images out of the original single-file page.
 *
 * The source HTML inlines every image as a base64 data-URI inside one `const DATA = [...]`
 * array. That is what made the page 25.2 MB and defeated its own lazy-loading: the browser
 * had to download the whole file before rendering anything.
 *
 * This writes each image out as a real file so `loading="lazy"` can actually work, and
 * re-encodes to AVIF (+ WebP fallback). Filenames are content-hashed so they can be served
 * `immutable` — see public/_headers.
 *
 * Quality settings were chosen by measuring, not guessing (scripts/compression-test.mjs):
 * median 173 KB -> 57 KB, worst case 395 KB -> 233 KB, both visually indistinguishable.
 *
 * Run once:  npm run extract
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';

const SRC = process.env.DARSHAN_SRC
  || 'C:/Users/parth/Downloads/Nilkanth_Varni_Dhyan_Darshan (1).html';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT_IMG = path.join(ROOT, 'public', 'darshan');
const OUT_DATA = path.join(ROOT, 'content', 'darshan.json');
const OUT_ORIG = path.join(ROOT, 'originals-archive');

const AVIF = { quality: 60, effort: 6 };
const WEBP = { quality: 78, effort: 6 };
const CONCURRENCY = 4;

// The DATA array lives on one enormous line; find it rather than hardcoding a line number.
function loadData() {
  const html = fs.readFileSync(SRC, 'utf8');
  const marker = html.indexOf('const DATA = [');
  if (marker === -1) throw new Error(`Could not find "const DATA = [" in ${SRC}`);
  const start = html.indexOf('[', marker);
  const end = html.indexOf('];', start);
  if (end === -1) throw new Error('Could not find the end of the DATA array');
  return JSON.parse(html.slice(start, end + 1));
}

const hash = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 8);

async function convert(entry) {
  const n = String(entry.n).padStart(3, '0');
  const jpeg = Buffer.from(entry.s.slice(entry.s.indexOf(',') + 1), 'base64');

  const { width, height } = await sharp(jpeg).metadata();

  // No resize: 1400px is already correct for mobile (430 CSS px x 3 DPR ~= 1290px).
  const avif = await sharp(jpeg).avif(AVIF).toBuffer();
  const webp = await sharp(jpeg).webp(WEBP).toBuffer();

  const avifName = `${n}.${hash(avif)}.avif`;
  const webpName = `${n}.${hash(webp)}.webp`;
  fs.writeFileSync(path.join(OUT_IMG, avifName), avif);
  fs.writeFileSync(path.join(OUT_IMG, webpName), webp);
  fs.writeFileSync(path.join(OUT_ORIG, `${n}.jpg`), jpeg);

  return {
    record: {
      n: entry.n,
      t: entry.t,
      avif: `/darshan/${avifName}`,
      webp: `/darshan/${webpName}`,
      w: width,
      h: height,
      group: null, // filled in once the user supplies group names + scene ranges
    },
    before: jpeg.length,
    after: avif.length,
  };
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
        process.stdout.write(`\r  converted ${out.filter(Boolean).length}/${items.length}`);
      }
    })
  );
  return out;
}

const mb = (n) => (n / 1048576).toFixed(2) + ' MB';

const DATA = loadData();
console.log(`found ${DATA.length} scenes in the source page`);

for (const dir of [OUT_IMG, OUT_ORIG, path.dirname(OUT_DATA)]) {
  fs.mkdirSync(dir, { recursive: true });
}
// Clear stale output so renamed hashes do not accumulate.
for (const f of fs.readdirSync(OUT_IMG)) {
  if (f.endsWith('.avif') || f.endsWith('.webp')) fs.unlinkSync(path.join(OUT_IMG, f));
}

const results = await mapLimit(DATA, CONCURRENCY, convert);
console.log('');

const records = results.map((r) => r.record).sort((a, b) => a.n - b.n);
fs.writeFileSync(OUT_DATA, JSON.stringify(records, null, 2), 'utf8');

const before = results.reduce((s, r) => s + r.before, 0);
const after = results.reduce((s, r) => s + r.after, 0);

console.log(`\noriginal JPEG total : ${mb(before)}`);
console.log(`AVIF total          : ${mb(after)}  (${(100 - (after / before) * 100).toFixed(0)}% smaller)`);
console.log(`as delivered before : 25.2 MB base64-inlined in one HTML file`);
console.log(`\nwrote ${records.length} records -> ${path.relative(ROOT, OUT_DATA)}`);
console.log(`originals archived  -> ${path.relative(ROOT, OUT_ORIG)}/  (move to Drive, not committed)`);
