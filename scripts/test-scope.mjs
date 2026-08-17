/**
 * A સંચાલક limited to a zone sees that zone — against a real Postgres, as the person he is.
 *
 *     VARNI_PGTEST_PORT=54833 node scripts/test-scope.mjs
 *
 * ────────────────────────────────────────────────────────────────────────────
 * What 0051 claims, and why none of it can be tested in JavaScript
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Every line of the narrowing is inside the database: a view the reports read, twelve
 * RESTRICTIVE policies, a raise inside four SECURITY DEFINER functions, and a BEFORE trigger.
 * None of it is reachable from a browser and none of it is reachable from a mock. A suite that
 * stubbed the Supabase client to check "a વરાછા coordinator cannot read વેડરોડ" would be
 * asserting that the stub returns what the author typed into it.
 *
 * So this puts on `authenticated`, sets the JWT claim, and asks.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * The one property everything else depends on
 * ────────────────────────────────────────────────────────────────────────────
 *
 * **No rows means every zone.** §A is the whole of that claim and is deliberately first: if it
 * ever fails, 0051 applied to production would have blanked the panel for every administrator
 * in the સંઘ at once, and every other group in this file would still pass.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * The groups
 * ────────────────────────────────────────────────────────────────────────────
 *
 *  §A  Nothing changes for anybody unrestricted, including while somebody else IS restricted.
 *  §B  caller_scope() and in_caller_scope() answer for each kind of caller.
 *  §C  The population: scoped_profiles, and the `yuvaks` view the Users list reads.
 *  §D  The reports - progress, leaderboard, daily records, filter options - are disjoint.
 *  §E  The tables a browser can read directly, which the reports do not go through.
 *  §F  A યુવક's own reads, and the app's own leaderboard, are untouched.
 *  §G  A named person outside the zones is REFUSED, not answered with a blank document.
 *  §H  The guard: scope.assign, never yourself, never a SUPER_ADMIN - and the audit row.
 *  §I  A bootstrap account is never scoped, whatever rows exist for him.
 *  §J  admin_session() carries the scope, and NULL means every zone.
 *  §K  geography()'s counts are the caller's own.
 *  §L  The property, not the instance: every table with a progress.read policy has a
 *      restrictive scope policy beside it. This is what catches the thirteenth table.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { asUser, attempt, dockerAvailable, startDatabase } from './lib/pgtest.mjs';

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
  else fails.push(`${name}\n       got  ${res.message.slice(0, 120)}\n       want "${fragment}"`);
};
const group = (t) => console.log(`\n  ${t}\n`);

/* A savepoint per refusal, so a group can check several rules inside one asUser() transaction
   without the first refusal aborting the rest. Same helper, same reason, as
   test-rbac-dynamic.mjs - see its note. */
let sp = 0;
async function refuse(db, sql, params = []) {
  const name = `sp_${++sp}`;
  await db.query(`savepoint ${name}`);
  const res = await attempt(db, sql, params);
  if (res.ok) await db.query(`release savepoint ${name}`);
  else await db.query(`rollback to savepoint ${name}`);
  return res;
}

const U = {
  /** SUPER_ADMIN. Holds scope.assign, and is the one account that may never be scoped. */
  sooper: '30000000-0000-4000-8000-000000000001',
  /** An ADMIN with no scope rows. The control: everything he sees must not move. */
  wide: '30000000-0000-4000-8000-000000000002',
  /** A VIEWER scoped to વરાછા alone. The subject of most of this file. */
  one: '30000000-0000-4000-8000-000000000003',
  /** A COORDINATOR scoped to વરાછા and વેડરોડ. Proves a scope is a set and not one zone. */
  two: '30000000-0000-4000-8000-000000000004',
  /** A founding account: a §3 mobile, so 0024 claims him for bootstrap_admins. */
  founder: '30000000-0000-4000-8000-000000000005',

  /** Three યુવકો, one per zone. */
  yVarachha: '30000000-0000-4000-8000-00000000000a',
  yVedroad: '30000000-0000-4000-8000-00000000000b',
  yKatargam: '30000000-0000-4000-8000-00000000000c',
};

