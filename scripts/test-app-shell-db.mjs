/**
 * The icon and the session length, as the DATABASE enforces them - against a real Postgres.
 *
 *     VARNI_PGTEST_PORT=54901 VARNI_PGTEST_IMAGE=postgres:16-alpine node scripts/test-app-shell-db.mjs
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why this exists next to scripts/test-app-shell.mjs
 * ────────────────────────────────────────────────────────────────────────────
 *
 * That suite tests `shared/domain/appicon.js` and `shared/domain/session.js` - the rules as the
 * panel and the app apply them. This one tests the same rules where PostgREST cannot go around
 * them, and the difference is the whole reason 0042 has triggers at all: `settings` is writable
 * by anyone `has_permission('settings.update')` admits, over HTTP, without going near admin/src.
 * A bound that lives only in JavaScript is a bound a curl does not have.
 *
 * The two must agree, so §F compares them directly rather than trusting that two people wrote
 * the same numbers twice.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why the rules are worth this much checking
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Both fields are read by every one of the ~2,000 યુવકો, and neither has a screen that shows
 * what went wrong:
 *
 *   * A damaged `appIcon` does not produce an error message. It produces a blank square on two
 *     thousand home screens, and on an iPhone it produces one that cannot be corrected - iOS
 *     copies the icon at "Add to Home Screen" and never reads the page again.
 *   * A damaged `session` signs the whole સંઘ out, repeatedly, with nothing anywhere saying
 *     why. `hours: 0` is the specific value that turns the app into a login screen that
 *     reappears on every foreground, which is why the floor is 1 in both places.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * The groups
 * ────────────────────────────────────────────────────────────────────────────
 *
 *  §A  The bucket exists, and with the limit and the one mime type 0042 argues for.
 *  §B  Who may put bytes in it: a settings admin yes, a યુવક no.
 *  §C  settings_check_app_icon() - every branch, including that JSON null is ACCEPTED, because
 *      an admin who can set a custom icon and never take it back is trapped.
 *  §D  settings_check_session() - every branch, including that `hours` is validated while the
 *      policy is switched off, since that is the value that comes into force when it is not.
 *  §E  Neither guard interferes with an unrelated settings write.
 *  §F  The SQL bounds and the JavaScript bounds are the same numbers.
 */
import {
  APP_ICON_MAX_BYTES,
  APP_ICON_BUCKET,
  APP_ICON_MIME,
} from '../shared/domain/appicon.js';
import { SESSION_MAX_HOURS, SESSION_MIN_HOURS } from '../shared/domain/session.js';
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
  A refused statement aborts the enclosing transaction, and `asUser()` runs everything inside
  one - so a second refusal in the same block would report 25P02 "current transaction is
  aborted" and the SQLSTATE being asserted would be lost. §C and §D are almost entirely
  refusals, so every one of them goes through here.
*/
const refuse = async (db, sql, params = []) => {
  await db.query('savepoint s');
  const res = await attempt(db, sql, params);
  await db.query('rollback to savepoint s');
  return res;
};

const U = {
  admin: '30000000-0000-4000-8000-000000000001',
  yuvak: '30000000-0000-4000-8000-000000000002',
};

const UPSERT = `
  insert into public.settings (key, value, updated_at)
  values ('app', $1::jsonb, now())
  on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at`;

/** A well-formed icon row, which every §C case then damages in exactly one way. */
const GOOD_ICON = {
  url: 'https://tjovudfsodviwijyyvdw.supabase.co/storage/v1/object/public/app-icon/icon-7.png',
  path: 'icon-7.png',
  size: 41233,
  version: 3,
  updatedAt: '2026-08-15T06:00:00.000Z',
};

const icon = (patch) => JSON.stringify({ appIcon: { ...GOOD_ICON, ...patch } });
const session = (patch) => JSON.stringify({ session: { enabled: false, hours: 24, ...patch } });

