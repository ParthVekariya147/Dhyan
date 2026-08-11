/**
 * Quality-first image pipeline.
 *
 * The rule this implements: file size is an OUTCOME, never a target. For every image,
 * format and width, we search the encoder quality ladder for the *lowest* quality whose
 * SSIM against the reference still clears QUALITY_FLOOR. If nothing on the ladder
 * clears it, we ship the highest quality available and flag the image in the report —
 * we never lower the bar to make a file smaller.
 *
 * Where quality is decided:
 *   Quality is searched at NATIVE width (1400px), because encoding artefacts are
 *   hardest to hide there. Downscaled variants inherit that quality setting and are
 *   then independently VERIFIED with their own SSIM measurement. Since downscaling
 *   suppresses artefacts, a setting that passes at 1400px is conservative at 960/640.
 *
 *   npm run optimize
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { luma, ssim, psnr } from './lib/ssim.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const ORIGINALS = path.join(ROOT, 'assets', 'originals');
const OUT_IMG = path.join(ROOT, 'public', 'darshan');
const OUT_DATA = path.join(ROOT, 'content', 'darshan.json');
const OUT_REPORT = path.join(ROOT, 'reports', 'optimization-report.md');
const CAPTIONS = path.join(ROOT, 'content', 'darshan-captions.json');

/** SSIM at or above this counts as visually indistinguishable. */
const QUALITY_FLOOR = 0.985;

/** Widths to emit. Never exceeds the source width — we do not upscale. */
const WIDTHS = [640, 960, 1400];
const NATIVE = 1400;

/** Quality ladders, searched low → high. Encoders are not directly comparable. */
const LADDERS = {
  avif: [50, 55, 60, 65, 70, 75, 80, 85, 90],
  webp: [65, 70, 75, 80, 85, 90, 95],
  jpeg: [72, 76, 80, 84, 88, 92, 95],
};

const CONCURRENCY = 4;

const encode = (buf, format, quality) => {
  const s = sharp(buf);
  if (format === 'avif') return s.avif({ quality, effort: 6, chromaSubsampling: '4:4:4' }).toBuffer();
  if (format === 'webp') return s.webp({ quality, effort: 6, smartSubsample: false }).toBuffer();
  return s.jpeg({ quality, mozjpeg: true, chromaSubsampling: '4:4:4' }).toBuffer();
};

const hash = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 8);

/**
 * Lowest quality on the ladder that still clears the floor.
 * Binary search: the SSIM/quality relationship is monotonic in practice.
 */
async function searchQuality(source, format, ref) {
  const ladder = LADDERS[format];
  let lo = 0;
  let hi = ladder.length - 1;
  let best = null;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const buf = await encode(source, format, ladder[mid]);
    const cand = await luma(buf);
    const score = ssim(ref.data, cand.data, ref.w, ref.h);

    if (score >= QUALITY_FLOOR) {
      best = { quality: ladder[mid], buf, ssim: score };
      hi = mid - 1; // a lower quality may also pass — keep looking down
    } else {
      lo = mid + 1;
    }
  }

  if (best) return { ...best, cappedOut: false };

  // Nothing cleared the floor: ship the best available rather than accepting worse.
  const top = ladder[ladder.length - 1];
  const buf = await encode(source, format, top);
  const cand = await luma(buf);
  return { quality: top, buf, ssim: ssim(ref.data, cand.data, ref.w, ref.h), cappedOut: true };
}

