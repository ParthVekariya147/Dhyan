/**
 * લેવલ ૩ as repeated પુનરાવર્તન, against a real Postgres — `node scripts/test-level3-revisions.mjs`.
 *
 * 0035 makes four claims that cannot be checked from JavaScript, because all four live in
 * SECURITY DEFINER functions, an AFTER trigger, a partial unique index and a clock:
 *
 *   1. **પુનરાવર્તન accumulate.** ૫૦ then ૪૦ is ૯૦, then ૩૦ is ૧૨૦, and a reset takes nothing
 *      away. The requirement states this five separate times and it is the whole feature.
 *   2. **A partial પુનરાવર્તન is paid at all.** Before 0035 it was not: `activity_submit()`
 *      awards only a COMPLETED attempt (0021:970), so ૫૦ of ૧૦૮ reached the award engine zero
 *      times. This is the fault everything else was downstream of.
 *   3. **The pace rule caps by measured time**, and the time is measured by the database.
 *      "૫૦ ટિક માટે ૫૦ સેકંડ" — and ૧૦૮ ticks in twelve seconds is worth twelve.
 *   4. **Nothing already paid can be taken back**, including by /daily's reconciliation, which
 *      before 0035 would have written a negative row large enough to erase an afternoon.
 *
 * The shape is scripts/test-point-engine.mjs's, for its stated reason: `docker run postgres:16`,
 * apply the prelude and every migration in filename order, seed a population whose figures were
 * worked out on paper, then drive the **real** writers and assert on the rows they wrote. No
 * function here calls `award_points()` by hand.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * How time is faked, and why that is honest
 * ────────────────────────────────────────────────────────────────────────────
 *
 * A suite that waited ૧૦૮ real seconds to test a ૧૦૮-tick પુનરાવર્તન would take an hour. So
 * `level3_drafts.updated_at` is moved backwards as the owner and the real `level3_draft_save()`
 * is then called, which measures the gap against its own `now()` exactly as it would in
 * production. The clock is genuine; only the starting point is arranged. What is never faked is
 * `engaged_ms` on the path being tested — §C proves the accumulation, and everything downstream
 * of it uses the number that accumulation produced.
 */
import {
  startDatabase, dockerAvailable, asUser, asAnon,
} from './lib/pgtest.mjs';

// ════════════════════════════════════════════════════════════════════ harness

let passed = 0;
const failures = [];
let currentGroup = '';

const group = (name) => { currentGroup = name; console.log(`\n${name}`); };

function ok(label, condition, detail) {
  if (condition) { passed++; console.log(`  ok   ${label}`); return true; }
  failures.push(`${currentGroup} → ${label}${detail ? `\n       ${detail}` : ''}`);
  console.log(`  FAIL ${label}${detail ? `\n       ${detail}` : ''}`);
  return false;
}

const j = (v) => JSON.stringify(v);

function eq(label, actual, expected) {
  return ok(label, j(actual) === j(expected), `expected ${j(expected)}, got ${j(actual)}`);
}

// ════════════════════════════════════════════════════════════════════ fixtures

const U = {
  // CASE 1-4 and 15: the requirement's own worked example, start to finish.
  arjun: 'a1111111-1111-4111-8111-111111111111',
  // CASE 5-7: idempotency, invalid ids, and the draft surviving a refresh.
  bhavesh: 'b2222222-2222-4222-8222-222222222222',
  // §C: the pace rule, on its own, with nothing else configured.
  chirag: 'c3333333-3333-4333-8333-333333333333',
  // CASE 12: the second name on the board.
  dhruv: 'd4444444-4444-4444-8444-444444444444',
  // §H: levels 1, 2 and 4 must be exactly what they were.
  eshan: 'e5555555-5555-4555-8555-555555555555',
  // §G: the /daily clawback, which is the one that would have undone everything.
  falgun: 'f6666666-6666-4666-8666-666666666666',
  // The સંચાલક, for §I's reports and for scene_catalog_sync().
  admin: '07777777-7777-4777-8777-777777777777',
};

const SCENE = (n) => `d-${String(n).padStart(3, '0')}`;
const RANGE = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => SCENE(a + i));

/**
 * ૧૨૦ live દ્રશ્યો, ૩ withheld, and ૩ that exist in `public.scenes` but never in the catalogue.
 *
 * The last three are the point of §B: `admin_withheld_scene_ids()` could already refuse a
 * withheld દ્રશ્ય, and could never refuse one it had simply never heard of. Two different
 * refusals, and only one of them existed before 0035.
 */
