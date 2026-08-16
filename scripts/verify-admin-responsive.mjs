/**
 * ────────────────────────────────────────────────────────────────────────────
 * EVERY PAGE OF THE સંચાલક પેનલ, ON A PHONE (§36) — the check past the gate
 * ────────────────────────────────────────────────────────────────────────────
 *
 *   npm run verify:admin:pages
 *
 * `verify-admin-mobile.mjs` measures eleven widths and says plainly what it cannot reach:
 * "Unauthenticated, so what renders is the login screen or the not-configured gate…
 * Everything past the gate needs a real session and belongs to a test that can hold one."
 * `verify-progress-ui.mjs` is that test for exactly one screen. This is that test for the
 * other twenty-three.
 *
 * So until now the panel's entire authenticated surface — every table, every filter bar,
 * every dialog, twenty-four routes — had never been measured at a phone width by anything
 * but a person looking at it. That is where the faults were, and two of them were still
 * there when this was written:
 *
 *   1. AN EIGHTY-PIXEL DEAD BAND. admin.css turns a table into cards at 900px. Three
 *      feature stylesheets did their card adjustments at 820px while each claimed in a
 *      comment that "the breakpoint matches admin.css's own card breakpoint". Between 821
 *      and 900 it did not: the rows were already cards, but the bookkeeping columns the
 *      phone is supposed to drop were all still painted, and every value line was still
 *      being held open by a desktop column's `min-width`. A tablet in portrait sits in that
 *      band.
 *
 *   2. CARDS WITH NO LABELS. The card layout that was in place at the time got its labels
 *      from `data-label` on each `td`. `Level4Table` and `OverviewStrip` build their rows by
 *      hand rather than through `DataTable`, and neither set the attribute — so on a phone
 *      the લેવલ ૪ price table was five bare values with nothing to say which number was the
 *      first award and which was the repeat.
 *
 *   3. AND THEN THE CARD LAYOUT ITSELF WENT. Eight labelled lines per યુવક is ~230px a row,
 *      so /users on a phone was some 4,600px of scrolling for one page of twenty, and no
 *      column could be read downwards — which is the one thing a list is for. Below 900px a
 *      table is now a dense table that scrolls sideways with its identity column pinned.
 *      That change is what most of the assertions below are now defending, and the one that
 *      matters most is the alignment check: the per-page rules that drop bookkeeping columns
 *      used to hide only the `td`, because the header was gone anyway. With the header back,
 *      a `td` hidden without its `th` puts every column after it under the wrong heading,
 *      silently.
 *
 * Neither is visible to a unit test. Neither is visible to a checker that only ever sees a
 * login form. Both are visible to a ruler, which is what this is.
 *
 * ── What it asserts, at every width, on every route ─────────────────────────
 *
 *   1. NOTHING HANGS OFF THE SCREEN. `body { overflow-x: hidden }` HIDES a sideways page
 *      rather than preventing one, so scrollWidth alone would pass while content sat
 *      off-screen unreachable. Every element is measured against the viewport — except
 *      inside a container that is deliberately scrollable, because a table the સંચાલક may
 *      swipe is a decision, not a fault.
 *   2. TAP TARGETS ≥ 44px below 768px. --tap rises under `pointer: coarse`; this proves it
 *      reached the controls rather than only the variable.
 *   3. INPUTS ≥ 16px on touch. Below that iOS Safari zooms on focus and never zooms back,
 *      which is the "the keyboard broke the layout" bug.
 *   4. NO TEXT BELOW 11.5px, so Gujarati keeps its matras.
 *   5. THE TABLE IS STILL A TABLE, AND IT LINES UP. Every column has a heading, the visible
 *      cells in each row are counted against the visible headers, and exactly one column is
 *      pinned and actually computes `position: sticky`. Written against the *property*
 *      rather than against the pages that were wrong, so a table added tomorrow is covered
 *      the moment it renders.
 *
 * ── How it holds a session without a Supabase project ───────────────────────
 *
 * The same way verify-progress-ui.mjs does, and for the same reasons. `dist/` is served
 * under netlify.toml's own redirect rules, so the ordering that keeps /admin/* off the
 * યુવક shell stays part of what is tested. Every `/rest/v1/` and `/auth/v1/` request is
 * answered from a fixture, and `localStorage` is seeded with a session under the client's
 * real storage key (`varni.auth`) before the app boots.
 *
 * The REAL bundle, the REAL React tree and the REAL stylesheet are what get measured. Only
 * the data is ours.
 *
 * ── On the fixtures being generic ───────────────────────────────────────────
 *
 * One row shape carries the union of every column the services read, and every RPC that has
 * no specific fixture is answered with a page of them. That is deliberate and it is the
 * right trade for a *layout* test: what a column contains does not change how it wraps, but
 * whether a table has rows at all decides whether the card layout is exercised or an empty
 * state is measured instead. A fixture that lied about a column's *meaning* would matter to
 * scripts/test-progress-mapping.mjs, which compares the migration against the service; it
 * does not matter to a ruler.
 *
 * What the script will not do is quietly measure an empty page and report a pass. Every
 * route states what it rendered, and a route that produced no table, no card and no form is
 * reported as UNRENDERED rather than counted.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { PERMISSIONS } from '../shared/domain/permissions.js';

const require_ = createRequire(import.meta.url);
const puppeteer = require_('puppeteer-core');

const ROOT = path.resolve(import.meta.dirname, '..', 'dist');
const SHOTS = path.join(ROOT, 'verify-admin-responsive');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 4193;

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

const UID = '40561a9f-6622-4852-98c0-bfc6cf70284d';

const SESSION = {
  access_token: 'test-token', token_type: 'bearer', expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'test-refresh',
  user: {
    id: UID, aud: 'authenticated', role: 'authenticated',
    email: 'admin@example.invalid', app_metadata: {}, user_metadata: {},
    created_at: '2026-01-01T00:00:00Z',
  },
};

/** The live collection, shaped as admin/src/lib/liveScenes.js resolves it. */
const SCENE_ROWS = Array.from({ length: 108 }, (_, i) => ({
  id: `darshan-${String(i + 1).padStart(3, '0')}`,
  index: i + 1, order: i + 1, active: true, status: 'ACTIVE',
  title: `Darshan ${i + 1}`,
  caption: `varnan ${i + 1}`,
  image_url: `https://example.invalid/${i + 1}.jpg`,
  drive_id: `d${i + 1}`,
  updated_at: '2026-08-01T04:00:00Z',
}));

