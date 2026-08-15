/**
 * Who may read a યુવક's લેવલ ૩ — against a real Postgres.
 *
 *     VARNI_PGTEST_PORT=54833 VARNI_PGTEST_IMAGE=postgres:16-alpine node scripts/test-level3-auth.mjs
 *
 * ────────────────────────────────────────────────────────────────────────────
 * What this suite is about
 * ────────────────────────────────────────────────────────────────────────────
 *
 * With the **publishable browser key only** — the key that ships inside the JS bundle, no login,
 * no session — production answered `admin_level3_report()` with eight rows of real યુવક data and
 * `level3_snapshot(p_user := <a real uid>)` with that યુવક's document. `admin_user_level3_detail()`
 * refused, correctly, with `level3_detail_forbidden` and SQLSTATE 42501. The guard existed; it was
 * simply not on two of the five functions. 0037 puts it there.
 *
 * None of that is checkable by reading, and none of it is checkable against a mocked client: a
 * mock refuses whatever its author decided it refuses. So this file does what
 * scripts/test-point-bonus.mjs does and reuses its harness rather than inventing one — `docker run
 * postgres:16`, supabase/test/prelude.sql, every migration in filename order
 * (scripts/lib/pgtest.mjs) — seeds a population whose every figure was worked out on paper, and
 * then calls the real functions as the real roles.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Three callers, and why all three are needed
 * ────────────────────────────────────────────────────────────────────────────
 *
 *   `asAnon`   role `anon`, no claims. Postgres's own privilege system usually refuses him first.
 *   `asKey`    role `authenticated`, **no `sub` claim** — this file's model of a request carrying
 *              only the publishable key, which on this project can execute a function granted to
 *              `authenticated`. It is the caller production actually had, and it is the only one
 *              that reaches the *inside* of a granted function with nobody behind it.
 *   owner      no role switch, claims set by hand. Privileges cannot refuse the owner, so a
 *              refusal here can only have come from the function's own body. This is how the guard
 *              is told apart from the grant — a test that only ever ran as `anon` would still pass
 *              on a database where every guard had been deleted and only the GRANT was left.
 *
 * The distinction is the whole lesson 0037's header states: **a grant is not a guard.** Both
 * layers are asserted, separately, and neither is allowed to stand in for the other.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * What each group is protecting, and what it costs to get wrong
 * ────────────────────────────────────────────────────────────────────────────
 *
 *  §A  **0037 applied, and built what it claims.** `admin_level3_report()` is plpgsql now, because
 *      a `language sql` function has nowhere to put a statement; the eleven columns and their
 *      types are unchanged; `level3_snapshot(uuid)` still returns jsonb and still takes the
 *      parameter every caller passes. Re-applied a second time and asserted to be a no-op, because
 *      a migration that cannot be re-run cannot be corrected.
 *
 *  §B  **An anonymous caller is refused — and refused, not answered with an empty set.** The
 *      SQLSTATE is asserted and so, where the guard is the layer under test, is the error's name:
 *      "some error happened" would pass on a database where the function had been dropped.
 *
 *  §C  **An ordinary signed-in યુવક may read himself and nobody else.** His own snapshot succeeds;
 *      another યુવક's is refused; the three સંચાલક functions are refused.
 *
 *  §D  **The refusal happens when the underlying query would return zero rows.** This is the case
 *      a WHERE-clause guard misses — the check is not evaluated when the scan beneath it is empty
 *      — and it is the entire reason the guard is a `perform`/`raise` first statement. An
 *      unauthorised caller asking about a યુવક who has done no પુનરાવર્તન must be refused, because
 *      an empty answer is still an answer: it says that યુવક exists and has done nothing.
 *
 *  §E  **A progress reader succeeds, and gets exactly the numbers the unguarded function gave.**
 *      Asserted against 0035's own body, re-created here verbatim under another name, compared row
 *      for row over five different parameter shapes — not against numbers this file typed, which
 *      would prove only that it agrees with itself. The figures are on paper as well.
 *
 *  §F  **The general property, enumerated rather than listed.** This defect class has now shipped
 *      twice — 0032 and 0035 — so the assertion is not a list of names. Every SECURITY DEFINER
 *      function 0035 and 0037 declare is read out of `pg_proc`, and each must refuse a caller with
 *      no session. Three collection-level helpers are allowlisted with their reasons; everything
 *      else defaults into the must-refuse set, so a function added to either file tomorrow is
 *      covered the moment it is created.
 *
 *  §G  **The grants, as facts about the database and not as intentions in a file.** `revoke all …
 *      from public` does not remove an explicit grant to `anon` or `authenticated`, which is how
 *      an ungranted function came to answer an anonymous request in production. Asserted with
 *      `has_function_privilege` against the roles themselves.
 *
 *  §H  **Nothing 0037 touched changed what it computes.** The same three પુનરાવર્તન are still paid
 *      the same ૧૨૦ ગુણ through the same ledger rows.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { asAnon, asUser, attempt, dockerAvailable, startDatabase } from './lib/pgtest.mjs';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'supabase', 'migrations');

let pass = 0;
const fails = [];

const eq = (name, got, want) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) pass++;
  else fails.push(`${name}\n       got  ${g}\n       want ${w}`);
};

const ok = (name, cond) => eq(name, !!cond, true);

/**
 * The statement was refused, with this SQLSTATE — and optionally by this named guard.
 *
 * The code is asserted and not only the failure, because '42501' (no grant, or a permission
 * check), '23505' (a unique index) and '42883' (no such function) are different defences and a
 * test that accepted any error would pass on a database where the one under test had been
 * deleted. `named` goes further where it matters: under a caller who *can* execute the function,
 * only the function's own raise can produce the refusal, and naming it is what tells the guard
 * apart from the grant.
 */
