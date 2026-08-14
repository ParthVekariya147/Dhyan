/**
 * ────────────────────────────────────────────────────────────────────────────
 * THE PROGRESS REPORT, RENDERED — the first check that gets past the gate
 * ────────────────────────────────────────────────────────────────────────────
 *
 *   npm run verify:progress
 *
 * `verify-admin-mobile.mjs` measures the panel at eleven widths and its own header admits the
 * limit: "Unauthenticated, so what renders is the login screen or the not-configured gate…
 * Everything past the gate needs a real session and belongs to a test that can hold one."
 * This is that test, and the reason it exists is that every fault on the progress report was
 * found by a human looking at a screenshot.
 *
 * What was wrong, and what a passing run now means:
 *
 *   1. NAMES AND PLACES WERE SHREDDED. "Surat" rendered as "Sur" over "at". "Varachha" as
 *      "Vara" over "chha". "Kevadiya paresh" as three stacked fragments. The cause was one
 *      line in admin.css: `overflow-wrap: anywhere` on `td`. That property does not only
 *      permit a mid-word break, it makes the browser compute the cell's **min-content width
 *      as one character** — so a table asked to fit nineteen columns took the offer. Measured
 *      in Chrome: 18px and nine lines for a cell holding "Surat", against 42px and two lines
 *      under `break-word`. A `min-width` on the column cannot win that argument, because the
 *      table has already been told the cell is willing.
 *
 *   2. THE STICKY HEADER NEVER STUCK. `.dt th` has carried `position: sticky; top: 0` for a
 *      long time. `.table-wrap` sets `overflow-x: auto`, and a box that scrolls in one axis
 *      is a scroll container in both, so the header was dutifully sticking to the top of that
 *      box — which is itself off-screen once the page scrolls past it.
 *
 *   3. THE PERCENTAGE WAS COMPUTED TWICE. The page derived it with a floor while the RPC
 *      returned it rounded, so a real row printed 99.0% on screen and 99.1% into the
 *      spreadsheet. Both claimed to be the same report.
 *
 * None of those three is visible to a unit test, and none of them is visible to a checker
 * that only ever sees a login form. They are all visible to a ruler.
 *
 * ── How it holds a session without a Supabase project ───────────────────────
 *
 * `dist/` is served under netlify.toml's own rules, exactly as verify-admin-mobile does, so
 * the redirect ordering stays part of what is tested. Then every request the panel makes to
 * `/rest/v1/` or `/auth/v1/` is intercepted and answered from a fixture, and `localStorage`
 * is seeded with a session under the client's real storage key (`varni.auth`, from
 * shared/supabase/client.js) before the app boots.
 *
 * That means the REAL bundle, the REAL React tree and the REAL stylesheet are what get
 * measured — only the data is ours. A fixture that lies about the shape of a row would be
 * caught by scripts/test-progress-mapping.mjs, which reads the migration and the service and
 * compares them; between the two there is no gap for a wrong assumption to live in.
 *
 * Every assertion below reads MEASURED geometry or a COMPUTED style. None of them asserts
 * that a fixture equals itself.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const puppeteer = require_('puppeteer-core');

const ROOT = path.resolve(import.meta.dirname, '..', 'dist');
const SHOTS = path.join(ROOT, 'verify-progress');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 4191;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.woff2': 'font/woff2',
};

if (!fs.existsSync(path.join(ROOT, 'admin', 'index.html'))) {
  console.error('  dist/admin is missing - run `npm run build:admin` first.');
  process.exit(1);
}
if (!fs.existsSync(CHROME)) {
  console.log(`\n  SKIPPED: no Chrome at ${CHROME}`);
  console.log('  Set CHROME_PATH, or run scripts/cloud-setup.sh to fetch one.');
  console.log('  A SKIP IS NOT A PASS. Nothing below was measured.\n');
  process.exit(0);
}

// ──────────────────────────────────────────────────────────────── the fixtures

/** The live collection, as `admin/src/lib/liveScenes.js` will resolve it from these rows. */
const SCENE_ROWS = Array.from({ length: 108 }, (_, i) => ({
  id: `darshan-${String(i + 1).padStart(3, '0')}`,
  index: i + 1,
  order: i + 1,
  active: true,
  status: 'ACTIVE',
  title: '',
  caption: `varnan ${i + 1}`,
  image_url: `https://example.invalid/${i + 1}.jpg`,
  drive_id: `d${i + 1}`,
}));
const TOTAL = SCENE_ROWS.length;

