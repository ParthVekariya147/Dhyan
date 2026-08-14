/**
 * The સંચાલક progress report's field mapping, checked against the function that feeds it —
 * `node scripts/test-progress-mapping.mjs`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * What this protects, and what it costs to get wrong
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `admin_progress_report()` returns thirty-one columns and `progressService.js` renames every
 * one of them into camelCase for the page. That mapping is pure clerical work, which is
 * exactly the kind that rots: a column renamed in a migration, or added and not picked up,
 * produces `undefined` in the service, and `undefined` reaches the table as `int(undefined)`
 * — which is **0**. Not a blank, not a dash, not an error. A zero, in a column of real
 * numbers, about a named person.
 *
 * That is not hypothetical. When 0030 renamed the summary's `totalContent` to `contentTotal`
 * the panel went on reading the old spelling and rendered the denominator as nothing at all,
 * and the only reason it was caught is that a test asserted the literal. Nothing asserted the
 * *shape*.
 *
 * So this suite reads both sides and compares them:
 *
 *   * every column in the migration's `returns table (...)` must be read by the mapper
 *   * every `r.<something>` the mapper reads must be a column the function returns
 *   * every key the summary/detail/verify documents build must be read where it is consumed
 *
 * It is static analysis over the real files rather than a runtime test, deliberately. A
 * runtime test would need a Postgres and a stubbed Supabase client, and it would still only
 * cover the fields the fixture happened to set. Reading the declarations covers all of them,
 * runs in milliseconds, and fails the moment the two sides drift — which is the only failure
 * mode this class of bug has.
 *
 * What it deliberately does NOT check: whether a number is *correct*. That is
 * `scripts/test-admin-progress.mjs` against a real Postgres, and the reconciliation against
 * production. This only proves the wire is connected at both ends.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0;
let fail = 0;

const group = (name) => console.log(`\n  ${name}\n`);

function eq(name, got, want) {
  if (JSON.stringify(got) === JSON.stringify(want)) {
    pass += 1;
    return;
  }
  fail += 1;
  console.log(`  ✗ ${name}`);
  console.log(`      got  ${JSON.stringify(got)}`);
  console.log(`      want ${JSON.stringify(want)}`);
}

function ok(name, cond, detail = '') {
  if (cond) {
    pass += 1;
    return;
  }
  fail += 1;
  console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`);
}

/** snake_case -> camelCase, the rename the mapper performs by hand. */
const camel = (s) => s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());

// ──────────────────────────────────────────────────────────────── the two sides

const MIGRATION = 'supabase/migrations/0030_admin_progress_live_scenes.sql';
/**
 * The five columns §19 asks for do not come from `admin_progress_report()`.
 *
 * `admin_activity_counts()` (0032) carries Darshan sessions, revision sessions, ticks, the
 * all-level attempt count and the leaderboard rank, keyed on the page of ids the report just
 * returned — four counts over other tables and a window function over the whole ledger, none
 * of which belongs in the report's own SELECT. The service therefore has two mappers and two
 * read surfaces, and this suite has to know about both or §C reports every field of the second
 * one as invented.
 */
const COUNTS_MIGRATION = 'supabase/migrations/0032_admin_points_reporting.sql';
const SERVICE = 'admin/src/features/progress/services/progressService.js';
const DETAIL = 'admin/src/features/progress/services/detailService.js';

const sql = read(MIGRATION);
const countsSql = read(COUNTS_MIGRATION);
const service = read(SERVICE);

/**
 * The column list from `create ... admin_progress_report(...) returns table ( ... )`.
 *
 * Anchored on the migration that most recently defines the function, so this follows a
 * redefinition rather than reading a stale copy.
 */
function reportColumns(source, fn = 'admin_progress_report') {
  const start = source.indexOf(`create or replace function public.${fn}(`);
  if (start === -1) return null;
  const rt = source.indexOf('returns table (', start);
  if (rt === -1) return null;
  const open = rt + 'returns table ('.length;

  // Walk to the matching close paren so a `numeric(10,2)` inside cannot end the block early.
  let depth = 1;
  let i = open;
  while (i < source.length && depth > 0) {
    if (source[i] === '(') depth += 1;
    else if (source[i] === ')') depth -= 1;
    i += 1;
  }
  const body = source.slice(open, i - 1);

  return body
    .split('\n')
    .map((line) => line.replace(/--.*$/, '').trim())
    .filter(Boolean)
    .map((line) => line.replace(/,$/, '').trim().split(/\s+/)[0])
    .filter((n) => /^[a-z][a-z0-9_]*$/.test(n));
}

const COLUMNS = reportColumns(sql);
const COUNTS_COLUMNS = reportColumns(countsSql, 'admin_activity_counts');

