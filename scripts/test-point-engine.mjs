/**
 * The point engine, against a real Postgres — `node scripts/test-point-engine.mjs`.
 *
 * 0031 widened the ledger and 0032 gave the સંચાલક a way to read it. Between them they touch
 * the one table in this project that is money, and they touch it while promising that nothing
 * already in it moves. Neither promise can be checked from JavaScript: the rules live in a
 * partial unique index, five check constraints, a SECURITY DEFINER writer nobody may execute,
 * an AFTER trigger on `level4_attempts`, and seven definer-side reporting functions. A suite
 * that mocked any of that would be asserting what its author typed.
 *
 * So this file does what scripts/test-admin-progress.mjs does: `docker run postgres:16`, apply
 * supabase/test/prelude.sql and every migration in filename order (scripts/lib/pgtest.mjs),
 * seed a population whose every figure was worked out on paper first, and then drive the real
 * writers and assert on the rows they actually wrote.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * What each group is protecting, and what it costs to get wrong
 * ────────────────────────────────────────────────────────────────────────────
 *
 *  §A  **The migrations apply, and what they claim to have built exists.** The columns, the
 *      partial index and its predicate, the idempotency index, the five checks. A migration
 *      that applied but built something else is the failure this whole file is downstream of.
 *
 *  §B  **The no-change guarantee.** POINT_SYSTEM_ARCHITECTURE §J3: "an untouched settings row
 *      must produce byte-identical awards after 0031 — this is a test, not an aspiration."
 *      Driven through `activity_submit()` and the `level4_attempts_award` trigger, never by
 *      calling `award_points()` by hand, and compared column by column against a row written
 *      by 0021's own INSERT statement, reproduced verbatim. If the two agree on every column
 *      0021 knew about, the awarding did not move.
 *
 *  §C  **Legacy rows are never rewritten.** `award_kind IS NULL` **is** the definition of a
 *      row written before 0031 (§J1). The fixture writes three of them before anything is
 *      configured, the whole engine is then exercised over the same user and the same days,
 *      and every column of all three must still be what it was. A backfill that guessed a
 *      kind would turn a fact into a guess and every screen would print the guess with the
 *      confidence of the fact.
 *
 *  §D  **તિક mode pays for what was newly brought to mind.** `fresh` is distinct submitted
 *      scene ids, minus withheld દ્રશ્યો, minus everything an earlier attempt of the same day
 *      already named. The subtraction is asserted head-on: the same ૧૦૮ ticks submitted twice
 *      in one day pay ૧૦૮ once and ૦ the second time. Without it a યુવક pressing નોંધાવો
 *      five times is paid for ૫૪૦ ticks he made once, and the ledger describes a day that did
 *      not happen.
 *
 *  §E  **The daily cap clamps and never pays negative.** A cap read from the ledger rather
 *      than counted in the caller, so the headroom cannot be spent twice.
 *
 *  §F  **પુનરાવર્તન mode pays per genuine submission, and a retry is not one.** The
 *      difference between "he did it again" and "his phone asked again" is the whole of §31.
 *
 *  §G  **લેવલ ૩ takes one branch or the other, never both.** A યુવક paid ૩૦૦ for the day
 *      *and* ૨ per tick has been paid twice for one act under two names.
 *
 *  §H  **The repeat rule.** A second passing કસોટી on an already-paid day, `byCode` beating
 *      `default`, `dailyLimit` stopping the third, and — the one that matters most — a
 *      configuration with `repeat.enabled = false` paying exactly ૦, as it did before 0031.
 *
 *  §I  **Liveness.** `effectiveFrom` in the future, `disabled: ['4.3']`, `disabled:
 *      ['level3']`. A switched-off rule pays nothing and does not consume the day's slot.
 *
 *  §J  **Idempotency is an index, not a check.** Both of them, from both sides: through the
 *      function (ON CONFLICT DO NOTHING, returns 0, raises nothing) and through a raw INSERT
 *      (23505). A check in the function would lose the race; an index decides it.
 *
 *  §K  **A manual adjustment is a new row, never an edit.** May be negative, does not occupy
 *      the day's DAY_FIRST slot, carries the acting સંચાલક and a reason, and is refused to a
 *      caller who may not price the levels.
 *
 *  §L  **Nobody may execute the writers.** `award_points` and `point_award` take a `p_user`:
 *      an execute grant is a way for one યુવક to pay another. Asserted for `authenticated`
 *      and for `anon`, and the 0032 readers are asserted to refuse a caller who is not a
 *      progress reader — with an authorisation error, not an empty report (§31).
 *
 *  §M  **The seven 0032 read surfaces** return their declared shape, page where they claim
 *      to and filter where they claim to. `admin_points_overview()` must report legacy rows
 *      and legacy points separately from new ones — that reconciliation figure is the one §41
 *      asks never to move again.
 *
 *  §N  **`leaderboard()`'s privacy contract (§J7) is intact.** Rows carry a name and a number
 *      and never a user id. 0031/0032 must not have widened it, and `admin_leaderboard()`
 *      being allowed to carry one is not a reason for the યુવક's board to.
 *
 *  §O  **The coercion traps, on the SQL side.** scripts/test-points.mjs documents them for
 *      the JS resolvers; `point_rules()` and `point_settings()` use `jsonb_typeof(...) =
 *      'number'` and `= 'true'::jsonb` for exactly the same reasons. A `level1` holding the
 *      *string* '300' and an `enabled` holding the *string* 'false' must pay nothing — and
 *      the validator must refuse both before they can be stored at all.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { asAnon, asUser, attempt, dockerAvailable, startDatabase } from './lib/pgtest.mjs';

/** Where the files this suite re-applies live — see §A's idempotency check. */
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
 * The code is asserted and not only the failure, because '42501' (no grant, or the guard in
 * admin_assert_progress_reader) and '23505' (a unique index) and 'P0001' (a raise) are three
 * different defences. A test that accepted any error would pass on a database where the one
 * being checked had been deleted and another happened to fire.
 */
const refused = (name, res, code) => {
  if (!res.ok && res.code === code) pass++;
  else if (res.ok) fails.push(`${name}\n       got  allowed (${res.count} row(s))\n       want refused ${code}`);
  else fails.push(`${name}\n       got  refused ${res.code}: ${res.message}\n       want refused ${code}`);
};

const group = (name) => console.log(`\n  ${name}`);

// bigint and numeric come back from node-postgres as strings, because they do not fit a JS
// number in general. total_rows, points_total, source_id and attempt_id are the columns this
// affects, and comparing '400' against 400 would fail for a reason that has nothing to do
// with the engine.
const num = (v) => (v === null || v === undefined ? null : Number(v));

/**
 * The same object with its keys in a fixed order.
 *
 * `eq` compares JSON, and JSON.stringify preserves insertion order — so an assertion about
 * the *contents* of a jsonb document would otherwise fail because Postgres returned `tick`
 * before `version`, or because `byKind` is ordered by points and not alphabetically. Neither
 * is a fact about the engine, and neither is a fact any caller may depend on.
 */
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
  // The three engine યુવકો. None of them carries a single committed ledger row, so every
  // assertion in §B-§K is over rows this file's own sandbox just caused to be written.
  alpha: 'a1111111-1111-4111-8111-111111111111',
  beta: 'b2222222-2222-4222-8222-222222222222',
  gamma: 'c3333333-3333-4333-8333-333333333333',

  // Three rows written in 0021's shape, before 0031 existed. §C is about these and nothing
  // else may touch them.
  legacy: '1e999999-9999-4999-8999-999999999999',

  // The two reporting fixtures. Their ledgers were computed on paper and §M asserts them.
  mohan: 'd4444444-4444-4444-8444-444444444444',
  nayan: 'e5555555-5555-4555-8555-555555555555',

  // 250 ledger rows and nothing else, so §M can observe a page cap of 200 — a cap cannot be
  // seen on a set smaller than the cap.
  filler: 'f6666666-6666-4666-8666-666666666666',

  // SUPER_ADMIN: progress.read, users.read AND settings.update. The only caller who may make
  // a manual adjustment.
  admin: '07777777-7777-4777-8777-777777777777',
  // VIEWER: a progress reader who may NOT price the levels, and therefore may not hand out
  // ગુણ either. The sharp case for §K's refusal — an empty report would be the wrong answer
  // and so would a successful award.
  viewer: '18888888-8888-4888-8888-888888888888',
  // CONTENT_MANAGER: holds neither progress.read nor users.read. §L's refusal.
  content: '29999999-9999-4999-8999-999999999999',
};

const SCENE = (n) => `d-${String(n).padStart(3, '0')}`;
const RANGE = (a, b) => {
  const out = [];
  for (let i = a; i <= b; i++) out.push(SCENE(i));
  return out;
};

// 1-12 live, 13-15 withheld by the સંચાલક. The withheld three are what makes §D's
// subtraction observable: a tick on a દ્રશ્ય that has been taken out of the collection is not
// a tick that may be paid, and `admin_withheld_scene_ids()` (0029) is the only authority
// Postgres has on the question.
const LIVE = 12;
const WITHHELD = [SCENE(13), SCENE(14), SCENE(15)];

const L4 = [
  ['4.1', 1, [SCENE(1), SCENE(2)]],
  ['4.2', 2, [SCENE(3), SCENE(4)]],
  ['4.3', 3, [SCENE(5), SCENE(6)]],
];

const ACT = {};
const ATT = {}; // the fixture attempt ids, needed to link ledger rows to the acts that earned them

/** 250 filler ledger rows, so the page cap of 200 has something larger than itself to cap. */
const FILL = 250;

// The ledger as the fixtures leave it, worked out here rather than read back from the
// database, so §M is comparing against arithmetic and not against itself.
const TOTAL_LEGACY_ROWS = 3;
const TOTAL_LEGACY_POINTS = 800;
const MOHAN_POINTS = 100 + 200 + 12 + 8 + 400 - 50; // 670
const NAYAN_POINTS = 300 + 400; // 700
const FILL_POINTS = FILL; // one point each
const LEDGER_ROWS = TOTAL_LEGACY_ROWS + 6 + 2 + FILL; // 261
const LEDGER_POINTS = TOTAL_LEGACY_POINTS + MOHAN_POINTS + NAYAN_POINTS + FILL_POINTS; // 2420

// ════════════════════════════════════════════════════════════════════ the fixtures

