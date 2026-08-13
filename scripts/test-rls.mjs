/**
 * The security matrix, against a real Postgres — `node scripts/test-rls.mjs`.
 *
 * Every other suite in this directory tests a pure function in shared/domain/*, which is the
 * right shape for those modules and proves nothing at all about the half of this application
 * that decides who may do what. That half is RLS policies, BEFORE triggers and SECURITY
 * DEFINER functions, and there is no way to reach it from JavaScript: a suite that mocked the
 * Supabase client to check "a યુવક cannot read another યુવક's progress" would be asserting
 * that the mock returns what the test author typed into it.
 *
 * So this one applies supabase/migrations to a disposable postgres:16 (scripts/lib/pgtest.mjs)
 * and speaks SQL to it as an ordinary signed-in user, with `set role authenticated` and a JWT
 * claim — which is exactly what PostgREST does per request. If a policy is missing, a grant is
 * too wide or a trigger stops firing, these fail.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * What each group is protecting, and what it costs to get wrong
 * ────────────────────────────────────────────────────────────────────────────
 *
 *  §A  **Registration cannot mint an administrator.** The defect 0024 fixes: `mobile` is
 *      typed into the નોંધણી form, verified by nothing, and `effective_role()` used to read it
 *      to decide SUPER_ADMIN. Two ordinary requests from any visitor took over the project.
 *      Both directions are asserted — the escalation is refused, *and* the real founding
 *      accounts still hold their role, because a fix that locked the સંચાલક out of his own
 *      panel would be the worse outcome.
 *
 *  §B  **Anonymous reads nothing.** Not "sees an empty list": is refused.
 *
 *  §C  **One યુવક is not another.** Profile, progress, attempts, history, ledger. This is the
 *      promise the whole app is built on and the one a widened policy would break silently —
 *      nothing errors when a SELECT starts returning two thousand rows instead of one.
 *
 *  §D  **Nothing that decides an outcome is writable by the person it is about.** Role,
 *      points, completion, unlock flag, account status. Each of these is a way to award
 *      oneself the સાધના without doing it, and each is refused by a different mechanism —
 *      which is why they are tested separately rather than as "the tables are locked".
 *
 *  §E  **A યુવક cannot perform an administrator's mutation**, and §F a VIEWER cannot either.
 *      A read-only role that can write is the failure mode nobody notices until an audit.
 *
 *  §G  **SUSPENDED is a sanction and not a label.** The account signs in, reads its history,
 *      and writes nothing.
 *
 *  §H  **લેવલ ૪ order and repeat access**, as the server sees them. ૪.૩ is refused while ૪.૨
 *      is unfinished, however the request is shaped; an already-passed કસોટી stays
 *      attemptable; and a pass is never revoked by a later short attempt (0017's rule, which
 *      0025 must not have disturbed).
 *
 *  §I  **One logical submission, one attempt row** (0025) — including the case that actually
 *      matters, two requests racing on separate connections, where only the unique index can
 *      separate them.
 *
 *  §J  **A stale tab cannot un-do લેવલ ૪** (0026).
 *
 *  §K  **The leaderboard is an aperture, not a hole.** It is the one place a યુવક reads
 *      another યુવક, so what it does *not* return is the assertion.
 */
import { asAnon, asUser, attempt, dockerAvailable, startDatabase } from './lib/pgtest.mjs';

let pass = 0;
const fails = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) pass++;
  else fails.push(`${name}\n       got  ${g}\n       want ${w}`);
};

/** Refused, by any mechanism. Used where "it did not happen" is the whole assertion. */
const refused = (name, res) => {
  if (!res.ok) pass++;
  else fails.push(`${name}\n       got  the statement SUCCEEDED\n       want refused`);
};

/**
 * The statement ran and touched nothing.
 *
 * This is what RLS actually looks like, and it is a different thing from a refusal. A policy
 * is a filter on top of a privilege: `authenticated` holds SELECT and UPDATE on these tables,
 * so a read another યુવક may not do returns **zero rows** rather than raising, and an UPDATE
 * he may not do reports **zero rows affected** rather than failing. Asserting `refused` for
 * those would be asserting that the grants are missing, which on a Supabase project they are
 * not — and the test would then pass on a database where the policy had been deleted and the
 * grant happened to be absent instead.
 *
 * So: reads and RLS-governed writes assert emptiness; missing EXECUTE and raising triggers
 * assert refusal. Which one a given line uses is a claim about *which defence* is holding.
 */
