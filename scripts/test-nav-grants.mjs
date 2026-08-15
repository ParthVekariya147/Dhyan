/**
 * A સંચાલક can save the bottom bar — against a real Postgres, as the role he actually is.
 *
 *     VARNI_PGTEST_PORT=54833 node scripts/test-nav-grants.mjs
 *
 * ────────────────────────────────────────────────────────────────────────────
 * The defect this exists for
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Saving the mobile navigation returned 403 with
 *
 *     {"code":"42501","message":"permission denied for function nav_config_error"}
 *
 * for a SUPER_ADMIN. 42501 is not RLS and not `has_permission()` — it is an EXECUTE grant, and
 * the role being refused is `authenticated`, which every signed-in user is. No permission the
 * panel can grant touches it.
 *
 * `settings_check_mobile_nav()` (0019) is the BEFORE trigger that validates the bar, and it was
 * SECURITY INVOKER. A firing trigger does not have its own EXECUTE checked, so it ran — as the
 * caller — and its one statement calls `nav_config_error()`, which every migration since 0019
 * has deliberately closed to client roles. The validator was unreachable from inside the write
 * it guards. 0041 makes the trigger SECURITY DEFINER; the helpers stay closed.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why scripts/test-navigation.mjs did not catch it, and why this file is separate
 * ────────────────────────────────────────────────────────────────────────────
 *
 * That suite tests `validateMobileNav()` and `resolveMobileNav()` in JavaScript, exhaustively
 * and correctly. Neither of them is what refused the write. This defect is only visible to a
 * connection that has put on `authenticated` — a test running as owner or service_role cannot
 * see a grant defect however many rules of the bar it checks, because the owner is not subject
 * to grants at all.
 *
 * So the assertion here is not "the rules are right". It is "the guard is reachable by the
 * person it is for, and closed to everybody else".
 *
 * ────────────────────────────────────────────────────────────────────────────
 * The groups
 * ────────────────────────────────────────────────────────────────────────────
 *
 *  §A  A SUPER_ADMIN writes settings['nav'] — the exact payload from the 403 — and it lands.
 *  §B  The guard still refuses a bad bar, with a check violation and its own sentence. A fix
 *      that made the write succeed by disarming the validator would pass §A and fail here.
 *  §C  The helpers are still closed to anon and authenticated. The fix must not be a grant.
 *  §D  A યુવક with no settings.update is still refused — by RLS, not by 42501, so the two
 *      refusals stay told apart.
 *  §E  The defect itself, reproduced: put the trigger back to SECURITY INVOKER and the same
 *      write fails 42501 again. This is what makes §A a test of 0041 rather than of nothing.
 *  §F  The property, not the function: no non-internal trigger anywhere in the schema is
 *      SECURITY INVOKER while calling something no client role may execute.
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
const says = (name, res, fragment) => {
  if (!res.ok && String(res.message).includes(fragment)) pass++;
  else if (res.ok) fails.push(`${name}\n       got  the statement SUCCEEDED\n       want "${fragment}"`);
  else fails.push(`${name}\n       got  ${res.message.slice(0, 90)}\n       want "${fragment}"`);
};
const group = (t) => console.log(`\n  ${t}\n`);

/*
  `attempt()` inside a transaction, when the statement is EXPECTED to fail.

  A refused statement aborts the enclosing transaction, and `asUser()` runs everything inside
  one — so a second refusal in the same block reports 25P02 "current transaction is aborted"
  and the SQLSTATE being asserted is lost. A savepoint per attempt keeps each refusal to
  itself, which matters most in §B where the whole point is that three different bad bars are
  refused for three different reasons.
*/
const refuse = async (db, sql, params = []) => {
  await db.query('savepoint s');
  const res = await attempt(db, sql, params);
  await db.query('rollback to savepoint s');
  return res;
};

const U = {
  admin: '20000000-0000-4000-8000-000000000001',
  yuvak: '20000000-0000-4000-8000-000000000002',
};

