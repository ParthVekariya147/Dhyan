/**
 * The owner's worked examples, end to end, against a real Postgres —
 * `node scripts/test-scoring-scenarios.mjs`.
 *
 * The report was "the ક્રમાંક board shows a current figure instead of the total". Two things
 * could produce that sentence and they need different answers:
 *
 *   * the **board** sums a window. `leaderboard()` (0023:522) bounds its sum by the period, and
 *     falls back to the configured default when the asked-for period is not among the offered
 *     ones (0023:484). Production has `leaderboard = {periods:["DAY"], defaultPeriod:"DAY"}`, so
 *     a call asking for ALL is answered with DAY and the board sums **today**. That is a
 *     configuration fact, not a code fault, and §7 below pins it as an explicit contrast so it
 *     cannot be mistaken for either a bug or a rumour.
 *   * the **awarding** overwrites instead of accumulating. That is the part nobody has proved,
 *     and it is what §1-§6 and §8-§10 exist for: every figure the owner quoted, driven through
 *     the real writers, asserted against the rows they actually wrote.
 *
 * So: `docker run postgres:16`, apply supabase/test/prelude.sql and every migration in filename
 * order (scripts/lib/pgtest.mjs), configure the database to the **production settings read from
 * the deployed project**, and then drive `activity_submit()` and the `level4_attempts_award`
 * trigger. `award_points()` is never called directly and `point_transactions` is never inserted
 * into except to seed the pre-0031 rows §10 guards — an assertion over a row this file wrote by
 * hand would be an assertion about this file.
 *
 * The default port is not always bindable on Windows (see scripts/lib/pgtest.mjs):
 *
 *     VARNI_PGTEST_PORT=54833 node scripts/test-scoring-scenarios.mjs
 *
 * ────────────────────────────────────────────────────────────────────────────
 * What each group answers, in the owner's own words
 * ────────────────────────────────────────────────────────────────────────────
 *
 *  §0  the configuration under test really is production's, and says so out loud
 *  §1  "does લેવલ ૧ three times make 300" — 100, 200, 300, one row each
 *  §2  "does લેવલ ૨ four times make 800" — four rows, nothing overwritten
 *  §3  **"does 30 + 41 make 71"** — and then 81, and then 131. Both tick counting modes are
 *      pinned side by side over identical inputs, because ALL and FRESH answer a resubmission
 *      of the same દ્રશ્યો differently **on purpose** and a reader who meets only one of them
 *      will report the other as a defect.
 *  §4  four કસોટીઓ at 135 are 540; an unpriced કસોટી falls to level4.default (0 here) and a
 *      failed attempt pays nothing at all
 *  §5  the milestone: 5 completions are 1200, 10 are 2400, and no milestone is ever paid twice
 *  §6  **the owner's combined example: 300 + 800 + 71 + 400 + 200 = 1771**
 *  §7  and the board is that same 1771 — when ALL is among the offered windows. Under the
 *      production configuration the identical call returns today's subset instead. This is the
 *      finding that explains the report.
 *  §8  a retried submission pays once; two real submissions both pay
 *  §9  my_point_totals(), my_point_history() and the સંચાલક's readers all reconcile with
 *      sum(point_transactions.points), because that sum is the only score there is
 *  §10 and nothing written before 0031 moved by a column
 *  §11 **what a submission reports it earned is what that attempt was paid** — 0036. The two
 *      figures had drifted apart in two places: a replayed submission that crossed a મુકામ read
 *      one of its two ledger rows with a bare `select ... into` and reported the smaller, and a
 *      partial પુનરાવર્તન paid by 0035's AFTER INSERT trigger reported 0 while being credited.
 *      Neither was an awarding fault — the ledger was right throughout, which is why every
 *      figure in §1-§10 is the same before and after the fix. §11 pins the cases, and the
 *      `submit()` helper below now checks the property after **every** submission this file
 *      makes rather than only on the examples.
 */
import path from 'node:path';
import { attempt, dockerAvailable, startDatabase } from './lib/pgtest.mjs';

let pass = 0;
const fails = [];

const eq = (name, got, want) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) pass++;
  else fails.push(`${name}\n       got  ${g}\n       want ${w}`);
};

/** The statement was refused, with this SQLSTATE. See test-point-bonus.mjs for why the code. */
const refused = (name, res, code) => {
  if (!res.ok && res.code === code) pass++;
  else if (res.ok) fails.push(`${name}\n       got  allowed (${res.count} row(s))\n       want refused ${code}`);
  else fails.push(`${name}\n       got  refused ${res.code}: ${res.message}\n       want refused ${code}`);
};

const group = (name) => console.log(`\n  ${name}`);

// bigint and numeric arrive from node-postgres as strings, because they do not fit a JS number
// in general. Comparing '1771' against 1771 would fail for a reason that has nothing to do with
// the engine.
const num = (v) => (v === null || v === undefined ? null : Number(v));

/** The same object with its keys in a fixed order, so a comparison is about values. */
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
// Every id is a literal. A fixture that computes its own expectations proves only that it
// agrees with itself.

const U = {
  alpha: 'a1111111-1111-4111-8111-111111111111', // §1 લેવલ ૧
  beta: 'b2222222-2222-4222-8222-222222222222', // §2 લેવલ ૨
  gamma: 'c3333333-3333-4333-8333-333333333333', // §3 લેવલ ૩
  delta: 'd4444444-4444-4444-8444-444444444444', // §4 લેવલ ૪
  epsilon: 'e5555555-5555-4555-8555-555555555555', // §5 the milestone
  yuvak: 'f6666666-6666-4666-8666-666666666666', // §6 and §9 — the owner's example
  board: '0a777777-7777-4777-8777-777777777777', // §7 — the same total across two days
  legacy: '1e888888-8888-4888-8888-888888888888', // §10 — three rows from before 0031
  admin: '2b999999-9999-4999-8999-999999999999', // the સંચાલક readers in §9
};

const SCENE = (n) => `d-${String(n).padStart(3, '0')}`;
const RANGE = (a, b) => {
  const out = [];
  for (let i = a; i <= b; i++) out.push(SCENE(i));
  return out;
};