const noRows = (name, res) => {
  if (res.ok && res.count === 0) pass++;
  else if (!res.ok) fails.push(`${name}\n       got  refused (${res.code})\n       want 0 rows`);
  else fails.push(`${name}\n       got  ${res.count} row(s)\n       want 0 rows`);
};

/**
 * Refused, by a *named* mechanism.
 *
 * '42501' is RLS or a missing grant; 'P0001' is a `raise exception` in a trigger; '23505' is a
 * unique constraint. They are different defences, and a test that accepted any refusal would
 * go on passing after the one it was written for was deleted and a weaker one happened to
 * catch the same case.
 */
const refusedWith = (name, res, codes) => {
  const want = Array.isArray(codes) ? codes : [codes];
  if (!res.ok && want.includes(res.code)) pass++;
  else if (res.ok) fails.push(`${name}\n       got  the statement SUCCEEDED\n       want ${want.join('/')}`);
  else fails.push(`${name}\n       got  ${res.code} ${res.message.slice(0, 90)}\n       want ${want.join('/')}`);
};

const group = (name) => console.log(`\n  ${name}`);

// The §3 numbers, as literals, because that is what 0024 is about. Imported from
// shared/domain/constants.js would test that the file agrees with itself.
const FOUNDER_MOBILE = '9601269715';

const U = {
  founder: '11111111-1111-4111-8111-111111111111',
  yuvakA: '22222222-2222-4222-8222-222222222222',
  yuvakB: '33333333-3333-4333-8333-333333333333',
  suspended: '44444444-4444-4444-8444-444444444444',
  viewer: '55555555-5555-4555-8555-555555555555',
  admin: '66666666-6666-4666-8666-666666666666',
  attacker: '77777777-7777-4777-8777-777777777777',
  // A SUPER_ADMIN with a real admin_profiles row, as distinct from the founder, who holds the
  // role through the bootstrap allowlist and has no row. The two are not interchangeable: only
  // a row can be updated, so the "cannot change your own role" guard is only reachable here.
  superadmin: '99999999-9999-4999-8999-999999999999',
};

const ACT = {};