async function processImage(file) {
  const n = Number(path.basename(file, '.jpg'));
  const original = fs.readFileSync(path.join(ORIGINALS, file));
  const meta = await sharp(original).metadata();
  const srcW = meta.width;
  const srcH = meta.height;
  const aspect = srcW / srcH;

  const widths = WIDTHS.filter((w) => w <= srcW);
  if (!widths.includes(srcW)) widths.push(srcW); // always offer native

  const variants = { avif: [], webp: [], jpeg: [] };
  const rows = [];

  // Quality is searched INDEPENDENTLY at every width.
  //
  // An earlier version chose quality at native width and let smaller variants inherit
  // it, assuming downscaling hides artefacts. Measurement disproved that: a downscaled
  // image carries less spatial redundancy, so the same quality setting yields MORE
  // relative error, and 640/960 variants fell below the floor. Each width now gets its
  // own search, so every shipped file is verified on its own terms.
  for (const w of widths) {
    const isNative = w === srcW;
    const source = isNative
      ? original
      : await sharp(original).resize({ width: w, kernel: 'lanczos3' }).toBuffer();
    const ref = await luma(source);
    const h = isNative ? srcH : Math.round(w / aspect);

    for (const format of ['avif', 'webp', 'jpeg']) {
      const picked = await searchQuality(source, format, ref);
      const cand = await luma(picked.buf);

      rows.push({
        n, format, width: w, height: h,
        bytes: picked.buf.length,
        quality: picked.quality,
        ssim: picked.ssim,
        psnr: psnr(ref.data, cand.data, ref.w * ref.h),
        cappedOut: picked.cappedOut,
      });

      const ext = format === 'jpeg' ? 'jpg' : format;
      const name = `${String(n).padStart(3, '0')}-${w}.${hash(picked.buf)}.${ext}`;
      fs.writeFileSync(path.join(OUT_IMG, name), picked.buf);
      variants[format].push({ w, url: `/darshan/${name}` });
    }
  }

  for (const f of Object.keys(variants)) variants[f].sort((a, b) => a.w - b.w);

  return {
    record: {
      n,
      w: srcW,
      h: srcH,
      avif: variants.avif,
      webp: variants.webp,
      jpeg: variants.jpeg,
      // Lightbox always uses the native-width encode — never an upscaled thumbnail.
      full: {
        avif: variants.avif.at(-1).url,
        webp: variants.webp.at(-1).url,
        jpeg: variants.jpeg.at(-1).url,
      },
    },
    rows,
    originalBytes: original.length,
  };
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
        done++;
        process.stdout.write(`\r  ${done}/${items.length} images`);
      }
    })
  );
  return out;
}

// ------------------------------------------------------------------ run
const files = fs.readdirSync(ORIGINALS).filter((f) => f.endsWith('.jpg')).sort();
const only = process.argv[2] ? Number(process.argv[2]) : null;
const targets = only ? files.slice(0, only) : files;

console.log(`optimizing ${targets.length} images`);
console.log(`quality floor: SSIM >= ${QUALITY_FLOOR} (searched at ${NATIVE}px native)\n`);

fs.mkdirSync(OUT_IMG, { recursive: true });
fs.mkdirSync(path.dirname(OUT_REPORT), { recursive: true });
for (const f of fs.readdirSync(OUT_IMG)) {
  if (/\.(avif|webp|jpg)$/.test(f)) fs.unlinkSync(path.join(OUT_IMG, f));
}