/**
 * The union of every column the admin services read off a row, in one shape.
 *
 * The long strings are the point of it. A layout test fed "a" in every cell measures a
 * table that no સંચાલક will ever see; the widths that actually break a phone come from a
 * real name beside a real place beside a real timestamp. The Gujarati is here for the same
 * reason - it is taller than Latin at the same font size, and a row height computed without
 * it is not the row height that ships.
 */
const genericRow = (i) => ({
  id: `row-${i}`,
  user_id: UID, uid: UID, actor_id: UID, target_id: `darshan-${String(i + 1).padStart(3, '0')}`,
  session_id: `session-${i}`, source_id: `src-${i}`,

  name: ['Parth Vekariya', 'Kevadiya Paresh', 'Dhruv Ramanuj', 'પાર્થ વેકરીયા'][i % 4],
  user: ['Parth Vekariya', 'Kevadiya Paresh', 'Dhruv Ramanuj', 'પાર્થ વેકરીયા'][i % 4],
  mobile: `98765${String(43210 + i).slice(0, 5)}`,
  smk: `SMK${String(1000 + i)}`,
  city_id: ['surat', 'ahmedabad', 'vadodara'][i % 3],
  zone_id: ['varachha', 'adajan', 'katargam'][i % 3],
  account_status: 'ACTIVE', status: 'ACTIVE', current_stage: 'LEVEL_3', stage: 'LEVEL_3',

  title: `Darshan ${i + 1} - a long enough title to wrap`,
  caption: `varnan ${i + 1}`,
  key: `key_${i}`, kind: ['DAY_FIRST', 'REPEAT', 'TICK', 'REVISION', 'MANUAL'][i % 5],
  award_kind: ['DAY_FIRST', 'REPEAT', 'TICK', 'REVISION', 'MANUAL'][i % 5],
  activity_key: ['revision', 'darshan', 'test'][i % 3],
  reason: 'Manual adjustment after a review of the day',
  source: 'admin', path: '/points/ledger', url: 'https://example.invalid/a/very/long/drive/url',
  drive: `drive-${i}`, source_drive_url: 'https://drive.google.com/file/d/xxxxxxxxxxxx/view',
  content: 'A note recorded against this row', value: {}, size: 1024,

  level_id: (i % 4) + 1, rank: i + 1, attempt_number: (i % 3) + 1,
  points: 10 * (i + 1), points_total: 100 * (i + 1), total_points: 100 * (i + 1),
  total: 108, total_items: 108, total_at_submit: 108, completed_items: i % 108,
  remembered: i % 108, revisions: i % 40, ticks: i % 60, scenes_distinct: i % 108,
  days: i % 30, passed: i % 2 === 0, shown: 108, truncated: false, rows: i + 1,
  attempts_all: i % 12, revision_sessions: i % 9, darshan_sessions: i % 9,
  video_sessions: i % 5, today_revisions: i % 7, today_ticks: i % 11, today_points: i % 50,
  engaged_ms: 1000 * (i + 1),
  remembered_item_ids: [], mastered_item_ids: [], pending_item_ids: [], selected_scene_ids: [],
  totals: {},

  activity_date: '2026-08-14', date: '2026-08-14',
  created_at: '2026-07-01T04:00:00Z', updated_at: '2026-08-14T04:00:00Z',
  submitted_at: '2026-08-14T04:00:00Z', last_at: '2026-08-14T04:00:00Z',
  last_active_at: '2026-08-14T04:00:00Z', registered_at: '2026-07-01T04:00:00Z',
  recorded_at: '2026-08-14T04:00:00Z',

  // The progress report's own columns, so /progress renders a full table rather than a
  // page of dashes.
  total_rows: '90',
  level1_status: 'COMPLETED', level1_attempts: 1,
  level2_status: 'COMPLETED', level2_attempts: 1,
  level3_status: 'IN_PROGRESS', level3_attempts: 3, level3_last_at: '2026-08-14T04:00:00Z',
  remembered_count: i % 108, remembered_l3: i % 50, remembered_l4: i % 20,
  content_total: 108, remembered_pct: (i % 108) / 1.08,
  gate_open: true, level4_total: 4, level4_unlocked: 2, level4_completed: 1,
  level4_passed: 1, level4_revision: 0, level4_attempts: 2, level4_last_at: '2026-08-14T04:00:00Z',

  action: 'SETTINGS_UPDATED', actor_role: 'SUPER_ADMIN', resource_type: 'settings',
  before: {}, after: {}, meta: {},
});

