/**
 * Roles and permissions as data — against a real Postgres.
 *
 *     VARNI_PGTEST_PORT=54833 VARNI_PGTEST_IMAGE=postgres:16-alpine node scripts/test-rbac-dynamic.mjs
 *
 * ────────────────────────────────────────────────────────────────────────────
 * What 0043 changed, and why none of it is checkable by reading
 * ────────────────────────────────────────────────────────────────────────────
 *
 * 0004 put the role→permission matrix in a SQL function and argued, correctly, that a row is
 * data and data has a write path. 0043 overrules that, because the સંચાલક has to be able to
 * hand out access without a developer — and the whole safety of the reversal rests on one
 * split: the *bindings* become data, the *catalogue* stays code.
 *
 * That split is a claim about what the database refuses, and there is no way to check it by
 * reading the migration. `public.permissions` has RLS on and no write policy, which a reader
 * can see; what a reader cannot see is that the trigger behind it also refuses `service_role`,
 * which is the case that matters — a secret key in a server function is precisely the thing
 * that would otherwise be able to invent `users.delete` and hand it out.
 *
 * §B is that test. Everything else follows from it: if the catalogue is writable, nothing
 * else in this file means anything.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * The groups
 * ────────────────────────────────────────────────────────────────────────────
 *
 *  §A  The seed is backward compatible. Each of the five roles holds exactly what
 *      permissions_for() gave it before, plus exactly the splits carved from what it held.
 *      This is the "nobody gains or loses anything today" claim, asserted rather than stated.
 *  §B  The catalogue is immutable — for authenticated, and for service_role.
 *  §C  Resolution order: role, then ALLOW, then DENY, and DENY wins.
 *  §D  An expired grant is not a grant. A suspended administrator's grants go with him.
 *  §E  The bootstrap fallback short-circuits to the whole catalogue and cannot be edited away.
 *  §F  role_permissions_guard(): roles.manage, never SUPER_ADMIN, never at or above your own
 *      rank, and never a permission you do not hold yourself.
 *  §G  admin_grants_guard(): grants.manage, never your own, never upward.
 *  §H  admin_roles_guard(): system roles, ranks, and a role with members.
 *  §I  admins_guard()'s new rules — rank, and the last Super Admin.
 *  §J  admin_session() answers in one call, and says nothing to a યુવક.
 *  §K  The trail: every change to access lands in audit_logs.
 *  §L  The split permissions are *enforced*, not merely grantable. A permission the role
 *      editor can hand out and no function checks is a tick box that promises access and
 *      delivers none — the mirror image of the failure §B guards against.
 *  §M  0044's read surfaces for the /access screens: admin_effective_permissions() agrees
 *      with has_permission() permission for permission, and admin_role_usage() counts past
 *      the RLS policy on public.admins.
 *  §N  0045's REVOKED. Appointing a real યુવક removes him from every count and report, and
 *      before 0045 nothing brought him back — suspending and disabling both leave him out,
 *      because the exclusion never looked at status. This is the round trip: યુવક → સંચાલક →
 *      યુવક again, with the learning record intact throughout.
 */
import { asUser, attempt, dockerAvailable, startDatabase } from './lib/pgtest.mjs';

/**
 * attempt(), inside a savepoint.
 *
 * A statement that Postgres refuses aborts the whole enclosing transaction, and every
 * statement after it fails with 25P02 "current transaction is aborted" regardless of what it
 * was. asUser() wraps each block in one transaction, so a group that checks several refusals
 * in a row would report the first one honestly and then fail the rest for a reason that has
 * nothing to do with what they assert — or, worse, pass them, if the assertion happened to be
 * "this was refused".
 *
 * The suites written before this one avoid the problem by checking at most one refusal per
 * asUser block. This file checks four rules against one guard and would need a round trip per
 * assertion to do the same, so it takes a savepoint instead and rolls back to it. That is what
 * a savepoint is for, and it keeps each group readable as the list of rules it is.
 *
 * Named per call, because a savepoint name reused inside one transaction stacks rather than
 * replaces, and `rollback to` would then unwind to the oldest of them.
 */
let sp = 0;
async function refuse(db, sql, params = []) {
  const name = `sp_${++sp}`;
  await db.query(`savepoint ${name}`);
  const res = await attempt(db, sql, params);
  if (res.ok) await db.query(`release savepoint ${name}`);
  else await db.query(`rollback to savepoint ${name}`);
  return res;
}

let pass = 0;
const fails = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) pass++;
  else fails.push(`${name}\n       got  ${g}\n       want ${w}`);
};
const ok = (name, cond) => eq(name, Boolean(cond), true);
const says = (name, res, fragment) => {
  if (!res.ok && String(res.message).includes(fragment)) pass++;
  else if (res.ok) fails.push(`${name}\n       got  the statement SUCCEEDED\n       want "${fragment}"`);
  else fails.push(`${name}\n       got  ${res.message.slice(0, 100)}\n       want "${fragment}"`);
};
const group = (t) => console.log(`\n  ${t}\n`);

const U = {
  // The single Super Admin these tests act as when they need to be able to do anything.
  sooper: '20000000-0000-4000-8000-000000000001',
  // Holds roles.manage and grants.manage through a custom role ranked below SUPER_ADMIN.
  // The subject of most of the guard tests: powerful, and still not able to escalate.
  delegate: '20000000-0000-4000-8000-000000000002',
  // An ordinary COORDINATOR — the person exceptions get granted to.
  coordinator: '20000000-0000-4000-8000-000000000003',
  // A second ADMIN, to prove the rank rules bite between equals.
  admin: '20000000-0000-4000-8000-000000000004',
  // A founding account: a profile carrying a §3 mobile, so 0024 put him in bootstrap_admins.
  founder: '20000000-0000-4000-8000-000000000005',
  // An ordinary યુવક.
  yuvak: '20000000-0000-4000-8000-000000000006',
};

/*
  0040's permissions_for(), transcribed. The last copy of the hardcoded matrix that will ever
  exist in this repository, and it lives in a test on purpose: §A compares the seeded tables
  against it, so the claim "no administrator gains or loses anything today" is checked against
  the thing it is a claim about rather than against the migration that made it.
*/
const BEFORE = {
  ADMIN: [
    'users.read', 'users.update', 'users.disable',
    'progress.read', 'sessions.read',
    'darshan.read', 'darshan.create', 'darshan.update', 'darshan.disable',
    'settings.read', 'settings.update',
    'admins.read', 'audit.read',
  ],
  CONTENT_MANAGER: [
    'darshan.read', 'darshan.create', 'darshan.update', 'darshan.disable', 'settings.read',
  ],
  COORDINATOR: ['users.read', 'progress.read', 'sessions.read', 'darshan.read'],
  VIEWER: ['users.read', 'progress.read', 'sessions.read', 'darshan.read', 'settings.read'],
};