/**
 * Every column `admin_progress_report()` declares gets a value. A row with a hole in it maps
 * to `int(undefined)` = 0 in the service, and a zero in a column of real numbers is exactly
 * the failure this whole exercise is about - it must not be introduced by the test's own
 * fixture and then measured as if the page had done it.
 */
const row = (over) => ({
  total_rows: '90',
  user_id: '00000000-0000-4000-8000-000000000000',
  name: 'Someone', mobile: '9000000000', smk: 'AAA000',
  city_id: 'surat', zone_id: 'varachha', account_status: 'ACTIVE',
  registered_at: '2026-07-01T04:00:00Z',
  level1_status: 'COMPLETED', level1_attempts: 1,
  level2_status: 'COMPLETED', level2_attempts: 1,
  level3_status: 'NOT_STARTED', level3_attempts: 0, level3_last_at: null,
  remembered_count: 0, remembered_l3: 0, remembered_l4: 0,
  content_total: TOTAL, remembered_pct: 0,
  gate_open: true,
  level4_total: 4, level4_unlocked: 1, level4_completed: 0,
  level4_passed: 0, level4_revision: 0, level4_attempts: 0, level4_last_at: null,
  last_active_at: '2026-08-14T04:00:00Z',
  points_total: '0',
  ...over,
});

/** 99.07 and not 99.1: the point is that the SERVER's unrounded figure reaches the screen. */
const REPORT_ROWS = [
  row({
    user_id: 'aaaaaaaa-0000-4000-8000-000000000001', name: 'Kevadiya paresh', smk: 'PLK534',
    zone_id: 'vedroad', remembered_count: 107, remembered_pct: 99.07,
    level4_passed: 4, level4_attempts: 4, level4_unlocked: 4, level4_completed: 4,
  }),
  row({
    user_id: 'aaaaaaaa-0000-4000-8000-000000000002', name: 'Hitesh Narshibhai Laheri',
    smk: 'HNL001', remembered_count: 102, remembered_pct: 94.44,
  }),
  row({
    user_id: 'aaaaaaaa-0000-4000-8000-000000000003', name: 'Full Complete', smk: 'FUL108',
    remembered_count: TOTAL, remembered_pct: 100,
    level4_passed: 4, level4_attempts: 6, level4_unlocked: 4, level4_completed: 4,
  }),
  row({
    user_id: 'aaaaaaaa-0000-4000-8000-000000000004', name: 'Nirav Ghinaiya', smk: 'NVG479',
    remembered_count: 0, remembered_pct: 0,
  }),
  // Filler, so the table is taller than the wrap's max-height and the sticky header has
  // something to stick against. Four rows scroll nowhere, and "the header did not move"
  // would then be measuring the fixture rather than the stylesheet.
  ...Array.from({ length: 36 }, (_, i) => row({
    user_id: `bbbbbbbb-0000-4000-8000-${String(i).padStart(12, '0')}`,
    name: `Filler ${i + 1}`,
    smk: `FIL${String(i + 1).padStart(3, '0')}`,
    zone_id: i % 2 ? 'vedroad' : 'varachha',
    remembered_count: i, remembered_pct: Math.round((i / TOTAL) * 10000) / 100,
  })),
];

const SUMMARY = {
  contentTotal: TOTAL, contentSource: 'app-manifest', level4Total: 4,
  totalUsers: 90, activeUsers: 90, activeToday: 3,
  level1Completed: 18, level2Completed: 17, level3Completed: 0,
  level4GateOpen: 6, level4AnyPassed: 4, level4AllPassed: 4,
  fullyRemembered: 1, avgRemembered: 105.5, participants: 4,
  buckets: [
    { key: '100%', lo: TOTAL, hi: TOTAL, count: 1 },
    { key: '90+', lo: 98, hi: TOTAL - 1, count: 2 },
    { key: '75-89', lo: 81, hi: 97, count: 0 },
    { key: '50-74', lo: 54, hi: 80, count: 0 },
    { key: '25-49', lo: 27, hi: 53, count: 0 },
    { key: '1-24', lo: 1, hi: 26, count: 0 },
  ],
};