const refused = (name, res, code, named = null) => {
  if (res.ok) {
    fails.push(`${name}\n       got  allowed (${res.count} row(s))\n       want refused ${code}`);
    return;
  }
  if (res.code !== code) {
    fails.push(`${name}\n       got  refused ${res.code}: ${res.message}\n       want refused ${code}`);
    return;
  }
  if (named && !String(res.message || '').includes(named)) {
    fails.push(`${name}\n       got  refused ${res.code}: ${res.message}\n       want the guard ${named}`);
    return;
  }
  pass++;
};

const group = (name) => console.log(`\n  ${name}`);

// bigint and numeric come back from node-postgres as strings, because they do not fit a JS number
// in general. Comparing '120' against 120 would fail for a reason that has nothing to do with
// authorisation.
const num = (v) => (v === null || v === undefined ? null : Number(v));

/** The same object with its keys in a fixed order, so two documents can be compared as text. */
const canonical = (v) => {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])]));
  }
  return v;
};

// ════════════════════════════════════════════════════════════════════ the population
//
// Every id is a literal, for scripts/test-admin-progress.mjs's reason: a fixture that computes its
// own expectations proves only that it agrees with itself.

const U = {
  // The યુવક the reports are about. ૫૦ then ૪૦ then ૩૦ — the requirement's own worked example.
  arjun: 'a1111111-1111-4111-8111-111111111111',
  // An ordinary signed-in યુવક with a પુનરાવર્તન of his own. He is the one who must be refused
  // Arjun's figures, which is a sharper case than an anonymous caller: he has a session.
  bhavesh: 'b2222222-2222-4222-8222-222222222222',
  // §D. He has never touched લેવલ ૩, so every query about him yields **zero rows** — the case a
  // WHERE-clause guard answers with silence instead of a refusal.
  eshan: 'e5555555-5555-4555-8555-555555555555',

  // SUPER_ADMIN: progress.read, users.read and settings.update.
  admin: '07777777-7777-4777-8777-777777777777',
  // VIEWER: holds progress.read and may not price anything. The progress reader of the brief.
  viewer: '18888888-8888-4888-8888-888888888888',
  // CONTENT_MANAGER: holds neither progress.read nor users.read. A signed-in સંચાલક who is still
  // not entitled to a યુવક's figures, which is the case a role check would miss.
  content: '29999999-9999-4999-8999-999999999999',
};

/** A uuid belonging to nobody at all — not a યુવક, not a row, not a foreign key. */
const NOBODY = '00000000-0000-4000-8000-0000000000ff';

const SCENE = (n) => `d-${String(n).padStart(3, '0')}`;
const RANGE = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => SCENE(a + i));

const LIVE = 120;
const WITHHELD = [SCENE(121), SCENE(122), SCENE(123)];

/** ૧ ગુણ per તિક, every તિક of every submission, no cap, no pace rule. The requirement's §9. */
const RULES = {
  enabled: true,
  level1: 100, level2: 200, level3: 300, level4: { default: 100 },
  tick: { mode: 'TICK', perTick: 1, perRevision: 0, dailyCap: 0 },
  earn: { level1: 'DAY_FIRST', level2: 'DAY_FIRST', level3: 'DAY_FIRST', level4: 'DAY_FIRST', tickCount: 'ALL' },
};

const BOARD = { enabled: true, periods: ['DAY', 'WEEK', 'MONTH', 'ALL'], defaultPeriod: 'ALL', topN: 10 };

// Worked out on paper, before any of it was run. Arjun ticks ૫૦, then the first ૪૦ of them again,
// then the first ૩૦ again: ૩ પુનરાવર્તન, ૫૦+૪૦+૩૦ = ૧૨૦ ticks of સાધના over ૫૦ distinct દ્રશ્યો,
// paid ૧૨૦ ગુણ at one a તિક, all on one day. The same scenario and the same figures as
// scripts/test-level3-revisions.mjs §I, deliberately, so the two suites cannot drift apart about
// what this report is supposed to say.
const ARJUN = { revisions: 3, ticks: 120, scenes: 50, points: 120, days: 1 };
const BHAVESH_TICKS = 10;

/**
 * `admin_level3_report()` exactly as 0035 shipped it — `language sql`, no guard — under another
 * name, so that §E can assert 0037 changed the authorisation and **nothing else**.
 *
 * Pasted rather than derived. A twin built by string-editing the migration would break the moment
 * either file was reformatted, and would be asserting that two regular expressions agree.
 */
