/**
 * The daily record, its 24-hour window and the ledger it is reconciled against, run against a
 * real Postgres — `node scripts/test-daily-records.mjs`.
 *
 * 0034 makes three promises that cannot be checked by reading the file. It lets a યુવક state
 * what his day was and be paid for it; it gives him exactly twenty-four hours from his first
 * submission to change his mind; and it promises that after every one of those changes the
 * day's ledger sum still equals the day's stored total, on a ledger that is append-only and
 * whose rows may never be rewritten. All three are enforced by triggers, unique indexes and
 * SECURITY DEFINER functions, and none of that can be reached from JavaScript. A suite that
 * mocked any of it would be asserting what its author typed.
 *
 * So this file does what scripts/test-point-bonus.mjs does and deliberately reuses its harness
 * rather than inventing one: `docker run postgres:16`, apply supabase/test/prelude.sql and every
 * migration in filename order (scripts/lib/pgtest.mjs), seed a population whose every figure was
 * worked out on paper first, and then drive the real writers — `daily_record_save()`,
 * `activity_submit()` and the `level4_attempts_award` trigger — and assert on the rows they
 * actually wrote.
 *
 * The default port is not always bindable on Windows (see scripts/lib/pgtest.mjs):
 *
 *     VARNI_PGTEST_PORT=54833 node scripts/test-daily-records.mjs
 *
 * ────────────────────────────────────────────────────────────────────────────
 * What each group is protecting, and what it costs to get wrong
 * ────────────────────────────────────────────────────────────────────────────
 *
 *  §0  **0034 applied, applies again, and built what it said it would.** A migration that
 *      cannot be re-applied is a migration that cannot be corrected — 0031 reached production
 *      and could not be re-run, which is why every constraint in 0031, 0033 and 0034 is dropped
 *      before it is added. Asserted directly: apply the file a second time and confirm the
 *      ledger has not moved by a row, a point or a legacy row.
 *
 *  §A  **A first save creates the record and stamps the window.** The record is the only place
 *      a stored total exists in this schema, so the moment it comes into being is worth pinning.
 *
 *  §B  **An edit inside the window changes the day's total, and the ledger still equals it.**
 *      This is the guarantee the whole file exists for (§39: history equals leaderboard equals
 *      the સંચાલક's report). It is asserted as an equation over rows the engine wrote, never as
 *      a figure the function reported about itself.
 *
 *  §C  **One second before `edit_until` is accepted; one second after is refused.** The rule is
 *      a comparison of `now()` against a value on the OLD row, which is precisely what a policy
 *      cannot see — 0026:48-51's argument, and the reason this is a BEFORE UPDATE trigger.
 *      Driven both through the function and through a direct UPDATE, because the trigger has to
 *      hold for the second one too.
 *
 *  §D  **The window is 24 hours from the first submission** — not from midnight, and not
 *      `activity_date + 1 day`. A યુવક who fills his day in at ૨૩:૫૦ would otherwise get ten
 *      minutes. Asserted on a record opened for a day three days past, which under either wrong
 *      rule would already be closed.
 *
 *  §E  **A downward correction writes a negative delta.** Every existing negative row is either
 *      a MANUAL belonging to no level or a BONUS keyed to a milestone; nothing before this wrote
 *      a delta against a day. It is one more row, never an edit — 0031:669-674.
 *
 *  §F  **The same client token twice is one save.** §31. The question answers the ordinary
 *      retry; the index decides the race and refuses it, because a check cannot decide a race
 *      (0021:288-294). Both halves are asserted.
 *
 *  §G  **A યુવક cannot reach another યુવક's day.** `daily_record_save()` and
 *      `daily_record_get()` take no p_user at any price, and RLS keeps the tables themselves
 *      shut. Driven as a real signed-in યુવક with RLS enforced, never as the owner.
 *
 *  §H  **A યુવક cannot write `edit_until`, `locked_at`, `version` or any points column.**
 *      Enforced by a trigger and not only by a grant, because an own-row UPDATE policy would
 *      otherwise leave every one of them writable by the person it binds.
 *
 *  §I  **`dailyMax` clamps, and it is a setting rather than a constant.** Nothing in 0034
 *      hardcodes 108, 27, a level count or a ceiling. An absent maximum is no maximum, which is
 *      what an untouched project has.
 *
 *  §J  **Duplicate લેવલ ૩ scene ids are counted once.** The same tick sent twice is one tick,
 *      and a દ્રશ્ય the સંચાલક has withheld is none at all.
 *
 *  §K  **Reported above recorded is stored with `verified = false`.** The figure is trusted and
 *      the trust is recorded, so a self-reported number is visible as one rather than being
 *      indistinguishable from an observed one.
 *
 *  §L  **Milestones are paid against the reported counts, and never twice.** `point_bonus_apply()`
 *      is 0033's engine and not a second bonus path; the idempotency key is what stops the
 *      second payment, and it is an index rather than a check.
 *
 *  §M  **A configuration change leaves old transactions untouched while new ones use the new
 *      value.** §1 rule 4: an award already made is never revoked.
 *
 *  §N  **`point_config_versions` resolves a `rule_version` to the document that produced it.**
 *      Before 0034 the column was a bare integer pointing at nothing, and the only way to
 *      explain an old award was to replay `audit_logs` jsonb by timestamp.
 *
 *  §O  **The no-change guarantee.** An untouched project — no daily record, no `dailyMax`, no
 *      new rule — awards exactly what it awarded before, driven through the real writers under
 *      0021's own BASE configuration and compared column for column against a row written by
 *      0021's own INSERT statement, reproduced verbatim.
 *
 *  §P  **The three pre-0031 rows are unmoved after everything above has run.** `award_kind IS
 *      NULL` is the definition of legacy history and nothing in this file may reach one.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { asUser, attempt, dockerAvailable, startDatabase } from './lib/pgtest.mjs';

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
 * The code is asserted and not only the failure, because '42501' (no grant, a permission check
 * or a guard's refusal), '23505' (a unique index), '23514' (a check constraint or a raise that
 * chose that code) and '42883' (no such function) are four different defences. A test that
 * accepted any error would pass on a database where the one being checked had been deleted and
 * another happened to fire.
 */
const refused = (name, res, code) => {
  if (!res.ok && res.code === code) pass++;
  else if (res.ok) fails.push(`${name}\n       got  allowed (${res.count} row(s))\n       want refused ${code}`);
  else fails.push(`${name}\n       got  refused ${res.code}: ${res.message}\n       want refused ${code}`);
};

const group = (name) => console.log(`\n  ${name}`);

// bigint and numeric come back from node-postgres as strings, because they do not fit a JS
// number in general. Comparing '400' against 400 would fail for a reason that has nothing to do
// with the engine.
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
  // The engine યુવકો. None carries a committed ledger row, so every assertion in §A-§O is over
  // rows this file's own sandbox just caused to be written.
  alpha: 'a1111111-1111-4111-8111-111111111111',
  beta: 'b2222222-2222-4222-8222-222222222222',
  gamma: 'c3333333-3333-4333-8333-333333333333',
  delta: 'd0000000-0000-4000-8000-000000000000',

  // Three rows written in 0021's shape, before 0031 existed. §P is about these and nothing else
  // may touch them.
  legacy: '1e999999-9999-4999-8999-999999999999',

  // The RLS fixture. His record is committed, so §G can be driven as a real signed-in યુવક with
  // RLS enforced rather than as the owner, which would bypass every policy being tested.
  mohan: 'd4444444-4444-4444-8444-444444444444',
  nayan: 'e5555555-5555-4555-8555-555555555555',

  // SUPER_ADMIN: progress.read, users.read AND settings.update.
  admin: '07777777-7777-4777-8777-777777777777',
  // CONTENT_MANAGER: holds neither progress.read nor users.read, and is therefore refused by
  // admin_assert_progress_reader() rather than shown an empty report (§31).
  content: '29999999-9999-4999-8999-999999999999',
};

const SCENE = (n) => `d-${String(n).padStart(3, '0')}`;
const RANGE = (a, b) => {
  const out = [];
  for (let i = a; i <= b; i++) out.push(SCENE(i));
  return out;
};

// ૧૦૮ live દ્રશ્યો and three withheld, so that the subtraction stays observable: a tick on a
// દ્રશ્ય the સંચાલક has taken out of the collection is not a tick that may be counted, and
// admin_withheld_scene_ids() (0029) is the only authority Postgres has on the question.
const LIVE = 108;
const WITHHELD = [SCENE(109), SCENE(110), SCENE(111)];