async function fixtures(db) {
  // Everything here runs as the owner, which is what a migration or the seed script is. RLS
  // does not apply, but every trigger still fires — including level4_attempts_award, which is
  // why no settings row is written in this function. With nothing configured `point_value_for`
  // is 0 everywhere and the trigger writes nothing, so the ledger below holds exactly the rows
  // this file chose. Each group configures the rules it needs, inside a transaction it rolls
  // back.

  /*
    નવસારી becomes a city of its own, which is what this fixture has always meant by it.

    `U.filler` is deliberately in a different CITY from everybody else - the reports return
    `cityId` and `zoneId` separately and §H asserts both - and until 0050 that cost nothing,
    because `profiles.zone_id` had no constraint at all beyond `default 'surat'`. It is a
    foreign key now, and the zone must belong to the city its profile names, so the two rows
    have to exist before the person does.

    Reopened as well as moved: 0050 seeds નવસારી RETIRED, and a RETIRED zone may not take
    somebody new. The move is permitted because no profile is in it yet - geography_guard()
    refuses moving a zone that anybody is standing in, which is why this runs before the
    inserts below and not after.
  */
  await db.query(
    `insert into public.cities (id, name, sort_order) values ('navsari', 'નવસારી', 2)
     on conflict (id) do nothing`
  );
  await db.query(
    `update public.zones set city_id = 'navsari', status = 'ACTIVE' where id = 'navsari'`
  );

  const people = [
    [U.alpha, 'ALP101', 'Alpha Yuvak', '9811100001', 'surat', 'varachha', 'ACTIVE'],
    [U.beta, 'BET102', 'Beta Yuvak', '9811100002', 'surat', 'varachha', 'ACTIVE'],
    [U.gamma, 'GAM103', 'Gamma Yuvak', '9811100003', 'surat', 'vedroad', 'ACTIVE'],
    [U.legacy, 'LEG104', 'Legacy Yuvak', '9811100004', 'surat', 'varachha', 'ACTIVE'],
    [U.mohan, 'MOH105', 'Mohan Yuvak', '9811100005', 'surat', 'varachha', 'ACTIVE'],
    [U.nayan, 'NAY106', 'Nayan Yuvak', '9811100006', 'surat', 'vedroad', 'ACTIVE'],
    [U.filler, 'FIL107', 'Filler Yuvak', '9811100007', 'navsari', 'navsari', 'ACTIVE'],
    [U.admin, 'ADM108', 'Sanchalak Admin', '9811100008', 'surat', 'varachha', 'ACTIVE'],
    [U.viewer, 'VWR109', 'Sanchalak Viewer', '9811100009', 'surat', 'varachha', 'ACTIVE'],
    [U.content, 'CNT110', 'Sanchalak Content', '9811100010', 'surat', 'varachha', 'ACTIVE'],
  ];
  for (const [id, smk, name, mobile, city, zone, status] of people) {
    await db.query('insert into auth.users (id, email) values ($1, $2)', [id, `${smk.toLowerCase()}@t.test`]);
    await db.query(
      `insert into public.profiles (id, smk, name, email, mobile, zone_id, sub_zone_id, status)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, smk, name, `${smk.toLowerCase()}@t.test`, mobile, city, zone, status]
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
     from generate_series(13, 15) g`
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
  // nothing else. That is what makes these rows legacy in the only sense the schema knows:
  // all seven columns 0031 added are left at their default, which is NULL.
  //
  // It is also §B's control. A row written by this statement and a row written by the engine
  // under an untouched configuration must agree on every column 0021 knew about, and the only
  // honest way to check that is to have 0021's statement in the file.
  const legacy21 = (user, daysAgo, level, key, points, source, sourceId, nth) =>
    db.query(
      `insert into public.point_transactions
         (user_id, activity_date, level_id, activity_key, points, source, source_id, attempt_number)
       values
         ($1, (timezone('Asia/Kolkata', now())::date - $2::int), $3, $4, $5, $6, $7, $8)
       returning id`,
      [user, daysAgo, level, key, points, source, sourceId, nth]
    );

  await legacy21(U.legacy, 5, 1, 'video', 100, 'ACTIVITY_ATTEMPT', 9001, 1);
  await legacy21(U.legacy, 5, 3, 'revision', 300, 'ACTIVITY_ATTEMPT', 9002, 1);
  await legacy21(U.legacy, 4, 4, '4.1', 400, 'LEVEL4_ATTEMPT', 9003, 1);

  // ── the reporting population ────────────────────────────────────────────────

  /** One લેવલ ૧-૩ submission, in the shape activity_submit() writes. */
  const att123 = async (user, level, key, daysAgo, sceneIds, status, nth = 1, totalItems = 108, hour = 9) =>
    Number(
      (
        await db.query(
          `insert into public.activity_attempts
             (user_id, level_id, activity_key, activity_date, attempt_number,
              selected_scene_ids, total_items, completed_items, status, submitted_at)
           values ($1, $2, $3,
                   (timezone('Asia/Kolkata', now())::date - $4::int), $5, $6, $7, $8, $9,
                   ((timezone('Asia/Kolkata', now())::date - $4::int)
                     + make_interval(hours => $10::int))
                     at time zone 'Asia/Kolkata')
           returning id`,
          [user, level, key, daysAgo, nth, sceneIds, totalItems, sceneIds.length, status, hour]
        )
      ).rows[0].id
    );

  const att4 = async (user, code, daysAgo, sceneIds, passed) =>
    Number(
      (
        await db.query(
          `insert into public.level4_attempts
             (user_id, activity_id, config_id, selected_scene_ids, selected_count, required_count, passed, at)
           values ($1, $2, $3, $4, $5, 2, $6,
                   ((timezone('Asia/Kolkata', now())::date - $7::int) + time '10:00')
                     at time zone 'Asia/Kolkata')
           returning id`,
          [user, ACT[code], ACT.config, sceneIds, sceneIds.length, passed, daysAgo]
        )
      ).rows[0].id
    );

  /** A ledger row in the shape 0031's engine writes them, for a report to read. */
  const paid = (user, daysAgo, level, key, points, kind, source, sourceId, attemptId, idem, reason, admin) =>
    db.query(
      `insert into public.point_transactions
         (user_id, activity_date, level_id, activity_key, points, source, source_id,
          attempt_number, award_kind, rule_version, reason, admin_id, idempotency_key,
          event_ref, attempt_id)
       values ($1, (timezone('Asia/Kolkata', now())::date - $2::int), $3, $4, $5, $6, $7,
               1, $8, 1, $9, $10, $11, $12, $13)`,
      [
        user,
        daysAgo,
        level,
        key,
        points,
        source,
        sourceId,
        kind,
        reason,
        admin,
        idem,
        idem ?? `${source}:${sourceId}`,
        attemptId,
      ]
    );

  // Mohan: all four levels, two પુનરાવર્તન submissions on one day whose દ્રશ્યો overlap and
  // one of which names a withheld દ્રશ્ય, one passed કસોટી, and one correction.
  //   લેવલ ૩ day T-2:  attempt 1 → 1-6,  attempt 2 → 5-10 and the withheld 13
  //   distinct union   1-10 and 13 = 11 ticks as admin_daily_activity counts them
  //                    1-10        = 10 ticks as admin_activity_counts counts them (withheld out)
  // Distinct hours, deliberately. admin_user_timeline() orders on `at` alone and has no
  // tiebreak, so two acts recorded at the same instant may come back in either order; a
  // fixture that leaned on that would fail intermittently for a reason that is not the
  // engine's. (The missing tiebreak is noted as a finding, not repaired here.)
  ATT.mohanVideo = await att123(U.mohan, 1, 'video', 3, [], 'COMPLETED', 1, 0, 9);
  ATT.mohanDarshan = await att123(U.mohan, 2, 'darshan', 3, [], 'COMPLETED', 1, 0, 10);
  ATT.mohanRev1 = await att123(U.mohan, 3, 'revision', 2, RANGE(1, 6), 'COMPLETED', 1, 12, 11);
  ATT.mohanRev2 = await att123(U.mohan, 3, 'revision', 2, [...RANGE(5, 10), SCENE(13)], 'COMPLETED', 2, 12, 12);
  ATT.mohanExam = await att4(U.mohan, '4.1', 1, [SCENE(1), SCENE(2)], true);

  await paid(U.mohan, 3, 1, 'video', 100, 'DAY_FIRST', 'ACTIVITY_ATTEMPT', ATT.mohanVideo, ATT.mohanVideo, null, null, null);
  await paid(U.mohan, 3, 2, 'darshan', 200, 'DAY_FIRST', 'ACTIVITY_ATTEMPT', ATT.mohanDarshan, ATT.mohanDarshan, null, null, null);
  await paid(U.mohan, 2, 3, 'revision', 12, 'TICK', 'ACTIVITY_ATTEMPT', ATT.mohanRev1, ATT.mohanRev1, `tick:${ATT.mohanRev1}`, null, null);
  await paid(U.mohan, 2, 3, 'revision', 8, 'TICK', 'ACTIVITY_ATTEMPT', ATT.mohanRev2, ATT.mohanRev2, `tick:${ATT.mohanRev2}`, null, null);
  await paid(U.mohan, 1, 4, '4.1', 400, 'DAY_FIRST', 'LEVEL4_ATTEMPT', ATT.mohanExam, ATT.mohanExam, null, null, null);
  await paid(U.mohan, 1, 0, '', -50, 'MANUAL', 'MANUAL_ADJUSTMENT', 0, null, 'manual:fixture-1', 'entered twice', U.admin);

  // Nayan: one પુનરાવર્તન, one failed કસોટી and one passed. The failed one is the reason
  // admin_user_timeline exists — it appears there and nowhere else.
  ATT.nayanRev = await att123(U.nayan, 3, 'revision', 1, RANGE(1, 3), 'COMPLETED', 1, 3);
  ATT.nayanFail = await att4(U.nayan, '4.1', 1, [SCENE(1)], false);
  ATT.nayanPass = await att4(U.nayan, '4.2', 1, [SCENE(3), SCENE(4)], true);

  await paid(U.nayan, 1, 3, 'revision', 300, 'DAY_FIRST', 'ACTIVITY_ATTEMPT', ATT.nayanRev, ATT.nayanRev, null, null, null);
  await paid(U.nayan, 1, 4, '4.2', 400, 'DAY_FIRST', 'LEVEL4_ATTEMPT', ATT.nayanPass, ATT.nayanPass, null, null, null);

  // The filler. 250 rows on 250 distinct days, one ગુણ each — distinct days because the
  // partial unique index is the whole point of this file and a filler that violated it would
  // be a fixture arguing with the schema.
  await db.query(
    `insert into public.point_transactions
       (user_id, activity_date, level_id, activity_key, points, source, source_id,
        attempt_number, award_kind, rule_version)
     select $1, (timezone('Asia/Kolkata', now())::date - g), 1, 'video', 1,
            'ACTIVITY_ATTEMPT', 0, 1, 'DAY_FIRST', 1
     from generate_series(10, $2) g`,
    [U.filler, 9 + FILL]
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
   * Every group below configures `settings['levels']`, drives the real writers and reads the
   * ledger back. All of that is done as the **owner**, which is what a migration and the seed
   * script are, and it is deliberate: `activity_submit()` and the trigger are SECURITY DEFINER
   * and run as the owner in production too, so nothing is being given a privilege it does not
   * have. Who may *call* them is a separate question and is §L's.
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
   * Necessary because most of what this file asserts is a refusal, and a refused statement
   * aborts the transaction it is in — every later statement in the same sandbox would then
   * come back as 25P02 and the group would report a cascade of failures whose only cause is
   * the first one. The savepoint is released on success and rolled back on refusal, so the
   * sandbox continues from where it was either way.
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
   * Through an ordinary INSERT, so `settings_check_points` (0021, reissued 0031) fires — a
   * configuration this file could not have saved through the panel is not a configuration
   * worth asserting the engine's behaviour under.
   */
  const configure = (points, extra = {}) =>
    db.query(
      `insert into public.settings (key, value) values ('levels', $1::jsonb)
       on conflict (key) do update set value = excluded.value`,
      [JSON.stringify({ ...extra, points })]
    );

  const tryConfigure = (points, extra = {}) =>
    soft(
      `insert into public.settings (key, value) values ('levels', $1::jsonb)
       on conflict (key) do update set value = excluded.value`,
      [JSON.stringify({ ...extra, points })]
    );

  /** The base configuration: 0021's four numbers and nothing 0031 added. */
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
  const exam = async (user, code, passed, daysAgo = 0) =>
    Number(
      (
        await db.query(
          `insert into public.level4_attempts
             (user_id, activity_id, config_id, selected_scene_ids, selected_count, required_count, passed, at)
           values ($1, $2, $3, $4, $5, 2, $6,
                   ((timezone('Asia/Kolkata', now())::date - $7::int) + time '11:00')
                     at time zone 'Asia/Kolkata')
           returning id`,
          [user, ACT[code], ACT.config, L4.find((a) => a[0] === code)[2], 2, passed, daysAgo]
        )
      ).rows[0].id
    );

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
    ).rows.map((r) => ({
      ...r,
      source_id: num(r.source_id),
      attempt_id: num(r.attempt_id),
    }));

  /** Just the money, for the many assertions that are about the amount and the kind. */
  const paidRows = async (uid) =>
    (await ledger(uid)).map((r) => [r.level_id, r.activity_key, r.points, r.award_kind]);

  const day = async (n) =>
    (await db.query(`select (timezone('Asia/Kolkata', now())::date - $1::int)::text d`, [n])).rows[0].d;

  const TODAY = await day(0);

  // ══════════════════════════════════════════════════════ §A the migrations
  group('§A  0031 and 0032 applied, and built what they said they would');

  eq('every migration in supabase/migrations applied, 0031 and 0032 among them', [
    files.includes('0031_point_engine.sql'),
    files.includes('0032_admin_points_reporting.sql'),
  ], [true, true]);

  /*
    Both files can be applied **again**, on a database that already has them.

    Not a theoretical property. 0031 reached production and 0032 failed behind it on a reserved
    keyword, which is precisely the state that has to be repaired by re-running both — and 0031
    could not be re-run, because `add constraint` has no `if not exists` and three of its seven
    constraints were added without being dropped first. The file stopped at 42710 halfway
    through, having already replaced some functions and not others.

    A migration that cannot be re-applied is a migration that cannot be corrected, so this
    asserts the property directly rather than trusting a reading of the file: apply both a second
    time, in order, and then confirm the ledger is untouched by it. The row count and sum are
    checked either side because an idempotent *schema* change that quietly rewrote data would
    pass a "no error" test and fail the one that matters (§J1).
  */
  {
    const before = (await db.query(
      `select count(*)::int n, coalesce(sum(points), 0)::int p,
              count(*) filter (where award_kind is null)::int legacy
       from public.point_transactions`
    )).rows[0];

    /*
      Every point migration, in filename order — not just 0031 and 0032.

      The first version of this check re-applied those two and stopped, which was wrong in a way
      that was invisible because it stayed green: 0033 reissues `point_rules()`, `point_award()`,
      `award_points()`, `settings_check_points()` and two ledger constraints, so re-applying 0031
      on top of it **downgraded the engine** and every group after this one in the file was then
      asserting against a reverted build rather than the deployed one.

      Replaying the whole tail in order fixes that and tests something truer besides: it is the
      exact sequence a production repair runs. Derived from the harness's own file list rather
      than named here, so a 0034 is included the day it is written and nobody has to remember.

      Order matters and is load-bearing. 0031 re-adds the narrower `point_transactions_kind_check`
      which does not allow BONUS; it validates the whole table on the way in, so this would fail
      outright if a BONUS row existed yet. It does not at this point in the run, and 0033 widens
      the constraint again two statements later. That is also the operational rule for production:
      these files are re-applied as a set, never one out of the middle.
    */
    const tail = files.filter((f) => f >= '0031');
    const reapply = [];
    for (const f of tail) {
      const res = await attempt(db, readFileSync(join(MIGRATIONS, f), 'utf8'));
      reapply.push(res.ok ? 'ok' : `${f}: ${res.code} ${res.message}`);
    }
    eq(`the point migrations (${tail.length}) apply cleanly a second time`, reapply, tail.map(() => 'ok'));

    // And the engine is still the 0033 one afterwards, which is the property the first version of
    // this check silently lost. If a replay ever reverts the engine again, this fails here rather
    // than turning every later group into an assertion about the wrong build.
    eq(
      'and the replay left the newest engine in place, not an older one',
      (await db.query(`select public.point_rules() ? 'earn' as has_earn`)).rows[0].has_earn,
      true
    );

    const after = (await db.query(
      `select count(*)::int n, coalesce(sum(points), 0)::int p,
              count(*) filter (where award_kind is null)::int legacy
       from public.point_transactions`
    )).rows[0];
    eq('and re-applying them moves no row, no point and no legacy row', after, before);
  }

  eq(
    'point_transactions carries the seven nullable columns 0031 adds',
    (
      await db.query(
        `select column_name, is_nullable from information_schema.columns
         where table_schema = 'public' and table_name = 'point_transactions'
           and column_name in ('award_kind','rule_version','reason','admin_id',
                               'idempotency_key','event_ref','attempt_id')
         order by column_name`
      )
    ).rows.map((r) => [r.column_name, r.is_nullable]),
    [
      ['admin_id', 'YES'],
      ['attempt_id', 'YES'],
      ['award_kind', 'YES'],
      ['event_ref', 'YES'],
      ['idempotency_key', 'YES'],
      ['reason', 'YES'],
      ['rule_version', 'YES'],
    ]
  );

  eq(
    '0021\'s day constraint is gone and the identically-shaped partial index is in its place',
    await (async () => [
      (
        await db.query(
          `select count(*)::int c from pg_constraint
           where conname = 'point_transactions_day_unique' and contype = 'u'`
        )
      ).rows[0].c,
      (
        await db.query(
          `select indexdef from pg_indexes
           where schemaname = 'public' and indexname = 'point_transactions_day_unique'`
        )
      ).rows[0]?.indexdef ?? null,
    ])(),
    [
      0,
      'CREATE UNIQUE INDEX point_transactions_day_unique ON public.point_transactions ' +
        'USING btree (user_id, activity_date, level_id, activity_key) ' +
        "WHERE (COALESCE(award_kind, 'DAY_FIRST'::text) = 'DAY_FIRST'::text)",
    ]
  );

  eq(
    'and the dedupe index for every kind that is allowed to repeat',
    (
      await db.query(
        `select indexdef from pg_indexes
         where schemaname = 'public' and indexname = 'point_transactions_idem_idx'`
      )
    ).rows[0]?.indexdef ?? null,
    'CREATE UNIQUE INDEX point_transactions_idem_idx ON public.point_transactions ' +
      'USING btree (idempotency_key) WHERE (idempotency_key IS NOT NULL)'
  );

  eq(
    'the five checks 0031 states are on the table',
    (
      await db.query(
        `select conname from pg_constraint
         where conrelid = 'public.point_transactions'::regclass and contype = 'c'
         order by conname`
      )
    ).rows.map((r) => r.conname),
    [
      'point_transactions_kind_check',
      'point_transactions_level_id_check',
      'point_transactions_manual_needs_reason',
      'point_transactions_points_check',
      'point_transactions_repeatable_needs_key',
      'point_transactions_source_check',
    ]
  );

  eq(
    'and every function 0031 and 0032 promise exists',
    (
      await db.query(
        `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.proname in ('point_rules','point_rule_live','point_award','award_points',
                             'admin_award_manual_points','admin_point_transactions',
                             'admin_user_timeline','admin_daily_activity','admin_leaderboard',
                             'admin_activity_counts','admin_points_overview',
                             'admin_point_activities')
         order by p.proname`
      )
    ).rows.map((r) => r.proname),
    [
      'admin_activity_counts',
      'admin_award_manual_points',
      'admin_daily_activity',
      'admin_leaderboard',
      'admin_point_activities',
      'admin_point_transactions',
      'admin_points_overview',
      'admin_user_timeline',
      'award_points',
      'point_award',
      'point_rule_live',
      'point_rules',
    ]
  );

  eq(
    'an untouched project resolves to the behaviour of the day before 0031',
    canonical((await db.query('select public.point_rules() r')).rows[0].r),
    canonical({
      version: 0,
      effectiveFrom: null,
      disabled: [],
      repeat: { enabled: false, default: 0, dailyLimit: 0, byCode: {} },
      tick: { mode: 'ACTIVITY', perTick: 0, perRevision: 0, dailyCap: 0 },
      // 0033's `earn`. Every level DAY_FIRST and ticks FRESH **is** the behaviour of the day
      // before 0031, which is the only reason a new key may appear in this object at all: this
      // assertion is the written-out promise that an untouched project pays what it always paid,
      // so a key whose default changed anything would have to fail here.
      earn: {
        level1: 'DAY_FIRST',
        level2: 'DAY_FIRST',
        level3: 'DAY_FIRST',
        level4: 'DAY_FIRST',
        tickCount: 'FRESH',
      },
      // 0034's `dailyMax`, and it is here on the same terms `earn` is. An empty object is the
      // resolution of "no maximum anywhere", which is what a project that never opened the new
      // panel has and is exactly what it had the day before 0031: nothing bounds a count and
      // nothing clamps an award. A default of `{}` is the only default that could appear here,
      // because any level named in it would be a level whose reports 0034 started trimming.
      dailyMax: {},
    })
  );

  // ══════════════════════════════════════════════════════ §B the no-change guarantee
  group('§B  an untouched settings row awards exactly what 0021 awarded');

  await sandbox(async () => {
    await configure(BASE);
    await signIn(U.alpha);

    const r1 = await submit(1, 'video', [], 0);
    const r2 = await submit(2, 'darshan', [], 0);
    const r3 = await submit(3, 'revision', RANGE(1, 5), 5);
    const e1 = await exam(U.alpha, '4.1', true);

    eq('લેવલ ૧, ૨ and ૩ pay their configured value and say so to the યુવક', [
      r1.pointsAwarded,
      r2.pointsAwarded,
      r3.pointsAwarded,
    ], [100, 200, 300]);

    const rows = await ledger(U.alpha);
    eq('four events, four rows — one per (યુવક, day, level, activity)', rows.length, 4);
    eq(
      'each priced by point_value_for, ૪.૧ by its own entry rather than by level4.default',
      rows.map((r) => [r.level_id, r.activity_key, r.points]),
      [
        [1, 'video', 100],
        [2, 'darshan', 200],
        [3, 'revision', 300],
        [4, '4.1', 450],
      ]
    );
    eq('every one of them is a DAY_FIRST award', [...new Set(rows.map((r) => r.award_kind))], ['DAY_FIRST']);
    eq('none carries an idempotency key — the day index is their at-most-once rule', [
      ...new Set(rows.map((r) => r.idempotency_key)),
    ], [null]);
    eq('none carries a reason or an admin — nobody handed these out', [
      ...new Set(rows.map((r) => r.reason)),
      ...new Set(rows.map((r) => r.admin_id)),
    ], [null, null]);
    eq(
      'the rule version stamped is 0, which is what an unversioned configuration resolves to',
      [...new Set(rows.map((r) => r.rule_version))],
      [0]
    );
    eq('all four belong to today, the server\'s IST day', [...new Set(rows.map((r) => r.activity_date))], [TODAY]);
    eq(
      'source and source_id name the act that earned it, and attempt_id repeats source_id',
      rows.map((r) => [r.source, r.source_id === r.attempt_id]),
      [
        ['ACTIVITY_ATTEMPT', true],
        ['ACTIVITY_ATTEMPT', true],
        ['ACTIVITY_ATTEMPT', true],
        ['LEVEL4_ATTEMPT', true],
      ]
    );
    eq('and the લેવલ ૪ row points at the attempt the trigger fired on', rows[3].source_id, e1);

    // ── the differential ────────────────────────────────────────────────────
    //
    // 0021's own INSERT, run for a different યુવક with the same values. If the engine's row
    // and this one agree on every column 0021 knew about, the awarding did not move.
    await db.query(
      `insert into public.point_transactions
         (user_id, activity_date, level_id, activity_key, points, source, source_id, attempt_number)
       values ($1, $2::date, 3, 'revision', 300, 'ACTIVITY_ATTEMPT', $3, 1)`,
      [U.beta, TODAY, rows[2].source_id]
    );
    const control = (await ledger(U.beta))[0];
    eq(
      'column for column, the engine wrote what 0021\'s INSERT writes',
      [
        rows[2].activity_date,
        rows[2].level_id,
        rows[2].activity_key,
        rows[2].points,
        rows[2].source,
        rows[2].source_id,
        rows[2].attempt_number,
      ],
      [
        control.activity_date,
        control.level_id,
        control.activity_key,
        control.points,
        control.source,
        control.source_id,
        control.attempt_number,
      ]
    );

    // ── the two directions 0021 states plainly ──────────────────────────────
    const again = await submit(3, 'revision', RANGE(1, 5), 5);
    eq('a second COMPLETED પુનરાવર્તન the same day earns 0, which is not a failure', again.pointsAwarded, 0);
    eq('and writes no row', (await ledger(U.alpha)).length, 4);

    await signIn(U.gamma);
    const partial = await submit(3, 'revision', RANGE(1, 3), 10);
    eq('a REVISION_REQUIRED attempt earns nothing', [partial.status, partial.pointsAwarded], ['REVISION_REQUIRED', 0]);
    eq('and consumes nothing — no row was written to occupy the day', (await ledger(U.gamma)).length, 0);
    const finished = await submit(3, 'revision', RANGE(1, 10), 10);
    eq('so the afternoon\'s finished attempt is still paid in full', finished.pointsAwarded, 300);
  });

  // ══════════════════════════════════════════════════════ §C legacy rows
  group('§C  a row written before 0031 is never rewritten');

  const legacyBefore = await ledger(U.legacy);
  eq('the fixture holds three rows written by 0021\'s INSERT', legacyBefore.length, TOTAL_LEGACY_ROWS);
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
  eq('which sums to the reconciliation figure §41 asks never to move', [
    legacyBefore.reduce((n, r) => n + r.points, 0),
  ], [TOTAL_LEGACY_POINTS]);

  await sandbox(async () => {
    // Every rule 0031 adds, switched on at once, and the whole engine run over the same યુવક
    // and — for the two that can be dated — over the same days his legacy rows sit on.
    await configure({
      ...BASE,
      version: 7,
      repeat: { enabled: true, default: 50, dailyLimit: 0, '4.1': 75 },
      tick: { mode: 'TICK', perTick: 2, perRevision: 0, dailyCap: 0 },
    });
    await signIn(U.legacy);

    await submit(1, 'video', [], 0);
    await submit(2, 'darshan', [], 0);
    await submit(3, 'revision', RANGE(1, 6), 6);
    await exam(U.legacy, '4.1', true, 4); // the same IST day as his legacy ૪.૧ row
    await exam(U.legacy, '4.1', true, 4);
    await exam(U.legacy, '4.2', true, 0);

    await signIn(U.admin);
    await db.query('select public.admin_award_manual_points($1, $2, $3, $4::date)', [
      U.legacy,
      -25,
      'a correction',
      await day(5), // the same IST day as two of his legacy rows
    ]);

    const after = await ledger(U.legacy);
    const stillLegacy = after.filter((r) => r.award_kind === null);
    eq('the engine ran and wrote rows for him', after.length > TOTAL_LEGACY_ROWS, true);
    eq('there are still exactly three legacy rows', stillLegacy.length, TOTAL_LEGACY_ROWS);
    eq('and every column of every one of them is what it was', stillLegacy, legacyBefore);
    eq('their sum has not moved', stillLegacy.reduce((n, r) => n + r.points, 0), TOTAL_LEGACY_POINTS);
    eq(
      'a new award on a day a legacy row already paid is refused by the shared index, not by rewriting it',
      after.filter((r) => r.activity_date === legacyBefore[0].activity_date && r.level_id === 1).length,
      1
    );
  });

  // ══════════════════════════════════════════════════════ §D tick mode
  group('§D  tick mode pays for what was newly brought to mind');

  await sandbox(async () => {
    await configure({ ...BASE, tick: { mode: 'TICK', perTick: 2, dailyCap: 0 } });
    await signIn(U.alpha);

    // 12 live દ્રશ્યો and the three withheld ones, submitted together. `fresh` is 12.
    const r = await submit(3, 'revision', [...RANGE(1, LIVE), ...WITHHELD], LIVE + WITHHELD.length);
    eq('a submission of 12 live and 3 withheld દ્રશ્યો pays for the 12', r.pointsAwarded, 12 * 2);
    eq('as one TICK row keyed by the attempt', await paidRows(U.alpha), [[3, 'revision', 24, 'TICK']]);
    eq(
      'whose idempotency key names the attempt, so the same submission cannot pay twice',
      (await ledger(U.alpha))[0].idempotency_key,
      `tick:${(await ledger(U.alpha))[0].source_id}`
    );

    // The subtraction, head-on. The same ticks again, in one day.
    const again = await submit(3, 'revision', [...RANGE(1, LIVE), ...WITHHELD], LIVE + WITHHELD.length);
    eq('the SAME ticks submitted again the same day pay 0, not 24 again', again.pointsAwarded, 0);
    eq('and write no second row', (await paidRows(U.alpha)).length, 1);

    // Genuinely new ones do pay — the subtraction is "already named", not "already submitted".
    await signIn(U.beta);
    await submit(3, 'revision', RANGE(1, 4), 4);
    const third = await submit(3, 'revision', RANGE(3, 8), 6);
    eq(
      'a second submission naming 1-4 then 3-8 pays for 5, 6, 7 and 8 alone — 4 fresh ticks',
      third.pointsAwarded,
      4 * 2
    );
    eq('two submissions, two rows, and both TICK', await paidRows(U.beta), [
      [3, 'revision', 8, 'TICK'],
      [3, 'revision', 8, 'TICK'],
    ]);
    eq(
      'the day\'s ledger for લેવલ ૩ is 8 + 8, which is the 8 distinct દ્રશ્યો he named',
      (await ledger(U.beta)).reduce((n, x) => n + x.points, 0),
      16
    );

    // A withheld દ્રશ્ય on its own pays nothing at all, and writes nothing.
    await signIn(U.gamma);
    const onlyWithheld = await submit(3, 'revision', WITHHELD, 3);
    eq('a submission of nothing but withheld દ્રશ્યો pays 0', onlyWithheld.pointsAwarded, 0);
    eq('and writes no row — a zero is never recorded', (await ledger(U.gamma)).length, 0);
  });

  // ══════════════════════════════════════════════════════ §E the daily cap
  group('§E  tick.dailyCap clamps the day and never pays a negative');

  await sandbox(async () => {
    await configure({ ...BASE, tick: { mode: 'TICK', perTick: 2, dailyCap: 10 } });
    await signIn(U.alpha);

    const first = await submit(3, 'revision', RANGE(1, 3), 3);
    eq('3 fresh ticks at 2 each is 6, inside a cap of 10', first.pointsAwarded, 6);

    const second = await submit(3, 'revision', RANGE(1, 8), 8);
    eq('5 more fresh ticks would be 10, but only 4 of the cap is left', second.pointsAwarded, 4);

    const third = await submit(3, 'revision', RANGE(1, 12), 12);
    eq('the cap is spent, so the next submission pays 0 rather than a negative', third.pointsAwarded, 0);
    eq('and writes no row', (await paidRows(U.alpha)).length, 2);
    eq(
      'the day totals exactly the cap',
      (await ledger(U.alpha)).reduce((n, r) => n + r.points, 0),
      10
    );

    // The clamp reads the ledger rather than counting in the caller, so it is a fact about
    // the day and not about this call — a REPEAT or a MANUAL row must not eat the tick budget.
    eq('every row in it is a TICK row', [...new Set((await ledger(U.alpha)).map((r) => r.award_kind))], ['TICK']);
  });

  // ══════════════════════════════════════════════════════ §F revision mode
  group('§F  revision mode pays per genuine submission, and a retry is not one');

  await sandbox(async () => {
    await configure({ ...BASE, tick: { mode: 'REVISION', perRevision: 5 } });
    await signIn(U.alpha);

    const one = await submit(3, 'revision', RANGE(1, 4), 4);
    eq('a submission is worth perRevision, whatever it ticked', one.pointsAwarded, 5);

    // The same ticks again. Under TICK this pays 0; under REVISION it is a second પુનરાવર્તન
    // and is paid, which is the entire difference between the two modes.
    const two = await submit(3, 'revision', RANGE(1, 4), 4);
    eq('the same ticks again are a second પુનરાવર્તન and are paid again', two.pointsAwarded, 5);
    eq('two submissions, two REVISION rows', await paidRows(U.alpha), [
      [3, 'revision', 5, 'REVISION'],
      [3, 'revision', 5, 'REVISION'],
    ]);

    // The retry. Same client token: activity_submit() replays the original attempt and
    // reports what it was paid, and no second row exists to report.
    const TOKEN = '11111111-2222-4333-8444-555555555555';
    const t1 = await submit(3, 'revision', RANGE(1, 4), 4, TOKEN);
    const t2 = await submit(3, 'revision', RANGE(1, 4), 4, TOKEN);
    eq('a submit carrying a client token is paid once', [t1.pointsAwarded, t2.pointsAwarded], [5, 5]);
    eq('and the retry reports the original attempt, not a new one', t1.attemptNumber, t2.attemptNumber);
    eq('so the day holds three rows and not four', (await paidRows(U.alpha)).length, 3);
    eq('and 15 ગુણ, not 20', (await ledger(U.alpha)).reduce((n, r) => n + r.points, 0), 15);
  });

  // ══════════════════════════════════════════════════════ §G exclusivity
  group('§G  under a tick rule લેવલ ૩ takes the tick branch and NOT the flat one');

  await sandbox(async () => {
    // level3 is 300 and perTick is 2 at the same time. Only one of them may pay.
    await configure({ ...BASE, tick: { mode: 'TICK', perTick: 2 } });
    await signIn(U.alpha);
    await submit(3, 'revision', RANGE(1, 5), 5);
    eq('one row, and it is the tick award', await paidRows(U.alpha), [[3, 'revision', 10, 'TICK']]);
    eq('there is no DAY_FIRST row for લેવલ ૩ beside it', (await ledger(U.alpha)).filter((r) => r.award_kind === 'DAY_FIRST').length, 0);

    // લેવલ ૧ and ૨ are untouched by the mode — it is a rule about લેવલ ૩ and only ૩.
    await submit(1, 'video', [], 0);
    await submit(2, 'darshan', [], 0);
    eq('લેવલ ૧ and ૨ still take 0021\'s day-scoped branch', (await paidRows(U.alpha)).slice(1), [
      [1, 'video', 100, 'DAY_FIRST'],
      [2, 'darshan', 200, 'DAY_FIRST'],
    ]);

    await sandbox(async () => {
      await configure({ ...BASE, tick: { mode: 'REVISION', perRevision: 5 } });
      await signIn(U.beta);
      await submit(3, 'revision', RANGE(1, 5), 5);
      eq('the same under REVISION mode — one row, and it is not the flat 300', await paidRows(U.beta), [
        [3, 'revision', 5, 'REVISION'],
      ]);
    });

    // And with the mode back at ACTIVITY the flat award is exactly what it was.
    await sandbox(async () => {
      await configure({ ...BASE, tick: { mode: 'ACTIVITY', perTick: 0, perRevision: 0 } });
      await signIn(U.gamma);
      await submit(3, 'revision', RANGE(1, 5), 5);
      eq('mode ACTIVITY is the absent-key behaviour: the flat 300, as a DAY_FIRST row', await paidRows(U.gamma), [
        [3, 'revision', 300, 'DAY_FIRST'],
      ]);
    });
  });

  // ══════════════════════════════════════════════════════ §H the repeat rule
  group('§H  a second passing કસોટી on an already-paid day');

  await sandbox(async () => {
    await configure({ ...BASE, repeat: { enabled: true, default: 50, dailyLimit: 0, '4.1': 75 } });

    await exam(U.alpha, '4.1', true);
    eq('the first pass is 0021\'s day award, priced by level4["4.1"]', await paidRows(U.alpha), [
      [4, '4.1', 450, 'DAY_FIRST'],
    ]);

    await exam(U.alpha, '4.1', true);
    eq('the second pass the same day earns the repeat value, and byCode beats default', await paidRows(U.alpha), [
      [4, '4.1', 450, 'DAY_FIRST'],
      [4, '4.1', 75, 'REPEAT'],
    ]);

    await exam(U.alpha, '4.2', true);
    await exam(U.alpha, '4.2', true);
    eq('a કસોટી with no byCode entry falls to repeat.default', (await paidRows(U.alpha)).slice(2), [
      [4, '4.2', 400, 'DAY_FIRST'],
      [4, '4.2', 50, 'REPEAT'],
    ]);

    await exam(U.alpha, '4.1', true);
    eq('and a third pass is a second repeat — the day index does not cover REPEAT', (await paidRows(U.alpha)).slice(4), [
      [4, '4.1', 75, 'REPEAT'],
    ]);
    eq(
      'two REPEAT rows under the same (યુવક, day, level, key) coexist, told apart by idempotency_key',
      (await ledger(U.alpha)).filter((r) => r.award_kind === 'REPEAT' && r.activity_key === '4.1').map((r) =>
        r.idempotency_key.startsWith('repeat:')
      ),
      [true, true]
    );

    // A failed attempt does not fire the trigger at all — `when (new.passed)` is on the
    // trigger and not in the body, so this is not a rule the engine has to restate.
    const before = (await paidRows(U.alpha)).length;
    await exam(U.alpha, '4.3', false);
    eq('a failed કસોટી earns nothing, under the repeat rule as under every other', (await paidRows(U.alpha)).length, before);
  });

  await sandbox(async () => {
    await configure({ ...BASE, repeat: { enabled: true, default: 50, dailyLimit: 1 } });
    await exam(U.beta, '4.1', true);
    await exam(U.beta, '4.1', true);
    await exam(U.beta, '4.2', true);
    await exam(U.beta, '4.2', true);
    eq('repeat.dailyLimit = 1 allows one repeat in the day and stops the next', await paidRows(U.beta), [
      [4, '4.1', 450, 'DAY_FIRST'],
      [4, '4.1', 50, 'REPEAT'],
      [4, '4.2', 400, 'DAY_FIRST'],
    ]);
    eq('the limit is a count of REPEAT rows across the day, not per કસોટી', (await ledger(U.beta)).filter((r) => r.award_kind === 'REPEAT').length, 1);
  });

  await sandbox(async () => {
    await configure({ ...BASE, repeat: { enabled: false, default: 500, '4.1': 900 } });
    await exam(U.gamma, '4.1', true);
    await exam(U.gamma, '4.1', true);
    eq('repeat.enabled = false pays the second attempt exactly 0, as before 0031', await paidRows(U.gamma), [
      [4, '4.1', 450, 'DAY_FIRST'],
    ]);
  });

  await sandbox(async () => {
    await configure({ ...BASE, repeat: { enabled: true, default: 0, dailyLimit: 0 } });
    await exam(U.alpha, '4.2', true);
    await exam(U.alpha, '4.2', true);
    eq('a repeat worth 0 writes nothing — a zero is never a row', (await paidRows(U.alpha)).length, 1);
  });

  await sandbox(async () => {
    // લેવલ ૩ under an ordinary (non-tick) configuration is not repeatable: the repeat branch
    // is લેવલ ૪ only, because "sitting the કસોટી again" is the act that was asked to be priced.
    await configure({ ...BASE, repeat: { enabled: true, default: 50 } });
    await signIn(U.beta);
    await submit(3, 'revision', RANGE(1, 5), 5);
    const second = await submit(3, 'revision', RANGE(1, 5), 5);
    eq('a second પુનરાવર્તન is still worth 0 — repeat is a લેવલ ૪ rule', second.pointsAwarded, 0);
    eq('and the day holds one row', (await paidRows(U.beta)).length, 1);
  });

  // ══════════════════════════════════════════════════════ §I liveness
  group('§I  effectiveFrom and disabled decide whether a rule pays at all');

  await sandbox(async () => {
    await configure({ ...BASE, effectiveFrom: TODAY });
    await exam(U.alpha, '4.1', true, 1); // an attempt sat yesterday
    eq('a rule effective from today does not reach back to yesterday\'s business day', await paidRows(U.alpha), []);
    await exam(U.alpha, '4.1', true, 0);
    eq('and pays today', await paidRows(U.alpha), [[4, '4.1', 450, 'DAY_FIRST']]);
  });

  await sandbox(async () => {
    await configure({ ...BASE, effectiveFrom: await day(-1) }); // tomorrow
    await signIn(U.beta);
    const r = await submit(3, 'revision', RANGE(1, 5), 5);
    await exam(U.beta, '4.1', true, 0);
    eq('a rule effective from tomorrow pays nothing today, at any level', [r.pointsAwarded, (await paidRows(U.beta)).length], [0, 0]);
  });

  await sandbox(async () => {
    await configure({ ...BASE, disabled: ['4.3'] });
    await exam(U.alpha, '4.3', true);
    eq('disabled: ["4.3"] switches that one કસોટી off', await paidRows(U.alpha), []);
    await exam(U.alpha, '4.1', true);
    eq('and leaves every other one paying', await paidRows(U.alpha), [[4, '4.1', 450, 'DAY_FIRST']]);
  });

  await sandbox(async () => {
    await configure({ ...BASE, disabled: ['level3'] });
    await signIn(U.beta);
    const r3 = await submit(3, 'revision', RANGE(1, 5), 5);
    const r1 = await submit(1, 'video', [], 0);
    eq('disabled: ["level3"] switches a whole ladder off and leaves the others alone', [
      r3.pointsAwarded,
      r1.pointsAwarded,
    ], [0, 100]);
    eq('and the switched-off level consumed no slot', await paidRows(U.beta), [[1, 'video', 100, 'DAY_FIRST']]);
  });

  await sandbox(async () => {
    // A tick rule that is switched off is switched off, not paid at the flat rate. The
    // liveness test is taken before the branch is chosen, which is the only order that lets a
    // સંચાલક stop લેવલ ૩ without also having to blank the values he would then retype.
    await configure({ ...BASE, disabled: ['level3'], tick: { mode: 'TICK', perTick: 2 } });
    await signIn(U.gamma);
    const r = await submit(3, 'revision', RANGE(1, 5), 5);
    eq('a disabled level under a tick rule pays 0, not the flat 300 either', [r.pointsAwarded, (await paidRows(U.gamma)).length], [0, 0]);
  });

  // ══════════════════════════════════════════════════════ §J idempotency
  group('§J  both indexes refuse a duplicate, and the function reports what was written');

  await sandbox(async () => {
    await configure(BASE);

    // Through the function. award_points() is the owner's to call — §L asserts that nobody
    // else may — and calling it twice is the cheapest statement of the day rule there is.
    const first = (
      await db.query(`select public.award_points($1, $2::date, 1, 'video', 'ACTIVITY_ATTEMPT', 501, 1) p`, [
        U.alpha,
        TODAY,
      ])
    ).rows[0].p;
    const second = await soft(`select public.award_points($1, $2::date, 1, 'video', 'ACTIVITY_ATTEMPT', 502, 2) p`, [
      U.alpha,
      TODAY,
    ]);
    eq('the first call writes 100 and returns it', first, 100);
    eq('the second raises nothing and returns 0 — ON CONFLICT DO NOTHING, not an error', [
      second.ok,
      second.rows?.[0]?.p,
    ], [true, 0]);
    eq('and there is one row', (await paidRows(U.alpha)).length, 1);
    eq('holding the FIRST call\'s source_id — the row that was written is the row that stands', (await ledger(U.alpha))[0].source_id, 501);

    // Through a raw INSERT, which is what the index is actually for: a check inside the
    // function could not decide a race and a second writer would not consult it at all.
    const raw = await soft(
      `insert into public.point_transactions
         (user_id, activity_date, level_id, activity_key, points, source, source_id,
          attempt_number, award_kind)
       values ($1, $2::date, 1, 'video', 100, 'ACTIVITY_ATTEMPT', 503, 3, 'DAY_FIRST')`,
      [U.alpha, TODAY]
    );
    refused('a raw INSERT of the same day, level and activity is refused by the index', raw, '23505');

    // The other index. p_idem given, so the day index does not apply at all.
    const i1 = (
      await db.query(
        `select public.point_award($1, $2::date, 3, 'revision', 40, 'TICK', 'ACTIVITY_ATTEMPT',
                                   601, 1, 'tick:601') p`,
        [U.alpha, TODAY]
      )
    ).rows[0].p;
    const i2 = await soft(
      `select public.point_award($1, $2::date, 3, 'revision', 40, 'TICK', 'ACTIVITY_ATTEMPT',
                                 601, 1, 'tick:601') p`,
      [U.alpha, TODAY]
    );
    eq('a keyed award writes once and returns what was written', i1, 40);
    eq('the same key again raises nothing and returns 0', [i2.ok, i2.rows?.[0]?.p], [true, 0]);
    eq('one TICK row exists', (await ledger(U.alpha)).filter((r) => r.award_kind === 'TICK').length, 1);

    const rawIdem = await soft(
      `insert into public.point_transactions
         (user_id, activity_date, level_id, activity_key, points, source, source_id,
          attempt_number, award_kind, idempotency_key)
       values ($1, $2::date, 3, 'revision', 40, 'ACTIVITY_ATTEMPT', 999, 9, 'TICK', 'tick:601')`,
      [U.alpha, TODAY]
    );
    refused('a raw INSERT reusing an idempotency key is refused by the index', rawIdem, '23505');

    // A different key under the same day/level/activity is allowed — which is what makes TICK
    // and REPEAT expressible at all, and is exactly the thing 0021's constraint forbade.
    const i3 = (
      await db.query(
        `select public.point_award($1, $2::date, 3, 'revision', 12, 'TICK', 'ACTIVITY_ATTEMPT',
                                   602, 2, 'tick:602') p`,
        [U.alpha, TODAY]
      )
    ).rows[0].p;
    eq('a different key under the same day, level and activity is a second award', i3, 12);
    eq('and both TICK rows stand', (await ledger(U.alpha)).filter((r) => r.award_kind === 'TICK').map((r) => r.points), [40, 12]);

    // Nothing writes a zero, by either route.
    const z1 = (
      await db.query(
        `select public.point_award($1, $2::date, 2, 'darshan', 0, 'DAY_FIRST', 'ACTIVITY_ATTEMPT',
                                   700, 1, null) p`,
        [U.alpha, TODAY]
      )
    ).rows[0].p;
    eq('a zero award writes no row and returns 0', [z1, (await ledger(U.alpha)).filter((r) => r.level_id === 2).length], [0, 0]);

    // A negative is refused for every kind but MANUAL, in the function and in the check.
    const n1 = (
      await db.query(
        `select public.point_award($1, $2::date, 2, 'darshan', -5, 'DAY_FIRST', 'ACTIVITY_ATTEMPT',
                                   701, 1, null) p`,
        [U.alpha, TODAY]
      )
    ).rows[0].p;
    eq('a negative DAY_FIRST is refused by the function and writes nothing', [n1, (await ledger(U.alpha)).filter((r) => r.points < 0).length], [0, 0]);
    refused(
      'and by point_transactions_points_check if anything else tried',
      await soft(
        `insert into public.point_transactions
           (user_id, activity_date, level_id, activity_key, points, source, source_id,
            attempt_number, award_kind)
         values ($1, $2::date, 2, 'darshan', -5, 'ACTIVITY_ATTEMPT', 702, 1, 'DAY_FIRST')`,
        [U.alpha, TODAY]
      ),
      '23514'
    );
    refused(
      'a repeatable kind with no idempotency key is refused by point_transactions_repeatable_needs_key',
      await soft(
        `insert into public.point_transactions
           (user_id, activity_date, level_id, activity_key, points, source, source_id,
            attempt_number, award_kind)
         values ($1, $2::date, 4, '4.1', 50, 'LEVEL4_ATTEMPT', 703, 1, 'REPEAT')`,
        [U.alpha, TODAY]
      ),
      '23514'
    );
    refused(
      'a MANUAL row with no admin and no reason is refused by point_transactions_manual_needs_reason',
      await soft(
        `insert into public.point_transactions
           (user_id, activity_date, level_id, activity_key, points, source, source_id,
            attempt_number, award_kind, idempotency_key)
         values ($1, $2::date, 0, '', 50, 'MANUAL_ADJUSTMENT', 0, 0, 'MANUAL', 'manual:x')`,
        [U.alpha, TODAY]
      ),
      '23514'
    );
    refused(
      'and an award_kind nobody defined is refused by point_transactions_kind_check',
      await soft(
        `insert into public.point_transactions
           (user_id, activity_date, level_id, activity_key, points, source, source_id,
            attempt_number, award_kind, idempotency_key)
         -- 'BONUS' was the undefined kind this line used, until 0033 defined it. Any name that a
         -- migration might plausibly adopt later is the wrong choice here: the assertion is that
         -- the constraint refuses what nobody has defined, and it silently stops testing that the
         -- day the name becomes real. 'NONSENSE' is not a word this schema will ever adopt.
         values ($1, $2::date, 1, 'video', 50, 'ACTIVITY_ATTEMPT', 704, 1, 'NONSENSE', 'x:1')`,
        [U.alpha, TODAY]
      ),
      '23514'
    );
  });

  await sandbox(async () => {
    // The boundary the partial index exists to hold: a legacy row (award_kind NULL) is inside
    // the predicate, so a DAY_FIRST award cannot pay a day that was already paid before 0031.
    await configure(BASE);
    const d5 = await day(5);
    const p = (
      await db.query(`select public.award_points($1, $2::date, 1, 'video', 'ACTIVITY_ATTEMPT', 800, 1) p`, [
        U.legacy,
        d5,
      ])
    ).rows[0].p;
    eq('a day a legacy row already paid cannot be paid again across the deployment boundary', p, 0);
    eq('and the legacy row is still the only one there', (await ledger(U.legacy)).filter((r) => r.activity_date === d5 && r.level_id === 1).length, 1);
  });

  // ══════════════════════════════════════════════════════ §K manual adjustment
  group('§K  admin_award_manual_points writes a new row and never edits one');

  await sandbox(async () => {
    await configure(BASE);
    await signIn(U.admin);

    const credit = (
      await db.query('select public.admin_award_manual_points($1, $2, $3) r', [U.alpha, 200, 'extra seva'])
    ).rows[0].r;
    eq('a credit is written and reported back', [credit.awarded, num(credit.total), credit.date], [200, 200, TODAY]);

    const row = (await ledger(U.alpha))[0];
    eq('as a MANUAL row belonging to no level', [row.level_id, row.activity_key, row.award_kind, row.source], [
      0,
      '',
      'MANUAL',
      'MANUAL_ADJUSTMENT',
    ]);
    eq('stamped with the acting સંચાલક and his reason', [row.admin_id, row.reason], [U.admin, 'extra seva']);
    eq('and keyed, because MANUAL is a kind that may repeat', row.idempotency_key?.startsWith('manual:'), true);

    const debit = (
      await db.query('select public.admin_award_manual_points($1, $2, $3) r', [U.alpha, -75, 'entered twice'])
    ).rows[0].r;
    eq('a debit is allowed — a correction is the one negative the ledger accepts', [debit.awarded, num(debit.total)], [-75, 125]);
    eq('and it is a THIRD row, never an edit of the first', (await ledger(U.alpha)).length, 2);

    const same = (
      await db.query('select public.admin_award_manual_points($1, $2, $3) r', [U.alpha, 200, 'extra seva'])
    ).rows[0].r;
    eq('two deliberate adjustments of the same amount for the same reason are two rows', [
      same.awarded,
      (await ledger(U.alpha)).length,
    ], [200, 3]);

    // It must not occupy the day. `level_id = 0` and `activity_key = ''` are outside every
    // real key, so the day's DAY_FIRST slot is still free after a correction.
    await signIn(U.alpha);
    const r = await submit(1, 'video', [], 0);
    eq('a correction does not consume the day\'s DAY_FIRST slot', r.pointsAwarded, 100);
    eq('so the ledger holds three MANUAL rows and one DAY_FIRST', await paidRows(U.alpha), [
      [0, '', 200, 'MANUAL'],
      [0, '', -75, 'MANUAL'],
      [0, '', 200, 'MANUAL'],
      [1, 'video', 100, 'DAY_FIRST'],
    ]);

    // The refusals.
    await signIn(U.admin);
    refused(
      'zero is refused — there is nothing to record',
      await soft('select public.admin_award_manual_points($1, 0, $2)', [U.alpha, 'nothing']),
      '23514'
    );
    refused(
      'a reason shorter than three characters is refused',
      await soft('select public.admin_award_manual_points($1, 50, $2)', [U.alpha, ' x ']),
      '23514'
    );
    refused(
      'and an amount beyond ±100000',
      await soft('select public.admin_award_manual_points($1, 100001, $2)', [U.alpha, 'far too much']),
      '23514'
    );
    refused(
      'a યુવક who does not exist',
      await soft('select public.admin_award_manual_points($1, 50, $2)', [
        '00000000-0000-4000-8000-000000000000',
        'nobody',
      ]),
      '23503'
    );
    eq('none of which wrote anything', (await ledger(U.alpha)).length, 4);
  });

  await sandbox(async () => {
    // A progress reader who may not price the levels may not hand out ગુણ either — the
    // permission is settings.update, which is what governs what points are worth.
    await signIn(U.viewer);
    refused(
      'a VIEWER, who holds progress.read but not settings.update, is refused',
      await soft('select public.admin_award_manual_points($1, 50, $2)', [U.alpha, 'not mine to give']),
      '42501'
    );
    await signIn(U.content);
    refused(
      'a CONTENT_MANAGER is refused',
      await soft('select public.admin_award_manual_points($1, 50, $2)', [U.alpha, 'not mine to give']),
      '42501'
    );
    eq('and nothing was written for either', (await ledger(U.alpha)).length, 0);
  });

  eq(
    'an ordinary યુવક is refused before anything is read',
    (await asUser(db, U.alpha, () => attempt(db, 'select public.admin_award_manual_points($1, 50, $2)', [U.beta, 'pay me']))).code,
    '42501'
  );
  eq(
    'and a visitor with no session at all',
    (await asAnon(db, () => attempt(db, 'select public.admin_award_manual_points($1, 50, $2)', [U.beta, 'pay me']))).code,
    '42501'
  );

  // ══════════════════════════════════════════════════════ §L authorisation
  group('§L  the writers are reachable by nobody, and the readers only by a progress reader');

  const WRITERS = [
    ["award_points", `select public.award_points($1, current_date, 1, 'video', 'ACTIVITY_ATTEMPT', 1, 1)`],
    ["point_award", `select public.point_award($1, current_date, 1, 'video', 100, 'DAY_FIRST', 'ACTIVITY_ATTEMPT', 1, 1)`],
    ['point_rules', 'select public.point_rules()'],
    ['point_rule_live', `select public.point_rule_live(1, 'video', current_date)`],
  ];
  for (const [name, sql] of WRITERS) {
    const asAuth = await asUser(db, U.alpha, () => attempt(db, sql, sql.includes('$1') ? [U.beta] : []));
    refused(`${name}() is not executable by a signed-in યુવક`, asAuth, '42501');
    const asNobody = await asAnon(db, () => attempt(db, sql, sql.includes('$1') ? [U.beta] : []));
    refused(`${name}() is not executable by anon either`, asNobody, '42501');
    eq(`${name}(): the refusal is a missing grant and says so`, /permission denied for function/i.test(asAuth.message), true);
  }

  eq(
    'even a SUPER_ADMIN cannot execute them — the grant does not exist for anybody',
    (
      await asUser(db, U.admin, () =>
        attempt(db, `select public.award_points($1, current_date, 1, 'video', 'ACTIVITY_ATTEMPT', 1, 1)`, [U.beta])
      )
    ).code,
    '42501'
  );

  const READERS = [
    ['admin_point_transactions', 'select * from public.admin_point_transactions()'],
    ['admin_user_timeline', 'select * from public.admin_user_timeline($1)'],
    ['admin_daily_activity', 'select public.admin_daily_activity(current_date)'],
    ['admin_leaderboard', 'select public.admin_leaderboard()'],
    ['admin_activity_counts', 'select * from public.admin_activity_counts(array[$1]::uuid[])'],
    ['admin_points_overview', 'select public.admin_points_overview()'],
    ['admin_point_activities', 'select * from public.admin_point_activities()'],
  ];
  for (const [name, sql] of READERS) {
    const args = sql.includes('$1') ? [U.mohan] : [];
    const asContent = await asUser(db, U.content, () => attempt(db, sql, args));
    refused(`${name}() refuses a CONTENT_MANAGER — no progress.read`, asContent, '42501');
    eq(
      `${name}(): and refuses with an authorisation error, not an empty report`,
      /progress reporting requires/i.test(asContent.message),
      true
    );
    refused(`${name}() refuses an ordinary યુવક`, await asUser(db, U.alpha, () => attempt(db, sql, args)), '42501');
    refused(`${name}() refuses anon`, await asAnon(db, () => attempt(db, sql, args)), '42501');
    eq(
      `${name}() answers a SUPER_ADMIN`,
      (await asUser(db, U.admin, () => attempt(db, sql, args))).ok,
      true
    );
    eq(
      `${name}() answers a VIEWER, who holds progress.read and users.read`,
      (await asUser(db, U.viewer, () => attempt(db, sql, args))).ok,
      true
    );
  }

  // A guard that only fires when the query happens to produce rows is not a guard, and this
  // is the case that decides how it has to be written. Asked about a યુવક who does not exist,
  // about an empty list of ids, or under a filter nobody matches, the scan beneath a guard
  // living inside the query yields nothing and the guard is never evaluated — so the
  // unauthorised caller is answered with silence instead of a refusal, which is §31's
  // complaint exactly. Only a statement executed before the query survives all three.
  const NOBODY = '00000000-0000-4000-8000-000000000000';
  refused(
    'admin_user_timeline() about a યુવક who does not exist still refuses',
    await asUser(db, U.content, () => attempt(db, 'select * from public.admin_user_timeline($1)', [NOBODY])),
    '42501'
  );
  refused(
    'admin_activity_counts() with an empty list of ids still refuses',
    await asUser(db, U.content, () =>
      attempt(db, `select * from public.admin_activity_counts('{}'::uuid[])`)
    ),
    '42501'
  );
  refused(
    'admin_point_transactions() under a filter nobody matches still refuses',
    await asUser(db, U.content, () =>
      attempt(db, 'select * from public.admin_point_transactions($1::uuid)', [NOBODY])
    ),
    '42501'
  );
  refused(
    'admin_daily_activity() on a day nothing happened still refuses',
    await asUser(db, U.content, () =>
      attempt(db, `select public.admin_daily_activity((current_date + 400))`)
    ),
    '42501'
  );
  refused(
    'admin_leaderboard() over a window nobody earned in still refuses',
    await asUser(db, U.content, () =>
      attempt(db, `select public.admin_leaderboard((current_date + 400), (current_date + 401))`)
    ),
    '42501'
  );
  eq(
    'and every one of those answers a SUPER_ADMIN with an empty result rather than an error',
    await asUser(db, U.admin, async () => [
      (await attempt(db, 'select * from public.admin_user_timeline($1)', [NOBODY])).count,
      (await attempt(db, `select * from public.admin_activity_counts('{}'::uuid[])`)).count,
      (await attempt(db, 'select * from public.admin_point_transactions($1::uuid)', [NOBODY])).count,
    ]),
    [0, 0, 0]
  );

  // ══════════════════════════════════════════════════════ §M the read surfaces
  group('§M  the seven 0032 read surfaces');

  const asReader = (fn) => asUser(db, U.admin, fn);

  const TX = `
    select * from public.admin_point_transactions(
      $1::uuid, $2::int, $3::text, $4::date, $5::date, $6::int, $7::int, $8::text, $9::text,
      $10::int, $11::int)`;
  const txArgs = (o) => [
    o.user ?? null,
    o.level ?? null,
    o.activity ?? null,
    o.from ?? null,
    o.to ?? null,
    o.min ?? null,
    o.max ?? null,
    o.kind ?? null,
    o.source ?? null,
    o.page ?? 0,
    o.size ?? 50,
  ];
  const tx = (o = {}) => asReader(async () => (await db.query(TX, txArgs(o))).rows);

  const all = await tx({ size: 1 });
  eq('admin_point_transactions returns its 21 declared columns', Object.keys(all[0]), [
    'total_rows',
    'id',
    'user_id',
    'name',
    'smk',
    'city_id',
    'zone_id',
    'activity_date',
    'level_id',
    'activity_key',
    'title',
    'points',
    'source',
    'source_id',
    'attempt_number',
    'award_kind',
    'rule_version',
    'reason',
    'admin_name',
    'is_legacy',
    'created_at',
  ]);
  eq('and total_rows is the whole filtered ledger, not the page', [num(all[0].total_rows), all.length], [LEDGER_ROWS, 1]);

  eq('p_user scopes it to one યુવક', (await tx({ user: U.mohan, size: 50 })).length, 6);
  eq('and total_rows follows the filter', num((await tx({ user: U.mohan, size: 1 }))[0].total_rows), 6);
  eq(
    'p_level = 4 admits the લેવલ ૪ awards, legacy and new alike',
    (await tx({ level: 4, size: 50 })).map((r) => [r.activity_key, r.points]).sort(),
    [
      ['4.1', 400],
      ['4.1', 400],
      ['4.2', 400],
    ].sort()
  );
  eq('p_activity = "4.1" admits Mohan\'s and the legacy one', (await tx({ activity: '4.1', size: 50 })).length, 2);
  eq('p_kind = "TICK" admits Mohan\'s two tick rows', (await tx({ kind: 'TICK', size: 50 })).map((r) => r.points).sort(), [12, 8].sort());
  eq(
    'p_kind = "LEGACY" is a filter even though it is not a value — the three pre-0031 rows',
    (await tx({ kind: 'LEGACY', size: 50 })).map((r) => r.is_legacy),
    [true, true, true]
  );
  eq('p_kind = "MANUAL" admits the one correction, and it carries its reason and its author', (await tx({ kind: 'MANUAL', size: 50 })).map((r) => [r.points, r.reason, r.admin_name]), [
    [-50, 'entered twice', 'Sanchalak Admin'],
  ]);
  eq('p_source = "MANUAL_ADJUSTMENT" finds the same one row', (await tx({ source: 'MANUAL_ADJUSTMENT', size: 50 })).length, 1);
  eq('p_min = 400 admits the three લેવલ ૪ awards alone', (await tx({ min: 400, size: 50 })).length, 3);
  eq('p_max = 0 admits the one negative row', (await tx({ max: 0, size: 50 })).map((r) => r.points), [-50]);
  eq(
    'p_min and p_max together are a band',
    (await tx({ min: 8, max: 12, size: 50 })).map((r) => r.points).sort((a, b) => a - b),
    [8, 12]
  );
  eq(
    'the date window is inclusive at both ends',
    (await tx({ user: U.mohan, from: await day(3), to: await day(2), size: 50 })).map((r) => r.points).sort((a, b) => a - b),
    [8, 12, 100, 200]
  );
  eq('a window nobody is in returns no rows and does not raise', (await tx({ from: await day(-5), to: await day(-5) })).length, 0);
  eq(
    'is_legacy is the interpretation of award_kind and nothing else',
    (await tx({ user: U.legacy, size: 50 })).map((r) => [r.award_kind, r.is_legacy]),
    [
      [null, true],
      [null, true],
      [null, true],
    ]
  );
  eq(
    'a લેવલ ૪ row carries the કસોટી\'s current title from the PUBLISHED configuration',
    (await tx({ activity: '4.2', size: 50 })).map((r) => r.title),
    ['Kasoti 4.2']
  );
  eq('and a લેવલ ૧-૩ row carries an empty one rather than a null', (await tx({ user: U.mohan, level: 1, size: 50 })).map((r) => r.title), ['']);

  // Pagination. The cap can only be observed on a set larger than it, which is what the 250
  // filler rows are for.
  eq('p_page_size = 500 returns 200 rows out of 250', (await tx({ user: U.filler, size: 500 })).length, 200);
  eq('and page 1 at that size skips 200, not 500 — the remaining 50', (await tx({ user: U.filler, size: 500, page: 1 })).length, 50);
  eq('p_page_size = 0 is raised to 1, not treated as unlimited', (await tx({ user: U.filler, size: 0 })).length, 1);
  eq('a page past the end is empty and does not raise', (await tx({ user: U.mohan, size: 50, page: 9 })).length, 0);
  const sweep = [];
  for (let page = 0; page < 3; page++) for (const r of await tx({ size: 100, page })) sweep.push(num(r.id));
  eq('a walk of the whole ledger in pages of 100 returns every row', sweep.length, LEDGER_ROWS);
  eq('exactly once', new Set(sweep).size, LEDGER_ROWS);

  // ── admin_user_timeline ──────────────────────────────────────────────────
  const TL = 'select * from public.admin_user_timeline($1::uuid, $2::date, $3::date, $4::int, $5::int)';
  const timeline = (uid, o = {}) =>
    asReader(async () => (await db.query(TL, [uid, o.from ?? null, o.to ?? null, o.page ?? 0, o.size ?? 50])).rows);

  const tlMohan = await timeline(U.mohan);
  eq('admin_user_timeline returns its 16 declared columns', Object.keys(tlMohan[0]), [
    'total_rows',
    'at',
    'activity_date',
    'level_id',
    'activity_key',
    'title',
    'kind',
    'attempt_number',
    'completed_items',
    'total_items',
    'status',
    'passed',
    'points',
    'award_kind',
    'reason',
    'actor_name',
  ]);
  eq('Mohan has 4 લેવલ ૧-૩ attempts, 1 કસોટી and 1 correction — six entries', [tlMohan.length, num(tlMohan[0].total_rows)], [6, 6]);
  eq('newest first', tlMohan.map((r) => r.kind), ['MANUAL', 'EXAM', 'ATTEMPT', 'ATTEMPT', 'ATTEMPT', 'ATTEMPT']);
  eq(
    'what each act was paid is joined ONTO the act, not listed beside it',
    tlMohan
      .filter((r) => r.kind !== 'MANUAL')
      .map((r) => [r.level_id, r.activity_key, r.points, r.award_kind]),
    [
      [4, '4.1', 400, 'DAY_FIRST'],
      [3, 'revision', 8, 'TICK'],
      [3, 'revision', 12, 'TICK'],
      [2, 'darshan', 200, 'DAY_FIRST'],
      [1, 'video', 100, 'DAY_FIRST'],
    ]
  );
  eq('the correction is its own act, with the સંચાલક who made it and why', [
    tlMohan[0].points,
    tlMohan[0].reason,
    tlMohan[0].actor_name,
  ], [-50, 'entered twice', 'Sanchalak Admin']);
  eq('the કસોટી carries its title and its pass', [tlMohan[1].title, tlMohan[1].passed, tlMohan[1].status], [
    'Kasoti 4.1',
    true,
    'COMPLETED',
  ]);

  const tlNayan = await timeline(U.nayan);
  eq('every લેવલ ૪ attempt appears, failed as well as passed', tlNayan.filter((r) => r.kind === 'EXAM').map((r) => [r.activity_key, r.passed, r.points]).sort(), [
    ['4.1', false, 0],
    ['4.2', true, 400],
  ].sort());
  eq('a failed કસોટી reads REVISION_REQUIRED and was paid nothing', tlNayan.find((r) => r.activity_key === '4.1').status, 'REVISION_REQUIRED');

  eq('the date window drops what is outside it', (await timeline(U.mohan, { from: await day(2), to: await day(2) })).length, 2);
  eq('and total_rows is the windowed total', num((await timeline(U.mohan, { from: await day(2), to: await day(2) }))[0].total_rows), 2);
  eq('it pages', [(await timeline(U.mohan, { size: 2 })).length, (await timeline(U.mohan, { size: 2, page: 2 })).length], [2, 2]);
  eq('and a page past the end is empty', (await timeline(U.mohan, { size: 2, page: 9 })).length, 0);
  eq('a યુવક with nothing has an empty timeline rather than an error', (await timeline(U.alpha)).length, 0);

  // A legacy award is attached to no act, and that is correct rather than a gap to be closed.
  // The timeline joins on `point_transactions.attempt_id`, which is NULL on every row written
  // before 0031 because 0031 backfills nothing (§J1). The award still exists and
  // admin_point_transactions still reports it; it simply cannot be hung on an attempt nobody
  // recorded a pointer to. Pinned here so that a later "fix" has to delete a test that says
  // why, rather than quietly adding the backfill §J1 forbids.
  eq(
    'a legacy award is in the ledger',
    (await tx({ user: U.legacy, kind: 'LEGACY', size: 50 })).length,
    TOTAL_LEGACY_ROWS
  );
  eq(
    'and does not appear on the timeline, because a legacy row names no attempt — never a backfill',
    (await timeline(U.legacy)).length,
    0
  );

  // ── admin_daily_activity ─────────────────────────────────────────────────
  const daily = (d, o = {}) =>
    asReader(
      async () =>
        (await db.query('select public.admin_daily_activity($1::date, $2::text, $3::text, $4::int) r', [
          d,
          o.city ?? null,
          o.zone ?? null,
          o.limit ?? null,
        ])).rows[0].r
    );

  const d2 = await daily(await day(2));
  eq('admin_daily_activity returns its declared shape', Object.keys(d2).sort(), ['cap', 'date', 'rows', 'totals', 'truncated']);
  eq('on T-2 only Mohan did anything', [d2.totals.activeUsers, d2.rows.length], [1, 1]);
  eq('two પુનરાવર્તન sessions, no દર્શન, no વિડિયો, no કસોટી', [
    d2.totals.revisionSessions,
    d2.totals.darshanSessions,
    d2.totals.videoSessions,
    d2.totals.examAttempts,
  ], [2, 0, 0, 0]);
  eq(
    'ticks are the distinct union across the day, with the withheld 13 subtracted — 1-10 is 10, not 13 and not 11',
    d2.totals.ticks,
    10
  );
  eq('and the day\'s ledger is 12 + 8', d2.totals.points, 20);
  eq('the per-યુવક row says the same', [d2.rows[0].revisionSessions, d2.rows[0].ticks, d2.rows[0].points, d2.rows[0].smk], [
    2,
    10,
    20,
    'MOH105',
  ]);

  const d1 = await daily(await day(1));
  eq('on T-1 Mohan sat one કસોટી and Nayan two, one of which failed', [
    d1.totals.activeUsers,
    d1.totals.examAttempts,
    d1.totals.examPassed,
    d1.totals.examFailed,
  ], [2, 3, 2, 1]);
  eq('a correction alone is not activity — Mohan is here for his કસોટી, not his -50', d1.rows.find((r) => r.smk === 'MOH105').examAttempts, 1);
  eq('the city filter narrows it', (await daily(await day(1), { city: 'surat', zone: 'vedroad' })).rows.map((r) => r.smk), ['NAY106']);
  eq('a zone nobody is in is empty rather than an error', (await daily(await day(1), { zone: 'nowhere' })).totals.activeUsers, 0);
  eq('and reports its cap and whether it hit it', [d1.cap, d1.truncated], [500, false]);
  eq('p_limit is honoured and the truncation is stated, never silent', await (async () => {
    const capped = await daily(await day(1), { limit: 1 });
    return [capped.rows.length, capped.truncated, capped.totals.activeUsers];
  })(), [1, true, 2]);
  eq('a day nothing happened on is an empty day, not a failure', (await daily(await day(-5))).totals.activeUsers, 0);

  // ── admin_leaderboard ────────────────────────────────────────────────────
  const board = (o = {}) =>
    asReader(
      async () =>
        (await db.query('select public.admin_leaderboard($1::date, $2::date, $3::text, $4::text, $5::int) r', [
          o.from ?? null,
          o.to ?? null,
          o.city ?? null,
          o.zone ?? null,
          o.limit ?? null,
        ])).rows[0].r
    );

  const b = await board({ limit: 50 });
  eq('admin_leaderboard returns its declared shape', Object.keys(b).sort(), [
    'from',
    'participants',
    'rows',
    'shown',
    'to',
    'totalPoints',
  ]);
  eq('four યુવકો have earned anything', [b.participants, b.shown], [4, 4]);
  eq('and it is the same sum(point_transactions.points) the યુવક\'s own board computes', b.totalPoints, LEDGER_POINTS);
  eq('ranked, and carrying the user id, city and zone a યુવક\'s board must never carry', b.rows.map((r) => [r.rank, r.smk, r.points, r.cityId, r.zoneId]), [
    [1, 'LEG104', TOTAL_LEGACY_POINTS, 'surat', 'varachha'],
    [2, 'NAY106', NAYAN_POINTS, 'surat', 'vedroad'],
    [3, 'MOH105', MOHAN_POINTS, 'surat', 'varachha'],
    [4, 'FIL107', FILL_POINTS, 'navsari', 'navsari'],
  ]);
  eq('every row names its યુવક by id, which is what this board is for', b.rows.map((r) => r.userId), [
    U.legacy,
    U.nayan,
    U.mohan,
    U.filler,
  ]);
  eq(
    'the rank is the whole project\'s and is NOT renumbered inside a city filter',
    (await board({ city: 'surat', limit: 50 })).rows.map((r) => [r.rank, r.smk]),
    [
      [1, 'LEG104'],
      [2, 'NAY106'],
      [3, 'MOH105'],
    ]
  );
  eq('a zone filter narrows further and still keeps the project rank', (await board({ zone: 'vedroad', limit: 50 })).rows.map((r) => [r.rank, r.smk]), [[2, 'NAY106']]);
  eq('p_limit cuts the list and says how many are shown', await (async () => {
    const cut = await board({ limit: 2 });
    return [cut.rows.length, cut.shown, cut.participants];
  })(), [2, 2, 4]);
  eq(
    'a date window changes who is on it — only T-1 counts Mohan\'s exam and correction and Nayan\'s day',
    (await board({ from: await day(1), to: await day(1), limit: 50 })).rows.map((r) => [r.smk, r.points]),
    [
      ['NAY106', 700],
      ['MOH105', 350],
    ]
  );
  eq('a window nobody earned in is an empty board, not an error', (await board({ from: await day(-5), to: await day(-5) })).rows, []);

  // ── admin_activity_counts ────────────────────────────────────────────────
  const counts = (users, o = {}) =>
    asReader(
      async () =>
        (await db.query('select * from public.admin_activity_counts($1::uuid[], $2::date, $3::date)', [
          users,
          o.from ?? null,
          o.to ?? null,
        ])).rows
    );

  const c = await counts([U.mohan, U.nayan, U.alpha]);
  eq('admin_activity_counts returns its 10 declared columns', Object.keys(c[0]), [
    'user_id',
    'darshan_sessions',
    'revision_sessions',
    'video_sessions',
    'ticks',
    'attempts_all',
    'exam_attempts',
    'exam_passed',
    'points_total',
    'rank',
  ]);
  eq('one row per id asked for, and only for the ids asked for', c.length, 3);
  const cm = c.find((r) => r.user_id === U.mohan);
  eq(
    'Mohan: 1 વિડિયો, 1 દર્શન, 2 પુનરાવર્તન, 5 attempts in all',
    [cm.darshan_sessions, cm.revision_sessions, cm.video_sessions, cm.attempts_all, cm.exam_attempts, cm.exam_passed],
    [1, 2, 1, 5, 1, 1]
  );
  eq(
    'his ticks are 10 — the distinct union 1-10, with the withheld 13 subtracted',
    cm.ticks,
    10
  );
  eq('his points and his place in the whole project', [num(cm.points_total), cm.rank], [MOHAN_POINTS, 3]);
  const cn = c.find((r) => r.user_id === U.nayan);
  eq('Nayan: one પુનરાવર્તન and two કસોટીઓ, one passed', [cn.revision_sessions, cn.attempts_all, cn.exam_attempts, cn.exam_passed], [1, 3, 2, 1]);
  eq('and 3 ticks', cn.ticks, 3);
  const ca = c.find((r) => r.user_id === U.alpha);
  eq('a યુવક who has earned nothing has no rank at all, which is not last place', [num(ca.points_total), ca.rank], [0, null]);
  eq('and zeroes rather than absent rows', [ca.darshan_sessions, ca.revision_sessions, ca.ticks, ca.attempts_all], [0, 0, 0, 0]);
  eq(
    'the window narrows the counts but not the rank, which is the project\'s',
    await (async () => {
      const w = (await counts([U.mohan], { from: await day(2), to: await day(2) }))[0];
      return [w.revision_sessions, w.video_sessions, w.exam_attempts, w.ticks, w.rank];
    })(),
    [2, 0, 0, 10, 3]
  );
  eq('an empty list of ids returns no rows and does not raise', (await counts([])).length, 0);

  // points_total and rank are lifetime and the other six columns are windowed, deliberately:
  // 0032's own comment says the rank is the whole project's and never the page's, and a rank
  // computed inside a date window would be a different number from the one on the board. The
  // panel labels the two columns lifetime. Pinned so the asymmetry is a decision on the record
  // rather than something the next reader takes for an oversight.
  eq(
    'points_total and rank are lifetime even under a window that excludes most of the ledger',
    await (async () => {
      const w = (await counts([U.mohan], { from: await day(2), to: await day(2) }))[0];
      const lifetime = (await counts([U.mohan]))[0];
      return [num(w.points_total), w.rank, num(lifetime.points_total), lifetime.rank];
    })(),
    [MOHAN_POINTS, 3, MOHAN_POINTS, 3]
  );

  // ── admin_points_overview ────────────────────────────────────────────────
  const overview = await asReader(async () => (await db.query('select public.admin_points_overview() r')).rows[0].r);
  eq('admin_points_overview returns its declared shape', Object.keys(overview).sort(), [
    'byKind',
    'byLevel',
    'leaderboard',
    'rules',
    'settings',
    'totals',
  ]);
  eq('the whole ledger, counted and summed', [overview.totals.transactions, overview.totals.points, overview.totals.earners], [
    LEDGER_ROWS,
    LEDGER_POINTS,
    4,
  ]);
  eq(
    'and the reconciliation line §41 asks for: legacy rows and points reported apart from new ones',
    [overview.totals.legacyRows, overview.totals.legacyPoints, overview.totals.newRows, overview.totals.newPoints],
    [TOTAL_LEGACY_ROWS, TOTAL_LEGACY_POINTS, LEDGER_ROWS - TOTAL_LEGACY_ROWS, LEDGER_POINTS - TOTAL_LEGACY_POINTS]
  );
  eq('the two halves account for every row and every ગુણ', [
    overview.totals.legacyRows + overview.totals.newRows,
    overview.totals.legacyPoints + overview.totals.newPoints,
  ], [overview.totals.transactions, overview.totals.points]);
  eq(
    'byKind names the legacy rows LEGACY rather than leaving the kind blank',
    canonical(Object.fromEntries(overview.byKind.map((k) => [k.kind, [k.rows, k.points]]))),
    canonical({
      LEGACY: [3, 800],
      DAY_FIRST: [FILL + 5, FILL + 1400],
      TICK: [2, 20],
      MANUAL: [1, -50],
    })
  );
  eq('byLevel includes level 0, which is where a correction belongs', Object.fromEntries(overview.byLevel.map((l) => [l.level, l.rows])), {
    0: 1,
    1: FILL + 2,
    2: 1,
    3: 4,
    4: 3,
  });
  eq('it carries the rules in force', overview.rules.tick.mode, 'ACTIVITY');
  eq('and the settings the panel is about to edit', Object.keys(overview.settings).sort(), [
    'enabled',
    'level1',
    'level2',
    'level3',
    'level4',
  ]);
  eq('and the leaderboard configuration beside them', Object.keys(overview.leaderboard).sort(), [
    'defaultPeriod',
    'enabled',
    'periods',
    'topN',
  ]);

  // ── admin_point_activities ───────────────────────────────────────────────
  const acts = await asReader(async () => (await db.query('select * from public.admin_point_activities()')).rows);
  eq('admin_point_activities returns its four declared columns', Object.keys(acts[0]), ['code', 'title', 'position', 'active']);
  eq('every કસોટી in the published configuration, in ક્રમ order and not hardcoded to four', acts.map((a) => [a.code, a.position]), [
    ['4.1', 1],
    ['4.2', 2],
    ['4.3', 3],
  ]);

  await sandbox(async () => {
    // §11: a ૪.૪ created next month appears the moment it is published. Back to DRAFT to add
    // it and published again, because level4_guard_editable() (0010) freezes the activities of
    // a PUBLISHED configuration — which is the point of publishing, and is the path the panel
    // itself takes.
    await db.query(`update public.level4_configs set status = 'DRAFT' where id = $1`, [ACT.config]);
    await db.query(
      `insert into public.level4_activities (config_id, code, title, position, active, required_count)
       values ($1, '4.4', 'Kasoti 4.4', 4, true, 2)`,
      [ACT.config]
    );
    await db.query(`update public.level4_configs set status = 'PUBLISHED' where id = $1`, [ACT.config]);
    eq(
      'a newly published કસોટી appears without anything being edited',
      (await asReader(async () => (await db.query('select code from public.admin_point_activities()')).rows)).map((r) => r.code),
      ['4.1', '4.2', '4.3', '4.4']
    );
  });

  // ══════════════════════════════════════════════════════ §N one question, one answer
  group('§N  "how many ticks" has one answer, in the ledger and on both screens');

  // A યુવક submitted 1-6, then 5-10 and the withheld 13, on T-2. Three pieces of SQL are
  // entitled to an opinion about how many દ્રશ્યો that is — award_points()'s TICK branch,
  // admin_activity_counts() and admin_daily_activity() — and if any two of them disagree then
  // the daily page and the progress report print different numbers for the same person on the
  // same day, and no screen can say which is wrong.
  eq(
    'admin_daily_activity and admin_activity_counts agree for Mohan on T-2',
    await (async () => {
      const dd = await daily(await day(2));
      const cc = (await counts([U.mohan], { from: await day(2), to: await day(2) }))[0];
      return [dd.rows[0].ticks, cc.ticks, dd.totals.ticks];
    })(),
    [10, 10, 10]
  );
  eq(
    'and neither can exceed the number of live દ્રશ્યો, which is what the subtraction is for',
    (await daily(await day(2))).totals.ticks <= LIVE,
    true
  );

  await sandbox(async () => {
    // The third opinion, taken from the ledger rather than from another report. perTick is 1,
    // so what was paid IS the tick count, and the two reports must return that same number.
    await configure({ ...BASE, tick: { mode: 'TICK', perTick: 1 } });
    await signIn(U.alpha);
    await submit(3, 'revision', [...RANGE(1, 4), ...WITHHELD], 4 + WITHHELD.length);
    await submit(3, 'revision', [...RANGE(3, 9), SCENE(13)], 8);

    const paidToday = (await ledger(U.alpha)).reduce((n, r) => n + r.points, 0);
    await signIn(U.admin);
    const dd = (await db.query('select public.admin_daily_activity($1::date) r', [TODAY])).rows[0].r;
    const cc = (
      await db.query('select * from public.admin_activity_counts($1::uuid[], $2::date, $3::date)', [
        [U.alpha],
        TODAY,
        TODAY,
      ])
    ).rows[0];

    eq('the engine paid for the 9 live દ્રશ્યો 1-9 and for neither of the withheld ones', paidToday, 9);
    eq('and both reports return that same 9', [dd.totals.ticks, cc.ticks], [9, 9]);
    eq('the withheld દ્રશ્યો were submitted, so this is a subtraction and not an absence', await (async () => {
      const raw = (
        await db.query(
          `select count(distinct s.scene_id)::int c
           from public.activity_attempts a
           cross join lateral unnest(a.selected_scene_ids) as s(scene_id)
           where a.user_id = $1 and a.level_id = 3 and a.activity_date = $2::date`,
          [U.alpha, TODAY]
        )
      ).rows[0].c;
      return raw;
    })(), 12);
    eq('and the reported figure is under the live collection rather than over it', [dd.totals.ticks <= LIVE, cc.ticks <= LIVE], [
      true,
      true,
    ]);
  });

  // ══════════════════════════════════════════════════════ §O the યુવક's board
  group('§O  leaderboard() still carries a name and a number, and never a user id');

  await sandbox(async () => {
    await configure(BASE, {
      leaderboard: { enabled: true, periods: ['DAY', 'WEEK', 'MONTH', 'ALL'], defaultPeriod: 'ALL', topN: 10 },
    });
    await signIn(U.mohan);
    const board2 = (await db.query(`select public.leaderboard('ALL') r`)).rows[0].r;
    eq('the board is returned and has people on it', board2.rows.length > 0, true);
    eq('and every row holds exactly rank, name, points and isMe', [...new Set(board2.rows.map((r) => Object.keys(r).sort().join(',')))], [
      'isMe,name,points,rank',
    ]);
    eq(
      'no user id appears anywhere in the document, at any depth',
      /"userId"|"user_id"/.test(JSON.stringify(board2)),
      false
    );
    eq('his own place is reported to him without the names above him', [board2.me.rank, Object.keys(board2.me).sort().join(',')], [
      3,
      'points,rank',
    ]);
  });

  // ══════════════════════════════════════════════════════ §P the coercion traps
  group('§P  a string that looks like a number is not one, and neither is a string "false"');

  await sandbox(async () => {
    refused(
      'the validator refuses level1 holding the STRING "300"',
      await tryConfigure({ ...BASE, level1: '300' }),
      '23514'
    );
    refused(
      'and enabled holding the STRING "false"',
      await tryConfigure({ ...BASE, enabled: 'false' }),
      '23514'
    );
    refused('and a repeat.default that is a string', await tryConfigure({ ...BASE, repeat: { enabled: true, default: '50' } }), '23514');
    refused('and a repeat.enabled that is a string', await tryConfigure({ ...BASE, repeat: { enabled: 'true', default: 50 } }), '23514');
    refused('and a disabled list that is not a list', await tryConfigure({ ...BASE, disabled: '4.3' }), '23514');
    refused('and a disabled entry that is not a code or a level', await tryConfigure({ ...BASE, disabled: ['level9'] }), '23514');
    refused('and a tick mode nobody defined', await tryConfigure({ ...BASE, tick: { mode: 'PER_SCENE' } }), '23514');
    refused('and TICK mode with nothing to pay per tick', await tryConfigure({ ...BASE, tick: { mode: 'TICK', perTick: 0 } }), '23514');
    refused(
      'and REVISION mode with nothing to pay per revision',
      await tryConfigure({ ...BASE, tick: { mode: 'REVISION', perRevision: 0 } }),
      '23514'
    );
    refused('and a tick key nobody defined', await tryConfigure({ ...BASE, tick: { mode: 'ACTIVITY', perScene: 4 } }), '23514');
    refused('and a fractional effectiveFrom', await tryConfigure({ ...BASE, effectiveFrom: '2026-8-1' }), '23514');
    refused('and a negative version', await tryConfigure({ ...BASE, version: -1 }), '23514');
    eq(
      'while the keys 0031 adds are all optional — 0021\'s own row still saves unchanged',
      (await tryConfigure(BASE)).ok,
      true
    );
  });

  await sandbox(async () => {
    // The validator is the guarantee, and it is not the only line of defence. A row that
    // reached the table another way — a direct psql edit, a restore from a project that
    // predates the check — must still pay nothing rather than pay what a coercing
    // implementation would read out of it.
    await db.query('alter table public.settings disable trigger settings_check_points');

    await configure({ ...BASE, level1: '300', level3: '300' });
    await signIn(U.alpha);
    const r1 = await submit(1, 'video', [], 0);
    const r3 = await submit(3, 'revision', RANGE(1, 5), 5);
    eq('a level holding the string "300" is worth 0, not 300', [r1.pointsAwarded, r3.pointsAwarded], [0, 0]);
    eq('and writes nothing', (await ledger(U.alpha)).length, 0);

    await configure({ ...BASE, enabled: 'false' });
    const r2 = await submit(2, 'darshan', [], 0);
    eq('enabled holding the string "false" is off, though it is truthy in every language', r2.pointsAwarded, 0);

    await configure({ ...BASE, enabled: 'true' });
    const r2b = await submit(2, 'darshan', [], 0);
    eq('and so is the string "true" — only the JSON boolean turns it on', r2b.pointsAwarded, 0);

    // With the system genuinely switched off, no rule 0031 adds may pay either. "enabled:
    // false is worth 0 everywhere" is 0021's contract and a tick or repeat rule that outlived
    // the off switch would be a scoring system nobody switched on.
    await configure({
      ...BASE,
      enabled: false,
      tick: { mode: 'TICK', perTick: 2 },
      repeat: { enabled: true, default: 50 },
    });
    await signIn(U.beta);
    const off3 = await submit(3, 'revision', RANGE(1, 5), 5);
    await exam(U.beta, '4.1', true);
    await exam(U.beta, '4.1', true);
    eq('points switched off pays nothing under a tick rule', off3.pointsAwarded, 0);
    eq('and nothing under a repeat rule', await paidRows(U.beta), []);
  });

  // ══════════════════════════════════════════════════════ §Q bounds and types
  group('§Q  a value the validator accepts is never one the resolver chokes on');

  // The general property, and the reason it is worth a group of its own. `point_rules()` is
  // forgiving by design — every malformed key falls to the behaviour of the day before 0031,
  // and nothing it reads may raise. But "forgiving" is only true up to the range of the type
  // it casts to, and the validator is the only thing standing between a સંચાલક's keyboard and
  // that cast. `version` is resolved with `round(...)::integer`, and the validator originally
  // bounded it below and not above, so a version of 3000000000 saved cleanly and then made
  // every later call to point_rules() raise `integer out of range` — which is to say every
  // submission at every level for everybody, from one number typed into one field.

  await sandbox(async () => {
    refused(
      'a points version above int4 is refused, because point_rules() casts it to integer',
      await tryConfigure({ ...BASE, version: 3000000000 }),
      '23514'
    );
    refused('and one far beyond it', await tryConfigure({ ...BASE, version: 999999999999 }), '23514');
    eq('the ceiling itself saves', (await tryConfigure({ ...BASE, version: 2147483647 })).ok, true);
    eq(
      'and the whole award path still works at the ceiling',
      await (async () => {
        const rules = (await db.query('select public.point_rules() r')).rows[0].r;
        const live = (await db.query(`select public.point_rule_live(4, '4.1', current_date) l`)).rows[0].l;
        await exam(U.alpha, '4.1', true);
        return [rules.version, live, await paidRows(U.alpha)];
      })(),
      [2147483647, true, [[4, '4.1', 450, 'DAY_FIRST']]]
    );
    eq(
      'and the version in force is stamped on the award, which is what the field is for',
      (await ledger(U.alpha))[0].rule_version,
      2147483647
    );
  });

  // The regression guard. Every configuration the trigger accepts is run through the two
  // resolvers on the award path, and neither may raise. A bound that drifts outside the range
  // of its cast fails here rather than in production on the day somebody types a big number.
  const ACCEPTED = [
    ['0021\'s own row, nothing 0031 added', BASE],
    ['every level at 0', { ...BASE, level1: 0, level2: 0, level3: 0, level4: { default: 0 } }],
    ['every level at the ceiling', { ...BASE, level1: 10000, level2: 10000, level3: 10000, level4: { default: 10000, '4.1': 10000 } }],
    ['version at the floor', { ...BASE, version: 0 }],
    ['version at the ceiling', { ...BASE, version: 2147483647 }],
    ['repeat off with values still typed in', { ...BASE, repeat: { enabled: false, default: 10000, dailyLimit: 1000, '4.1': 10000 } }],
    ['repeat at every ceiling', { ...BASE, repeat: { enabled: true, default: 10000, dailyLimit: 1000, '4.1': 10000 } }],
    ['repeat at every floor', { ...BASE, repeat: { enabled: true, default: 0, dailyLimit: 0 } }],
    ['repeat with nothing but the switch', { ...BASE, repeat: { enabled: true } }],
    ['tick at its ceilings', { ...BASE, tick: { mode: 'TICK', perTick: 10000, perRevision: 10000, dailyCap: 100000 } }],
    ['revision mode', { ...BASE, tick: { mode: 'REVISION', perRevision: 1 } }],
    ['tick with nothing but the mode', { ...BASE, tick: { mode: 'ACTIVITY' } }],
    // Accepted, and resolving to ACTIVITY. `(tk ->> 'mode') not in (...)` is NULL for a jsonb
    // null, so the trigger raises nothing, and point_rules() falls to its coalesce. Current
    // behaviour, pinned so it cannot change by accident: a panel that clears the field writes
    // a null, and it must mean "no tick rule" rather than an error the સંચાલક cannot act on.
    ['a tick mode of null', { ...BASE, tick: { mode: null } }],
    ['an effectiveFrom of null', { ...BASE, effectiveFrom: null }],
    ['an effectiveFrom in the past', { ...BASE, effectiveFrom: '2020-01-01' }],
    ['an empty disabled list', { ...BASE, disabled: [] }],
    ['a disabled list of codes and levels', { ...BASE, disabled: ['4.1', '4.3', 'level1', 'level4'] }],
    ['everything 0031 adds, at once', {
      ...BASE,
      version: 9,
      effectiveFrom: '2024-06-01',
      disabled: ['4.3'],
      repeat: { enabled: true, default: 50, dailyLimit: 3, '4.1': 75 },
      tick: { mode: 'TICK', perTick: 2, perRevision: 4, dailyCap: 500 },
    }],
  ];

  for (const [label, points] of ACCEPTED) {
    await sandbox(async () => {
      const saved = await tryConfigure(points);
      if (!saved.ok) {
        eq(`${label}: is accepted by settings_check_points`, saved.message, 'accepted');
        return;
      }
      const resolved = await soft('select public.point_rules() r');
      const live = await soft(`select public.point_rule_live(3, 'revision', current_date) l`);
      const paid = await soft(`select public.award_points($1, current_date, 3, 'revision', 'ACTIVITY_ATTEMPT', 1, 1) p`, [
        U.alpha,
      ]);
      eq(`${label}: point_rules(), point_rule_live() and award_points() all answer without raising`, [
        resolved.ok,
        live.ok,
        paid.ok,
      ], [true, true, true]);
    });
  }

  await sandbox(async () => {
    await configure({ ...BASE, tick: { mode: null } });
    eq('a tick mode of null resolves to ACTIVITY, which is the absent-key behaviour', (await db.query('select public.point_rules() r')).rows[0].r.tick.mode, 'ACTIVITY');
    await signIn(U.beta);
    eq('so લેવલ ૩ takes the flat branch', (await submit(3, 'revision', RANGE(1, 5), 5)).pointsAwarded, 300);
  });

  // ── the second gap of this class, now closed ─────────────────────────────
  //
  // These two assertions were once labelled FINDING and asserted the opposite: `effectiveFrom`
  // was validated as a *format* (`^\d{4}-\d{2}-\d{2}$`) and never as a date, so '2026-13-45'
  // saved cleanly and `point_rule_live()` — which casts it with `::date` on every award — then
  // raised 22008 for every submission at every level, for everybody. The same shape of defect
  // as the unbounded `version`, through a different cast, and found by asking the same question
  // of a second field.
  //
  // 0031 now validates by casting inside a nested block and catching, rather than by growing the
  // pattern: the calendar is not a regular language and Postgres already owns the answer.
  await sandbox(async () => {
    const saved = await tryConfigure({ ...BASE, effectiveFrom: '2026-13-45' });
    eq('a date-shaped non-date is refused by settings_check_points', saved.ok, false);
    eq('and the refusal names the value', /is not a real date/.test(saved.message || ''), true);

    // The rule the two fixes share, asserted rather than described: anything the trigger accepted
    // must survive every cast the resolvers make. A future bound that is looser than its type
    // fails here.
    for (const day of ['2026-09-01', '2024-02-29', '2000-02-29']) {
      const ok = await tryConfigure({ ...BASE, effectiveFrom: day });
      eq(`${day} is a real day and saves`, ok.ok, true);
      const live = await soft(`select public.point_rule_live(3, 'revision', current_date) l`);
      eq(`and point_rule_live() answers rather than raising for ${day}`, live.ok, true);
    }

    for (const bad of ['2025-02-29', '2026-04-31', '2026-00-10']) {
      eq(`${bad} is shaped like a day and is refused`, (await tryConfigure({ ...BASE, effectiveFrom: bad })).ok, false);
    }
  });
}

await main();
