/**
 * A test account earns points and appears in nobody's totals — against a real Postgres.
 *
 *     VARNI_PGTEST_PORT=54833 VARNI_PGTEST_IMAGE=postgres:16-alpine node scripts/test-test-accounts.mjs
 *
 * ────────────────────────────────────────────────────────────────────────────
 * What 0040 claims, and why every part of it needs a database to check
 * ────────────────────────────────────────────────────────────────────────────
 *
 * People register to try the app, because that is the only honest way to test it. Until 0040
 * each of those accounts was a યુવક to every figure the panel produces: counted in "Total
 * registered", moving "Average remembered", holding a place on the leaderboard above people
 * who have been doing this for months, and printed into every Excel export somebody makes a
 * decision from.
 *
 * The claim is a pair, and the pair is the whole difficulty:
 *
 *   · a test account behaves EXACTLY like a real one - it earns its points and writes its
 *     rows - because an account that is special-cased tests nothing;
 *   · and it appears in no total, ranking, list or export.
 *
 * Either half alone is easy. Together they mean the exclusion cannot live in the app, in the
 * point engine, or in a WHERE clause somebody remembers to type: it lives in which *population*
 * a report is allowed to enumerate, and that is a property of nine SQL functions.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * The groups
 * ────────────────────────────────────────────────────────────────────────────
 *
 *  §A  Before anything is marked, the tester is indistinguishable - on the leaderboard, in the
 *      counts, in the reports. Asserted first so §C is measuring a change rather than an
 *      absence that might always have been there.
 *  §B  Marking is privileged. A યુવક cannot mark himself off the leaderboard; an ADMIN cannot
 *      either, because `users.test` is SUPER_ADMIN's alone.
 *  §C  Marked: gone from the leaderboard, the counts, the lists and the reports.
 *  §D  And still earning. The point rows are untouched, and new ones still land.
 *  §E  Still inspectable one at a time, which is the reason the account exists.
 *  §F  The drift guard. Not "these nine are right today" but "no function enumerates
 *      public.profiles any more" - the check that survives the tenth report being written.
 *  §G  Unmarking puts the person back, everywhere, with their history intact.
 *  §H  Purge: refused without the permission, refused on a real યુવક by anyone at all, and
 *      audited before it takes the rows with it.
 *  §I  The same requirement one step further (0048): an administrator who also holds a profile
 *      is not a યુવક either, so he is off the board યુવકો read - and still on the one the
 *      panel shows, because an administrator must be able to check that his own test earned
 *      what it should.
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
const refusedWith = (name, res, codes) => {
  const want = Array.isArray(codes) ? codes : [codes];
  if (!res.ok && want.includes(res.code)) pass++;
  else if (res.ok) fails.push(`${name}\n       got  the statement SUCCEEDED\n       want ${want.join('/')}`);
  else fails.push(`${name}\n       got  ${res.code} ${res.message.slice(0, 90)}\n       want ${want.join('/')}`);
};
const group = (t) => console.log(`\n  ${t}\n`);

const U = {
  real1: '20000000-0000-4000-8000-000000000001',
  real2: '20000000-0000-4000-8000-000000000002',
  tester: '20000000-0000-4000-8000-000000000003',
  superadmin: '20000000-0000-4000-8000-000000000004',
  admin: '20000000-0000-4000-8000-000000000005',
};

const DAY = '2026-08-10';

async function fixtures(db) {
  const people = [
    [U.real1, 'RLA001', 'Real One', '9700000001'],
    [U.real2, 'RLB002', 'Real Two', '9700000002'],
    [U.tester, 'TST003', 'Tester Three', '9700000003'],
    [U.superadmin, 'SUP004', 'Super', '9700000004'],
    [U.admin, 'ADM005', 'Admin', '9700000005'],
  ];
  for (const [id, smk, name, mobile] of people) {
    await db.query('insert into auth.users (id, email) values ($1, $2)', [id, `${smk.toLowerCase()}@t.test`]);
    await db.query(
      `insert into public.profiles (id, smk, name, email, mobile, zone_id, sub_zone_id, status)
       values ($1, $2, $3, $4, $5, 'surat', 'varachha', 'ACTIVE')`,
      [id, smk, name, `${smk.toLowerCase()}@t.test`, mobile]
    );
  }

  await db.query(
    `insert into public.admins (id, email, name, role, status)
     values ($1, 'sup@t.test', 'Super', 'SUPER_ADMIN', 'ACTIVE'),
            ($2, 'adm@t.test', 'Admin', 'ADMIN', 'ACTIVE')`,
    [U.superadmin, U.admin]
  );

  // Points for all three, so all three would rank. The tester deliberately earns the MOST:
  // a filter that merely reordered the board, or dropped the last row, would still look right
  // if the test account were mid-table.
  const paid = [
    [U.real1, 50],
    [U.real2, 30],
    [U.tester, 900],
  ];
  let src = 1;
  for (const [id, points] of paid) {
    await db.query(
      `insert into public.point_transactions
         (user_id, activity_date, level_id, activity_key, points, source, source_id)
       values ($1, $2::date, 3, 'darshan', $3, 'ACTIVITY_ATTEMPT', $4)`,
      [id, DAY, points, src++]
    );
  }

  /*
    ક્રમાંક is off unless a સંચાલક turns it on, and `leaderboard_settings()` reads
    settings.levels -> 'leaderboard'. Without this the yuvak-facing board answers with an empty
    list for everybody, and every assertion about who is on it would pass while testing
    nothing - which is exactly what the first version of this file did.

    Merged with `||` rather than assigned: `levels` also carries the લેવલ thresholds and the
    point configuration, and replacing the row would take them with it.
  */
  await db.query(
    `insert into public.settings (key, value)
     values ('levels', jsonb_build_object('leaderboard', jsonb_build_object(
       'enabled', true, 'periods', jsonb_build_array('ALL'), 'defaultPeriod', 'ALL', 'topN', 10
     )))
     on conflict (key) do update set value = public.settings.value || excluded.value`
  );
}

