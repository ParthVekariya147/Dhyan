// One-off gate test: does AVIF/WebP actually hit the size target on THESE images?
// Converts 3 representative scenes and reports real sizes. Not part of the build.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const SRC = 'C:/Users/parth/Downloads/Nilkanth_Varni_Dhyan_Darshan (1).html';
const OUT = process.argv[2];
fs.mkdirSync(OUT, { recursive: true });

const line = fs.readFileSync(SRC, 'utf8').split('\n')[180];
const DATA = JSON.parse(line.slice(line.indexOf('['), line.lastIndexOf(']') + 1));

const buf = (d) => Buffer.from(d.s.slice(d.s.indexOf(',') + 1), 'base64');
const withSize = DATA.map((d, i) => ({ d, i, bytes: buf(d).length }))
  .sort((a, b) => a.bytes - b.bytes);

// smallest / median / largest — the largest is the stress case
const picks = [withSize[0], withSize[50], withSize[99]];
const kb = (n) => (n / 1024).toFixed(1) + ' KB';

console.log('scene | original | avif50 | avif60 | avif65 | webp78 | webp85');
console.log('------|----------|--------|--------|--------|--------|-------');

for (const p of picks) {
  const src = buf(p.d);
  const n = String(p.d.n).padStart(3, '0');
  const row = [];

  for (const q of [50, 60, 65]) {
    const out = await sharp(src).avif({ quality: q, effort: 6 }).toBuffer();
    fs.writeFileSync(path.join(OUT, `${n}-avif${q}.avif`), out);
    row.push(kb(out.length));
  }
  for (const q of [78, 85]) {
    const out = await sharp(src).webp({ quality: q, effort: 6 }).toBuffer();
    fs.writeFileSync(path.join(OUT, `${n}-webp${q}.webp`), out);
    row.push(kb(out.length));
  }
  // keep the original for side-by-side comparison
  fs.writeFileSync(path.join(OUT, `${n}-original.jpg`), src);

  console.log(`  ${n} | ${kb(src.length).padStart(8)} | ${row.join(' | ')}`);
}

// project the full set from the median
const median = buf(picks[1].d);
const med60 = await sharp(median).avif({ quality: 60, effort: 6 }).toBuffer();
console.log(`\nprojected 100-image set @ avif60: ~${(med60.length * 100 / 1048576).toFixed(1)} MB`);
console.log(`current delivered size: 25.2 MB`);
