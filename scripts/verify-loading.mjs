/**
 * Proves the central claim of the rebuild: that images now load lazily.
 *
 * The original page inlined all 100 images as base64, so the browser had to pull
 * 25.2 MB before painting anything. This drives a real Chrome against the built
 * site and counts actual image requests — first without scrolling, then while
 * scrolling, then on a warm reload to confirm the cache is doing its job.
 *
 *   npm run build && npm run verify
 */
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { createServer } from './serve-dist.mjs';

const CHROME = process.env.CHROME_PATH
  || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

// Serve dist/ ourselves rather than using `vite preview`: preview ignores public/_headers
// and sends `Cache-Control: no-cache`, which would mask exactly the caching we are testing.
const PORT = 4180;
const server = createServer();
await new Promise((r) => server.listen(PORT, r));
const SITE = `http://localhost:${PORT}/`;

const mb = (n) => (n / 1048576).toFixed(2) + ' MB';
const kb = (n) => (n / 1024).toFixed(0) + ' KB';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox'],
});

function track(page) {
  const imgs = [];
  page.on('response', async (res) => {
    const u = new URL(res.url());
    if (!u.pathname.startsWith('/darshan/')) return;
    let size = 0;
    try {
      size = Number(res.headers()['content-length'] || 0);
      if (!size) size = (await res.buffer()).length;
    } catch { /* body already gone; size stays 0 */ }
    imgs.push({ url: u.pathname, size, fromCache: res.fromCache() });
  });
  return imgs;
}

let failures = 0;
const check = (label, ok, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};

// ---------------------------------------------------------------- test 1
console.log('\n[1] initial load, no scrolling');
const page = await browser.newPage();
await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 2 }); // mid-range Android
const cold = track(page);
await page.goto(SITE, { waitUntil: 'networkidle0', timeout: 60000 });

const coldBytes = cold.reduce((s, r) => s + r.size, 0);
console.log(`      ${cold.length} image requests, ${mb(coldBytes)}`);
check('does not download all 100 images', cold.length < 30, `${cold.length} requested`);
check('initial payload under 3 MB', coldBytes < 3 * 1048576, mb(coldBytes));

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
  hasDims: [...document.querySelectorAll('.frame img')].every((i) => i.width && i.height),
}));
console.log(`      heading: ${info.heading}`);
console.log(`      caption 1: ${info.firstCaption?.slice(0, 48)}…`);
check('Gujarati heading intact', info.heading === 'નીલકંઠ વર્ણી ધ્યાન');
check('captions rendered', info.captions > 0, `${info.captions} visible`);
check('every img marked loading=lazy', info.lazyAttrs);
check('every img has explicit dimensions', info.hasDims);

// ---------------------------------------------------------------- test 5b
console.log('\n[5b] responsive sources');
const resp = await page2.evaluate(() => {
  const img = document.querySelector('.frame img');
  const pic = img.closest('picture');
  const types = [...pic.querySelectorAll('source')].map((s) => s.type);
  return {
    types,
    imgHasSrcset: !!img.srcset,
    fallbackIsJpeg: /\.jpg(\?|$)/.test(img.src),
    // currentSrc is what the browser actually chose for this viewport + DPR
    chosen: img.currentSrc,
    sizes: img.sizes,
  };
});
console.log(`      <source> types: ${resp.types.join(', ')}`);
console.log(`      browser chose: ${resp.chosen.split('/').pop()}`);
check('AVIF offered first', resp.types[0] === 'image/avif');
check('WebP offered as fallback', resp.types[1] === 'image/webp');
check('JPEG is the final <img> fallback', resp.fallbackIsJpeg, resp.src);
check('img carries a srcset', resp.imgHasSrcset);
check('browser picked a width-appropriate variant, not always 1400',
  /-(640|960)\./.test(resp.chosen), resp.chosen.split('/').pop());

// ---------------------------------------------------------------- test 5c
console.log('\n[5c] lightbox uses full-resolution encode');
await page2.click('.frame');
await new Promise((r) => setTimeout(r, 1200));
const lbSrc = await page2.evaluate(() => {
  const img = document.querySelector('.lb img');
  return img ? img.currentSrc : null;
});
console.log(`      lightbox loaded: ${lbSrc?.split('/').pop()}`);
check('lightbox loads the native-width file', /-1400\./.test(lbSrc || ''), lbSrc);
await page2.keyboard.press('Escape');

// ---------------------------------------------------------------- test 6
console.log('\n[6] cache headers as Cloudflare will send them');
const hdr = await page2.evaluate(async (p) => {
  const r = await fetch(p, { method: 'HEAD' });
  return r.headers.get('cache-control');
}, seen.values().next().value);
console.log(`      /darshan/* -> Cache-Control: ${hdr}`);
check('images marked immutable', /immutable/.test(hdr || ''), hdr);

// ---------------------------------------------------------------- test 7
console.log('\n[7] no base64 image payload in the shipped bundle');
const { readdirSync, readFileSync, statSync } = await import('node:fs');
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
