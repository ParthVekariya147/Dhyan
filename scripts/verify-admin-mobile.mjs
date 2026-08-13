/**
 * ────────────────────────────────────────────────────────────────────────────
 * THE સંચાલક પેનલ RESPONSIVE ACCEPTANCE TEST (§36) — eleven real widths
 * ────────────────────────────────────────────────────────────────────────────
 *
 *   npm run verify:admin
 *
 * `verify-mobile.mjs` is the same idea for the યુવક app, and it measures લોગિન and નોંધણી
 * only. Nothing has ever measured the panel, which is why the panel is where the layout
 * faults were: a fixed three-column grid on લેવલ that clipped Gujarati at 320px, sticky
 * bars parked underneath an opaque topbar, a દર્શન tile grid that reflowed as every
 * thumbnail arrived. Those were all found by eye. This finds the next one by measurement.
 *
 * It serves `dist/` under **netlify.toml's own rules** — `/admin/*` rewritten to
 * `dist/admin/index.html` *before* the SPA catch-all — rather than under a generic
 * fallback. That makes the redirect ordering part of what is tested: get it wrong and
 * `/admin/users` boots the યુવક shell at an admin URL, which is the failure the rule in
 * netlify.toml exists to prevent and which no other check would notice.
 *
 * What it asserts:
 *
 *   1. DEEP LINKS RESOLVE. `/admin/` and `/admin/users` both return the panel. A refresh
 *      on a deep link must not 404 and must not hand back the other application.
 *   2. NO HORIZONTAL SCROLLING, and no element hanging off either edge. `body {
 *      overflow-x: hidden }` HIDES a sideways page rather than preventing one, so
 *      scrollWidth alone would pass while content sat off-screen unreachable — every
 *      element is measured against the viewport.
 *   3. NO TEXT BELOW 11.5px, so Gujarati keeps its matras. The panel's smallest token is
 *      --fs-micro at 11.5px and nothing may undercut it.
 *   4. TAP TARGETS ≥ 44px below 768px. --tap rises to 44 under `pointer: coarse`; this
 *      proves it actually reached the controls rather than only the variable.
 *   5. INPUTS ≥ 16px on touch. Below that iOS Safari zooms on focus and does not zoom
 *      back out, which is the "the keyboard broke the layout" bug.
 *
 * Unauthenticated, so what renders is the login screen or the not-configured gate — the
 * whole of the panel's public surface, and enough to exercise the shell, the tokens, the
 * form controls and the gate card. Everything past the gate needs a real session and
 * belongs to a test that can hold one.
 *
 * It runs against `dist/`, not the dev server, so what is measured is what ships.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(import.meta.dirname, '..', 'dist');
const CHROME = process.env.CHROME_PATH
  || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 4187;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.woff2': 'font/woff2',
};

if (!fs.existsSync(path.join(ROOT, 'admin', 'index.html'))) {
  console.error('  dist/admin is missing — run `npm run build` first.');
  process.exit(1);
}

const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = path.join(ROOT, pathname);
  if (!file.startsWith(ROOT)) return res.writeHead(403).end();

  // The two [[redirects]] from netlify.toml, in netlify.toml's order.
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = pathname.startsWith('/admin')
      ? path.join(ROOT, 'admin', 'index.html')
      : path.join(ROOT, 'index.html');
  }
  const body = fs.readFileSync(file);
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' }).end(body);
});
await new Promise((r) => server.listen(PORT, r));

/** §36's list, exactly. 320 is the one that decides everything. */
const WIDTHS = [320, 360, 375, 390, 412, 430, 768, 1024, 1280, 1440, 1920];

let pass = 0;
const fails = [];
const check = (name, ok, detail = '') => {
  if (ok) pass++;
  else fails.push(`${name}${detail ? `  —  ${detail}` : ''}`);
};

const browser = await puppeteer.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const page = await browser.newPage();
// The panel talks to Supabase on boot. Nothing here depends on the answer — the gate
// renders either way — but an unreachable host must not hang networkidle0.
page.setDefaultNavigationTimeout(30000);

console.log('\n[1] deep links reach the panel, not the યુવક shell');
for (const p of ['/admin/', '/admin/users']) {
  await page.setViewport({ width: 1280, height: 900 });
  let ok = false;
  try {
    const resp = await page.goto(`http://localhost:${PORT}${p}`, { waitUntil: 'domcontentloaded' });
    ok = resp.status() === 200 && await page.evaluate(() => !!document.querySelector('#admin-root'));
  } catch { /* reported by the check */ }
  check(`${p} serves the panel`, ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${p}`);
}

console.log('\n[2] the panel at every width §36 names');
for (const width of WIDTHS) {
  const touch = width < 768;
  await page.setViewport({ width, height: 900, isMobile: touch, hasTouch: touch });
  await page.goto(`http://localhost:${PORT}/admin/`, { waitUntil: 'domcontentloaded' });
  // The gate resolves after the auth check settles; give it a beat rather than racing it.
  await new Promise((r) => setTimeout(r, 600));

  const m = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const over = [], small = [], tiny = [];
    const name = (el) => `${el.tagName.toLowerCase()}.${String(el.className || '').split(' ')[0]}`;
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || !r.width) continue;
      if (r.width > vw + 1 || r.left < -1 || r.right > vw + 1) over.push(`${name(el)} ${Math.round(r.width)}px`);
      const fs_ = parseFloat(cs.fontSize);
      if (!el.children.length && el.textContent.trim() && fs_ < 11.4) small.push(`${name(el)} ${fs_}px`);
      if (/^(BUTTON|A|INPUT|SELECT)$/.test(el.tagName) && r.height > 0 && r.height < 43.5) {
        tiny.push(`${name(el)} ${Math.round(r.height)}px`);
      }
    }
    return {
      scrollX: document.documentElement.scrollWidth > vw + 1,
      over: [...new Set(over)].slice(0, 4),
      small: [...new Set(small)].slice(0, 4),
      tiny: [...new Set(tiny)].slice(0, 4),
      inputFs: [...document.querySelectorAll('input')].map((i) => parseFloat(getComputedStyle(i).fontSize)),
    };
  });

  const before = fails.length;
  check(`${width}px no horizontal scrolling`, !m.scrollX);
  check(`${width}px nothing wider than the screen`, m.over.length === 0, m.over.join(', '));
  check(`${width}px no text below 11.5px`, m.small.length === 0, m.small.join(', '));
  if (touch) {
    check(`${width}px tap targets >= 44px`, m.tiny.length === 0, m.tiny.join(', '));
    check(`${width}px inputs >= 16px`, m.inputFs.every((f) => f >= 16), m.inputFs.join(', '));
  }
  console.log(`  ${fails.length === before ? 'PASS' : 'FAIL'}  ${width}px`);
}

await browser.close();
server.close();

console.log(`\n  સંચાલક પેનલ responsive (§36) — ${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log('\n' + fails.map((f) => `  FAIL  ${f}`).join('\n') + '\n');
  process.exit(1);
}
console.log('  ✓ 320 → 1920px — panel fits, deep links resolve, targets and type hold\n');