const LIVE = 120;
const WITHHELD = [SCENE(121), SCENE(122), SCENE(123)];
const FAKE = ['not-a-scene', 'darshan-999999', ''];

/** ૧ ગુણ per તિક, every તિક of every submission, no cap. The requirement's rule (§9). */
const RULES_ACCUMULATING = {
  enabled: true,
  level1: 100, level2: 200, level3: 300, level4: { default: 100 },
  tick: { mode: 'TICK', perTick: 1, perRevision: 0, dailyCap: 0 },
  earn: { level1: 'DAY_FIRST', level2: 'DAY_FIRST', level3: 'DAY_FIRST', level4: 'DAY_FIRST', tickCount: 'ALL' },
};

async function fixtures(db) {
  const people = [
    [U.arjun, 'ARJ101', 'Arjun'], [U.bhavesh, 'BHA102', 'Bhavesh'],
    [U.chirag, 'CHI103', 'Chirag'], [U.dhruv, 'DHR104', 'Dhruv'],
    [U.eshan, 'ESH105', 'Eshan'], [U.falgun, 'FAL106', 'Falgun'],
    [U.admin, 'ADM107', 'Sanchalak'],
  ];
  for (const [id, smk, name] of people) {
    await db.query('insert into auth.users (id, email) values ($1, $2)', [id, `${smk.toLowerCase()}@t.test`]);
    await db.query(
      `insert into public.profiles (id, smk, name, email, mobile, zone_id, sub_zone_id, status)
       values ($1, $2, $3, $4, $5, 'surat', 'varachha', 'ACTIVE')`,
      [id, smk, name, `${smk.toLowerCase()}@t.test`, `98111000${smk.slice(-2)}`]
    );
  }
  await db.query(
    `insert into public.admin_profiles (id, role, status) values ($1, 'SUPER_ADMIN', 'ACTIVE')`, [U.admin]);

  await db.query(
    `insert into public.scenes (id, "index", "order", active, caption)
     select 'd-' || lpad(g::text, 3, '0'), g, g, true, 'scene ' || g
     from generate_series(1, $1) g`, [LIVE + WITHHELD.length]);

  await db.query(
    `update public.scenes set active = false where id = any($1::text[])`, [WITHHELD]);
}

/**
 * Write settings['levels'].value through an ordinary upsert, so every trigger fires —
 * `settings_check_points` (0021, reissued 0031/0034) and `settings_check_pace` (0035) alike. A
 * configuration written past the triggers would be a configuration the app could never hold.
 *
 * The board's own block rides along because `leaderboard()` reads it from the same row, and a
 * `configure()` that wrote only `points` would switch the board off every time the rules moved.
 */
const BOARD = { enabled: true, periods: ['DAY', 'WEEK', 'MONTH', 'ALL'], defaultPeriod: 'ALL', topN: 10 };

const configure = (db, points) =>
  db.query(
    `insert into public.settings (key, value) values ('levels', $1::jsonb)
     on conflict (key) do update set value = excluded.value`,
    [JSON.stringify({ points, leaderboard: BOARD })]
  );

// ════════════════════════════════════════════════════════════════════ helpers

/** The യുവക's own RPCs, committed — a scenario needs its rows to survive to the next step. */
const rpc = (db, uid, sql, params = []) =>
  asUser(db, uid, async () => (await db.query(sql, params)).rows[0], { commit: true });

const draftSave = (db, uid, ids) =>
  rpc(db, uid, 'select public.level3_draft_save($1::text[]) r', [ids]).then((r) => r.r);

const finalize = (db, uid, token = null) =>
  rpc(db, uid, 'select public.level3_finalize($1::uuid) r', [token]).then((r) => r.r);

const reset = (db, uid, token = null) =>
  rpc(db, uid, 'select public.level3_reset($1::uuid) r', [token]).then((r) => r.r);

const snapshot = (db, uid) =>
  rpc(db, uid, 'select public.my_level3_summary() r').then((r) => r.r);

/** Every લેવલ ૩ ledger row this યુવક has, oldest first. */
const l3Ledger = async (db, uid) => (await db.query(
  `select points, award_kind, activity_key, idempotency_key
   from public.point_transactions
   where user_id = $1 and level_id = 3 order by id`, [uid])).rows;

const l3Points = async (db, uid) => Number((await db.query(
  `select coalesce(sum(points), 0)::int p from public.point_transactions
   where user_id = $1 and level_id = 3`, [uid])).rows[0].p);

