/**
 * The milestone engine, against a real Postgres — `node scripts/test-point-bonus.mjs`.
 *
 * 0033 does two things that cannot be checked by reading: it lets a level be earned more than
 * once a day, and it pays a bonus for a milestone. Both are rules about a *count*, both are
 * enforced by a unique index rather than by a function being careful, and both sit on the one
 * table in this project that is money while promising that nothing already in it moves. A
 * suite that mocked any of it would be asserting what its author typed.
 *
 * So this file does what scripts/test-point-engine.mjs does, and deliberately reuses its
 * harness rather than inventing one: `docker run postgres:16`, apply supabase/test/prelude.sql
 * and every migration in filename order (scripts/lib/pgtest.mjs), seed a population whose every
 * figure was worked out on paper first, and then drive the real writers — `activity_submit()`
 * and the `level4_attempts_award` trigger — and assert on the rows they actually wrote.
 *
 * The default port is not always bindable on Windows (see scripts/lib/pgtest.mjs):
 *
 *     VARNI_PGTEST_PORT=54833 node scripts/test-point-bonus.mjs
 *
 * ────────────────────────────────────────────────────────────────────────────
 * What each group is protecting, and what it costs to get wrong
 * ────────────────────────────────────────────────────────────────────────────
 *
 *  §0  **0033 applied, applies again, and built what it said it would.** A migration that
 *      cannot be re-applied is a migration that cannot be corrected — 0031 reached production
 *      and could not be re-run, which is the whole reason every constraint in both files is
 *      dropped before it is added. Asserted directly: apply the file a second time and confirm
 *      the ledger has not moved by a row, a point or a legacy row.
 *
 *  §A-§J  **The brief's own acceptance scenarios**, each named where it is asserted:
 *      A  લેવલ ૧ at ૧૦૦ a completion under EVERY — 1 → 100, 5 → 500
 *      B  and a rule "every 5 completions → +200" — 700
 *      C  લેવલ ૨ at ૨૦૦ under EVERY — 5 → 1000
 *      D  with the same milestone — 1200
 *      E  લેવલ ૩ per દ્રશ્ય — ૧૦૮ ticks → ૧૦૮, then 10 more under tickCount ALL → 118,
 *         and the same 10 under FRESH → nothing, which is the whole difference between them
 *      F  the same submission sent twice → exactly one transaction
 *      G  a milestone reached, then the same submission again → exactly one BONUS row
 *      H  thresholds ૫/૧૦/૨૦ under EVERY, FIRST_ONLY and HIGHEST_ONLY, all three different
 *      I  લેવલ ૨ repriced from ૨૦૦ to ૨૫૦ — the paid row still reads ૨૦૦
 *      J  a ૪.૫ created today is priced and scored with no code change
 *
 *  §K  **The no-change guarantee.** POINT_SYSTEM_ARCHITECTURE §J3: "an untouched settings row
 *      must produce byte-identical awards — this is a test, not an aspiration." Driven through
 *      the real writers under 0031's own BASE configuration with no `earn` key and no bonus
 *      rule, and compared column by column against a row written by 0021's own INSERT
 *      statement, reproduced verbatim. §J1's other half is beside it: three rows written
 *      before 0031 exist throughout and every column of all three must still be what it was.
 *
 *  §L  **ONCE is once in a lifetime**, not once a day. A mode that quietly meant "once today"
 *      would be a second spelling of DAY_FIRST and nobody would notice for a month.
 *
 *  §M  **Deleting a rule never deletes what it paid.** The ledger is append-only and an award
 *      is never revoked (§1 rule 4). A foreign key with a cascade would have looked tidy and
 *      would erase a યુવક's history the day a સંચાલક tidied his rule list.
 *
 *  §N  **Idempotency is an index, not a check.** Both sides: through the function (ON CONFLICT
 *      DO NOTHING, returns 0, raises nothing) and through a raw INSERT (23505). A check in the
 *      function would lose the race; an index decides it (0021:288-294).
 *
 *  §O  **`my_point_history()` and `my_point_totals()` answer for the caller and nobody else.**
 *      Neither takes a p_user, because a p_user is a value a browser chooses. The totals are
 *      the ledger's own sum, reconciled here against `sum(point_transactions.points)`, because
 *      the one guarantee a total has is that it is not stored anywhere.
 *
 *  §P  **The સંચાલક surfaces, and who may reach them.** Reading the rules is `progress.read`
 *      and writing them is `settings.update`, and a VIEWER holds the first and not the second.
 *      An unauthorised caller is refused, not shown an empty list (§31).
 *
 *  §Q  **`activity_history` does not print a day twice.** Its points column was a LEFT JOIN
 *      that multiplies once a key can hold more than one payment, which `earn: EVERY` and
 *      every level-scoped BONUS row now make ordinary. This is a live screen: five દર્શન must
 *      be one row of ૧૦૦૦, not five rows of ૧૦૦૦.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { asAnon, asUser, attempt, dockerAvailable, startDatabase } from './lib/pgtest.mjs';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'supabase', 'migrations');
const join = path.join;

let pass = 0;
const fails = [];

const eq = (name, got, want) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) pass++;
  else fails.push(`${name}\n       got  ${g}\n       want ${w}`);
};

/**
 * The statement was refused, with this SQLSTATE.
 *
 * The code is asserted and not only the failure, because '42501' (no grant, or a permission
 * check), '23505' (a unique index), '23514' (a check constraint) and '42883' (no such
 * function) are four different defences. A test that accepted any error would pass on a
 * database where the one being checked had been deleted and another happened to fire.
 */
const refused = (name, res, code) => {
  if (!res.ok && res.code === code) pass++;
  else if (res.ok) fails.push(`${name}\n       got  allowed (${res.count} row(s))\n       want refused ${code}`);
  else fails.push(`${name}\n       got  refused ${res.code}: ${res.message}\n       want refused ${code}`);
};

const group = (name) => console.log(`\n  ${name}`);

// bigint and numeric come back from node-postgres as strings, because they do not fit a JS
// number in general. Comparing '400' against 400 would fail for a reason that has nothing to
// do with the engine.
const num = (v) => (v === null || v === undefined ? null : Number(v));

/** The same object with its keys in a fixed order — see test-point-engine.mjs for why. */
const canonical = (v) => {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, canonical(v[k])])
    );
  }
  return v;
};

// ════════════════════════════════════════════════════════════════════ the population
//
// Every id is a literal, for scripts/test-admin-progress.mjs's reason: a fixture that computes
// its own expectations proves only that it agrees with itself.

const U = {
  // The four engine યુવકો. None carries a committed ledger row, so every assertion in §A-§N is
  // over rows this file's own sandbox just caused to be written.
  alpha: 'a1111111-1111-4111-8111-111111111111',
  beta: 'b2222222-2222-4222-8222-222222222222',
  gamma: 'c3333333-3333-4333-8333-333333333333',
  delta: 'd0000000-0000-4000-8000-000000000000',

  // Three rows written in 0021's shape, before 0031 existed. §K is about these and nothing
  // else may touch them.
  legacy: '1e999999-9999-4999-8999-999999999999',

  // The two reading fixtures. Their ledgers are committed, so §O can be driven as a real
  // signed-in યુવક with RLS enforced rather than as the owner.
  mohan: 'd4444444-4444-4444-8444-444444444444',
  nayan: 'e5555555-5555-4555-8555-555555555555',

  // SUPER_ADMIN: progress.read, users.read AND settings.update.
  admin: '07777777-7777-4777-8777-777777777777',
  // VIEWER: a progress reader who may NOT price the levels, and therefore may not write a
  // bonus rule either. The sharp case for §P — he may read the list and not change it.
  viewer: '18888888-8888-4888-8888-888888888888',
  // CONTENT_MANAGER: holds neither progress.read nor users.read.
  content: '29999999-9999-4999-8999-999999999999',
};

const SCENE = (n) => `d-${String(n).padStart(3, '0')}`;
const RANGE = (a, b) => {
  const out = [];
  for (let i = a; i <= b; i++) out.push(SCENE(i));
  return out;
};

// ૧૦૮ live દ્રશ્યો, because §E's scenario is stated in them, and three withheld so that the
// subtraction stays observable: a tick on a દ્રશ્ય the સંચાલક has taken out of the collection
// is not a tick that may be paid, and admin_withheld_scene_ids() (0029) is the only authority
// Postgres has on the question.
const LIVE = 108;
const WITHHELD = [SCENE(109), SCENE(110), SCENE(111)];

const L4 = [
  ['4.1', 1, [SCENE(1), SCENE(2)]],
  ['4.2', 2, [SCENE(3), SCENE(4)]],
];

const ACT = {};
const FIX = {}; // committed fixture ids the reading tests join against

// The committed ledger, worked out here rather than read back, so §O compares against
// arithmetic and not against itself.
const LEGACY_ROWS = 3;
const LEGACY_POINTS = 100 + 300 + 400; // 800
const MOHAN_BASE = 100 + 200; // 300
const MOHAN_BONUS = 50;
const NAYAN_POINTS = 300;

// ════════════════════════════════════════════════════════════════════ the fixtures