const PAGE_OF_ROWS = Array.from({ length: 20 }, (_, i) => genericRow(i));

/*
  The permission catalogue, imported rather than restated.

  shared/domain/permissions.js carries the keys for exactly this purpose — it is the copy the
  build checks against public.permissions (scripts/test-permission-catalogue.mjs), so a list
  typed here would be a third spelling and the one nothing checks. A SUPER_ADMIN holds every
  permission that exists, so the fixture is the catalogue.
*/
const ALL_PERMISSIONS = [...PERMISSIONS];

/* Enough shape for the catalogue screen to render each row: the resource is the part before
   the first dot, which is how the page groups them. */
const PERMISSION_ROWS = ALL_PERMISSIONS.map((key, i) => {
  const [resource, ...rest] = key.split('.');
  return {
    key,
    resource,
    verb: rest.join('.'),
    label: key,
    description: 'Fixture description.',
    is_section: rest.join('.') === 'read',
    sort: i * 10,
  };
});

/**
 * The answers that are not just "a page of rows".
 *
 * Keyed by the last path segment of the request, which for `/rest/v1/rpc/foo` is `foo` and
 * for `/rest/v1/profiles?select=…` is `profiles`. A name that is not here gets PAGE_OF_ROWS,
 * and every one that does is recorded so the run can report what it actually answered.
 */