// Comfortably more દ્રશ્યો than §3's largest submission names (131), so no figure in this file
// is ever bounded by the size of the collection rather than by the rule under test.
const LIVE = 200;

// Five કસોટીઓ: four the production configuration prices at ૧૩૫, and one it has never heard of,
// which is what §4's `level4.default` case needs.
const L4 = [
  ['4.1', 1, [SCENE(1), SCENE(2)]],
  ['4.2', 2, [SCENE(3), SCENE(4)]],
  ['4.3', 3, [SCENE(5), SCENE(6)]],
  ['4.4', 4, [SCENE(7), SCENE(8)]],
  ['4.5', 5, [SCENE(9), SCENE(10)]],
];

const ACT = {};

// The committed ledger, worked out here rather than read back.
const LEGACY_ROWS = 3;
const LEGACY_POINTS = 100 + 300 + 400; // 800

// ════════════════════════════════════════════════════════════════════ the configuration
//
// **Read live from the deployed project.** Every scenario below runs under this and not under a
// configuration invented to make an arithmetic work — the question is what production pays, and
// a suite that answered it under different settings would have answered a different question.

const PROD_POINTS = {
  enabled: true,
  level1: 100,
  level2: 200,
  level3: 300,
  level4: { '4.1': 135, '4.2': 135, '4.3': 135, '4.4': 135, default: 0 },
  earn: { level1: 'EVERY', level2: 'EVERY', level3: 'EVERY', level4: 'EVERY', tickCount: 'ALL' },
  tick: { mode: 'TICK', perTick: 1, perRevision: 1, dailyCap: 0 },
  repeat: { enabled: false, default: 0, dailyLimit: 0 },
};

const PROD_BOARD = { enabled: true, periods: ['DAY'], defaultPeriod: 'DAY', topN: 10 };

// The board as it would have to be configured for `leaderboard('ALL')` to mean ALL. Nothing in
// the schema changes between these two — only the સંચાલક's list of offered windows.
const ALL_BOARD = { enabled: true, periods: ['DAY', 'ALL'], defaultPeriod: 'ALL', topN: 10 };

// §6 states its own લેવલ ૪ price — ૧૦૦ a કસોટી, not ૧૩૫ — so that the arithmetic asserted there
// is exactly the arithmetic the owner wrote down. Everything else is production's.
const OWNER_POINTS = {
  ...PROD_POINTS,
  level4: { '4.1': 100, '4.2': 100, '4.3': 100, '4.4': 100, default: 0 },
};

// ════════════════════════════════════════════════════════════════════ the fixtures

