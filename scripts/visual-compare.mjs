/**
 * Builds side-by-side original-vs-encoded strips for human inspection.
 *
 * SSIM is a good gate but it is still a number; §4 of the brief requires eyes on the
 * result. This picks images that stress the encoder in different ways — darkest,
 * brightest, most detailed, smoothest gradients, plus the worst SSIM scorers — and
 * writes 1:1 crops (no downscaling, which would hide exactly what we are looking for).
 *
 *   npm run compare
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const ORIGINALS = path.join(ROOT, 'assets', 'originals');
const OUT = path.join(ROOT, 'reports', 'visual');
const DATA = path.join(ROOT, 'content', 'darshan.json');

const CROP = { width: 640, height: 420 };

async function stats(file) {
  const s = await sharp(path.join(ORIGINALS, file)).greyscale().stats();
  const ch = s.channels[0];
  return { file, n: Number(path.basename(file, '.jpg')), mean: ch.mean, stdev: ch.stdev };
}

const records = JSON.parse(fs.readFileSync(DATA, 'utf8'));
const byN = new Map(records.map((r) => [r.n, r]));

const files = fs.readdirSync(ORIGINALS).filter((f) => f.endsWith('.jpg')).sort();
const all = [];
for (const f of files) all.push(await stats(f));

const pick = (label, arr) => ({ label, n: arr[0].n });
const sorted = (key, dir) => [...all].sort((a, b) => (dir === 'asc' ? a[key] - b[key] : b[key] - a[key]));

const selection = [
  pick('darkest (shadow detail, banding risk)', sorted('mean', 'asc')),
  pick('brightest (highlight rolloff)', sorted('mean', 'desc')),
  pick('most detailed (fine texture, ringing risk)', sorted('stdev', 'desc')),
  pick('smoothest (gradient banding risk)', sorted('stdev', 'asc')),
];

// Dedupe, then add a couple of mid-range faces for skin-tone and edge inspection.
const seen = new Set(selection.map((s) => s.n));
for (const n of [3, 86]) {
  if (!seen.has(n)) {
    selection.push({ label: `scene ${n} (face / skin tone)`, n });
    seen.add(n);
  }
}

fs.mkdirSync(OUT, { recursive: true });
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const lines = [];
for (const { label, n } of selection) {
  const rec = byN.get(n);
  if (!rec) continue;
  const origPath = path.join(ORIGINALS, `${String(n).padStart(3, '0')}.jpg`);
  const meta = await sharp(origPath).metadata();

  // Centre crop at 1:1 — no resampling, so artefacts are shown as they actually are.
  const left = Math.max(0, Math.round((meta.width - CROP.width) / 2));
  const top = Math.max(0, Math.round((meta.height - CROP.height) / 2));
  const region = { left, top, width: Math.min(CROP.width, meta.width), height: Math.min(CROP.height, meta.height) };

  const orig = await sharp(origPath).extract(region).png().toBuffer();
  const avifFile = path.join(ROOT, 'public', rec.full.avif);
  const enc = await sharp(avifFile).extract(region).png().toBuffer();

  // Stack original above encoded so the same pixels line up vertically.
  const strip = await sharp({
    create: {
      width: region.width,
      height: region.height * 2 + 4,
      channels: 3,
      background: { r: 240, g: 199, b: 120 },
    },
  })
    .composite([
      { input: orig, top: 0, left: 0 },
      { input: enc, top: region.height + 4, left: 0 },
    ])
    .png()
    .toFile(path.join(OUT, `${String(n).padStart(3, '0')}-compare.png`));

  lines.push(`${String(n).padStart(3, '0')}  ${label}  (top = original, bottom = AVIF)`);
  void strip;
}

fs.writeFileSync(path.join(OUT, 'index.txt'), lines.join('\n') + '\n', 'utf8');
console.log(lines.join('\n'));
console.log(`\n${lines.length} comparison strips -> ${path.relative(ROOT, OUT)}`);