const OPTIONS = {
  cities: [{ id: 'surat', count: 90 }],
  zones: [{ id: 'varachha', cityId: 'surat', count: 88 }, { id: 'vedroad', cityId: 'surat', count: 2 }],
  statuses: [{ id: 'ACTIVE', count: 90 }],
  level4Total: 4, contentTotal: TOTAL,
};

// ──────────────────────────────────────────────────────────────── the server

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

let pass = 0;
const fails = [];
const check = (name, ok, detail = '') => {
  if (ok) { pass += 1; console.log(`  PASS  ${name}`); }
  else { fails.push(`${name}${detail ? `  -  ${detail}` : ''}`); console.log(`  FAIL  ${name}${detail ? `  -  ${detail}` : ''}`); }
};

const browser = await puppeteer.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const page = await browser.newPage();
const cdp = await page.createCDPSession();
page.setDefaultNavigationTimeout(30000);

// A session under the client's real storage key, so getSession() resolves before the panel
// decides what to render. The values are shaped like Supabase's, not guessed at.
const SESSION = {
  access_token: 'test-token', token_type: 'bearer', expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'test-refresh',
  user: {
    id: '40561a9f-6622-4852-98c0-bfc6cf70284d', aud: 'authenticated', role: 'authenticated',
    email: 'admin@example.invalid', app_metadata: {}, user_metadata: {},
    created_at: '2026-01-01T00:00:00Z',
  },
};
await page.evaluateOnNewDocument((s) => {
  window.localStorage.setItem('varni.auth', JSON.stringify(s));
}, SESSION);