async function fixtures(db) {
  // Everything here runs as the owner, which is what a migration or the seed script is. RLS
  // does not apply, but every trigger still fires — including 0024's, which stands aside for
  // `auth.uid() is null` exactly as scripts/seed-admin-supabase.mjs relies on.
  const people = [
    [U.founder, 'FDR001', 'સ્થાપક', FOUNDER_MOBILE, 'ACTIVE'],
    [U.yuvakA, 'AAA001', 'યુવક એ', '9800000001', 'ACTIVE'],
    [U.yuvakB, 'BBB002', 'યુવક બી', '9800000002', 'ACTIVE'],
    [U.suspended, 'SSS003', 'સસ્પેન્ડ', '9800000003', 'SUSPENDED'],
    [U.viewer, 'VVV004', 'દર્શક', '9800000004', 'ACTIVE'],
    [U.admin, 'ADM005', 'સંચાલક', '9800000005', 'ACTIVE'],
    [U.attacker, 'ATK006', 'હુમલાખોર', '9800000006', 'ACTIVE'],
    [U.superadmin, 'SUP007', 'મુખ્ય સંચાલક', '9800000007', 'ACTIVE'],
  ];
  for (const [id, smk, name, mobile, status] of people) {
    await db.query('insert into auth.users (id, email) values ($1, $2)', [id, `${smk}@t.test`]);
    await db.query(
      `insert into public.profiles (id, smk, name, email, mobile, zone_id, sub_zone_id, status)
       values ($1, $2, $3, $4, $5, 'surat', 'varachha', $6)`,
      [id, smk, name, `${smk}@t.test`, mobile, status]
    );
  }

  // 0024 seeds bootstrap_admins from the profiles that exist when it runs. In this harness the
  // migrations ran against an empty table, so the founder is enrolled here the way applying
  // 0024 to a live project would have enrolled him.
  await db.query('insert into public.bootstrap_admins (id, mobile) values ($1, $2)', [
    U.founder,
    FOUNDER_MOBILE,
  ]);

  await db.query(`insert into public.admin_profiles (id, role, status) values ($1, 'VIEWER', 'ACTIVE')`, [U.viewer]);
  await db.query(`insert into public.admin_profiles (id, role, status) values ($1, 'ADMIN', 'ACTIVE')`, [U.admin]);
  await db.query(`insert into public.admin_profiles (id, role, status) values ($1, 'SUPER_ADMIN', 'ACTIVE')`, [
    U.superadmin,
  ]);

  for (let i = 1; i <= 12; i++) {
    const id = `darshan-${String(i).padStart(3, '0')}`;
    await db.query(
      `insert into public.scenes (id, "index", "order", active, caption) values ($1, $2, $2, true, $3)`,
      [id, i, `દ્રશ્ય ${i}`]
    );
  }

  // The gate open by configuration rather than by score, so that §H is testing the ક્રમ rule
  // and not લેવલ ૩. Points on, so §D's "cannot pay myself" is asserted against a system that
  // is actually paying.
  await db.query(
    `insert into public.settings (key, value) values ('levels', $1::jsonb)
     on conflict (key) do update set value = excluded.value`,
    [
      JSON.stringify({
        level4Gate: { require: false, threshold: 80 },
        points: { enabled: true, level1: 100, level2: 200, level3: 300, level4: { default: 400 } },
      }),
    ]
  );

  // DRAFT first, published at the end. `level4_guard_editable()` (0010) freezes the
  // activities and items of a PUBLISHED configuration — which is the point of publishing —
  // so building one has to follow the same order the panel follows.
  const cfg = (
    await db.query(`insert into public.level4_configs (status, version) values ('DRAFT', 1) returning id`)
  ).rows[0].id;
  ACT.config = cfg;

  for (const [code, pos, n] of [['4.1', 1, 4], ['4.2', 2, 4], ['4.3', 3, 4]]) {
    const a = (
      await db.query(
        `insert into public.level4_activities (config_id, code, title, position, active, required_count)
         values ($1, $2, $3, $4, true, 2) returning id`,
        [cfg, code, `કસોટી ${code}`, pos]
      )
    ).rows[0].id;
    ACT[code] = a;
    for (let i = 0; i < n; i++) {
      const scene = `darshan-${String((pos - 1) * 4 + i + 1).padStart(3, '0')}`;
      await db.query(
        `insert into public.level4_activity_items (activity_id, scene_id, position) values ($1, $2, $3)`,
        [a, scene, i + 1]
      );
    }
  }

  await db.query(`update public.level4_configs set status = 'PUBLISHED', published_at = now() where id = $1`, [cfg]);

  // A day of લેવલ ૩ for યુવક બી, so §C has something real to fail to read.
  await db.query(
    `insert into public.progress (user_id, date, level3_score, level4_score)
     values ($1, current_date, 82, 0)`,
    [U.yuvakB]
  );
}

