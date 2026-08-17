/**
 * The સંચાલક's progress report, against a real Postgres — `node scripts/test-admin-progress.mjs`.
 *
 * 0029_admin_progress_report.sql adds three admin-gated reporting functions over the tables
 * લેવલ ૧–૪ actually write. Every number they return is an aggregate computed in SQL, and an
 * aggregate is the one kind of code that fails silently: a report that counts a union as a sum,
 * or fans a user out across his own attempts, does not raise, does not warn, and does not look
 * wrong on a screen. It just tells the સંચાલક something untrue about a યુવક.
 *
 * So this suite does not mock anything. It applies supabase/migrations to a disposable
 * postgres:16 (scripts/lib/pgtest.mjs), seeds a population whose every figure was worked out on
 * paper first, and then asserts that the functions return exactly those figures. The arithmetic
 * is written into each test name or the comment above it, so a reader can check the expectation
 * without running anything — which is the only way an "expected 60" is worth more than the
 * function that produced it.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * What each group is protecting, and what it costs to get wrong
 * ────────────────────────────────────────────────────────────────────────────
 *
 *  §A  **"remembered" is a distinct union, not a sum.** Three લેવલ ૩ submissions of 30, 21 and
 *      26 દ્રશ્યો that overlap are 60 દ્રશ્યો remembered, not 77. A sum would tell a યુવક who
 *      revised the same forty images three times that he has recalled the whole collection.
 *
 *  §B  **"remembered" is never `progress.level3_score`.** That column is upserted straight from
 *      the browser and in production one profile carries 110 against a collection of 108. The
 *      report must read the scene ids on the attempts, which only `activity_submit()` can
 *      write. This is the entire design decision of 0029 and it is asserted head-on.
 *
 *  §C  **Levels ૧ and ૨ contribute nothing to it.** Neither records દ્રશ્યો — watching the
 *      વિડિયો is not a per-દ્રશ્ય act. The fixture is deliberately adversarial: its લેવલ ૧ and
 *      ૨ rows *do* carry scene ids, and the report must still return zero, because the filter
 *      is `level_id = 3` and not "whatever the column happens to hold".
 *
 *  §D  **`level4_passed` counts કસોટીઓ, not attempts.** A યુવક who passed ૪.૧ three times has
 *      passed one કસોટી. §41's history keeps all three rows, and a `count(*)` over them would
 *      report a યુવક as three times further along than he is.
 *
 *  §E  **The લેવલ ૪ status columns are not counts of `level4_activity_progress.status`.** They
 *      come from `level4_activity_states()`, which carries the ક્રમ rule and the coverage
 *      credit that stops a republished configuration restarting everybody. The fixture has a
 *      કસોટી (૪.૬) whose દ્રશ્યો repeat ૪.૧'s exactly, so a યુવક with **one** explicit
 *      COMPLETED row must be reported as having completed **two** — and a report that
 *      disagreed with the યુવક's own screen about who finished what is worse than no report.
 *
 *  §F  **Filters mean what they say**, alone and in combination. A filter that silently widens
 *      is how "who has passed at least two કસોટીઓ" comes back with people who have passed none.
 *
 *  §G  **`total_rows` is the filtered total and not the page size.** It is what the pager prints
 *      as "of ૨૨૭". If it ever equalled the page size the panel would say "1 of 20" forever.
 *
 *  §H  **Pagination covers the set exactly once**, and `p_page_size` is capped at 200 — asserted
 *      against 220 rows, because a cap cannot be observed on a set smaller than the cap.
 *
 *  §I  **Ordering is total.** ORDERING.md §8: without the final tiebreak on `id`, two rows with
 *      the same `remembered` can swap between one page request and the next, and the same યુવક
 *      appears on page 1 and page 2 while somebody else appears on neither.
 *
 *  §J  **An empty result is an empty result.** A filter nobody matches returns zero rows and
 *      does not raise — a report that errored on "nobody has passed twenty" would be read as
 *      broken rather than as answered.
 *
 *  §K  **The detail document agrees with the report row.** This is the acceptance criterion the
 *      whole task turns on: the સંચાલક clicks a row and opens a page, and if the two disagree
 *      about how much a યુવક has remembered then one of them is lying and there is no way to
 *      tell which. The કસોટી list is also asserted to be as long as the configuration is, not
 *      four, and its statuses to use the exact vocabulary `level4_activity_states()` returns.
 *
 *  §L  **The summary agrees with the fixtures**, and its bins account for every participant.
 *      A bucket set that does not sum to the number of યુવકો with remembered > 0 has lost
 *      somebody between two edges.
 *
 * Security — who may call these at all — is asserted in scripts/test-rls.mjs §L, beside every
 * other refusal in this project. It belongs there and not here.
 */
import { asUser, attempt, dockerAvailable, startDatabase } from './lib/pgtest.mjs';

let pass = 0;
const fails = [];

const eq = (name, got, want) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) pass++;
  else fails.push(`${name}\n       got  ${g}\n       want ${w}`);
};

/**
 * The statement ran and returned nothing.
 *
 * Distinct from a refusal, and the distinction is the point of §J: `admin_progress_report`
 * raises 42501 when the caller may not ask, and returns zero rows when nobody matched. A test
 * that accepted either would pass on a database where the guard had been deleted.
 */
const noRows = (name, res) => {
  if (res.ok && res.rows.length === 0) pass++;
  else if (!res.ok) fails.push(`${name}\n       got  refused (${res.code})\n       want 0 rows`);
  else fails.push(`${name}\n       got  ${res.rows.length} row(s)\n       want 0 rows`);
};

const group = (name) => console.log(`\n  ${name}`);

// bigint comes back from node-postgres as a string, because it does not fit a JS number in
// general. `total_rows` and `points_total` are the two columns this affects, and comparing
// '227' against 227 would fail for a reason that has nothing to do with the report.
const num = (v) => (v === null || v === undefined ? null : Number(v));

// ════════════════════════════════════════════════════════════════════ the population
//
// Every id below is a fact this suite asserts against, so they are literals rather than
// generated: a fixture that computes its own expectations proves only that it agrees with
// itself.

const U = {
  alpha: 'a1111111-1111-4111-8111-111111111111',
  beta: 'b2222222-2222-4222-8222-222222222222',
  gamma: 'c3333333-3333-4333-8333-333333333333',
  delta: 'd4444444-4444-4444-8444-444444444444',
  inflated: 'e5555555-5555-4555-8555-555555555555',
  zero: 'f6666666-6666-4666-8666-666666666666',
  // The caller. Holds ADMIN, so `progress.read` and `users.read` both — see 0004's
  // permissions_for(). He is an ordinary profile as well, and therefore appears in his own
  // report, which is why the expected population is 227 and not 226.
  reader: '07777777-7777-4777-8777-777777777777',
};

/** 220 more profiles with no activity at all, so that §H can observe a cap of 200. */
const BULK = 220;
const PEOPLE = 7 + BULK; // 227

const ACT = {};

const SCENE = (n) => `darshan-${String(n).padStart(3, '0')}`;
/** The દ્રશ્યો numbered `a` through `b` inclusive — how a યુવક's submission is written here. */
const RANGE = (a, b) => {
  const out = [];
  for (let i = a; i <= b; i++) out.push(SCENE(i));
  return out;
};