async function fixtures(db) {
  for (const [key, id] of Object.entries(U)) {
    await db.query('insert into auth.users (id, email) values ($1, $2)', [id, `${key}@t.test`]);
  }
  await db.query(
    `insert into public.profiles (id, smk, name, email, mobile, zone_id, sub_zone_id, status)
     values ($1, 'ICO001', 'Icon Yuvak', 'iyuvak@t.test', '9800000031', 'surat', 'varachha', 'ACTIVE')`,
    [U.yuvak]
  );
  await db.query(
    `insert into public.admins (id, email, name, role, status)
     values ($1, 'icon@t.test', 'Icon Admin', 'SUPER_ADMIN', 'ACTIVE')`,
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
    group('§A  the bucket');

    const bucket = (
      await db.query(
        'select public, file_size_limit, allowed_mime_types from storage.buckets where id = $1',
        [APP_ICON_BUCKET]
      )
    ).rows[0];

    eq('the app-icon bucket exists', Boolean(bucket), true);
    // Public because Google's WebAPK minter fetches the icon from its own servers with no
    // Supabase session of any kind. A signed URL would be unfetchable by the one consumer that
    // decides whether an installed Android phone ever gets the new mark.
    eq('and it is public', bucket?.public, true);
    eq('with the 512 KB ceiling the panel also checks', Number(bucket?.file_size_limit), APP_ICON_MAX_BYTES);
    // PNG alone. Whatever the bytes are, this bucket can only ever serve them as image/png,
    // which no browser will render as a page - the same argument 0007 makes for audio/mpeg.
    eq('and png alone', bucket?.allowed_mime_types, APP_ICON_MIME);

    // ══════════════════════════════════════════════════════════ §B
    group('§B  who may put bytes in it');

    await asUser(db, U.admin, async () => {
      eq('a SUPER_ADMIN holds settings.update',
        (await db.query(`select public.has_permission('settings.update') as r`)).rows[0].r, true);
      const res = await attempt(db,
        `insert into storage.objects (bucket_id, name, owner) values ($1, 'icon-9.png', $2)`,
        [APP_ICON_BUCKET, U.admin]);
      eq('and he may upload an icon', res.ok ? 'ok' : `${res.code} ${res.message}`, 'ok');
    });

    await asUser(db, U.yuvak, async () => {
      // The case that actually matters: ~2,000 signed-in yuvaks, none of whom may put a byte
      // on the project's own domain.
      refusedWith('a યુવક may not',
        await refuse(db,
          `insert into storage.objects (bucket_id, name, owner) values ($1, 'sneaky.png', $2)`,
          [APP_ICON_BUCKET, U.yuvak]),
        '42501');
    });

    // ══════════════════════════════════════════════════════════ §C
    group('§C  settings_check_app_icon()');

    await asUser(db, U.admin, async () => {
      eq('a well-formed icon is stored',
        (await attempt(db, UPSERT, [icon({})])).ok ? 'ok' : 'refused', 'ok');

      /*
        The branch that is easiest to get wrong by being strict. "Use the built-in icon" writes
        JSON null, and a guard that refused it would leave a સંચાલક able to set a custom icon
        and never able to take it back.
      */
      eq('null clears it back to the built-in mark',
        (await attempt(db, UPSERT, [JSON.stringify({ appIcon: null })])).ok ? 'ok' : 'refused', 'ok');

      refusedWith('a string is not an icon',
        await refuse(db, UPSERT, [JSON.stringify({ appIcon: 'icon.png' })]), '23514');

      refusedWith('an icon with no url is refused',
        await refuse(db, UPSERT, [JSON.stringify({ appIcon: { version: 1 } })]), '23514');
      refusedWith('and neither is a blank one',
        await refuse(db, UPSERT, [icon({ url: '   ' })]), '23514');

      /*
        http: and data: are the two that fail *silently* in production, which is why both are
        refused here rather than left to the browser. An http: icon on an https page is dropped
        as mixed content; a data: URL means nothing to the WebAPK minter, which fetches from
        Google's servers. Both end at a blank square on a home screen with nothing saying why.
      */
      const plain = await refuse(db, UPSERT, [icon({ url: 'http://example.com/icon.png' })]);
      refusedWith('an http:// icon is refused', plain, '23514');
      says('and the message names the rule', plain, 'https://');
      refusedWith('a data: icon is refused',
        await refuse(db, UPSERT, [icon({ url: 'data:image/png;base64,iVBORw0KGgo=' })]), '23514');
      refusedWith('a blob: icon is refused',
        await refuse(db, UPSERT, [icon({ url: 'blob:https://varni-dhyan.netlify.app/abc' })]), '23514');

      refusedWith('an oversize icon is refused',
        await refuse(db, UPSERT, [icon({ size: APP_ICON_MAX_BYTES + 1 })]), '23514');
      eq('and one exactly at the ceiling is not',
        (await attempt(db, UPSERT, [icon({ size: APP_ICON_MAX_BYTES })])).ok ? 'ok' : 'refused', 'ok');

      /*
        The version counter is required rather than defaulted. It is what the phone compares
        against to decide whether it has already shown the iPhone reinstall notice, and what
        makes the URL new enough for Chrome to re-fetch past an hour of Supabase cache. A row
        written without one changes the icon in the database and nowhere else.
      */
      refusedWith('an icon with no version is refused',
        await refuse(db, UPSERT, [JSON.stringify({ appIcon: { url: GOOD_ICON.url } })]), '23514');
      refusedWith('version 0 is refused',
        await refuse(db, UPSERT, [icon({ version: 0 })]), '23514');
      refusedWith('a fractional version is refused',
        await refuse(db, UPSERT, [icon({ version: 1.5 })]), '23514');
      refusedWith('a version that is not a number is refused',
        await refuse(db, UPSERT, [icon({ version: '3' })]), '23514');
    });

    // ══════════════════════════════════════════════════════════ §D
    group('§D  settings_check_session()');

    await asUser(db, U.admin, async () => {
      eq('a well-formed policy is stored',
        (await attempt(db, UPSERT, [session({})])).ok ? 'ok' : 'refused', 'ok');
      eq('and an enabled one',
        (await attempt(db, UPSERT, [session({ enabled: true, hours: 24 })])).ok ? 'ok' : 'refused', 'ok');

      refusedWith('a non-boolean enabled is refused',
        await refuse(db, UPSERT, [session({ enabled: 'true' })]), '23514');

      /*
        The floor exists because 0 is not a short session. It is a login screen that reappears
        on every foreground - indistinguishable from a broken app, reachable by mistyping, and
        felt by two thousand people at once.
      */
      refusedWith('hours 0 is refused', await refuse(db, UPSERT, [session({ hours: 0 })]), '23514');
      eq(`hours ${SESSION_MIN_HOURS} is the floor and is accepted`,
        (await attempt(db, UPSERT, [session({ hours: SESSION_MIN_HOURS })])).ok ? 'ok' : 'refused', 'ok');
      eq(`hours ${SESSION_MAX_HOURS} is the ceiling and is accepted`,
        (await attempt(db, UPSERT, [session({ hours: SESSION_MAX_HOURS })])).ok ? 'ok' : 'refused', 'ok');
      refusedWith('one hour past the ceiling is refused',
        await refuse(db, UPSERT, [session({ hours: SESSION_MAX_HOURS + 1 })]), '23514');
      refusedWith('a mistyped 99999 is refused rather than becoming "never"',
        await refuse(db, UPSERT, [session({ hours: 99999 })]), '23514');
      refusedWith('fractional hours are refused',
        await refuse(db, UPSERT, [session({ hours: 2.5 })]), '23514');
      refusedWith('hours as a string is refused',
        await refuse(db, UPSERT, [session({ hours: '24' })]), '23514');

      /*
        The bound applies while the policy is OFF, and that is the case worth a test of its own.
        A row holding `{enabled: false, hours: 0}` looks harmless and is not: it is the value
        that comes into force the instant somebody ticks the box, from a screen that shows him
        the number he is enabling but never tells him it is out of range.
      */
      refusedWith('and hours are checked even while the policy is switched off',
        await refuse(db, UPSERT, [session({ enabled: false, hours: 0 })]), '23514');

      eq('null is accepted, as it is for the icon',
        (await attempt(db, UPSERT, [JSON.stringify({ session: null })])).ok ? 'ok' : 'refused', 'ok');
    });

    // ══════════════════════════════════════════════════════════ §E
    group('§E  neither guard touches anything else');

    await asUser(db, U.admin, async () => {
      eq('a settings write naming neither key passes',
        (await attempt(db, UPSERT, [JSON.stringify({ appName: 'વર્ણી ધ્યાન', maintenance: false })])).ok
          ? 'ok' : 'refused', 'ok');
      // The other rows have their own guards (0018, 0023, 0034, 0035) and must be unaffected.
      eq('and so does a write to a different settings row',
        (await attempt(db,
          `insert into public.settings (key, value, updated_at) values ('journey', '{}'::jsonb, now())
             on conflict (key) do update set value = excluded.value`)).ok ? 'ok' : 'refused', 'ok');
    });

    // ══════════════════════════════════════════════════════════ §F
    group('§F  the SQL bounds and the JavaScript bounds are one set of numbers');

    /*
      Read out of the function bodies rather than restated here. A test that hard-coded 524288
      and 720 a third time would pass on the day somebody changed the migration and not the
      shared module - which is the exact drift this group exists to catch.
    */
    const src = (
      await db.query(`select prosrc from pg_proc
                       where pronamespace = 'public'::regnamespace
                         and proname in ('settings_check_app_icon', 'settings_check_session')`)
    ).rows.map((r) => r.prosrc).join('\n');

    eq('the icon ceiling in SQL is APP_ICON_MAX_BYTES',
      src.includes(String(APP_ICON_MAX_BYTES)), true);
    eq('the session floor in SQL is SESSION_MIN_HOURS',
      new RegExp(`n < ${SESSION_MIN_HOURS}\\b`).test(src), true);
    eq('the session ceiling in SQL is SESSION_MAX_HOURS',
      new RegExp(`n > ${SESSION_MAX_HOURS}\\b`).test(src), true);

    /*
      And the property 0041 was written about, asked of the two triggers this migration adds:
      a SECURITY INVOKER trigger calling a function no client role may execute fails with 42501
      for everybody, silently, until someone who is not the owner performs the write.
      scripts/test-nav-grants.mjs §F asks it of the whole schema; this asks it of these two by
      name, so a failure here says which migration introduced it.
    */
    const secdef = (
      await db.query(`select proname, prosecdef from pg_proc
                       where pronamespace = 'public'::regnamespace
                         and proname in ('settings_check_app_icon', 'settings_check_session')
                       order by proname`)
    ).rows;
    eq('both guards exist', secdef.map((r) => r.proname),
      ['settings_check_app_icon', 'settings_check_session']);
    eq('both are self-contained, so invoker is safe',
      /public\.(?!has_permission)[a-z_]+\s*\(/.test(src), false);

    await asUser(db, U.admin, async () => {
      // The end-to-end statement of the same thing: an admin's write must not die inside its
      // own guard the way settings['nav'] did.
      const res = await attempt(db, UPSERT, [icon({ version: 9 })]);
      eq('and a SUPER_ADMIN can actually save an icon', res.ok ? 'ok' : `${res.code} ${res.message}`, 'ok');
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