await page.setRequestInterception(true);
const seen = new Set();
/**
 * Every stub answer carries full CORS headers, and OPTIONS is answered before anything else.
 *
 * Learned the hard way: without them the panel rendered "Could not check permission - Network
 * problem", which is `dataError()` reporting a rejected fetch. The requests were being
 * intercepted and answered, but the browser refused the *preflight* - a cross-origin POST
 * carrying `apikey` and `authorization` is not a simple request, so Chrome sends OPTIONS
 * first and will not deliver the real response unless that is allowed. A stub that answers
 * the POST and not the preflight looks exactly like an unreachable server.
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers':
    'authorization,apikey,content-type,prefer,x-client-info,accept,accept-profile,content-profile,range',
  'Access-Control-Expose-Headers': 'content-range,content-profile',
  'Access-Control-Max-Age': '600',
};

page.on('request', (r) => {
  const url = r.url();
  const json = (body, status = 200) => r.respond({
    status,
    contentType: 'application/json',
    headers: CORS,
    body: JSON.stringify(body),
  });

  if (r.method() === 'OPTIONS' && /\/(rest|auth)\/v1\//.test(url)) {
    return r.respond({ status: 204, headers: CORS, body: '' });
  }

  if (url.includes('/auth/v1/')) {
    seen.add('auth');
    if (url.includes('/user')) return json(SESSION.user);
    return json({ ...SESSION });
  }
  if (url.includes('/rest/v1/rpc/effective_role')) { seen.add('effective_role'); return json('SUPER_ADMIN'); }
  if (url.includes('/rest/v1/rpc/admin_progress_filter_options')) { seen.add('options'); return json(OPTIONS); }
  if (url.includes('/rest/v1/rpc/admin_progress_summary')) { seen.add('summary'); return json(SUMMARY); }
  if (url.includes('/rest/v1/rpc/admin_progress_report')) { seen.add('report'); return json(REPORT_ROWS); }
  if (url.includes('/rest/v1/scenes')) { seen.add('scenes'); return json(SCENE_ROWS); }
  if (url.includes('/rest/v1/profiles')) { seen.add('profiles'); return json([{ id: SESSION.user.id, name: 'Parth Vekariya', status: 'ACTIVE' }]); }
  if (url.includes('/rest/v1/')) return json([]);
  return r.continue();
});

fs.mkdirSync(SHOTS, { recursive: true });

/** The measurements, taken inside the page. Geometry and computed styles only. */
const measure = () => page.evaluate(() => {
  const table = document.querySelector('table.dt');
  if (!table) return { rendered: false };

  const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
  const tds = [...table.querySelectorAll('tbody td')];

  /**
   * How many lines the TEXT occupies - measured on the text, not on the box around it.
   *
   * The obvious version divides the cell's clientHeight by its line-height, and it is wrong
   * in a way that took a failing run to notice: every `td` in a row is stretched to the
   * height of the tallest cell in that row. The Remembered cell holds a number above a badge,
   * so it is two lines tall, so *every* cell in the row measures as two lines - and "Surat"
   * in a 110px column reported as split when it was sitting on one line perfectly happily.
   *
   * A Range over the cell's contents returns one client rect per rendered line box, so
   * counting distinct rect tops counts lines of text and nothing else.
   */
  const lineCount = (el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const tops = new Set(
      [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0).map((r) => Math.round(r.top))
    );
    return Math.max(1, tops.size);
  };

  // A cell whose whole text is one unbroken word. If it occupies more than one line the
  // word was split, which is the fault this file exists to catch.
  /**
   * The word itself, not the box around it.
   *
   * Measured over the TEXT NODE rather than the cell for the same reason `lineCount` exists
   * at all. Below ~820px `DataTable` turns each cell into a card row and admin.css draws the
   * column's label from `data-label` as a `::before`; a range over the whole cell then spans
   * the label and the value and reports two lines, which is the card working correctly and
   * not a split word. Ranging the text node asks the only question worth asking: did THIS
   * word get broken across lines?
   */
  const singleWordCells = tds
    .filter((td) => {
      const t = td.textContent.trim();
      return t && !/\s/.test(t) && /^[A-Za-z0-9]+$/.test(t) && t.length >= 5;
    })
    .map((td) => {
      const walker = document.createTreeWalker(td, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node && !node.textContent.trim()) node = walker.nextNode();
      return {
        text: td.textContent.trim(),
        lines: node ? lineCount(node) : 1,
        width: Math.round(td.getBoundingClientRect().width),
        wrap: getComputedStyle(td).overflowWrap,
      };
    });

  const byLabel = (label) => tds.filter((td) => td.getAttribute('data-label') === label);
  const colWidth = (label) => {
    const c = byLabel(label)[0];
    return c ? Math.round(c.getBoundingClientRect().width) : null;
  };

  const rowText = (name) => {
    const cell = tds.find((td) => td.textContent.trim().startsWith(name));
    return cell ? cell.closest('tr').textContent : '';
  };

  const wrap = table.closest('.table-wrap');
  const wrapCs = wrap ? getComputedStyle(wrap) : null;
  const th0 = table.querySelector('thead th');

  return {
    rendered: true,
    heads,
    columnCount: heads.length,
    singleWordCells,
    anywhereCells: tds.filter((td) => getComputedStyle(td).overflowWrap === 'anywhere').length,
    widths: {
      user: colWidth('User'), smk: colWidth('SMK'), city: colWidth('City'),
      zone: colWidth('Zone'), remembered: colWidth('Darshan remembered'),
      pct: colWidth('Remembered %'),
    },
    nameLines: (() => {
      const c = tds.find((td) => td.textContent.trim() === 'Kevadiya paresh');
      return c ? lineCount(c) : null;
    })(),
    fullRow: rowText('Full Complete'),
    zeroRow: rowText('Nirav Ghinaiya'),
    pareshRow: rowText('Kevadiya paresh'),
    theadDisplay: getComputedStyle(table.querySelector('thead')).display,
    wrapOverflowX: wrapCs ? wrapCs.overflowX : null,
    wrapOverflowY: wrapCs ? wrapCs.overflowY : null,
    wrapScrollable: wrap ? wrap.scrollHeight > wrap.clientHeight + 1 : false,
    thTop: th0 ? Math.round(th0.getBoundingClientRect().top) : null,
    wrapTop: wrap ? Math.round(wrap.getBoundingClientRect().top) : null,
    pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
  };
});