/**
 * The counts columns the service deliberately does NOT map, and why each is dropped.
 *
 * `points_total` because the report already carries a `points_total` of its own and that is the
 * one the table sorts on; two columns called points on one row, cut over different windows, is
 * a cell a સંચાલક cannot read. `video_sessions`, `exam_attempts` and `exam_passed` because
 * `level1Attempts`, `level4Attempts` and `level4Passed` already say those things — a second
 * spelling of a column that exists is how two cells come to disagree.
 *
 * Listed rather than ignored, so that dropping a *sixth* column has to be a decision somebody
 * writes down here instead of an omission this suite cannot see.
 */
const COUNTS_NOT_MAPPED = new Set(['points_total', 'video_sessions', 'exam_attempts', 'exam_passed']);

group('§A  the report function still declares the shape this suite reads');

ok('admin_progress_report has a returns-table block', Array.isArray(COLUMNS) && COLUMNS.length > 0,
  `parsed ${COLUMNS ? COLUMNS.length : 'nothing'} from ${MIGRATION}`);

// A canary. If this drops sharply, the parser broke rather than the code.
ok('it declares at least 25 columns', (COLUMNS || []).length >= 25, `parsed ${(COLUMNS || []).length}`);

for (const required of [
  'total_rows', 'user_id', 'name', 'smk', 'city_id', 'zone_id', 'account_status',
  'remembered_count', 'content_total', 'remembered_pct',
  'level1_status', 'level2_status', 'level3_status',
  'level4_passed', 'level4_attempts', 'level4_total', 'last_active_at',
]) {
  ok(`it declares ${required}`, (COLUMNS || []).includes(required));
}

group('§B  the service reads every column the function returns');

/**
 * Every `r.<field>` the mapper dereferences. The mapper is the only place in the service that
 * touches a raw row, so this is the whole of the read surface.
 */
const readFields = new Set([...service.matchAll(/\br\.([a-z][a-z0-9_]*)/g)].map((m) => m[1]));

ok('the mapper dereferences a row at all', readFields.size > 0,
  `found ${readFields.size} r.<field> references in ${SERVICE}`);

// `total_rows` is read off the envelope rather than the mapped row, so it is allowed to be
// absent from the mapper. Everything else must be picked up.
const ENVELOPE_ONLY = new Set(['total_rows']);

const missed = (COLUMNS || []).filter((c) => !ENVELOPE_ONLY.has(c) && !readFields.has(c));
eq('no column the function returns is dropped by the mapper', missed, []);

// The same rule for the second function, minus the four it is documented as dropping. `user_id`
// is read to key the Map rather than mapped onto a row, which still counts as being read.
ok('admin_activity_counts has a returns-table block',
  Array.isArray(COUNTS_COLUMNS) && COUNTS_COLUMNS.length > 0,
  `parsed ${COUNTS_COLUMNS ? COUNTS_COLUMNS.length : 'nothing'} from ${COUNTS_MIGRATION}`);

for (const required of ['darshan_sessions', 'revision_sessions', 'ticks', 'attempts_all', 'rank']) {
  ok(`admin_activity_counts declares ${required}`, (COUNTS_COLUMNS || []).includes(required),
    'the five columns admin_progress_report() does not carry (§19)');
}

const missedCounts = (COUNTS_COLUMNS || []).filter(
  (c) => !COUNTS_NOT_MAPPED.has(c) && !readFields.has(c)
);
eq('no counts column is dropped by the counts mapper without a reason', missedCounts, []);

ok('total_rows is read somewhere in the service', /total_rows/.test(service),
  'the pager needs the full filtered count; without it the page cannot say "of 487"');

group('§C  the service reads nothing the function does not return');

/**
 * Read against BOTH functions' declared columns.
 *
 * The point of this check is that the service never dereferences a column no RPC returns — a
 * misspelling that yields `undefined` and prints as an empty cell rather than as an error. It is
 * not a claim about which of the two functions a field came from, so the union is the right
 * surface: a field belonging to neither is still caught, which is the failure being hunted.
 */
const declared = new Set([...(COLUMNS || []), ...(COUNTS_COLUMNS || [])]);
const invented = [...readFields].filter((f) => !declared.has(f));
eq('the mapper reads no field either function returns', invented, []);

group('§D  the camelCase names the page consumes are the ones the mapper emits');

/**
 * For every column, the mapper must emit *some* key. We do not insist on `camel(column)` —
 * two names are inverted on purpose (`city_id` carries `profiles.zone_id`) and `uid` is
 * shorter than `userId` by house convention — but the value must be assigned from the right
 * source. So: assert the emitted key appears on the same line as the field it reads.
 */
const mapperStart = service.indexOf('const fromReportRow');
ok('fromReportRow exists', mapperStart !== -1);