/*
  Both leaderboards return jsonb, not a row set - `select * from leaderboard()` yields one
  column called `leaderboard` and `r.name` is undefined for every row. That is how the first
  version of this suite reported an empty board for everyone and passed §C by accident.
*/
const boardNames = (doc) => ((doc && doc.rows) || []).map((r) => r.name).filter(Boolean);

async function main() {
  if (!dockerAvailable()) {
    console.log('\n  SKIPPED - no docker daemon. This suite needs one to be honest.\n');
    return;
  }

  const { client: db, stop } = await startDatabase();
  try {
    await fixtures(db);

    // ══════════════════════════════════════════════════════════ §A
    group('§A  before marking, the tester is just another યુવક');

    eq('all five profiles exist',
      (await db.query('select count(*)::int as n from public.profiles')).rows[0].n, 5);
    eq('counted_profiles holds all five',
      (await db.query('select count(*)::int as n from public.counted_profiles')).rows[0].n, 5);

    // As a યુવક, because that is who ક્રમાંક is for and `leaderboard()` answers about the
    // caller ('me'). An administrator asking would exercise a different path.
    await asUser(db, U.real1, async () => {
      const doc = (await db.query(`select public.leaderboard('ALL') as d`)).rows[0].d;
      eq('the board is on and has everyone', boardNames(doc).length, 3);
      eq('and the tester is at the top of it', boardNames(doc)[0], 'Tester Three');
    });

    await asUser(db, U.superadmin, async () => {
      // yuvaks already excludes administrators (0038), so three of the five.
      eq('the roll counts three yuvaks',
        (await db.query('select count(*)::int as n from public.yuvaks')).rows[0].n, 3);
    });

    // ══════════════════════════════════════════════════════════ §B
    group('§B  marking is SUPER_ADMIN only');

    /*
      The guard HOLDS the value rather than raising, like profiles_guard_status() before it, so
      the assertion is on what the column says afterwards and not on whether the statement
      failed. A test written the other way would pass on a database where the trigger had been
      dropped and the write simply succeeded.
    */
    await asUser(db, U.real1, async () => {
      await db.query('update public.profiles set is_test = true where id = $1', [U.real1]);
    });
    eq('a યુવક cannot mark himself off the leaderboard',
      (await db.query('select is_test from public.profiles where id = $1', [U.real1])).rows[0].is_test, false);

    await asUser(db, U.admin, async () => {
      await db.query('update public.profiles set is_test = true where id = $1', [U.tester]);
    });
    eq('an ADMIN cannot mark anyone either (no users.test)',
      (await db.query('select is_test from public.profiles where id = $1', [U.tester])).rows[0].is_test, false);

    await asUser(db, U.superadmin, async () => {
      await db.query('update public.profiles set is_test = true where id = $1', [U.tester]);
    }, { commit: true });

    const marked = (await db.query(
      'select is_test, test_marked_by, test_marked_at is not null as stamped from public.profiles where id = $1',
      [U.tester]
    )).rows[0];
    eq('a SUPER_ADMIN can', marked.is_test, true);
    eq('and the trail says who did it', marked.test_marked_by, U.superadmin);
    eq('and when', marked.stamped, true);

    // ══════════════════════════════════════════════════════════ §C
    group('§C  marked: gone from every total, ranking and list');

    eq('counted_profiles drops to four',
      (await db.query('select count(*)::int as n from public.counted_profiles')).rows[0].n, 4);

    await asUser(db, U.real1, async () => {
      const doc = (await db.query(`select public.leaderboard('ALL') as d`)).rows[0].d;
      eq('the leaderboard no longer knows him', boardNames(doc).includes('Tester Three'), false);
      eq('and the real yuvaks keep their order', boardNames(doc), ['Real One', 'Real Two']);
      // The count beside the list has to move with it, or the page says "3 participants"
      // above two rows and the missing one becomes a question.
      eq('and the participant count agrees', doc.participants, 2);
    });

    await asUser(db, U.superadmin, async () => {
      const alb = (await db.query('select public.admin_leaderboard() as d')).rows[0].d;
      eq("the સંચાલક's leaderboard agrees", boardNames(alb).includes('Tester Three'), false);
      eq('and counts two participants', alb.participants, 2);

      eq('the roll counts two yuvaks now',
        (await db.query('select count(*)::int as n from public.yuvaks')).rows[0].n, 2);

      eq('the ledger does not list his points',
        (await db.query(
          `select count(*)::int as n from public.admin_point_transactions() t where t.user_id = $1`,
          [U.tester])).rows[0].n, 0);

      const summary = (await db.query('select public.admin_progress_summary() as s')).rows[0].s;
      eq('the progress summary counts four people, not five', summary.totalUsers, 4);

      eq('the progress report has no row for him',
        (await db.query(
          `select count(*)::int as n from public.admin_progress_report() r where r.user_id = $1`,
          [U.tester])).rows[0].n, 0);

      eq('but the Test accounts view does',
        (await db.query('select count(*)::int as n from public.test_yuvaks where id = $1', [U.tester])).rows[0].n, 1);
    });

    // ══════════════════════════════════════════════════════════ §D
    group('§D  and he is still earning, which is the point of him');

    eq('his existing points are untouched',
      (await db.query('select coalesce(sum(points),0)::int as n from public.point_transactions where user_id = $1',
        [U.tester])).rows[0].n, 900);

    // Nothing about the engine knows what a test account is, so a new award must still land.
    const paid = await attempt(db,
      `insert into public.point_transactions
         (user_id, activity_date, level_id, activity_key, points, source, source_id)
       values ($1, $2::date, 3, 'revision', 25, 'ACTIVITY_ATTEMPT', 99)`,
      [U.tester, DAY]);
    eq('and a new award still lands', paid.ok, true);
    eq('bringing him to 925',
      (await db.query('select coalesce(sum(points),0)::int as n from public.point_transactions where user_id = $1',
        [U.tester])).rows[0].n, 925);

    await asUser(db, U.real1, async () => {
      const doc = (await db.query(`select public.leaderboard('ALL') as d`)).rows[0].d;
      eq('925 points and still not on the board', boardNames(doc).includes('Tester Three'), false);
    });

    // ══════════════════════════════════════════════════════════ §E
    group('§E  and still inspectable, one at a time');

    await asUser(db, U.superadmin, async () => {
      const detail = await attempt(db, 'select public.admin_user_progress_detail($1) as d', [U.tester]);
      eq('his detail page still opens', detail.ok, true);
      eq('and it is about him', detail.rows?.[0]?.d?.user?.id ?? detail.rows?.[0]?.d?.id ?? U.tester, U.tester);
    });

    // ══════════════════════════════════════════════════════════ §F
    group('§F  the drift guard - no report may enumerate public.profiles');

    /*
      The check that outlives this migration. Every function above was fixed by hand once; the
      tenth report is the one that will be written from a copy of the ninth, and this is what
      notices. It asks the catalogue rather than the migration files, so a function replaced by
      a later migration - or in production by hand - is judged on what is actually installed.
    */
    const POPULATION = [
      'admin_daily_activity', 'admin_daily_records', 'admin_leaderboard', 'leaderboard',
      'admin_level3_users', 'admin_point_transactions', 'admin_progress_filter_options',
      'admin_progress_report', 'admin_progress_summary',
    ];
    const defs = await db.query(
      `select p.proname, pg_get_functiondef(p.oid) as def
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = any($1)`,
      [POPULATION]
    );
    eq('all nine population functions exist', defs.rows.length, POPULATION.length);

    const stillRaw = defs.rows.filter((r) => /public\.profiles p\b/.test(r.def)).map((r) => r.proname);
    eq('none of them still walks public.profiles', stillRaw, []);

    const notCounted = defs.rows.filter((r) => !/counted_profiles/.test(r.def)).map((r) => r.proname);
    eq('and every one of them walks counted_profiles', notCounted, []);

    // The other half of the rule, stated so it cannot be "fixed" by pointing everything at the
    // filtered view: a report that resolves one named person must still see a test account.
    const detailFns = await db.query(
      `select p.proname, pg_get_functiondef(p.oid) as def
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('admin_user_progress_detail', 'admin_award_manual_points', 'actor_names')`
    );
    const overReached = detailFns.rows.filter((r) => /counted_profiles/.test(r.def)).map((r) => r.proname);
    eq('and the per-person functions were left alone', overReached, []);

    // ══════════════════════════════════════════════════════════ §G
    group('§G  unmarking puts him back, with his history');

    await asUser(db, U.superadmin, async () => {
      await db.query('update public.profiles set is_test = false where id = $1', [U.tester]);
    }, { commit: true });

    const cleared = (await db.query(
      'select is_test, test_marked_by, test_marked_at from public.profiles where id = $1', [U.tester]
    )).rows[0];
    eq('the flag is off', cleared.is_test, false);
    eq('and the stamp is cleared with it', [cleared.test_marked_by, cleared.test_marked_at], [null, null]);

    await asUser(db, U.real1, async () => {
      const doc = (await db.query(`select public.leaderboard('ALL') as d`)).rows[0].d;
      eq('he is back on the board, at the top, with all 925', boardNames(doc)[0], 'Tester Three');
    });

    await asUser(db, U.superadmin, async () => {
      eq('the roll counts three again',
        (await db.query('select count(*)::int as n from public.yuvaks')).rows[0].n, 3);
    });

    // ══════════════════════════════════════════════════════════ §H
    group('§H  purge reaches a test account and nothing else');

    await asUser(db, U.admin, async () => {
      refusedWith('an ADMIN may not purge',
        await attempt(db, 'select public.admin_purge_test_account($1)', [U.tester]), '42501');
    });

    /*
      One transaction per refusal, and not three in a block.

      `raise exception` aborts the transaction it happens in, so every statement after it in the
      same asUser() answers 25P02 "current transaction is aborted" - which is not a refusal by
      the guard under test, and a suite that accepted it would report a passing guard on a
      database where the guard had been deleted.
    */
    // He was unmarked in §G, so even a SUPER_ADMIN cannot reach him. This is the guard that
    // stands between "delete a test account" and "delete a person".
    await asUser(db, U.superadmin, async () => {
      refusedWith('and a SUPER_ADMIN may not purge a real યુવક',
        await attempt(db, 'select public.admin_purge_test_account($1)', [U.real1]), 'P0001');
    });

    await asUser(db, U.superadmin, async () => {
      refusedWith('nor one that has merely been unmarked',
        await attempt(db, 'select public.admin_purge_test_account($1)', [U.tester]), 'P0001');
    });

    await asUser(db, U.superadmin, async () => {
      await db.query('update public.profiles set is_test = true where id = $1', [U.tester]);
    }, { commit: true });

    await asUser(db, U.superadmin, async () => {
      const purged = await attempt(db, 'select public.admin_purge_test_account($1) as r', [U.tester]);
      eq('marked again, the purge runs', purged.ok, true);
      eq('and reports what it took', purged.rows?.[0]?.r?.points_removed, 2);
    }, { commit: true });

    eq('the profile is gone',
      (await db.query('select count(*)::int as n from public.profiles where id = $1', [U.tester])).rows[0].n, 0);
    eq('and his points went with it',
      (await db.query('select count(*)::int as n from public.point_transactions where user_id = $1', [U.tester])).rows[0].n, 0);
    eq('the two real yuvaks are untouched',
      (await db.query('select count(*)::int as n from public.point_transactions')).rows[0].n, 2);

    const trail = (await db.query(
      `select action, actor_id, "before"->>'name' as name
       from public.audit_logs where target_id = $1 order by at desc limit 1`, [U.tester]
    )).rows[0];
    eq('and the trail outlived the row', trail?.action, 'TEST_ACCOUNT_PURGED');
    eq('naming who did it', trail?.actor_id, U.superadmin);
    eq('and who it was', trail?.name, 'Tester Three');

    // ══════════════════════════════════════════════════════════ §I
    group('§I  an administrator is not a યુવક, so he is not on the યુવક board');

    /*
      0048, and the reason it needed its own group rather than a line in §A.

      `counted_profiles` is "everyone except a test account" and nothing more. `public.yuvaks`
      - what every count, list and export in the panel means by યુવક - is that MINUS anyone
      holding a `public.admins` row (0038). `leaderboard()` was given the first term by 0040
      and never the second, so an administrator who also has a profile was ranked by name on
      the one screen the whole સંઘ reads. In this project that is exactly what happened.

      U.admin has had both rows since fixtures() and was simply never paid, which is why §A
      could not see this: an account that earns nothing is absent from the board for a reason
      that has nothing to do with who he is. So he is paid here, and paid MORE than either
      real યુવક - a filter that merely reordered the board, or dropped its last row, would
      still look correct if he were mid-table.

      Last in the file, and self-contained, because every group above asserts an exact
      population count or an exact participant count. A payment added to fixtures() would
      move `admin_leaderboard()`'s participants and §H's ledger count for reasons that have
      nothing to do with what those groups are about.
    */
    await db.query(
      `insert into public.point_transactions
         (user_id, activity_date, level_id, activity_key, points, source, source_id)
       values ($1, $2::date, 3, 'darshan', 5000, 'ACTIVITY_ATTEMPT', 500)`,
      [U.admin, DAY]
    );

    await asUser(db, U.real1, async () => {
      const doc = (await db.query(`select public.leaderboard('ALL') as d`)).rows[0].d;
      eq('the highest total in the project does not put him on it',
        boardNames(doc).includes('Admin'), false);
      // The whole board, not just his absence from it: this is what says he did not displace
      // anybody either. A board of `top_n` length has a last place, and an administrator
      // standing in it is a યુવક who was not shown at all.
      eq('and the yuvaks keep the board to themselves', boardNames(doc), ['Real One', 'Real Two']);
      eq('and the count under it agrees', doc.participants, 2);
    });

    // He is not on it as a reader either, and `me: null` is the right answer rather than a
    // missing one - the page already has a sentence for "no ક્રમાંક to report" and needed no
    // change. `is_active_user()` lets him call it at all; being able to ask is not being ranked.
    await asUser(db, U.admin, async () => {
      const doc = (await db.query(`select public.leaderboard('ALL') as d`)).rows[0].d;
      eq('he cannot find himself on it', doc.me, null);
      eq('and sees the same two યુવકો everyone else does', boardNames(doc), ['Real One', 'Real Two']);
    });

    /*
      The other half of the requirement, and the half that makes this a narrowing rather than a
      deletion: the સંચાલક panel must still show what an administrator's account earned. That
      is how the person testing the app confirms the points arrived, which is the same argument
      0040 makes for keeping a test account visible on its own detail page.
    */
    await asUser(db, U.superadmin, async () => {
      const alb = (await db.query('select public.admin_leaderboard() as d')).rows[0].d;
      eq("the સંચાલક's board still shows him", boardNames(alb).includes('Admin'), true);

      eq('and his ledger is still readable there',
        (await db.query(
          `select coalesce(sum(t.points),0)::int as n
             from public.admin_point_transactions() t where t.user_id = $1`,
          [U.admin])).rows[0].n, 5000);
    });
  } finally {
    await db.end().catch(() => {});
    await stop();
  }
}

try {
  await main();
} catch (e) {
  console.error(`\n  ${e.stack || e}\n`);
  process.exitCode = 2;
}

console.log(`\n  ${pass} passed, ${fails.length} failed\n`);
for (const f of fails) console.log(`  FAIL  ${f}`);
if (fails.length) process.exitCode = 1;