async function fixtures(db) {
  // Everything here runs as the owner, which is what a migration or the seed script is. RLS
  // does not apply, but every trigger still fires — including level4_attempts_award, which is
  // why no settings row is written in this function. With nothing configured `point_value_for`
  // is 0 everywhere and the trigger writes nothing, so the ledger below holds exactly the rows
  // this file chose. Each group configures the rules it needs, inside a transaction it rolls
  // back.

  const people = [
    [U.alpha, 'ALP101', 'Alpha Yuvak', '9811100001', 'surat', 'varachha'],
    [U.beta, 'BET102', 'Beta Yuvak', '9811100002', 'surat', 'varachha'],
    [U.gamma, 'GAM103', 'Gamma Yuvak', '9811100003', 'surat', 'vedroad'],
    [U.delta, 'DEL111', 'Delta Yuvak', '9811100011', 'surat', 'vedroad'],
    [U.legacy, 'LEG104', 'Legacy Yuvak', '9811100004', 'surat', 'varachha'],
    [U.mohan, 'MOH105', 'Mohan Yuvak', '9811100005', 'surat', 'varachha'],
    [U.nayan, 'NAY106', 'Nayan Yuvak', '9811100006', 'surat', 'vedroad'],
    [U.admin, 'ADM108', 'Sanchalak Admin', '9811100008', 'surat', 'varachha'],
    [U.viewer, 'VWR109', 'Sanchalak Viewer', '9811100009', 'surat', 'varachha'],
    [U.content, 'CNT110', 'Sanchalak Content', '9811100010', 'surat', 'varachha'],
  ];
  for (const [id, smk, name, mobile, city, zone] of people) {
    await db.query('insert into auth.users (id, email) values ($1, $2)', [id, `${smk.toLowerCase()}@t.test`]);
    await db.query(
      `insert into public.profiles (id, smk, name, email, mobile, zone_id, sub_zone_id, status)
       values ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE')`,
      [id, smk, name, `${smk.toLowerCase()}@t.test`, mobile, city, zone]
    );
  }

  await db.query(`insert into public.admin_profiles (id, role, status) values ($1, 'SUPER_ADMIN', 'ACTIVE')`, [U.admin]);
  await db.query(`insert into public.admin_profiles (id, role, status) values ($1, 'VIEWER', 'ACTIVE')`, [U.viewer]);
  await db.query(`insert into public.admin_profiles (id, role, status) values ($1, 'CONTENT_MANAGER', 'ACTIVE')`, [
    U.content,
  ]);

  await db.query(
    `insert into public.scenes (id, "index", "order", active, caption)
     select 'd-' || lpad(g::text, 3, '0'), g, g, true, 'scene ' || g
     from generate_series(1, $1) g`,
    [LIVE]
  );
  // Withheld: `active = false`, which 0004's sync trigger turns into status DISABLED, which is
  // precisely what admin_withheld_scene_ids() tests for.
  await db.query(
    `insert into public.scenes (id, "index", "order", active, caption)
     select 'd-' || lpad(g::text, 3, '0'), g, g, false, 'scene ' || g
     from generate_series($1::int, $2::int) g`,
    [LIVE + 1, LIVE + WITHHELD.length]
  );

  const cfg = (await db.query(`insert into public.level4_configs (status, version) values ('DRAFT', 1) returning id`))
    .rows[0].id;
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

  // ── the legacy rows ─────────────────────────────────────────────────────────
  //
  // 0021's INSERT, reproduced **verbatim** — the same eight columns in the same order, and
  // nothing else. That is what makes these rows legacy in the only sense the schema knows: all
  // seven columns 0031 added are left at their default, which is NULL. It is also §K's control:
  // a row written by this statement and a row written by the engine under an untouched
  // configuration must agree on every column 0021 knew about.
  const legacy21 = (user, daysAgo, level, key, points, source, sourceId, nth) =>
    db.query(
      `insert into public.point_transactions
         (user_id, activity_date, level_id, activity_key, points, source, source_id, attempt_number)
       values
         ($1, (timezone('Asia/Kolkata', now())::date - $2::int), $3, $4, $5, $6, $7, $8)`,
      [user, daysAgo, level, key, points, source, sourceId, nth]
    );

  await legacy21(U.legacy, 5, 1, 'video', 100, 'ACTIVITY_ATTEMPT', 9001, 1);
  await legacy21(U.legacy, 5, 3, 'revision', 300, 'ACTIVITY_ATTEMPT', 9002, 1);
  await legacy21(U.legacy, 4, 4, '4.1', 400, 'LEVEL4_ATTEMPT', 9003, 1);

  // ── the reading population, committed ───────────────────────────────────────
  //
  // One real bonus rule and one award it paid, so §O can be driven as a signed-in યુવક rather
  // than as the owner — the point of those two functions is who may call them.
  //
  // The rule is deliberately scoped to a કસોટી code that no configuration contains, so that it
  // is enabled (and therefore readable, and counted by admin_bonus_rules) while matching no
  // event any group below can produce. A committed rule that *did* match would be evaluated
  // inside every sandbox and every arithmetic in this file would be about it as well.
  FIX.rule = (
    await db.query(
      `insert into public.point_bonus_rules
         (name, level_id, activity_key, trigger_type, threshold, bonus_points, reward_mode)
       values ('Fixture milestone', 4, '4.9', 'COMPLETION_COUNT', 5, 50, 'EVERY')
       returning id`
    )
  ).rows[0].id;

  const paid = (user, daysAgo, level, key, points, kind, idem) =>
    db.query(
      `insert into public.point_transactions
         (user_id, activity_date, level_id, activity_key, points, source, source_id,
          attempt_number, award_kind, rule_version, idempotency_key, event_ref)
       values ($1, (timezone('Asia/Kolkata', now())::date - $2::int), $3, $4, $5,
               'ACTIVITY_ATTEMPT', 0, 1, $6, 1, $7, coalesce($7, 'ACTIVITY_ATTEMPT:0'))`,
      [user, daysAgo, level, key, points, kind, idem]
    );

  await paid(U.mohan, 2, 1, 'video', 100, 'DAY_FIRST', null);
  await paid(U.mohan, 1, 2, 'darshan', 200, 'DAY_FIRST', null);
  await paid(U.mohan, 1, 1, 'video', MOHAN_BONUS, 'BONUS', `bonus:${FIX.rule}:${U.mohan}:1`);
  await paid(U.nayan, 1, 3, 'revision', NAYAN_POINTS, 'DAY_FIRST', null);
}

// ════════════════════════════════════════════════════════════════════ the harness