const FIXTURES = {
  /*
    What the panel asks on every page load.

    `effective_role` answered this until 0043. The panel now calls `admin_session()`, which
    returns role, label, rank, the resolved permission list and whether the caller is standing
    on the bootstrap allowlist — in the one round trip that was already being made.

    The permission list matters more than the role does now: AdminShell filters NAV on it and
    RequirePermission gates each route on it, so a fixture returning the role alone renders a
    panel with an empty sidebar and every page refused. That is exactly what happened when
    this was left behind — every route came back blank and the run reported "Nothing failed,
    but the routes above rendered nothing", which is the check doing its job.

    It is built from the permission *catalogue* rather than from a list typed here, so a
    permission added by a later migration is covered without this file being touched — and a
    SUPER_ADMIN holding everything is precisely what public.permissions defines.
  */
  admin_session: () => [{
    role: 'SUPER_ADMIN',
    role_label: 'Super Admin',
    rank: 100,
    permissions: ALL_PERMISSIONS,
    is_bootstrap: false,
  }],
  // Kept: src/lib/auth.jsx in the યુવક app still calls it for its cosmetic isAdmin flag, and
  // an unmocked RPC would answer with a page of generic rows.
  effective_role: () => 'SUPER_ADMIN',
  // The four tables behind /access. Empty lists render the empty states rather than nothing,
  // which is a real state and one the layout has to survive.
  permissions: () => PERMISSION_ROWS,
  admin_roles: () => [
    { key: 'SUPER_ADMIN', label: 'Super Admin', description: 'Holds everything.', is_system: true, rank: 100 },
    { key: 'ADMIN', label: 'Admin', description: 'Runs the panel.', is_system: true, rank: 80 },
    { key: 'VIEWER', label: 'Viewer', description: 'Reads.', is_system: true, rank: 10 },
  ],
  role_permissions: () => ALL_PERMISSIONS.map((permission) => ({ role_key: 'SUPER_ADMIN', permission })),
  admin_grants: () => [],
  admin_role_usage: () => [{ role_key: 'SUPER_ADMIN', members: 1, active_members: 1 }],
  admin_effective_permissions: () =>
    ALL_PERMISSIONS.map((permission) => ({ permission, source: 'role', expires_at: null })),
  admins: () => [{
    id: UID, email: 'admin@varni.com', name: 'Parth Vekariya', mobile: '9925842081',
    role: 'SUPER_ADMIN', status: 'ACTIVE', display_name: null,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', created_by: null,
  }],
  scenes: () => SCENE_ROWS,
  profiles: () => [{ id: UID, name: 'Parth Vekariya', status: 'ACTIVE', mobile: '9925842081' }],
  // A key/jsonb table. An empty object means every page falls back to its published
  // defaults, which is a real state and the one that renders the most controls.
  settings: () => [{ key: 'app', value: {} }],
  admin_progress_summary: () => ({
    total: 90, bands: [
      { band: '0', count: 12 }, { band: '1-25', count: 20 },
      { band: '26-50', count: 18 }, { band: '51-75', count: 22 },
      { band: '76-107', count: 14 }, { band: '108', count: 4 },
    ],
  }),
  admin_progress_filter_options: () => ({
    cities: [{ id: 'surat', name: 'Surat' }, { id: 'ahmedabad', name: 'Ahmedabad' }],
    zones: [{ id: 'varachha', name: 'Varachha', city_id: 'surat' }],
  }),
  admin_points_overview: () => ({
    total_points: 12400, total_rows: 890,
    by_level: [{ key: '1', label: 'Level 1', rows: 120, points: 1200 }],
    by_kind: [{ key: 'DAY_FIRST', label: 'First award of the day', rows: 400, points: 8000 }],
  }),
};

// ──────────────────────────────────────────────────────────────── the routes

/**
 * Every route App.jsx declares behind the gate, with a real-looking id where one is needed.
 *
 * `/login` is deliberately absent: verify-admin-mobile.mjs already measures it at eleven
 * widths, and a second checker measuring the same screen is a second thing to keep in step.
 */