/**
 * The derivation the migrations seed by. Kept here as data so §A can recompute the expected set.
 *
 * 0043's twenty-seven splits, plus anything a later migration adds by the same rule — a new
 * permission goes to exactly the roles that already held the coarse one it was carved out of, so
 * nobody gains or loses anything on the day it ships. A migration that grants by some *other*
 * rule belongs in its own assertion rather than here, because §A's whole claim is that this one
 * rule was followed.
 */
const SPLIT = {
  'users.export': 'users.read',
  // 0046. Whether a role is shown SMK numbers in lists and exports; granted to everyone who can
  // open the list it is a column of, so the column is controllable without anybody losing it.
  'users.smk.read': 'users.read',
  'progress.detail.read': 'progress.read',
  'progress.export': 'progress.read',
  'darshan.image.replace': 'darshan.update',
  'darshan.reorder': 'darshan.update',
  'darshan.import': 'darshan.create',
  // progress.read, not settings.read - see the note beside it in 0043. The menu and the
  // functions disagreed about Point Management, and the functions were right.
  'points.read': 'progress.read',
  'points.ledger.read': 'progress.read',
  'points.daily.read': 'progress.read',
  'points.records.read': 'progress.read',
  'points.level3.read': 'progress.read',
  'points.leaderboard.read': 'progress.read',
  'points.config.update': 'settings.update',
  'points.bonus.update': 'settings.update',
  'points.adjust': 'settings.update',
  'levels.read': 'settings.read',
  'levels.update': 'settings.update',
  'level4.read': 'settings.read',
  'level4.update': 'settings.update',
  'video.update': 'settings.update',
  'navigation.update': 'settings.update',
  'appicon.update': 'settings.update',
  'dhun.update': 'settings.update',
  'roles.manage': 'roles.assign',
  'grants.manage': 'roles.assign',
  'scope.assign': 'roles.assign',
  'audit.export': 'audit.read',
};

const expectedFor = (role) => {
  const base = BEFORE[role];
  const derived = Object.entries(SPLIT).filter(([, from]) => base.includes(from)).map(([p]) => p);
  return [...new Set([...base, ...derived])].sort();
};

async function fixtures(db) {
  for (const [key, id] of Object.entries(U)) {
    await db.query('insert into auth.users (id, email) values ($1, $2)', [id, `${key}@t.test`]);
  }

  // The founder carries a §3 number, so 0024's allowlist claims him. Inserted as the owner,
  // which is how seed-admin-supabase.mjs does it — profiles_guard_reserved_mobile() stands
  // aside for a null auth.uid() and refuses a browser.
  await db.query(
    `insert into public.profiles (id, smk, name, email, mobile, zone_id, sub_zone_id, status)
     values ($1, 'FND001', 'Founder', 'founder@t.test', '9601269715', 'surat', 'varachha', 'ACTIVE')`,
    [U.founder]
  );
  await db.query('insert into public.bootstrap_admins (id, mobile) values ($1, $2)', [
    U.founder, '9601269715',
  ]);

  await db.query(
    `insert into public.profiles (id, smk, name, email, mobile, zone_id, sub_zone_id, status)
     values ($1, 'YVK002', 'Yuvak', 'yuvak@t.test', '9800000021', 'surat', 'varachha', 'ACTIVE')`,
    [U.yuvak]
  );

  for (const [id, name, role] of [
    [U.sooper, 'Super', 'SUPER_ADMIN'],
    [U.coordinator, 'Coordinator', 'COORDINATOR'],
    [U.admin, 'Admin', 'ADMIN'],
  ]) {
    await db.query(
      `insert into public.admins (id, email, name, role, status) values ($1, $2, $3, $4, 'ACTIVE')`,
      [id, `${name.toLowerCase()}@t.test`, name, role]
    );
  }

  /*
    The delegate's role. Created as the owner, because a custom role is exactly what a
    migration cannot know about and the panel has to be able to make — creating it here as a
    fixture is the closest a test gets to "the સંચાલક made this last Tuesday".

    Rank 70: below ADMIN's 80, so §F and §G can check that even a person holding roles.manage
    cannot reach upward.
  */
  await db.query(
    `insert into public.admin_roles (key, label, description, rank) values
     ('ACCESS_MANAGER', 'Access Manager', 'Runs the access screens and nothing else.', 70)`
  );
  await db.query(
    `insert into public.role_permissions (role_key, permission) values
     ('ACCESS_MANAGER', 'admins.read'),
     -- admins.update and admins.disable are here so the guard tests in §I actually reach the
     -- guard. Without them the RLS policy on public.admins filters the row out and the UPDATE
     -- affects zero rows *without erroring* - which is safe, and would have made four
     -- assertions about admins_guard() pass while testing the policy instead of the trigger.
     ('ACCESS_MANAGER', 'admins.update'),
     ('ACCESS_MANAGER', 'admins.disable'),
     ('ACCESS_MANAGER', 'roles.manage'),
     ('ACCESS_MANAGER', 'grants.manage'),
     ('ACCESS_MANAGER', 'roles.assign'),
     ('ACCESS_MANAGER', 'users.read'),
     ('ACCESS_MANAGER', 'progress.read')`
  );
  await db.query(
    `insert into public.admins (id, email, name, role, status)
     values ($1, 'delegate@t.test', 'Delegate', 'ACCESS_MANAGER', 'ACTIVE')`,
    [U.delegate]
  );
}