/** Which zone each યુવક is in, so an expectation can be written as a place rather than a uuid. */
const WHERE = {
  [U.yVarachha]: 'varachha',
  [U.yVedroad]: 'vedroad',
  [U.yKatargam]: 'katargam',
};

async function fixtures(db) {
  for (const [key, id] of Object.entries(U)) {
    await db.query('insert into auth.users (id, email) values ($1, $2)', [id, `${key}@scope.test`]);
  }

  /*
    A third open zone, added the way a સંઘ adds one since 0050: a row.

    નવસારી is seeded RETIRED and cannot take a new યુવક - profiles_guard_geography() refuses it -
    so a test needing three populated zones has to open one. Doing it as the owner rather than
    reopening નવસારી keeps the seeded rows exactly as the migration left them, so a later suite
    reading them is not reading this file's edits.
  */
  await db.query(
    `insert into public.zones (id, city_id, name, status, sort_order)
     values ('katargam', 'surat', 'કતારગામ', 'ACTIVE', 4)`
  );

  const yuvak = async (id, smk, name, mobile, zone) =>
    db.query(
      `insert into public.profiles (id, smk, name, email, mobile, zone_id, sub_zone_id, status)
       values ($1, $2, $3, $4, $5, 'surat', $6, 'ACTIVE')`,
      [id, smk, name, `${smk.toLowerCase()}@scope.test`, mobile, zone]
    );

  await yuvak(U.yVarachha, 'SCP001', 'Varachha Yuvak', '9811100001', 'varachha');
  await yuvak(U.yVedroad, 'SCP002', 'Vedroad Yuvak', '9811100002', 'vedroad');
  await yuvak(U.yKatargam, 'SCP003', 'Katargam Yuvak', '9811100003', 'katargam');

  // The founder needs a profile carrying a §3 number, which is how 0024's allowlist claims him.
  await db.query(
    `insert into public.profiles (id, smk, name, email, mobile, zone_id, sub_zone_id, status)
     values ($1, 'SCP004', 'Founder', 'founder@scope.test', '9601269715', 'surat', 'varachha', 'ACTIVE')`,
    [U.founder]
  );
  await db.query('insert into public.bootstrap_admins (id, mobile) values ($1, $2)', [
    U.founder,
    '9601269715',
  ]);

  /*
    Two of the administrators are also `profiles` rows, and that is a requirement rather than
    colour.

    `point_transactions.admin_id` is a foreign key to `profiles`, so an administrator with no
    profile cannot award points at all - the insert fails 23503 before any scope rule is
    consulted, and §G would then be passing for the wrong reason. 0038's own note says an
    administrator may be a genuine યુવક and the founding account is one, so this is the ordinary
    case rather than a contrivance.

    They are placed in zones on purpose: the SUPER_ADMIN in વેડરોડ and the two-zone COORDINATOR
    in કતારગામ, which is a zone he is NOT scoped to. A coordinator who lives outside his patch
    is realistic, and it keeps his own row out of every population this file counts.
  */
  await yuvak(U.sooper, 'SCP005', 'Sooper', '9811100005', 'vedroad');
  await yuvak(U.two, 'SCP006', 'Two', '9811100006', 'katargam');

  const admin = async (id, name, role) =>
    db.query(
      `insert into public.admins (id, email, name, role, status)
       values ($1, $2, $3, $4, 'ACTIVE')`,
      [id, `${name.toLowerCase()}@scope.test`, name, role]
    );

  await admin(U.sooper, 'Sooper', 'SUPER_ADMIN');
  await admin(U.wide, 'Wide', 'ADMIN');
  await admin(U.one, 'One', 'VIEWER');
  await admin(U.two, 'Two', 'COORDINATOR');
  // The founder holds an ordinary role in `admins`; his power comes from bootstrap_admins.
  await admin(U.founder, 'Founder', 'ADMIN');

  /*
    A day of progress and a ledger row for each યુવક, so §E has something to be refused.

    Written as the owner, which is how every fixture in this suite is written: RLS is skipped
    for the table owner, so the rows exist regardless of the policies being tested - which is
    the point, since what is being tested is who can READ them.
  */
  for (const id of [U.yVarachha, U.yVedroad, U.yKatargam]) {
    await db.query(
      `insert into public.progress (user_id, date, level3_score) values ($1, current_date, 10)`,
      [id]
    );
    await db.query(
      `insert into public.point_transactions
         (user_id, activity_date, level_id, activity_key, points, source, source_id)
       values ($1, current_date, 3, 'revision', 5, 'ACTIVITY_ATTEMPT', 1)`,
      [id]
    );
  }

  // The scopes themselves, written as the owner - admin_scopes_guard() stands aside for a null
  // auth.uid(), exactly as it is designed to, and §H tests the guard through a real caller.
  await db.query(`insert into public.admin_scopes (admin_id, zone_id) values ($1, 'varachha')`, [U.one]);
  await db.query(
    `insert into public.admin_scopes (admin_id, zone_id) values ($1, 'varachha'), ($1, 'vedroad')`,
    [U.two]
  );
}