async function fixtures(db) {
  // Everything here runs as the owner, which is what a migration or the seed script is. RLS does
  // not apply, but every trigger still fires — including level4_attempts_award, which is why no
  // settings row is written in this function. With nothing configured `point_value_for` is 0
  // everywhere and the trigger writes nothing, so the ledger holds exactly the rows this file
  // chose. Each group configures what it needs inside a transaction it rolls back.

  const people = [
    [U.alpha, 'ALP101', 'Alpha Yuvak', '9811100001'],
    [U.beta, 'BET102', 'Beta Yuvak', '9811100002'],
    [U.gamma, 'GAM103', 'Gamma Yuvak', '9811100003'],
    [U.delta, 'DEL104', 'Delta Yuvak', '9811100004'],
    [U.epsilon, 'EPS105', 'Epsilon Yuvak', '9811100005'],
    [U.yuvak, 'YUV106', 'Owner Example Yuvak', '9811100006'],
    [U.board, 'BRD107', 'Board Yuvak', '9811100007'],
    [U.legacy, 'LEG108', 'Legacy Yuvak', '9811100008'],
    [U.admin, 'ADM109', 'Sanchalak Admin', '9811100009'],
  ];
  for (const [id, smk, name, mobile] of people) {
    await db.query('insert into auth.users (id, email) values ($1, $2)', [id, `${smk.toLowerCase()}@t.test`]);
    await db.query(
      `insert into public.profiles (id, smk, name, email, mobile, zone_id, sub_zone_id, status)
       values ($1, $2, $3, $4, $5, 'surat', 'varachha', 'ACTIVE')`,
      [id, smk, name, `${smk.toLowerCase()}@t.test`, mobile]
    );
  }

  await db.query(`insert into public.admin_profiles (id, role, status) values ($1, 'SUPER_ADMIN', 'ACTIVE')`, [U.admin]);

  await db.query(
    `insert into public.scenes (id, "index", "order", active, caption)
     select 'd-' || lpad(g::text, 3, '0'), g, g, true, 'scene ' || g
     from generate_series(1, $1) g`,
    [LIVE]
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

  // ── the rows from before 0031 ───────────────────────────────────────────────
  //
  // 0021's INSERT, reproduced verbatim — the same eight columns in the same order and nothing
  // else, which is what makes these rows legacy in the only sense the schema knows: every column
  // 0031 added is left at NULL. §10 is about these three and nothing in this file may touch them.
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
   * The ledger is append-only and has no delete path, so without the rollback the second group
   * would be reading the first one's awards.
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
   * A statement expected to be refused, run inside a savepoint — a refused statement aborts its
   * transaction, so every later statement in the same sandbox would come back 25P02.
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
   * Write settings['levels'] — the points block and, beside it, the board.
   *
   * Through an ordinary INSERT, so `settings_check_points`, `settings_check_leaderboard` and
   * `settings_check_pace` all fire: a configuration this file could not have saved through the
   * panel is not a configuration worth asserting under, and the whole point of this suite is
   * that it runs under the one production actually holds.
   */
  const configure = (points, extra = {}) =>
    db.query(
      `insert into public.settings (key, value) values ('levels', $1::jsonb)
       on conflict (key) do update set value = excluded.value`,
      [JSON.stringify({ ...extra, points })]
    );

  /** Production, exactly: the points block and the board as the deployed project holds them. */
  const production = (points = PROD_POINTS, board = PROD_BOARD) => configure(points, { leaderboard: board });

  /**
   * Every submission whose `pointsAwarded` disagreed with the ledger rows of the attempt it
   * describes. Asserted once, at the foot of this file, over every call made anywhere in it.
   *
   * Stated as a **property** rather than as a list of examples, because both defects 0036 fixes
   * were cases nobody had thought to write an example for: the replay branch was correct until
   * 0033 gave one attempt a second row, and step 9 was complete until 0035 started paying the
   * attempts it skips. A property holds over the case that has not been invented yet.
   */
  const reportGap = [];

  const submit = async (level, key, scenes, total, token = null) => {
    const r = (
      await db.query('select public.activity_submit($1, $2, $3::text[], $4, $5::uuid) r', [
        level,
        key,
        scenes,
        total,
        token,
      ])
    ).rows[0].r;

    // The attempt this answer is about — identified the way the answer itself identifies it, so
    // a replay is checked against the original attempt and not against a row it did not write.
    // LEFT JOIN, so an attempt that was paid nothing is 0 here and not an absent row.
    const paid = Number(
      (
        await db.query(
          `select coalesce(sum(t.points), 0) p
             from public.activity_attempts a
             left join public.point_transactions t
               on t.source = 'ACTIVITY_ATTEMPT' and t.source_id = a.id
            where a.user_id = auth.uid()
              and a.level_id = $1
              and a.activity_key = $2
              and a.activity_date = $3::date
              and a.attempt_number = $4`,
          [level, key, r.activityDate, r.attemptNumber]
        )
      ).rows[0].p
    );

    if (Number(r.pointsAwarded) !== paid) {
      reportGap.push(
        `લેવલ ${level} attempt #${r.attemptNumber} on ${r.activityDate}: reported ${r.pointsAwarded}, ledger ${paid}`
      );
    }

    return r;
  };

  /** A લેવલ ૪ attempt, which is the only thing that fires level4_attempts_award. */
  const exam = async (user, code, passed, daysAgo = 0) => {
    const items = L4.find((a) => a[0] === code)[2];
    return Number(
      (
        await db.query(
          `insert into public.level4_attempts
             (user_id, activity_id, config_id, selected_scene_ids, selected_count, required_count, passed, at)
           values ($1, $2, $3, $4, $5, $5, $6,
                   ((timezone('Asia/Kolkata', now())::date - $7::int) + time '11:00')
                     at time zone 'Asia/Kolkata')
           returning id`,
          [user, ACT[code], ACT.config, items, items.length, passed, daysAgo]
        )
      ).rows[0].id
    );
  };

  /** One milestone rule, as the સંચાલક's panel would leave it. */
  const rule = async (o) =>
    (
      await db.query(
        `insert into public.point_bonus_rules
           (name, level_id, activity_key, trigger_type, threshold, bonus_points, reward_mode, enabled)
         values ($1, $2, $3, $4, $5, $6, $7, true) returning id`,
        [
          o.name ?? 'milestone',
          o.level ?? null,
          o.activity ?? null,
          o.trigger ?? 'COMPLETION_COUNT',
          o.threshold,
          o.points,
          o.mode ?? 'EVERY',
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

  /** Just the money, for the assertions that are about the amount and the kind. */
  const paidRows = async (uid) => (await ledger(uid)).map((r) => [r.level_id, r.activity_key, r.points, r.award_kind]);

  const bonusRows = async (uid) => (await ledger(uid)).filter((r) => r.award_kind === 'BONUS');

  /** `sum(point_transactions.points)` — the only score this application has. */
  const total = async (uid) => (await ledger(uid)).reduce((n, r) => n + r.points, 0);

  const keys = async (uid) => (await ledger(uid)).map((r) => r.idempotency_key);

  const day = async (n) =>
    (await db.query(`select (timezone('Asia/Kolkata', now())::date - $1::int)::text d`, [n])).rows[0].d;

  /** The board, as a signed-in યુવક's phone receives it. */
  const boardFor = async (period) => (await db.query('select public.leaderboard($1) r', [period])).rows[0].r;

  const TODAY = await day(0);

  /**
   * The owner's combined example, built by the real writers and by nothing else.
   *
   *   લેવલ ૧ x3 at ૧૦૦          300
   *   લેવલ ૨ x4 at ૨૦૦          800
   *   લેવલ ૩  ૩૦ + ૪૧ ticks      71
   *   લેવલ ૪ x4 at ૧૦૦          400
   *   the milestone             200
   *                            ────
   *                            1771
   *
   * The milestone is one rule — "the fourth દર્શન is worth ૨૦૦ more", FIRST_ONLY — because the
   * owner's figure is a single ૨૦૦ and a rule that pays twice would be a different example
   * rather than a failed one. §5 is where the milestone engine itself is put through its modes.
   *
   * `level4DaysAgo` is what §7 needs: the same 1771, with the four કસોટીઓ sat yesterday, so
   * that "today" and "for all time" are two different numbers over one ledger.
   */
  const ownersExample = async (uid, { level4DaysAgo = 0, board = PROD_BOARD } = {}) => {
    await production(OWNER_POINTS, board);
    await rule({ name: 'Fourth darshan', level: 2, activity: 'darshan', threshold: 4, points: 200, mode: 'FIRST_ONLY' });
    await signIn(uid);

    for (let i = 0; i < 3; i++) await submit(1, 'video', [], 0);
    for (let i = 0; i < 4; i++) await submit(2, 'darshan', [], 0);
    await submit(3, 'revision', RANGE(1, 30), 30);
    await submit(3, 'revision', RANGE(31, 71), 41);
    for (const code of ['4.1', '4.2', '4.3', '4.4']) await exam(uid, code, true, level4DaysAgo);
  };

  // ══════════════════════════════════════════════════════ §0
  group('§0  the configuration under test is production\'s, read from the deployed project');

  eq('every migration in supabase/migrations applied', files.length > 0 && files.includes('0033_point_bonus_engine.sql'), true);
  eq('including the two that came after it, which both reissue award_points()', [
    files.includes('0034_daily_records.sql'),
    files.includes('0035_level3_revisions.sql'),
  ], [true, true]);

  await sandbox(async () => {
    await production();

    const rules = (await db.query('select public.point_rules() r')).rows[0].r;
    eq(
      'every લેવલ earns on EVERY completion, and ticks are counted ALL',
      canonical(rules.earn),
      canonical({ level1: 'EVERY', level2: 'EVERY', level3: 'EVERY', level4: 'EVERY', tickCount: 'ALL' })
    );
    eq(
      'લેવલ ૩ is priced per તિક at 1, with no daily cap',
      canonical(rules.tick),
      canonical({ mode: 'TICK', perTick: 1, perRevision: 1, dailyCap: 0 })
    );
    eq('and repeat awards are off', canonical(rules.repeat).enabled, false);

    const s = (await db.query('select * from public.point_settings()')).rows[0];
    eq('the four prices are 100 / 200 / 300 / 135', [s.enabled, s.level1, s.level2, s.level3, s.level4['4.1']], [
      true,
      100,
      200,
      300,
      135,
    ]);

    const lb = (await db.query('select * from public.leaderboard_settings()')).rows[0];
    eq(
      'and the board is ON, offering exactly one window — DAY — which is the whole of §7',
      [lb.enabled, lb.periods, lb.default_period, lb.top_n],
      [true, ['DAY'], 'DAY', 10]
    );
  });

  // ══════════════════════════════════════════════════════ §1
  group('§1  does લેવલ ૧ three times make 300 — one completion, then two, then three');

  await sandbox(async () => {
    await production();
    await signIn(U.alpha);

    const one = await submit(1, 'video', [], 0);
    eq('one completion is 100', one.pointsAwarded, 100);
    eq('and the ledger holds 100', await total(U.alpha), 100);

    await submit(1, 'video', [], 0);
    eq('two completions are 200, not 100', await total(U.alpha), 200);

    const three = await submit(1, 'video', [], 0);
    eq('three completions are 300, not 100', await total(U.alpha), 300);

    eq('one ledger row per completion — three rows, never one rewritten three times', (await paidRows(U.alpha)).length, 3);
    eq('each of them 100 ગુણ, each a REPEAT', await paidRows(U.alpha), [
      [1, 'video', 100, 'REPEAT'],
      [1, 'video', 100, 'REPEAT'],
      [1, 'video', 100, 'REPEAT'],
    ]);
    eq(
      'and three distinct idempotency keys, which is what makes it structurally impossible for one row to overwrite another',
      new Set(await keys(U.alpha)).size,
      3
    );

    eq('the third submission reports 100 — what THAT act earned', three.pointsAwarded, 100);
    eq('while totalPoints in the same answer is the cumulative 300', num(three.totalPoints), 300);
  });

  // ══════════════════════════════════════════════════════ §2
  group('§2  does લેવલ ૨ four times make 800');

  await sandbox(async () => {
    await production();
    await signIn(U.beta);

    const one = await submit(2, 'darshan', [], 0);
    eq('one દર્શન is 200', [one.pointsAwarded, await total(U.beta)], [200, 200]);

    for (let i = 0; i < 3; i++) await submit(2, 'darshan', [], 0);
    eq('four separate દર્શન are 800', await total(U.beta), 800);
    eq('as four rows', (await paidRows(U.beta)).length, 4);
    eq('every one of them 200, none replacing the last', await paidRows(U.beta), [
      [2, 'darshan', 200, 'REPEAT'],
      [2, 'darshan', 200, 'REPEAT'],
      [2, 'darshan', 200, 'REPEAT'],
      [2, 'darshan', 200, 'REPEAT'],
    ]);
    eq('four distinct keys', new Set(await keys(U.beta)).size, 4);
  });

  // ══════════════════════════════════════════════════════ §3
  group('§3  does 30 + 41 make 71 — લેવલ ૩ accumulates per નોંધાવો');

  await sandbox(async () => {
    // The production configuration, unmodified: tick.mode TICK, perTick 1, tickCount ALL.
    await production();
    await signIn(U.gamma);

    const first = await submit(3, 'revision', RANGE(1, 30), 30);
    eq('a નોંધાવો of 30 દ્રશ્યો is 30', first.pointsAwarded, 30);

    const second = await submit(3, 'revision', RANGE(31, 71), 41);
    eq('the next, of 41, is 41 — reported for itself', second.pointsAwarded, 41);

    eq('and the ledger reads 71: not 41 (the latest), not 30 (the first), not 41 (the largest)', await total(U.gamma), 71);
    eq('as two TICK rows, 30 and then 41, neither rewritten', await paidRows(U.gamma), [
      [3, 'revision', 30, 'TICK'],
      [3, 'revision', 41, 'TICK'],
    ]);
    eq('keyed on the attempt each was paid for, so no row can occupy another\'s place', await keys(U.gamma), [
      `tick:${(await ledger(U.gamma))[0].source_id}`,
      `tick:${(await ledger(U.gamma))[1].source_id}`,
    ]);
    eq('and the submission itself reports the cumulative figure beside the one it earned', num(second.totalPoints), 71);

    const third = await submit(3, 'revision', RANGE(72, 81), 10);
    eq('a third નોંધાવો of 10 takes him to 81', [third.pointsAwarded, await total(U.gamma)], [10, 81]);

    const fourth = await submit(3, 'revision', RANGE(82, 131), 50);
    eq('a fourth of 50 takes him to 131', [fourth.pointsAwarded, await total(U.gamma)], [50, 131]);
    eq('four submissions, four rows, 30 + 41 + 10 + 50', (await ledger(U.gamma)).map((r) => r.points), [30, 41, 10, 50]);

    // The flat લેવલ ૩ price is 300 and is never what a તિક rule pays. Stated because a reader
    // finding 71 where the panel shows "લેવલ ૩ = 300" will otherwise report the 71 as the fault.
    eq('and the flat 300 never appears — under tick.mode TICK it is not the rule in force', (await ledger(U.gamma)).some((r) => r.points === 300), false);
  });

  await sandbox(async () => {
    // The two counting modes, over IDENTICAL inputs, so nobody later mistakes one for the other.
    // ALL: every valid દ્રશ્ય in the submission is paid, whatever an earlier one named.
    await production();
    await signIn(U.gamma);

    await submit(3, 'revision', RANGE(1, 30), 30);
    const again = await submit(3, 'revision', RANGE(1, 30), 30);
    eq('under tickCount ALL — production\'s setting — the same 30 દ્રશ્યો resubmitted pay again', again.pointsAwarded, 30);
    eq('so the day reads 60 over two rows', [await total(U.gamma), (await paidRows(U.gamma)).length], [60, 2]);
  });

  await sandbox(async () => {
    // FRESH: 0031's rule. Nothing already brought to mind today is paid a second time.
    await production({ ...PROD_POINTS, earn: { ...PROD_POINTS.earn, tickCount: 'FRESH' } });
    await signIn(U.gamma);

    await submit(3, 'revision', RANGE(1, 30), 30);
    const again = await submit(3, 'revision', RANGE(1, 30), 30);
    eq('under tickCount FRESH the identical resubmission pays nothing', again.pointsAwarded, 0);
    eq('and the day stays at 30, on one row', [await total(U.gamma), (await paidRows(U.gamma)).length], [30, 1]);

    // And the scenario that matters is unaffected by the choice: 30 and then a DIFFERENT 41 is
    // 71 under both modes. FRESH subtracts what was already ticked, never what was already paid.
    const other = await submit(3, 'revision', RANGE(31, 71), 41);
    eq('but 30 and then a different 41 is still 71 under FRESH — the modes differ only over a repeat', [
      other.pointsAwarded,
      await total(U.gamma),
    ], [41, 71]);
  });

  await sandbox(async () => {
    // The same 30 + 41 through the OTHER real writer: a partial પુનરાવર્તન of the full ૧૦૮
    // collection, which `activity_submit()` skips at step 9 and 0035's AFTER INSERT trigger
    // pays. This is the path a real handset takes when a યુવક ticks 30 of 108 and presses
    // નોંધાવો, and it must reach the same 71.
    await production();
    await signIn(U.gamma);

    const first = await submit(3, 'revision', RANGE(1, 30), 108);
    const second = await submit(3, 'revision', RANGE(31, 71), 108);
    eq('a partial પુનરાવર્તન is REVISION_REQUIRED', [first.status, second.status], ['REVISION_REQUIRED', 'REVISION_REQUIRED']);
    eq('and 30 then 41 partial ticks still accumulate to 71 in the ledger', await total(U.gamma), 71);
    eq('over two TICK rows', (await ledger(U.gamma)).map((r) => r.points), [30, 41]);
    eq(
      'and each submission reports the ticks it was paid — step 9 skips a partial, 0035\'s trigger pays it, and since 0036 the answer reads the ledger rather than that skipped call',
      [first.pointsAwarded, second.pointsAwarded],
      [30, 41]
    );
  });

  // ══════════════════════════════════════════════════════ §4
  group('§4  four કસોટીઓ at 135 are 540, an unpriced one is 0, and a failed one is nothing');

  await sandbox(async () => {
    await production();
    await signIn(U.delta);

    for (const code of ['4.1', '4.2', '4.3', '4.4']) await exam(U.delta, code, true);
    eq('four passed કસોટીઓ are four rows', (await paidRows(U.delta)).length, 4);
    eq('each priced by its own entry at 135', await paidRows(U.delta), [
      [4, '4.1', 135, 'REPEAT'],
      [4, '4.2', 135, 'REPEAT'],
      [4, '4.3', 135, 'REPEAT'],
      [4, '4.4', 135, 'REPEAT'],
    ]);
    eq('4 x 135 = 540', await total(U.delta), 540);

    // ૪.૫ exists, is published and is sittable, and the configuration has no value for it.
    await exam(U.delta, '4.5', true);
    eq('a કસોટી with no configured price falls to level4.default, which is 0 here', await total(U.delta), 540);
    eq('and 0 is not a row — the ledger records payments, never non-payments', (await paidRows(U.delta)).length, 4);

    // The trigger's WHEN clause is `new.passed`, so a failed attempt does not reach the engine.
    await exam(U.delta, '4.3', false);
    eq('a failed કસોટી pays nothing at all', [await total(U.delta), (await paidRows(U.delta)).length], [540, 4]);
  });

  // ══════════════════════════════════════════════════════ §5
  group('§5  the milestone — "every 5 લેવલ ૨ completions is worth 200 more"');

  await sandbox(async () => {
    await production();
    await rule({ name: 'Every fifth darshan', level: 2, activity: 'darshan', threshold: 5, points: 200, mode: 'EVERY' });
    await signIn(U.epsilon);

    for (let i = 0; i < 4; i++) await submit(2, 'darshan', [], 0);
    eq('four દર્શન have not reached it — 800 and no BONUS row', [await total(U.epsilon), (await bonusRows(U.epsilon)).length], [800, 0]);

    const fifth = await submit(2, 'darshan', [], 0);
    eq('the fifth pays its own 200 and the milestone\'s 200 in one answer', fifth.pointsAwarded, 400);
    eq('5 x 200 + 200 = 1200', await total(U.epsilon), 1200);
    eq('as five awards and one BONUS', await paidRows(U.epsilon), [
      [2, 'darshan', 200, 'REPEAT'],
      [2, 'darshan', 200, 'REPEAT'],
      [2, 'darshan', 200, 'REPEAT'],
      [2, 'darshan', 200, 'REPEAT'],
      [2, 'darshan', 200, 'REPEAT'],
      [2, 'darshan', 200, 'BONUS'],
    ]);

    // The same milestone, twice, cannot happen: its key names the count and not the moment.
    const sixth = await submit(2, 'darshan', [], 0);
    eq('the sixth is worth its 200 alone', sixth.pointsAwarded, 200);
    eq('and there is still exactly one BONUS row', (await bonusRows(U.epsilon)).length, 1);

    for (let i = 0; i < 4; i++) await submit(2, 'darshan', [], 0);
    eq('the tenth reaches the second milestone of the same rule', (await bonusRows(U.epsilon)).length, 2);
    eq('10 x 200 + 200 + 200 = 2400', await total(U.epsilon), 2400);
    eq(
      'the two BONUS rows are milestone 1 and milestone 2, keyed on the count and on the યુવક',
      (await bonusRows(U.epsilon)).map((r) => r.idempotency_key.split(':').slice(2).join(':')),
      [`${U.epsilon}:1`, `${U.epsilon}:2`]
    );

    // The index is the guarantee, not a check in the function: a second writer computing the
    // same milestone number is refused by point_transactions_idem_idx.
    refused(
      'and the milestone key cannot be spent twice, not even by a raw INSERT',
      await soft(
        `insert into public.point_transactions
           (user_id, activity_date, level_id, activity_key, points, source, source_id,
            attempt_number, award_kind, idempotency_key)
         values ($1, $2::date, 2, 'darshan', 200, 'ACTIVITY_ATTEMPT', 999, 1, 'BONUS', $3)`,
        [U.epsilon, TODAY, (await bonusRows(U.epsilon))[0].idempotency_key]
      ),
      '23505'
    );
    eq('still two BONUS rows and still 2400', [(await bonusRows(U.epsilon)).length, await total(U.epsilon)], [2, 2400]);
  });

  await sandbox(async () => {
    // The other reading of "and a second rule at 10", which the owner's 2400 does NOT describe
    // unless both rules pay once. Pinned so that the two configurations are visibly different
    // numbers and nobody has to guess which one his panel holds.
    await production();
    await rule({ name: 'tier 5', level: 2, activity: 'darshan', threshold: 5, points: 200, mode: 'EVERY' });
    await rule({ name: 'tier 10', level: 2, activity: 'darshan', threshold: 10, points: 200, mode: 'EVERY' });
    await signIn(U.epsilon);

    for (let i = 0; i < 10; i++) await submit(2, 'darshan', [], 0);
    eq(
      'two EVERY rules at 5 and 10 pay 2000 + 200 + 200 + 200 = 2600, because the 5-rule pays at 5 AND at 10',
      await total(U.epsilon),
      2600
    );
    eq('three BONUS rows', (await bonusRows(U.epsilon)).length, 3);
  });

  await sandbox(async () => {
    await production();
    await rule({ name: 'tier 5', level: 2, activity: 'darshan', threshold: 5, points: 200, mode: 'FIRST_ONLY' });
    await rule({ name: 'tier 10', level: 2, activity: 'darshan', threshold: 10, points: 200, mode: 'FIRST_ONLY' });
    await signIn(U.epsilon);

    for (let i = 0; i < 10; i++) await submit(2, 'darshan', [], 0);
    eq('the same two rules as FIRST_ONLY pay 2000 + 200 + 200 = 2400, which is the owner\'s figure', await total(U.epsilon), 2400);
    eq('two BONUS rows, one per rule', (await bonusRows(U.epsilon)).length, 2);
  });

  // ══════════════════════════════════════════════════════ §6
  group('§6  the owner\'s combined example: 300 + 800 + 71 + 400 + 200 = 1771');

  await sandbox(async () => {
    await ownersExample(U.yuvak);

    const rows = await ledger(U.yuvak);
    eq('લેવલ ૧ x3 at 100 is 300', rows.filter((r) => r.level_id === 1).reduce((n, r) => n + r.points, 0), 300);
    eq('લેવલ ૨ x4 at 200 is 800', rows.filter((r) => r.level_id === 2 && r.award_kind !== 'BONUS').reduce((n, r) => n + r.points, 0), 800);
    eq('લેવલ ૩ 30 + 41 is 71', rows.filter((r) => r.level_id === 3).reduce((n, r) => n + r.points, 0), 71);
    eq('લેવલ ૪ x4 at 100 is 400', rows.filter((r) => r.level_id === 4).reduce((n, r) => n + r.points, 0), 400);
    eq('the milestone is 200, paid once', rows.filter((r) => r.award_kind === 'BONUS').map((r) => r.points), [200]);

    eq('fourteen events, fourteen rows', rows.length, 3 + 4 + 2 + 4 + 1);
    eq('and sum(point_transactions.points) for this યુવક is 1771', await total(U.yuvak), 1771);
  });

  // ══════════════════════════════════════════════════════ §7
  group('§7  the board is the same 1771 — and under the production configuration it is not');

  await sandbox(async () => {
    // The identical 1771, assembled across two days: the four કસોટીઓ yesterday, everything else
    // today. Nothing about the ledger changes; only the question a window asks of it.
    await ownersExample(U.board, { level4DaysAgo: 1 });

    eq('the ledger still sums to 1771', await total(U.board), 1771);
    eq(
      'of which 1371 was earned today and 400 yesterday',
      [
        (await ledger(U.board)).filter((r) => r.activity_date === TODAY).reduce((n, r) => n + r.points, 0),
        (await ledger(U.board)).filter((r) => r.activity_date !== TODAY).reduce((n, r) => n + r.points, 0),
      ],
      [1371, 400]
    );

    // ── the finding ───────────────────────────────────────────────────────────
    //
    // Production offers one window. `leaderboard()` answers an unoffered period with the
    // configured default (0023:484) and bounds the sum by it (0023:522), so a phone asking for
    // ALL is answered with DAY — and the board shows what he earned **today**.
    const asked = await boardFor('ALL');
    eq('with periods:["DAY"], a call asking for ALL is answered as DAY', asked.period, 'DAY');
    eq('and the board shows 1371 — today\'s subset, not the total of 1771', num(asked.me?.points), 1371);
    eq('an argument-less call lands in the same branch', num((await boardFor(null)).me?.points), 1371);
    eq('and asking for DAY outright gives the same figure, which is the honest one for that window', num((await boardFor('DAY')).me?.points), 1371);

    // ── and the same call, with ALL among the offered windows ─────────────────
    //
    // One settings field moves. No migration, no code, no row in the ledger.
    await production(OWNER_POINTS, ALL_BOARD);
    const all = await boardFor('ALL');
    eq('with ALL offered, the same call is answered as ALL', all.period, 'ALL');
    eq('and the board is 1771 — exactly sum(point_transactions.points)', num(all.me?.points), await total(U.board));
    eq('which is the number §6 asserted', num(all.me?.points), 1771);
    eq('while DAY, asked for by name, still answers 1371 — the window is doing its job', num((await boardFor('DAY')).me?.points), 1371);

    // The board is a ranking, so the row he sees carries the same figure as `me`.
    const mine = (all.rows ?? []).filter((r) => r.isMe);
    eq('and his own row on the board carries that same total', mine.map((r) => num(r.points)), [1771]);
  });

  // ══════════════════════════════════════════════════════ §8
  group('§8  a retried submission pays once; two real submissions both pay');

  await sandbox(async () => {
    await production();
    await signIn(U.alpha);

    const TOKEN = '11111111-2222-4333-8444-555555555555';
    const t1 = await submit(2, 'darshan', [], 0, TOKEN);
    const t2 = await submit(2, 'darshan', [], 0, TOKEN);
    eq('both calls report 200', [t1.pointsAwarded, t2.pointsAwarded], [200, 200]);
    eq('and the retry reports the original attempt, not a new one', t1.attemptNumber, t2.attemptNumber);
    eq('one row, 200 ગુણ', [(await paidRows(U.alpha)).length, await total(U.alpha)], [1, 200]);

    // Two distinct submissions, back to back, with no token at all — which is what two real
    // દર્શન a minute apart look like.
    await submit(2, 'darshan', [], 0);
    await submit(2, 'darshan', [], 0);
    eq('two further, distinct submissions both pay', [(await paidRows(U.alpha)).length, await total(U.alpha)], [3, 600]);

    // And the replay again, now that later rows exist: a lost response arriving late.
    const late = await submit(2, 'darshan', [], 0, TOKEN);
    eq('a replayed request writes nothing', [(await paidRows(U.alpha)).length, await total(U.alpha)], [3, 600]);
    eq('and still answers for the attempt it replays', late.attemptNumber, t1.attemptNumber);

    // The milestone half of the same question: a replay must not re-pay a bonus either.
    //
    // The milestone is priced at 300 and not 200 on purpose, so that the two rows one submission
    // wrote carry different numbers — otherwise the assertion below cannot tell "the sum" from
    // "one of them".
    await rule({ name: 'Fourth darshan', level: 2, activity: 'darshan', threshold: 4, points: 300, mode: 'FIRST_ONLY' });
    const MILE = '22222222-3333-4444-8555-666666666666';
    const fourth = await submit(2, 'darshan', [], 0, MILE);
    eq('the fourth reaches the milestone and is worth 200 + 300', fourth.pointsAwarded, 500);
    const replay = await submit(2, 'darshan', [], 0, MILE);
    eq('replaying it leaves exactly one BONUS row', (await bonusRows(U.alpha)).length, 1);
    eq('and the total does not move', await total(U.alpha), 600 + 200 + 300);
    eq(
      'and the replay reports what that submission earned — 500, the sum of both rows it wrote, not whichever one a bare `select ... into` happened to reach (0036)',
      replay.pointsAwarded,
      500
    );
    eq('which is the same figure the original call gave, so the number does not shrink on a retry', replay.pointsAwarded, fourth.pointsAwarded);
  });

  // ══════════════════════════════════════════════════════ §9
  group('§9  history, totals and the સંચાલક\'s readers all reconcile with the ledger');

  await sandbox(async () => {
    await ownersExample(U.yuvak);
    const LEDGER = await total(U.yuvak);
    eq('the ledger this group reconciles against is 1771', LEDGER, 1771);

    await signIn(U.yuvak);

    const totals = (await db.query('select public.my_point_totals() r')).rows[0].r;
    eq('my_point_totals() is the ledger\'s own sum', num(totals.total), LEDGER);
    eq('split into base and bonus, which add back to it', num(totals.base) + num(totals.bonus), LEDGER);
    eq('the bonus half being exactly the BONUS rows', num(totals.bonus), (await bonusRows(U.yuvak)).reduce((n, r) => n + r.points, 0));
    eq(
      'and per level: 300, 1000 (800 + the milestone), 71, 400',
      totals.levels.map((l) => [num(l.level), num(l.total)]),
      [
        [1, 300],
        [2, 1000],
        [3, 71],
        [4, 400],
      ]
    );

    const history = (await db.query('select * from public.my_point_history()')).rows;
    eq('my_point_history() returns one row per ledger row', history.length, (await ledger(U.yuvak)).length);
    eq('and they sum to the same 1771', history.reduce((n, r) => n + r.points, 0), LEDGER);
    eq('with total_rows agreeing', num(history[0].total_rows), history.length);
    eq('the milestone naming the rule that paid it', history.filter((r) => r.is_bonus).map((r) => [r.points, r.bonus_rule]), [
      [200, 'Fourth darshan'],
    ]);

    // The સંચાલક's readers answer the same question about the same યુવક, and must not have
    // become a second scoring system (§39).
    await signIn(U.admin);

    const admin = (await db.query('select * from public.admin_point_transactions($1, null, null, null, null, null, null, null, null, 0, 100)', [U.yuvak])).rows;
    eq('admin_point_transactions() shows the same rows', admin.length, (await ledger(U.yuvak)).length);
    eq('and they sum to 1771', admin.reduce((n, r) => n + r.points, 0), LEDGER);

    const board = (await db.query('select public.admin_leaderboard(null, null, null, null, 100) r')).rows[0].r;
    const his = board.rows.filter((r) => r.userId === U.yuvak);
    eq('admin_leaderboard() with no window puts him at 1771', his.map((r) => num(r.points)), [LEDGER]);

    const overview = (await db.query('select public.admin_points_overview() r')).rows[0].r;
    eq(
      'and admin_points_overview() counts his rows and the fixture\'s legacy rows in one figure',
      num(overview.totals.points),
      (await total(U.yuvak)) + LEGACY_POINTS
    );
    eq('reporting the pre-0031 rows separately, as §41 asks', [num(overview.totals.legacyRows), num(overview.totals.legacyPoints)], [
      LEGACY_ROWS,
      LEGACY_POINTS,
    ]);
  });

  // ══════════════════════════════════════════════════════ §10
  group('§10  nothing written before 0031 moved by a column');

  const legacyBefore = await ledger(U.legacy);
  eq('the fixture holds three rows written by 0021\'s own INSERT', legacyBefore.length, LEGACY_ROWS);
  eq(
    'with every column 0031 added left NULL, which is what makes them legacy',
    [...new Set(legacyBefore.flatMap((r) => [r.award_kind, r.rule_version, r.reason, r.admin_id, r.idempotency_key, r.event_ref, r.attempt_id]))],
    [null]
  );
  eq('summing to the reconciliation figure', legacyBefore.reduce((n, r) => n + r.points, 0), LEGACY_POINTS);

  await sandbox(async () => {
    // Every scenario above, run for the યુવક who owns those three rows, on the same IST days
    // they sit on. Nothing may reach them.
    await production();
    await rule({ name: 'anything', threshold: 1, points: 25, mode: 'EVERY' });
    await signIn(U.legacy);

    for (let i = 0; i < 3; i++) await submit(1, 'video', [], 0);
    for (let i = 0; i < 4; i++) await submit(2, 'darshan', [], 0);
    await submit(3, 'revision', RANGE(1, 30), 30);
    await submit(3, 'revision', RANGE(31, 71), 41);
    await exam(U.legacy, '4.1', true, 4); // the same IST day as his legacy ૪.૧ row
    await exam(U.legacy, '4.2', true, 0);

    const after = await ledger(U.legacy);
    const stillLegacy = after.filter((r) => r.award_kind === null);
    eq('the engine ran and wrote rows for him', after.length > LEGACY_ROWS, true);
    eq('there are still exactly three legacy rows', stillLegacy.length, LEGACY_ROWS);
    eq('and every column of every one of them is what it was', stillLegacy, legacyBefore);
    eq('their sum has not moved', stillLegacy.reduce((n, r) => n + r.points, 0), LEGACY_POINTS);
  });

  eq('and after every group in this file, the three rows are still untouched', await ledger(U.legacy), legacyBefore);

  // ══════════════════════════════════════════════════════ §11
  group('§11  a submission reports what THAT attempt was paid — by step 9 or by anyone else (0036)');

  await sandbox(async () => {
    // The partial પુનરાવર્તન, in the shape a real handset produces it: ૫૦ of ૧૦૮ ticked, પ્રેસ
    // નોંધાવો. `activity_submit()` step 9 skips it because it is not COMPLETED, and 0035's
    // AFTER INSERT trigger pays it under tick.mode TICK — during the INSERT, so the ledger row
    // already exists by the time step 9 is reached. Before 0036 the answer said 0 and the
    // ledger said 50, and the યુવક saw the credit appear from nowhere on the next screen.
    await production();
    await signIn(U.gamma);

    const PART = '33333333-4444-4555-8666-777777777777';
    const partial = await submit(3, 'revision', RANGE(1, 50), 108, PART);

    eq('a ૫૦/૧૦૮ પુનરાવર્તન is REVISION_REQUIRED', partial.status, 'REVISION_REQUIRED');
    eq('and it reports the 50 તિક it was actually paid, not 0', partial.pointsAwarded, 50);
    eq('the ledger holding exactly that, unchanged by 0036 — one TICK row of 50', await paidRows(U.gamma), [[3, 'revision', 50, 'TICK']]);
    eq('keyed on the attempt the trigger paid for', await keys(U.gamma), [`tick:${(await ledger(U.gamma))[0].source_id}`]);
    eq('and todayPoints in the same answer agrees', num(partial.todayPoints), 50);

    // The replay of that same partial: the branch that had the other half of the defect.
    const again = await submit(3, 'revision', RANGE(1, 50), 108, PART);
    eq('replaying it reports the same 50, not 0 and not some other row', again.pointsAwarded, 50);
    eq('answering for the attempt it replays', again.attemptNumber, partial.attemptNumber);
    eq('and writing no second row', [await total(U.gamma), (await paidRows(U.gamma)).length], [50, 1]);
  });

  await sandbox(async () => {
    // An attempt that genuinely earned nothing still reports nothing. Reading the ledger back
    // must not turn a 0 into somebody else's figure — which is what the `source` filter and the
    // per-attempt `source_id` are for, since activity_attempts.id and level4_attempts.id are
    // independent sequences that overlap (0031:92).
    await production({ ...PROD_POINTS, earn: { ...PROD_POINTS.earn, level2: 'DAY_FIRST' } });
    await signIn(U.beta);

    const first = await submit(2, 'darshan', [], 0);
    const second = await submit(2, 'darshan', [], 0);
    eq('under DAY_FIRST the day is paid once — 200, then 0', [first.pointsAwarded, second.pointsAwarded], [200, 0]);
    eq('the second COMPLETED attempt having written no row at all', [await total(U.beta), (await paidRows(U.beta)).length], [200, 1]);
    eq('and the row that exists belongs to the first attempt', (await paidRows(U.beta))[0], [2, 'darshan', 200, 'DAY_FIRST']);
  });

  await sandbox(async () => {
    // The other honest 0: a partial પુનરાવર્તન with no તિક rule in force, which is what every
    // unconfigured project runs. 0035's trigger returns without paying and step 9 skips it, so
    // nothing was written and 0 is the true answer.
    await production({ ...PROD_POINTS, tick: { ...PROD_POINTS.tick, mode: 'ACTIVITY' } });
    await signIn(U.gamma);

    const partial = await submit(3, 'revision', RANGE(1, 50), 108);
    eq('with tick.mode ACTIVITY a partial પુનરાવર્તન earns nothing and says so', [partial.status, partial.pointsAwarded], ['REVISION_REQUIRED', 0]);
    eq('and nothing is in the ledger to have reported', [await total(U.gamma), (await paidRows(U.gamma)).length], [0, 0]);

    // The same યુવક, finishing the collection in the same session: the flat લેવલ ૩ price, paid
    // by step 9 this time, and reported by the same one computation.
    const full = await submit(3, 'revision', RANGE(1, 108), 108);
    eq('while the COMPLETED પુનરાવર્તન beside it reports its flat 300', [full.status, full.pointsAwarded], ['COMPLETED', 300]);
    eq('over one row', await paidRows(U.gamma), [[3, 'revision', 300, 'REPEAT']]);
  });

  // ── the property, over every submission this file made ──────────────────────
  //
  // Not an eleventh example. Every `activity_submit()` call in every group above — 100-odd of
  // them, across ten scenarios, four earning modes, both તિક counting modes, milestones,
  // replays, partials and the legacy યુવક — checked its own answer against the ledger rows of
  // the attempt it described, at the moment it was made and before the sandbox rolled back.
  eq(
    'and in every submission this file made, pointsAwarded was exactly the sum of that attempt\'s ledger rows',
    reportGap,
    []
  );
}

await main();
