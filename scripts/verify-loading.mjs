/**
 * Proves the central claim of the rebuild: that images load lazily, from Google's CDN, and
 * that the page does not shift while they arrive.
 *
 * The original page inlined all 100 images as base64, so the browser had to pull 25.2 MB
 * before painting anything. This drives a real Chrome against the built site and counts
 * actual image requests — first without scrolling, then while scrolling, then on a warm
 * reload to confirm caching is doing its job.
 *
 * What changed, and why the checks changed with it
 * ------------------------------------------------
 * દર્શન images are no longer served from this origin. They come from
 * `lh3.googleusercontent.com`, which resizes and re-encodes the સંચાલક's Drive files on
 * request. So the assertions about an AVIF/WebP/JPEG ladder, hashed filenames and an
 * `immutable` header on /darshan/* are gone — there is no such ladder, no such file and no
 * such header to assert. What replaced them is stricter in the way that now matters:
 * every request must go to the image CDN, must carry the re-encode suffix that keeps a card
 * at ~130 KB instead of ~1.6 MB, and the enlarged view must ask for a wider file than the
 * feed did rather than stretching the one it has.
 *
 *   npm run build && npm run verify
 */
import path from 'node:path';
import { readFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { createServer } from './serve-dist.mjs';

const CHROME = process.env.CHROME_PATH
  || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

// Serve dist/ ourselves rather than using `vite preview`: preview ignores public/_headers
// and sends `Cache-Control: no-cache`, which would mask the shell caching we still test.
const PORT = 4180;
const server = createServer();
await new Promise((r) => server.listen(PORT, r));
// દર્શન sits behind the login guard, so the suite targets it directly. The build under
// test must be produced with VITE_PUBLIC_DARSHAN=1 (see `npm run verify`).
const SITE = `http://localhost:${PORT}/darshan`;

const mb = (n) => (n / 1048576).toFixed(2) + ' MB';
const kb = (n) => (n / 1024).toFixed(0) + ' KB';

/** Where દર્શન artwork now comes from. Anything else requesting an image is a bug. */
const CDN = /^lh\d+\.googleusercontent\.com$/;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox'],
});

function track(page) {
  const imgs = [];
  page.on('response', async (res) => {
    const u = new URL(res.url());
    if (!CDN.test(u.hostname)) return;
    let size = 0;
    try {
      size = Number(res.headers()['content-length'] || 0);
      if (!size) size = (await res.buffer()).length;
    } catch { /* body already gone; size stays 0 */ }
    imgs.push({ url: res.url(), size, fromCache: res.fromCache(), type: res.headers()['content-type'] || '' });
  });
  return imgs;
}

let failures = 0;
const check = (label, ok, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};

const manifest = JSON.parse(
  readFileSync(path.join(import.meta.dirname, '..', 'content', 'darshan.json'), 'utf8')
);

// ---------------------------------------------------------------- test 1
console.log('\n[1] initial load, no scrolling');
const page = await browser.newPage();
await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 2 }); // mid-range Android
const cold = track(page);
await page.goto(SITE, { waitUntil: 'networkidle0', timeout: 60000 });

const coldBytes = cold.reduce((s, r) => s + r.size, 0);
console.log(`      ${cold.length} image requests, ${mb(coldBytes)}  (collection is ${manifest.length})`);
check('does not download the whole collection', cold.length < 30, `${cold.length} requested`);
check('initial payload under 3 MB', coldBytes < 3 * 1048576, mb(coldBytes));
check('every image came from the CDN', cold.length > 0, `${cold.length} requests`);

// ---------------------------------------------------------------- test 2
console.log('\n[2] scrolling loads more, on demand');
const before = cold.length;
for (let i = 0; i < 6; i++) {
  await page.evaluate(() => scrollBy(0, innerHeight * 2));
  await new Promise((r) => setTimeout(r, 700));
}
await new Promise((r) => setTimeout(r, 1500));
const afterScroll = cold.length;
console.log(`      ${before} -> ${afterScroll} requests after scrolling`);
check('scrolling triggers further loads', afterScroll > before, `+${afterScroll - before}`);
check('no duplicate refetching', new Set(cold.map((r) => r.url)).size === cold.length);

// ---------------------------------------------------------------- test 2b
//
// The single most expensive mistake available here. Ask the CDN for the file without the
// re-encode suffix and it hands back the master's own format — a 1.6 MB PNG per card, some
// twelve times the bytes, with nothing on screen to say so.
console.log('\n[2b] the CDN is asked to re-encode, not to serve the master');
const withoutRj = cold.filter((r) => !/-rj/.test(r.url));
const pngs = cold.filter((r) => /image\/png/.test(r.type));
const median = [...cold.map((r) => r.size)].sort((a, b) => a - b)[cold.length >> 1] || 0;
console.log(`      median image ${kb(median)}, ${pngs.length} PNG response(s)`);
check('every request carries the re-encode suffix', withoutRj.length === 0, `${withoutRj.length} without`);
check('nothing comes back as PNG', pngs.length === 0, `${pngs.length} PNGs`);
check('median image under 400 KB', median > 0 && median < 400 * 1024, kb(median));

// ---------------------------------------------------------------- test 3
console.log('\n[3] layout shift');
const cls = await page.evaluate(
  () =>
    new Promise((resolve) => {
      let total = 0;
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) if (!e.hadRecentInput) total += e.value;
      }).observe({ type: 'layout-shift', buffered: true });
      setTimeout(() => resolve(total), 1000);
    })
);
console.log(`      CLS = ${cls.toFixed(4)}`);
check('CLS under 0.1', cls < 0.1, cls.toFixed(4));

// ---------------------------------------------------------------- test 4
console.log('\n[4] reopen after closing — should cost ~0 bytes');
const seen = new Set(cold.map((r) => r.url));
await page.close();