/** Every યુવક this caller can see, by zone, from whichever surface is being asked about. */
const zonesOf = (rows) => [...new Set(rows.map((r) => r.sub_zone_id || r.zone_id))].sort();

async function main() {
  if (!dockerAvailable()) {
    console.log('\n  Docker is not available - skipped.\n');
    console.log('  This suite needs a real Postgres. Start Docker and run it again.\n');
    process.exit(0);
  }

  console.log('\n  Zone scope (0051)\n');
  const { client: db, stop } = await startDatabase();

  try {
    await fixtures(db);

    // ───────────────────────────────────────────────────────── §A no rows means every zone
    group('§A  An administrator with no scope rows is unrestricted');

    await asUser(db, U.wide, async () => {
      const seen = await db.query(`select id, sub_zone_id from public.scoped_profiles`);
      eq('A1  scoped_profiles gives an unscoped ADMIN every zone', zonesOf(seen.rows), [
        'katargam',
        'varachha',
        'vedroad',
      ]);

      const y = await db.query(`select id, sub_zone_id from public.yuvaks order by smk`);
      eq('A2  the Users list is unchanged for him', zonesOf(y.rows), [
        'katargam',
        'varachha',
        'vedroad',
      ]);

      const s = await db.query(`select public.caller_scope() as s`);
      eq('A3  caller_scope() is NULL, not an empty array', s.rows[0].s, null);
    });

    await asUser(db, U.sooper, async () => {
      const seen = await db.query(`select id, sub_zone_id from public.scoped_profiles`);
      eq('A4  and for the SUPER_ADMIN, while two other people ARE scoped', zonesOf(seen.rows), [
        'katargam',
        'varachha',
        'vedroad',
      ]);
    });

    // ───────────────────────────────────────────────────────── §B the two resolvers
    group('§B  caller_scope() and in_caller_scope()');

    await asUser(db, U.one, async () => {
      const s = await db.query(`select public.caller_scope() as s`);
      eq('B1  one zone', s.rows[0].s, ['varachha']);
      const yes = await db.query(`select public.in_caller_scope('varachha') as a,
                                         public.in_caller_scope('vedroad')  as b`);
      eq('B2  his own zone is in scope', yes.rows[0].a, true);
      eq('B3  another zone is not', yes.rows[0].b, false);
    });

    await asUser(db, U.two, async () => {
      const s = await db.query(`select public.caller_scope() as s`);
      eq('B4  a scope is a set, sorted', s.rows[0].s, ['varachha', 'vedroad']);
      const r = await db.query(`select public.in_caller_scope('katargam') as a`);
      eq('B5  a zone in neither is out', r.rows[0].a, false);
    });

    await asUser(db, U.yVarachha, async () => {
      const s = await db.query(`select public.caller_scope() as s`);
      eq('B6  an ordinary યુવક is unrestricted, which is what makes §F true', s.rows[0].s, null);
    });

    // ───────────────────────────────────────────────────────── §C the population
    group('§C  The population a scoped caller enumerates');

    await asUser(db, U.one, async () => {
      const seen = await db.query(`select id, sub_zone_id from public.scoped_profiles`);
      eq('C1  scoped_profiles is વરાછા only', zonesOf(seen.rows), ['varachha']);

      /*
        `yuvaks` and not `scoped_profiles` for the count, because the two mean different things
        and this is the one place the difference shows. `scoped_profiles` is every ACCOUNT in
        the zone - which includes the founder, who is an administrator with a real profile.
        `yuvaks` is the population the Users list, the counts and every export mean by યુવક:
        administrators removed (0038), test accounts removed (0040), and now other zones
        removed as well.
      */
      const y = await db.query(`select id, sub_zone_id from public.yuvaks`);
      eq('C2  the Users list is the one યુવક in વરાછા', y.rows.length, 1);
      eq('C3  and it is filtered through the restrictive policy on profiles', zonesOf(y.rows), [
        'varachha',
      ]);

      const one = await db.query(`select id from public.profiles where id = $1`, [U.yVedroad]);
      eq('C4  another zone’s profile is not readable at all', one.rows.length, 0);
    });

    await asUser(db, U.two, async () => {
      const seen = await db.query(`select id, sub_zone_id from public.scoped_profiles`);
      eq('C5  two zones for the two-zone coordinator', zonesOf(seen.rows), ['varachha', 'vedroad']);
      eq('C6  and not the third', seen.rows.some((r) => r.sub_zone_id === 'katargam'), false);
    });

    // ───────────────────────────────────────────────────────── §D the reports
    group('§D  The reports return disjoint populations');

    /*
      `admin_progress_report()` is a `returns table`, so it is read with `select * from` and its
      zone arrives as the aliased `zone_id` column - `p.sub_zone_id as zone_id`, which every
      report in this schema aliases the same way because 0001's two column names are the wrong
      way round (0050's header).
    */
    const reportZones = (rows) =>
      [...new Set(rows.map((r) => r.zone_id))].filter(Boolean).sort();

    /** The panel's leaderboard is jsonb with a `rows` array, and the same alias inside it. */
    const docZones = (doc) =>
      [...new Set((doc?.rows || []).map((r) => r.zoneId || r.zone_id))].filter(Boolean).sort();

    await asUser(db, U.one, async () => {
      const p = await db.query(`select * from public.admin_progress_report()`);
      eq('D1  the progress report is વરાછા only', reportZones(p.rows), ['varachha']);

      const l = await db.query(`select public.admin_leaderboard() as d`);
      const lz = docZones(l.rows[0].d);
      // The board may legitimately be empty for a zone with no points this period; what must
      // never appear is another zone.
      eq('D2  the panel leaderboard never names another zone', lz.filter((z) => z !== 'varachha'), []);

      const f = await db.query(`select public.admin_progress_filter_options() as d`);
      const zones = (f.rows[0].d?.zones || f.rows[0].d?.subZones || []).map((z) => z.id || z);
      eq('D3  the filter offers no zone he cannot open', zones.filter((z) => z && z !== 'varachha'), []);
    });

    await asUser(db, U.wide, async () => {
      const p = await db.query(`select * from public.admin_progress_report()`);
      eq('D4  and the unscoped ADMIN still sees all three', reportZones(p.rows), [
        'katargam',
        'varachha',
        'vedroad',
      ]);
    });

    // ───────────────────────────────────────────────────────── §E the tables themselves
    group('§E  The tables a browser reads directly');

    await asUser(db, U.one, async () => {
      const pr = await db.query(`select user_id from public.progress`);
      eq('E1  progress rows are his zone only', pr.rows.map((r) => WHERE[r.user_id]).sort(), [
        'varachha',
      ]);

      const pt = await db.query(`select user_id from public.point_transactions`);
      eq('E2  and the ledger', pt.rows.map((r) => WHERE[r.user_id]).sort(), ['varachha']);
    });

    await asUser(db, U.wide, async () => {
      const pt = await db.query(`select user_id from public.point_transactions`);
      eq('E3  unchanged for an unscoped ADMIN', pt.rows.length, 3);
    });

    // ───────────────────────────────────────────────────────── §F the યુવક app
    group('§F  Nothing about the yuvak app moves');

    await asUser(db, U.yVedroad, async () => {
      const me = await db.query(`select id from public.profiles where id = $1`, [U.yVedroad]);
      eq('F1  a યુવક still reads his own profile', me.rows.length, 1);

      const mine = await db.query(`select user_id from public.progress`);
      eq('F2  and his own progress', mine.rows.length, 1);
    });

    /*
      The app's own ranking is one board for the whole સંઘ, and asking two યુવકો in two
      different zones is how that is checked from the outside.

      A scoped સંચાલક cannot be used for this comparison and the reason is worth writing down
      rather than working around: `leaderboard()` refuses anybody who is not an active યુવક
      (0048 - `leaderboard_not_active`), and an administrator appointed through `admins` has no
      profile at all. So the caller who could be scoped is a caller this function already turns
      away, and the structural half below is what actually pins the exclusion.
    */
    let boardForVedroad = null;
    await asUser(db, U.yVedroad, async () => {
      const b = await db.query(`select public.leaderboard() as d`);
      boardForVedroad = JSON.stringify(b.rows[0].d);
    });
    await asUser(db, U.yVarachha, async () => {
      const b = await db.query(`select public.leaderboard() as d`);
      eq('F3  two યુવકો in two zones are shown the same board', JSON.stringify(b.rows[0].d) === boardForVedroad, true);
    });

    const appBoard = await db.query(`
      select pg_get_functiondef(p.oid) like '%public.counted_profiles%' as unscoped
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
      where ns.nspname = 'public' and p.proname = 'leaderboard' and p.prokind = 'f'
    `);
    eq('F4  and public.leaderboard() was deliberately left out of 0051’s re-issue',
      appBoard.rows.map((r) => r.unscoped), [true]);

    // ───────────────────────────────────────────────────────── §G one named person
    group('§G  A named person outside the zones is refused, not blanked');

    await asUser(db, U.one, async () => {
      const own = await attempt(db, `select public.admin_user_progress_detail($1) as d`, [U.yVarachha]);
      ok('G1  his own zone still opens', own.ok);

      const other = await refuse(db, `select public.admin_user_progress_detail($1)`, [U.yVedroad]);
      says('G2  another zone raises rather than returning an empty document', other,
        'this yuvak is not in a zone you look after');
      eq('G3  and it is 42501, the same code a permission refusal uses', other.code, '42501');

      const rec = await refuse(db, `select public.admin_daily_record_detail($1, current_date)`, [U.yKatargam]);
      says('G4  the daily record detail too', rec, 'this yuvak is not in a zone you look after');

      const l3 = await refuse(db, `select public.admin_user_level3_detail($1)`, [U.yVedroad]);
      says('G5  and the લેવલ ૩ detail', l3, 'this yuvak is not in a zone you look after');
    });

    await asUser(db, U.sooper, async () => {
      const award = await refuse(
        db,
        `select public.admin_award_manual_points($1, 5, 'a reason')`,
        [U.yVedroad]
      );
      ok('G6  an unscoped SUPER_ADMIN may still award points anywhere', award.ok);
    });

    /*
      The write, refused. `settings.update` is what admin_award_manual_points() asks for, and
      the two-zone COORDINATOR does not hold it - so he is given it as an individual grant
      first, and the refusal that follows is provably about the ZONE rather than about the
      permission he was missing anyway.
    */
    await db.query(
      `insert into public.admin_grants (admin_id, permission, effect, reason)
       values ($1, 'settings.update', 'ALLOW', 'so the scope refusal is the only one left')`,
      [U.two]
    );
    await asUser(db, U.two, async () => {
      const inside = await refuse(
        db,
        `select public.admin_award_manual_points($1, 5, 'a reason')`,
        [U.yVarachha]
      );
      ok('G7  he may award inside his zones', inside.ok);

      const outside = await refuse(
        db,
        `select public.admin_award_manual_points($1, 5, 'a reason')`,
        [U.yKatargam]
      );
      says('G8  and never outside them', outside, 'this yuvak is not in a zone you look after');
    });
    await db.query(`delete from public.admin_grants where admin_id = $1`, [U.two]);

    // ───────────────────────────────────────────────────────── §H the guard
    group('§H  Who may write a scope');

    await asUser(db, U.wide, async () => {
      const r = await refuse(
        db,
        `insert into public.admin_scopes (admin_id, zone_id) values ($1, 'katargam')`,
        [U.one]
      );
      ok('H1  an ADMIN without scope.assign is refused', !r.ok);
    });

    await asUser(db, U.sooper, async () => {
      const self = await refuse(
        db,
        `insert into public.admin_scopes (admin_id, zone_id) values ($1, 'varachha')`,
        [U.sooper]
      );
      says('H2  nobody may scope himself', self, 'an administrator cannot change their own access');

      const sup = await refuse(
        db,
        `insert into public.admin_scopes (admin_id, zone_id) values ($1, 'varachha')`,
        [U.sooper]
      );
      ok('H3  and that is true of a SUPER_ADMIN whoever asks', !sup.ok);

      const good = await attempt(
        db,
        `insert into public.admin_scopes (admin_id, zone_id) values ($1, 'katargam')`,
        [U.one]
      );
      ok('H4  a SUPER_ADMIN may scope somebody else', good.ok);

      const by = await db.query(
        `select granted_by from public.admin_scopes where admin_id = $1 and zone_id = 'katargam'`,
        [U.one]
      );
      eq('H5  granted_by is taken from auth.uid(), never from the client', by.rows[0]?.granted_by, U.sooper);

      const trail = await db.query(
        `select action, resource_type from public.audit_logs
         where action = 'SCOPE_CHANGED' order by id desc limit 1`
      );
      eq('H6  and the change is in the trail', trail.rows[0], {
        action: 'SCOPE_CHANGED',
        resource_type: 'admin_scopes',
      });

      const unknown = await refuse(
        db,
        `insert into public.admin_scopes (admin_id, zone_id) values ($1, 'nowhere')`,
        [U.two]
      );
      eq('H7  a zone that does not exist is refused by the foreign key', unknown.code, '23503');
    });

    // A second SUPER_ADMIN cannot be scoped by anybody, tested from the owner's side too:
    // the guard binds a session user and stands aside for a migration, which is the documented
    // behaviour rather than a hole - a migration is not a person.
    await asUser(db, U.two, async () => {
      const r = await refuse(
        db,
        `insert into public.admin_scopes (admin_id, zone_id) values ($1, 'varachha')`,
        [U.sooper]
      );
      ok('H8  a COORDINATOR cannot scope the SUPER_ADMIN either', !r.ok);
    });

    // ───────────────────────────────────────────────────────── §I bootstrap
    group('§I  A bootstrap account is never scoped');

    await db.query(`insert into public.admin_scopes (admin_id, zone_id) values ($1, 'varachha')`, [
      U.founder,
    ]);
    await asUser(db, U.founder, async () => {
      const s = await db.query(`select public.caller_scope() as s`);
      eq('I1  caller_scope() is NULL for him despite the row', s.rows[0].s, null);

      const seen = await db.query(`select id, sub_zone_id from public.scoped_profiles`);
      eq('I2  so 0024’s recovery path still sees the whole સંઘ', zonesOf(seen.rows), [
        'katargam',
        'varachha',
        'vedroad',
      ]);
    });
    await db.query(`delete from public.admin_scopes where admin_id = $1`, [U.founder]);

    // ───────────────────────────────────────────────────────── §J the session
    group('§J  admin_session() carries it');

    await asUser(db, U.one, async () => {
      const s = await db.query(`select * from public.admin_session()`);
      // વરાછા alone: §H's extra zone for this same person was written inside an asUser()
      // transaction, which always rolls back, so nothing that group did survives into this one.
      eq('J1  the scope is in the one call the panel already makes', s.rows[0].scope, ['varachha']);
      eq('J2  beside the role it already returned', s.rows[0].role, 'VIEWER');
    });

    await asUser(db, U.wide, async () => {
      const s = await db.query(`select * from public.admin_session()`);
      eq('J3  and it is NULL for everybody unrestricted', s.rows[0].scope, null);
    });

    await asUser(db, U.yVarachha, async () => {
      const s = await db.query(`select * from public.admin_session()`);
      eq('J4  an ordinary યુવક still gets no row at all', s.rows.length, 0);
    });

    // ───────────────────────────────────────────────────────── §K the counts
    group('§K  geography() counts what the caller may see');

    await asUser(db, U.two, async () => {
      const g = await db.query(`select public.geography() as d`);
      const zones = Object.fromEntries((g.rows[0].d.zones || []).map((z) => [z.id, z.yuvaks]));
      eq('K1  his own zones are counted', [zones.varachha, zones.vedroad], [1, 1]);
      eq('K2  a zone he cannot see counts zero rather than one', zones.katargam, 0);
      ok('K3  and its NAME is still returned, because a યુવક there has to print with it',
        (g.rows[0].d.zones || []).some((z) => z.id === 'katargam'));
    });

    await asUser(db, U.wide, async () => {
      const g = await db.query(`select public.geography() as d`);
      const zones = Object.fromEntries((g.rows[0].d.zones || []).map((z) => [z.id, z.yuvaks]));
      eq('K4  unchanged for an unscoped caller', [zones.varachha, zones.vedroad, zones.katargam], [1, 1, 1]);
    });

    // ───────────────────────────────────────────────────────── §L the property
    group('§L  Every table a scoped caller could read directly has the policy');

    const governed = await db.query(`
      select distinct p.tablename
      from pg_policies p
      where p.schemaname = 'public'
        and p.permissive = 'PERMISSIVE'
        and coalesce(p.qual, '') like '%progress.read%'
      order by 1
    `);

    const scoped = await db.query(`
      select tablename from pg_policies
      where schemaname = 'public' and policyname = 'zone scope limits this'
    `);
    const have = new Set(scoped.rows.map((r) => r.tablename));

    /*
      The one exception, stated rather than filtered silently.

      `daily_activity_counts` carries a progress.read policy and has no `user_id` of its own -
      it hangs off `daily_activity_records` by `record_id`. 0051 scopes it through the parent,
      so it IS in `have`; it is named here only so that a reader can see the pair matched.
    */
    const missing = governed.rows.map((r) => r.tablename).filter((t) => !have.has(t));
    eq('L1  no table is governed by progress.read without a scope policy beside it', missing, []);

    ok('L2  and the profiles table has its own', have.has('profiles'));

    const restrictive = await db.query(`
      select count(*)::int n from pg_policies
      where schemaname = 'public' and policyname = 'zone scope limits this'
        and permissive <> 'RESTRICTIVE'
    `);
    eq('L3  every one of them is RESTRICTIVE - a permissive one would WIDEN access', restrictive.rows[0].n, 0);

    /*
      And the reporting surface, asked of the schema rather than of a list in this file. A
      report added next year that reads counted_profiles directly would be unscoped, and
      0051's discovery loop only runs once - at migration time.
    */
    const unscopedReports = await db.query(`
      select f.proname
      from (
        select p.oid, p.proname from pg_proc p
        join pg_namespace ns on ns.oid = p.pronamespace
        where ns.nspname = 'public' and p.prokind = 'f' and p.proname like 'admin\\_%'
        offset 0
      ) f
      where pg_get_functiondef(f.oid) like '%public.counted_profiles%'
      order by 1
    `);
    eq('L4  no admin_* report still enumerates the unscoped population',
      unscopedReports.rows.map((r) => r.proname), []);

    // ───────────────────────────────────────────────────────── §M the CRLF defect
    group('§M  0051 applies to a schema whose function bodies have CRLF line endings');

    /*
      The defect this group exists for, reproduced.

      0051 §4 injects the scope check into four functions by finding an anchor inside each live
      body. The first version matched literal strings and one anchor spanned a line break
      written as `chr(10)`. Every suite passed, and applying it to production failed:

          P0001 [0051] the scope check could not be injected into:
                admin_user_level3_detail(p_user uuid, p_limit integer)

      A stored function body carries whatever newline the file it was created from had. On a
      Windows checkout git leaves CRLF on disk and scripts/db.mjs reads the file byte for byte,
      so production's bodies contain `\r\n` and an anchor containing `\n` matched nothing. The
      function was fine; the anchor was too literal to survive a checkout on another machine.

      Docker could never have caught it, because this repository's files are LF here. So the
      condition is manufactured: the four bodies are stripped of the check and rewritten with
      CRLF, and then the real 0051 - read off disk, not a paraphrase of it - is applied again.
      That is the production failure, in a container, in about a second.
    */
    /*
      The root cause on its own, in one statement, so the group below cannot be read as
      "something to do with Windows" by whoever meets it next.

      A literal anchor carrying `chr(10)` does not match a body whose lines end `\r\n`; a
      pattern that joins its tokens with `\s+` matches both. That is the entire defect, and it
      is asserted here rather than only implied by the file applying.
    */
    const crlf = await db.query(`
      select ('a' || chr(13) || chr(10) || '  b') like ('%a' || chr(10) || '  b%') as literal,
             ('a' || chr(13) || chr(10) || '  b') ~ 'a\\s+b'                       as tolerant
    `);
    eq('M0  a chr(10) anchor cannot match a CRLF body, and \\s+ can',
      [crlf.rows[0].literal, crlf.rows[0].tolerant], [false, true]);

    const TARGETS = [
      'admin_user_progress_detail',
      'admin_daily_record_detail',
      'admin_user_level3_detail',
      'admin_award_manual_points',
    ];

    const defs = await db.query(
      `select p.oid, p.proname, pg_get_functiondef(p.oid) as def
       from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
       where ns.nspname = 'public' and p.prokind = 'f' and p.proname = any($1)`,
      [TARGETS]
    );

    for (const row of defs.rows) {
      const undone = row.def
        // Take the check back out, so §4 has something to do on the second application.
        .replace(/^[ \t]*perform public\.admin_assert_in_scope\(p_user\);[ \t]*\r?\n/m, '')
        // …and store it the way a Windows checkout would have.
        .replace(/\r?\n/g, '\r\n');
      await db.query(undone);
    }

    const stripped = await db.query(
      `select count(*)::int n
       from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
       where ns.nspname = 'public' and p.proname = any($1)
         and pg_get_functiondef(p.oid) like '%admin_assert_in_scope%'`,
      [TARGETS]
    );
    eq('M1  the four bodies are back to CRLF without the check', stripped.rows[0].n, 0);

    const file = readFileSync(
      path.join(import.meta.dirname, '..', 'supabase', 'migrations', '0051_admin_scopes.sql'),
      'utf8'
    );
    const again = await attempt(db, file);
    ok('M2  0051 applies to them anyway', again.ok);
    if (!again.ok) fails.push(`M2  it raised: ${again.message.slice(0, 200)}`);

    const back = await db.query(
      `select p.proname
       from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
       where ns.nspname = 'public' and p.proname = any($1)
         and pg_get_functiondef(p.oid) not like '%admin_assert_in_scope%'
       order by 1`,
      [TARGETS]
    );
    eq('M3  and every one of the four carries the scope check again',
      back.rows.map((r) => r.proname), []);

    // The behaviour, not only the text: a CRLF body that was re-issued must still refuse.
    await asUser(db, U.one, async () => {
      const r = await refuse(db, `select public.admin_user_level3_detail($1)`, [U.yVedroad]);
      says('M4  the function this defect was found on still refuses another zone', r,
        'this yuvak is not in a zone you look after');
    });
  } finally {
    await stop();
  }

  console.log(`\n  ${pass} passed, ${fails.length} failed\n`);
  if (fails.length) {
    for (const f of fails) console.log(`  ✗  ${f}`);
    console.log('');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('\n  the suite could not run:', e.message, '\n');
  process.exit(1);
});