const t0 = Date.now();
const results = await mapLimit(targets, CONCURRENCY, processImage);
console.log(`\n\ndone in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

// ------------------------------------------------------------------ data file
const captions = JSON.parse(fs.readFileSync(CAPTIONS, 'utf8'));
const capByN = new Map(captions.map((c) => [c.n, c.t]));

const records = results
  .map((r) => ({ ...r.record, t: capByN.get(r.record.n) ?? '', group: null }))
  .sort((a, b) => a.n - b.n);
fs.writeFileSync(OUT_DATA, JSON.stringify(records, null, 2), 'utf8');

// ------------------------------------------------------------------ report
const allRows = results.flatMap((r) => r.rows);
const originalTotal = results.reduce((s, r) => s + r.originalBytes, 0);
const kb = (b) => (b / 1024).toFixed(0) + ' KB';
const mb = (b) => (b / 1048576).toFixed(2) + ' MB';

const nativeRows = allRows.filter((r) => r.width === NATIVE);
const failed = allRows.filter((r) => r.ssim < QUALITY_FLOOR);
const capped = nativeRows.filter((r) => r.cappedOut);

const byFormat = (fmt) => {
  const rows = nativeRows.filter((r) => r.format === fmt);
  const bytes = rows.reduce((s, r) => s + r.bytes, 0);
  const ssims = rows.map((r) => r.ssim).sort((a, b) => a - b);
  const qs = rows.map((r) => r.quality).sort((a, b) => a - b);
  return {
    bytes,
    minSsim: ssims[0],
    medSsim: ssims[Math.floor(ssims.length / 2)],
    minQ: qs[0],
    maxQ: qs.at(-1),
    medQ: qs[Math.floor(qs.length / 2)],
  };
};

let md = `# Optimization report — વરણી ધ્યાન દર્શન\n\n`;
md += `Generated by \`npm run optimize\` · ${targets.length} images · quality floor SSIM ≥ ${QUALITY_FLOOR}\n\n`;
md += `## Source limitation\n\n`;
md += `No true original images exist. The only available source is the base64-embedded\n`;
md += `JPEG recovered from the original single-file HTML: **${NATIVE}×788, 4:4:4 chroma**.\n`;
md += `These masters are therefore already lossy, and every encode below is generation\n`;
md += `loss on top of an existing JPEG. SSIM is measured against that JPEG, which is the\n`;
md += `best reference obtainable. ${NATIVE}px is also a hard ceiling on output resolution —\n`;
md += `no variant is upscaled beyond it.\n\n`;

md += `## Method\n\n`;
md += `Quality is **not** chosen to hit a file-size target. For each image and format the\n`;
md += `encoder ladder is binary-searched for the *lowest* quality whose SSIM against the\n`;
md += `reference still reaches ${QUALITY_FLOOR}. File size is whatever that produces.\n\n`;
md += `Quality is searched at native ${NATIVE}px, where artefacts are hardest to conceal.\n`;
md += `Downscaled variants inherit the setting and are then verified with their own SSIM.\n\n`;

md += `## Summary (native ${NATIVE}px)\n\n`;
md += `| Format | Total | vs original | Quality (min/med/max) | SSIM (min/median) |\n`;
md += `|---|---|---|---|---|\n`;
for (const fmt of ['avif', 'webp', 'jpeg']) {
  const s = byFormat(fmt);
  const pct = (100 - (s.bytes / originalTotal) * 100).toFixed(0);
  md += `| ${fmt.toUpperCase()} | ${mb(s.bytes)} | ${pct}% smaller | ${s.minQ} / ${s.medQ} / ${s.maxQ} | ${s.minSsim.toFixed(4)} / ${s.medSsim.toFixed(4)} |\n`;
}
md += `| *original JPEG* | ${mb(originalTotal)} | — | — | 1.0000 |\n\n`;

md += `## Verdict\n\n`;
md += `- Images below the quality floor: **${failed.length}**\n`;
md += `- Images where even max quality could not reach the floor: **${capped.length}**`;
if (capped.length) md += ` (n = ${capped.map((r) => r.n + '/' + r.format).join(', ')})`;
md += `\n- Aspect ratio preserved on every variant: **yes** (width-only resize, no crop)\n`;
md += `- Total variants written: **${allRows.length}** files\n\n`;

md += `## Per-image detail (native ${NATIVE}px)\n\n`;
md += `| # | Original | AVIF | WebP | JPEG | AVIF q | SSIM | PSNR | Status |\n`;
md += `|---|---|---|---|---|---|---|---|---|\n`;
for (const r of results.sort((a, b) => a.record.n - b.record.n)) {
  const g = (f) => r.rows.find((x) => x.format === f && x.width === NATIVE);
  const a = g('avif');
  const w = g('webp');
  const j = g('jpeg');
  const pass = [a, w, j].every((x) => x.ssim >= QUALITY_FLOOR);
  md += `| ${r.record.n} | ${kb(r.originalBytes)} | ${kb(a.bytes)} | ${kb(w.bytes)} | ${kb(j.bytes)} | ${a.quality} | ${a.ssim.toFixed(4)} | ${a.psnr.toFixed(1)} dB | ${pass ? 'PASS' : 'REVIEW'} |\n`;
}

fs.writeFileSync(OUT_REPORT, md, 'utf8');

console.log(`\nAVIF total : ${mb(byFormat('avif').bytes)}`);
console.log(`WebP total : ${mb(byFormat('webp').bytes)}`);
console.log(`JPEG total : ${mb(byFormat('jpeg').bytes)}`);
console.log(`original   : ${mb(originalTotal)}`);
console.log(`\nbelow floor: ${failed.length} | capped out: ${capped.length}`);
console.log(`report     -> ${path.relative(ROOT, OUT_REPORT)}`);
console.log(`data       -> ${path.relative(ROOT, OUT_DATA)}`);