const L4 = [
  ['4.1', 1, [SCENE(1), SCENE(2)]],
  ['4.2', 2, [SCENE(3), SCENE(4)]],
];

const ACT = {};

// The committed ledger, worked out here rather than read back.
const LEGACY_ROWS = 3;
const LEGACY_POINTS = 100 + 300 + 400; // 800

// ════════════════════════════════════════════════════════════════════ the fixtures

async function fixtures(db) {
  // Everything here runs as the owner, which is what a migration or the seed script is. RLS does
  // not apply, but every trigger still fires — including level4_attempts_award and
  // daily_record_guard, which is why no settings row is written in this function. With nothing
  // configured `point_value_for` is 0 everywhere and the trigger writes nothing, so the ledger
  // below holds exactly the rows this file chose. Each group configures the rules it needs,
  // inside a transaction it rolls back.

  const people = [
    [U.alpha, 'ALP101', 'Alpha Yuvak', '9811100001', 'surat', 'varachha'],
    [U.beta, 'BET102', 'Beta Yuvak', '9811100002', 'surat', 'varachha'],
    [U.gamma, 'GAM103', 'Gamma Yuvak', '9811100003', 'surat', 'vedroad'],
    [U.delta, 'DEL111', 'Delta Yuvak', '9811100011', 'surat', 'vedroad'],
    [U.legacy, 'LEG104', 'Legacy Yuvak', '9811100004', 'surat', 'varachha'],
    [U.mohan, 'MOH105', 'Mohan Yuvak', '9811100005', 'surat', 'varachha'],
    [U.nayan, 'NAY106', 'Nayan Yuvak', '9811100006', 'surat', 'vedroad'],
    [U.admin, 'ADM108', 'Sanchalak Admin', '9811100008', 'surat', 'varachha'],
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
  // seven columns 0031 added are left at their default, which is NULL. It is also §O's control:
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

  // ── the committed record, for the RLS group ─────────────────────────────────
  //
  // Written directly rather than through daily_record_save(), so that §G is about who may READ
  // and WRITE the rows and not about what a save computes. The guard pins the window and the
  // counts guard pins the derived columns, which is itself asserted in §H.
  const rid = (
    await db.query(
      `insert into public.daily_activity_records (user_id, activity_date)
       values ($1, timezone('Asia/Kolkata', now())::date) returning id`,
      [U.mohan]
    )
  ).rows[0].id;

  await db.query(
    `insert into public.daily_activity_counts (record_id, level_id, activity_key, reported_count)
     values ($1, 2, 'darshan', 2)`,
    [rid]
  );
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
   * sandbox would come back as 25P02 and the group would report a cascade of failures whose only
   * cause is the first one.
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

  /** The base configuration: 0021's four numbers and nothing 0031, 0033 or 0034 added. */
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

  /** The one write path. `p_counts` is the payload the new screen posts. */
  const save = async (date, counts, token = null) =>
    (
      await db.query('select public.daily_record_save($1::date, $2::jsonb, $3::uuid) r', [
        date,
        JSON.stringify(counts),
        token,
      ])
    ).rows[0].r;

  const trySave = (date, counts, token = null) =>
    soft('select public.daily_record_save($1::date, $2::jsonb, $3::uuid) r', [date, JSON.stringify(counts), token]);

  const get = async (date = null) =>
    (await db.query('select public.daily_record_get($1::date) r', [date])).rows[0].r;

  const statusOf = async () => (await db.query('select public.daily_record_status() r')).rows[0].r;

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

  const paidRows = async (uid) => (await ledger(uid)).map((r) => [r.level_id, r.activity_key, r.points, r.award_kind]);

  /** What the ledger says one day is worth. The figure every screen reads. */
  const daySum = async (uid, date) =>
    Number(
      (
        await db.query(
          `select coalesce(sum(points), 0)::int s from public.point_transactions
           where user_id = $1 and activity_date = $2::date`,
          [uid, date]
        )
      ).rows[0].s
    );

  const record = async (uid, date) =>
    (
      await db.query(
        `select id, version, status, total_base_points, total_bonus_points, total_points,
                locked_at, first_submitted_at, edit_until,
                -- Compared against the function rather than against a literal, because the
                -- interval a timestamptz subtraction yields is normalised ('1 day', not
                -- '24:00:00') and a test that pinned the spelling would be pinning the
                -- formatter and not the rule.
                (edit_until = first_submitted_at + public.daily_record_window()) as window_ok
         from public.daily_activity_records where user_id = $1 and activity_date = $2::date`,
        [uid, date]
      )
    ).rows[0];

  /**
   * `reported_count` and `reported_sessions` for one (day, level), read on its own.
   *
   * Deliberately NOT a column added to `counts()` below. That helper's rows are compared whole
   * by several assertions in this file, so widening it fails them with a diff about a column
   * they were never about — which is exactly what happened when 0049's tests were first
   * written. A new question gets a new reader.
   */
  const sittings = async (uid, date, level) =>
    (
      await db.query(
        `select c.reported_count, c.reported_sessions
         from public.daily_activity_counts c
         join public.daily_activity_records r on r.id = c.record_id
         where r.user_id = $1 and r.activity_date = $2::date and c.level_id = $3`,
        [uid, date, level]
      )
    ).rows[0];

  const counts = async (uid, date) =>
    (
      await db.query(
        `select c.level_id, c.activity_key, c.reported_count, c.recorded_count, c.verified,
                c.points, c.scene_ids
         from public.daily_activity_counts c
         join public.daily_activity_records r on r.id = c.record_id
         where r.user_id = $1 and r.activity_date = $2::date
         order by c.level_id, c.activity_key`,
        [uid, date]
      )
    ).rows;

  const trail = async (uid, date) =>
    (
      await db.query(
        `select u.version, u.action, u.level_id, u.activity_key, u.old_count, u.new_count,
                u.old_points, u.new_points, (u.client_token is not null) as tokened
         from public.daily_activity_updates u
         join public.daily_activity_records r on r.id = u.record_id
         where r.user_id = $1 and r.activity_date = $2::date
         order by u.id`,
        [uid, date]
      )
    ).rows;

  /**
   * Move a record's window, with the guard switched off for one statement.
   *
   * There is no way to move the clock inside one transaction, and the whole of §C is about the
   * clock. Disabling the trigger for the fixture write is the honest way round it: the rule
   * being tested is what the trigger does on the NEXT write, and that one runs with the trigger
   * back on. `first_submitted_at` is moved with `edit_until` so the row still satisfies
   * daily_activity_records_window_check, which is itself part of what is being kept honest.
   */
  const moveWindow = async (uid, date, expr) => {
    await db.query('alter table public.daily_activity_records disable trigger daily_record_guard');
    await db.query(
      `update public.daily_activity_records
          set edit_until = ${expr},
              first_submitted_at = (${expr}) - interval '24 hours'
        where user_id = $1 and activity_date = $2::date`,
      [uid, date]
    );
    await db.query('alter table public.daily_activity_records enable trigger daily_record_guard');
  };

  const day = async (n) =>
    (await db.query(`select (timezone('Asia/Kolkata', now())::date - $1::int)::text d`, [n])).rows[0].d;

  const TODAY = await day(0);
  const YESTERDAY = await day(1);
  const THREE_AGO = await day(3);

  // ══════════════════════════════════════════════════════ §0 the migration
  group('§0  0034 applied, applies again, and built what it said it would');

  eq('every migration in supabase/migrations applied, 0034 among them', files.includes('0034_daily_records.sql'), true);

  {
    /*
      The file can be applied **again**, on a database that already has it.

      Not a theoretical property. 0031 reached production, 0032 failed behind it on a reserved
      keyword, and re-running 0031 to carry the fix stopped at 42710 because `add constraint` has
      no `if not exists`. A migration that cannot be re-applied is a migration that cannot be
      corrected. The row count and sum are checked either side because an idempotent *schema*
      change that quietly rewrote data would pass a "no error" test and fail the one that matters.
    */
    const shape = `select count(*)::int n, coalesce(sum(points), 0)::int p,
                          count(*) filter (where award_kind is null)::int legacy
                   from public.point_transactions`;
    const before = (await db.query(shape)).rows[0];
    const recBefore = (await db.query('select count(*)::int n from public.daily_activity_records')).rows[0].n;
    const cfgBefore = (await db.query('select count(*)::int n from public.point_config_versions')).rows[0].n;

    const sql = readFileSync(join(MIGRATIONS, '0034_daily_records.sql'), 'utf8');
    const res = await attempt(db, sql);
    eq('0034 applies cleanly a second time', res.ok ? 'ok' : `${res.code} ${res.message}`, 'ok');

    const after = (await db.query(shape)).rows[0];
    eq('and re-applying it moves no row, no point and no legacy row', after, before);
    eq(
      'the daily records it holds are untouched by the re-apply',
      (await db.query('select count(*)::int n from public.daily_activity_records')).rows[0].n,
      recBefore
    );
    eq(
      'and the configuration history is not re-seeded',
      (await db.query('select count(*)::int n from public.point_config_versions')).rows[0].n,
      cfgBefore
    );
  }

  eq(
    'DAILY_ADJUST is the seventh award kind the ledger accepts',
    (
      await db.query(
        `select pg_get_constraintdef(oid) d from pg_constraint
         where conname = 'point_transactions_kind_check'`
      )
    ).rows[0].d.includes("'DAILY_ADJUST'"),
    true
  );

  eq(
    'and it may be negative, beside MANUAL and BONUS',
    (
      await db.query(
        `select pg_get_constraintdef(oid) d from pg_constraint
         where conname = 'point_transactions_points_check'`
      )
    ).rows[0].d.includes("'DAILY_ADJUST'"),
    true
  );

  eq(
    'DAILY_RECORD is a source the ledger accepts',
    (
      await db.query(
        `select pg_get_constraintdef(oid) d from pg_constraint
         where conname = 'point_transactions_source_check'`
      )
    ).rows[0].d.includes("'DAILY_RECORD'"),
    true
  );

  eq(
    'a repeatable kind still has to carry the key that stops it repeating',
    (
      await db.query(
        `select pg_get_constraintdef(oid) d from pg_constraint
         where conname = 'point_transactions_repeatable_needs_key'`
      )
    ).rows.length,
    1
  );

  eq(
    'daily_activity_records carries the columns 0034 declares',
    (
      await db.query(
        `select column_name, is_nullable from information_schema.columns
         where table_schema = 'public' and table_name = 'daily_activity_records'
         order by column_name`
      )
    ).rows.map((r) => [r.column_name, r.is_nullable]),
    [
      ['activity_date', 'NO'],
      ['edit_until', 'NO'],
      ['first_submitted_at', 'NO'],
      ['id', 'NO'],
      ['last_updated_at', 'NO'],
      ['locked_at', 'YES'],
      ['status', 'NO'],
      ['total_base_points', 'NO'],
      ['total_bonus_points', 'NO'],
      ['total_points', 'NO'],
      ['user_id', 'NO'],
      ['version', 'NO'],
    ]
  );

  /*
    `reported_sessions` arrived with 0049 — the sittings a લેવલ ૩ day was reported in.

    This assertion is a spelled-out column list precisely so that a column appearing beside the
    others has to be a deliberate edit here as well, and this is that edit. What the column is
    NOT is the important half: `reported_count` remains the only figure anything reads. The
    sittings decide it on the way in and are read back to redraw the form; the points, the
    ledger reconciliation, the milestone counts and every admin report are unchanged, and §J
    below asserts exactly that.
  */
  eq(
    'daily_activity_counts holds reported beside recorded, the દ્રશ્યો and the sittings behind them',
    (
      await db.query(
        `select column_name from information_schema.columns
         where table_schema = 'public' and table_name = 'daily_activity_counts'
         order by column_name`
      )
    ).rows.map((r) => r.column_name),
    [
      'activity_key', 'level_id', 'points', 'record_id', 'recorded_count', 'reported_count',
      'reported_sessions', 'scene_ids', 'verified',
    ]
  );

  eq(
    'and the checks that keep a record meaningful',
    (
      await db.query(
        `select conname from pg_constraint
         where conrelid = 'public.daily_activity_records'::regclass and contype = 'c'
         order by conname`
      )
    ).rows.map((r) => r.conname),
    [
      'daily_activity_records_status_check',
      'daily_activity_records_total_check',
      'daily_activity_records_version_check',
      'daily_activity_records_window_check',
    ]
  );

  eq(
    'every function 0034 promises exists',
    (
      await db.query(
        `select distinct p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.proname in ('daily_record_save','daily_record_get','daily_record_status',
                             'daily_record_seal','daily_record_snapshot','daily_record_points',
                             'daily_record_recorded','daily_record_guard','daily_record_window',
                             'daily_max_for','point_config_snapshot','point_config_document',
                             'admin_daily_records','admin_daily_record_detail',
                             'admin_point_config_versions')
         order by p.proname`
      )
    ).rows.map((r) => r.proname),
    [
      'admin_daily_record_detail',
      'admin_daily_records',
      'admin_point_config_versions',
      'daily_max_for',
      'daily_record_get',
      'daily_record_guard',
      'daily_record_points',
      'daily_record_recorded',
      'daily_record_save',
      'daily_record_seal',
      'daily_record_snapshot',
      'daily_record_status',
      'daily_record_window',
      'point_config_document',
      'point_config_snapshot',
    ]
  );

  eq(
    'the window is 24 hours, in one place',
    (await db.query(`select public.daily_record_window()::text w`)).rows[0].w,
    '24:00:00'
  );

  eq(
    'and there is no delete policy on either table, for anybody',
    (
      await db.query(
        `select count(*)::int n from pg_policies
         where schemaname = 'public'
           and tablename in ('daily_activity_records', 'daily_activity_counts')
           and cmd = 'DELETE'`
      )
    ).rows[0].n,
    0
  );

  eq(
    'nor any write policy at all on the audit trail or the configuration history',
    (
      await db.query(
        `select count(*)::int n from pg_policies
         where schemaname = 'public'
           and tablename in ('daily_activity_updates', 'point_config_versions')
           and cmd <> 'SELECT'`
      )
    ).rows[0].n,
    0
  );

  // ══════════════════════════════════════════════════════ §A
  group('§A  a first save creates the record and stamps the window');

  await sandbox(async () => {
    await configure(BASE);
    await signIn(U.alpha);

    const r = await save(TODAY, [{ level: 2, activity: 'darshan', count: 1 }]);

    eq('the save reports the day it created', [r.date, r.exists, r.version], [TODAY, true, 1]);
    eq('its window is open and it says how long remains', [r.status, r.editable, r.remainingSeconds > 86000], [
      'OPEN',
      true,
      true,
    ]);

    const rec = await record(U.alpha, TODAY);
    eq('one record row exists, at version 1, OPEN and unlocked', [rec.version, rec.status, rec.locked_at], [1, 'OPEN', null]);
    eq('and its window is exactly daily_record_window() long', rec.window_ok, true);

    eq('the per-level detail is one row, priced by the same rules the engine uses', await counts(U.alpha, TODAY), [
      { level_id: 2, activity_key: 'darshan', reported_count: 1, recorded_count: 0, verified: false, points: 200, scene_ids: [] },
    ]);

    eq('the record stores the total', [rec.total_base_points, rec.total_bonus_points, rec.total_points], [200, 0, 200]);
    eq('and the ledger equals it — one compensating row, written through point_award()', await paidRows(U.alpha), [
      [0, '', 200, 'DAILY_ADJUST'],
    ]);
    eq('by construction: sum(point_transactions) for the day == total_points', await daySum(U.alpha, TODAY), 200);

    eq('the audit trail holds a head row and one level row', await trail(U.alpha, TODAY), [
      { version: 1, action: 'CREATED', level_id: 2, activity_key: 'darshan', old_count: null, new_count: 1, old_points: null, new_points: 200, tokened: false },
      { version: 1, action: 'CREATED', level_id: null, activity_key: '', old_count: null, new_count: null, old_points: 0, new_points: 200, tokened: false },
    ]);

    eq(
      'and the compensating row carries the record and its version as its key, never an attempt id',
      (await ledger(U.alpha))[0].idempotency_key,
      `daily:${rec.id}:1`
    );
  });

  await sandbox(async () => {
    await configure(BASE);
    await signIn(U.alpha);
    refused('a day that has not happened yet cannot be reported', await trySave(await day(-1), []), '23514');
    refused('nor a negative count', await trySave(TODAY, [{ level: 2, activity: 'darshan', count: -1 }]), '23514');
    refused('nor an entry with no level', await trySave(TODAY, [{ activity: 'darshan', count: 1 }]), '23514');
    refused('nor the same level and activity twice in one payload', await trySave(TODAY, [
      { level: 2, activity: 'darshan', count: 1 },
      { level: 2, activity: 'darshan', count: 2 },
    ]), '23514');

    // A shape mismatch that silently zeroed a યુવક's day would be the worst failure available
    // here, so an object keyed by level is refused loudly rather than read as an empty list.
    refused(
      'an object keyed by level is refused, not read as an empty day',
      await soft(`select public.daily_record_save($1::date, $2::jsonb, null)`, [TODAY, JSON.stringify({ 1: 0, 2: 3 })]),
      '23514'
    );
  });

  await sandbox(async () => {
    // Liberality about names, never about shape. A client writing snake_case is not a client
    // with a bug, and a mapping layer on the far side would be a second place for the shape to
    // be wrong.
    await configure({ ...BASE, earn: { level2: 'EVERY' } });
    await signIn(U.alpha);
    const r = await save(TODAY, [{ level_id: 2, activity_key: 'darshan', reported: 2 }]);
    eq('level_id, activity_key and reported are read as level, activity and count', [
      r.totals.points,
      (await counts(U.alpha, TODAY))[0].reported_count,
    ], [400, 2]);
  });

  await sandbox(async () => {
    await configure({ ...BASE, dailyMax: { level2: 5 } });
    await signIn(U.alpha);

    const empty = await get(TODAY);
    eq('a day with no record yet is editable, with no clock running', [
      empty.exists,
      empty.editable,
      empty.remaining_seconds,
      empty.total_points,
    ], [false, true, 0, 0]);
    eq('and it still carries every maximum the સંચાલક set, so the form can bound itself', empty.maximums, {
      level2: 5,
    });
    eq('a day that has not happened is not editable', (await get(await day(-1))).editable, false);

    await save(TODAY, [{ level: 2, activity: 'darshan', count: 1 }]);
    const g = await get(TODAY);
    eq('the countdown gets a duration, never null and never negative', g.remaining_seconds > 86000, true);
    eq('snake_case and camelCase carry the same figures', [
      g.edit_until === g.editUntil,
      g.total_points === g.totals.points,
      g.base_points === g.totals.base,
    ], [true, true, true]);
    eq('and each level carries its own maximum beside its counts', [
      g.counts[0].max,
      g.counts[0].reported_count,
      g.counts[0].recorded_count,
    ], [5, 1, 0]);
    eq('a level with no maximum sends null, never 0', (await db.query('select public.daily_max_for(1) m')).rows[0].m, null);
  });

  // ══════════════════════════════════════════════════════ §B
  group('§B  an edit inside the window moves the day, and the ledger still equals it');

  await sandbox(async () => {
    // EVERY, so that a count is a multiplier and an edit is visible in the money. Under
    // DAY_FIRST the day pays once however many times he did it, which is 0021's rule and is
    // asserted in §O.
    await configure({ ...BASE, earn: { level2: 'EVERY' } });
    await signIn(U.alpha);

    await save(TODAY, [{ level: 2, activity: 'darshan', count: 2 }]);
    eq('two દર્શન at ૨૦૦ is ૪૦૦', await daySum(U.alpha, TODAY), 400);

    const r = await save(TODAY, [{ level: 2, activity: 'darshan', count: 3 }]);
    eq('corrected to three, the record says ૬૦૦ at version 2', [r.totals.points, r.version], [600, 2]);
    eq('the ledger says ૬૦૦ too', await daySum(U.alpha, TODAY), 600);
    eq('and it got there by adding, never by editing', await paidRows(U.alpha), [
      [0, '', 400, 'DAILY_ADJUST'],
      [0, '', 200, 'DAILY_ADJUST'],
    ]);
    eq('the record and the ledger agree, which is what §39 asks', [r.totals.points, r.ledgerPoints], [600, 600]);

    eq('and the trail records ૨ → ૩ and ૪૦૦ → ૬૦૦ separately from the money', (await trail(U.alpha, TODAY)).slice(2), [
      { version: 2, action: 'UPDATED', level_id: 2, activity_key: 'darshan', old_count: 2, new_count: 3, old_points: 400, new_points: 600, tokened: false },
      { version: 2, action: 'UPDATED', level_id: null, activity_key: '', old_count: null, new_count: null, old_points: 400, new_points: 600, tokened: false },
    ]);
  });

  await sandbox(async () => {
    // The auto-award and the record, on one day. The event pays first and the form adjusts —
    // which is the mechanism the architecture note states, and the case where a compensating
    // row is genuinely the only shape that works.
    await configure(BASE);
    await signIn(U.alpha);

    await submit(2, 'darshan', [], 0);
    eq('the app paid the day when it was submitted', await daySum(U.alpha, TODAY), 200);

    await configure({ ...BASE, earn: { level2: 'EVERY' } });
    const r = await save(TODAY, [{ level: 2, activity: 'darshan', count: 3 }]);

    eq('the record says three દર્શન is ૬૦૦', r.totals.points, 600);
    eq('so the delta is ૪૦૦ and not ૬૦૦ — the ૨૦૦ already paid is not paid twice', await paidRows(U.alpha), [
      [2, 'darshan', 200, 'DAY_FIRST'],
      [0, '', 400, 'DAILY_ADJUST'],
    ]);
    eq('and the day sums to the record', await daySum(U.alpha, TODAY), 600);
  });

  // ══════════════════════════════════════════════════════ §C
  group('§C  one second before edit_until is accepted, one second after is refused');

  await sandbox(async () => {
    await configure({ ...BASE, earn: { level2: 'EVERY' } });
    await signIn(U.alpha);
    await save(TODAY, [{ level: 2, activity: 'darshan', count: 1 }]);

    await moveWindow(U.alpha, TODAY, `now() + interval '1 second'`);
    const r = await save(TODAY, [{ level: 2, activity: 'darshan', count: 2 }]);
    eq('one second before the window closes, the edit lands', [r.totals.points, r.version], [400, 2]);
  });

  await sandbox(async () => {
    await configure({ ...BASE, earn: { level2: 'EVERY' } });
    await signIn(U.alpha);
    await save(TODAY, [{ level: 2, activity: 'darshan', count: 1 }]);

    await moveWindow(U.alpha, TODAY, `now() - interval '1 second'`);
    refused(
      'one second after, it is refused',
      await trySave(TODAY, [{ level: 2, activity: 'darshan', count: 2 }]),
      '23514'
    );
    eq('and nothing moved: the day still reads what it read', await daySum(U.alpha, TODAY), 200);
    eq('the record is still at version 1', (await record(U.alpha, TODAY)).version, 1);

    // The trigger, not the function. A rule that only lived in daily_record_save() would be a
    // rule a service key walks past, which is 0026:48-51's second argument for a trigger.
    refused(
      'and a direct UPDATE is refused too, by the trigger and not by the function',
      await soft(
        `update public.daily_activity_records set total_points = 9999
         where user_id = $1 and activity_date = $2::date`,
        [U.alpha, TODAY]
      ),
      '42501'
    );

    // With the writer flag set by hand — which only the owner or a service key can do — the
    // window check is still the one that answers. This is the assertion that the window has no
    // bypass at all.
    await db.query(`select set_config('varni.daily_record', 'save', true)`);
    refused(
      'even with the writer flag set by hand, the closed window still refuses',
      await soft(
        `update public.daily_activity_records set total_base_points = 0, total_bonus_points = 0, total_points = 0
         where user_id = $1 and activity_date = $2::date`,
        [U.alpha, TODAY]
      ),
      '23514'
    );
    await db.query(`select set_config('varni.daily_record', '', true)`);
  });

  await sandbox(async () => {
    await configure(BASE);
    await signIn(U.alpha);
    await save(TODAY, [{ level: 2, activity: 'darshan', count: 1 }]);
    await moveWindow(U.alpha, TODAY, `now() - interval '1 second'`);

    const s = await statusOf();
    eq('a closed record reads LOCKED and not editable', [s.today.status, s.today.editable, s.today.remainingSeconds], [
      'LOCKED',
      false,
      0,
    ]);
    const rec = await record(U.alpha, TODAY);
    eq('and the seal stamped the column, with the instant the window closed', [rec.status, rec.locked_at !== null], [
      'LOCKED',
      true,
    ]);
    eq('so the panel never has to compare its own clock', s.open, []);
  });

  // ══════════════════════════════════════════════════════ §D
  group('§D  the window is 24 hours from the first submission, not midnight and not the day after');

  await sandbox(async () => {
    await configure(BASE);
    await signIn(U.alpha);

    const r = await save(THREE_AGO, [{ level: 2, activity: 'darshan', count: 1 }]);
    const rec = await record(U.alpha, THREE_AGO);

    eq('a record opened today for a day three days past is OPEN', [r.status, r.editable], ['OPEN', true]);
    eq('its window is 24 hours long', rec.window_ok, true);

    const t = (
      await db.query(
        `select (first_submitted_at between now() - interval '5 seconds' and now())  as from_now,
                (edit_until > now() + interval '23 hours')                            as still_open,
                (edit_until <> ($2::date + 1)::timestamptz)                           as not_day_after,
                (edit_until <> date_trunc('day', now()) + interval '1 day')           as not_midnight
         from public.daily_activity_records where user_id = $1 and activity_date = $2::date`,
        [U.alpha, THREE_AGO]
      )
    ).rows[0];

    eq('measured from the first submission', t.from_now, true);
    eq('so it is still open a full day later, though the day itself is long past', t.still_open, true);
    eq('it is NOT activity_date + 1 day', t.not_day_after, true);
    eq('and it is NOT the next midnight', t.not_midnight, true);
  });

  // ══════════════════════════════════════════════════════ §E
  group('§E  a downward correction writes a negative delta');

  await sandbox(async () => {
    await configure({ ...BASE, earn: { level2: 'EVERY' } });
    await signIn(U.alpha);

    await save(TODAY, [{ level: 2, activity: 'darshan', count: 3 }]);
    const r = await save(TODAY, [{ level: 2, activity: 'darshan', count: 2 }]);

    eq('corrected from three back down to two, the record says ૪૦૦', r.totals.points, 400);
    eq('and the ledger got there with a NEGATIVE row, not by editing the first one', await paidRows(U.alpha), [
      [0, '', 600, 'DAILY_ADJUST'],
      [0, '', -200, 'DAILY_ADJUST'],
    ]);
    eq('the day sums to the record', await daySum(U.alpha, TODAY), 400);

    // A correction that was itself a mistake is corrected by a third row, and all three stay.
    const back = await save(TODAY, [{ level: 2, activity: 'darshan', count: 3 }]);
    eq('and a third correction is a third row', (await paidRows(U.alpha)).length, 3);
    eq('with the day back at ૬૦૦', [back.totals.points, await daySum(U.alpha, TODAY)], [600, 600]);
  });

  await sandbox(async () => {
    // Removing a level from the payload is a statement that it was 0, not a silence. A loop over
    // the payload alone would leave yesterday's count standing and paid.
    await configure({ ...BASE, earn: { level2: 'EVERY' } });
    await signIn(U.alpha);

    await save(TODAY, [{ level: 2, activity: 'darshan', count: 2 }]);
    const r = await save(TODAY, []);

    eq('a level dropped from the payload is reported as 0', (await counts(U.alpha, TODAY)).map((c) => c.reported_count), [0]);
    eq('the record falls to nothing', r.totals.points, 0);
    eq('and the ledger is taken back down to meet it', await daySum(U.alpha, TODAY), 0);
  });

  // ══════════════════════════════════════════════════════ §F
  group('§F  the same client token twice is one save');

  await sandbox(async () => {
    await configure({ ...BASE, earn: { level2: 'EVERY' } });
    await signIn(U.alpha);

    const token = '11111111-2222-4333-8444-555555555555';
    const first = await save(TODAY, [{ level: 2, activity: 'darshan', count: 2 }], token);
    const again = await save(TODAY, [{ level: 2, activity: 'darshan', count: 5 }], token);

    eq('the retry returns the record it already wrote', [again.version, again.totals.points], [first.version, 400]);
    eq('one set of ledger rows, not two', (await paidRows(U.alpha)).length, 1);
    eq('one head row in the trail, not two', (await trail(U.alpha, TODAY)).filter((r) => r.level_id === null).length, 1);
    eq('and the day is still what the first save made it', await daySum(U.alpha, TODAY), 400);

    // The index is what decides the race the question above cannot — a second head row carrying
    // the same token is refused, and the whole transaction with it. A refused duplicate and a
    // paid duplicate are not equally bad outcomes.
    const rid = (await record(U.alpha, TODAY)).id;
    refused(
      'and the index refuses a second head row under the same token',
      await soft(
        `insert into public.daily_activity_updates (record_id, user_id, version, client_token)
         values ($1, $2, 2, $3)`,
        [rid, U.alpha, token]
      ),
      '23505'
    );

    const other = await save(TODAY, [{ level: 2, activity: 'darshan', count: 5 }], '99999999-2222-4333-8444-555555555555');
    eq('a genuinely new save with a new token still lands', [other.version, other.totals.points], [2, 1000]);
  });

  // ══════════════════════════════════════════════════════ §G
  group('§G  a યુવક cannot reach another યુવક\'s day');

  eq(
    'daily_record_save takes no p_user, at any price',
    (
      await db.query(
        `select pg_get_function_arguments(p.oid) a from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'daily_record_save'`
      )
    ).rows[0].a,
    'p_date date DEFAULT NULL::date, p_counts jsonb DEFAULT \'[]\'::jsonb, p_client_token uuid DEFAULT NULL::uuid'
  );

  eq(
    'and neither does daily_record_get or daily_record_status',
    (
      await db.query(
        `select p.proname, pg_get_function_arguments(p.oid) a from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname in ('daily_record_get', 'daily_record_status')
         order by p.proname`
      )
    ).rows.map((r) => [r.proname, r.a.includes('p_user')]),
    [
      ['daily_record_get', false],
      ['daily_record_status', false],
    ]
  );

  await asUser(db, U.nayan, async () => {
    eq(
      'a યુવક sees none of another યુવક\'s records',
      (await db.query('select count(*)::int n from public.daily_activity_records where user_id = $1', [U.mohan])).rows[0]
        .n,
      0
    );
    eq(
      'nor his per-level counts',
      (await db.query('select count(*)::int n from public.daily_activity_counts')).rows[0].n,
      0
    );

    const upd = await attempt(
      db,
      `update public.daily_activity_records set total_points = 9999 where user_id = $1`,
      [U.mohan]
    );
    eq('an UPDATE of another યુવક\'s record touches nothing', upd.ok ? upd.count : upd.code, 0);

    const del = await attempt(db, `delete from public.daily_activity_records where user_id = $1`, [U.mohan]);
    eq('and a DELETE is refused outright — there is no delete policy for anybody', del.ok, false);
  });

  await asUser(db, U.mohan, async () => {
    eq(
      'his own record he can see',
      (await db.query('select count(*)::int n from public.daily_activity_records where user_id = $1', [U.mohan])).rows[0]
        .n,
      1
    );
    const g = (await db.query('select public.daily_record_get(null::date) r')).rows[0].r;
    eq('and daily_record_get answers for him and nobody else', [g.exists, g.counts.length], [true, 1]);
  });

  await asUser(db, U.admin, async () => {
    eq(
      'a સંચાલક holding progress.read sees it too',
      (await db.query('select count(*)::int n from public.daily_activity_records where user_id = $1', [U.mohan])).rows[0]
        .n,
      1
    );
  });

  // One refusal per transaction. A refused statement aborts the transaction it is in, so a
  // second probe inside the same asUser() block would come back as 25P02 — a cascade whose only
  // cause is the first refusal, and which would hide whether the second defence exists at all.
  await asUser(db, U.content, async () => {
    const r = await attempt(db, 'select * from public.admin_daily_records()');
    eq('a CONTENT_MANAGER is refused the report rather than shown an empty one', [r.ok, r.code], [false, '42501']);
  });

  await asUser(db, U.content, async () => {
    const d = await attempt(db, 'select public.admin_daily_record_detail($1, $2::date)', [U.mohan, TODAY]);
    eq('and refused the detail', [d.ok, d.code], [false, '42501']);
  });

  await asUser(db, U.content, async () => {
    const c = await attempt(db, 'select * from public.admin_point_config_versions(10)');
    eq('and the configuration history, which an RLS denial could not have told him about', [c.ok, c.code], [
      false,
      '42501',
    ]);
  });

  await asUser(db, U.admin, async () => {
    const r = await attempt(db, 'select * from public.admin_daily_records()');
    eq('a SUPER_ADMIN holding both permissions is not', [r.ok, r.rows.length], [true, 1]);
    eq('and the row he gets carries the committed fixture, sealed or not', [
      r.rows[0].level2_reported,
      r.rows[0].status,
      Number(r.rows[0].total_rows),
    ], [2, 'OPEN', 1]);
  });

  // ══════════════════════════════════════════════════════ §H
  group('§H  a યુવક cannot write edit_until, locked_at, version or a points column');

  await asUser(db, U.nayan, async () => {
    const ins = await attempt(
      db,
      `insert into public.daily_activity_records
         (user_id, activity_date, first_submitted_at, edit_until, locked_at, status, version,
          total_base_points, total_bonus_points, total_points)
       values ($1, timezone('Asia/Kolkata', now())::date,
               now() - interval '10 days', now() + interval '3650 days', null, 'OPEN', 77,
               99999, 99999, 199998)
       returning id`,
      [U.nayan]
    );
    eq('his INSERT lands — the own-row policy is the ownership idiom', ins.ok, true);

    const row = (
      await db.query(
        `select version, total_base_points, total_bonus_points, total_points, locked_at, status,
                (edit_until = first_submitted_at + public.daily_record_window()) as window_ok,
                (edit_until < now() + interval '25 hours') as bounded
         from public.daily_activity_records where user_id = $1`,
        [U.nayan]
      )
    ).rows[0];

    eq('but every column he tried to choose was pinned by the server', [
      row.version,
      row.total_base_points,
      row.total_bonus_points,
      row.total_points,
      row.locked_at,
      row.status,
    ], [1, 0, 0, 0, null, 'OPEN']);
    eq('a ten-year window is not a window he gets to have', [row.window_ok, row.bounded], [true, true]);

    const upd = await attempt(
      db,
      `update public.daily_activity_records set version = 99, total_points = 5000 where user_id = $1`,
      [U.nayan]
    );
    eq('and an UPDATE of his own row is refused: there is nothing here he moves', [upd.ok, upd.code], [false, '42501']);
  });

  await asUser(db, U.nayan, async () => {
    const rid = (
      await db.query(
        `insert into public.daily_activity_records (user_id, activity_date)
         values ($1, timezone('Asia/Kolkata', now())::date) returning id`,
        [U.nayan]
      )
    ).rows[0].id;

    await db.query(
      `insert into public.daily_activity_counts
         (record_id, level_id, activity_key, reported_count, recorded_count, verified, points, scene_ids)
       values ($1, 2, 'darshan', 3, 99, true, 100000, array['d-001','d-001'])`,
      [rid]
    );

    const c = (
      await db.query(
        `select reported_count, recorded_count, verified, points, scene_ids
         from public.daily_activity_counts where record_id = $1`,
        [rid]
      )
    ).rows[0];
    eq('recorded, verified and points are pinned however the row arrived', [
      c.reported_count,
      c.recorded_count,
      c.verified,
      c.points,
    ], [3, 0, false, 0]);
    eq('and the દ્રશ્યો are deduplicated even here', c.scene_ids, ['d-001']);

    const upd = await attempt(
      db,
      `update public.daily_activity_counts set points = 5000 where record_id = $1`,
      [rid]
    );
    eq('a direct UPDATE of a level\'s counts is refused', [upd.ok, upd.code], [false, '42501']);
  });

  await asUser(db, U.nayan, async () => {
    const t = await attempt(
      db,
      `insert into public.daily_activity_updates (record_id, user_id, version)
       select id, user_id, 1 from public.daily_activity_records limit 1`
    );
    eq('the audit trail is not writable by a client at all', t.ok, false);

    const c = await attempt(
      db,
      `insert into public.point_config_versions (version, document, resolved) values (9, '{}', '{}')`
    );
    eq('nor the configuration history', c.ok, false);
  });

  // ══════════════════════════════════════════════════════ §I
  group('§I  dailyMax is a setting, and it clamps');

  eq(
    'an untouched project has no maximum anywhere',
    canonical((await db.query(`select public.point_rules() -> 'dailyMax' r`)).rows[0].r),
    canonical({})
  );

  eq('and daily_max_for answers NULL, which is "no maximum"', (await db.query('select public.daily_max_for(2) m')).rows[0].m, null);

  await sandbox(async () => {
    refused('a maximum of 0 is refused — that is a level switched off, not a bound', await tryConfigure({ ...BASE, dailyMax: { level2: 0 } }), '23514');
    refused('a fractional maximum is refused', await tryConfigure({ ...BASE, dailyMax: { level2: 2.5 } }), '23514');
    refused('a maximum written as text is refused', await tryConfigure({ ...BASE, dailyMax: { level2: '3' } }), '23514');
    refused('and a key that is not a level', await tryConfigure({ ...BASE, dailyMax: { darshan: 3 } }), '23514');
    const ok = await tryConfigure({ ...BASE, dailyMax: { level2: 2 } });
    eq('a well-formed maximum saves', ok.ok, true);
  });

  await sandbox(async () => {
    await configure({ ...BASE, earn: { level2: 'EVERY' }, dailyMax: { level2: 2 } });
    await signIn(U.alpha);

    eq('the resolver reads it back', (await db.query('select public.daily_max_for(2) m')).rows[0].m, 2);

    const r = await save(TODAY, [{ level: 2, activity: 'darshan', count: 5 }]);
    eq('a report of ૫ against a maximum of ૨ is stored as ૨', (await counts(U.alpha, TODAY))[0].reported_count, 2);
    eq('and is paid as ૨, not as ૫', [r.totals.points, await daySum(U.alpha, TODAY)], [400, 400]);
    eq('a level with no maximum of its own is unbounded', (await db.query('select public.daily_max_for(1) m')).rows[0].m, null);
  });

  await sandbox(async () => {
    // The maximum bounds the evidence with the count, so the દ્રશ્યો never say more than the
    // number they back.
    await configure({ ...BASE, tick: { mode: 'TICK', perTick: 1 }, dailyMax: { level3: 3 } });
    await signIn(U.alpha);

    await save(TODAY, [{ level: 3, activity: 'revision', sceneIds: RANGE(1, 10) }]);
    const c = (await counts(U.alpha, TODAY))[0];
    eq('ten દ્રશ્યો against a maximum of three is three', [c.reported_count, c.scene_ids.length], [3, 3]);
    eq('and three ticks at ૧ each is ૩', await daySum(U.alpha, TODAY), 3);
  });

  // ══════════════════════════════════════════════════════ §J
  group('§J  duplicate લેવલ ૩ scene ids are counted once');

  await sandbox(async () => {
    await configure({ ...BASE, tick: { mode: 'TICK', perTick: 1 } });
    await signIn(U.alpha);

    const r = await save(TODAY, [
      { level: 3, activity: 'revision', sceneIds: [SCENE(1), SCENE(1), SCENE(2), SCENE(2), SCENE(3)] },
    ]);

    const c = (await counts(U.alpha, TODAY))[0];
    eq('five ids naming three દ્રશ્યો is three', [c.reported_count, c.scene_ids], [3, [SCENE(1), SCENE(2), SCENE(3)]]);
    eq('and three ticks at ૧ each is ૩, never ૫', [r.totals.points, await daySum(U.alpha, TODAY)], [3, 3]);
  });

  await sandbox(async () => {
    await configure({ ...BASE, tick: { mode: 'TICK', perTick: 1 } });
    await signIn(U.alpha);

    await save(TODAY, [{ level: 3, activity: 'revision', sceneIds: [SCENE(1), SCENE(2), ...WITHHELD] }]);
    const c = (await counts(U.alpha, TODAY))[0];
    eq('a દ્રશ્ય the સંચાલક has withheld is not one that may be counted', [c.reported_count, c.scene_ids], [
      2,
      [SCENE(1), SCENE(2)],
    ]);
  });

  // ══════════════════════════════════════════════════════ §K
  group('§K  reported above recorded is stored, and stored as unverified');

  await sandbox(async () => {
    await configure({ ...BASE, earn: { level2: 'EVERY' } });
    await signIn(U.alpha);

    // Two દર્શન the app saw, three the યુવક says he did. ધ્યાન done away from the phone still
    // happened, and the figure is trusted — but the trust is recorded.
    await submit(2, 'darshan', [], 0);
    await submit(2, 'darshan', [], 0);
    await save(TODAY, [{ level: 2, activity: 'darshan', count: 3 }]);

    const c = (await counts(U.alpha, TODAY))[0];
    eq('reported sits beside recorded', [c.reported_count, c.recorded_count], [3, 2]);
    eq('and the row is NOT verified', c.verified, false);
    eq('the day is nevertheless worth what he reported', await daySum(U.alpha, TODAY), 600);

    await save(TODAY, [{ level: 2, activity: 'darshan', count: 2 }]);
    const c2 = (await counts(U.alpha, TODAY))[0];
    eq('corrected down to what the app saw, the row becomes verified', [c2.reported_count, c2.verified], [2, true]);
  });

  await sandbox(async () => {
    // Measured in the unit the report was expressed in. Comparing a count of one against a count
    // of the other is how `verified` would come to mean nothing.
    await configure({ ...BASE, tick: { mode: 'TICK', perTick: 1 } });
    await signIn(U.alpha);

    await submit(3, 'revision', RANGE(1, 5), 5);
    await save(TODAY, [{ level: 3, activity: 'revision', sceneIds: RANGE(1, 4) }]);
    const c = (await counts(U.alpha, TODAY))[0];
    eq('a report in દ્રશ્યો is compared against દ્રશ્યો', [c.reported_count, c.recorded_count, c.verified], [4, 5, true]);
  });

  // ══════════════════════════════════════════════════════ §K2
  /*
    0049 — a day reported as sittings.

    A લેવલ ૩ day is a morning, an evening and a night, and what a યુવક knows at each of those
    moments is how many THIS time rather than the running total. So the payload may carry a list.

    **What is asserted here is the count and the breakdown, and deliberately not the ledger.**
    લેવલ ૩ under a તિક rule is priced by the event path and not by the form — 0035 excludes TICK
    and REVISION from the reconciliation on purpose, and §L and §O already own that behaviour.
    Asserting a day total here would be this group quietly re-testing 0035, and getting it wrong.

    The safety of the whole change is the first assertion: **the sittings decide
    `reported_count`, and nothing else in the schema learns they exist.** If that holds, the
    points, the reconciliation, the milestone substitution and every admin report go on reading
    one integer exactly as they did — which is why none of them was reissued.
  */
  group('§K2  a day reported as sittings is worth what the sittings come to');

  await sandbox(async () => {
    await configure(BASE);
    await signIn(U.alpha);

    /*
      `count: 999` is sent deliberately and is deliberately ignored. The list is more specific
      than a number beside it — the same rule `sceneIds` has followed since 0034 — and a client
      sends both only so that a server WITHOUT 0049 still saves a sane figure instead of dropping
      the key it does not know and writing a zero.
    */
    await save(TODAY, [{ level: 3, activity: 'revision', count: 999, sessions: [27, 15] }]);
    eq(
      'the sittings decide the count, not the number sent beside them',
      await sittings(U.alpha, TODAY, 3),
      { reported_count: 42, reported_sessions: [27, 15] }
    );

    // The correction a form makes every time a row is edited.
    await save(TODAY, [{ level: 3, activity: 'revision', sessions: [27, 15, 30] }]);
    eq(
      'adding a sitting moves the day, and the order is his',
      await sittings(U.alpha, TODAY, 3),
      { reported_count: 72, reported_sessions: [27, 15, 30] }
    );

    // Back to one figure. The stored breakdown must go with it, or a screen would draw rows
    // adding up to a number nobody sent.
    await save(TODAY, [{ level: 3, activity: 'revision', count: 50 }]);
    eq(
      'reporting one figure again clears the breakdown',
      await sittings(U.alpha, TODAY, 3),
      { reported_count: 50, reported_sessions: [] }
    );
  });

  await sandbox(async () => {
    // Every other level is untouched by a level that was split, and a payload with no `sessions`
    // key behaves exactly as it did under 0034 — the property that lets an older client keep
    // working against this schema.
    await configure({ ...BASE, earn: { level2: 'EVERY' } });
    await signIn(U.alpha);

    await save(TODAY, [
      { level: 2, activity: 'darshan', count: 2 },
      { level: 3, activity: 'revision', sessions: [5, 5] },
    ]);

    eq('a level sent without sessions stores none', await sittings(U.alpha, TODAY, 2), {
      reported_count: 2,
      reported_sessions: [],
    });
    eq('and the split level beside it is unaffected', await sittings(U.alpha, TODAY, 3), {
      reported_count: 10,
      reported_sessions: [5, 5],
    });
  });

  await sandbox(async () => {
    /*
      The સંચાલક's ceiling binds a list exactly as it binds a number, and the breakdown is
      trimmed with it: rows adding to more than the figure above them is a screen contradicting
      itself. Trimmed from the END, the straddling sitting reduced rather than dropped — the
      earliest sittings are the ones he is surest of, and losing a whole one would move a number
      he did not touch.
    */
    await configure({ ...BASE, dailyMax: { level3: 40 } });
    await signIn(U.alpha);

    await save(TODAY, [{ level: 3, activity: 'revision', sessions: [27, 15, 30] }]);
    const s = await sittings(U.alpha, TODAY, 3);
    eq('the sum is clamped to dailyMax', s.reported_count, 40);
    eq('and the sittings are trimmed to match', s.reported_sessions, [27, 13]);
    eq(
      'so the rows still add up to the figure above them',
      s.reported_sessions.reduce((a, b) => a + b, 0),
      s.reported_count
    );
  });

  await sandbox(async () => {
    // A malformed list is refused rather than read as an absent one, because absent means "keep
    // the single figure" and silently discarding a યુવક's sittings is the failure this column
    // exists to prevent.
    await configure(BASE);
    await signIn(U.alpha);

    eq(
      'sessions that are not a list are refused',
      (await trySave(TODAY, [{ level: 3, activity: 'revision', sessions: 42 }])).ok,
      false
    );
    eq(
      'a negative sitting is refused',
      (await trySave(TODAY, [{ level: 3, activity: 'revision', sessions: [5, -1] }])).ok,
      false
    );
    eq(
      'a sitting that is not a number is refused',
      (await trySave(TODAY, [{ level: 3, activity: 'revision', sessions: ['5'] }])).ok,
      false
    );
    eq(
      'an empty list is a real report of zero, not a malformed one',
      (await trySave(TODAY, [{ level: 3, activity: 'revision', sessions: [] }])).ok,
      true
    );
  });

  // ══════════════════════════════════════════════════════ §L
  group('§L  milestones follow the reported counts, and are never paid twice');

  await sandbox(async () => {
    await configure({ ...BASE, earn: { level2: 'EVERY' } });
    await rule({ name: 'every 3 darshan', level: 2, activity: 'darshan', threshold: 3, points: 50, mode: 'EVERY' });
    await signIn(U.alpha);

    // Not one event exists for him. The milestone is reached on his word alone, which is the
    // whole of §7's decision.
    const r = await save(TODAY, [{ level: 2, activity: 'darshan', count: 3 }]);

    eq('three reported દર્શન reach the milestone', await paidRows(U.alpha), [
      [0, '', 600, 'DAILY_ADJUST'],
      [2, 'darshan', 50, 'BONUS'],
    ]);
    eq('the record separates the base from the bonus', [r.totals.base, r.totals.bonus, r.totals.points], [600, 50, 650]);
    eq('and the ledger equals the total, bonus and all', await daySum(U.alpha, TODAY), 650);

    await save(TODAY, [{ level: 2, activity: 'darshan', count: 3 }]);
    eq('saving the same day again pays the milestone no second time', (await paidRows(U.alpha)).filter((r) => r[3] === 'BONUS').length, 1);
    eq('and the ledger has not moved', await daySum(U.alpha, TODAY), 650);
  });

  await sandbox(async () => {
    // The record speaks for the (day, level, activity) it names and for nothing else. A day the
    // record does not cover is still counted from the events, which is what makes an untouched
    // project answer exactly what 0033 answered.
    await configure({ ...BASE, earn: { level1: 'EVERY' } });
    await signIn(U.gamma);

    await submit(1, 'video', [], 0);
    eq('one event, one completion', num((await db.query(
      `select public.point_bonus_count($1, 'COMPLETION_COUNT', 1, 'video') c`, [U.gamma])).rows[0].c), 1);

    await save(TODAY, [{ level: 1, activity: 'video', count: 4 }]);
    eq('a record covering that day replaces its events with what he reported', num((await db.query(
      `select public.point_bonus_count($1, 'COMPLETION_COUNT', 1, 'video') c`, [U.gamma])).rows[0].c), 4);

    await db.query(
      `insert into public.activity_attempts
         (user_id, level_id, activity_key, activity_date, attempt_number, total_items, completed_items, status)
       values ($1, 1, 'video', (timezone('Asia/Kolkata', now())::date - 1), 1, 0, 0, 'COMPLETED')`,
      [U.gamma]
    );
    eq('and yesterday, which no record covers, is still counted from the events', num((await db.query(
      `select public.point_bonus_count($1, 'COMPLETION_COUNT', 1, 'video') c`, [U.gamma])).rows[0].c), 5);
  });

  await sandbox(async () => {
    // Points off is points off, whatever else is configured. A form filled in must not start
    // paying milestones on a project nobody switched on.
    await configure({ ...BASE, enabled: false });
    await rule({ name: 'anything', threshold: 1, points: 50, mode: 'EVERY' });
    await signIn(U.alpha);

    const r = await save(TODAY, [{ level: 2, activity: 'darshan', count: 3 }]);
    eq('with points switched off the day is worth nothing', [r.totals.points, await daySum(U.alpha, TODAY)], [0, 0]);
    eq('and no row was written at all', (await paidRows(U.alpha)).length, 0);
  });

  // ══════════════════════════════════════════════════════ §M
  group('§M  repricing leaves what was paid alone, and prices the next day at the new value');

  await sandbox(async () => {
    await configure({ ...BASE, version: 1 });
    await signIn(U.alpha);

    await save(YESTERDAY, [{ level: 2, activity: 'darshan', count: 1 }]);
    const paidThen = await ledger(U.alpha);
    eq('yesterday was paid ૨૦૦ at rule version 1', [paidThen[0].points, paidThen[0].rule_version], [200, 1]);

    await configure({ ...BASE, level2: 250, version: 2 });

    await save(TODAY, [{ level: 2, activity: 'darshan', count: 1 }]);
    const rows = await ledger(U.alpha);
    eq('today is paid ૨૫૦ at rule version 2', [rows[1].points, rows[1].rule_version], [250, 2]);
    eq('and yesterday\'s row is column for column what it was', rows[0], paidThen[0]);
    eq('the ledger has two rows and neither replaced the other', rows.length, 2);
  });

  // ══════════════════════════════════════════════════════ §N
  group('§N  a rule_version resolves to the document that produced it');

  await sandbox(async () => {
    await configure({ ...BASE, version: 7 });
    await configure({ ...BASE, level2: 250, version: 8 });

    const hist = (
      await db.query(
        `select version, (document ->> 'level2')::int as level2, (effective_until is null) as current
         from public.point_config_versions order by id`
      )
    ).rows;

    eq('each change is recorded as its own snapshot', hist.map((h) => [h.version, h.level2, h.current]).slice(-2), [
      [7, 200, false],
      [8, 250, true],
    ]);

    const doc7 = (await db.query('select public.point_config_document(7) d')).rows[0].d;
    const doc8 = (await db.query('select public.point_config_document(8) d')).rows[0].d;
    eq('version 7 resolves to the document that paid ૨૦૦', doc7.document.level2, 200);
    eq('version 8 to the one that pays ૨૫૦', doc8.document.level2, 250);
    eq('and the closed one carries the instant it stopped applying', doc7.effectiveUntil !== null, true);

    // The only change the history ever admits is closing a snapshot. Everything else, including
    // for the owner, is refused — which is what "append-only" has to mean to be worth saying.
    refused(
      'a snapshot\'s document cannot be edited',
      await soft(`update public.point_config_versions set document = '{}'::jsonb where version = 7`),
      '23514'
    );
    refused(
      'and a snapshot cannot be deleted',
      await soft(`delete from public.point_config_versions where version = 7`),
      '23514'
    );

    await signIn(U.admin);
    const listed = await db.query('select version, changed_by_name, is_current from public.admin_point_config_versions(10)');
    eq('the સંચાલક reads the history through an RPC that refuses rather than returns nothing', [
      listed.rows[0].version,
      listed.rows[0].is_current,
    ], [8, true]);
  });

  await sandbox(async () => {
    // A save that did not touch the points object writes no snapshot. A history that grew on
    // every unrelated settings write would be a history nobody could read.
    await configure({ ...BASE, version: 3 });
    const n1 = (await db.query('select count(*)::int n from public.point_config_versions')).rows[0].n;
    await configure({ ...BASE, version: 3 }, { marker: 1 });
    const n2 = (await db.query('select count(*)::int n from public.point_config_versions')).rows[0].n;
    eq('a settings save that leaves the points alone records nothing', n2, n1);
  });

  // ══════════════════════════════════════════════════════ §O
  group('§O  the default: no record, no dailyMax, and 0021\'s awarding is untouched');

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
    eq('not one DAILY_ADJUST row exists — nothing here filled in a form', rows.filter((r) => r.award_kind === 'DAILY_ADJUST').length, 0);

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
  });

  await sandbox(async () => {
    // 0033's counting, unchanged where no record exists. A milestone engine that started
    // answering differently the day 0034 deployed would move what every existing project pays.
    await configure(BASE);
    await signIn(U.gamma);
    await submit(1, 'video', [], 0);
    await submit(2, 'darshan', [], 0);
    await submit(3, 'revision', RANGE(1, 7), 7);
    await exam(U.gamma, '4.1', true);

    eq('COMPLETION_COUNT over every level is the events, exactly as 0033 counted them', num((await db.query(
      `select public.point_bonus_count($1, 'COMPLETION_COUNT', null, null) c`, [U.gamma])).rows[0].c), 4);
    eq('and ITEM_COUNT is the દ્રશ્યો and the કસોટી items', num((await db.query(
      `select public.point_bonus_count($1, 'ITEM_COUNT', null, null) c`, [U.gamma])).rows[0].c), 9);
  });

  await sandbox(async () => {
    // Every 0034 surface switched on at once, over the same યુવક and the same days his legacy
    // rows sit on. Nothing may reach them.
    await configure({ ...BASE, earn: { level1: 'EVERY', level2: 'EVERY' }, dailyMax: { level1: 9 }, version: 4 });
    await rule({ name: 'anything', threshold: 1, points: 5, mode: 'EVERY' });
    await signIn(U.legacy);

    await save(await day(5), [{ level: 1, activity: 'video', count: 3 }]);
    await save(await day(4), [{ level: 4, activity: '4.1', count: 2 }]);
    await save(TODAY, [{ level: 2, activity: 'darshan', count: 2 }]);

    const after = await ledger(U.legacy);
    const stillLegacy = after.filter((r) => r.award_kind === null);
    eq('the engine ran and wrote rows for him', after.length > LEGACY_ROWS, true);
    eq('there are still exactly three legacy rows', stillLegacy.length, LEGACY_ROWS);
    eq('and every column of every one of them is what it was', stillLegacy, legacyBefore);

    // The sharp case: a legacy row sits on the very day the record reconciles, and the
    // compensating row is computed against it rather than over the top of it.
    // Worked out on paper. Day 5 already carries two legacy rows summing to ૪૦૦ — ૧૦૦ for
    // લેવલ ૧ and ૩૦૦ for લેવલ ૩ — and the record says લેવલ ૧ was done three times, which under
    // EVERY at ૧૦૦ is ૩૦૦. The delta is therefore **negative**: the record is reconciled against
    // what the day already held rather than written over the top of it, and the legacy rows are
    // still standing untouched beside the compensating one. The milestone rule (threshold 1,
    // +5, EVERY) then pays three times against the three reported completions. ૩૦૦ + ૧૫.
    const d5 = await daySum(U.legacy, await day(5));
    eq('a day carrying a legacy award reconciles to the record without rewriting it', d5, 300 + 15);
  });

  // ══════════════════════════════════════════════════════ §P
  group('§P  the three pre-0031 rows are unmoved after everything above');

  eq('after every group in this file, the legacy rows are column for column what they were', await ledger(U.legacy), legacyBefore);
  eq(
    'and the ledger as a whole holds nothing that was not written by this file\'s own sandboxes',
    (await db.query(`select count(*)::int n from public.point_transactions`)).rows[0].n,
    LEGACY_ROWS
  );
  eq(
    'no daily record survived a sandbox either, except the committed RLS fixture',
    (await db.query('select count(*)::int n from public.daily_activity_records')).rows[0].n,
    1
  );
}

await main();