const ROUTES = [
  ['/dashboard', 'Dashboard'],
  ['/users', 'Users'],
  [`/users/${UID}`, 'User detail'],
  [`/users/${UID}/activity`, 'User activity'],
  ['/darshan', 'Darshan list'],
  ['/darshan/health', 'Darshan health'],
  ['/darshan/import', 'Darshan import'],
  ['/darshan/darshan-001', 'Darshan detail'],
  ['/progress', 'Progress'],
  [`/progress/${UID}`, 'Progress detail'],
  ['/sessions', 'Sessions'],
  ['/levels', 'Levels'],
  ['/levels/4', 'Level 4 list'],
  ['/levels/4/config/row-0', 'Level 4 editor'],
  ['/video', 'Video'],
  ['/navigation', 'Navigation'],
  // Each tab separately, for the reason given at /access below. It matters more here: five of
  // the six panels are only reachable through the strip, so a lone '/settings' entry would
  // have checked the General card and silently stopped covering the dhun, the Drive folder,
  // the app icon and the leaderboard the day this page grew tabs.
  ['/settings', 'Settings - general'],
  ['/settings?tab=dhun', 'Settings - dhun'],
  ['/settings?tab=darshan', 'Settings - darshan'],
  ['/settings?tab=app', 'Settings - app shell'],
  ['/settings?tab=points', 'Settings - points'],
  ['/settings?tab=more', 'Settings - elsewhere'],
  ['/points', 'Point management'],
  ['/points/ledger', 'Point ledger'],
  ['/points/daily', 'Daily activity'],
  ['/points/records', 'Daily records'],
  ['/points/level3', 'Level 3 report'],
  ['/points/leaderboard', 'Leaderboard'],
  // Each tab separately: they are four different layouts under one route, and the role
  // editor in particular is a two-column grid that has to collapse. A single /access entry
  // would only ever have checked whichever tab happens to be first.
  ['/access?tab=admins', 'Access - administrators'],
  ['/access?tab=roles', 'Access - roles'],
  ['/access?tab=permissions', 'Access - permissions'],
  ['/access?tab=effective', 'Access - effective'],
  ['/audit-logs', 'Audit log'],
];

/**
 * §36's list, narrowed to the widths this check is about, plus the pair that straddles the
 * card breakpoint.
 *
 * 900 and 901 are here because of the dead band in the header: they are one pixel apart and
 * on opposite sides of the rule that turns a table into cards, which is the only way to
 * catch a feature stylesheet whose own breakpoint has drifted away from admin.css's. The
 * wide end (1024 and up) belongs to verify-admin-mobile, which already walks it.
 */
const WIDTHS = [320, 360, 390, 412, 768, 900, 901];

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
  if (ok) { pass += 1; return true; }
  fails.push(`${name}${detail ? `  -  ${detail}` : ''}`);
  return false;
};

const browser = await puppeteer.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const page = await browser.newPage();
page.setDefaultNavigationTimeout(30000);

await page.evaluateOnNewDocument((s) => {
  window.localStorage.setItem('varni.auth', JSON.stringify(s));
}, SESSION);

/**
 * Full CORS on every stub answer, and OPTIONS answered before anything else.
 *
 * Learned in verify-progress-ui and restated because it is not guessable: a cross-origin
 * POST carrying `apikey` and `authorization` is not a simple request, so Chrome sends a
 * preflight and will not deliver the real response unless it is allowed. A stub that
 * answers the POST and not the preflight looks exactly like an unreachable server, and the
 * panel renders "Network problem" - which would then be measured as if it were a page.
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers':
    'authorization,apikey,content-type,prefer,x-client-info,accept,accept-profile,content-profile,range',
  'Access-Control-Expose-Headers': 'content-range,content-profile',
  'Access-Control-Max-Age': '600',
};

const answered = new Map();

await page.setRequestInterception(true);
page.on('request', (r) => {
  const url = r.url();
  const headers = r.headers();

  const send = (body, extra = {}) => r.respond({
    status: 200,
    contentType: 'application/json',
    headers: { ...CORS, 'content-range': '0-19/90', ...extra },
    body: JSON.stringify(body),
  });

  if (r.method() === 'OPTIONS' && /\/(rest|auth)\/v1\//.test(url)) {
    return r.respond({ status: 204, headers: CORS, body: '' });
  }

  if (url.includes('/auth/v1/')) {
    if (url.includes('/user')) return send(SESSION.user);
    return send({ ...SESSION });
  }

  if (url.includes('/rest/v1/')) {
    // `/rest/v1/rpc/admin_daily_activity?x=1` -> `admin_daily_activity`.
    const name = new URL(url).pathname.replace(/^.*\/rest\/v1\/(rpc\/)?/, '').split('/')[0];
    const fixture = FIXTURES[name];
    answered.set(name, (answered.get(name) || 0) + (fixture ? 0 : 1));

    let body = fixture ? fixture() : PAGE_OF_ROWS;

    /*
      PostgREST answers a single object rather than an array when the caller asks for one,
      and supabase-js asks for one on every .single() / .maybeSingle(). Honouring the header
      is what lets one generic fixture serve both shapes - without it a detail page reads
      `.name` off an array, gets undefined, and renders an empty shell that this script
      would then dutifully measure and pass.
    */
    const wantsObject = /vnd\.pgrst\.object\+json/.test(headers.accept || '');
    if (wantsObject && Array.isArray(body)) body = body[0] ?? null;

    return send(body);
  }

  // A Drive thumbnail or a font. Let it fail on its own rather than hanging the page.
  if (/^https?:\/\/(?!localhost)/.test(url)) return r.abort();
  return r.continue();
});