const PRE_0037 = `
create or replace function public.pre0037_admin_level3_report(
  p_users uuid[]  default null,
  p_from  date    default null,
  p_to    date    default null,
  p_day   date    default null
)
returns table (
  user_id uuid, revisions bigint, ticks bigint, scenes_distinct bigint, points bigint,
  days bigint, last_at timestamptz, today_revisions bigint, today_ticks bigint,
  today_points bigint, engaged_ms bigint
)
language sql
stable
security definer
set search_path = public
as $fn$
  with day as (
    select coalesce(p_day, timezone('Asia/Kolkata', now())::date) as d
  ),
  att as (
    select a.*
    from public.activity_attempts a
    where a.level_id = 3
      and a.activity_key = 'revision'
      and (p_users is null or a.user_id = any (p_users))
      and (p_from is null or a.activity_date >= p_from)
      and (p_to   is null or a.activity_date <= p_to)
  ),
  tx as (
    select t.user_id, t.activity_date, t.points
    from public.point_transactions t
    where t.level_id = 3
      and (p_users is null or t.user_id = any (p_users))
      and (p_from is null or t.activity_date >= p_from)
      and (p_to   is null or t.activity_date <= p_to)
  )
  select
    u.user_id,
    coalesce(a.revisions, 0),
    coalesce(a.ticks, 0),
    coalesce(sc.scenes_distinct, 0),
    coalesce(x.points, 0),
    coalesce(a.days, 0),
    a.last_at,
    coalesce(a.today_revisions, 0),
    coalesce(a.today_ticks, 0),
    coalesce(x.today_points, 0),
    coalesce(a.engaged_ms, 0)
  from (
    select user_id from att
    union
    select user_id from tx
  ) u
  left join (
    select
      att.user_id,
      count(*)                                                          as revisions,
      sum(coalesce(cardinality(att.selected_scene_ids), 0))             as ticks,
      count(distinct att.activity_date)                                 as days,
      max(att.submitted_at)                                             as last_at,
      count(*) filter (where att.activity_date = (select d from day))   as today_revisions,
      coalesce(sum(coalesce(cardinality(att.selected_scene_ids), 0))
               filter (where att.activity_date = (select d from day)), 0) as today_ticks,
      coalesce(sum(att.engaged_ms), 0)                                  as engaged_ms
    from att
    group by att.user_id
  ) a on a.user_id = u.user_id
  left join (
    select att.user_id, count(distinct s.scene_id) as scenes_distinct
    from att
    cross join lateral unnest(att.selected_scene_ids) as s(scene_id)
    where not (s.scene_id = any (public.admin_withheld_scene_ids()))
    group by att.user_id
  ) sc on sc.user_id = u.user_id
  left join (
    select
      tx.user_id,
      sum(tx.points)                                                    as points,
      coalesce(sum(tx.points) filter (where tx.activity_date = (select d from day)), 0) as today_points
    from tx
    group by tx.user_id
  ) x on x.user_id = u.user_id;
$fn$;
`;

/**
 * The three functions 0035 creates that name nobody and may stay open.
 *
 * `scene_catalog_ready()` is a boolean about whether a build step has run. `live_scene_ids()` is
 * the list of દ્રશ્ય ids the published collection holds — the same list `public.scene_catalog`
 * already shows every signed-in યુવક through its RLS policy, and the same list the browser bundle
 * ships in content/darshan.json. `point_pace()` is the સંચાલક's own configuration, which the
 * screen has to be told in order to say "આશરે N મિનિટ".
 *
 * The list is short, closed and argued for, and §F requires a function to be *argued into* it: a
 * new SECURITY DEFINER function in 0035 or 0037 lands in the must-refuse set by default rather
 * than being quietly ignored.
 */
const OPEN_BY_DESIGN = new Set(['scene_catalog_ready', 'live_scene_ids', 'point_pace']);

// ════════════════════════════════════════════════════════════════════ the fixtures

