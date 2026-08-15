/**
 * A સંચાલક is not a યુવક — against a real Postgres.
 *
 *     VARNI_PGTEST_PORT=54833 VARNI_PGTEST_IMAGE=postgres:16-alpine node scripts/test-admins.mjs
 *
 * ────────────────────────────────────────────────────────────────────────────
 * What 0038 changed, and why none of it is checkable by reading
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Until 0038, `admin_profiles.id` referenced `public.profiles (id)`. An administrator therefore
 * had to be a યુવક first — with an SMK, a સબઝોન, and above all a `mobile`, which is NOT NULL,
 * UNIQUE and immutable. That is where admin@varni.com's permanent placeholder 9999999999 came
 * from, and it is why every "total registered" figure on the dashboard counted the people
 * running the panel.
 *
 * 0038 keys `public.admins` off `auth.users` instead. The claim being tested here is precisely
 * this: **an administrator with no profiles row is a complete, working administrator** — and not
 * one that works until the first governed write, or until a report is run, or until an audit
 * trigger fires.
 *
 * That last one is the reason this file exists rather than a paragraph in the migration.
 * `audit_logs.actor_id` referenced `profiles(id)`, and the audit triggers run inside the same
 * transaction as the change they record. A profile-less administrator would have passed every
 * permission check, been shown every screen, and then failed on the INSERT of his own audit row
 * — taking the દ્રશ્ય edit with it, with a foreign key violation naming a table nobody was
 * looking at. §D is that case, and it is the whole reason 0038 repoints the constraint.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * The groups
 * ────────────────────────────────────────────────────────────────────────────
 *
 *  §A  A profile-less administrator holds his role. effective_role() and has_permission()
 *      answer for an id that appears in no યુવક table at all.
 *  §B  `public.yuvaks` excludes administrators — for every role, not just the ones that can
 *      read `admins`. The exclusion goes through a SECURITY DEFINER function precisely so a
 *      COORDINATOR (users.read, no admins.read) sees the same roll an ADMIN sees.
 *  §C  Both at once is still allowed. The founding account is a real યુવક and a SUPER_ADMIN;
 *      it keeps its learning record and is excluded from the roll.
 *  §D  A profile-less administrator can make a governed change, and it lands in audit_logs.
 *  §E  admins_guard(), carried over from 0004 whole: self-appointment, self-promotion, and
 *      granting SUPER_ADMIN. Asserted by SQLSTATE and by message, because "some error" would
 *      pass on a database where the guard had been deleted and a grant happened to refuse.
 *  §F  Deletion is refused for everyone, service_role included — disable, never delete.
 *  §G  `admins.mobile` is optional, and unique only among the rows that have one.
 *  §H  The `admin_profiles` compatibility view writes through to the base table, with every
 *      trigger firing. This is what the other eight suites are still standing on.
 *  §I  actor_names() answers only for a caller holding audit.read.
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
const refusedWith = (name, res, codes) => {
  const want = Array.isArray(codes) ? codes : [codes];
  if (!res.ok && want.includes(res.code)) pass++;
  else if (res.ok) fails.push(`${name}\n       got  the statement SUCCEEDED\n       want ${want.join('/')}`);
  else fails.push(`${name}\n       got  ${res.code} ${res.message.slice(0, 90)}\n       want ${want.join('/')}`);
};
const says = (name, res, fragment) => {
  if (!res.ok && String(res.message).includes(fragment)) pass++;
  else if (res.ok) fails.push(`${name}\n       got  the statement SUCCEEDED\n       want "${fragment}"`);
  else fails.push(`${name}\n       got  ${res.message.slice(0, 90)}\n       want "${fragment}"`);
};
const group = (t) => console.log(`\n  ${t}\n`);

const U = {
  // No profiles row at any point. The subject of this whole file.
  lone: '10000000-0000-4000-8000-000000000001',
  // An administrator who is also a યુવક, as the founding account is.
  both: '10000000-0000-4000-8000-000000000002',
  // Ordinary yuvaks.
  yuvakA: '10000000-0000-4000-8000-000000000003',
  yuvakB: '10000000-0000-4000-8000-000000000004',
  // users.read but NOT admins.read — the role the yuvaks view has to behave the same for.
  coordinator: '10000000-0000-4000-8000-000000000005',
  // A VIEWER, who holds neither admins.create nor admins.update.
  viewer: '10000000-0000-4000-8000-000000000006',
};

async function fixtures(db) {
  // Every id needs an auth.users row; only some of them get a profile. That asymmetry is the
  // point of the migration and so it is the shape of the fixture.
  for (const [key, id] of Object.entries(U)) {
    await db.query('insert into auth.users (id, email) values ($1, $2)', [id, `${key}@t.test`]);
  }

  const withProfile = [
    [U.both, 'BTH001', 'Founder Both', '9800000011'],
    [U.yuvakA, 'YVA002', 'Yuvak A', '9800000012'],
    [U.yuvakB, 'YVB003', 'Yuvak B', '9800000013'],
    [U.coordinator, 'CRD004', 'Coordinator', '9800000014'],
    [U.viewer, 'VWR005', 'Viewer', '9800000015'],
  ];
  for (const [id, smk, name, mobile] of withProfile) {
    await db.query(
      `insert into public.profiles (id, smk, name, email, mobile, zone_id, sub_zone_id, status)
       values ($1, $2, $3, $4, $5, 'surat', 'varachha', 'ACTIVE')`,
      [id, smk, name, `${smk.toLowerCase()}@t.test`, mobile]
    );
  }

  // U.lone deliberately gets NO profile. Written straight to the new table with an identity of
  // its own, which is the thing that was impossible before 0038.
  await db.query(
    `insert into public.admins (id, email, name, role, status)
     values ($1, 'lone@t.test', 'Lone Admin', 'SUPER_ADMIN', 'ACTIVE')`,
    [U.lone]
  );
  await db.query(
    `insert into public.admins (id, email, name, mobile, role, status)
     values ($1, 'both@t.test', 'Founder Both', '9800000011', 'SUPER_ADMIN', 'ACTIVE')`,
    [U.both]
  );
  await db.query(
    `insert into public.admins (id, email, name, role, status)
     values ($1, 'coordinator@t.test', 'Coordinator', 'COORDINATOR', 'ACTIVE')`,
    [U.coordinator]
  );
  await db.query(
    `insert into public.admins (id, email, name, role, status)
     values ($1, 'viewer@t.test', 'Viewer', 'VIEWER', 'ACTIVE')`,
    [U.viewer]
  );

  await db.query(
    `insert into public.scenes (id, "index", "order", active, caption)
     select 'd-' || lpad(g::text, 3, '0'), g, g, true, 'scene ' || g
     from generate_series(1, 5) g`
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
    group('§A  an administrator with no profile still holds his role');

    await asUser(db, U.lone, async () => {
      eq('effective_role() answers for a profile-less admin',
        (await db.query('select public.effective_role() as r')).rows[0].r, 'SUPER_ADMIN');
      eq('has_permission(users.read) is true',
        (await db.query(`select public.has_permission('users.read') as r`)).rows[0].r, true);
      eq('is_admin() is true',
        (await db.query('select public.is_admin() as r')).rows[0].r, true);
      // The whole claim, stated as the database sees it.
      eq('and he has no profiles row at all',
        (await db.query('select count(*)::int as n from public.profiles where id = $1', [U.lone])).rows[0].n, 0);
      // He can read the roll, which is what users.read is for.
      eq('he can read the yuvaks he administers',
        (await db.query('select count(*)::int as n from public.yuvaks')).rows[0].n > 0, true);
    });

    await asUser(db, U.yuvakA, async () => {
      eq('an ordinary યુવક still has no role',
        (await db.query('select public.effective_role() as r')).rows[0].r, null);
    });

    // ══════════════════════════════════════════════════════════ §B
    group('§B  public.yuvaks excludes administrators, for every role');

    const totalProfiles = (await db.query('select count(*)::int as n from public.profiles')).rows[0].n;
    eq('five profiles exist in the base table', totalProfiles, 5);

    // U.both, U.coordinator and U.viewer are all administrators with profiles, so the roll is
    // the two ordinary yuvaks and nobody else.
    for (const [who, id] of [['a SUPER_ADMIN', U.lone], ['a COORDINATOR', U.coordinator]]) {
      await asUser(db, id, async () => {
        const rows = (await db.query('select id from public.yuvaks order by id')).rows.map((r) => r.id);
        eq(`${who} sees exactly the two ordinary yuvaks`, rows, [U.yuvakA, U.yuvakB]);
      });
    }

    // The point of routing the exclusion through a SECURITY DEFINER function. A COORDINATOR
    // cannot read public.admins at all — and must still get the same roll.
    await asUser(db, U.coordinator, async () => {
      eq('a COORDINATOR cannot read the admins table',
        (await db.query('select count(*)::int as n from public.admins')).rows[0].n, 1); // his own row only
    });

    // ══════════════════════════════════════════════════════════ §C
    group('§C  an administrator may also be a યુવક, and keeps that record');

    eq('the founding account has both rows',
      (await db.query(
        `select (select count(*) from public.profiles where id = $1)
              + (select count(*) from public.admins   where id = $1) as n`, [U.both])).rows[0].n, '2');

    await asUser(db, U.lone, async () => {
      eq('and is excluded from the roll all the same',
        (await db.query('select count(*)::int as n from public.yuvaks where id = $1', [U.both])).rows[0].n, 0);
    });

    // ══════════════════════════════════════════════════════════ §D
    group('§D  a profile-less administrator can make a governed change');

    await asUser(db, U.lone, async () => {
      // The case the old audit_logs FK would have broken: the trigger writes actor_id = an id
      // with no profiles row, inside this same transaction.
      const res = await attempt(db, `update public.scenes set caption = 'edited' where id = 'd-001'`);
      eq('the દ્રશ્ય edit succeeds', res.ok && res.count, 1);

      const trail = await db.query(
        `select actor_id, actor_role, resource_type from public.audit_logs
         where resource_type = 'scenes' order by at desc limit 1`
      );
      eq('and the audit row names him as the actor', trail.rows[0]?.actor_id, U.lone);
      eq('with the role he acted as', trail.rows[0]?.actor_role, 'SUPER_ADMIN');
    });

    // Appointing somebody is itself audited, on the new table's own trigger.
    await asUser(db, U.lone, async () => {
      await db.query(
        `insert into public.admins (id, email, name, role) values ($1, 'yb@t.test', 'Yuvak B', 'VIEWER')`,
        [U.yuvakB]
      );
      const trail = await db.query(
        `select action, resource_type from public.audit_logs where target_id = $1 order by at desc limit 1`,
        [U.yuvakB]
      );
      eq('appointing an administrator is audited as ROLE_ASSIGNED', trail.rows[0]?.action, 'ROLE_ASSIGNED');
      eq('against the new table name', trail.rows[0]?.resource_type, 'admins');
    });

    // ══════════════════════════════════════════════════════════ §E
    group('§E  admins_guard(), carried over from 0004 whole');

    // P0001 and not 42501: a BEFORE INSERT trigger runs before the policy's WITH CHECK is
    // evaluated, so the guard speaks first and the RLS refusal underneath it is never reached.
    // Both are present; which one answers is a fact about ordering, and asserting the wrong one
    // would make this test fail the day the other was removed.
    await asUser(db, U.yuvakA, async () => {
      const res = await attempt(db,
        `insert into public.admins (id, email, name, role) values ($1, 'x@t.test', 'X', 'VIEWER')`,
        [U.yuvakB]);
      refusedWith('a યુવક cannot appoint anybody', res, 'P0001');
      says('and is told why', res, 'not permitted to manage administrators');
    });

    await asUser(db, U.lone, async () => {
      const res = await attempt(db,
        `insert into public.admins (id, email, name, role) values ($1, 'self@t.test', 'Self', 'SUPER_ADMIN')`,
        [U.lone]);
      says('an administrator cannot appoint themselves', res, 'cannot appoint themselves');
    });

    await asUser(db, U.lone, async () => {
      const res = await attempt(db,
        `update public.admins set role = 'VIEWER' where id = $1`, [U.lone]);
      says('nor change their own role', res, 'cannot change their own role or status');
    });

    await asUser(db, U.viewer, async () => {
      // A VIEWER holds no admins.update, so RLS filters the row out before the guard is
      // reached: zero rows, not a raise. Asserted as such, because they are different defences.
      const res = await attempt(db, `update public.admins set role = 'SUPER_ADMIN' where id = $1`, [U.viewer]);
      eq('a VIEWER cannot promote himself (RLS, not the guard)', res.ok && res.count, 0);
    });

    /*
      "only a SUPER_ADMIN may grant SUPER_ADMIN" — and the two layers that enforce it, told apart.

      `permissions_for()` gives `admins.update` to SUPER_ADMIN and to nobody else, so through
      PostgREST an ADMIN never reaches an admins row to begin with: the UPDATE policy filters it
      out and the statement reports zero rows. The guard's SUPER_ADMIN branch is therefore
      unreachable from a browser, which is exactly what defence in depth means and exactly why a
      test must not confuse the two — asserting only the zero-row outcome would go on passing
      after the guard was deleted.

      So it is asserted twice. Once as an ordinary caller (RLS holds), and once as the **owner**,
      where privileges cannot refuse anything and a refusal can only have come from the trigger
      body itself. The claims are set by hand without switching role, which is how
      scripts/test-level3-auth.mjs separates a grant from a guard.
    */
    await asUser(db, U.lone, async () => {
      await db.query(`update public.admins set role = 'ADMIN' where id = $1`, [U.viewer]);
    }, { commit: true });

    await asUser(db, U.viewer, async () => {
      const res = await attempt(db,
        `update public.admins set role = 'SUPER_ADMIN' where id = $1`, [U.coordinator]);
      eq('an ADMIN cannot reach the row at all (RLS)', res.ok && res.count, 0);
    });

    await db.query('begin');
    await db.query(`select set_config('request.jwt.claims', $1, true)`,
      [JSON.stringify({ sub: U.viewer, role: 'authenticated' })]);
    const grantAttempt = await attempt(db,
      `update public.admins set role = 'SUPER_ADMIN' where id = $1`, [U.coordinator]);
    refusedWith('and the guard refuses it even where RLS cannot', grantAttempt, 'P0001');
    /*
      The message is "not permitted to manage administrators", NOT "only a SUPER_ADMIN may grant
      SUPER_ADMIN" — and that is worth writing down rather than fixing.

      The guard tests `admins.update` before it tests the role being granted, and `admins.update`
      belongs to SUPER_ADMIN alone (0004:80-95). So every caller who could possibly reach the
      SUPER_ADMIN branch already holds the role that branch checks for, and the branch is
      unreachable under today's matrix. It is not dead code: it is what stands there the day a
      role is given `admins.update` without `roles.assign`, which is a plausible future edit to
      permissions_for() and one that would otherwise silently make ADMIN able to mint
      SUPER_ADMINs. Asserted as refused; the sentence is the earlier rule's, correctly.
    */
    says('by the first rule that applies', grantAttempt, 'not permitted to manage administrators');
    await db.query('rollback');

    // ══════════════════════════════════════════════════════════ §F
    group('§F  disable, never delete');

    // Two defences again, and again they answer differently. There is no DELETE policy on
    // `admins`, so a signed-in caller's delete matches no row and the trigger never fires -
    // zero rows, not a refusal. The trigger is what stops the caller RLS cannot: the owner.
    await asUser(db, U.lone, async () => {
      const res = await attempt(db, 'delete from public.admins where id = $1', [U.coordinator]);
      eq('no DELETE policy exists, so a SUPER_ADMIN deletes nothing', res.ok && res.count, 0);
    });

    // The owner is what service_role is on a Supabase project. A missing DELETE policy would not
    // stop it; the trigger does, and that difference is the assertion.
    refusedWith('and neither can the owner',
      await attempt(db, 'delete from public.admins where id = $1', [U.coordinator]), 'P0001');

    await asUser(db, U.lone, async () => {
      const res = await attempt(db, `update public.admins set status = 'DISABLED' where id = $1`, [U.coordinator]);
      eq('disabling is the supported way', res.ok && res.count, 1);
    });

    // Committed, so the next block sees it on its own connection state - the point is what the
    // disabled administrator himself can do afterwards.
    await asUser(db, U.lone, async () => {
      await db.query(`update public.admins set status = 'DISABLED' where id = $1`, [U.coordinator]);
    }, { commit: true });

    await asUser(db, U.coordinator, async () => {
      eq('a DISABLED administrator holds nothing',
        (await db.query('select public.effective_role() as r')).rows[0].r, null);
    });

    // ══════════════════════════════════════════════════════════ §G
    group('§G  admins.mobile is optional');

    eq('the lone admin has no mobile and is legal',
      (await db.query('select mobile from public.admins where id = $1', [U.lone])).rows[0].mobile, null);

    // Two rows with no number do not collide: the UNIQUE index is partial.
    const second = await attempt(db,
      `insert into public.admins (id, email, name, role) values ($1, 'ya@t.test', 'Yuvak A', 'VIEWER')`,
      [U.yuvakA]);
    eq('a second administrator with no mobile is accepted', second.ok, true);

    refusedWith('but two cannot share one number',
      await attempt(db, `update public.admins set mobile = '9800000011' where id = $1`, [U.yuvakA]), '23505');

    refusedWith('and a malformed number is refused',
      await attempt(db, `update public.admins set mobile = '0000000000' where id = $1`, [U.yuvakA]), '23514');

    // ══════════════════════════════════════════════════════════ §H
    group('§H  the admin_profiles compatibility view writes through');

    // This is what the other eight pg-backed suites are standing on until they are rewritten.
    const viaView = await attempt(db,
      `insert into public.admin_profiles (id, role, status) values ($1, 'VIEWER', 'ACTIVE')`,
      ['10000000-0000-4000-8000-000000000099']);
    eq('an unknown id is still refused by the auth.users FK', viaView.ok, false);

    await db.query('insert into auth.users (id, email) values ($1, $2)',
      ['10000000-0000-4000-8000-000000000099', 'shim@t.test']);

    const shim = await attempt(db,
      `insert into public.admin_profiles (id, role, status) values ($1, 'VIEWER', 'ACTIVE')`,
      ['10000000-0000-4000-8000-000000000099']);
    eq('a write through the view succeeds', shim.ok, true);

    // admins_fill_identity() is what makes that possible: the view cannot carry email or name,
    // and both columns are NOT NULL on the base table.
    const filled = await db.query(
      'select email, name from public.admins where id = $1', ['10000000-0000-4000-8000-000000000099']);
    eq('and the identity was filled in from auth.users', filled.rows[0]?.email, 'shim@t.test');
    eq('with a name derived from the address', filled.rows[0]?.name, 'shim');

    refusedWith('deleting through the view is refused too',
      await attempt(db, 'delete from public.admin_profiles where id = $1',
        ['10000000-0000-4000-8000-000000000099']), 'P0001');

    // ══════════════════════════════════════════════════════════ §I
    group('§I  actor_names() is gated on audit.read');

    await asUser(db, U.lone, async () => {
      const rows = (await db.query('select id, name, kind from public.actor_names($1::uuid[])',
        [[U.lone, U.yuvakA]])).rows;
      eq('a SUPER_ADMIN gets both kinds back', rows.length, 2);
      eq('and the administrator is labelled as one',
        rows.find((r) => r.id === U.lone)?.kind, 'admin');
    });

    await asUser(db, U.yuvakA, async () => {
      eq('an ordinary યુવક gets nothing',
        (await db.query('select count(*)::int as n from public.actor_names($1::uuid[])',
          [[U.lone, U.yuvakA]])).rows[0].n, 0);
    });

    await asAnon(db, async () => {
      const res = await attempt(db, 'select * from public.actor_names($1::uuid[])', [[U.lone]]);
      eq('and an anonymous visitor is refused or told nothing', res.ok ? res.rows.length : 0, 0);
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