async function load(width, height, touch = false) {
  // `setViewport({isMobile, hasTouch})` sets device metrics but does NOT flip the
  // `pointer`/`hover` media features, so admin.css's `@media (pointer: coarse)` block never
  // applied and `--tap` stayed at its 34px desktop value. Every control then measured ~38px
  // and looked like a 44px violation that a real phone would never have. Emulating the media
  // feature is what makes the measurement mean what it claims to mean.
  await page.setViewport({ width, height, isMobile: touch, hasTouch: touch });
  // AFTER setViewport, and that order is load-bearing: setting device metrics clears the
  // emulated media, so doing this first left `--tap` at its 34px desktop value and every
  // control measured ~38px - a 44px "violation" that only existed in the test.
  //
  // Straight to CDP because puppeteer's own `emulateMediaFeatures` whitelists a handful of
  // features and `pointer` is not among them; the protocol underneath accepts all of them.
  await cdp.send('Emulation.setEmulatedMedia', {
    media: 'screen',
    features: touch
      ? [{ name: 'pointer', value: 'coarse' }, { name: 'hover', value: 'none' }]
      : [{ name: 'pointer', value: 'fine' }, { name: 'hover', value: 'hover' }],
  });
  await page.goto(`http://localhost:${PORT}/admin/progress`, { waitUntil: 'domcontentloaded' });
  // The page waits for the manifest, the options, the summary and the report before it paints
  // a table. Poll for the table rather than guessing at a delay.
  try {
    await page.waitForSelector('table.dt tbody tr', { timeout: 15000 });
  } catch { /* reported by the rendered check */ }
  await new Promise((r) => setTimeout(r, 350));
}

console.log('\n[1] the report renders past the gate at all');
await load(1440, 900);
let m = await measure();
check('the table rendered (session held, manifest and RPCs answered)', m.rendered,
  m.rendered ? '' : `stubs reached: ${[...seen].join(', ') || 'none'}`);

if (!m.rendered) {
  console.log('\n  Nothing further can be measured. Screenshot for diagnosis:');
  await page.screenshot({ path: path.join(SHOTS, 'failed-1440.png'), fullPage: true });
  console.log(`  ${path.join(SHOTS, 'failed-1440.png')}`);
  await browser.close();
  server.close();
  console.log(`\n  ${pass} passed, ${fails.length} failed\n`);
  process.exit(1);
}