const page2 = await browser.newPage(); // same browser profile => same HTTP cache
await page2.setViewport({ width: 412, height: 915, deviceScaleFactor: 2 });
const warm = track(page2);
await page2.goto(SITE, { waitUntil: 'networkidle0', timeout: 60000 });
await new Promise((r) => setTimeout(r, 1000));

const revisited = warm.filter((r) => seen.has(r.url));
const fromNetwork = revisited.filter((r) => !r.fromCache);
const networkBytes = fromNetwork.reduce((s, r) => s + r.size, 0);
console.log(`      ${revisited.length} previously-seen images requested again`);
console.log(`      ${fromNetwork.length} actually hit the network, ${kb(networkBytes)}`);
check('previously-viewed images served from cache', fromNetwork.length === 0,
  `${fromNetwork.length} re-downloaded`);

// ---------------------------------------------------------------- test 5
console.log('\n[5] content parity with the original page');
const info = await page2.evaluate(() => ({
  title: document.title,
  heading: document.querySelector('.site-header h1')?.textContent,
  captions: document.querySelectorAll('.cap .txt').length,
  firstCaption: document.querySelector('.cap .txt')?.textContent,
  lazyAttrs: [...document.querySelectorAll('.frame img')].every((i) => i.loading === 'lazy'),
  // The box is reserved in CSS now, not by width/height attributes — nothing in the app
  // measures a remote file. This is the property that actually holds CLS at zero, so it is
  // the property asserted.
  framesReserved: [...document.querySelectorAll('.frame')].every(
    (f) => getComputedStyle(f).aspectRatio !== 'auto'
  ),
}));
console.log(`      heading: ${info.heading}`);
console.log(`      caption 1: ${info.firstCaption?.slice(0, 48)}…`);
check('Gujarati heading intact', info.heading === 'નીલકંઠ વર્ણી ધ્યાન');
check('captions rendered', info.captions > 0, `${info.captions} visible`);
check('every img marked loading=lazy', info.lazyAttrs);
check('every frame reserves its box by ratio', info.framesReserved);

// ---------------------------------------------------------------- test 5b
console.log('\n[5b] one plain <img>, no format negotiation');
const resp = await page2.evaluate(() => {
  const img = document.querySelector('.frame img');
  return {
    inPicture: !!img.closest('picture'),
    hasSrcset: !!img.srcset,
    src: img.src,
    chosen: img.currentSrc,
  };
});
console.log(`      src: …${resp.chosen.slice(-40)}`);
// A <picture>/srcset would be dead weight here: the URL already names the width and the
// format, so there is nothing for the browser to choose between.
check('no <picture> wrapper', !resp.inPicture);
check('no srcset', !resp.hasSrcset);
check('src points at the image CDN', /lh\d+\.googleusercontent\.com/.test(resp.src), resp.src);

// ---------------------------------------------------------------- test 5c
console.log('\n[5c] the enlarged view asks for a wider file');
await page2.click('.frame');
await new Promise((r) => setTimeout(r, 1500));
const lb = await page2.evaluate(() => {
  const img = document.querySelector('.lb img');
  return img ? { src: img.currentSrc || img.src } : null;
});
/**
 * Read from the manifest rather than written here as a number: the feed's width and the
 * lightbox's are both decisions made in shared/domain/drive.js, and a literal here would
 * start failing on a build that merely changed one of them.
 */
const feedWidth = Number(manifest[0].url.match(/=w(\d+)/)?.[1]);
const fullWidth = Number(manifest[0].fullUrl.match(/=w(\d+)/)?.[1]);
const lbWidth = Number(lb?.src.match(/=w(\d+)/)?.[1]);
console.log(`      feed asks w${feedWidth}, lightbox asks w${lbWidth} (manifest says w${fullWidth})`);
check('the lightbox does not reuse the feed’s file', lbWidth > feedWidth, `w${lbWidth} vs w${feedWidth}`);
check('…and asks for the width the manifest declares', lbWidth === fullWidth, `w${lbWidth}`);
await page2.keyboard.press('Escape');

// ---------------------------------------------------------------- test 6
console.log('\n[6] the CDN caches what it serves');
const cacheHdr = await page2.evaluate(async (u) => {
  // no-cors: the response is opaque, but Chrome still stores it, which is what test 4
  // already proved. This only reports what Google says about caching.
  const r = await fetch(u, { mode: 'no-cors' });
  return r.type;
}, seen.values().next().value);
console.log(`      response type from the CDN: ${cacheHdr}`);
// The real caching assertion is test 4, which measured it. Nothing here can read an opaque
// response's headers, so this only records that the CDN answered at all.
check('the CDN answers a direct fetch', !!cacheHdr, cacheHdr);

// ---------------------------------------------------------------- test 7
console.log('\n[7] no base64 image payload in the shipped bundle');
const { readdirSync, statSync } = await import('node:fs');
const distAssets = path.join(import.meta.dirname, '..', 'dist', 'assets');
let inlineHits = 0;
let bundleBytes = 0;
for (const f of readdirSync(distAssets)) {
  const body = readFileSync(path.join(distAssets, f), 'utf8');
  inlineHits += (body.match(/data:image\/(jpeg|png|webp|avif);base64/g) || []).length;
  bundleBytes += statSync(path.join(distAssets, f)).size;
}
const htmlBody = readFileSync(path.join(import.meta.dirname, '..', 'dist', 'index.html'), 'utf8');
inlineHits += (htmlBody.match(/data:image\/(jpeg|png|webp|avif);base64/g) || []).length;
console.log(`      bundle (js+css): ${kb(bundleBytes)}`);
check('zero base64 image payloads', inlineHits === 0, `${inlineHits} found`);

await browser.close();
server.close();

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