// The લેવલ ૪ configuration, as items. ૪.૬ repeats ૪.૧ exactly and that is deliberate: it is
// what a republished configuration looks like from a યુવક's side, and it is the only way to
// exercise the coverage credit in level4_completed_activity_ids() (0010:372) — the rule that
// says a કસોટી whose દ્રશ્યો you have already covered is done, whether or not you sat it.
const L4 = [
  ['4.1', 1, [SCENE(1), SCENE(2)]],
  ['4.2', 2, [SCENE(3), SCENE(4)]],
  ['4.3', 3, [SCENE(5), SCENE(6)]],
  ['4.4', 4, [SCENE(7), SCENE(8)]],
  ['4.5', 5, [SCENE(9), SCENE(10)]],
  ['4.6', 6, [SCENE(1), SCENE(2)]],
];
const L4_TOTAL = L4.length; // 6

async function fixtures(db) {
  // Everything here runs as the owner, which is what a migration or the seed script is. RLS
  // does not apply and no permission is checked, but every trigger still fires.
  //
  // The attempt rows are inserted directly rather than through activity_submit() and
  // level4_submit(), and that is a deliberate trade. Those functions write `now()` — they have
  // to, the business date is the server's and never the caller's (§4, §30) — so a suite built
  // on them could not place a submission on a day three weeks ago, and the date window in §F
  // would be untestable. What is lost is nothing this file claims: the shape of the rows is
  // taken from the two writers verbatim, and scripts/test-rls.mjs §D already asserts that no
  // client role can reach either table this way.

  /*
    નવસારી is reopened before anybody is put in it.

    0050 turned the three hardcoded zones into rows and seeded નવસારી as RETIRED, because no
    યુવક is in it and the ask was for the other two. `profiles_guard_geography()` then refuses a
    new profile there - "The zone નવસારી is closed - choose an open one" - which is exactly the
    rule working, and it is what this fixture met.

    Reopened rather than swapped for વરાછા: this suite needs three distinct zones for its
    filter assertions, and a third open zone is now a row rather than a constant. This is the
    same act the panel offers a સંચાલક, performed as the owner in a throwaway container.
  */
  await db.query(`update public.zones set status = 'ACTIVE' where id = 'navsari'`);

  const people = [
    [U.alpha, 'ALP101', 'Alpha Yuvak', '9811100001', 'varachha', 'ACTIVE'],
    [U.beta, 'BET102', 'Beta Yuvak', '9811100002', 'varachha', 'ACTIVE'],
    [U.gamma, 'GAM103', 'Gamma Yuvak', '9811100003', 'vedroad', 'ACTIVE'],
    [U.delta, 'DEL104', 'Delta Yuvak', '9811100004', 'navsari', 'ACTIVE'],
    // SUSPENDED, so that p_status has something to select and something to exclude.
    [U.inflated, 'INF105', 'Inflated Yuvak', '9811100005', 'varachha', 'SUSPENDED'],
    [U.zero, 'ZER106', 'Zero Yuvak', '9811100006', 'varachha', 'ACTIVE'],
    // Deliberately NOT named "Yuvak": p_search = 'Yuvak' is used throughout as a way to scope
    // an assertion to the six people whose numbers were computed by hand, and the caller would
    // otherwise be swept into every one of them.
    [U.reader, 'RDR107', 'Sanchalak Reader', '9811100007', 'varachha', 'ACTIVE'],
  ];
  for (const [id, smk, name, mobile, subZone, status] of people) {
    await db.query('insert into auth.users (id, email) values ($1, $2)', [id, `${smk.toLowerCase()}@t.test`]);
    await db.query(
      `insert into public.profiles (id, smk, name, email, mobile, zone_id, sub_zone_id, status)
       values ($1, $2, $3, $4, $5, 'surat', $6, $7)`,
      [id, smk, name, `${smk.toLowerCase()}@t.test`, mobile, subZone, status]
    );
  }

  // The filler. No activity, no name containing 'Yuvak', no email containing it either — so
  // every scoped assertion above stays exact and only the unscoped ones see these.
  await db.query(
    `insert into auth.users (id, email)
     select ('aaaaaaaa-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid,
            'bulk' || lpad(g::text, 3, '0') || '@t.test'
     from generate_series(1, $1) g`,
    [BULK]
  );
  await db.query(
    `insert into public.profiles (id, smk, name, email, mobile, zone_id, sub_zone_id, status)
     select ('aaaaaaaa-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid,
            'BLK' || lpad(g::text, 3, '0'),
            'Bulk ' || lpad(g::text, 3, '0'),
            'bulk' || lpad(g::text, 3, '0') || '@t.test',
            '97' || lpad(g::text, 8, '0'),
            'surat', 'varachha', 'ACTIVE'
     from generate_series(1, $1) g`,
    [BULK]
  );

  await db.query(`insert into public.admin_profiles (id, role, status) values ($1, 'ADMIN', 'ACTIVE')`, [U.reader]);

  // 108 દ્રશ્યો, which is what the collection resolves to in production today. The number
  // matters: admin_content_total() cuts the summary's bins as percentages of it, so a fixture
  // with twelve scenes would put every યુવક in the top bin and prove nothing about the edges.
  await db.query(
    `insert into public.scenes (id, "index", "order", active, caption)
     select 'darshan-' || lpad(g::text, 3, '0'), g, g, true, 'scene ' || g
     from generate_series(1, 108) g`
  );

  // The gate open by configuration rather than by score, so that every લેવલ ૪ status below is
  // a statement about the ક્રમ rule and the coverage credit and not about લેવલ ૩. Points OFF,
  // so that level4_attempts_award (0021:1096) writes nothing and the ledger holds exactly the
  // rows seeded below — otherwise `points_total` would be a figure this file did not choose.
  await db.query(
    `insert into public.settings (key, value) values ('levels', $1::jsonb)
     on conflict (key) do update set value = excluded.value`,
    [
      JSON.stringify({
        level4Gate: { require: false, threshold: 80 },
        points: { enabled: false, level1: 0, level2: 0, level3: 0, level4: { default: 0 } },
      }),
    ]
  );

  // DRAFT first, published at the end — level4_guard_editable() (0010) freezes the activities
  // and items of a PUBLISHED configuration, which is the point of publishing.
  const cfg = (
    await db.query(`insert into public.level4_configs (status, version) values ('DRAFT', 1) returning id`)
  ).rows[0].id;
  ACT.config = cfg;

  for (const [code, pos, items] of L4) {
    const a = (
      await db.query(
        `insert into public.level4_activities (config_id, code, title, position, active, required_count)
         values ($1, $2, $3, $4, true, $5) returning id`,
        [cfg, code, `Kasoti ${code}`, pos, items.length]
      )
    ).rows[0].id;
    ACT[code] = a;
    for (let i = 0; i < items.length; i++) {
      await db.query(
        `insert into public.level4_activity_items (activity_id, scene_id, position) values ($1, $2, $3)`,
        [a, items[i], i + 1]
      );
    }
  }
  await db.query(`update public.level4_configs set status = 'PUBLISHED', published_at = now() where id = $1`, [cfg]);

  // ── the activity ────────────────────────────────────────────────────────────
  //
  // Every date is expressed as "IST today minus N days" and computed by the server, so the
  // fixture is the same distance in the past whenever the suite runs — which is what keeps
  // admin_content_total()'s 180-day bound and the summary's "active today" honest.

  const KEY = { 1: 'video', 2: 'darshan', 3: 'revision' };

  /** One લેવલ ૧–૩ submission, in the shape activity_submit() writes. */
  const att123 = (user, level, daysAgo, sceneIds, status, nth = 1, totalItems = 108) =>
    db.query(
      `insert into public.activity_attempts
         (user_id, level_id, activity_key, activity_date, attempt_number,
          selected_scene_ids, total_items, completed_items, status, submitted_at)
       values ($1, $2, $3,
               (timezone('Asia/Kolkata', now())::date - $4::int), $5, $6, $7, $8, $9,
               ((timezone('Asia/Kolkata', now())::date - $4::int) + time '12:00')
                 at time zone 'Asia/Kolkata')`,
      [user, level, KEY[level], daysAgo, nth, sceneIds, totalItems, sceneIds.length, status]
    );

  /** One લેવલ ૪ કસોટી attempt, in the shape level4_submit() writes. */
  const att4 = (user, code, daysAgo, sceneIds, passed) =>
    db.query(
      `insert into public.level4_attempts
         (user_id, activity_id, config_id, selected_scene_ids, selected_count, required_count, passed, at)
       values ($1, $2, $3, $4, $5, 2, $6,
               ((timezone('Asia/Kolkata', now())::date - $7::int) + time '12:00')
                 at time zone 'Asia/Kolkata')`,
      [user, ACT[code], ACT.config, sceneIds, sceneIds.length, passed, daysAgo]
    );

  /** The per-કસોટી progress row level4_submit() upserts beside the attempt. */
  const l4state = (user, code, status, attempts, revisions = 0) =>
    db.query(
      `insert into public.level4_activity_progress
         (user_id, activity_id, config_id, status, attempt_count, revision_count, completed_at)
       values ($1, $2, $3, $4, $5, $6, case when $4 = 'COMPLETED' then now() end)`,
      [user, ACT[code], ACT.config, status, attempts, revisions]
    );

  const paid = (user, daysAgo, level, key, points) =>
    db.query(
      `insert into public.point_transactions
         (user_id, activity_date, level_id, activity_key, points, source, source_id, attempt_number)
       values ($1, (timezone('Asia/Kolkata', now())::date - $2::int), $3, $4, $5, $6, $7, 1)`,
      [user, daysAgo, level, key, points, level === 4 ? 'LEVEL4_ATTEMPT' : 'ACTIVITY_ATTEMPT', daysAgo]
    );

  // ── Alpha ──────────────────────────────────────────────────────────────────
  // Three overlapping લેવલ ૩ submissions: 1–30, 20–40, 35–60.
  //   sizes  30 + 21 + 26 = 77   ← what a sum would report
  //   union  1–60          = 60  ← what he has actually remembered
  // Plus one FAILED લેવલ ૪ attempt on ૪.૧ ticking only દ્રશ્ય 1, which is already inside
  // 1–60, so the union does not move: 60 from લેવલ ૩ and 1 from લેવલ ૪ is 60 remembered.
  await att123(U.alpha, 3, 20, RANGE(1, 30), 'REVISION_REQUIRED', 1);
  await att123(U.alpha, 3, 19, RANGE(20, 40), 'REVISION_REQUIRED', 1);
  await att123(U.alpha, 3, 18, RANGE(35, 60), 'COMPLETED', 1);
  await att4(U.alpha, '4.1', 17, [SCENE(1)], false);
  await l4state(U.alpha, '4.1', 'REVISION_REQUIRED', 1, 1);
  await paid(U.alpha, 20, 3, 'revision', 300);
  await paid(U.alpha, 18, 3, 'revision', 300); // lifetime 600, windowed [19..18] 300

  // ── Beta ───────────────────────────────────────────────────────────────────
  // The one યુવક who has touched all four levels, and therefore the fan-out case: six attempt
  // rows and ninety unnested scene ids must still be ONE row in the report.
  //   લેવલ ૩  1–85 (85) and 100–104 (5)      → union 90
  //   લેવલ ૪  ૪.૧ {1,2} and ૪.૨ {3,4} passed → 4 ids, all inside 1–85
  //   remembered = 90, from લેવલ ૩ = 90, from લેવલ ૪ = 4   (90 + 4 = 94 ≠ 90)
  await att123(U.beta, 1, 15, [], 'COMPLETED', 1, 0);
  await att123(U.beta, 2, 15, [], 'COMPLETED', 1, 0);
  await att123(U.beta, 3, 15, RANGE(1, 85), 'COMPLETED', 1);
  await att123(U.beta, 3, 3, RANGE(100, 104), 'REVISION_REQUIRED', 1);
  await att4(U.beta, '4.1', 14, [SCENE(1), SCENE(2)], true);
  await att4(U.beta, '4.2', 14, [SCENE(3), SCENE(4)], true);
  await l4state(U.beta, '4.1', 'COMPLETED', 1);
  await l4state(U.beta, '4.2', 'COMPLETED', 1);
  await paid(U.beta, 15, 3, 'revision', 300);
  await paid(U.beta, 14, 4, '4.1', 400);
  await paid(U.beta, 14, 4, '4.2', 400); // 1100

  // ── Gamma ──────────────────────────────────────────────────────────────────
  // Passed ૪.૧ three times and nothing else. level4_attempts = 3, level4_passed = 1.
  // He holds ONE explicit COMPLETED row, and level4_activity_states() must report TWO
  // completions, because ૪.૬ contains only દ્રશ્યો 1 and 2 and he has covered both.
  await att4(U.gamma, '4.1', 10, [SCENE(1), SCENE(2)], true);
  await att4(U.gamma, '4.1', 9, [SCENE(1), SCENE(2)], true);
  await att4(U.gamma, '4.1', 8, [SCENE(1), SCENE(2)], true);
  await l4state(U.gamma, '4.1', 'COMPLETED', 3);
  await paid(U.gamma, 10, 4, '4.1', 400);

  // ── Delta ──────────────────────────────────────────────────────────────────
  // લેવલ ૧ and લેવલ ૨ only — and his rows carry scene ids on purpose. Production rows do not,
  // but "the report filters on level_id = 3" and "the report happens to see empty arrays" are
  // two different claims and only the first one is a guarantee.
  await att123(U.delta, 1, 7, [SCENE(11), SCENE(12)], 'COMPLETED', 1, 0);
  await att123(U.delta, 1, 7, [], 'REVISION_REQUIRED', 2, 0);
  await att123(U.delta, 2, 6, [SCENE(13)], 'COMPLETED', 1, 0);

  // ── Inflated ───────────────────────────────────────────────────────────────
  // §B in one row: one દ્રશ્ય actually submitted, and a level3_score of 99 written by his
  // phone. The report must say 1.
  await att123(U.inflated, 3, 5, [SCENE(7)], 'REVISION_REQUIRED', 1);
  await db.query(
    `insert into public.progress (user_id, date, level3_score, level4_score)
     values ($1, (timezone('Asia/Kolkata', now())::date - 5), 99, 0)`,
    [U.inflated]
  );

  // ── Zero ───────────────────────────────────────────────────────────────────
  // Registered and has done nothing. He must appear in the lifetime report and must be
  // dropped by any date window.
}