for (const width of [1440, 1920]) {
  console.log(`\n[2] ${width}px - no ordinary word is split`);
  await load(width, 900);
  m = await measure();

  const split = m.singleWordCells.filter((c) => c.lines > 1);
  check('every single-word cell fits on one line', split.length === 0,
    split.map((c) => `"${c.text}" on ${c.lines} lines in ${c.width}px`).join('; '));
  check('no td computes overflow-wrap: anywhere', m.anywhereCells === 0,
    m.anywhereCells ? `${m.anywhereCells} cells still set it` : '');
  check('a two-word name takes at most 2 lines', m.nameLines !== null && m.nameLines <= 2,
    `Kevadiya paresh on ${m.nameLines} lines`);

  console.log(`\n[3] ${width}px - column floors hold`);
  const floors = { user: 180, smk: 100, city: 110, zone: 120, remembered: 130, pct: 110 };
  for (const [key, min] of Object.entries(floors)) {
    const got = m.widths[key];
    if (got === null) { check(`${key} column present`, false, 'column not rendered'); continue; }
    check(`${key} >= ${min}px`, got >= min, `${got}px`);
  }

  console.log(`\n[4] ${width}px - the numbers on screen are the server's`);
  check('the 108-of-108 row reads 100', /100(\.0)?%/.test(m.fullRow), m.fullRow.slice(0, 120));
  check('and is badged Complete', /Complete/.test(m.fullRow), m.fullRow.slice(0, 120));
  check('the 0 row reads Not started', /Not started/.test(m.zeroRow), m.zeroRow.slice(0, 120));
  // 99.07 rounds to 99.1. A floor would print 99.0 - that was the bug.
  check('99.07 renders as 99.1%, not 99.0%',
    m.pareshRow.includes('99.1%') && !m.pareshRow.includes('99.0%'),
    m.pareshRow.slice(0, 140));
  check('Level 3 reads Not started rather than a bare dash',
    m.heads.includes('Level 3') && /Not started/.test(m.pareshRow), m.pareshRow.slice(0, 140));

  console.log(`\n[5] ${width}px - the bands are drawn, not just outlined`);
  const bars = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.rb-row')];
    return rows.map((r) => {
      const fill = r.querySelector('.rb-fill');
      // The first TEXT NODE of .rb-count, not its textContent: the share rides along in a
      // nested <small>, so "1" and "25.0%" concatenate to "125.0%" and parse as NaN.
      const cell = r.querySelector('.rb-count');
      const first = cell && [...cell.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
      const count = first ? Number(first.textContent.trim()) || 0 : 0;
      return {
        count,
        fillWidth: fill ? Math.round(fill.getBoundingClientRect().width) : 0,
        display: fill ? getComputedStyle(fill).display : 'none',
      };
    });
  });
  // A <span> with no `display` ignores width and height, so a bar can be styled perfectly and
  // still paint nothing. Every band with a count must have a bar wide enough to see.
  const unpainted = bars.filter((b) => b.count > 0 && b.fillWidth < 3);
  check('every band with a count has a visible bar', unpainted.length === 0,
    unpainted.map((b) => `count ${b.count} -> ${b.fillWidth}px wide, display=${b.display}`).join('; '));
  const painted = bars.filter((b) => b.count === 0 && b.fillWidth > 3);
  check('a band with no count has no bar', painted.length === 0,
    painted.map((b) => `count 0 -> ${b.fillWidth}px`).join('; '));

  console.log(`\n[6] ${width}px - layout`);
  check('the default column set is 12', m.columnCount === 12, `${m.columnCount} columns: ${m.heads.join(' | ')}`);
  check('the table may scroll sideways', /auto|scroll/.test(m.wrapOverflowX || ''), m.wrapOverflowX);
  check('the page may not', m.pageOverflow <= 1, `${m.pageOverflow}px over`);
}

console.log('\n[6] 1440px - the header follows the rows');
await load(1440, 700);
const sticky = await page.evaluate(async () => {
  const table = document.querySelector('table.dt');
  const wrap = table.closest('.table-wrap');
  const th = table.querySelector('thead th');
  if (!wrap || !th) return { ok: false, why: 'no wrap or th' };
  const before = th.getBoundingClientRect().top;
  wrap.scrollTop = Math.max(60, Math.floor(wrap.scrollHeight / 2));
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const after = th.getBoundingClientRect().top;
  const box = wrap.getBoundingClientRect();
  return {
    ok: wrap.scrollTop > 0 && after >= box.top - 1 && after <= box.top + th.getBoundingClientRect().height + 1,
    scrolled: wrap.scrollTop, before: Math.round(before), after: Math.round(after),
    boxTop: Math.round(box.top),
    position: getComputedStyle(th).position,
  };
});
check('thead th is position: sticky', sticky.position === 'sticky', sticky.position);
check('the wrap scrolls vertically, so sticky has a container', sticky.scrolled > 0,
  `scrollTop ${sticky.scrolled} - without is-tall the wrap does not scroll and the header cannot stick`);
check('the header stays at the top of the scrolled table', sticky.ok,
  `th top ${sticky.after} vs wrap top ${sticky.boxTop}`);