const allPoints = async (db, uid) => Number((await db.query(
  `select coalesce(sum(points), 0)::int p from public.point_transactions where user_id = $1`,
  [uid])).rows[0].p);

/**
 * Pretend `seconds` of attention have passed, then let the real save measure them.
 *
 * The gap is what `level3_draft_save()` reads off its own clock, so moving `updated_at` back is
 * indistinguishable — to the function under test — from the yuvak having sat there that long.
 */
async function spend(db, uid, seconds, ids) {
  await db.query(
    `update public.level3_drafts set updated_at = now() - make_interval(secs => $2) where user_id = $1`,
    [uid, seconds]);
  return draftSave(db, uid, ids);
}

// ════════════════════════════════════════════════════════════════════ the suite

async function main() {
  if (!dockerAvailable()) {
    console.log('docker is not available — skipping (this suite needs a real Postgres).');
    process.exit(0);
  }

  const { client: db, stop } = await startDatabase();

  try {
    await fixtures(db);

    // ─────────────────────────────────────────────────────────────────────
    group('§A  0035 built what it claims to have built');

    const objs = (await db.query(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname in
         ('level3_draft_get','level3_draft_save','level3_commit','level3_finalize','level3_reset',
          'level3_snapshot','my_level3_summary','point_pace','live_scene_ids','scene_catalog_ready',
          'scene_catalog_sync','admin_level3_report','admin_user_level3_detail',
          'daily_activity_progress_recount','activity_attempts_level3_award')
       order by 1`)).rows.map((r) => r.proname);
    eq('every function exists', objs.length, 15);

    eq('activity_attempts gained engaged_ms', (await db.query(
      `select data_type from information_schema.columns
       where table_name='activity_attempts' and column_name='engaged_ms'`)).rows[0]?.data_type, 'bigint');

    eq('the partial-award trigger is on activity_attempts', (await db.query(
      `select tgname from pg_trigger where tgrelid = 'public.activity_attempts'::regclass
         and tgname = 'activity_attempts_level3_award'`)).rows.length, 1);

    // Field by field, because `jsonb` does not preserve key order and comparing two serialised
    // objects would be asserting on Postgres's internal sort rather than on the values.
    const pace0 = (await db.query('select public.point_pace() p')).rows[0].p;
    eq('an unconfigured project has no pace rule',
      [pace0.secondsPerTick, pace0.graceSeconds, pace0.maxGapSeconds], [0, 0, 180]);

    ok('the draft table is readable only by its owner, never writable',
      (await db.query(
        `select cmd from pg_policies where tablename = 'level3_drafts'`)).rows
        .every((r) => r.cmd === 'SELECT'));

    eq('a યુવક cannot write a draft directly, which is what makes the clock unforgeable',
      (await db.query(
        `select count(*)::int n from information_schema.role_table_grants
         where table_name='level3_drafts' and grantee='authenticated'
           and privilege_type in ('INSERT','UPDATE','DELETE')`)).rows[0].n, 0);

    // ─────────────────────────────────────────────────────────────────────
    group('§B  the fault everything was downstream of: a partial પુનરાવર્તન is now paid');

    await configure(db, RULES_ACCUMULATING);

    await draftSave(db, U.arjun, RANGE(1, 50));
    const first = await finalize(db, U.arjun);

    eq('CASE 1 — ૫૦ ticks of ૧૨૦ earns ૫૦', Number(first.awarded), 50);
    eq('        and the attempt was recorded as partial, which is why 0021 paid it nothing',
      (await db.query(
        `select status from public.activity_attempts where user_id=$1 and level_id=3`, [U.arjun]
      )).rows[0].status, 'REVISION_REQUIRED');
    eq('        one ledger row, kind TICK, keyed on the attempt',
      (await l3Ledger(db, U.arjun)).map((r) => [Number(r.points), r.award_kind]), [[50, 'TICK']]);

    // ─────────────────────────────────────────────────────────────────────
    group('§C  the requirement\'s worked example, in full — ૫૦ + ૪૦ + ૩૦ = ૧૨૦');

    const afterFirst = await snapshot(db, U.arjun);
    eq('CASE 2 — after finalising, the board is empty', Number(afterFirst.current.ticks), 0);
    eq('        and the cumulative total is untouched by the emptying',
      Number(afterFirst.total.points), 50);
    eq('        one પુનરાવર્તન stands in the history', Number(afterFirst.total.revisions), 1);

    await draftSave(db, U.arjun, RANGE(1, 40));
    const second = await finalize(db, U.arjun);
    eq('CASE 3 — a second પુનરાવર્તન of ૪૦ earns ૪૦', Number(second.awarded), 40);
    eq('        cumulative is ૫૦ + ૪૦ = ૯૦', await l3Points(db, U.arjun), 90);

    await draftSave(db, U.arjun, RANGE(1, 30));
    const third = await finalize(db, U.arjun);
    eq('CASE 4 — a third પુનરાવર્તન of ૩૦ earns ૩૦', Number(third.awarded), 30);
    eq('        cumulative is ૯૦ + ૩૦ = ૧૨૦', await l3Points(db, U.arjun), 120);

    // The same દ્રશ્યો every time. Under FRESH this would be ૫૦ and then nothing at all; under
    // ALL it is the સાધના repeated, which is what the requirement asks to be counted.
    eq('        the second and third named the SAME દ્રશ્યો and were still paid in full',
      (await l3Ledger(db, U.arjun)).map((r) => Number(r.points)), [50, 40, 30]);

    const arjun = await snapshot(db, U.arjun);
    eq('CASE 15 — three પુનરાવર્તન in the history', Number(arjun.total.revisions), 3);
    eq('         total ticks is the SUM ૫૦+૪૦+૩૦ and never the union',
      Number(arjun.total.ticks), 120);
    eq('         and the current board still reads ૦, which is a different number entirely',
      Number(arjun.current.ticks), 0);
    eq('         today lists all three, newest first',
      arjun.revisions.map((r) => Number(r.ticks)), [30, 40, 50]);

    // ─────────────────────────────────────────────────────────────────────
    group('§D  idempotency is the database\'s, not React\'s');

    await draftSave(db, U.bhavesh, RANGE(1, 20));
    const tok = '11111111-2222-4333-8444-555555555555';
    const b1 = await finalize(db, U.bhavesh, tok);
    const b2 = await finalize(db, U.bhavesh, tok);

    eq('CASE 5 — the first submit earns ૨૦', Number(b1.awarded), 20);
    eq('        the same token again earns nothing more', await l3Points(db, U.bhavesh), 20);
    eq('        and wrote exactly one ledger row', (await l3Ledger(db, U.bhavesh)).length, 1);
    eq('        and exactly one પુનરાવર્તન', Number((await snapshot(db, U.bhavesh)).total.revisions), 1);
    ok('        the replay returned the same attempt', j(b1.attemptId) === j(b2.attemptId));

    // Pressing નોંધાવો twice with nothing ticked cannot invent a second પુનરાવર્તન, because the
    // first press emptied the draft. This is the second of the three defences.
    await finalize(db, U.bhavesh, '99999999-2222-4333-8444-555555555555');
    eq('        finalising an empty draft records nothing',
      Number((await snapshot(db, U.bhavesh)).total.revisions), 1);

    // ─────────────────────────────────────────────────────────────────────
    group('§E  the catalogue — the check activity_submit() said it could not make');

    eq('before a sync the catalogue is empty and checks nothing',
      (await db.query('select public.scene_catalog_ready() r')).rows[0].r, false);

    // Invented ids are paid for while the catalogue is empty — stated here rather than hidden,
    // because it is exactly the state a project is in between applying 0035 and running the
    // sync, and `admin_content_total()` is what stops it being unbounded.
    await draftSave(db, U.dhruv, [...RANGE(1, 10), ...FAKE]);
    const dhruvPre = await finalize(db, U.dhruv);
    eq('an unsynced project counts what it always counted (blanks aside)',
      Number(dhruvPre.awarded), 12);

    await asUser(db, U.admin, async () => {
      await db.query(
        `select public.scene_catalog_sync($1::jsonb)`,
        [JSON.stringify(RANGE(1, LIVE + WITHHELD.length).map((id, i) => ({ id, index: i + 1 })))]);
    }, { commit: true });

    eq('after the sync the catalogue is ready',
      (await db.query('select public.scene_catalog_ready() r')).rows[0].r, true);
    eq('and live_scene_ids() is the catalogue minus the withheld',
      Number((await db.query('select cardinality(public.live_scene_ids()) n')).rows[0].n), LIVE);

    await draftSave(db, U.bhavesh, [...RANGE(1, 30), ...FAKE, ...WITHHELD]);
    const b3 = await finalize(db, U.bhavesh);
    eq('CASE 6 — invented ids and withheld દ્રશ્યો are both refused; only the ૩૦ real ones pay',
      Number(b3.awarded), 30);

    const refused = await asUser(db, U.admin, async () => {
      try { await db.query(`select public.scene_catalog_sync('[]'::jsonb)`); return 'accepted'; }
      catch (e) { return e.code; }
    });
    eq('an empty sync payload is refused, because accepting it stops every તિક being paid',
      refused, '23514');

    const forbidden = await asUser(db, U.arjun, async () => {
      try { await db.query(`select public.scene_catalog_sync('[{"id":"x"}]'::jsonb)`); return 'accepted'; }
      catch (e) { return e.code; }
    });
    eq('a યુવક may not sync the catalogue', forbidden, '42501');

    // ─────────────────────────────────────────────────────────────────────
    group('§F  the pace rule — "૫૦ ટિક માટે ૫૦ સેકંડ", measured by this database');

    await configure(db, { ...RULES_ACCUMULATING, pace: { secondsPerTick: 1, graceSeconds: 0 } });

    // The clock accumulates across saves, and only the real function ever writes it.
    await draftSave(db, U.chirag, RANGE(1, 10));
    await spend(db, U.chirag, 30, RANGE(1, 30));
    await spend(db, U.chirag, 20, RANGE(1, 50));
    const paced = await snapshot(db, U.chirag);
    eq('fifty seconds of attention accumulated', Math.round(Number(paced.current.engagedMs) / 1000), 50);
    eq('and the page can say what that is worth before he presses anything',
      Number(paced.current.eligibleTicks), 50);

    const c1 = await finalize(db, U.chirag);
    eq('૫૦ ticks over ૫૦ seconds earns ૫૦', Number(c1.awarded), 50);

    // A યુવક who was half a minute quick loses half a minute, not everything. This is the whole
    // argument for a cap over a gate.
    await draftSave(db, U.chirag, RANGE(1, 10));
    await spend(db, U.chirag, 45, RANGE(1, 50));
    eq('૫૦ ticks over ૪૫ seconds earns ૪૫, not zero', Number((await finalize(db, U.chirag)).awarded), 45);

    // The case the requirement actually described: scrolling to the bottom to reach the next page.
    await draftSave(db, U.chirag, RANGE(1, 10));
    await spend(db, U.chirag, 12, RANGE(1, 108));
    eq('૧૦૮ ticks flicked past in ૧૨ seconds earns ૧૨',
      Number((await finalize(db, U.chirag)).awarded), 12);
    eq('        but all ૧૦૮ are still recorded — the સાધના is not erased, only unpaid',
      Number((await db.query(
        `select cardinality(selected_scene_ids) n from public.activity_attempts
         where user_id=$1 order by id desc limit 1`, [U.chirag])).rows[0].n), 108);

    // A phone left open on a bus adds nothing.
    await draftSave(db, U.chirag, RANGE(1, 10));
    const before = Number((await snapshot(db, U.chirag)).current.engagedMs);
    await spend(db, U.chirag, 4000, RANGE(1, 20));
    eq('a gap longer than maxGapSeconds counts as no attention at all',
      Number((await snapshot(db, U.chirag)).current.engagedMs), before);

    await configure(db, RULES_ACCUMULATING);
    await draftSave(db, U.chirag, RANGE(1, 10));
    await spend(db, U.chirag, 2, RANGE(1, 60));
    eq('with no pace rule configured nothing is capped, which is every project today',
      Number((await finalize(db, U.chirag)).awarded), 60);

    // ─────────────────────────────────────────────────────────────────────
    group('§G  the draft survives a refresh, and the day, and never becomes a second event');

    await configure(db, RULES_ACCUMULATING);
    await draftSave(db, U.falgun, RANGE(1, 50));

    const restored = await snapshot(db, U.falgun);
    eq('CASE 7 — an unfinished પુનરાવર્તન comes back with its ૫૦ ticks', Number(restored.current.ticks), 50);
    eq('        and has earned nothing, because nothing was finished', await l3Points(db, U.falgun), 0);

    // The app was closed across midnight. The ticks belong to the day they were made.
    await db.query(
      `update public.level3_drafts set activity_date = activity_date - 1 where user_id = $1`, [U.falgun]);
    const rolled = await rpc(db, U.falgun, 'select public.level3_draft_get() r').then((r) => r.r);

    eq('CASE 8 — the new day starts empty', Number(rolled.current.ticks), 0);
    eq('        yesterday\'s ૫૦ were finished against yesterday, not discarded and not re-dated',
      await l3Points(db, U.falgun), 50);
    eq('        and filed under yesterday\'s date', (await db.query(
      `select activity_date = (timezone('Asia/Kolkata', now())::date - 1) y
       from public.activity_attempts where user_id=$1 and level_id=3`, [U.falgun])).rows[0].y, true);

    // ─────────────────────────────────────────────────────────────────────
    group('§H  a reset saves; it never deletes (§3, §11 — the sentence that matters most)');

    await draftSave(db, U.dhruv, RANGE(1, 25));
    const beforeReset = await l3Points(db, U.dhruv);
    const afterReset = await reset(db, U.dhruv);

    eq('CASE 9 — the ticks standing at the moment of the reset were finished and paid',
      await l3Points(db, U.dhruv), beforeReset + 25);
    eq('        the board is now empty', Number(afterReset.current.ticks), 0);
    ok('        and no attempt or ledger row was removed by it',
      (await l3Ledger(db, U.dhruv)).length >= 2);

    // The લેવલ ૪ gate reads `progress.level3_score` and nothing else, and this path writes no
    // attempt through activity_submit() — so if level3_commit() did not keep the column in step,
    // a યુવક could finish પુનરાવર્તન all day and never open લેવલ ૪.
    eq('        and the day\'s score was kept in step, so લેવલ ૪ still opens on finishing',
      Number((await db.query(
        `select level3_score from public.progress
         where user_id = $1 and date = timezone('Asia/Kolkata', now())::date`,
        [U.arjun])).rows[0]?.level3_score), 50);

    // It is the day's DISTINCT દ્રશ્યો and not the additive total: crossing a threshold of ૮૦ by
    // ticking the same ૪૦ twice is not "એક જ દિવસમાં ૮૦ દ્રશ્યો યાદ કરો".
    ok('        counted as the day\'s distinct દ્રશ્યો, never as the additive તિક total',
      Number((await db.query(
        `select level3_score from public.progress
         where user_id = $1 and date = timezone('Asia/Kolkata', now())::date`,
        [U.arjun])).rows[0]?.level3_score) < 120);

    // ─────────────────────────────────────────────────────────────────────
    group('§I  the board and the સંચાલક read the same ledger the yuvak does');

    // As a signed-in યુવક, because that is the only way `leaderboard()` can be called — it
    // raises `leaderboard_not_signed_in` for anybody else, and its whole privacy contract
    // (0023:389-392) is built on knowing who is asking.
    const board = await asUser(db, U.arjun, async () =>
      (await db.query(`select public.leaderboard('ALL') r`)).rows[0].r);
    const row = (name) => board.rows.find((r) => r.name === name);

    eq('CASE 11/12 — Arjun\'s ૧૨૦ is on the board', Number(row('Arjun')?.points), 120);
    eq('           and it is the cumulative figure, not the empty current board',
      Number(row('Arjun')?.points), await allPoints(db, U.arjun));
    ok('           Dhruv is on it too, with his own total',
      Number(row('Dhruv')?.points) === await allPoints(db, U.dhruv));

    const report = await asUser(db, U.admin, async () => (await db.query(
      `select * from public.admin_level3_report($1::uuid[])`, [[U.arjun]])).rows[0]);

    eq('CASE 10 — the report gives the સંચાલક the પુનરાવર્તન count', Number(report.revisions), 3);
    eq('        the additive tick total', Number(report.ticks), 120);
    eq('        the distinct દ્રશ્યો, which is a different and also true number',
      Number(report.scenes_distinct), 50);
    eq('        and the points, from the ledger', Number(report.points), 120);
    eq('        today\'s figures are separated out', Number(report.today_points), 120);

    const detail = await asUser(db, U.admin, async () => (await db.query(
      `select public.admin_user_level3_detail($1::uuid) r`, [U.arjun])).rows[0].r);

    eq('        the detail lists every પુનરાવર્તન', detail.revisions.length, 3);
    eq('        each with what it earned, so the total can be seen to add up',
      detail.revisions.map((r) => Number(r.points)).sort((a, b) => a - b), [30, 40, 50]);
    eq('        and rolls the day up: ૫૦ + ૪૦ + ૩૦ = ૧૨૦',
      detail.days.map((d) => Number(d.points)), [120]);

    // ── §29's report: the questions a સંચાલક actually asks ──────────────────
    const ask = (args = {}) => asUser(db, U.admin, async () => (await db.query(
      `select * from public.admin_level3_users(
         p_active := $1::boolean, p_min_points := $2::int, p_min_ticks := $3::int,
         p_min_revs := $4::int, p_page_size := 200)`,
      [args.active ?? null, args.minPoints ?? null, args.minTicks ?? null, args.minRevs ?? null]
    )).rows);

    const names = (rows) => rows.map((r) => r.name).sort();

    ok('§29 — "who has 50+ Level 3 points" names Arjun',
      names(await ask({ minPoints: 50 })).includes('Arjun'));
    eq('        and excludes everyone below the line',
      (await ask({ minPoints: 50 })).every((r) => Number(r.points) >= 50), true);

    ok('        "who did Level 3 today" is answerable',
      (await ask({ active: true })).every((r) => Number(r.today_revisions) > 0));

    // The one that cannot be written as a minimum: a યુવક with no attempt has no row to fail a
    // test, so this only works because the report LEFT JOINs from profiles.
    const idle = await ask({ active: false });
    ok('        and "who did NOT do Level 3 today" names Eshan, who has never touched it',
      names(idle).includes('Eshan'));
    eq('        with every one of them at zero for the day',
      idle.every((r) => Number(r.today_revisions) === 0), true);

    const heavy = names(await ask({ minTicks: 100 }));
    ok('        "more than 100 cumulative ticks" names Arjun and not Bhavesh',
      heavy.includes('Arjun') && !heavy.includes('Bhavesh'));

    ok('        "two or more revisions" excludes the yuvak who has done one',
      (await ask({ minRevs: 2 })).every((r) => Number(r.revisions) >= 2));

    eq('        the page carries its own total, so the pager can say "of N"',
      (await ask({})).every((r) => Number(r.total_rows) > 0), true);

    const reportDenied = await asUser(db, U.arjun, async () => {
      try { await db.query(`select * from public.admin_level3_users()`); return 'allowed'; }
      catch (e) { return e.code; }
    });
    eq('        and a યુવક may not run it at all', reportDenied, '42501');

    const denied = await asUser(db, U.arjun, async () => {
      try { await db.query(`select public.admin_user_level3_detail($1::uuid)`, [U.dhruv]); return 'allowed'; }
      catch (e) { return e.code; }
    });
    eq('        and a યુવક cannot read another યુવક\'s history', denied, '42501');

    eq('        nor another યુવક\'s draft', (await asUser(db, U.arjun, async () => (await db.query(
      `select count(*)::int n from public.level3_drafts where user_id <> $1`, [U.arjun])).rows[0].n)), 0);

    eq('        and nobody signed out may even look at the table', await asAnon(db, async () => {
      try { await db.query(`select count(*) from public.level3_drafts`); return 'allowed'; }
      catch (e) { return e.code; }
    }), '42501');

    // ─────────────────────────────────────────────────────────────────────
    group('§J  /daily can no longer claw back an accumulated લેવલ ૩');

    // Falgun has ૫૦ from yesterday. Give him a second day so the reconciliation has a live day
    // to work on, then fill in the form the way the screen does.
    await draftSave(db, U.falgun, RANGE(1, 60));
    await finalize(db, U.falgun);
    await draftSave(db, U.falgun, RANGE(1, 20));
    await finalize(db, U.falgun);

    const l3Today = Number((await db.query(
      `select coalesce(sum(points),0)::int p from public.point_transactions
       where user_id=$1 and level_id=3 and activity_date = timezone('Asia/Kolkata', now())::date`,
      [U.falgun])).rows[0].p);
    eq('two પુનરાવર્તન today are worth ૬૦ + ૨૦ = ૮૦', l3Today, 80);

    const saved = await rpc(db, U.falgun,
      `select public.daily_record_save(null, $1::jsonb, null) r`,
      [JSON.stringify([{ level: 2, activity: 'darshan', count: 1 }])]).then((r) => r.r);

    eq('CASE 13 — saving the daily record leaves લેવલ ૩ exactly where it was',
      Number((await db.query(
        `select coalesce(sum(points),0)::int p from public.point_transactions
         where user_id=$1 and level_id=3 and activity_date = timezone('Asia/Kolkata', now())::date`,
        [U.falgun])).rows[0].p), 80);

    eq('        no negative DAILY_ADJUST was written against it', (await db.query(
      `select coalesce(min(points), 0)::int p from public.point_transactions
       where user_id=$1 and award_kind='DAILY_ADJUST'`, [U.falgun])).rows[0].p >= 0, true);

    // 0034's guarantee, restated: the record's total is the day's ledger sum. It has to survive
    // 0035 or the daily record starts disagreeing with history and the board.
    const dayLedger = Number((await db.query(
      `select coalesce(sum(points),0)::int p from public.point_transactions
       where user_id=$1 and activity_date = timezone('Asia/Kolkata', now())::date`,
      [U.falgun])).rows[0].p);
    eq('        and 0034\'s guarantee holds: the record\'s total IS the day\'s ledger sum',
      Number(saved.totalPoints ?? saved.total_points ?? -1), dayLedger);

    // CASE 14 — the window still closes.
    //
    // `edit_until` is immutable on every path through `daily_record_guard()`, deliberately: a
    // save that could move it would be a save that extended its own window (0034:1540-1543). So
    // the only way to reach a closed window without waiting twenty-four hours is to step around
    // the trigger as the owner, which is what test-point-engine.mjs does to `settings` for the
    // same reason. Re-enabled immediately, so the rule under test is the real one.
    await db.query('alter table public.daily_activity_records disable trigger daily_record_guard');
    await db.query(
      `update public.daily_activity_records
          set first_submitted_at = now() - interval '25 hours',
              edit_until         = now() - interval '1 hour'
        where user_id = $1`, [U.falgun]);
    await db.query('alter table public.daily_activity_records enable trigger daily_record_guard');
    const locked = await asUser(db, U.falgun, async () => {
      try {
        await db.query(`select public.daily_record_save(null, $1::jsonb, null)`,
          [JSON.stringify([{ level: 2, activity: 'darshan', count: 2 }])]);
        return 'accepted';
      } catch (e) { return 'refused'; }
    });
    eq('CASE 14 — an edit after twenty-four hours is still refused', locked, 'refused');

    // ─────────────────────────────────────────────────────────────────────
    group('§K  nothing else moved — levels ૧, ૨ and ૪, and an unconfigured લેવલ ૩');

    const l1 = await rpc(db, U.eshan,
      `select public.activity_submit(1, 'video', '{}'::text[], 0, null) r`).then((r) => r.r);
    const l2 = await rpc(db, U.eshan,
      `select public.activity_submit(2, 'darshan', '{}'::text[], 0, null) r`).then((r) => r.r);

    eq('લેવલ ૧ still pays its flat value once a day', Number(l1.pointsAwarded), 100);
    eq('લેવલ ૨ still pays its flat value once a day', Number(l2.pointsAwarded), 200);
    eq('and a second દર્શન on the same day still pays nothing under DAY_FIRST',
      Number((await rpc(db, U.eshan,
        `select public.activity_submit(2, 'darshan', '{}'::text[], 0, null) r`).then((r) => r.r)).pointsAwarded), 0);

    // The one that would be a real regression: under ACTIVITY mode — what every unconfigured
    // project runs — a partial પુનરાવર્તન must go on earning nothing. 0035's trigger is gated on
    // the tick mode precisely so that applying it changes no project's arithmetic.
    await configure(db, {
      enabled: true, level1: 100, level2: 200, level3: 300, level4: { default: 100 },
      tick: { mode: 'ACTIVITY', perTick: 0, perRevision: 0, dailyCap: 0 },
    });

    const before5 = await l3Points(db, U.eshan);
    await rpc(db, U.eshan,
      `select public.activity_submit(3, 'revision', $1::text[], 120, null) r`, [RANGE(1, 5)]);
    eq('under ACTIVITY mode a partial પુનરાવર્તન still earns nothing, exactly as before 0035',
      await l3Points(db, U.eshan), before5);

    await rpc(db, U.eshan,
      `select public.activity_submit(3, 'revision', $1::text[], $2::int, null) r`,
      [RANGE(1, LIVE), LIVE]);
    eq('and a complete one still earns the flat day value', await l3Points(db, U.eshan), before5 + 300);

    // ─────────────────────────────────────────────────────────────────────
    group('§L  the pace block is validated before it is stored');

    for (const [label, pace, expected] of [
      ['a whole number of seconds is accepted', { secondsPerTick: 2 }, 'accepted'],
      ['a fraction is refused', { secondsPerTick: 1.5 }, '23514'],
      ['a negative is refused', { secondsPerTick: -1 }, '23514'],
      ['an unknown key is refused', { secondsPerTick: 1, wobble: 3 }, '23514'],
      ['a string is refused', { secondsPerTick: 'fast' }, '23514'],
      ['maxGapSeconds below its floor is refused', { maxGapSeconds: 1 }, '23514'],
    ]) {
      const got = await (async () => {
        try { await configure(db, { ...RULES_ACCUMULATING, pace }); return 'accepted'; }
        catch (e) { return e.code; }
      })();
      eq(label, got, expected);
    }
  } finally {
    await stop();
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('\nfailures:');
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