// The bar exactly as the panel sent it in the 403 — ten items, four shown, one custom button.
// Kept whole rather than minimised: the payload that failed is the payload worth asserting.
const BAR = {
  mobileBottom: [
    { key: 'home', label: 'Home', icon: 'home', route: '/', visible: true, enabled: true, sortOrder: 1 },
    { key: 'darshan', label: 'દર્શન', icon: 'darshan', route: '/darshan', visible: true, enabled: true, sortOrder: 2 },
    { key: 'revision', label: 'પુનરાવર્તન', icon: 'list', route: '/level/3', visible: true, enabled: true, sortOrder: 3 },
    { key: 'start', label: 'ધ્યાન', icon: 'play', route: '/welcome', visible: false, enabled: false, sortOrder: 4 },
    { key: 'level4', label: 'લેવલ ૪', icon: 'grid', route: '/level/4', visible: false, enabled: false, sortOrder: 5 },
    { key: 'profile', label: 'મારું', icon: 'person', route: '/profile', visible: true, enabled: true, sortOrder: 6 },
    { key: 'settings', label: 'સેટિંગ', icon: 'gear', route: '/settings', visible: false, enabled: false, sortOrder: 7 },
    { key: 'leaderboard', label: 'ક્રમાંક', icon: 'trophy', route: '/leaderboard', visible: false, enabled: false, sortOrder: 8 },
    { key: 'history', label: 'પ્રગતિ', icon: 'star', route: '/history', visible: false, enabled: false, sortOrder: 9 },
    { key: 'custom:btn-1', label: 'Leaderboard', icon: 'list', route: '/leaderboard', visible: true, enabled: true, sortOrder: 10 },
  ],
};

// The upsert PostgREST issues for `POST /settings?on_conflict=key` with Prefer: resolution=merge.
const UPSERT = `
  insert into public.settings (key, value, updated_at)
  values ('nav', $1::jsonb, now())
  on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at`;