async function main() {
  if (!dockerAvailable()) {
    console.log('\n  SKIPPED — no docker daemon. This suite needs one to be honest.\n');
    console.log('  Nothing was verified. Do not read a green build as a passing security suite.\n');
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
  const roleOf = (uid) => asUser(db, uid, async () => (await db.query('select public.effective_role() r')).rows[0].r);

  // ══════════════════════════════════════════════════════ §A registration → SUPER_ADMIN
  group('§A  registration cannot mint an administrator (0024)');

  eq('the founding account still holds SUPER_ADMIN', await roleOf(U.founder), 'SUPER_ADMIN');
  eq('an ordinary યુવક holds no role', await roleOf(U.yuvakA), null);
  eq('the VIEWER holds VIEWER', await roleOf(U.viewer), 'VIEWER');
  eq('the ADMIN holds ADMIN', await roleOf(U.admin), 'ADMIN');

  // The exploit, in the two requests it actually took. The auth account is created first
  // because that is what signUp() does and it is not the part that was ever in doubt.
  const newId = '88888888-8888-4888-8888-888888888888';
  await db.query('insert into auth.users (id, email) values ($1, $2)', [newId, 'atk@t.test']);

  const claim = await asUser(db, newId, () =>
    attempt(
      db,
      `insert into public.profiles (id, smk, name, email, mobile, zone_id, sub_zone_id)
       values ($1, 'XXX999', 'હુમલો', 'atk@t.test', $2, 'surat', 'varachha')`,
      [newId, FOUNDER_MOBILE]
    )
  );
  refusedWith('registering with a §3 number is refused', claim, '23505');
  eq(
    'and refused as profiles_mobile_key, so the endpoint is not an oracle',
    claim.message.includes('profiles_mobile_key'),
    true
  );

  // The part that matters even more: suppose the number were somehow claimed anyway (an
  // attacker who got in before 0024, a row inserted server-side). It must still grant nothing,
  // because authority is the allowlist and no longer the column.
  await db.query(
    `insert into public.profiles (id, smk, name, email, mobile, zone_id, sub_zone_id)
     values ($1, 'XXX999', 'હુમલો', 'atk2@t.test', '9601269009', 'surat', 'varachha')`,
    [newId]
  );
  eq('a §3 number on a profile NOT in the allowlist grants nothing', await roleOf(newId), null);
  await db.query('delete from public.profiles where id = $1', [newId]);

  // And the allowlist itself is not something a signed-in caller can add themselves to.
  refused(
    'a યુવક cannot enrol himself in bootstrap_admins',
    await asUser(db, U.yuvakA, () =>
      attempt(db, 'insert into public.bootstrap_admins (id, mobile) values ($1, $2)', [
        U.yuvakA,
        '9800000001',
      ])
    )
  );
  refused(
    'a યુવક cannot even read bootstrap_admins',
    await asUser(db, U.yuvakA, () => attempt(db, 'select * from public.bootstrap_admins'))
  );

  // ══════════════════════════════════════════════════════ §B anonymous
  group('§B  an anonymous visitor');

  /*
    Refusal *or* emptiness, and this is the one group where accepting either is the honest
    assertion rather than a loose one.

    What actually happens today is a refusal, and by a route worth naming: the SELECT policies
    read `public.has_permission(...)`, which is granted to `authenticated` and not to `anon`,
    so the statement dies on the function privilege before any row is considered. That is a
    real defence and it holds — but it is not the defence being claimed here. If somebody
    granted `has_permission` to `anon` tomorrow the policies would evaluate properly and return
    nothing, which is equally correct and would fail a test pinned to 42501. The claim is "an
    anonymous visitor gets no data", so that is what is asserted.
  */
  const reachesNothing = (name, res) => {
    if (!res.ok || res.count === 0) pass++;
    else fails.push(`${name}\n       got  ${res.count} row(s)\n       want no data`);
  };

  reachesNothing('reads no profile', await asAnon(db, () => attempt(db, 'select * from public.profiles')));
  reachesNothing('reads no progress', await asAnon(db, () => attempt(db, 'select * from public.progress')));
  reachesNothing('reads no attempt', await asAnon(db, () => attempt(db, 'select * from public.level4_attempts')));
  reachesNothing('reads no ledger row', await asAnon(db, () => attempt(db, 'select * from public.point_transactions')));
  reachesNothing('reads no history', await asAnon(db, () => attempt(db, 'select * from public.activity_history')));
  refused(
    'cannot ask the database what role it would give him',
    await asAnon(db, () => attempt(db, 'select public.effective_role()'))
  );
  refused(
    'cannot call level4_submit',
    await asAnon(db, () => attempt(db, 'select public.level4_submit($1, $2)', [ACT['4.1'], ['darshan-001']]))
  );
  refused(
    'cannot call the leaderboard',
    await asAnon(db, () => attempt(db, 'select * from public.leaderboard(null)'))
  );

  // ══════════════════════════════════════════════════════ §C one યુવક is not another
  group('§C  યુવક એ cannot reach યુવક બી');

  eq(
    'reads exactly one profile — his own',
    await asUser(db, U.yuvakA, async () => (await db.query('select count(*)::int c from public.profiles')).rows[0].c),
    1
  );
  eq(
    "sees nothing of યુવક બી's progress",
    await asUser(db, U.yuvakA, async () =>
      (await db.query('select count(*)::int c from public.progress where user_id = $1', [U.yuvakB])).rows[0].c
    ),
    0
  );
  eq(
    "sees nothing of યુવક બી's attempts",
    await asUser(db, U.yuvakA, async () =>
      (await db.query('select count(*)::int c from public.level4_attempts where user_id = $1', [U.yuvakB])).rows[0].c
    ),
    0
  );
  eq(
    "sees nothing of યુવક બી's history",
    await asUser(db, U.yuvakA, async () =>
      (await db.query('select count(*)::int c from public.activity_history where user_id = $1', [U.yuvakB])).rows[0].c
    ),
    0
  );
  eq(
    "sees nothing of યુવક બી's ledger",
    await asUser(db, U.yuvakA, async () =>
      (await db.query('select count(*)::int c from public.point_ledger where user_id = $1', [U.yuvakB])).rows[0].c
    ),
    0
  );
  refused(
    "cannot write a row onto યુવક બી's day",
    await asUser(db, U.yuvakA, () =>
      attempt(db, 'insert into public.progress (user_id, date, level3_score) values ($1, current_date + 1, 108)', [
        U.yuvakB,
      ])
    )
  );
  eq(
    "cannot raise યુવક બી's existing score",
    await asUser(db, U.yuvakA, async () =>
      (await db.query('update public.progress set level3_score = 108 where user_id = $1', [U.yuvakB])).rowCount
    ),
    0
  );

  // ══════════════════════════════════════════════════════ §D forging an outcome
  group('§D  a યુવક cannot award himself anything');

  refused(
    'cannot insert an admin_profiles row for himself',
    await asUser(db, U.yuvakA, () =>
      attempt(db, `insert into public.admin_profiles (id, role) values ($1, 'SUPER_ADMIN')`, [U.yuvakA])
    )
  );
  refused(
    'cannot pay himself in the ledger',
    await asUser(db, U.yuvakA, () =>
      attempt(
        db,
        `insert into public.point_transactions (user_id, activity_date, level_id, activity_key, points, source, source_id)
         values ($1, current_date, 3, '', 999999, 'FORGED', 0)`,
        [U.yuvakA]
      )
    )
  );
  refused(
    'cannot call award_points directly',
    await asUser(db, U.yuvakA, () =>
      attempt(db, `select public.award_points($1, current_date, 3, '', 'FORGED', 0, 1)`, [U.yuvakA])
    )
  );
  refused(
    'cannot forge a લેવલ ૪ attempt row',
    await asUser(db, U.yuvakA, () =>
      attempt(
        db,
        `insert into public.level4_attempts (user_id, activity_id, config_id, selected_count, required_count, passed)
         values ($1, $2, $3, 99, 0, true)`,
        [U.yuvakA, ACT['4.1'], ACT.config]
      )
    )
  );
  refused(
    'cannot forge a લેવલ ૪ COMPLETED row',
    await asUser(db, U.yuvakA, () =>
      attempt(
        db,
        `insert into public.level4_activity_progress (user_id, activity_id, config_id, status)
         values ($1, $2, $3, 'COMPLETED')`,
        [U.yuvakA, ACT['4.3'], ACT.config]
      )
    )
  );
  refused(
    'cannot forge a લેવલ ૧-૩ attempt row',
    await asUser(db, U.yuvakA, () =>
      attempt(
        db,
        `insert into public.activity_attempts
           (user_id, level_id, activity_key, activity_date, attempt_number, total_items, completed_items, status)
         values ($1, 3, 'revision', current_date, 1, 108, 108, 'COMPLETED')`,
        [U.yuvakA]
      )
    )
  );

  // The unlock flag and the account status are writable rows with a guard on the column, so
  // the assertion is not "refused" but "did not move" — which is the shape 0008 and 0017 chose
  // deliberately, so an unrelated legitimate profile write still lands.
  eq(
    'claiming level4_unlocked leaves it false',
    await asUser(db, U.yuvakA, async () => {
      await db.query('update public.profiles set level4_unlocked = true where id = $1', [U.yuvakA]);
      return (await db.query('select level4_unlocked from public.profiles where id = $1', [U.yuvakA])).rows[0]
        .level4_unlocked;
    }),
    false
  );
  eq(
    'a SUSPENDED account cannot restore itself to ACTIVE',
    await asUser(db, U.suspended, async () => {
      await db.query(`update public.profiles set status = 'ACTIVE' where id = $1`, [U.suspended]);
      return (await db.query('select status from public.profiles where id = $1', [U.suspended])).rows[0].status;
    }),
    'SUSPENDED'
  );

  // ══════════════════════════════════════════════════════ §E / §F administrative mutations
  group('§E  a યુવક cannot perform an administrator\'s mutation');

  noRows(
    'cannot rewrite a દ્રશ્ય',
    await asUser(db, U.yuvakA, () => attempt(db, `update public.scenes set caption = 'x' where id = 'darshan-001'`))
  );
  noRows(
    'cannot rewrite settings',
    await asUser(db, U.yuvakA, () =>
      attempt(db, `update public.settings set value = '{}'::jsonb where key = 'levels'`)
    )
  );
  eq(
    'cannot read the audit trail',
    await asUser(db, U.yuvakA, async () => (await db.query('select count(*)::int c from public.audit_logs')).rows[0].c),
    0
  );
  refused(
    'cannot publish a લેવલ ૪ configuration',
    await asUser(db, U.yuvakA, () => attempt(db, 'select public.level4_publish($1)', [ACT.config]))
  );
  refused(
    'cannot reorder દર્શન',
    await asUser(db, U.yuvakA, () =>
      attempt(db, 'select public.darshan_reorder($1)', [['darshan-002', 'darshan-001']])
    )
  );

  group('§F  a VIEWER reads and does not write');

  eq(
    'reads every profile',
    await asUser(db, U.viewer, async () => (await db.query('select count(*)::int c from public.profiles')).rows[0].c >= 7),
    true
  );
  noRows(
    'cannot rewrite a દ્રશ્ય',
    await asUser(db, U.viewer, () => attempt(db, `update public.scenes set caption = 'x' where id = 'darshan-001'`))
  );
  noRows(
    'cannot rewrite settings',
    await asUser(db, U.viewer, () =>
      attempt(db, `update public.settings set value = '{}'::jsonb where key = 'levels'`)
    )
  );
  refusedWith(
    'cannot appoint an administrator',
    await asUser(db, U.viewer, () =>
      attempt(db, `insert into public.admin_profiles (id, role) values ($1, 'ADMIN')`, [U.yuvakA])
    ),
    ['42501', 'P0001']
  );
  // Zero rows and not a raise: the RLS policy on admin_profiles requires `admins.update`,
  // which a VIEWER does not hold, so the row is invisible to the UPDATE and
  // admin_profiles_guard() never runs. The guard's own refusal is asserted on the next line,
  // by somebody who *can* see the row.
  noRows(
    'cannot promote himself — the row is not his to update',
    await asUser(db, U.viewer, () =>
      attempt(db, `update public.admin_profiles set role = 'SUPER_ADMIN' where id = $1`, [U.viewer])
    )
  );
  refusedWith(
    'a SUPER_ADMIN cannot change his own role either — the guard, not the policy',
    await asUser(db, U.superadmin, () =>
      attempt(db, `update public.admin_profiles set role = 'VIEWER' where id = $1`, [U.superadmin])
    ),
    'P0001'
  );
  refusedWith(
    'and cannot appoint himself in the first place',
    await asUser(db, U.superadmin, () =>
      attempt(db, `insert into public.admin_profiles (id, role) values ($1, 'SUPER_ADMIN')`, [U.superadmin])
    ),
    ['P0001', '23505']
  );
  refusedWith(
    'an ADMIN cannot grant SUPER_ADMIN',
    await asUser(db, U.admin, () =>
      attempt(db, `insert into public.admin_profiles (id, role) values ($1, 'SUPER_ADMIN')`, [U.yuvakA])
    ),
    'P0001'
  );
  noRows(
    'an administrator is disabled, never deleted — there is no delete policy',
    await asUser(db, U.founder, () =>
      attempt(db, 'delete from public.admin_profiles where id = $1', [U.viewer])
    )
  );

  // ══════════════════════════════════════════════════════ §G suspension
  group('§G  SUSPENDED is a sanction, not a label');

  eq(
    'still reads his own profile',
    await asUser(db, U.suspended, async () =>
      (await db.query('select count(*)::int c from public.profiles where id = $1', [U.suspended])).rows[0].c
    ),
    1
  );
  refused(
    'cannot write a day of progress',
    await asUser(db, U.suspended, () =>
      attempt(db, 'insert into public.progress (user_id, date, level3_score) values ($1, current_date, 50)', [
        U.suspended,
      ])
    )
  );
  refusedWith(
    'cannot submit a લેવલ ૪ કસોટી',
    await asUser(db, U.suspended, () =>
      attempt(db, 'select public.level4_submit($1, $2)', [ACT['4.1'], ['darshan-001', 'darshan-002']])
    ),
    'P0001'
  );

  // ══════════════════════════════════════════════════════ §H order and repeat
  group('§H  લેવલ ૪ — ક્રમ, and repeat access (0017)');

  refusedWith(
    '૪.૩ is refused while ૪.૧ and ૪.૨ are unfinished',
    await asUser(db, U.yuvakA, () =>
      attempt(db, 'select public.level4_submit($1, $2)', [ACT['4.3'], ['darshan-009', 'darshan-010']])
    ),
    'P0001'
  );
  eq(
    'and refused by name, not by a generic error',
    (
      await asUser(db, U.yuvakA, () =>
        attempt(db, 'select public.level4_submit($1, $2)', [ACT['4.3'], ['darshan-009', 'darshan-010']])
      )
    ).message.includes('level4_locked'),
    true
  );

  eq(
    '૪.૧ passed, then ૪.૨ opens, then ૪.૩',
    await asUser(db, U.yuvakA, async () => {
      const one = (
        await db.query('select public.level4_submit($1, $2) r', [ACT['4.1'], ['darshan-001', 'darshan-002']])
      ).rows[0].r;
      const two = (
        await db.query('select public.level4_submit($1, $2) r', [ACT['4.2'], ['darshan-005', 'darshan-006']])
      ).rows[0].r;
      const three = (
        await db.query('select public.level4_submit($1, $2) r', [ACT['4.3'], ['darshan-009', 'darshan-010']])
      ).rows[0].r;
      return [one.passed, two.passed, three.passed];
    }),
    [true, true, true]
  );

  eq(
    'a passed કસોટી may be sat again, and a short attempt does not un-pass it',
    await asUser(db, U.yuvakA, async () => {
      await db.query('select public.level4_submit($1, $2)', [ACT['4.1'], ['darshan-001', 'darshan-002']]);
      const again = (await db.query('select public.level4_submit($1, $2) r', [ACT['4.1'], ['darshan-001']])).rows[0].r;
      return [again.passed, again.status, again.attemptCount];
    }),
    [false, 'COMPLETED', 2]
  );

  eq(
    'a દ્રશ્ય the કસોટી does not contain counts for nothing',
    await asUser(db, U.yuvakA, async () => {
      const r = (
        await db.query('select public.level4_submit($1, $2) r', [
          ACT['4.1'],
          ['darshan-001', 'darshan-011', 'darshan-012'],
        ])
      ).rows[0].r;
      return [r.selectedCount, r.passed];
    }),
    [1, false]
  );

  refused(
    'cannot submit on behalf of another યુવક — there is no argument for it',
    await asUser(db, U.yuvakA, () =>
      attempt(db, 'select public.level4_activity_states($1, $2)', [U.yuvakB, ACT.config])
    )
  );

  // ══════════════════════════════════════════════════════ §I idempotency
  group('§I  one logical submission, one attempt row (0025)');

  const TOKEN = '99999999-9999-4999-8999-999999999999';

  eq(
    'the same token twice records one attempt and replays the answer',
    await asUser(db, U.yuvakA, async () => {
      const first = (
        await db.query('select public.level4_submit($1, $2, $3) r', [
          ACT['4.1'],
          ['darshan-001', 'darshan-002'],
          TOKEN,
        ])
      ).rows[0].r;
      const second = (
        await db.query('select public.level4_submit($1, $2, $3) r', [
          ACT['4.1'],
          ['darshan-001', 'darshan-002'],
          TOKEN,
        ])
      ).rows[0].r;
      const n = (
        await db.query('select count(*)::int c from public.level4_attempts where user_id = $1', [U.yuvakA])
      ).rows[0].c;
      return [n, first.passed, second.passed, first.attemptCount, second.attemptCount, second.replayed];
    }),
    [1, true, true, 1, 1, true]
  );

  eq(
    'two different tokens are two real attempts — repeat access survives',
    await asUser(db, U.yuvakA, async () => {
      await db.query('select public.level4_submit($1, $2, $3)', [
        ACT['4.1'],
        ['darshan-001', 'darshan-002'],
        '11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      ]);
      const r = (
        await db.query('select public.level4_submit($1, $2, $3) r', [
          ACT['4.1'],
          ['darshan-001', 'darshan-002'],
          '22222222-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        ])
      ).rows[0].r;
      const n = (
        await db.query('select count(*)::int c from public.level4_attempts where user_id = $1', [U.yuvakA])
      ).rows[0].c;
      return [n, r.attemptCount, r.replayed];
    }),
    [2, 2, false]
  );

  eq(
    'a caller that sends no token behaves exactly as before',
    await asUser(db, U.yuvakA, async () => {
      await db.query('select public.level4_submit($1, $2)', [ACT['4.1'], ['darshan-001', 'darshan-002']]);
      await db.query('select public.level4_submit($1, $2)', [ACT['4.1'], ['darshan-001', 'darshan-002']]);
      return (await db.query('select count(*)::int c from public.level4_attempts where user_id = $1', [U.yuvakA]))
        .rows[0].c;
    }),
    2
  );

  eq(
    'the token is scoped to the યુવક — બી reusing એ\'s token is his own attempt',
    await asUser(db, U.yuvakB, async () => {
      const r = (
        await db.query('select public.level4_submit($1, $2, $3) r', [
          ACT['4.1'],
          ['darshan-001', 'darshan-002'],
          TOKEN,
        ])
      ).rows[0].r;
      return [r.passed, r.replayed, r.attemptCount];
    }),
    [true, false, 1]
  );

  // ══════════════════════════════════════════════════════ §J the stale tab
  group('§J  a stale tab cannot un-do લેવલ ૪ (0026)');

  eq(
    'a progress upsert carrying a stale level4_score cannot lower it',
    await asUser(db, U.yuvakA, async () => {
      await db.query('select public.level4_submit($1, $2)', [ACT['4.1'], ['darshan-001', 'darshan-002']]);
      const earned = (
        await db.query('select level4_score from public.progress where user_id = $1 and date = current_date', [
          U.yuvakA,
        ])
      ).rows[0].level4_score;

      // Precisely what src/lib/progress.js sends: the whole row, with the લેવલ ૪ figure this
      // tab loaded with — zero, because it opened before the કસોટી was sat.
      await db.query(
        `insert into public.progress (user_id, date, level3_score, level4_score, updated_at)
         values ($1, current_date, 5, 0, now())
         on conflict (user_id, date) do update
           set level3_score = excluded.level3_score,
               level4_score = excluded.level4_score,
               updated_at = excluded.updated_at`,
        [U.yuvakA]
      );

      const after = (
        await db.query(
          'select level3_score, level4_score from public.progress where user_id = $1 and date = current_date',
          [U.yuvakA]
        )
      ).rows[0];
      return [earned, after.level4_score, after.level3_score];
    }),
    [2, 2, 5]
  );

  // ══════════════════════════════════════════════════════ §K the leaderboard aperture
  group('§K  the leaderboard shows a name and a number, and no identifier');

  eq(
    'returns no user id of any kind',
    await asUser(db, U.yuvakA, async () => {
      const r = await db.query('select * from public.leaderboard(null) limit 1');
      return r.fields.map((f) => f.name).filter((n) => /id|uuid|mobile|email|smk/i.test(n));
    }),
    []
  );
}

await main();