async function fixtures(db) {
  const people = [
    [U.arjun, 'ARJ101', 'Arjun'],
    [U.bhavesh, 'BHA102', 'Bhavesh'],
    [U.eshan, 'ESH105', 'Eshan'],
    [U.admin, 'ADM107', 'Sanchalak Admin'],
    [U.viewer, 'VWR108', 'Sanchalak Viewer'],
    [U.content, 'CNT109', 'Sanchalak Content'],
  ];
  for (const [id, smk, name] of people) {
    await db.query('insert into auth.users (id, email) values ($1, $2)', [id, `${smk.toLowerCase()}@t.test`]);
    await db.query(
      `insert into public.profiles (id, smk, name, email, mobile, zone_id, sub_zone_id, status)
       values ($1, $2, $3, $4, $5, 'surat', 'varachha', 'ACTIVE')`,
      [id, smk, name, `${smk.toLowerCase()}@t.test`, `98111000${smk.slice(-2)}`]
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
    [LIVE + WITHHELD.length]
  );
  await db.query(`update public.scenes set active = false where id = any($1::text[])`, [WITHHELD]);

  // Committed, and outside any sandbox: every group below reads this configuration and these
  // પુનરાવર્તન, and a rolled-back fixture would leave §E asserting over an empty report.
  await db.query(
    `insert into public.settings (key, value) values ('levels', $1::jsonb)
     on conflict (key) do update set value = excluded.value`,
    [JSON.stringify({ points: RULES, leaderboard: BOARD })]
  );

  await db.query(PRE_0037);

  // ── the સાધના itself, through the real RPCs as the real યુવક ────────────────
  //
  // Driven through level3_draft_save() and level3_finalize() rather than INSERTed, because the
  // point of the figures below is that they are what the live writers produced.
  const asHim = (uid, sql, params = []) =>
    asUser(db, uid, async () => (await db.query(sql, params)).rows[0], { commit: true });

  const save = (uid, ids) => asHim(uid, 'select public.level3_draft_save($1::text[]) r', [ids]);
  const finish = (uid) => asHim(uid, 'select public.level3_finalize(null::uuid) r');

  for (const n of [50, 40, 30]) {
    await save(U.arjun, RANGE(1, n));
    await finish(U.arjun);
  }

  await save(U.bhavesh, RANGE(1, BHAVESH_TICKS));
  await finish(U.bhavesh);
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
  /** A statement expected to be refused, inside a savepoint so the group can carry on. */
  const soft = async (sql, params = []) => {
    await db.query('savepoint probe');
    const res = await attempt(db, sql, params);
    await db.query(res.ok ? 'release savepoint probe' : 'rollback to savepoint probe');
    return res;
  };

  /**
   * A request carrying only the publishable key: role `authenticated`, and **no `sub` claim**.
   *
   * This is the caller production actually had. `asAnon` is the other half and is usually stopped
   * by the privilege system before a function body runs; this one gets inside anything granted to
   * `authenticated`, which on this project is what the browser key reaches. Rolled back always.
   */
  const asKey = async (fn) => {
    await db.query('begin');
    try {
      await db.query('set local role authenticated');
      await db.query(`select set_config('request.jwt.claims', '', true)`);
      return await fn();
    } finally {
      await db.query('rollback').catch(() => {});
      await db.query('reset role').catch(() => {});
    }
  };

  /**
   * As the **owner**, with `auth.uid()` answering `uid` (or nobody, for `null`).
   *
   * Privileges cannot refuse the owner, so a refusal inside this helper can only have come from
   * the function's own body. It is how the guard is told apart from the grant — and without it a
   * green suite would be compatible with every guard in 0035 and 0037 having been deleted, since
   * the GRANT alone would still refuse `anon`.
   */
  const asOwner = async (uid, fn) => {
    await db.query('begin');
    try {
      await db.query(`select set_config('request.jwt.claims', $1, true)`, [
        uid ? JSON.stringify({ sub: uid, role: 'authenticated' }) : '',
      ]);
      return await fn();
    } finally {
      await db.query('rollback').catch(() => {});
    }
  };

  const softAs = (uid, sql, params = []) => asOwner(uid, () => soft(sql, params));

  const REPORT = 'select * from public.admin_level3_report($1::uuid[])';
  const SNAPSHOT = 'select public.level3_snapshot($1::uuid) r';
  const DETAIL = 'select public.admin_user_level3_detail($1::uuid) r';
  const USERS = 'select * from public.admin_level3_users()';

  // ══════════════════════════════════════════════════════════ §A the migration
  group('§A  0037 applied, and built what it says it built');

  eq('0037 is in supabase/migrations and applied with the rest', files.includes('0037_level3_authorization.sql'), true);

  const fn = async (name, args = null) =>
    (
      await db.query(
        `select l.lanname, p.prosecdef, p.provolatile, p.proconfig::text as cfg,
                pg_get_function_result(p.oid) as result
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         join pg_language  l on l.oid = p.prolang
         where n.nspname = 'public' and p.proname = $1
           and ($2::text is null or pg_get_function_identity_arguments(p.oid) = $2)`,
        [name, args]
      )
    ).rows[0];

  const report = await fn('admin_level3_report');
  eq('admin_level3_report is plpgsql now - a language sql function has nowhere to put a statement',
    report?.lanname, 'plpgsql');
  eq('        still SECURITY DEFINER, still stable, still search_path pinned',
    [report?.prosecdef, report?.provolatile, report?.cfg], [true, 's', '{search_path=public}']);

  const cols = (
    await db.query(
      `select a.attname, format_type(a.atttypid, null) as t
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       cross join lateral unnest(p.proallargtypes, p.proargmodes, p.proargnames)
              with ordinality as a(atttypid, mode, attname, ord)
       where n.nspname = 'public' and p.proname = 'admin_level3_report' and a.mode = 't'
       order by a.ord`
    )
  ).rows;

  eq('        and returns the same eleven columns, in the same order, with the same types',
    cols.map((c) => `${c.attname}:${c.t}`),
    [
      'user_id:uuid', 'revisions:bigint', 'ticks:bigint', 'scenes_distinct:bigint', 'points:bigint',
      'days:bigint', 'last_at:timestamp with time zone', 'today_revisions:bigint',
      'today_ticks:bigint', 'today_points:bigint', 'engaged_ms:bigint',
    ]);

  const snap = await fn('level3_snapshot', 'p_user uuid');
  eq('level3_snapshot keeps its signature, so no caller of it has to be reissued',
    [snap?.result, snap?.prosecdef, snap?.provolatile], ['jsonb', true, 's']);

  // Re-applied, because a migration that cannot be re-run cannot be corrected — and
  // scripts/test-point-engine.mjs §A replays every file from 0031 onward.
  const before = (await db.query('select count(*)::int n, coalesce(sum(points),0)::int p from public.point_transactions')).rows[0];
  await db.query('begin');
  await db.query(readFileSync(path.join(MIGRATIONS, '0037_level3_authorization.sql'), 'utf8'));
  await db.query('commit');
  const after = (await db.query('select count(*)::int n, coalesce(sum(points),0)::int p from public.point_transactions')).rows[0];
  eq('re-applying 0037 is a no-op: not a row and not a ગુણ moves',
    [before.n, before.p], [after.n, after.p]);

  // ══════════════════════════════════════════════════════════ §B nobody at all
  group('§B  a caller with no session is refused, not answered');

  refused('anon may not run admin_level3_report',
    await asAnon(db, () => attempt(db, REPORT, [[U.arjun]])), '42501');
  refused('anon may not run level3_snapshot for a real યુવક',
    await asAnon(db, () => attempt(db, SNAPSHOT, [U.arjun])), '42501');
  refused('anon may not run admin_user_level3_detail - which was already right',
    await asAnon(db, () => attempt(db, DETAIL, [U.arjun])), '42501');
  refused('anon may not run admin_level3_users',
    await asAnon(db, () => attempt(db, USERS)), '42501');
  refused('anon may not run my_level3_summary',
    await asAnon(db, () => attempt(db, 'select public.my_level3_summary()')), '42501');

  // The production case, and the one that matters: the publishable key reaches the inside of a
  // function granted to `authenticated`, so only the guard can refuse it. The guard is named,
  // because a refusal that came from the privilege system would prove nothing about the fix.
  refused('the publishable key alone is refused by the report\'s OWN guard, by name',
    await asKey(() => attempt(db, REPORT, [[U.arjun]])), '42501', 'level3_detail_forbidden');
  refused('        and by admin_user_level3_detail\'s, which is the guard 0037 copied',
    await asKey(() => attempt(db, DETAIL, [U.arjun])), '42501', 'level3_detail_forbidden');
  refused('        and by admin_level3_users\'s',
    await asKey(() => attempt(db, USERS)), '42501', 'level3_report_forbidden');
  refused('        and by my_level3_summary\'s',
    await asKey(() => attempt(db, 'select public.my_level3_summary()')), '42501', 'level3_not_signed_in');
  refused('        and level3_snapshot is not even reachable for it',
    await asKey(() => attempt(db, SNAPSHOT, [U.arjun])), '42501');

  // And the guard by itself, with the privilege system taken out of the way entirely.
  refused('level3_snapshot\'s own body refuses a caller with no session, grant or no grant',
    await softAs(null, SNAPSHOT, [U.arjun]), '42501', 'level3_snapshot_not_signed_in');
  refused('admin_level3_report\'s own body does the same',
    await softAs(null, REPORT, [[U.arjun]]), '42501', 'level3_detail_forbidden');

  /**
   * The negative control, and this suite is worth very little without it.
   *
   * `pre0037_admin_level3_report()` is 0035's body verbatim (see PRE_0037 above) — SECURITY
   * DEFINER, `language sql`, no guard, and left with the EXECUTE that PUBLIC gets by default,
   * which is exactly the state the real function shipped in. If the harness could not get real
   * યુવક data out of *it*, then every refusal asserted above would be evidence of nothing: a green
   * run would be equally consistent with the fix working and with this file being unable to reach
   * the function at all.
   *
   * So: the publishable key, no session, and the real figures come back. That is what production
   * answered, reproduced here, and it is the thing 0037 stops.
   */
  const leaked = await asKey(async () =>
    (await db.query(`select * from public.pre0037_admin_level3_report($1::uuid[])`, [[U.arjun]])).rows);
  eq('CONTROL - the unguarded 0035 body hands the publishable key a real યુવક\'s figures',
    [leaked.length, num(leaked[0]?.ticks), num(leaked[0]?.points)], [1, ARJUN.ticks, ARJUN.points]);
  eq('        which is the defect, and the guarded function refuses the identical request',
    (await asKey(() => attempt(db, REPORT, [[U.arjun]]))).ok, false);

  // ══════════════════════════════════════════════════════════ §C an ordinary યુવક
  group('§C  a signed-in યુવક reads himself and nobody else');

  refused('Bhavesh may not run the સંચાલક\'s report',
    await asUser(db, U.bhavesh, () => attempt(db, REPORT, [[U.arjun]])), '42501', 'level3_detail_forbidden');
  refused('        nor about himself, because the report is not his to run at all',
    await asUser(db, U.bhavesh, () => attempt(db, REPORT, [[U.bhavesh]])), '42501', 'level3_detail_forbidden');
  refused('        nor admin_user_level3_detail',
    await asUser(db, U.bhavesh, () => attempt(db, DETAIL, [U.arjun])), '42501', 'level3_detail_forbidden');
  refused('        nor admin_level3_users',
    await asUser(db, U.bhavesh, () => attempt(db, USERS)), '42501', 'level3_report_forbidden');

  const mine = await asUser(db, U.bhavesh, async () => (await db.query('select public.my_level3_summary() r')).rows[0].r);
  eq('        but his own summary is his to read', num(mine?.total?.ticks), BHAVESH_TICKS);

  const own = await asOwner(U.bhavesh, async () => (await db.query(SNAPSHOT, [U.bhavesh])).rows[0].r);
  eq('        and level3_snapshot(himself) is the same document, to the byte',
    JSON.stringify(canonical(own)), JSON.stringify(canonical(mine)));

  const derived = await asOwner(U.bhavesh, async () => (await db.query(SNAPSHOT, [null])).rows[0].r);
  eq('        a NULL p_user means "me", which is what deriving from auth.uid() means',
    JSON.stringify(canonical(derived)), JSON.stringify(canonical(own)));

  refused('        and Arjun\'s snapshot is refused him by name, though he is signed in',
    await softAs(U.bhavesh, SNAPSHOT, [U.arjun]), '42501', 'level3_snapshot_forbidden');
  refused('        as is a સંચાલક\'s who holds neither permission',
    await softAs(U.content, SNAPSHOT, [U.arjun]), '42501', 'level3_snapshot_forbidden');
  refused('        and the report, for the same સંચાલક',
    await softAs(U.content, REPORT, [[U.arjun]]), '42501', 'level3_detail_forbidden');

  const byViewer = await asOwner(U.viewer, async () => (await db.query(SNAPSHOT, [U.arjun])).rows[0].r);
  const byArjun = await asOwner(U.arjun, async () => (await db.query(SNAPSHOT, [U.arjun])).rows[0].r);
  eq('        a progress reader may read another યુવક - and reads exactly what that યુવક reads',
    JSON.stringify(canonical(byViewer)), JSON.stringify(canonical(byArjun)));
  eq('        which is still Arjun\'s ૧૨૦, unchanged by any of this',
    [num(byArjun?.total?.ticks), num(byArjun?.total?.points), num(byArjun?.total?.revisions)],
    [ARJUN.ticks, ARJUN.points, ARJUN.revisions]);

  // ══════════════════════════════════════════════════════════ §D the empty scan
  group('§D  refused even when the query underneath would return nothing');

  // The whole reason the guard is a statement. A WHERE-clause guard is not evaluated when the scan
  // beneath it yields no rows, so each of these would come back as an empty set: a 200 that says
  // "that યુવક exists and has done nothing", which is an answer and not a refusal.
  refused('a યુવક who has never done લેવલ ૩ is still not readable by a stranger',
    await asUser(db, U.bhavesh, () => attempt(db, REPORT, [[U.eshan]])), '42501', 'level3_detail_forbidden');
  refused('        nor is his snapshot, which would otherwise be an empty document',
    await softAs(U.bhavesh, SNAPSHOT, [U.eshan]), '42501', 'level3_snapshot_forbidden');
  refused('        a uuid belonging to nobody at all is refused rather than answered "none"',
    await asUser(db, U.bhavesh, () => attempt(db, REPORT, [[NOBODY]])), '42501', 'level3_detail_forbidden');
  refused('        and so is one, to the publishable key',
    await asKey(() => attempt(db, REPORT, [[NOBODY]])), '42501', 'level3_detail_forbidden');
  refused('        an empty p_users - a request that could match nothing - is refused too',
    await asUser(db, U.bhavesh, () => attempt(db, REPORT, [[]])), '42501', 'level3_detail_forbidden');
  refused('        and a date window with no days in it',
    await asUser(db, U.bhavesh, () =>
      attempt(db, `select * from public.admin_level3_report(null, '1990-01-01'::date, '1990-01-02'::date)`)),
    '42501', 'level3_detail_forbidden');
  refused('        the same window is refused the anonymous caller',
    await asKey(() =>
      attempt(db, `select * from public.admin_level3_report(null, '1990-01-01'::date, '1990-01-02'::date)`)),
    '42501', 'level3_detail_forbidden');

  // And the control: the reader who IS entitled gets the empty set rather than a refusal, so the
  // assertions above are about authorisation and not about the window being rejected outright.
  const emptyWindow = await asUser(db, U.viewer, async () =>
    (await db.query(`select * from public.admin_level3_report(null, '1990-01-01'::date, '1990-01-02'::date)`)).rows);
  eq('        while a progress reader gets the honest empty set for that same window', emptyWindow.length, 0);

  const noRows = await asUser(db, U.viewer, async () => (await db.query(REPORT, [[U.eshan]])).rows);
  eq('        and no row at all for a યુવક who has done nothing', noRows.length, 0);

  // ══════════════════════════════════════════════════════════ §E the reader, and the numbers
  group('§E  a progress reader succeeds, with the numbers the unguarded function gave');

  const rowOf = async (uid) =>
    asUser(db, U.viewer, async () => (await db.query(REPORT, [[uid]])).rows[0]);

  const arjun = await rowOf(U.arjun);
  eq('the પુનરાવર્તન count', num(arjun?.revisions), ARJUN.revisions);
  eq('the additive tick total - ૫૦ + ૪૦ + ૩૦', num(arjun?.ticks), ARJUN.ticks);
  eq('the distinct દ્રશ્યો, which is a different and also true number', num(arjun?.scenes_distinct), ARJUN.scenes);
  eq('the points, from the ledger', num(arjun?.points), ARJUN.points);
  eq('the days, and today separated out',
    [num(arjun?.days), num(arjun?.today_revisions), num(arjun?.today_ticks), num(arjun?.today_points)],
    [ARJUN.days, ARJUN.revisions, ARJUN.ticks, ARJUN.points]);

  ok('a SUPER_ADMIN may run it too', (await asUser(db, U.admin, async () => (await db.query(REPORT, [[U.arjun]])).rows)).length === 1);

  /**
   * The strong form: 0035's own body, under another name, compared row for row.
   *
   * Five parameter shapes, because a guard bolted onto the front of a query is exactly the sort of
   * change that silently drops a default, reorders an argument, or turns a NULL filter into an
   * empty one — and a single call with a single uid would not notice any of it.
   */
  const SHAPES = [
    ['every યુવક, no window', 'null::uuid[], null::date, null::date, null::date'],
    ['one યુવક', `array['${U.arjun}']::uuid[], null, null, null`],
    ['two યુવકો, one of whom has nothing', `array['${U.arjun}','${U.eshan}']::uuid[], null, null, null`],
    ['a window that contains today', `null, (timezone('Asia/Kolkata', now())::date - 7), timezone('Asia/Kolkata', now())::date, null`],
    ['an explicit p_day of yesterday', `null, null, null, (timezone('Asia/Kolkata', now())::date - 1)`],
  ];

  for (const [what, args] of SHAPES) {
    const now = await asUser(db, U.viewer, async () =>
      (await db.query(`select * from public.admin_level3_report(${args}) order by user_id`)).rows);
    const then = (await db.query(`select * from public.pre0037_admin_level3_report(${args}) order by user_id`)).rows;
    eq(`0037 computes what 0035 computed - ${what}`, canonical(now), canonical(then));
    ok(`        and it is not vacuously equal - ${what}`, what.includes('yesterday') || now.length > 0);
  }

  const detail = await asUser(db, U.viewer, async () => (await db.query(DETAIL, [U.arjun])).rows[0].r);
  eq('admin_user_level3_detail still lists every પુનરાવર્તન', detail.revisions.length, ARJUN.revisions);
  eq('        each with what it earned: ૫૦, ૪૦, ૩૦',
    detail.revisions.map((r) => num(r.points)).sort((a, b) => a - b), [30, 40, 50]);

  const page = await asUser(db, U.viewer, async () => (await db.query(USERS)).rows);
  ok('admin_level3_users still answers the progress reader', page.length > 0);

  // ══════════════════════════════════════════════════════════ §F the general property
  group('§F  every SECURITY DEFINER function 0035 and 0037 declare refuses a caller with no session');

  /**
   * The names, read out of the two migration files rather than typed here.
   *
   * This defect class has now shipped twice. A list in this file would cover the two functions
   * that were wrong and nothing that is added next month; a list taken from the files covers
   * whatever is in them.
   */
  const declared = new Set();
  for (const file of ['0035_level3_revisions.sql', '0037_level3_authorization.sql']) {
    const sql = readFileSync(path.join(MIGRATIONS, file), 'utf8');
    for (const m of sql.matchAll(/create\s+or\s+replace\s+function\s+public\.([a-z0-9_]+)\s*\(/gi)) {
      declared.add(m[1].toLowerCase());
    }
  }
  ok('the two files declare functions this suite could find', declared.size >= 15);

  /**
   * Every one of them as `pg_proc` actually holds it: SECURITY DEFINER, not a trigger function,
   * and with the argument types needed to call it. Trigger functions are excluded because Postgres
   * refuses to call one as an ordinary function whoever asks (0A000), so "refused" would say
   * nothing about authorisation.
   */
  const defs = (
    await db.query(
      `select p.proname,
              p.proretset,
              array(select format_type(t, null) from unnest(p.proargtypes) t) as args
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname = any($1::text[])
         and p.prosecdef
         and p.prorettype <> 'pg_catalog.trigger'::regtype
       order by p.proname`,
      [[...declared]]
    )
  ).rows;

  ok('and pg_proc holds them as SECURITY DEFINER functions', defs.length >= 15);

  // Printed, not asserted. The list is the point of this group and a reader of the output should
  // be able to see which functions were actually put to the question.
  console.log(`      ${defs.length} enumerated: ${defs.map((d) => d.proname).join(', ')}`);

  const guarded = defs.filter((d) => !OPEN_BY_DESIGN.has(d.proname));
  ok('with only the three collection-level helpers allowlisted, and every one of them present',
    defs.length - guarded.length === OPEN_BY_DESIGN.size);

  // NULL for every argument. A guard that is the first statement of the body never looks at them,
  // which is precisely the property being asserted; a function that read an argument before
  // checking who was asking would be the bug.
  const call = (d) => {
    const args = d.args.map((t) => `null::${t}`).join(', ');
    return d.proretset ? `select * from public.${d.proname}(${args})` : `select public.${d.proname}(${args})`;
  };

  const openedToAnon = [];
  const openedToKey = [];
  for (const d of guarded) {
    const a = await asAnon(db, () => attempt(db, call(d)));
    if (a.ok || a.code !== '42501') openedToAnon.push(`${d.proname} -> ${a.ok ? 'allowed' : a.code}`);

    const k = await asKey(() => attempt(db, call(d)));
    if (k.ok || k.code !== '42501') openedToKey.push(`${k.ok ? 'allowed' : k.code} <- ${d.proname}`);
  }

  eq('not one of them answers role anon', openedToAnon, []);
  eq('not one of them answers the publishable key either', openedToKey, []);

  // The allowlist, asserted as well, so that "it refuses everything" cannot be achieved by the
  // enumeration silently finding nothing.
  const openOk = [];
  for (const d of defs.filter((x) => OPEN_BY_DESIGN.has(x.proname))) {
    const r = await asKey(() => attempt(db, call(d)));
    if (r.ok) openOk.push(d.proname);
  }
  eq('and the three that name nobody are deliberately still readable', openOk.sort(), [...OPEN_BY_DESIGN].sort());

  // ══════════════════════════════════════════════════════════ §G the grants, as facts
  group('§G  the grants say what 0037 says they say');

  const privOf = async (name, args) =>
    (
      await db.query(
        `select has_function_privilege('anon',          p.oid, 'execute') as anon,
                has_function_privilege('authenticated', p.oid, 'execute') as auth
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = $1
           and pg_get_function_identity_arguments(p.oid) = $2`,
        [name, args]
      )
    ).rows[0];

  // Reachable from no client at all. `revoke all … from public` would not have removed a grant
  // that had drifted onto either of these roles, which is how an ungranted function came to answer
  // an anonymous request in production; 0037 names them, so this is now a fact and not a hope.
  for (const [name, args] of [
    ['award_points', 'p_user uuid, p_date date, p_level integer, p_key text, p_source text, p_source_id bigint, p_attempt integer'],
    ['level3_commit', 'p_user uuid, p_date date, p_token uuid'],
    ['level3_snapshot', 'p_user uuid'],
    ['daily_activity_progress_recount', 'p_user uuid, p_date date, p_level integer, p_key text'],
    ['daily_record_points', 'p_user uuid, p_level integer, p_key text, p_count integer, p_date date'],
  ]) {
    const p = await privOf(name, args);
    eq(`${name} is reachable from neither client role`, [p?.anon, p?.auth], [false, false]);
  }

  // Granted to `authenticated` and to nobody else - and every one of them states its own check,
  // which is what actually makes it safe. The grant only decides which layer says no.
  for (const [name, args] of [
    ['admin_level3_report', 'p_users uuid[], p_from date, p_to date, p_day date'],
    ['admin_user_level3_detail', 'p_user uuid, p_limit integer'],
    ['level3_draft_get', ''],
    ['level3_draft_save', 'p_scene_ids text[]'],
    ['level3_finalize', 'p_client_token uuid'],
    ['level3_reset', 'p_client_token uuid'],
    ['my_level3_summary', ''],
    ['daily_record_save', 'p_date date, p_counts jsonb, p_client_token uuid'],
    ['scene_catalog_sync', 'p_scenes jsonb'],
  ]) {
    const p = await privOf(name, args);
    eq(`${name} is the signed-in યુવક's and never anon's`, [p?.anon, p?.auth], [false, true]);
  }

  // ══════════════════════════════════════════════════════════ §H nothing moved
  group('§H  0037 is an authorisation fix and moved no ગુણ');

  const ledger = (
    await db.query(
      `select coalesce(sum(points), 0)::int p, count(*)::int n
       from public.point_transactions where user_id = $1 and level_id = 3`,
      [U.arjun]
    )
  ).rows[0];
  eq('Arjun\'s three પુનરાવર્તન are still three ledger rows worth ૧૨૦', [ledger.n, ledger.p], [3, ARJUN.points]);

  const attempts = (
    await db.query(
      `select count(*)::int n, coalesce(sum(cardinality(selected_scene_ids)), 0)::int t
       from public.activity_attempts where user_id = $1 and level_id = 3`,
      [U.arjun]
    )
  ).rows[0];
  eq('        and three attempts holding ૧૨૦ ticks', [attempts.n, attempts.t], [ARJUN.revisions, ARJUN.ticks]);

  // The screen a યુવક actually uses, end to end, after everything above.
  const still = await asUser(db, U.arjun, async () => (await db.query('select public.level3_draft_get() r')).rows[0].r);
  ok('        and લેવલ ૩ still opens for him', still?.current?.open === true);
  eq('        with his day and his lifetime intact',
    [num(still?.today?.revisions), num(still?.total?.ticks), num(still?.total?.points)],
    [ARJUN.revisions, ARJUN.ticks, ARJUN.points]);
}

await main();