console.log('\n[7b] 1440px - pressing a band narrows the report and says so');
await load(1440, 900);
const chips = await page.evaluate(async () => {
  const before = document.querySelectorAll('.pf-chip').length;
  // The "90% and above" band. Pressing it sets p_min_remembered to that band's lower bound.
  const band = [...document.querySelectorAll('.rb-row')][1];
  if (!band) return { ok: false, why: 'no band rows' };
  band.click();
  await new Promise((r) => setTimeout(r, 500));
  const after = [...document.querySelectorAll('.pf-chip')].map((c) => c.textContent.trim());
  const pressed = band.getAttribute('aria-pressed');
  // And pressing it again clears it, so a band is a toggle rather than a one-way narrowing.
  band.click();
  await new Promise((r) => setTimeout(r, 500));
  return {
    ok: before === 0 && after.length === 1,
    before, after, pressed,
    cleared: document.querySelectorAll('.pf-chip').length,
  };
});
check('no chips before any filter is set', chips.before === 0, `${chips.before} chips`);
check('pressing a band adds exactly one chip', chips.ok, `chips now: ${JSON.stringify(chips.after)}`);
check('the chip names the filter it stands for', /Remembered:/.test((chips.after || [])[0] || ''),
  JSON.stringify(chips.after));
check('the band reports itself pressed', chips.pressed === 'true', String(chips.pressed));
check('pressing the band again clears the filter', chips.cleared === 0, `${chips.cleared} chips left`);

await page.setViewport({ width: 1440, height: 900 });
await load(1440, 900);
await page.screenshot({ path: path.join(SHOTS, "progress-1440.png"), fullPage: true });

console.log('\n[7] 390px - the phone gets cards, not a nineteen-column table');
await load(390, 844, true);
const mobile = await measure();
check('the table rendered on a phone', mobile.rendered);
if (mobile.rendered) {
  check('thead is hidden (card layout is active)', mobile.theadDisplay === 'none', mobile.theadDisplay);
  check('the page does not scroll sideways', mobile.pageOverflow <= 1, `${mobile.pageOverflow}px over`);
  const split = mobile.singleWordCells.filter((c) => c.lines > 1);
  check('no word is split on a phone either', split.length === 0,
    split.map((c) => `"${c.text}" on ${c.lines}`).join('; '));
}
/**
 * §36's 44px rule, measured against the thing a thumb actually lands on.
 *
 * A checkbox is 16px by construction in every browser and is not meant to be hit directly:
 * the tap target is the `<label>` wrapping it, which admin.css gives `min-height: var(--tap)`.
 * Measuring the input alone fails a control that is perfectly reachable, so where an input
 * has a label ancestor the label is what gets measured.
 *
 * The skip link is excluded for the same kind of reason: it is parked off-screen until it
 * takes focus, so its resting height is not a target anyone is trying to hit.
 */
const taps = await page.evaluate(() => {
  const small = [];
  for (const el of document.querySelectorAll('button, a, input, select')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    if (el.classList.contains('skip') || el.closest('.sr-only')) continue;
    // An inline link inside a sentence or a table cell is text, not a control - the user
    // name in a row is 20px because that is how tall the line is. §36's floor is about
    // things laid out as controls, so anything still `display: inline` is left to be text.
    if (el.tagName === 'A' && /^inline(-block)?$/.test(cs.display) && !el.classList.contains('btn')) continue;

    const target =
      (el.tagName === 'INPUT' && /^(checkbox|radio)$/.test(el.type) && el.closest('label, .check')) || el;
    const r = target.getBoundingClientRect();
    if (!r.height) continue;
    if (r.height < 43.5) {
      small.push(
        `${target.tagName.toLowerCase()}.${String(target.className || '').split(' ')[0] || '(no class)'}` +
          ` ${Math.round(r.height)}px display=${cs.display} tap=${getComputedStyle(document.documentElement).getPropertyValue('--tap').trim()}` +
          ` text="${(target.textContent || '').trim().slice(0, 24)}"`
      );
    }
  }
  return small;
});
check('every control is at least 44px tall', taps.length === 0, taps.slice(0, 5).join('; '));
await page.screenshot({ path: path.join(SHOTS, 'progress-390.png'), fullPage: false });

await browser.close();
server.close();

console.log('\n  screenshots:');
console.log(`    ${path.join(SHOTS, 'progress-1440.png')}`);
console.log(`    ${path.join(SHOTS, 'progress-390.png')}`);

if (fails.length) {
  console.log('\n  FAILED:');
  for (const f of fails) console.log(`    ${f}`);
}
console.log(`\n  ${pass} passed, ${fails.length} failed\n`);
process.exit(fails.length ? 1 : 0);