fs.mkdirSync(SHOTS, { recursive: true });

/**
 * The measurements, taken inside the page. Geometry and computed styles only - nothing here
 * asserts that a fixture equals itself.
 */
const measure = () => page.evaluate(() => {
  const vw = document.documentElement.clientWidth;
  const label = (el) => {
    const cls = String(el.className || '').split(' ').filter(Boolean)[0];
    return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}`;
  };

  /*
    A control's two nearest classed ancestors, and its own text.

    An undersized tap target reported as "a 20px" is a fact nobody can act on: there are
    forty links on some of these pages and the fix is a CSS selector, so the report has to
    say enough to write one. This is the difference between "some link is too short" and
    "the links inside .breadcrumb are too short", which is the actual finding.
  */
  const where = (el) => {
    const chain = [];
    for (let p = el.parentElement; p && p !== document.body && chain.length < 2; p = p.parentElement) {
      const cls = String(p.className || '').split(' ').filter(Boolean)[0];
      if (cls) chain.push('.' + cls);
    }
    const text = el.textContent.trim().slice(0, 18);
    return `${label(el)}${text ? `["${text}"]` : ''} in ${chain.join(' < ') || '(unclassed)'}`;
  };

  /*
    A box inside something the સંચાલક may deliberately swipe is not hanging off the screen.
    `.table-wrap` sets `overflow-x: auto` on purpose, and a wide table inside it is a
    decision the panel already made and documented. What must never happen is the PAGE
    moving, and that is measured separately below.
  */
  const scrollable = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX;
      if (ox === 'auto' || ox === 'scroll') return true;
    }
    return false;
  };

  /*
    Parked entirely off the leading edge on purpose, and both are load-bearing patterns
    rather than faults: `.skip` lives at left:-9999px until it takes focus (§56), and the
    sidebar is translated fully off-canvas until the drawer opens (§11). Neither is
    reachable, neither is painted, and neither can push the page - `transform` does not
    affect layout, which is why the drawer is moved with one.

    Only the LEADING side is forgiven. An element parked off the trailing edge is content
    that scrolled away from the viewport and cannot be got back, which is the fault this
    check exists for.
  */
  const parkedOffLeadingEdge = (r) => r.right <= 0;

  const over = [], small = [], tiny = [], culprits = [];
  const inputFs = [];

  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if (parkedOffLeadingEdge(r)) continue;

    if (!scrollable(el) && (r.left < -1 || r.right > vw + 1)) {
      over.push(`${label(el)} ${Math.round(r.left)}..${Math.round(r.right)} of ${vw}`);
    }

    /*
      What is actually making the PAGE wide, scroll container or not. `over` deliberately
      forgives a box inside something swipeable; this list forgives nothing, and it is only
      reported when the document really did grow - so it names the culprit instead of
      leaving "6px over" to be found by hand.
    */
    if (r.right > vw + 1 && !el.querySelector('*')) {
      culprits.push(`${label(el)} to ${Math.round(r.right)}`);
    }

    const fs_ = parseFloat(cs.fontSize);
    if (!el.children.length && el.textContent.trim() && fs_ < 11.4) {
      small.push(`${label(el)} ${fs_}px`);
    }

    /*
      A checkbox is 16px square in every browser and is not meant to be hit on its own: the
      target is the <label> wrapping it, which `.check` already gives a tap-tall row. Measure
      that instead, and only fail when there is no label to measure - which is the real
      version of this fault (a bare checkbox with its name somewhere else on the line).
    */
    const isBox = el.tagName === 'INPUT' && /checkbox|radio/.test(el.type);
    if (isBox) {
      const lab = el.closest('label');
      const h = lab ? lab.getBoundingClientRect().height : r.height;
      if (h < 43.5) tiny.push(`${where(lab || el)} ${Math.round(h)}px`);
      continue;
    }

    /*
      A link inside a sentence is exempt, and this is the standard's own exemption rather
      than one invented here to make a red check go green: WCAG 2.5.8 excludes a target that
      is "in a sentence or block of text", because the alternative is spacing out running
      prose until the paragraph stops reading as a paragraph. Every `.card-note` in this
      panel would have grown line gaps around the words that happen to be links.

      Detected structurally, not by class: a link whose parent holds text of its own besides
      the link IS in a sentence. A link alone in its parent is a destination on its own and
      owes the floor — which is the rule `.breadcrumb a` and `.dt td > a` now satisfy.
    */
    const inSentence = el.tagName === 'A'
      && [...(el.parentElement?.childNodes || [])]
        .some((n) => n.nodeType === 3 && n.textContent.trim());

    if (/^(BUTTON|A|INPUT|SELECT|SUMMARY)$/.test(el.tagName) && r.height < 43.5 && !inSentence) {
      tiny.push(`${where(el)} ${Math.round(r.height)}px`);
    }
    if (el.tagName === 'INPUT' && el.type !== 'hidden') inputFs.push(fs_);
  }

  /*
    The scrolling-table contract, which replaced the card stack.

    Three properties, and the second is the one that will actually break.

      1. THE HEADER IS THERE. Below the breakpoint the table is still a table, so `thead`
         must be visible - it is now the only thing naming a column. A hidden `thead` here
         means a stylesheet somewhere is still doing the card transform.

      2. THE COLUMNS LINE UP. Every page drops bookkeeping columns on a phone, and those
         rules used to hide only the `td` because the header was gone anyway. With the
         header back, a `td` hidden without its `th` shifts every column after it under the
         wrong heading - a name sitting under "Mobile", silently, with nothing on screen to
         say so. Counting visible cells against visible headers is the only way to see it,
         and it is the single most valuable assertion in this file.

      3. EXACTLY ONE COLUMN IS PINNED, AND IT IS ACTUALLY STICKY. Zero means a swipe loses
         whose row it is, which is the objection the card layout existed to answer and the
         one thing the replacement has to get right. More than one means two columns are
         fighting for the same edge.
  */
  const theadEl = document.querySelector('table.dt thead');
  const cards = theadEl ? getComputedStyle(theadEl).display === 'none' : false;

  const visible = (el) => getComputedStyle(el).display !== 'none';
  const misaligned = [];
  let pins = null, pinSticky = null, unnamedCols = 0;

  const table = document.querySelector('table.dt');
  if (table && theadEl) {
    const heads = [...theadEl.querySelectorAll('th')].filter(visible);
    unnamedCols = heads.filter((th) => !th.textContent.trim()).length;

    for (const tr of table.querySelectorAll('tbody tr')) {
      /*
        Summed by `colSpan`, not counted. A full-width empty state is one `td colSpan={4}`
        and that is the correct markup for it — counting cells would report "1 cell under 4
        headers" and call a properly built empty row a misalignment, which would train
        somebody to ignore this assertion. Spanned width is what has to match; how many
        elements it took is not the question.
      */
      const width = [...tr.querySelectorAll('td')]
        .filter(visible)
        .reduce((n, td) => n + (td.colSpan || 1), 0);
      if (width !== heads.length) {
        misaligned.push(`${width} columns of cells under ${heads.length} headers`);
      }
    }

    const pinned = [...table.querySelectorAll('thead th.is-pin')];
    pins = pinned.length;
    pinSticky = pinned.length ? getComputedStyle(pinned[0]).position === 'sticky' : null;
  }

  const dedupe = (a) => [...new Set(a)];
  return {
    // What actually rendered. A route that produced none of these is reported, never passed.
    rendered: !!document.querySelector('.content .card, .content table.dt, .content form, .content .page-head'),
    hasTable: !!document.querySelector('table.dt'),
    theadHidden: cards,
    misaligned: dedupe(misaligned).slice(0, 3),
    pins, pinSticky, unnamedCols,
    pageOverflow: document.documentElement.scrollWidth - vw,
    culprits: dedupe(culprits).slice(0, 5),
    over: dedupe(over).slice(0, 5),
    small: dedupe(small).slice(0, 5),
    tiny: dedupe(tiny).slice(0, 5),
    inputFs,
  };
});

// ──────────────────────────────────────────────────────────────── the run

console.log('\n  સંચાલક પેનલ — every route, every phone width\n');

const unrendered = [];

for (const [route, name] of ROUTES) {
  const before = fails.length;
  let firstShot = true;

  for (const width of WIDTHS) {
    const touch = width < 768;
    await page.setViewport({ width, height: 900, isMobile: touch, hasTouch: touch });

    // Navigate fresh per width rather than resizing an already-rendered page: several
    // pages read the viewport once on mount (the column picker, the filter bar's
    // open/closed default), so a resized page is not the page a phone would have loaded.
    await page.goto(`http://localhost:${PORT}/admin${route}`, { waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 700));

    const m = await measure();

    if (!m.rendered) {
      unrendered.push(`${name} (${route}) at ${width}px`);
      continue;
    }

    const at = `${name} @${width}`;
    check(`${at} the page does not scroll sideways`, m.pageOverflow <= 1,
      `${m.pageOverflow}px over - ${m.culprits.join(', ') || 'no single element names itself'}`);
    check(`${at} nothing hangs off the edge`, m.over.length === 0, m.over.join(', '));
    check(`${at} no text below 11.5px`, m.small.length === 0, m.small.join(', '));

    if (touch) {
      check(`${at} tap targets >= 44px`, m.tiny.length === 0, m.tiny.join(', '));
      check(`${at} inputs >= 16px`, m.inputFs.every((f) => f >= 16),
        [...new Set(m.inputFs)].join(', '));
    }

    if (m.hasTable) {
      check(`${at} the table is still a table`, !m.theadHidden, 'thead is hidden');
      check(`${at} every column has a heading`, m.unnamedCols === 0, `${m.unnamedCols} blank th`);
      check(`${at} cells line up with their headers`, m.misaligned.length === 0,
        `${m.misaligned.join('; ')} - a column is hidden without its th`);

      // Only below the breakpoint: above it the whole table fits and nothing is swiped, so a
      // pinned column would be a shadow down the middle of a table for no reason.
      if (width <= 900) {
        check(`${at} exactly one column is pinned`, m.pins === 1, `${m.pins} pinned`);
        check(`${at} the pinned column is sticky`, m.pinSticky === true, String(m.pinSticky));
      }
    }

    // One screenshot per route, at the narrowest width, so a failure can be looked at.
    if (firstShot) {
      /*
        Every character Windows forbids in a filename, not just the slash.

        `?` arrived with the /access routes, which name a tab in the query string — and it is
        illegal in an NTFS filename, so the screenshot threw ENOENT mid-run and took the whole
        verification with it after twenty routes had already passed. The others in the class
        are here too rather than waiting to be discovered one at a time by a future route.
      */
      const file = route.replace(/[\/?<>:*|"\\]/g, '_');
      await page.screenshot({ path: path.join(SHOTS, `${file}.png`), fullPage: true });
      firstShot = false;
    }
  }

  const ok = fails.length === before;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}  (${route})`);
}

await browser.close();
server.close();

// ──────────────────────────────────────────────────────────────── the report

console.log(`\n  ${ROUTES.length} routes x ${WIDTHS.length} widths - ${pass} passed, ${fails.length} failed`);

if (unrendered.length) {
  console.log(`\n  UNRENDERED - measured nothing, so proved nothing (${unrendered.length}):`);
  console.log(unrendered.slice(0, 20).map((u) => `    ${u}`).join('\n'));
}

const generic = [...answered.entries()].filter(([, n]) => n > 0).map(([k]) => k);
if (generic.length) {
  console.log(`\n  answered from the generic row shape: ${generic.sort().join(', ')}`);
}

if (fails.length) {
  console.log('\n' + fails.map((f) => `  FAIL  ${f}`).join('\n'));
  console.log(`\n  screenshots: ${SHOTS}\n`);
  process.exit(1);
}
if (unrendered.length) {
  console.log('\n  Nothing failed, but the routes above rendered nothing. A skip is not a pass.\n');
  process.exit(1);
}
console.log(`\n  OK  320 -> 901px, every route past the gate\n  screenshots: ${SHOTS}\n`);