async function fixtures(db) {
  for (const [key, id] of Object.entries(U)) {
    await db.query('insert into auth.users (id, email) values ($1, $2)', [id, `${key}@t.test`]);
  }
  await db.query(
    `insert into public.profiles (id, smk, name, email, mobile, zone_id, sub_zone_id, status)
     values ($1, 'NAV001', 'Nav Yuvak', 'yuvak@t.test', '9800000021', 'surat', 'varachha', 'ACTIVE')`,
    [U.yuvak]
  );
  await db.query(
    `insert into public.admins (id, email, name, role, status)
     values ($1, 'nav@t.test', 'Nav Admin', 'SUPER_ADMIN', 'ACTIVE')`,
    [U.admin]
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
    group('§A  a SUPER_ADMIN saves the bar');

    eq('the trigger is SECURITY DEFINER',
      (await db.query(`select prosecdef from pg_proc
                        where pronamespace = 'public'::regnamespace
                          and proname = 'settings_check_mobile_nav'`)).rows[0]?.prosecdef, true);

    await asUser(db, U.admin, async () => {
      eq('he holds settings.update',
        (await db.query(`select public.has_permission('settings.update') as r`)).rows[0].r, true);

      const res = await attempt(db, UPSERT, [JSON.stringify(BAR)]);
      // Stated as the whole result, so a failure prints the SQLSTATE that caused it rather
      // than "false !== true".
      eq('the payload that returned 403 now writes',
        res.ok ? 'ok' : `${res.code} ${res.message}`, 'ok');
    });

    // Committed this time, so §B and §D are updating a row that exists — the conflict branch
    // of the upsert is the one the panel actually takes on every save after the first.
    await asUser(db, U.admin, async () => {
      await db.query(UPSERT, [JSON.stringify(BAR)]);
    }, { commit: true });

    eq('and the row is there afterwards',
      (await db.query(`select jsonb_array_length(value -> 'mobileBottom') as n
                         from public.settings where key = 'nav'`)).rows[0]?.n, 10);

    // ══════════════════════════════════════════════════════════ §B
    group('§B  the guard still guards');

    await asUser(db, U.admin, async () => {
      // મુખપૃષ્ઠ hidden — §8 of nav_config_error(), the rule that cannot be configured away.
      const noHome = { mobileBottom: BAR.mobileBottom.map((i) =>
        i.key === 'home' ? { ...i, visible: false } : i) };
      const a = await refuse(db, UPSERT, [JSON.stringify(noHome)]);
      refusedWith('hiding home is refused', a, '23514');
      says('with the sentence a સંચાલક reads', a, 'cannot be switched off');

      // One visible item, below the floor of two.
      const one = { mobileBottom: BAR.mobileBottom.map((i, n) =>
        n === 0 ? i : { ...i, visible: false }) };
      const b = await refuse(db, UPSERT, [JSON.stringify(one)]);
      refusedWith('a one-item bar is refused', b, '23514');

      // A destination this build does not have.
      const bad = { mobileBottom: [...BAR.mobileBottom,
        { key: 'custom:btn-2', label: 'Nowhere', icon: 'list', route: '/no-such-page', visible: true, enabled: true, sortOrder: 11 }] };
      refusedWith('an unroutable custom button is refused',
        await refuse(db, UPSERT, [JSON.stringify(bad)]), '23514');

      // 23514 throughout, never 42501 — the refusals must stay distinguishable. A bar refused
      // by a missing grant and a bar refused by a broken rule need different fixes.
      eq('and the stored row is unchanged by any of them',
        (await db.query(`select jsonb_array_length(value -> 'mobileBottom') as n
                           from public.settings where key = 'nav'`)).rows[0]?.n, 10);
    });

    // ══════════════════════════════════════════════════════════ §C
    group('§C  the helpers are still closed to clients');

    const closed = [
      'nav_config_error(jsonb)',
      'nav_config_known(jsonb)',
      'nav_registry()',
      'nav_routes()',
      'nav_icons()',
      'nav_normalize_route(text)',
    ];
    for (const sig of closed) {
      for (const role of ['anon', 'authenticated']) {
        eq(`${role} may not execute ${sig}`,
          (await db.query('select has_function_privilege($1, $2, $3) as r',
            [role, `public.${sig}`, 'execute'])).rows[0].r, false);
      }
    }

    await asUser(db, U.admin, async () => {
      // Not even the SUPER_ADMIN, and that is the point: the fix reaches the validator through
      // the trigger, not by opening it up.
      refusedWith('and a SUPER_ADMIN cannot call the validator directly',
        await refuse(db, `select public.nav_config_error('[]'::jsonb)`), '42501');
    });

    // ══════════════════════════════════════════════════════════ §D
    group('§D  a યુવક is still refused, and by RLS');

    await asUser(db, U.yuvak, async () => {
      eq('he does not hold settings.update',
        (await db.query(`select public.has_permission('settings.update') as r`)).rows[0].r, false);
      const res = await refuse(db, UPSERT, [JSON.stringify(BAR)]);
      // 42501 here is the RLS refusal on `settings`, which is correct and is a different
      // sentence from the function one — asserted so that the two cannot be confused again.
      refusedWith('and his write is refused', res, '42501');
      eq('by the policy, not by a missing function grant',
        String(res.message).includes('nav_config_error'), false);
    });

    // ══════════════════════════════════════════════════════════ §E
    group('§E  the defect, reproduced');

    // Put the trigger back the way 0019 left it. If this does not fail, §A was passing for
    // some reason other than 0041 and every claim in this file is worthless.
    await db.query('alter function public.settings_check_mobile_nav() security invoker');
    await asUser(db, U.admin, async () => {
      const res = await refuse(db, UPSERT, [JSON.stringify(BAR)]);
      refusedWith('as SECURITY INVOKER the same write fails', res, '42501');
      says('naming the function the browser named', res, 'nav_config_error');
    });
    await db.query('alter function public.settings_check_mobile_nav() security definer');

    await asUser(db, U.admin, async () => {
      eq('and restoring the definer restores the save',
        (await attempt(db, UPSERT, [JSON.stringify(BAR)])).ok, true);
    });

    // ══════════════════════════════════════════════════════════ §F
    group('§F  the property, for every trigger in the schema');

    /*
      The defect class, asked of the whole schema rather than of the one function that had it:
      a SECURITY INVOKER trigger function whose body names a function no client role may
      execute. It is silent until someone who is not the owner performs the write, which is
      exactly the shape of bug a suite running as owner cannot see.

      Body text rather than a call graph, deliberately. `pg_depend` does not record calls made
      from a plpgsql body — they are resolved at execution — so there is nothing more exact to
      join against, and a name appearing in a comment costing one false positive is the right
      side to err on for a check whose failure mode is a 403 nobody can explain.
    */
    const suspects = await db.query(`
      with client_closed as (
        select p.oid, p.proname,
               p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as sig
          from pg_proc p
         where p.pronamespace = 'public'::regnamespace
           and not has_function_privilege('authenticated', p.oid, 'execute')
      ),
      trig as (
        select distinct t.tgname, p.oid, p.proname, pg_get_functiondef(p.oid) as src
          from pg_trigger t
          join pg_proc p on p.oid = t.tgfoid
          join pg_class c on c.oid = t.tgrelid
         where not t.tgisinternal
           and c.relnamespace = 'public'::regnamespace
           and not p.prosecdef
      )
      select trig.proname as trigger_function, cc.sig as calls
        from trig
        join client_closed cc on cc.oid <> trig.oid
         and trig.src ~ ('public\\.' || cc.proname || '\\s*\\(')
       order by 1, 2`);

    eq('no invoker trigger calls a function closed to authenticated',
      suspects.rows.map((r) => `${r.trigger_function} -> ${r.calls}`), []);
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