async function main() {
  if (!dockerAvailable()) {
    console.log('\n  SKIPPED — no docker daemon. This suite needs one to be honest.\n');
    console.log('  Nothing was verified. Do not read a green build as a passing suite.\n');
    process.exitCode = 2;
    return;
  }

  const { client: db, stop, files } = await startDatabase();
  try {
    await fixtures(db);
    await run(db, files);
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

async function run(db, files) {
  /**
   * One scenario, inside a transaction that is always rolled back.
   *
   * The rollback is what keeps a group from leaving a row for the next one to trip over — the
   * ledger is append-only and has no delete path, so without it the second group would be
   * reading the first one's awards.
   */
  const sandbox = async (fn) => {
    await db.query('begin');
    try {
      return await fn();
    } finally {
      await db.query('rollback').catch(() => {});
    }
  };

  /**
   * A statement that is expected to be refused, run inside a savepoint.
   *
   * A refused statement aborts the transaction it is in, so every later statement in the same
   * sandbox would come back as 25P02 and the group would report a cascade of failures whose
   * only cause is the first one.
   */
  const soft = async (sql, params = []) => {
    await db.query('savepoint probe');
    const res = await attempt(db, sql, params);
    await db.query(res.ok ? 'release savepoint probe' : 'rollback to savepoint probe');
    return res;
  };

  /** Who `auth.uid()` answers, for the length of this transaction. */
  const signIn = (uid) =>
    db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: 'authenticated' })]);

  /**
   * Write settings['levels'].value.points.
   *
   * Through an ordinary INSERT, so `settings_check_points` fires — a configuration this file
   * could not have saved through the panel is not a configuration worth asserting under.
   */
  const configure = (points, extra = {}) =>
    db.query(
      `insert into public.settings (key, value) values ('levels', $1::jsonb)
       on conflict (key) do update set value = excluded.value`,
      [JSON.stringify({ ...extra, points })]
    );

  const tryConfigure = (points) =>
    soft(
      `insert into public.settings (key, value) values ('levels', $1::jsonb)
       on conflict (key) do update set value = excluded.value`,
      [JSON.stringify({ points })]
    );

  /** The base configuration: 0021's four numbers and nothing 0031 or 0033 added. */
  const BASE = { enabled: true, level1: 100, level2: 200, level3: 300, level4: { default: 400, '4.1': 450 } };

  const submit = async (level, key, scenes, total, token = null) =>
    (
      await db.query('select public.activity_submit($1, $2, $3::text[], $4, $5::uuid) r', [
        level,
        key,
        scenes,
        total,
        token,
      ])
    ).rows[0].r;

  /** A લેવલ ૪ attempt, which is the only thing that fires level4_attempts_award. */
  const exam = async (user, code, passed, daysAgo = 0, items = null) =>
    Number(
      (
        await db.query(
          `insert into public.level4_attempts
             (user_id, activity_id, config_id, selected_scene_ids, selected_count, required_count, passed, at)
           values ($1, $2, $3, $4, $5, $6, $7,
                   ((timezone('Asia/Kolkata', now())::date - $8::int) + time '11:00')
                     at time zone 'Asia/Kolkata')
           returning id`,
          [
            user,
            ACT[code],
            ACT.config,
            items ?? L4.find((a) => a[0] === code)[2],
            (items ?? L4.find((a) => a[0] === code)[2]).length,
            (items ?? L4.find((a) => a[0] === code)[2]).length,
            passed,
            daysAgo,
          ]
        )
      ).rows[0].id
    );

  /** One લેવલ ૧-૩ submission written directly, for the histories a scenario needs to start from. */
  const seedAttempt = (user, level, key, nth, scenes = []) =>
    db.query(
      `insert into public.activity_attempts
         (user_id, level_id, activity_key, activity_date, attempt_number,
          selected_scene_ids, total_items, completed_items, status)
       values ($1, $2, $3, timezone('Asia/Kolkata', now())::date, $4, $5, $6, $6, 'COMPLETED')`,
      [user, level, key, nth, scenes, scenes.length]
    );

  /** One milestone rule, as the સંચાલક's panel would leave it. */
  const rule = async (o) =>
    (
      await db.query(
        `insert into public.point_bonus_rules
           (name, level_id, activity_key, trigger_type, threshold, bonus_points, reward_mode, enabled)
         values ($1, $2, $3, $4, $5, $6, $7, coalesce($8, true)) returning id`,
        [
          o.name ?? 'milestone',
          o.level ?? null,
          o.activity ?? null,
          o.trigger ?? 'COMPLETION_COUNT',
          o.threshold,
          o.points,
          o.mode ?? 'EVERY',
          o.enabled ?? null,
        ]
      )
    ).rows[0].id;

  /** The ledger for one યુવક, every column, oldest first. */
  const ledger = async (uid) =>
    (
      await db.query(
        `select id, activity_date::text as activity_date, level_id, activity_key, points, source,
                source_id, attempt_number, award_kind, rule_version, reason, admin_id,
                idempotency_key, event_ref, attempt_id
         from public.point_transactions where user_id = $1 order by id`,
        [uid]
      )
    ).rows.map((r) => ({ ...r, source_id: num(r.source_id), attempt_id: num(r.attempt_id) }));

  /** Just the money, for the many assertions that are about the amount and the kind. */
  const paidRows = async (uid) =>
    (await ledger(uid)).map((r) => [r.level_id, r.activity_key, r.points, r.award_kind]);

  const bonusRows = async (uid) => (await ledger(uid)).filter((r) => r.award_kind === 'BONUS');

  const total = async (uid) => (await ledger(uid)).reduce((n, r) => n + r.points, 0);

  const history = async (uid) =>
    (
      await db.query(
        `select activity_date::text as activity_date, level_id, activity_key, attempt_count,
                points, bonus_points
         from public.activity_history where user_id = $1
         order by activity_date, level_id, activity_key`,
        [uid]
      )
    ).rows;

  const day = async (n) =>
    (await db.query(`select (timezone('Asia/Kolkata', now())::date - $1::int)::text d`, [n])).rows[0].d;

  const TODAY = await day(0);

  // ══════════════════════════════════════════════════════ §0 the migration
  group('§0  0033 applied, applies again, and built what it said it would');

  eq('every migration in supabase/migrations applied, 0033 among them', files.includes('0033_point_bonus_engine.sql'), true);

  {
    /*
      The file can be applied **again**, on a database that already has it.

      Not a theoretical property. 0031 reached production, 0032 failed behind it on a reserved
      keyword, and re-running 0031 to carry the fix stopped at 42710 because `add constraint`
      has no `if not exists`. A migration that cannot be re-applied is a migration that cannot
      be corrected. The row count and sum are checked either side because an idempotent
      *schema* change that quietly rewrote data would pass a "no error" test and fail the one
      that matters (§J1).
    */
    const before = (
      await db.query(
        `select count(*)::int n, coalesce(sum(points), 0)::int p,
                count(*) filter (where award_kind is null)::int legacy
         from public.point_transactions`
      )
    ).rows[0];

    const sql = readFileSync(join(MIGRATIONS, '0033_point_bonus_engine.sql'), 'utf8');
    const res = await attempt(db, sql);
    eq('0033 applies cleanly a second time', res.ok ? 'ok' : `${res.code} ${res.message}`, 'ok');

    const after = (
      await db.query(
        `select count(*)::int n, coalesce(sum(points), 0)::int p,
                count(*) filter (where award_kind is null)::int legacy
         from public.point_transactions`
      )
    ).rows[0];
    eq('and re-applying it moves no row, no point and no legacy row', after, before);

    eq(
      'the milestone rules it holds are untouched by the re-apply',
      (await db.query('select count(*)::int n from public.point_bonus_rules')).rows[0].n,
      1
    );
  }

  eq(
    'BONUS is the sixth award kind the ledger accepts',
    (
      await db.query(
        `select pg_get_constraintdef(oid) d from pg_constraint
         where conname = 'point_transactions_kind_check'`
      )
    ).rows[0].d.includes("'BONUS'"),
    true
  );

  eq(
    'point_bonus_rules carries the columns 0033 declares',
    (
      await db.query(
        `select column_name, is_nullable from information_schema.columns
         where table_schema = 'public' and table_name = 'point_bonus_rules'
         order by column_name`
      )
    ).rows.map((r) => [r.column_name, r.is_nullable]),
    [
      ['activity_key', 'YES'],
      ['bonus_points', 'NO'],
      ['created_at', 'NO'],
      ['created_by', 'YES'],
      ['enabled', 'NO'],
      ['id', 'NO'],
      ['level_id', 'YES'],
      ['name', 'NO'],
      ['reward_mode', 'NO'],
      ['threshold', 'NO'],
      ['trigger_type', 'NO'],
      ['updated_at', 'NO'],
    ]
  );

  eq(
    'and the six checks that keep a rule meaningful',
    (
      await db.query(
        `select conname from pg_constraint
         where conrelid = 'public.point_bonus_rules'::regclass and contype = 'c'
         order by conname`
      )
    ).rows.map((r) => r.conname),
    [
      'point_bonus_rules_level_check',
      'point_bonus_rules_mode_check',
      'point_bonus_rules_name_check',
      'point_bonus_rules_points_check',
      'point_bonus_rules_threshold_check',
      'point_bonus_rules_trigger_check',
    ]
  );

  eq(
    'every function 0033 promises exists',
    (
      await db.query(
        `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.proname in ('point_bonus_count','point_bonus_apply','my_point_history',
                             'my_point_totals','admin_bonus_rules','admin_bonus_rule_save',
                             'admin_bonus_rule_delete')
         order by p.proname`
      )
    ).rows.map((r) => r.proname),
    [
      'admin_bonus_rule_delete',
      'admin_bonus_rule_save',
      'admin_bonus_rules',
      'admin_bonus_rules',
      'my_point_history',
      'my_point_totals',
      'point_bonus_apply',
      'point_bonus_count',
    ].filter((v, i, a) => a.indexOf(v) === i)
  );

  eq(
    'an untouched project resolves earn to DEFAULT_EARN, which is the behaviour of the day before 0033',
    canonical((await db.query('select public.point_rules() -> $1 r', ['earn'])).rows[0].r),
    canonical({
      level1: 'DAY_FIRST',
      level2: 'DAY_FIRST',
      level3: 'DAY_FIRST',
      level4: 'DAY_FIRST',
      tickCount: 'FRESH',
    })
  );

  await sandbox(async () => {
    refused(
      'an earning mode nobody defined is refused at the moment it is saved',
      await tryConfigure({ ...BASE, earn: { level1: 'SOMETIMES' } }),
      '23514'
    );
    refused(
      'and a tick counting mode nobody defined',
      await tryConfigure({ ...BASE, earn: { tickCount: 'MOST' } }),
      '23514'
    );
    refused(
      'and a key inside earn that is neither one of the four levels nor tickCount',
      await tryConfigure({ ...BASE, earn: { levl2: 'EVERY' } }),
      '23514'
    );
    refused(
      'including a level this app does not have',
      await tryConfigure({ ...BASE, earn: { level5: 'EVERY' } }),
      '23514'
    );
    const ok = await tryConfigure({ ...BASE, earn: { level2: 'EVERY', tickCount: 'ALL' } });
    eq('a well-formed earn block saves', ok.ok, true);
  });

  await sandbox(async () => {
    /*
      The resolver forgives what the validator refuses, and it forgives in the SAFE direction.

      The trigger is switched off for one statement so that a row the panel could not have
      written — an older build's spelling, a hand-run SQL patch — can be stored and read back.
      A mode nobody defined must resolve to DAY_FIRST and never to EVERY: a typo that started
      paying a યુવક five times a day would be a defect nobody notices until the leaderboard is
      wrong, and this is the direction 0021's header argues for at length.
    */
    await db.query('alter table public.settings disable trigger settings_check_points');
    await configure({ ...BASE, earn: { level1: 'SOMETIMES', tickCount: 'MOST' } });
    await db.query('alter table public.settings enable trigger settings_check_points');

    eq(
      'a stored mode nobody defined resolves to DAY_FIRST, never to the more generous reading',
      canonical((await db.query('select public.point_rules() -> $1 r', ['earn'])).rows[0].r),
      canonical({
        level1: 'DAY_FIRST',
        level2: 'DAY_FIRST',
        level3: 'DAY_FIRST',
        level4: 'DAY_FIRST',
        tickCount: 'FRESH',
      })
    );

    await signIn(U.alpha);
    await submit(1, 'video', [], 0);
    const second = await submit(1, 'video', [], 0);
    eq('and the engine pays it as 0021 would — once for the day', [second.pointsAwarded, (await paidRows(U.alpha)).length], [0, 1]);
  });

  // ══════════════════════════════════════════════════════ §A
  group('§A  લેવલ ૧ at 100 a completion under earn.level1 = EVERY');

  await sandbox(async () => {
    await configure({ ...BASE, earn: { level1: 'EVERY' } });
    await signIn(U.alpha);

    const one = await submit(1, 'video', [], 0);
    eq('one completion is 100', one.pointsAwarded, 100);

    for (let i = 0; i < 4; i++) await submit(1, 'video', [], 0);
    eq('five completions in one day are 5 rows', (await paidRows(U.alpha)).length, 5);
    eq('and 500 ગુણ, which the day rule alone could never have paid', await total(U.alpha), 500);
    eq(
      'each is a REPEAT keyed on its own attempt, so the day index never applies',
      (await ledger(U.alpha)).map((r) => [r.award_kind, r.idempotency_key.startsWith('every:ACTIVITY_ATTEMPT:')]),
      [
        ['REPEAT', true],
        ['REPEAT', true],
        ['REPEAT', true],
        ['REPEAT', true],
        ['REPEAT', true],
      ]
    );
    eq('and every key is distinct — five events, five keys', new Set((await ledger(U.alpha)).map((r) => r.idempotency_key)).size, 5);

    // લેવલ ૨ was not given a mode and is therefore untouched: EVERY is a rule about the level
    // it names and not a switch on the system.
    await submit(2, 'darshan', [], 0);
    const again = await submit(2, 'darshan', [], 0);
    eq('લેવલ ૨, with no mode of its own, still pays once a day', [again.pointsAwarded, (await paidRows(U.alpha)).length], [0, 6]);
  });

  // ══════════════════════════════════════════════════════ §B
  group('§B  and a rule "every 5 completions is worth 200 more"');

  await sandbox(async () => {
    await configure({ ...BASE, earn: { level1: 'EVERY' } });
    await rule({ name: 'Every fifth video', level: 1, activity: 'video', threshold: 5, points: 200, mode: 'EVERY' });
    await signIn(U.alpha);

    for (let i = 0; i < 4; i++) await submit(1, 'video', [], 0);
    eq('four completions have not reached the milestone', await total(U.alpha), 400);
    eq('and no BONUS row exists yet', (await bonusRows(U.alpha)).length, 0);

    const fifth = await submit(1, 'video', [], 0);
    eq('the fifth pays its own 100 and the milestone\'s 200 in one answer to the યુવક', fifth.pointsAwarded, 300);
    eq('the day totals 700', await total(U.alpha), 700);
    eq('as five REPEAT rows and one BONUS', await paidRows(U.alpha), [
      [1, 'video', 100, 'REPEAT'],
      [1, 'video', 100, 'REPEAT'],
      [1, 'video', 100, 'REPEAT'],
      [1, 'video', 100, 'REPEAT'],
      [1, 'video', 100, 'REPEAT'],
      [1, 'video', 200, 'BONUS'],
    ]);
    eq(
      'whose key names the rule, the યુવક and the milestone number, which is what stops it paying twice',
      (await bonusRows(U.alpha))[0].idempotency_key.split(':').slice(2),
      [U.alpha, '1']
    );

    const sixth = await submit(1, 'video', [], 0);
    eq('the sixth is worth its 100 alone — the next milestone is the tenth', sixth.pointsAwarded, 100);
    eq('and there is still exactly one BONUS row', (await bonusRows(U.alpha)).length, 1);

    for (let i = 0; i < 4; i++) await submit(1, 'video', [], 0);
    eq('the tenth pays the second milestone', (await bonusRows(U.alpha)).length, 2);
    eq('and the day is 10 x 100 + 2 x 200', await total(U.alpha), 1400);
  });

  // ══════════════════════════════════════════════════════ §C
  group('§C  લેવલ ૨ at 200 under EVERY — five દર્શન are five awards');

  await sandbox(async () => {
    await configure({ ...BASE, earn: { level2: 'EVERY' } });
    await signIn(U.beta);
    for (let i = 0; i < 5; i++) await submit(2, 'darshan', [], 0);
    eq('five દર્શન sessions in a day are 1000', await total(U.beta), 1000);
    eq('as five rows and not one', (await paidRows(U.beta)).length, 5);
  });

  // ══════════════════════════════════════════════════════ §D
  group('§D  the same five દર્શન with the 5-completion milestone');

  await sandbox(async () => {
    await configure({ ...BASE, earn: { level2: 'EVERY' } });
    await rule({ name: 'Every fifth darshan', level: 2, activity: 'darshan', threshold: 5, points: 200 });
    await signIn(U.beta);
    for (let i = 0; i < 5; i++) await submit(2, 'darshan', [], 0);
    eq('the day totals 1200', await total(U.beta), 1200);
    eq('one BONUS row of 200 beside the five awards', await paidRows(U.beta), [
      [2, 'darshan', 200, 'REPEAT'],
      [2, 'darshan', 200, 'REPEAT'],
      [2, 'darshan', 200, 'REPEAT'],
      [2, 'darshan', 200, 'REPEAT'],
      [2, 'darshan', 200, 'REPEAT'],
      [2, 'darshan', 200, 'BONUS'],
    ]);
    eq(
      'and the BONUS is filed under the level and activity that earned it, never under level 0',
      (await bonusRows(U.beta)).map((r) => [r.level_id, r.activity_key]),
      [[2, 'darshan']]
    );
  });

  // ══════════════════════════════════════════════════════ §E
  group('§E  લેવલ ૩ per દ્રશ્ય — 108 ticks, then 10 more under ALL and under FRESH');

  await sandbox(async () => {
    await configure({ ...BASE, tick: { mode: 'TICK', perTick: 1 } });
    await signIn(U.gamma);

    const all108 = await submit(3, 'revision', RANGE(1, LIVE), LIVE);
    eq('108 દ્રશ્યો at 1 each is 108', all108.pointsAwarded, LIVE);

    // The default is FRESH, which is 0031's rule: nothing already named today is paid again.
    const fresh = await submit(3, 'revision', RANGE(1, 10), 10);
    eq('under FRESH the same 10 pay nothing — they were already brought to mind today', fresh.pointsAwarded, 0);
    eq('and no second row is written', await total(U.gamma), LIVE);

    // The same submission under ALL. Every valid દ્રશ્ય in it is paid, whatever an earlier one
    // named — which is the entire difference between the two modes.
    await configure({ ...BASE, tick: { mode: 'TICK', perTick: 1 }, earn: { tickCount: 'ALL' } });
    const all = await submit(3, 'revision', RANGE(1, 10), 10);
    eq('under ALL the same 10 are worth 10', all.pointsAwarded, 10);
    eq('so the day reads 118', await total(U.gamma), LIVE + 10);
    eq('as two TICK rows', await paidRows(U.gamma), [
      [3, 'revision', LIVE, 'TICK'],
      [3, 'revision', 10, 'TICK'],
    ]);

    // ALL still subtracts what the સંચાલક has withheld, and still counts one દ્રશ્ય once
    // inside one submission: it is a rule about earlier attempts, not about validity.
    const withWithheld = await submit(3, 'revision', [...RANGE(1, 5), ...WITHHELD, SCENE(1)], 8);
    eq('a submission of 5 live, 3 withheld and one repeat of its own is worth 5', withWithheld.pointsAwarded, 5);
  });

  await sandbox(async () => {
    // A milestone over દ્રશ્યો rather than over completions: the same rule engine, a different
    // count, and no code anywhere that knows how large the collection is.
    await configure({ ...BASE, tick: { mode: 'TICK', perTick: 1 } });
    await rule({ name: 'Every 50 scenes', level: 3, trigger: 'ITEM_COUNT', threshold: 50, points: 25 });
    await signIn(U.delta);
    const r = await submit(3, 'revision', RANGE(1, LIVE), LIVE);
    eq('108 દ્રશ્યો crosses the 50 and the 100 milestone in one act', (await bonusRows(U.delta)).length, 2);
    eq('and the submission reports the ticks and both milestones together', r.pointsAwarded, LIVE + 50);
  });

  // ══════════════════════════════════════════════════════ §F
  group('§F  the same submission sent twice is one transaction');

  await sandbox(async () => {
    await configure({ ...BASE, earn: { level2: 'EVERY' } });
    await signIn(U.alpha);

    const TOKEN = '11111111-2222-4333-8444-555555555555';
    const t1 = await submit(2, 'darshan', [], 0, TOKEN);
    const t2 = await submit(2, 'darshan', [], 0, TOKEN);
    eq('both calls report 200', [t1.pointsAwarded, t2.pointsAwarded], [200, 200]);
    eq('and the retry reports the original attempt, not a new one', t1.attemptNumber, t2.attemptNumber);
    eq('one row, 200 ગુણ', [(await paidRows(U.alpha)).length, await total(U.alpha)], [1, 200]);

    // And through the engine directly, which is where a second phone would arrive: the same
    // event, twice, with no client token to catch it first.
    const src = (await ledger(U.alpha))[0].source_id;
    const twice = await soft(
      `select public.award_points($1, $2::date, 2, 'darshan', 'ACTIVITY_ATTEMPT', $3, 1) p`,
      [U.alpha, TODAY, src]
    );
    eq('award_points called again for the same event raises nothing and returns 0', [twice.ok, twice.rows?.[0]?.p], [true, 0]);
    eq('and there is still one row', (await paidRows(U.alpha)).length, 1);
  });

  // ══════════════════════════════════════════════════════ §G
  group('§G  a milestone reached, then the same submission again, is one BONUS row');

  await sandbox(async () => {
    await configure({ ...BASE, earn: { level1: 'EVERY' } });
    const rid = await rule({ name: 'Fifth video', level: 1, activity: 'video', threshold: 5, points: 200 });
    await signIn(U.alpha);

    const TOKEN = '22222222-3333-4444-8555-666666666666';
    for (let i = 0; i < 4; i++) await submit(1, 'video', [], 0);
    const fifth = await submit(1, 'video', [], 0, TOKEN);
    eq('the fifth reaches the milestone', fifth.pointsAwarded, 300);
    eq('one BONUS row', (await bonusRows(U.alpha)).length, 1);

    const replay = await submit(1, 'video', [], 0, TOKEN);
    eq('the same submission again is a replay and writes nothing', (await paidRows(U.alpha)).length, 6);
    eq('and reports what that attempt was paid at the time', replay.attemptNumber, fifth.attemptNumber);
    eq('still exactly one BONUS row', (await bonusRows(U.alpha)).length, 1);

    // The sharper case: the engine asked twice about the same event, which is what two devices
    // and a lost response both look like from here.
    const src = (await ledger(U.alpha))[4].source_id;
    const again = await soft(
      `select public.award_points($1, $2::date, 1, 'video', 'ACTIVITY_ATTEMPT', $3, 5) p`,
      [U.alpha, TODAY, src]
    );
    eq('award_points over the same event again returns 0 and raises nothing', [again.ok, again.rows?.[0]?.p], [true, 0]);
    eq('the milestone was paid once and stays paid once', (await bonusRows(U.alpha)).length, 1);
    eq(
      'because the key is the rule, the યુવક and the milestone number — never the moment it was noticed',
      (await bonusRows(U.alpha))[0].idempotency_key,
      `bonus:${rid}:${U.alpha}:1`
    );
  });

  // ══════════════════════════════════════════════════════ §H
  group('§H  thresholds 5, 10 and 20 under EVERY, FIRST_ONLY and HIGHEST_ONLY');

  /*
    All three are driven the same way and differ only in `reward_mode`: N-1 completed
    submissions are seeded, then one real નોંધાવો is made through activity_submit(), so the
    count jumps from 0 to N in a single evaluation. That is the case that tells the three modes
    apart — crossing the tiers a week apart would make HIGHEST_ONLY and FIRST_ONLY look
    identical, because at each of those moments the યુવક was at his highest.

    ૧૯ is the count the panel prints in its own worked payout table, and it is the sharpest of
    the three: the ૨૦-rule has not been reached, so HIGHEST_ONLY has to pick the ૧૦ and not
    simply "the largest rule there is".
  */
  const tiers = async (uid, mode, count) => {
    await configure(BASE);
    await rule({ name: 'tier 5', level: 1, activity: 'video', threshold: 5, points: 10, mode });
    await rule({ name: 'tier 10', level: 1, activity: 'video', threshold: 10, points: 20, mode });
    await rule({ name: 'tier 20', level: 1, activity: 'video', threshold: 20, points: 40, mode });
    for (let n = 1; n < count; n++) await seedAttempt(uid, 1, 'video', n);
    await signIn(uid);
    await submit(1, 'video', [], 0);
    const rows = await bonusRows(uid);
    return [rows.length, rows.reduce((n, r) => n + r.points, 0)];
  };

  // [rows, points] at a count of 19 and at a count of 20, worked out on paper:
  //   EVERY        19 → 5-rule x3, 10-rule x1        20 → 5-rule x4, 10-rule x2, 20-rule x1
  //   FIRST_ONLY   19 → 5, 10                        20 → 5, 10, 20
  //   HIGHEST_ONLY 19 → 10 alone                     20 → 20 alone
  const TIERS = [
    ['EVERY', 'pays at every multiple of each rule', [4, 3 * 10 + 20], [7, 4 * 10 + 2 * 20 + 40]],
    ['FIRST_ONLY', 'pays each reached rule exactly once', [2, 10 + 20], [3, 10 + 20 + 40]],
    ['HIGHEST_ONLY', 'pays the highest reached rule alone', [1, 20], [1, 40]],
  ];

  for (const [mode, what, at19, at20] of TIERS) {
    await sandbox(async () => {
      eq(`${mode} at a count of 19 — it ${what}`, await tiers(U.alpha, mode, 19), at19);
    });
    await sandbox(async () => {
      eq(`${mode} at a count of 20, where the 20-rule is reached too`, await tiers(U.beta, mode, 20), at20);
    });
  }

  eq(
    'and the three modes disagree at 19, which is why the panel prints that example',
    TIERS.map(([, , at19]) => at19),
    [
      [4, 50],
      [2, 30],
      [1, 20],
    ]
  );

  await sandbox(async () => {
    // The three modes are per rule, not per project: a HIGHEST_ONLY rule is only superseded by
    // another HIGHEST_ONLY rule of its own scope and trigger.
    await configure(BASE);
    await rule({ name: 'scoped 5', level: 1, activity: 'video', threshold: 5, points: 10, mode: 'HIGHEST_ONLY' });
    await rule({ name: 'unscoped 20', threshold: 20, points: 40, mode: 'HIGHEST_ONLY' });
    for (let n = 1; n <= 19; n++) await seedAttempt(U.delta, 1, 'video', n);
    await signIn(U.delta);
    await submit(1, 'video', [], 0);
    eq(
      'a rule scoped to (level 1, video) and one scoped to everything are two scopes, and both pay',
      (await bonusRows(U.delta)).map((r) => r.points).sort((a, b) => a - b),
      [10, 40]
    );
  });

  // ══════════════════════════════════════════════════════ §I
  group('§I  લેવલ ૨ repriced from 200 to 250 — the paid row still reads 200');

  await sandbox(async () => {
    await configure({ ...BASE, level2: 200, earn: { level2: 'EVERY' } });
    await signIn(U.alpha);
    const first = await submit(2, 'darshan', [], 0);

    await configure({ ...BASE, level2: 250, earn: { level2: 'EVERY' } });
    const second = await submit(2, 'darshan', [], 0);

    eq('the first submission was paid 200 and the second 250', [first.pointsAwarded, second.pointsAwarded], [200, 250]);
    eq('and the ledger holds both numbers, neither rewritten', (await ledger(U.alpha)).map((r) => r.points), [200, 250]);
    eq(
      'because a row stores the number that was paid, never a pointer to the rule',
      await total(U.alpha),
      450
    );
  });

  // ══════════════════════════════════════════════════════ §J
  group('§J  a કસોટી created today is priced and scored with no code change');

  await sandbox(async () => {
    await configure({ ...BASE, level4: { default: 400, '4.1': 450 } });
    await signIn(U.admin);

    // The real flow, not a shortcut: a PUBLISHED configuration is frozen (0010), so the
    // સંચાલક clones it, adds ૪.૫ and publishes the copy. Five items, not 27, and nine
    // positions in, so nothing in this test agrees with 0033 about how many of either there
    // are.
    const draft = (await db.query('select public.level4_clone_config($1) id', [ACT.config])).rows[0].id;
    const items = RANGE(20, 24);
    const newAct = (
      await db.query(
        `insert into public.level4_activities (config_id, code, title, position, active, required_count)
         values ($1, '4.5', 'Kasoti 4.5', 9, true, $2) returning id`,
        [draft, items.length]
      )
    ).rows[0].id;
    for (let i = 0; i < items.length; i++) {
      await db.query(
        `insert into public.level4_activity_items (activity_id, scene_id, position) values ($1, $2, $3)`,
        [newAct, items[i], i + 1]
      );
    }
    await db.query('select public.level4_publish($1)', [draft]);

    await rule({ name: 'First 4.5', level: 4, activity: '4.5', threshold: 1, points: 60, mode: 'FIRST_ONLY' });

    const sit = (user, activityId, sceneIds, passed) =>
      db.query(
        `insert into public.level4_attempts
           (user_id, activity_id, config_id, selected_scene_ids, selected_count, required_count, passed, at)
         values ($1, $2, $3, $4, $5, $5, $6, now())`,
        [user, activityId, draft, sceneIds, sceneIds.length, passed]
      );

    await sit(U.alpha, newAct, items, true);
    eq('the new કસોટી is priced by level4.default, which nobody had to type for it', await paidRows(U.alpha), [
      [4, '4.5', 400, 'DAY_FIRST'],
      [4, '4.5', 60, 'BONUS'],
    ]);

    eq(
      'and the panel is offered a value for it the moment it is published, with no list of four anywhere',
      (await db.query('select code from public.admin_point_activities() order by code')).rows.map((r) => r.code),
      ['4.1', '4.2', '4.5']
    );

    // The milestone counts the same કસોટી and only that one: a rule scoped to a code is a rule
    // about that code, and the code survives the republication that changed every uuid.
    const one = (await db.query(`select id from public.level4_activities where config_id = $1 and code = '4.1'`, [draft]))
      .rows[0].id;
    await sit(U.alpha, one, [SCENE(1), SCENE(2)], true);
    eq('a pass of 4.1 does not pay 4.5\'s milestone a second time', (await bonusRows(U.alpha)).length, 1);
    eq('and 4.1 is paid by its own entry, under a configuration published a moment ago', (await paidRows(U.alpha)).slice(2), [
      [4, '4.1', 450, 'DAY_FIRST'],
    ]);
  });

  // ══════════════════════════════════════════════════════ §K
  group('§K  the default: no earn key, no milestone rule, and 0021\'s awarding is untouched');

  const legacyBefore = await ledger(U.legacy);
  eq('the fixture holds three rows written by 0021\'s INSERT', legacyBefore.length, LEGACY_ROWS);
  eq('and all seven columns 0031 added are NULL on every one of them', [
    ...new Set(
      legacyBefore.flatMap((r) => [
        r.award_kind,
        r.rule_version,
        r.reason,
        r.admin_id,
        r.idempotency_key,
        r.event_ref,
        r.attempt_id,
      ])
    ),
  ], [null]);
  eq('summing to the reconciliation figure §41 asks never to move', legacyBefore.reduce((n, r) => n + r.points, 0), LEGACY_POINTS);

  await sandbox(async () => {
    await configure(BASE);
    await signIn(U.alpha);

    const r1 = await submit(1, 'video', [], 0);
    const r2 = await submit(2, 'darshan', [], 0);
    const r3 = await submit(3, 'revision', RANGE(1, 5), 5);
    await exam(U.alpha, '4.1', true);

    eq('લેવલ ૧, ૨ and ૩ pay their configured value and say so to the યુવક', [
      r1.pointsAwarded,
      r2.pointsAwarded,
      r3.pointsAwarded,
    ], [100, 200, 300]);

    const rows = await ledger(U.alpha);
    eq('four events, four rows — one per (યુવક, day, level, activity)', rows.length, 4);
    eq('each priced by point_value_for, ૪.૧ by its own entry', rows.map((r) => [r.level_id, r.activity_key, r.points]), [
      [1, 'video', 100],
      [2, 'darshan', 200],
      [3, 'revision', 300],
      [4, '4.1', 450],
    ]);
    eq('every one of them is a DAY_FIRST award', [...new Set(rows.map((r) => r.award_kind))], ['DAY_FIRST']);
    eq('none carries an idempotency key — the day index is their at-most-once rule', [
      ...new Set(rows.map((r) => r.idempotency_key)),
    ], [null]);

    // 0021's own INSERT, run for a different યુવક with the same values. If the engine's row and
    // this one agree on every column 0021 knew about, the awarding did not move.
    await db.query(
      `insert into public.point_transactions
         (user_id, activity_date, level_id, activity_key, points, source, source_id, attempt_number)
       values ($1, $2::date, 3, 'revision', 300, 'ACTIVITY_ATTEMPT', $3, 1)`,
      [U.beta, TODAY, rows[2].source_id]
    );
    const control = (await ledger(U.beta))[0];
    eq(
      'column for column, the engine wrote what 0021\'s INSERT writes',
      [rows[2].activity_date, rows[2].level_id, rows[2].activity_key, rows[2].points, rows[2].source, rows[2].source_id, rows[2].attempt_number],
      [control.activity_date, control.level_id, control.activity_key, control.points, control.source, control.source_id, control.attempt_number]
    );

    const again = await submit(3, 'revision', RANGE(1, 5), 5);
    eq('a second COMPLETED પુનરાવર્તન the same day still earns 0', again.pointsAwarded, 0);
    eq('and writes no row', (await ledger(U.alpha)).length, 4);

    await signIn(U.gamma);
    const partial = await submit(3, 'revision', RANGE(1, 3), 10);
    eq('a REVISION_REQUIRED attempt still earns nothing', [partial.status, partial.pointsAwarded], ['REVISION_REQUIRED', 0]);
    eq('and consumes nothing', (await ledger(U.gamma)).length, 0);
  });

  await sandbox(async () => {
    // Every 0033 rule switched on at once, over the same યુવક and the same days his legacy
    // rows sit on. Nothing may reach them.
    await configure({ ...BASE, earn: { level1: 'EVERY', level2: 'EVERY', level3: 'ONCE', tickCount: 'ALL' } });
    await rule({ name: 'anything', threshold: 1, points: 5, mode: 'EVERY' });
    await signIn(U.legacy);

    await submit(1, 'video', [], 0);
    await submit(1, 'video', [], 0);
    await submit(2, 'darshan', [], 0);
    await submit(3, 'revision', RANGE(1, 6), 6);
    await exam(U.legacy, '4.1', true, 4); // the same IST day as his legacy ૪.૧ row
    await exam(U.legacy, '4.2', true, 0);

    const after = await ledger(U.legacy);
    const stillLegacy = after.filter((r) => r.award_kind === null);
    eq('the engine ran and wrote rows for him', after.length > LEGACY_ROWS, true);
    eq('there are still exactly three legacy rows', stillLegacy.length, LEGACY_ROWS);
    eq('and every column of every one of them is what it was', stillLegacy, legacyBefore);
    eq('their sum has not moved', stillLegacy.reduce((n, r) => n + r.points, 0), LEGACY_POINTS);
  });

  eq(
    'and after every group above, the three legacy rows are still untouched',
    await ledger(U.legacy),
    legacyBefore
  );

  // ══════════════════════════════════════════════════════ §L
  group('§L  ONCE is once in a lifetime, not once a day');

  await sandbox(async () => {
    await configure({ ...BASE, earn: { level1: 'ONCE' } });
    await signIn(U.alpha);

    const first = await submit(1, 'video', [], 0);
    const second = await submit(1, 'video', [], 0);
    eq('the first વિડિયો pays and the second does not', [first.pointsAwarded, second.pointsAwarded], [100, 0]);
    eq('one row, keyed on the યુવક, the level and the activity', (await ledger(U.alpha)).map((r) => r.idempotency_key), [
      `once:${U.alpha}:1:video`,
    ]);

    // Another day. Driven through award_points because activity_submit's date is the server's
    // and cannot be chosen — which is exactly why the mode has to be tested here.
    const later = (
      await db.query(`select public.award_points($1, $2::date, 1, 'video', 'ACTIVITY_ATTEMPT', 90001, 1) p`, [
        U.alpha,
        await day(3),
      ])
    ).rows[0].p;
    eq('a different day pays nothing either — ONCE is for all time', later, 0);
    eq('and the ledger still holds one row', (await paidRows(U.alpha)).length, 1);

    // The key carries the યુવક, so one man finishing લેવલ ૧ cannot spend it for everybody.
    await signIn(U.beta);
    const other = await submit(1, 'video', [], 0);
    eq('another યુવક is paid his own first વિડિયો', other.pointsAwarded, 100);
  });

  // ══════════════════════════════════════════════════════ §M
  group('§M  deleting a rule never deletes what it paid');

  await sandbox(async () => {
    await configure({ ...BASE, earn: { level1: 'EVERY' } });
    const rid = await rule({ name: 'Doomed rule', level: 1, activity: 'video', threshold: 2, points: 70 });
    await signIn(U.alpha);
    await submit(1, 'video', [], 0);
    await submit(1, 'video', [], 0);
    eq('the milestone paid', (await bonusRows(U.alpha)).map((r) => r.points), [70]);

    await signIn(U.admin);
    const res = (await db.query('select public.admin_bonus_rule_delete($1) r', [rid])).rows[0].r;
    eq('the rule is deleted and the સંચાલક is told how many awards it leaves behind', [res.deleted, num(res.awardsKept)], [true, 1]);
    eq('the rule is gone', (await db.query('select count(*)::int n from public.point_bonus_rules where id = $1', [rid])).rows[0].n, 0);
    eq('and the BONUS row it paid is exactly where it was', (await bonusRows(U.alpha)).map((r) => r.points), [70]);

    await signIn(U.alpha);
    const seen = (
      await db.query('select * from public.my_point_history() where is_bonus')
    ).rows;
    eq('the યુવક still sees the payment, with no rule name against it', [seen.length, seen[0].bonus_rule], [1, '']);

    // And the deleted rule stops paying: a third video reaches milestone 3 of a rule that no
    // longer exists, which is nothing at all.
    await submit(1, 'video', [], 0);
    await submit(1, 'video', [], 0);
    eq('and no further milestone is paid by a rule that is gone', (await bonusRows(U.alpha)).length, 1);
  });

  await sandbox(async () => {
    // Switching a rule off is the other half of the same choice, and is usually the one a
    // સંચાલક wants: the awards keep their name.
    await configure({ ...BASE, earn: { level1: 'EVERY' } });
    const rid = await rule({ name: 'Paused rule', level: 1, activity: 'video', threshold: 2, points: 70 });
    await signIn(U.alpha);
    await submit(1, 'video', [], 0);
    await submit(1, 'video', [], 0);
    await db.query('update public.point_bonus_rules set enabled = false where id = $1', [rid]);
    await submit(1, 'video', [], 0);
    await submit(1, 'video', [], 0);
    eq('a disabled rule pays nothing more', (await bonusRows(U.alpha)).length, 1);
    const seen = (await db.query('select * from public.my_point_history() where is_bonus')).rows;
    eq('and the award it already made keeps its name', seen[0].bonus_rule, 'Paused rule');
  });

  // ══════════════════════════════════════════════════════ §N
  group('§N  a duplicate BONUS row is refused by the index, not by a check');

  await sandbox(async () => {
    await configure({ ...BASE, earn: { level1: 'EVERY' } });
    const rid = await rule({ name: 'Race rule', level: 1, activity: 'video', threshold: 1, points: 30 });
    await signIn(U.alpha);
    await submit(1, 'video', [], 0);
    eq('the first act pays the milestone', (await bonusRows(U.alpha)).length, 1);

    // The raw INSERT is what the index is actually for: a second writer would not consult a
    // check inside the function at all, and two concurrent evaluations compute the same key.
    refused(
      'a raw INSERT reusing the milestone key is refused by point_transactions_idem_idx',
      await soft(
        `insert into public.point_transactions
           (user_id, activity_date, level_id, activity_key, points, source, source_id,
            attempt_number, award_kind, idempotency_key)
         values ($1, $2::date, 1, 'video', 30, 'ACTIVITY_ATTEMPT', 999, 1, 'BONUS', $3)`,
        [U.alpha, TODAY, `bonus:${rid}:${U.alpha}:1`]
      ),
      '23505'
    );
    eq('and there is still one BONUS row', (await bonusRows(U.alpha)).length, 1);

    // A different milestone of the same rule is a different key and is allowed, which is what
    // makes EVERY expressible at all.
    const ok = await soft(
      `insert into public.point_transactions
         (user_id, activity_date, level_id, activity_key, points, source, source_id,
          attempt_number, award_kind, idempotency_key)
       values ($1, $2::date, 1, 'video', 30, 'ACTIVITY_ATTEMPT', 999, 1, 'BONUS', $3)`,
      [U.alpha, TODAY, `bonus:${rid}:${U.alpha}:2`]
    );
    eq('a different milestone number under the same rule is a second award', ok.ok, true);

    // And the key that would have been a project-wide milestone if the યુવક were not in it.
    // A second man reaching the same milestone of the same rule must be paid.
    await signIn(U.beta);
    await submit(1, 'video', [], 0);
    eq('another યુવક reaching the same milestone is paid his own', (await bonusRows(U.beta)).map((r) => r.points), [30]);
    eq(
      'under his own key, because point_transactions_idem_idx is global and does not know about users',
      (await bonusRows(U.beta))[0].idempotency_key,
      `bonus:${rid}:${U.beta}:1`
    );

    refused(
      'a BONUS row with no idempotency key is refused by point_transactions_repeatable_needs_key',
      await soft(
        `insert into public.point_transactions
           (user_id, activity_date, level_id, activity_key, points, source, source_id,
            attempt_number, award_kind)
         values ($1, $2::date, 1, 'video', 30, 'ACTIVITY_ATTEMPT', 998, 1, 'BONUS')`,
        [U.alpha, TODAY]
      ),
      '23514'
    );
    refused(
      'and an award kind nobody defined is still refused by point_transactions_kind_check',
      await soft(
        `insert into public.point_transactions
           (user_id, activity_date, level_id, activity_key, points, source, source_id,
            attempt_number, award_kind, idempotency_key)
         values ($1, $2::date, 1, 'video', 30, 'ACTIVITY_ATTEMPT', 997, 1, 'JACKPOT', 'x:1')`,
        [U.alpha, TODAY]
      ),
      '23514'
    );
  });

  // ══════════════════════════════════════════════════════ §O
  group('§O  my_point_history and my_point_totals answer for the caller and nobody else');

  {
    const mine = await asUser(db, U.mohan, async () =>
      (await db.query('select * from public.my_point_history()')).rows
    );
    eq('my_point_history returns its 12 declared columns', Object.keys(mine[0]), [
      'total_rows',
      'id',
      'activity_date',
      'level_id',
      'activity_key',
      'title',
      'award_kind',
      'points',
      'is_bonus',
      'bonus_rule',
      'attempt_number',
      'created_at',
    ]);
    eq('Mohan sees his three rows and no other યુવક\'s', [mine.length, num(mine[0].total_rows)], [3, 3]);
    eq(
      'the BONUS row says it is one and names the rule that paid it',
      mine.filter((r) => r.is_bonus).map((r) => [r.points, r.bonus_rule]),
      [[MOHAN_BONUS, 'Fixture milestone']]
    );
    eq('and the others say they are not', [...new Set(mine.filter((r) => !r.is_bonus).map((r) => r.bonus_rule))], ['']);

    const nayan = await asUser(db, U.nayan, async () =>
      (await db.query('select * from public.my_point_history()')).rows
    );
    eq('Nayan sees his one row, on the same call, with no argument to change', [nayan.length, nayan[0].points], [1, NAYAN_POINTS]);

    refused(
      'and there is no overload that takes a યુવક to be asked about',
      await asUser(db, U.mohan, () => attempt(db, 'select * from public.my_point_history($1::uuid)', [U.nayan])),
      '42883'
    );
    refused(
      'a visitor with no session is refused rather than answered with an empty list',
      await asAnon(db, () => attempt(db, 'select * from public.my_point_history()')),
      '42501'
    );
    refused(
      'and so is a visitor asking for his totals',
      await asAnon(db, () => attempt(db, 'select public.my_point_totals()')),
      '42501'
    );

    const windowed = await asUser(db, U.mohan, async () =>
      (await db.query('select * from public.my_point_history($1::date, $2::date)', [await day(1), await day(1)])).rows
    );
    eq('the date window is inclusive at both ends', windowed.length, 2);

    const paged = await asUser(db, U.mohan, async () => [
      (await db.query('select * from public.my_point_history(null, null, 0, 2)')).rows.length,
      (await db.query('select * from public.my_point_history(null, null, 1, 2)')).rows.length,
      (await db.query('select * from public.my_point_history(null, null, 9, 2)')).rows.length,
    ]);
    eq('it pages, and a page past the end is empty rather than an error', paged, [2, 1, 0]);

    const sweep = await asUser(db, U.mohan, async () => {
      const seen = [];
      for (let p = 0; p < 3; p++)
        for (const r of (await db.query('select * from public.my_point_history(null, null, $1, 2)', [p])).rows)
          seen.push(num(r.id));
      return seen;
    });
    eq('a walk in pages of 2 returns every row', sweep.length, 3);
    eq('exactly once — the order is total, so nothing is shown twice or dropped', new Set(sweep).size, 3);

    const totals = await asUser(db, U.mohan, async () => (await db.query('select public.my_point_totals() r')).rows[0].r);
    eq('my_point_totals splits base from bonus, per level and in the grand total', canonical(totals), canonical({
      levels: [
        { level: 1, base: 100, bonus: MOHAN_BONUS, total: 100 + MOHAN_BONUS },
        { level: 2, base: 200, bonus: 0, total: 200 },
      ],
      base: MOHAN_BASE,
      bonus: MOHAN_BONUS,
      total: MOHAN_BASE + MOHAN_BONUS,
    }));
    eq(
      'and it reconciles exactly with sum(point_transactions.points), because it IS that sum',
      num(totals.total),
      (await ledger(U.mohan)).reduce((n, r) => n + r.points, 0)
    );

    const legacyTotals = await asUser(db, U.legacy, async () =>
      (await db.query('select public.my_point_totals() r')).rows[0].r
    );
    eq(
      'a legacy row counts as base, which is where a row from before the question belongs',
      [num(legacyTotals.base), num(legacyTotals.bonus), num(legacyTotals.total)],
      [LEGACY_POINTS, 0, LEGACY_POINTS]
    );
  }

  await sandbox(async () => {
    // The reconciliation that matters, over rows this file just caused to be written under
    // every mode at once.
    await configure({ ...BASE, earn: { level1: 'EVERY', level2: 'EVERY' } });
    await rule({ name: 'anything', threshold: 3, points: 15, mode: 'EVERY' });
    await signIn(U.alpha);
    for (let i = 0; i < 6; i++) await submit(1, 'video', [], 0);
    await submit(2, 'darshan', [], 0);

    const t = (await db.query('select public.my_point_totals() r')).rows[0].r;
    eq('the totals reconcile with the ledger row for row', num(t.total), await total(U.alpha));
    eq(
      'and base plus bonus is the total',
      num(t.base) + num(t.bonus),
      num(t.total)
    );
    eq(
      'the bonus half is exactly the BONUS rows',
      num(t.bonus),
      (await bonusRows(U.alpha)).reduce((n, r) => n + r.points, 0)
    );
  });

  // ══════════════════════════════════════════════════════ §P
  group('§P  the સંચાલક surfaces, and who may reach them');

  {
    const rows = await asUser(db, U.admin, async () => (await db.query('select * from public.admin_bonus_rules()')).rows);
    eq('admin_bonus_rules returns its 14 declared columns', Object.keys(rows[0]), [
      'id',
      'name',
      'level_id',
      'activity_key',
      'trigger_type',
      'threshold',
      'bonus_points',
      'reward_mode',
      'enabled',
      'created_at',
      'updated_at',
      'awards',
      'points_paid',
      'earners',
    ]);
    eq('with what the rule has actually paid, joined from the ledger', [
      rows.length,
      num(rows[0].awards),
      num(rows[0].points_paid),
      num(rows[0].earners),
    ], [1, 1, MOHAN_BONUS, 1]);

    refused(
      'a CONTENT_MANAGER is refused — no progress.read',
      await asUser(db, U.content, () => attempt(db, 'select * from public.admin_bonus_rules()')),
      '42501'
    );
    eq(
      'and refused with an authorisation error, not an empty list',
      /progress reporting requires/i.test(
        (await asUser(db, U.content, () => attempt(db, 'select * from public.admin_bonus_rules()'))).message
      ),
      true
    );
    refused(
      'an ordinary યુવક is refused',
      await asUser(db, U.alpha, () => attempt(db, 'select * from public.admin_bonus_rules()')),
      '42501'
    );
    refused(
      'and anon',
      await asAnon(db, () => attempt(db, 'select * from public.admin_bonus_rules()')),
      '42501'
    );
    eq(
      'a VIEWER may read the list, because reading it is reporting',
      (await asUser(db, U.viewer, () => attempt(db, 'select * from public.admin_bonus_rules()'))).ok,
      true
    );

    const SAVE = `select public.admin_bonus_rule_save(null, 'New rule', 1, 'video', 'COMPLETION_COUNT', 5, 200, 'EVERY', true)`;
    refused(
      'but he may NOT write one — pricing a milestone is settings.update',
      await asUser(db, U.viewer, () => attempt(db, SAVE)),
      '42501'
    );
    refused(
      'nor delete one',
      await asUser(db, U.viewer, () => attempt(db, 'select public.admin_bonus_rule_delete($1)', [FIX.rule])),
      '42501'
    );
    refused(
      'an ordinary યુવક may not write one either',
      await asUser(db, U.alpha, () => attempt(db, SAVE)),
      '42501'
    );
    refused(
      'and neither may a visitor with no session',
      await asAnon(db, () => attempt(db, SAVE)),
      '42501'
    );
    eq(
      'none of those refusals wrote a rule',
      (await db.query('select count(*)::int n from public.point_bonus_rules')).rows[0].n,
      1
    );

    // The table itself, not only the RPCs: `settings` is writable through PostgREST by anyone
    // has_permission('settings.update') admits, and this table must answer the same way.
    refused(
      'a યુવક cannot insert a rule directly through the table either',
      await asUser(db, U.alpha, () =>
        attempt(
          db,
          `insert into public.point_bonus_rules (name, threshold, bonus_points) values ('mine', 1, 9999)`
        )
      ),
      '42501'
    );
    eq(
      'though he may read the enabled ones, because a milestone he cannot see is one he cannot aim at',
      (await asUser(db, U.alpha, () => attempt(db, 'select id from public.point_bonus_rules'))).count,
      1
    );
  }

  await sandbox(async () => {
    await signIn(U.admin);

    const made = (
      await db.query(
        `select public.admin_bonus_rule_save(null, $1, 2, 'darshan', 'COMPLETION_COUNT', 5, 200, 'EVERY', true) r`,
        ['Fifth darshan']
      )
    ).rows[0].r;
    eq('a SUPER_ADMIN creates a rule and gets the whole row back', [made.name, made.level_id, made.threshold, made.enabled], [
      'Fifth darshan',
      2,
      5,
      true,
    ]);
    eq('stamped with who made it', made.created_by, U.admin);

    const edited = (
      await db.query(
        `select public.admin_bonus_rule_save($1, $2, 2, 'darshan', 'COMPLETION_COUNT', 10, 300, 'FIRST_ONLY', false) r`,
        [made.id, 'Tenth darshan']
      )
    ).rows[0].r;
    eq('and amends it in place, keeping its id', [edited.id === made.id, edited.threshold, edited.reward_mode, edited.enabled], [
      true,
      10,
      'FIRST_ONLY',
      false,
    ]);
    eq(
      'and every write is in the audit trail, one entry per rule',
      (
        await db.query(
          `select action from public.audit_logs where resource_type = 'point_bonus_rules'
           order by id`
        )
      ).rows.map((r) => r.action),
      ['BONUS_RULE_CREATED', 'BONUS_RULE_UPDATED']
    );

    // `now()` is the transaction's clock, so two stamps taken inside one transaction agree —
    // the trigger is asserted by what it refuses instead: a caller cannot write this column,
    // which is why it is a trigger and not a line in the save function (settings.update also
    // opens a direct PostgREST write to this table).
    await db.query(`update public.point_bonus_rules set updated_at = timestamptz '2020-01-01' where id = $1`, [made.id]);
    const stamped = (
      await db.query('select updated_at from public.point_bonus_rules where id = $1', [made.id])
    ).rows[0].updated_at;
    eq('updated_at is stamped by the trigger and cannot be written by the caller', stamped.getFullYear() > 2020, true);

    // The refusals, each naming its bound because saveError() puts this text in front of him.
    for (const [what, sql, params] of [
      ['a name shorter than two characters', `select public.admin_bonus_rule_save(null, 'x', 1, null, 'COMPLETION_COUNT', 5, 10, 'EVERY', true)`, []],
      ['a level outside 1..4', `select public.admin_bonus_rule_save(null, 'name', 9, null, 'COMPLETION_COUNT', 5, 10, 'EVERY', true)`, []],
      ['a trigger nobody defined', `select public.admin_bonus_rule_save(null, 'name', 1, null, 'GUESSWORK', 5, 10, 'EVERY', true)`, []],
      ['a reward mode nobody defined', `select public.admin_bonus_rule_save(null, 'name', 1, null, 'COMPLETION_COUNT', 5, 10, 'SOMETIMES', true)`, []],
      ['a milestone of zero', `select public.admin_bonus_rule_save(null, 'name', 1, null, 'COMPLETION_COUNT', 0, 10, 'EVERY', true)`, []],
      ['a milestone above BONUS_THRESHOLD_MAX', `select public.admin_bonus_rule_save(null, 'name', 1, null, 'COMPLETION_COUNT', 100001, 10, 'EVERY', true)`, []],
      ['a bonus of zero, because `enabled` is how a rule is switched off', `select public.admin_bonus_rule_save(null, 'name', 1, null, 'COMPLETION_COUNT', 5, 0, 'EVERY', true)`, []],
      ['a bonus above BONUS_POINTS_MAX', `select public.admin_bonus_rule_save(null, 'name', 1, null, 'COMPLETION_COUNT', 5, 10001, 'EVERY', true)`, []],
      ['a bonus below BONUS_POINTS_MIN', `select public.admin_bonus_rule_save(null, 'name', 1, null, 'COMPLETION_COUNT', 5, -10001, 'EVERY', true)`, []],
    ]) {
      refused(what + ' is refused', await soft(sql, params), '23514');
    }

    // Negative is deliberately allowed: a milestone may be a correction, which is why 0033
    // widened point_transactions_points_check to admit a negative BONUS beside a negative
    // MANUAL. The panel and the database have to refuse the same values and accept the same
    // values, or one of them is lying to the સંચાલક.
    const penalty = (
      await db.query(
        `select public.admin_bonus_rule_save(null, 'Penalty', 1, 'video', 'COMPLETION_COUNT', 3, -25, 'EVERY', true) r`
      )
    ).rows[0].r;
    eq('a negative milestone saves, because a milestone may be a correction', penalty.bonus_points, -25);
    refused(
      'and amending a rule that does not exist',
      await soft(
        `select public.admin_bonus_rule_save($1, 'name', 1, null, 'COMPLETION_COUNT', 5, 10, 'EVERY', true)`,
        ['00000000-0000-4000-8000-0000000000ff']
      ),
      '23503'
    );
  });

  await sandbox(async () => {
    // And a negative milestone is actually paid negative, all the way into the ledger. If the
    // check constraint had not been widened this would have written nothing at all and the
    // rule would have been a configuration that silently did nothing.
    await configure({ ...BASE, earn: { level1: 'EVERY' } });
    await rule({ name: 'Penalty', level: 1, activity: 'video', threshold: 3, points: -25 });
    await signIn(U.alpha);
    await submit(1, 'video', [], 0);
    await submit(1, 'video', [], 0);
    const third = await submit(1, 'video', [], 0);
    eq('the third act is 100 for the act and -25 for the milestone', third.pointsAwarded, 75);
    eq('and the ledger holds the negative BONUS row', (await bonusRows(U.alpha)).map((r) => r.points), [-25]);
    eq('the day totals 275', await total(U.alpha), 275);
  });

  // ══════════════════════════════════════════════════════ §Q
  group('§Q  activity_history does not print a day twice when a key holds several payments');

  await sandbox(async () => {
    await configure(BASE);
    await signIn(U.alpha);
    await submit(1, 'video', [], 0);
    await submit(2, 'darshan', [], 0);
    await exam(U.alpha, '4.1', true);

    eq(
      'with nothing 0033 adds configured, a day is one row per (level, activity) with what it paid',
      (await history(U.alpha)).map((r) => [r.level_id, r.activity_key, r.attempt_count, r.points, r.bonus_points]),
      [
        [1, 'video', 1, 100, 0],
        [2, 'darshan', 1, 200, 0],
        [4, '4.1', 1, 450, 0],
      ]
    );
  });

  await sandbox(async () => {
    await configure({ ...BASE, earn: { level2: 'EVERY' } });
    await signIn(U.beta);
    for (let i = 0; i < 5; i++) await submit(2, 'darshan', [], 0);

    const rows = await history(U.beta);
    eq('five દર્શન in a day are ONE history row, not five', rows.length, 1);
    eq('carrying five attempts and the summed 1000', [rows[0].attempt_count, rows[0].points, rows[0].bonus_points], [5, 1000, 0]);
    eq('which is the ledger, summed', rows[0].points, await total(U.beta));
  });

  await sandbox(async () => {
    await configure({ ...BASE, earn: { level2: 'EVERY' } });
    await rule({ name: 'Fifth darshan', level: 2, activity: 'darshan', threshold: 5, points: 200 });
    await signIn(U.beta);
    for (let i = 0; i < 5; i++) await submit(2, 'darshan', [], 0);

    const rows = await history(U.beta);
    eq('a BONUS row on the same key adds no duplicate history row', rows.length, 1);
    eq('the day reads 1200, of which 200 is the milestone', [rows[0].points, rows[0].bonus_points], [1200, 200]);
    eq('and the total still reconciles with the ledger', rows[0].points, await total(U.beta));

    // my_point_summary() is the other figure the same screen shows, and it was already a sum.
    const summary = (await db.query('select public.my_point_summary() r')).rows[0].r;
    eq('my_point_summary agrees with it, having always been a sum', [num(summary.today), num(summary.total)], [1200, 1200]);
  });

  await sandbox(async () => {
    // લેવલ ૪, whose half of the view aggregates the attempts on read and joins the ledger the
    // same way. A DAY_FIRST and a REPEAT on one day is the 0031 case that already multiplied.
    await configure({ ...BASE, repeat: { enabled: true, default: 50 } });
    await exam(U.gamma, '4.1', true);
    await exam(U.gamma, '4.1', true);
    const rows = await history(U.gamma);
    eq('two passes of ૪.૧ in a day are one history row', rows.length, 1);
    eq('holding both attempts and both payments', [rows[0].attempt_count, rows[0].points], [2, 500]);
  });
}

await main();