if (mapperStart !== -1) {
  const mapperBody = service.slice(mapperStart, service.indexOf('\n});', mapperStart));
  const pairs = [...mapperBody.matchAll(/^\s*([A-Za-z][A-Za-z0-9]*)\s*:\s*(.+)$/gm)]
    .map((m) => [m[1], m[2]]);

  ok('the mapper emits at least 25 keys', pairs.length >= 25, `emitted ${pairs.length}`);

  // Each of these is a figure a human reads as a number about a person. If the right-hand
  // side does not mention the matching column, the cell is showing something else's value.
  const CRITICAL = {
    remembered: 'remembered_count',
    contentTotal: 'content_total',
    rememberedPct: 'remembered_pct',
    level4Passed: 'level4_passed',
    level4Attempts: 'level4_attempts',
    level4Total: 'level4_total',
    cityId: 'city_id',
    zoneId: 'zone_id',
    smk: 'smk',
    level1Status: 'level1_status',
    level2Status: 'level2_status',
    level3Status: 'level3_status',
  };

  for (const [key, column] of Object.entries(CRITICAL)) {
    const row = pairs.find(([k]) => k === key);
    ok(`${key} is emitted`, Boolean(row), `no \`${key}:\` in fromReportRow`);
    if (row) {
      ok(`${key} is read from r.${column}`, row[1].includes(`r.${column}`),
        `${key} is assigned from: ${row[1].trim()}`);
    }
  }
}

group('§E  a missing value never becomes a misleading zero');

/**
 * The rule the brief states and the one this mapping is most likely to break: `0`, "no
 * record" and "not started" are three different answers and only one of them is a number.
 *
 * `int()` turning null into 0 is correct for a *count* the function coalesces — it always
 * sends a number, so a null there would mean the column vanished, which §B already catches.
 * It is wrong for a **percentage**, which is null when there is no denominator to divide by,
 * and for a **timestamp**, which is null when nothing has happened yet. Those must survive
 * as null so the cell can render a dash instead of `0.0%` or 1 Jan 1970.
 */
ok('the service has an int() guard', /const int\s*=/.test(service));
ok('and a null-preserving number guard for the percentage',
  /numOrNull/.test(service),
  'remembered_pct must stay null when content_total is 0, not become 0.0%');

if (mapperStart !== -1) {
  const mapperBody = service.slice(mapperStart, service.indexOf('\n});', mapperStart));
  const line = (key) => (mapperBody.match(new RegExp(`^\\s*${key}\\s*:\\s*(.+)$`, 'm')) || [])[1] || '';

  ok('rememberedPct is not passed through int()', !/\bint\(/.test(line('rememberedPct')),
    `rememberedPct: ${line('rememberedPct').trim()}`);

  for (const stamp of ['registeredAt', 'lastActiveAt', 'level4LastAt', 'level3LastAt']) {
    const src = line(stamp);
    ok(`${stamp} keeps null rather than becoming a number`,
      src === '' || !/\bint\(/.test(src),
      `${stamp}: ${src.trim()}`);
  }
}

group('§F  the summary and detail documents agree with their consumers');

/**
 * 0030 renamed the summary's `totalContent` to `contentTotal`. Both spellings existing at
 * once is exactly how a page comes to read a key nothing sets, so pin the current one and
 * assert the document's own keys are the ones the services look for.
 */
const summaryKeys = [
  'contentTotal', 'contentSource', 'level4Total', 'totalUsers', 'activeToday',
  'level1Completed', 'level2Completed', 'level3Completed', 'level4GateOpen',
  'level4AnyPassed', 'fullyRemembered', 'participants', 'buckets',
];
for (const key of summaryKeys) {
  ok(`admin_progress_summary builds '${key}'`, sql.includes(`'${key}'`),
    `not found in ${MIGRATION}`);
}

ok("the service reads contentTotal from the summary", /contentTotal/.test(service));

if (fs.existsSync(path.join(ROOT, DETAIL))) {
  const detail = read(DETAIL);
  for (const key of ['contentTotal', 'sceneDetail', 'rememberedFromLevel3', 'level4']) {
    ok(`the detail service reads '${key}'`, detail.includes(key), `not found in ${DETAIL}`);
  }
  for (const key of ['submitted', 'counted', 'withheldIds', 'missingIds', 'unknownIds']) {
    ok(`admin_verify_user_progress builds '${key}'`, sql.includes(`'${key}'`));
  }
}

group('§G  no literal total anywhere in the reporting UI');

/**
 * §62. The collection was 100, then 109, and is 108 today; every one of those numbers has
 * been typed into this project at some point and every one of them went stale. The same rule
 * the લેવલ ૪ and points suites enforce, extended to the files this report is built from.
 */
for (const file of [SERVICE, DETAIL, 'admin/src/features/progress/pages/ProgressPage.jsx',
  'admin/src/features/progress/pages/UserProgressDetailPage.jsx', 'admin/src/lib/liveScenes.js']) {
  if (!fs.existsSync(path.join(ROOT, file))) continue;
  // Comments are allowed to name the number when they are explaining history.
  const code = read(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  ok(`${file} holds no literal 108/109`, !/\b(108|109)\b/.test(code),
    (code.match(/.*\b(108|109)\b.*/) || [])[0]);
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