async function main() {
  if (!dockerAvailable()) {
    console.log('\n  SKIPPED — no docker daemon. This suite needs one to be honest.\n');
    console.log('  Nothing was verified. Do not read a green build as a passing suite.\n');
    process.exitCode = 2;
    return;
  }

  const { client: db, stop } = await startDatabase();
  try {
    await fixtures(db);
    await run(db);
  } finally {
    await db.end().catch(() => {});
    await stop();
  }

  console.log(`\n  ${pass} passed, ${fails.length} failed\n`);
  if (fails.length) {
    for (const f of fails) console.log(`  FAIL  ${f}`);
    console.log('');
    process.exitCode = 1;
  }
}

async function run(db) {
  // Every call below is made as the ADMIN, inside a transaction that is rolled back — these
  // functions are read-only, so nothing needs to survive, and nothing may leak into the next
  // assertion.
  const asReader = (fn) => asUser(db, U.reader, fn);

  const REPORT = `
    select * from public.admin_progress_report(
      $1::text, $2::int, $3::int, $4::date, $5::date, $6::int, $7::text, $8::text, $9::text,
      $10::int, $11::int
    )`;
  const args = (o) => [
    o.search ?? null,
    o.minRemembered ?? null,
    o.minPassed ?? null,
    o.from ?? null,
    o.to ?? null,
    o.level ?? null,
    o.status ?? null,
    o.sort ?? 'remembered',
    o.dir ?? 'desc',
    o.page ?? 0,
    o.size ?? 20,
  ];
  const rows = (o = {}) => asReader(async () => (await db.query(REPORT, args(o))).rows);
  const tryRows = (o = {}) => asReader(() => attempt(db, REPORT, args(o)));
  /** The single row for one યુવક, found by his mobile — which no other fixture shares. */
  const rowFor = async (mobile) => (await rows({ search: mobile }))[0];
  const names = (rs) => rs.map((r) => r.name);

  const detailOf = (uid) =>
    asReader(async () => (await db.query('select public.admin_user_progress_detail($1) d', [uid])).rows[0].d);
  const summaryOf = (from = null, to = null) =>
    asReader(
      async () => (await db.query('select public.admin_progress_summary($1::date, $2::date) s', [from, to])).rows[0].s
    );

  /** 'YYYY-MM-DD' for "IST today minus N days" — the same clock the fixtures were written on. */
  const day = async (n) =>
    (await db.query(`select (timezone('Asia/Kolkata', now())::date - $1::int)::text d`, [n])).rows[0].d;

  const alpha = await rowFor('9811100001');
  const beta = await rowFor('9811100002');
  const gamma = await rowFor('9811100003');
  const delta = await rowFor('9811100004');
  const inflated = await rowFor('9811100005');

  // ══════════════════════════════════════════════════════ §A the union
  group('§A  "remembered" is the distinct union of what was submitted');

  eq(
    'Alpha submitted 1-30, 20-40 and 35-60 at લેવલ ૩ — 77 ticks, 60 distinct દ્રશ્યો',
    alpha.remembered_count,
    60
  );
  eq('and the report says so from લેવલ ૩ alone', alpha.remembered_l3, 60);
  eq(
    'his one failed લેવલ ૪ attempt ticked દ્રશ્ય 1, already inside 1-60, so the total does not move',
    [alpha.remembered_l4, alpha.remembered_count],
    [1, 60]
  );

  // Beta is the case where the two halves genuinely differ. 90 from લેવલ ૩ and 4 from લેવલ ૪,
  // and 90 + 4 = 94 — which is what a report that added the halves would print.
  eq(
    'Beta remembered 1-85 and 100-104 at લેવલ ૩ and {1,2,3,4} at લેવલ ૪ — 90, not 94',
    [beta.remembered_count, beta.remembered_l3, beta.remembered_l4],
    [90, 90, 4]
  );
  eq(
    'Gamma has no લેવલ ૩ at all — his 2 દ્રશ્યો come from લેવલ ૪ and are counted once each',
    [gamma.remembered_count, gamma.remembered_l3, gamma.remembered_l4],
    [2, 0, 2]
  );
  const zero = await rowFor('9811100006');
  eq(
    'a યુવક who has done nothing remembers nothing, and is still in the lifetime report',
    [zero.name, zero.remembered_count, zero.level3_attempts],
    ['Zero Yuvak', 0, 0]
  );

  // ══════════════════════════════════════════════════════ §B not level3_score
  group('§B  "remembered" is not progress.level3_score (the whole point of 0029)');

  eq(
    "Inflated's phone wrote level3_score = 99; he submitted one દ્રશ્ય",
    await asReader(
      async () =>
        (await db.query('select level3_score from public.progress where user_id = $1', [U.inflated])).rows[0]
          .level3_score
    ),
    99
  );
  eq('the report returns the 1 he actually submitted, not the 99 his phone reported', inflated.remembered_count, 1);
  eq(
    'and the detail document agrees with the report rather than with the column',
    (await detailOf(U.inflated)).rememberedSceneIds,
    [SCENE(7)]
  );

  // ══════════════════════════════════════════════════════ §C levels 1 and 2
  group('§C  લેવલ ૧ and લેવલ ૨ record no દ્રશ્યો, whatever their rows hold');

  eq(
    'Delta has 2 લેવલ ૧ attempts and 1 લેવલ ૨, and the report counts them',
    [delta.level1_attempts, delta.level2_attempts, delta.level3_attempts],
    [2, 1, 0]
  );
  eq(
    'his લેવલ ૧ row carries દ્રશ્યો 11 and 12 and his લેવલ ૨ row 13 — none of them count',
    [delta.remembered_count, delta.remembered_l3, delta.remembered_l4],
    [0, 0, 0]
  );
  eq(
    'because the filter is level_id = 3: the three ids are in the table and reachable',
    await asReader(
      async () =>
        (
          await db.query(
            `select count(distinct s.scene_id)::int c
             from public.activity_attempts a
             cross join lateral unnest(a.selected_scene_ids) as s(scene_id)
             where a.user_id = $1 and a.level_id in (1, 2)`,
            [U.delta]
          )
        ).rows[0].c
    ),
    3
  );
  eq('his લેવલ ૧ and લેવલ ૨ still read COMPLETED', [delta.level1_status, delta.level2_status], [
    'COMPLETED',
    'COMPLETED',
  ]);

  // ══════════════════════════════════════════════════════ §D passed vs attempts
  group('§D  level4_passed counts કસોટીઓ, not attempts');

  eq('Gamma sat ૪.૧ three times, all passing — 3 attempts, 1 કસોટી passed', [
    gamma.level4_attempts,
    gamma.level4_passed,
  ], [3, 1]);
  eq('Beta passed two different કસોટીઓ in two attempts', [beta.level4_attempts, beta.level4_passed], [2, 2]);
  eq('Alpha attempted one and passed none', [alpha.level4_attempts, alpha.level4_passed], [1, 0]);

  // ══════════════════════════════════════════════════════ §E the status columns
  group('§E  unlocked / completed / revision come from level4_activity_states()');

  eq('the configuration holds 6 કસોટીઓ and the report reports 6', beta.level4_total, L4_TOTAL);

  // Gamma holds exactly one COMPLETED row. ૪.૬ contains only દ્રશ્યો 1 and 2, which he has
  // covered, so level4_completed_activity_ids() credits it — 2 completed, from 1 row.
  eq(
    'Gamma has one COMPLETED row in level4_activity_progress',
    await asReader(
      async () =>
        (
          await db.query(
            `select count(*)::int c from public.level4_activity_progress
             where user_id = $1 and status = 'COMPLETED'`,
            [U.gamma]
          )
        ).rows[0].c
    ),
    1
  );
  eq(
    'and 2 completed in the report — ૪.૬ repeats ૪.૧\'s દ્રશ્યો and is credited by coverage',
    gamma.level4_completed,
    2
  );
  eq(
    'his unlocked count is 3: ૪.૧ and ૪.૬ COMPLETED, ૪.૨ AVAILABLE, ૪.૩-૪.૫ LOCKED by ક્રમ',
    gamma.level4_unlocked,
    3
  );
  eq(
    'Beta covers દ્રશ્યો 1-4, so ૪.૧, ૪.૨ and ૪.૬ are complete and ૪.૩ is available — 3 and 4',
    [beta.level4_completed, beta.level4_unlocked],
    [3, 4]
  );
  eq(
    'Alpha failed ૪.૧, so 1 unlocked, 0 completed, 1 revision-required, and ૪.૨-૪.૬ LOCKED',
    [alpha.level4_unlocked, alpha.level4_completed, alpha.level4_revision],
    [1, 0, 1]
  );
  eq(
    'Delta has never opened લેવલ ૪ — only ૪.૧ is unlocked and nothing is completed',
    [delta.level4_unlocked, delta.level4_completed, delta.level4_revision],
    [1, 0, 0]
  );

  // ══════════════════════════════════════════════════════ §F the filters
  group('§F  the filters');

  eq('no filter at all returns every profile — 7 named plus 220 filler', (await rows({ size: 200, page: 0 })).length
    + (await rows({ size: 200, page: 1 })).length, PEOPLE);
  eq('and total_rows says so', num((await rows({ size: 1 }))[0].total_rows), PEOPLE);

  eq(
    'p_min_remembered = 50 admits Beta (90) and Alpha (60) and nobody else',
    names(await rows({ minRemembered: 50 })),
    ['Beta Yuvak', 'Alpha Yuvak']
  );
  eq(
    'p_min_remembered = 90 admits Beta alone — the bound is inclusive',
    names(await rows({ minRemembered: 90 })),
    ['Beta Yuvak']
  );
  eq(
    'p_min_l4_passed = 1 admits Beta (2) and Gamma (1), not Alpha (0)',
    names(await rows({ minPassed: 1 })).sort(),
    ['Beta Yuvak', 'Gamma Yuvak']
  );
  eq('p_min_l4_passed = 2 admits Beta alone', names(await rows({ minPassed: 2 })), ['Beta Yuvak']);

  eq('p_search matches a name', names(await rows({ search: 'Gamma' })), ['Gamma Yuvak']);
  eq('p_search matches a mobile in full', names(await rows({ search: '9811100004' })), ['Delta Yuvak']);
  eq('p_search matches an SMK', names(await rows({ search: 'INF105' })), ['Inflated Yuvak']);
  eq('p_search is a substring match and case-insensitive', (await rows({ search: 'yuvak', size: 50 })).length, 6);

  eq(
    'p_level = 3 admits the three who submitted પુનરાવર્તન',
    names(await rows({ level: 3, size: 50 })).sort(),
    ['Alpha Yuvak', 'Beta Yuvak', 'Inflated Yuvak']
  );
  eq('p_level = 1 admits Beta and Delta', names(await rows({ level: 1, size: 50 })).sort(), [
    'Beta Yuvak',
    'Delta Yuvak',
  ]);
  eq('p_level = 2 admits Beta and Delta', names(await rows({ level: 2, size: 50 })).sort(), [
    'Beta Yuvak',
    'Delta Yuvak',
  ]);
  eq(
    'p_level = 4 admits the three who sat a કસોટી, passed or not',
    names(await rows({ level: 4, size: 50 })).sort(),
    ['Alpha Yuvak', 'Beta Yuvak', 'Gamma Yuvak']
  );

  eq('p_status = SUSPENDED admits the one suspended account', names(await rows({ status: 'SUSPENDED' })), [
    'Inflated Yuvak',
  ]);
  eq('p_status = ACTIVE admits everybody else', num((await rows({ status: 'ACTIVE', size: 1 }))[0].total_rows),
    PEOPLE - 1);

  // ── the date window ────────────────────────────────────────────────────────
  //
  // Alpha's three લેવલ ૩ submissions are 20, 19 and 18 days ago and his failed લેવલ ૪ attempt
  // 17; Beta's are 15 and 3; Gamma's 10, 9 and 8; Delta's 7 and 6; Inflated's 5.

  const d20 = await day(20);
  const d16 = await day(16);
  const d19 = await day(19);
  const d18 = await day(18);
  const d4 = await day(4);
  const d2 = await day(2);

  const w1 = await rows({ from: d20, to: d16, size: 50 });
  eq('a window of [T-20, T-16] holds only Alpha — 226 profiles with no activity are dropped', names(w1), [
    'Alpha Yuvak',
  ]);
  eq('and all three of his submissions are inside it: 1-60 again', w1[0].remembered_count, 60);

  const w2 = await rows({ from: d19, to: d18, size: 50 });
  eq(
    'a window of [T-19, T-18] holds his last two only: 20-40 ∪ 35-60 = 20-60 = 41',
    [w2[0].remembered_count, w2[0].level3_attempts],
    [41, 2]
  );
  eq(
    'his લેવલ ૪ attempt was on T-17 and is outside, so the windowed attempt count is 0',
    [w2[0].level4_attempts, w2[0].remembered_l4],
    [0, 0]
  );
  eq(
    'but the લેવલ ૪ STATUS columns are exempt and stay lifetime — 1 unlocked, 1 revision',
    [w2[0].level4_unlocked, w2[0].level4_completed, w2[0].level4_revision],
    [1, 0, 1]
  );
  eq('the ledger is windowed too — 300 of his 600 was paid on T-18', num(w2[0].points_total), 300);
  eq('and lifetime he has 600', num(alpha.points_total), 600);

  // Beta is the sharper case: inside [T-4, T-2] he has one લેવલ ૩ submission and nothing at
  // લેવલ ૪ at all, yet three કસોટીઓ of his are complete and always will be.
  const w3 = await rows({ from: d4, to: d2, size: 50 });
  eq('a window of [T-4, T-2] holds only Beta', names(w3), ['Beta Yuvak']);
  eq(
    'his 100-104 submission is the only activity in it — 5 remembered, 0 લેવલ ૪ attempts',
    [w3[0].remembered_count, w3[0].level3_attempts, w3[0].level4_attempts, w3[0].level4_passed],
    [5, 1, 0, 0]
  );
  eq(
    'the લેવલ ૪ status columns ignore the window: 3 completed, 4 unlocked, as they are now',
    [w3[0].level4_completed, w3[0].level4_unlocked],
    [3, 4]
  );
  eq(
    'levels ૧-૩ do NOT get that exemption — his લેવલ ૧ was on T-15 and reads NOT_STARTED here',
    [w3[0].level1_status, w3[0].level1_attempts, beta.level1_status],
    ['NOT_STARTED', 0, 'COMPLETED']
  );

  // ── combinations ───────────────────────────────────────────────────────────
  eq(
    'search + min_remembered: the four "Yuvak" profiles who have remembered anything',
    names(await rows({ search: 'Yuvak', minRemembered: 1, size: 50 })).sort(),
    ['Alpha Yuvak', 'Beta Yuvak', 'Gamma Yuvak', 'Inflated Yuvak']
  );
  eq(
    'level + min_l4_passed: sat a કસોટી AND passed at least one — Alpha drops out',
    names(await rows({ level: 4, minPassed: 1, size: 50 })).sort(),
    ['Beta Yuvak', 'Gamma Yuvak']
  );
  eq(
    'status + min_remembered: SUSPENDED Inflated is excluded even though he remembered 1',
    names(await rows({ status: 'ACTIVE', minRemembered: 1, size: 50 })).sort(),
    ['Alpha Yuvak', 'Beta Yuvak', 'Gamma Yuvak']
  );
  eq(
    'window + min_remembered: 41 inside [T-19, T-18] passes a bound of 41 and fails one of 42',
    [
      (await rows({ from: d19, to: d18, minRemembered: 41, size: 50 })).length,
      (await rows({ from: d19, to: d18, minRemembered: 42, size: 50 })).length,
    ],
    [1, 0]
  );

  // ══════════════════════════════════════════════════════ §G total_rows
  group('§G  total_rows is the filtered total, on every row, and is not the page size');

  const g = await rows({ search: 'Bulk', size: 10 });
  eq('a page of 10 out of 220 returns 10 rows', g.length, 10);
  eq('and every one of them carries total_rows = 220', [...new Set(g.map((r) => num(r.total_rows)))], [BULK]);
  eq('which is not the page size', num(g[0].total_rows) === g.length, false);

  const g2 = await rows({ search: 'Yuvak', minRemembered: 1, size: 2 });
  eq('a filtered page of 2 out of 4 carries total_rows = 4', [g2.length, num(g2[0].total_rows)], [2, 4]);

  // ══════════════════════════════════════════════════════ §H pagination
  group('§H  pagination covers the set exactly once, and p_page_size is capped at 200');

  const p0 = await rows({ search: 'Yuvak', size: 4, page: 0, sort: 'name', dir: 'asc' });
  const p1 = await rows({ search: 'Yuvak', size: 4, page: 1, sort: 'name', dir: 'asc' });
  eq('page 0 of 4 and page 1 hold 4 and 2', [p0.length, p1.length], [4, 2]);
  eq('they do not overlap', p0.filter((a) => p1.some((b) => b.user_id === a.user_id)).length, 0);
  eq('and together they are the whole filtered set', new Set([...p0, ...p1].map((r) => r.user_id)).size, 6);
  eq('a page past the end is empty and does not raise', (await rows({ search: 'Yuvak', size: 4, page: 9 })).length, 0);

  // The cap can only be observed on a set larger than it, which is what the 220 filler
  // profiles are for. Both halves are needed: the first shows the page is clamped to 200, and
  // the second shows the OFFSET was computed from 200 as well — a cap applied to the LIMIT but
  // not to the skip would return 0 rows here, having jumped over the whole set.
  eq('p_page_size = 500 returns 200 rows out of 220', (await rows({ search: 'Bulk', size: 500 })).length, 200);
  eq(
    'and page 1 at that size skips 200, not 500 — the remaining 20',
    (await rows({ search: 'Bulk', size: 500, page: 1 })).length, 20
  );
  eq('p_page_size = 0 is raised to 1, not treated as unlimited', (await rows({ search: 'Bulk', size: 0 })).length, 1);
  eq('a negative page is treated as page 0', (await rows({ search: 'Yuvak', size: 4, page: -3, sort: 'name',
    dir: 'asc' })).map((r) => r.name), names(p0));

  // ══════════════════════════════════════════════════════ §I ordering
  group('§I  sorting, in both directions, and a total order');

  eq(
    'remembered desc: 90, 60, 2, 1, then the two zeroes',
    names(await rows({ search: 'Yuvak', sort: 'remembered', dir: 'desc', size: 50 })).slice(0, 4),
    ['Beta Yuvak', 'Alpha Yuvak', 'Gamma Yuvak', 'Inflated Yuvak']
  );
  eq(
    'remembered asc: 1, 2, 60, 90',
    names(await rows({ search: 'Yuvak', minRemembered: 1, sort: 'remembered', dir: 'asc', size: 50 })),
    ['Inflated Yuvak', 'Gamma Yuvak', 'Alpha Yuvak', 'Beta Yuvak']
  );
  eq(
    'name asc',
    names(await rows({ search: 'Yuvak', sort: 'name', dir: 'asc', size: 50 })),
    ['Alpha Yuvak', 'Beta Yuvak', 'Delta Yuvak', 'Gamma Yuvak', 'Inflated Yuvak', 'Zero Yuvak']
  );
  eq(
    'name desc is the exact reverse',
    names(await rows({ search: 'Yuvak', sort: 'name', dir: 'desc', size: 50 })),
    ['Zero Yuvak', 'Inflated Yuvak', 'Gamma Yuvak', 'Delta Yuvak', 'Beta Yuvak', 'Alpha Yuvak']
  );
  eq(
    'l4_passed desc puts Beta (2) above Gamma (1)',
    names(await rows({ search: 'Yuvak', sort: 'l4_passed', dir: 'desc', size: 50 })).slice(0, 2),
    ['Beta Yuvak', 'Gamma Yuvak']
  );
  eq(
    'points desc: 1100, 600, 400',
    names(await rows({ search: 'Yuvak', sort: 'points', dir: 'desc', size: 50 })).slice(0, 3),
    ['Beta Yuvak', 'Alpha Yuvak', 'Gamma Yuvak']
  );
  eq('an unknown p_sort falls back to remembered rather than raising',
    names(await rows({ search: 'Yuvak', sort: 'nonsense', dir: 'desc', size: 50 })).slice(0, 2),
    ['Beta Yuvak', 'Alpha Yuvak']);

  // ORDERING.md §8. 223 of the 227 rows share `remembered = 0`, so without the tiebreak on
  // `id` the pages would be free to interleave differently on each request — and this walk
  // would come back with a duplicate and a missing row rather than with 227 distinct ids.
  const sweep = [];
  for (let page = 0; page < 3; page++) {
    for (const r of await rows({ sort: 'remembered', dir: 'desc', size: 100, page })) sweep.push(r.user_id);
  }
  eq('a walk of the whole report in pages of 100 returns 227 rows', sweep.length, PEOPLE);
  eq('and 227 distinct યુવકો — no row appears on two pages', new Set(sweep).size, PEOPLE);

  // ══════════════════════════════════════════════════════ §J one row per યુવક
  group('§J  a યુવક appears at most once, however many attempts he has');

  eq(
    'Beta has 4 લેવલ ૧-૩ attempts and 2 at લેવલ ૪ — six rows to fan out from',
    await asReader(async () => [
      (await db.query('select count(*)::int c from public.activity_attempts where user_id = $1', [U.beta])).rows[0].c,
      (await db.query('select count(*)::int c from public.level4_attempts where user_id = $1', [U.beta])).rows[0].c,
    ]),
    [4, 2]
  );
  eq(
    'and 90 unnested scene ids across two lateral joins — still exactly one row',
    (await rows({ search: 'Beta', size: 50 })).length,
    1
  );
  eq('Alpha, with 3 લેવલ ૩ attempts, is also one row', (await rows({ search: 'Alpha', size: 50 })).length, 1);
  eq('Gamma, with 3 attempts on one કસોટી, is also one row', (await rows({ search: 'Gamma', size: 50 })).length, 1);
  eq(
    'and in the unfiltered report every user_id is distinct',
    new Set(sweep).size === sweep.length,
    true
  );

  // ══════════════════════════════════════════════════════ §K empty results
  group('§K  a filter nobody matches returns nothing, and does not raise');

  noRows('p_min_remembered = 91 — Beta has 90 and is the highest', await tryRows({ minRemembered: 91 }));
  noRows('p_min_l4_passed = 6 — nobody has passed the whole configuration', await tryRows({ minPassed: 6 }));
  noRows('a search that matches nobody', await tryRows({ search: 'NoSuchPersonAnywhere' }));
  noRows('a status nobody holds', await tryRows({ status: 'DISABLED' }));
  noRows('a window in which nothing happened', await tryRows({ from: await day(1), to: await day(1) }));
  eq(
    'and an empty result is genuinely a successful call',
    (await tryRows({ minRemembered: 91 })).ok,
    true
  );

  // ══════════════════════════════════════════════════════ §L the detail document
  group('§L  admin_user_progress_detail agrees with the report row');

  const dBeta = await detailOf(U.beta);

  eq('the કસોટી list is as long as the configuration is, and is not hardcoded to four', [
    dBeta.level4.activities.length,
    L4_TOTAL,
  ], [6, 6]);
  eq('it is in ક્રમ order', dBeta.level4.activities.map((a) => a.code), ['4.1', '4.2', '4.3', '4.4', '4.5', '4.6']);
  eq(
    "Beta's statuses: ૪.૧ and ૪.૨ sat and passed, ૪.૬ credited by coverage, ૪.૩ next, ૪.૪-૪.૫ locked",
    dBeta.level4.activities.map((a) => a.status),
    ['COMPLETED', 'COMPLETED', 'AVAILABLE', 'LOCKED', 'LOCKED', 'COMPLETED']
  );
  eq(
    'a credited કસોટી has no completedAt and no attempts of its own — it was never sat',
    [dBeta.level4.activities[5].completedAt, dBeta.level4.activities[5].attempts,
      dBeta.level4.activities[5].passedAttempts],
    [null, 0, 0]
  );
  eq('itemCount is read from the કસોટી and not assumed', dBeta.level4.activities.map((a) => a.itemCount),
    [2, 2, 2, 2, 2, 2]);

  // The vocabulary, over every fixture at once. LOCKED / AVAILABLE / IN_PROGRESS /
  // REVISION_REQUIRED / COMPLETED is what level4_activity_states() returns, and the panel
  // renders a Gujarati label per value — an unexpected sixth string would render as nothing.
  const VOCAB = ['LOCKED', 'AVAILABLE', 'IN_PROGRESS', 'REVISION_REQUIRED', 'COMPLETED'];
  const seen = new Set();
  for (const uid of [U.alpha, U.beta, U.gamma, U.delta, U.inflated, U.zero]) {
    for (const a of (await detailOf(uid)).level4.activities) seen.add(a.status);
  }
  eq('every status returned is in the LOCKED/AVAILABLE/IN_PROGRESS/REVISION_REQUIRED/COMPLETED vocabulary',
    [...seen].filter((s) => !VOCAB.includes(s)), []);
  eq('and the fixtures between them exercise four of the five',
    [...seen].sort(), ['AVAILABLE', 'COMPLETED', 'LOCKED', 'REVISION_REQUIRED']);

  eq(
    "Alpha's ૪.૧ is REVISION_REQUIRED and everything behind it is LOCKED",
    (await detailOf(U.alpha)).level4.activities.map((a) => a.status),
    ['REVISION_REQUIRED', 'LOCKED', 'LOCKED', 'LOCKED', 'LOCKED', 'LOCKED']
  );
  eq(
    'a યુવક who has done nothing sees ૪.૧ available and the rest locked',
    (await detailOf(U.zero)).level4.activities.map((a) => a.status),
    ['AVAILABLE', 'LOCKED', 'LOCKED', 'LOCKED', 'LOCKED', 'LOCKED']
  );

  eq('the detail names the right યુવક and reports his account status', [
    dBeta.user.userId,
    dBeta.user.name,
    dBeta.user.status,
  ], [U.beta, 'Beta Yuvak', 'ACTIVE']);
  eq("Beta's લેવલ ૩ detail: 2 attempts on 2 days, best 85, latest 5, denominator 108", [
    dBeta.level3.attempts,
    dBeta.level3.days,
    dBeta.level3.best,
    dBeta.level3.latest,
    dBeta.level3.reportedTotal,
  ], [2, 2, 85, 5, 108]);

  // ── the acceptance criterion ───────────────────────────────────────────────
  //
  // The સંચાલક clicks a row in the report and opens this document. If the two disagree about
  // one number there is nothing on either screen that says which to believe, so every figure
  // the two share is compared for every fixture, not for one.
  for (const [label, uid, mobile] of [
    ['Alpha', U.alpha, '9811100001'],
    ['Beta', U.beta, '9811100002'],
    ['Gamma', U.gamma, '9811100003'],
    ['Delta', U.delta, '9811100004'],
    ['Inflated', U.inflated, '9811100005'],
    ['Zero', U.zero, '9811100006'],
  ]) {
    const r = await rowFor(mobile);
    const d = await detailOf(uid);
    const st = d.level4.activities.map((a) => a.status);

    eq(
      `${label}: every figure the report and the detail share is the same number`,
      {
        remembered: r.remembered_count,
        fromL3: r.remembered_l3,
        fromL4: r.remembered_l4,
        l1: r.level1_attempts,
        l2: r.level2_attempts,
        l3: r.level3_attempts,
        l4total: r.level4_total,
        l4attempts: r.level4_attempts,
        l4passed: r.level4_passed,
        l4unlocked: r.level4_unlocked,
        l4completed: r.level4_completed,
        l4revision: r.level4_revision,
        gate: r.gate_open,
        points: num(r.points_total),
      },
      {
        remembered: d.rememberedSceneIds.length,
        fromL3: d.rememberedFromLevel3,
        fromL4: d.rememberedFromLevel4,
        l1: d.level1.attempts,
        l2: d.level2.attempts,
        l3: d.level3.attempts,
        l4total: d.level4.total,
        l4attempts: d.level4.attempts,
        l4passed: d.level4.passed,
        l4unlocked: st.filter((s) => s !== 'LOCKED').length,
        l4completed: st.filter((s) => s === 'COMPLETED').length,
        l4revision: st.filter((s) => s === 'REVISION_REQUIRED').length,
        gate: d.gateOpen,
        points: num(d.points.total),
      }
    );
  }

  // ══════════════════════════════════════════════════════ §M the summary
  group('§M  admin_progress_summary, and admin_content_total behind it');

  eq(
    'admin_content_total is the largest લેવલ ૩ denominator submitted in 180 days — 108',
    await asReader(async () => (await db.query('select public.admin_content_total() t')).rows[0].t),
    108
  );

  const s = await summaryOf();
  // `contentTotal`, not `totalContent` — 0030 renamed it when the same key had to appear on
  // three documents (summary, detail, verify) and one of them already spelled it this way.
  eq('the summary reports the same 108', s.contentTotal, 108);
  eq('and the 6 કસોટીઓ of the published configuration', s.level4Total, L4_TOTAL);
  eq('227 profiles, 226 of them ACTIVE', [s.totalUsers, s.activeUsers], [PEOPLE, PEOPLE - 1]);
  eq('nothing was submitted today, so activeToday is 0', s.activeToday, 0);
  eq('લેવલ ૧ and લેવલ ૨ completed by Beta and Delta', [s.level1Completed, s.level2Completed], [2, 2]);
  eq('લેવલ ૩ completed by Alpha and Beta', s.level3Completed, 2);
  eq('the gate is open to everyone by configuration', s.level4GateOpen, PEOPLE);
  eq('Beta and Gamma have passed at least one કસોટી', s.level4AnyPassed, 2);
  eq('nobody has passed all 6', s.level4AllPassed, 0);
  eq('4 યુવકો have remembered anything', s.participants, 4);
  eq('and their mean is (90 + 60 + 2 + 1) / 4 = 38.25, reported to one place', Number(s.avgRemembered), 38.3);

  // Bin edges are shares of 108, not literals: 90% of 108 is 97.2 and ceil()s to 98.
  const bins = Object.fromEntries(s.buckets.map((b) => [b.key, b]));
  // 0030 split the whole collection out of the top bin into a bin of its own, because
  // "who has every દ્રશ્ય" is the question the સંચાલક actually asks and it was invisible
  // inside a 98-108 band. So `100%` is exactly [total, total] and `90+` now stops one short.
  eq('the 100% bin is exactly the whole collection', [bins['100%'].lo, bins['100%'].hi], [108, 108]);
  eq('the top bin runs 98-107 — ceil(108 × 0.90) up to one short of the total', [bins['90+'].lo, bins['90+'].hi], [98, 107]);
  eq('and the bins below it tile the range with no gap', [
    [bins['75-89'].lo, bins['75-89'].hi],
    [bins['50-74'].lo, bins['50-74'].hi],
    [bins['25-49'].lo, bins['25-49'].hi],
    [bins['1-24'].lo, bins['1-24'].hi],
  ], [[81, 97], [54, 80], [27, 53], [1, 26]]);
  eq(
    'Beta (90) lands in 75-89, Alpha (60) in 50-74, Gamma (2) and Inflated (1) in 1-24',
    [bins['90+'].count, bins['75-89'].count, bins['50-74'].count, bins['25-49'].count, bins['1-24'].count],
    [0, 1, 1, 0, 2]
  );
  eq(
    'and the bins account for every યુવક with remembered > 0 — nobody falls between two edges',
    s.buckets.reduce((n, b) => n + b.count, 0),
    (await rows({ minRemembered: 1, size: 200 })).length
  );

  // The cards, checked against SQL computed directly over the fixtures rather than against
  // the same expression the function uses — a card that agreed with its own CTE would prove
  // only that the CTE was copied correctly.
  eq(
    'participants, counted independently: users with any લેવલ ૩ or લેવલ ૪ scene id',
    await asReader(
      async () =>
        (
          await db.query(`
            select count(distinct t.user_id)::int c from (
              select a.user_id from public.activity_attempts a
                cross join lateral unnest(a.selected_scene_ids) s(scene_id)
                where a.level_id = 3
              union
              select la.user_id from public.level4_attempts la
                cross join lateral unnest(la.selected_scene_ids) s(scene_id)
            ) t`)
        ).rows[0].c
    ),
    s.participants
  );
  eq(
    'level4AnyPassed, counted independently: users with a passing attempt',
    await asReader(
      async () =>
        (await db.query('select count(distinct user_id)::int c from public.level4_attempts where passed')).rows[0].c
    ),
    s.level4AnyPassed
  );

  // Windowed, the summary answers about the window — but it does not drop anybody, because a
  // summary is about the project and a report is about a list of people.
  const sw = await summaryOf(d19, d18);
  eq('windowed to [T-19, T-18] only Alpha has remembered anything, and it is 41', [
    sw.participants,
    Number(sw.avgRemembered),
  ], [1, 41]);
  eq('and 41 lands in the 27-53 bin', [
    sw.buckets.find((b) => b.key === '25-49').count,
    sw.buckets.find((b) => b.key === '50-74').count,
  ], [1, 0]);
  eq('the head-count cards are not windowed — they are facts about the project', [sw.totalUsers, sw.activeUsers], [
    PEOPLE,
    PEOPLE - 1,
  ]);

  const sEmpty = await summaryOf(await day(1), await day(1));
  eq('a window in which nothing happened has no participants and no average', [
    sEmpty.participants,
    sEmpty.avgRemembered,
    sEmpty.level4AnyPassed,
  ], [0, null, 0]);
  // Six bins since 0030 added `100%`. Still every one present and zero rather than absent:
  // a bin that vanishes when nobody is in it makes an empty project look like a broken one.
  eq('and every bin is empty rather than absent', sEmpty.buckets.map((b) => b.count), [0, 0, 0, 0, 0, 0]);

  // ══════════════════════════════════════════════════════ §N arguments
  group('§N  the report survives the arguments a panel actually sends');

  eq('all defaults — 20 rows, page 0, remembered desc', (await asReader(async () =>
    (await db.query('select * from public.admin_progress_report()')).rows)).length, 20);
  noRows('a p_level outside 1-4 matches nobody rather than everybody', await tryRows({ level: 9, size: 200 }));
  eq('an empty p_search is treated as no search at all', num((await rows({ search: '   ', size: 1 }))[0].total_rows),
    PEOPLE);
  eq('p_from alone is a half-open window: everything from T-19 onward', names(await rows({ from: d19, size: 50 }))
    .sort(), ['Alpha Yuvak', 'Beta Yuvak', 'Delta Yuvak', 'Gamma Yuvak', 'Inflated Yuvak']);
  eq('p_to alone is the other half: everything up to T-16', names(await rows({ to: d16, size: 50 })), ['Alpha Yuvak']);
}

await main();