async function main() {
  if (!dockerAvailable()) {
    console.log('\n  SKIPPED - no docker daemon. This suite needs one to be honest.\n');
    return;
  }

  const { client: db, stop } = await startDatabase();
  try {
    await fixtures(db);

    // ══════════════════════════════════════════════════════════ §A
    group('§A  the seed is backward compatible');

    for (const role of Object.keys(BEFORE)) {
      const got = (await db.query(
        'select permission from public.role_permissions where role_key = $1 order by permission',
        [role]
      )).rows.map((r) => r.permission);
      eq(`${role} holds exactly what it held before, plus its splits`, got, expectedFor(role));
    }

    const catalogue = (await db.query('select key from public.permissions order by key')).rows
      .map((r) => r.key);
    const superSet = (await db.query(
      `select permission from public.role_permissions where role_key = 'SUPER_ADMIN' order by permission`
    )).rows.map((r) => r.permission);
    eq('SUPER_ADMIN holds the whole catalogue', superSet, [...catalogue].sort());

    // The nineteen names that appear in live policies must survive verbatim. A renamed
    // permission is a silently un-enforced one.
    for (const key of [
      'users.read', 'users.update', 'users.disable', 'users.test', 'users.purge',
      'progress.read', 'sessions.read',
      'darshan.read', 'darshan.create', 'darshan.update', 'darshan.disable',
      'settings.read', 'settings.update',
      'admins.read', 'admins.create', 'admins.update', 'admins.disable', 'roles.assign',
      'audit.read',
    ]) {
      ok(`the catalogue still carries ${key}`, catalogue.includes(key));
    }

    // VIEWER's defining property, from 0004: it holds nothing that ends in a mutating verb.
    // The splits are where that would break — points.config.update carved from settings.update
    // would have landed on VIEWER had the derivation named settings.read by mistake.
    const viewer = expectedFor('VIEWER');
    eq('VIEWER still holds no mutating permission',
      viewer.filter((p) => /\.(update|create|disable|assign|manage|adjust|purge|test)$/.test(p)), []);

    // ══════════════════════════════════════════════════════════ §B
    group('§B  the catalogue is written by migrations and by nothing else');

    /*
      Two different defences, and they refuse in two different ways. Both are asserted,
      because a test that accepted either would pass when one of them disappeared.

      An INSERT is refused by the trigger, with P0001 and a sentence. A BEFORE ROW trigger
      runs before the RLS WITH CHECK is evaluated, so the trigger gets there first and the
      missing INSERT policy behind it is never reached — two defences, and the one that
      answers is the one with something to say.

      An UPDATE or a DELETE never reaches the trigger at all. It meets the missing USING
      policy, which does not raise: it makes every row *invisible*, so the statement matches
      nothing and reports success over zero rows. That is entirely safe and it is not the same
      sentence, so it is asserted as what it is — nothing changed.

      Which leaves the trigger unproven for those two, and they are the two that matter most:
      service_role carries BYPASSRLS, sees every row, and is what a Netlify function holding
      the secret key runs as. The block below is that test.
    */
    await asUser(db, U.sooper, async () => {
      const added = await refuse(db, `insert into public.permissions (key, resource, verb, label)
                                      values ('users.delete', 'users', 'delete', 'Delete a યુવક')`);
      says('a SUPER_ADMIN cannot add a permission', added,
        'the permission catalogue is changed by a migration');
      eq('  and it is the trigger, not the policy, that says so', added.code, 'P0001');

      const renamed = await refuse(db, `update public.permissions set label = 'x' where key = 'users.read'`);
      eq('a rename reaches no row at all', renamed.count, 0);
      eq('  so the label is untouched',
        (await db.query(`select label from public.permissions where key = 'users.read'`)).rows[0].label,
        'See યુવકો');

      const deleted = await refuse(db, `delete from public.permissions where key = 'audit.read'`);
      eq('a delete reaches no row either', deleted.count, 0);
      eq('  so the permission survives',
        (await db.query(`select count(*)::int as n from public.permissions where key = 'audit.read'`)).rows[0].n, 1);
    });

    /*
      The case that matters, and the reason this is a trigger rather than only a policy.

      service_role carries BYPASSRLS, so every policy on this table is invisible to it. A
      secret key lives in netlify/functions/create-admin.js and in two seed scripts; if any of
      them could write here, the catalogue would be data with a write path and the argument
      the whole design rests on would be false.

      auth.uid() is null for service_role, though — which is the same test the trigger uses to
      let a migration through. So the check is run WITH a session user set, which is what an
      endpoint forwarding a caller's token actually looks like.
    */
    await db.query('begin');
    await db.query('set local role service_role');
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: U.sooper, role: 'service_role' }),
    ]);
    says('service_role cannot add a permission',
      await refuse(db, `insert into public.permissions (key, resource, verb, label)
                         values ('users.delete', 'users', 'delete', 'Delete a યુવક')`),
      'the permission catalogue is changed by a migration');
    // The two RLS could not answer. service_role sees every row, so here the trigger is
    // reached and raises rather than quietly matching nothing.
    says('service_role cannot rename one',
      await refuse(db, `update public.permissions set label = 'x' where key = 'users.read'`),
      'the permission catalogue is changed by a migration');
    says('service_role cannot delete one',
      await refuse(db, `delete from public.permissions where key = 'audit.read'`),
      'the permission catalogue is changed by a migration');
    await db.query('rollback');
    await db.query('reset role');

    /*
      An invented name cannot be granted either, and two defences stand in front of it.

      The outer one is role_permissions_guard(), which asks whether the caller holds the
      permission he is handing out — and nobody holds one that does not exist, so even a
      SUPER_ADMIN is refused here. The foreign key to public.permissions sits behind that and
      is unreachable through this path, which is the correct shape for defence in depth: the
      guard gives the sentence a person can act on, the constraint makes it structural.
    */
    await asUser(db, U.sooper, async () => {
      says('a permission that does not exist cannot be granted',
        await refuse(db, `insert into public.role_permissions (role_key, permission)
                          values ('COORDINATOR', 'users.delete')`),
        'you cannot grant a permission you do not hold yourself');
    });

    // ══════════════════════════════════════════════════════════ §C
    group('§C  role, then ALLOW, then DENY');

    await asUser(db, U.coordinator, async () => {
      eq('a COORDINATOR does not hold points.adjust by his role',
        (await db.query(`select public.has_permission('points.adjust') as r`)).rows[0].r, false);
    });

    await db.query(
      `insert into public.admin_grants (admin_id, permission, effect, reason)
       values ($1, 'points.adjust', 'ALLOW', 'ઉત્સવ - awards by hand for one month')`,
      [U.coordinator]
    );

    await asUser(db, U.coordinator, async () => {
      eq('an ALLOW adds it', (await db.query(`select public.has_permission('points.adjust') as r`)).rows[0].r, true);
      ok('and it appears in caller_permissions()',
        (await db.query('select public.caller_permissions() as p')).rows[0].p.includes('points.adjust'));
    });

    await db.query(
      `insert into public.admin_grants (admin_id, permission, effect, reason)
       values ($1, 'progress.read', 'DENY', 'moved off the reporting side')`,
      [U.coordinator]
    );

    await asUser(db, U.coordinator, async () => {
      eq('a DENY removes what the role granted',
        (await db.query(`select public.has_permission('progress.read') as r`)).rows[0].r, false);
      eq('  and the rest of the role is untouched',
        (await db.query(`select public.has_permission('users.read') as r`)).rows[0].r, true);
    });

    // DENY beats ALLOW, which is the only ordering under which a DENY means anything: a
    // person holding both rows must end up without the permission, or the exception screen
    // is offering a control that silently loses.
    await db.query(
      `insert into public.admin_grants (admin_id, permission, effect, reason)
       values ($1, 'sessions.read', 'ALLOW', 'granted')
       on conflict (admin_id, permission) do update set effect = 'ALLOW'`,
      [U.coordinator]
    );
    await db.query(
      `update public.admin_grants set effect = 'DENY' where admin_id = $1 and permission = 'sessions.read'`,
      [U.coordinator]
    );
    await asUser(db, U.coordinator, async () => {
      eq('DENY wins over a role that also grants it',
        (await db.query(`select public.has_permission('sessions.read') as r`)).rows[0].r, false);
    });

    // ══════════════════════════════════════════════════════════ §D
    group('§D  an expired grant is not a grant');

    await db.query(
      `insert into public.admin_grants (admin_id, permission, effect, reason, expires_at)
       values ($1, 'darshan.update', 'ALLOW', 'one week of ઉત્સવ', now() - interval '1 day')`,
      [U.coordinator]
    );
    await asUser(db, U.coordinator, async () => {
      eq('an expired ALLOW grants nothing',
        (await db.query(`select public.has_permission('darshan.update') as r`)).rows[0].r, false);
    });

    await db.query(
      `update public.admin_grants set expires_at = now() + interval '7 days'
       where admin_id = $1 and permission = 'darshan.update'`,
      [U.coordinator]
    );
    await asUser(db, U.coordinator, async () => {
      eq('the same row with a future expiry does grant it',
        (await db.query(`select public.has_permission('darshan.update') as r`)).rows[0].r, true);
    });

    // The row is still there, because it is a record of an access that was held. The panel
    // greys it rather than hiding it; the resolver ignores it.
    eq('the expired row was never deleted',
      (await db.query('select count(*)::int as n from public.admin_grants where admin_id = $1', [U.coordinator])).rows[0].n,
      4);

    // Suspending a person takes his exceptions with him. Otherwise re-enabling an account
    // silently restores every override it had, which is the kind of thing nobody re-checks.
    await db.query(`update public.admins set status = 'SUSPENDED' where id = $1`, [U.coordinator]);
    await asUser(db, U.coordinator, async () => {
      eq('a suspended administrator holds nothing at all',
        (await db.query('select public.caller_permissions() as p')).rows[0].p, []);
      eq('  not even his ALLOW grants',
        (await db.query(`select public.has_permission('points.adjust') as r`)).rows[0].r, false);
    });
    await db.query(`update public.admins set status = 'ACTIVE' where id = $1`, [U.coordinator]);

    // ══════════════════════════════════════════════════════════ §E
    group('§E  the bootstrap fallback cannot be edited away');

    await asUser(db, U.founder, async () => {
      eq('a founding account holds the whole catalogue',
        (await db.query('select array_length(public.caller_permissions(), 1) as n')).rows[0].n,
        catalogue.length);
      eq('and reads as SUPER_ADMIN',
        (await db.query('select public.effective_role() as r')).rows[0].r, 'SUPER_ADMIN');
    });

    /*
      The point of §E. He holds no `admins` row at all — his authority is entirely 0024's
      sealed allowlist — so there is nothing for the panel to edit, no role to break and no
      grant to deny. caller_permissions() reads bootstrap_admins first for exactly this.
    */
    eq('and he has no admins row to revoke',
      (await db.query('select count(*)::int as n from public.admins where id = $1', [U.founder])).rows[0].n, 0);

    await asUser(db, U.yuvak, async () => {
      eq('an ordinary યુવક holds nothing',
        (await db.query('select public.caller_permissions() as p')).rows[0].p, []);
      eq('  and is not an admin', (await db.query('select public.is_admin() as r')).rows[0].r, false);
    });

    // ══════════════════════════════════════════════════════════ §F
    group('§F  role_permissions_guard()');

    await asUser(db, U.admin, async () => {
      says('an ADMIN holds no roles.manage and cannot edit a role',
        await refuse(db, `insert into public.role_permissions (role_key, permission)
                           values ('VIEWER', 'users.update')`),
        'not permitted to create or edit roles');
    });

    await asUser(db, U.delegate, async () => {
      // The rule that stops roles.manage being a way to mint authority out of nothing. The
      // delegate does not hold users.purge, so he cannot put it on a role and then take it.
      says('nobody may grant a permission he does not hold himself',
        await refuse(db, `insert into public.role_permissions (role_key, permission)
                           values ('VIEWER', 'users.purge')`),
        'you cannot grant a permission you do not hold yourself');

      // He does hold admins.read, and VIEWER does not, so this one is allowed — the rule is
      // about escalation, not about roles.manage being decorative.
      const good = await refuse(db, `insert into public.role_permissions (role_key, permission)
                                      values ('VIEWER', 'admins.read')`);
      eq('but he may grant one he does hold', good.ok, true);

      says('SUPER_ADMIN is not editable, by anyone',
        await refuse(db, `delete from public.role_permissions
                           where role_key = 'SUPER_ADMIN' and permission = 'roles.manage'`),
        'the SUPER_ADMIN role always holds every permission');

      says('and nothing may be added to it either',
        await refuse(db, `insert into public.role_permissions (role_key, permission)
                           values ('SUPER_ADMIN', 'users.read')`),
        'the SUPER_ADMIN role always holds every permission');

      // ADMIN is rank 80; the delegate is 70. Reaching upward is the escalation the rank
      // system exists to stop, and it is what a custom role holding roles.manage would
      // otherwise do to take the panel.
      says('a role above his own rank is out of reach',
        await refuse(db, `insert into public.role_permissions (role_key, permission)
                           values ('ADMIN', 'users.purge')`),
        'you cannot change a role equal to or above your own');
    });

    await db.query(`delete from public.role_permissions
                    where role_key = 'VIEWER' and permission = 'admins.read'`);

    // ══════════════════════════════════════════════════════════ §G
    group('§G  admin_grants_guard()');

    await asUser(db, U.admin, async () => {
      says('an ADMIN holds no grants.manage',
        await refuse(db, `insert into public.admin_grants (admin_id, permission, effect, reason)
                           values ($1, 'users.read', 'ALLOW', 'x')`, [U.coordinator]),
        'not permitted to grant individual permissions');
    });

    await asUser(db, U.delegate, async () => {
      says('an administrator cannot grant himself anything',
        await refuse(db, `insert into public.admin_grants (admin_id, permission, effect, reason)
                           values ($1, 'users.purge', 'ALLOW', 'x')`, [U.delegate]),
        'an administrator cannot change their own access');

      says('nor grant what he does not hold',
        await refuse(db, `insert into public.admin_grants (admin_id, permission, effect, reason)
                           values ($1, 'users.purge', 'ALLOW', 'x')`, [U.coordinator]),
        'you cannot grant a permission you do not hold yourself');

      says('nor reach a person ranked at or above him',
        await refuse(db, `insert into public.admin_grants (admin_id, permission, effect, reason)
                           values ($1, 'users.read', 'ALLOW', 'x')`, [U.admin]),
        'you cannot change a role equal to or above your own');

      const good = await refuse(db, `insert into public.admin_grants (admin_id, permission, effect, reason)
                                      values ($1, 'admins.read', 'ALLOW', 'helps with the સંચાલક list')`,
        [U.coordinator]);
      eq('but he may grant downward what he holds', good.ok, true);

      // A DENY takes something away, and no rank is escalated by losing a permission — so it
      // is deliberately not subject to the hold-it-yourself rule.
      const deny = await refuse(db, `insert into public.admin_grants (admin_id, permission, effect, reason)
                                      values ($1, 'users.purge', 'DENY', 'never for a coordinator')`,
        [U.coordinator]);
      eq('and a DENY needs no such holding', deny.ok, true);
    });

    await db.query('delete from public.admin_grants where admin_id = $1 and permission in ($2, $3)',
      [U.coordinator, 'admins.read', 'users.purge']);

    // ══════════════════════════════════════════════════════════ §H
    group('§H  admin_roles_guard()');

    await asUser(db, U.delegate, async () => {
      says('a built-in role cannot be renamed',
        await refuse(db, `update public.admin_roles set key = 'WATCHER' where key = 'VIEWER'`),
        'a built-in role cannot be renamed or deleted');

      says('a built-in role cannot be deleted',
        await refuse(db, `delete from public.admin_roles where key = 'VIEWER'`),
        'a built-in role cannot be renamed or deleted');

      says('nothing may be created at or above his own rank',
        await refuse(db, `insert into public.admin_roles (key, label, rank)
                           values ('RIVAL', 'Rival', 70)`),
        'you cannot change a role equal to or above your own');

      const good = await refuse(db, `insert into public.admin_roles (key, label, rank)
                                      values ('ZONE_LEAD', 'Zone Lead', 45)`);
      eq('but a role below him is allowed', good.ok, true);

      eq('and it is never created as a system role',
        (await db.query(`select is_system from public.admin_roles where key = 'ZONE_LEAD'`)).rows[0].is_system,
        false);
    }, { commit: true });

    // A role with members names the number, rather than letting the foreign key refuse with a
    // message nobody can act on.
    await db.query(`update public.admins set role = 'ZONE_LEAD' where id = $1`, [U.coordinator]);
    await asUser(db, U.delegate, async () => {
      says('a role with members cannot be deleted',
        await refuse(db, `delete from public.admin_roles where key = 'ZONE_LEAD'`),
        'move the 1 administrator(s) holding this role before deleting it');
    });
    await db.query(`update public.admins set role = 'COORDINATOR' where id = $1`, [U.coordinator]);

    await asUser(db, U.delegate, async () => {
      const gone = await refuse(db, `delete from public.admin_roles where key = 'ZONE_LEAD'`);
      eq('an empty custom role deletes cleanly', gone.ok, true);
    }, { commit: true });

    // ══════════════════════════════════════════════════════════ §I
    group('§I  admins_guard(), with ranks');

    await asUser(db, U.delegate, async () => {
      // 0004's original sentence, still exactly as two other suites assert it.
      says('only a SUPER_ADMIN may change a SUPER_ADMIN',
        await refuse(db, `update public.admins set status = 'DISABLED' where id = $1`, [U.sooper]),
        'only a SUPER_ADMIN may change a SUPER_ADMIN');

      says('and only a SUPER_ADMIN may grant it',
        await refuse(db, `update public.admins set role = 'SUPER_ADMIN' where id = $1`, [U.coordinator]),
        'only a SUPER_ADMIN may grant SUPER_ADMIN');

      // The generalisation 0043 adds: ADMIN is rank 80 and the delegate is 70.
      says('an ADMIN is out of reach of a lower-ranked delegate',
        await refuse(db, `update public.admins set role = 'VIEWER' where id = $1`, [U.admin]),
        'you cannot change a role equal to or above your own');

      says('and he cannot hand out a role at or above his own',
        await refuse(db, `update public.admins set role = 'ADMIN' where id = $1`, [U.coordinator]),
        'you cannot grant a role equal to or above your own');
    });

    // A SUPER_ADMIN cannot change his own role or status, whoever he is. This is 0004's rule
    // and it is what stops the last one locking himself out by accident.
    await asUser(db, U.sooper, async () => {
      says('a Super Admin cannot demote himself',
        await refuse(db, `update public.admins set role = 'ADMIN' where id = $1`, [U.sooper]),
        'an administrator cannot change their own role or status');
    });

    /*
      The last-Super-Admin rule, reached by the only route that *can* reach it.

      Every other caller is refused earlier and for a different reason: a lower-ranked
      administrator by "only a SUPER_ADMIN may change a SUPER_ADMIN", and the man himself by
      the self rule just above. What is left is a caller who resolves to SUPER_ADMIN without
      being the row being demoted — which is precisely a bootstrap account, and precisely the
      recovery path 0024 exists to keep open.

      So this is not a contrived arrangement to reach a branch. It is the real scenario: the
      founder, holding the sealed fallback, tries to demote the one working SUPER_ADMIN, and
      the database stops him from leaving the panel with nobody able to administer it.
    */
    await asUser(db, U.founder, async () => {
      says('and the last one cannot be demoted even by a founding account',
        await refuse(db, `update public.admins set role = 'ADMIN' where id = $1`, [U.sooper]),
        'there must always be one active Super Admin');

      says('nor suspended',
        await refuse(db, `update public.admins set status = 'DISABLED' where id = $1`, [U.sooper]),
        'there must always be one active Super Admin');
    });

    // With a second one in place the rule stands aside, which is the half that proves it is a
    // count and not a blanket refusal to touch the role.
    await db.query(`insert into auth.users (id, email) values ($1, 'second@t.test')`,
      ['20000000-0000-4000-8000-000000000009']);
    await asUser(db, U.sooper, async () => {
      const made = await refuse(db,
        `insert into public.admins (id, email, name, role, status)
         values ($1, 'second@t.test', 'Second', 'SUPER_ADMIN', 'ACTIVE')`,
        ['20000000-0000-4000-8000-000000000009']);
      eq('a Super Admin may appoint a second one', made.ok, true);

      const demoted = await refuse(db, `update public.admins set role = 'ADMIN' where id = $1`, [U.sooper]);
      // Still refused, but now by the self rule rather than by the count - he is demoting
      // himself. The count is checked below, by somebody else.
      says('  and he still may not demote himself', demoted,
        'an administrator cannot change their own role or status');

      const other = await refuse(db, `update public.admins set role = 'ADMIN' where id = $1`,
        ['20000000-0000-4000-8000-000000000009']);
      eq('  but the second one may now be demoted, because one remains', other.ok, true);
    });

    // ══════════════════════════════════════════════════════════ §J
    group('§J  admin_session() answers in one call');

    await asUser(db, U.delegate, async () => {
      const s = (await db.query('select * from public.admin_session()')).rows[0];
      eq('it names the role', s.role, 'ACCESS_MANAGER');
      eq('and its label, which no bundle could know', s.role_label, 'Access Manager');
      eq('and the rank', s.rank, 70);
      eq('and is not a bootstrap account', s.is_bootstrap, false);
      ok('and carries the resolved permission list', s.permissions.includes('roles.manage'));
    });

    await asUser(db, U.founder, async () => {
      const s = (await db.query('select * from public.admin_session()')).rows[0];
      eq('a founding account is marked as one', s.is_bootstrap, true);
    });

    await asUser(db, U.yuvak, async () => {
      eq('and a યુવક gets no row at all',
        (await db.query('select * from public.admin_session()')).rows.length, 0);
    });

    // ══════════════════════════════════════════════════════════ §K
    group('§K  every change to access lands in the trail');

    /*
      The writes are committed, and the trail is then read as the owner rather than as the man
      who wrote it.

      Not a convenience. ACCESS_MANAGER deliberately does not hold `audit.read` — it is the
      panel's most sensitive read and a role that manages access has no need of it — so the
      delegate cannot see his own entries, and asking him would test the audit_logs SELECT
      policy while appearing to test the triggers. What is being asserted here is that the
      rows exist and say the right thing, which is a question about the database and not about
      any caller's permissions.
    */
    await asUser(db, U.delegate, async () => {
      await db.query(`insert into public.admin_roles (key, label, rank) values ('AUDITED', 'Audited', 20)`);
      await db.query(`insert into public.role_permissions (role_key, permission) values ('AUDITED', 'users.read')`);
      await db.query(`delete from public.role_permissions where role_key = 'AUDITED' and permission = 'users.read'`);
      await db.query(`insert into public.admin_grants (admin_id, permission, effect, reason)
                      values ($1, 'users.read', 'ALLOW', 'trail check')`, [U.coordinator]);
    }, { commit: true });

    const acts = (await db.query(
      `select action from public.audit_logs where actor_id = $1 order by at`, [U.delegate]
    )).rows.map((r) => r.action);

    ok('ROLE_CREATED is recorded', acts.includes('ROLE_CREATED'));
    ok('ROLE_PERMISSION_GRANTED is recorded', acts.includes('ROLE_PERMISSION_GRANTED'));
    ok('ROLE_PERMISSION_REVOKED is recorded', acts.includes('ROLE_PERMISSION_REVOKED'));
    ok('GRANT_ADDED is recorded', acts.includes('GRANT_ADDED'));

    // Attributed from auth.uid(), never from an argument, and carrying the role held at the
    // time — so a demotion later does not rewrite what the trail says he was.
    const row = (await db.query(
      `select actor_role, resource_type from public.audit_logs
       where actor_id = $1 and action = 'ROLE_CREATED' limit 1`, [U.delegate])).rows[0];
    eq('  under the role he held at the time', row?.actor_role, 'ACCESS_MANAGER');
    eq('  against the table it happened to', row?.resource_type, 'admin_roles');

    // And the permission entries name the role they moved, not just "something changed".
    const permRow = (await db.query(
      `select target_id, "after" ->> 'permission' as perm from public.audit_logs
       where actor_id = $1 and action = 'ROLE_PERMISSION_GRANTED' limit 1`, [U.delegate])).rows[0];
    eq('  a permission entry names the role', permRow?.target_id, 'AUDITED');
    eq('  and the permission that moved', permRow?.perm, 'users.read');

    // ══════════════════════════════════════════════════════════ §L
    group('§L  the split permissions are enforced, not just grantable');

    /*
      A role holding exactly one report permission and nothing else.

      This is the case the whole split exists for — "he may see the leaderboard and nothing
      else" — and it is the case that would silently not work if the catalogue had been
      extended without re-issuing the functions behind the screens. The role editor would offer
      the tick box, the sidebar would show the entry, and the page would come back refused.
    */
    await db.query(
      `insert into public.admin_roles (key, label, rank) values ('BOARD_ONLY', 'Board Only', 15)`
    );
    /*
      `users.read` alongside it, and that is not padding.

      Every one of these reports returns names, so admin_can_report() requires users.read on top
      of the report permission — 0029's rule, deliberately not relaxed by the split. A role that
      may read the ranking must be a role that may read people; the fine permission chooses
      *which report*, never whether names are visible at all.
    */
    await db.query(
      `insert into public.role_permissions (role_key, permission)
       values ('BOARD_ONLY', 'points.leaderboard.read'), ('BOARD_ONLY', 'users.read')`
    );
    await db.query(`insert into auth.users (id, email) values ($1, 'board@t.test')`,
      ['20000000-0000-4000-8000-00000000000b']);
    await db.query(
      `insert into public.admins (id, email, name, role, status)
       values ($1, 'board@t.test', 'Board', 'BOARD_ONLY', 'ACTIVE')`,
      ['20000000-0000-4000-8000-00000000000b']);

    await asUser(db, '20000000-0000-4000-8000-00000000000b', async () => {
      eq('he does not hold progress.read',
        (await db.query(`select public.has_permission('progress.read') as r`)).rows[0].r, false);

      const board = await refuse(db, `select * from public.admin_leaderboard(null, null, null, null, 10)`);
      eq('the leaderboard opens on points.leaderboard.read alone', board.ok, true);

      // And nothing else does. The ledger is the sharpest of the five - every point
      // transaction of every યુવક - and it is the one the coarse permission used to hand over
      // along with the ranking.
      const ledger = await refuse(db,
        `select * from public.admin_point_transactions(null, null, null, null, null, null, null, null, null, 1, 10)`);
      eq('but the point ledger does not', ledger.ok, false);
      eq('  and it refuses with 42501 rather than returning nothing', ledger.code, '42501');
      ok('  naming the permission he is missing', String(ledger.message).includes('points.ledger.read'));
    });

    /*
      The other half, and the one that decides whether this migration was safe to ship: the
      coarse permission on its own still opens every screen it used to.

      This needs a role holding `progress.read` and none of the five splits, which the seeded
      roles deliberately are not — 0043 gives every role that held the coarse permission all
      five fine ones, precisely so nobody loses a screen. So the case is built here, and it is
      not contrived: it is what a role created *after* today looks like when somebody ticks
      "See progress" and nothing else, and it is the whole reason admin_can_report() tests the
      coarse permission first.
    */
    await db.query(
      `insert into public.admin_roles (key, label, rank) values ('COARSE_ONLY', 'Coarse Only', 16)`
    );
    await db.query(
      `insert into public.role_permissions (role_key, permission)
       values ('COARSE_ONLY', 'progress.read'), ('COARSE_ONLY', 'users.read')`
    );
    await db.query(`insert into auth.users (id, email) values ($1, 'coarse@t.test')`,
      ['20000000-0000-4000-8000-00000000000c']);
    await db.query(
      `insert into public.admins (id, email, name, role, status)
       values ($1, 'coarse@t.test', 'Coarse', 'COARSE_ONLY', 'ACTIVE')`,
      ['20000000-0000-4000-8000-00000000000c']);

    await asUser(db, '20000000-0000-4000-8000-00000000000c', async () => {
      eq('a role with progress.read and none of the splits',
        (await db.query('select public.caller_permissions() as p')).rows[0].p,
        ['progress.read', 'users.read']);

      const ledger = await refuse(db,
        `select * from public.admin_point_transactions(null, null, null, null, null, null, null, null, null, 1, 10)`);
      eq('  still opens the ledger, on the coarse permission alone', ledger.ok, true);

      const board = await refuse(db, `select * from public.admin_leaderboard(null, null, null, null, 10)`);
      eq('  and the leaderboard', board.ok, true);

      const records = await refuse(db,
        `select * from public.admin_daily_records(null, null, null, null, null, null, null, null, null, null, 1, 10)`);
      eq('  and the daily records', records.ok, true);
    });
    // ══════════════════════════════════════════════════════════ §M
    group('§M  what the /access screens read (0044)');

    /*
      The claim that matters: the screen explaining the gate describes the same gate.

      admin_effective_permissions() and has_permission() must agree permission for permission,
      and they do by construction — both resolve through permissions_of(). Construction is what
      is being tested: if somebody later "optimises" one of them into its own query, this is
      what fails, and it fails against every permission in the catalogue rather than against a
      sample.
    */
    /*
      Every call below runs inside asUser().

      admin_effective_permissions() is gated on `admins.read`, and the table owner holds no
      role at all — auth.uid() is NULL for it, so it is nobody. Reading as the owner returned
      an empty set, which is the function working correctly and the test asking the wrong
      question. This is the same trap the whole suite exists to avoid: RLS and these gates are
      invisible to the role that owns the tables.
    */
    const subject = U.coordinator;

    const claimed = await asUser(db, U.sooper, async () =>
      (await db.query(
        `select permission from public.admin_effective_permissions($1)
         where source <> 'denied' order by permission`, [subject]
      )).rows.map((r) => r.permission)
    );

    const actual = await asUser(db, subject, async () =>
      (await db.query('select unnest(public.caller_permissions()) as p order by 1')).rows.map((r) => r.p)
    );

    eq('the screen and the gate agree, permission for permission',
      [...claimed].sort(), [...actual].sort());

    // A denial is returned as well, because a list of what he holds cannot explain why he is
    // missing something the rest of his role has. §C left a DENY on progress.read standing.
    const deniedRows = await asUser(db, U.sooper, async () =>
      (await db.query(
        `select permission from public.admin_effective_permissions($1) where source = 'denied'`, [subject]
      )).rows.map((r) => r.permission)
    );
    ok('a denied permission is reported as denied', deniedRows.includes('progress.read'));
    ok('  and is absent from what he actually holds', !actual.includes('progress.read'));

    // A founding account is attributed to the allowlist rather than to a role it may not even
    // have - U.founder holds no admins row at all.
    const bootRows = await asUser(db, U.sooper, async () =>
      (await db.query(
        `select distinct source from public.admin_effective_permissions($1)`, [U.founder]
      )).rows.map((r) => r.source)
    );
    eq('a founding account is attributed to the bootstrap allowlist', bootRows, ['bootstrap']);

    // And a person may always ask about himself, without admins.read - he can see his own
    // access on every screen he opens anyway, and refusing it would make the panel unable to
    // tell somebody what he may do.
    await asUser(db, subject, async () => {
      eq('a person may always read his own access',
        (await db.query(
          `select count(*)::int as n from public.admin_effective_permissions($1)`, [subject]
        )).rows[0].n > 0,
        true);
    });

    // Reading somebody else's access is reading the સંચાલક list. An ordinary યુવક holds
    // neither, and asking about himself is allowed - he can see his own access anyway.
    await asUser(db, U.yuvak, async () => {
      eq("a યુવક cannot read another person's access",
        (await db.query('select count(*)::int as n from public.admin_effective_permissions($1)', [subject])).rows[0].n,
        0);
    });

    /*
      admin_role_usage() counts past the RLS policy on public.admins.

      The policy is `id = auth.uid() or has_permission('admins.read')`, so a browser-side
      `count(*) group by role` returns 1 for a caller without it. A role editor that said
      "this affects 1 administrator" when it affects nine is worse than one that said nothing,
      because somebody would believe it.
    */
    const owned = (await db.query(
      `select count(*)::int as n from public.admins where role = 'COORDINATOR'`
    )).rows[0].n;

    await asUser(db, U.delegate, async () => {
      const seen = (await db.query(
        `select members from public.admin_role_usage() where role_key = 'COORDINATOR'`
      )).rows[0]?.members;
      eq('the member count is the real one, not the readable one', seen, owned);
    });

    await asUser(db, U.yuvak, async () => {
      eq('and it answers nobody without admins.read or roles.manage',
        (await db.query('select count(*)::int as n from public.admin_role_usage()')).rows[0].n, 0);
    });

    // ══════════════════════════════════════════════════════════ §N
    group('§N  an appointment made by mistake can be undone (0045)');

    /*
      The whole round trip, on a real યુવક with a learning record.

      U.yuvak has a profiles row and has been an ordinary યુવક for the length of this file. He
      is appointed, which is what the panel's "Give an existing user access" button does, and
      then the appointment is undone.

      The assertion that matters is not that his permissions go away — effective_role() has
      filtered on status since 0038 and that was never in doubt. It is that he comes back to
      `public.yuvaks`, because that view is what every count, list, ranking, export and report
      means by "યુવક", and before 0045 an appointment removed him from all of them permanently.
    */
    const inRoll = async (id) =>
      (await db.query('select count(*)::int as n from public.yuvaks where id = $1', [id])).rows[0].n === 1;

    ok('before: he is an ordinary યુવક and is in the roll', await inRoll(U.yuvak));

    await asUser(db, U.sooper, async () => {
      const made = await refuse(db,
        `insert into public.admins (id, email, name, role, status)
         values ($1, 'yuvak@t.test', 'Yuvak', 'VIEWER', 'ACTIVE')`, [U.yuvak]);
      eq('he can be appointed from his existing account', made.ok, true);
    }, { commit: true });

    ok('appointed: he has left the યુવક roll', !(await inRoll(U.yuvak)));

    /*
      Suspending and disabling do NOT bring him back, and that is asserted rather than assumed.

      This is the exact defect 0045 was written for: both statuses stop his panel access and
      neither returns him to the roll, because admin_account_ids() excludes ACTIVE, SUSPENDED
      and DISABLED alike. Somebody who appointed a યુવક by mistake and then "turned it off"
      would have believed he had fixed it.
    */
    for (const s of ['SUSPENDED', 'DISABLED']) {
      await db.query(`update public.admins set status = $2 where id = $1`, [U.yuvak, s]);
      ok(`${s} still leaves him out of the roll`, !(await inRoll(U.yuvak)));
    }

    /*
      Revoked by a person, not by the owner.

      The two statuses above are set as the table owner because those assertions are only about
      the roll. This one has to be attributed: audit_admin() returns early when auth.uid() is
      NULL — correctly, since a migration is not an administrative act — so a revoke performed
      as the owner would write no trail entry, and the ADMIN_REVOKED assertion at the end of
      this group would fail for a reason that has nothing to do with the trigger.
    */
    await asUser(db, U.sooper, async () => {
      const undone = await refuse(db,
        `update public.admins set status = 'REVOKED' where id = $1`, [U.yuvak]);
      eq('the appointment can be undone', undone.ok, true);
    }, { commit: true });

    ok('REVOKED puts him back in the યુવક roll', await inRoll(U.yuvak));

    await asUser(db, U.yuvak, async () => {
      eq('  and he holds no role at all',
        (await db.query('select public.effective_role() as r')).rows[0].r, null);
      eq('  and no permissions',
        (await db.query('select public.caller_permissions() as p')).rows[0].p, []);
    });

    // Nothing was deleted. The row survives so the trail keeps who appointed him and who
    // undid it - 0038's "never delete" is not weakened by any of this.
    eq('the admins row is kept, not deleted',
      (await db.query('select count(*)::int as n from public.admins where id = $1', [U.yuvak])).rows[0].n, 1);
    eq('and his profile is untouched',
      (await db.query('select smk from public.profiles where id = $1', [U.yuvak])).rows[0].smk, 'YVK002');

    /*
      Coming back out of REVOKED is an appointment, not a re-enablement.

      The delegate holds admins.update and admins.disable — enough to move anybody between the
      other three states — and does not hold admins.create. Without this rule he could put back
      anybody who had ever been an administrator, which is a quieter road to the authority
      admins.create governs.
    */
    await asUser(db, U.delegate, async () => {
      says('restoring a revoked administrator asks for admins.create',
        await refuse(db, `update public.admins set status = 'ACTIVE' where id = $1`, [U.yuvak]),
        'restoring a revoked administrator is an appointment');
    });

    await asUser(db, U.sooper, async () => {
      const back = await refuse(db, `update public.admins set status = 'ACTIVE' where id = $1`, [U.yuvak]);
      eq('a SUPER_ADMIN may appoint him again', back.ok, true);
    }, { commit: true });

    ok('and he leaves the roll again', !(await inRoll(U.yuvak)));

    // The trail tells the two apart. ADMIN_DISABLED and ADMIN_REVOKED mean different things
    // about the same person and only one of them changes every report.
    const lifecycle = (await db.query(
      `select action from public.audit_logs where resource_type = 'admins' and target_id = $1`,
      [U.yuvak]
    )).rows.map((r) => r.action);
    ok('ADMIN_REVOKED is recorded as itself', lifecycle.includes('ADMIN_REVOKED'));
    ok('and ADMIN_RESTORED is not called ADMIN_ENABLED', lifecycle.includes('ADMIN_RESTORED'));
  } finally {
    await stop();
  }

  console.log(`\n  ${pass} passed, ${fails.length} failed\n`);
  for (const f of fails) console.log(`  FAIL  ${f}\n`);
  if (fails.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
