/**
 * Create (or repair) a સંચાલક account from a plain email + password, with no §3 mobile
 * involved.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why this exists next to scripts/seed-admin-supabase.mjs
 * ────────────────────────────────────────────────────────────────────────────
 *
 * That script seeds a *founding* account: it refuses any --mobile outside ADMIN_MOBILES,
 * because before 0024 the mobile was the authority and the database would have disagreed
 * with anything else. Since 0024 that is no longer how authority works. `effective_role()`
 * reads `public.admin_profiles` first, and `public.bootstrap_admins` only as the lockout
 * fallback — so an ordinary administrator is an `admin_profiles` row, and needs no special
 * number at all.
 *
 * This script writes that row. It takes an email and a password, and produces the three
 * records the panel actually requires:
 *
 *   1. `auth.users`   - the credential, created email-confirmed so it can sign in at once.
 *   2. `public.admins` - identity, role and status ACTIVE. This is what effective_role() returns
 *                       and what has_permission() is asked about by every RLS policy.
 *
 * A `public.profiles` row is **no longer written, and no longer needed**. Until 0038 it was:
 * `admin_profiles.id` referenced `profiles.id`, so an administrator had to be a યુવક first, and
 * because `profiles.mobile` is NOT NULL UNIQUE that meant inventing a mobile number for a person
 * who does not have one here (admin@varni.com carries 9999999999 to this day). 0038 keyed
 * `public.admins` off `auth.users` instead. Pass --with-profile if this administrator should
 * *also* be an ordinary યુવક with a learning record; both together is allowed and is what the
 * founding account is.
 *
 * `admins_guard()` (0038) refuses an INSERT from anyone without `admins.create`,
 * and refuses to grant SUPER_ADMIN to anyone who is not already one - **except** when
 * `auth.uid()` is null, which is exactly this script running with the secret key. That is
 * the documented door for the first administrator and it is the one used here.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Use
 * ────────────────────────────────────────────────────────────────────────────
 *
 *   SUPABASE_SECRET_KEY=... npm run seed:admin:new
 *   SUPABASE_SECRET_KEY=... npm run seed:admin:new -- --email you@example.com --role ADMIN
 *   SUPABASE_SECRET_KEY=... npm run seed:admin:new -- --check
 *
 * With no arguments it seeds admin@varni.com / Admin@12345 as SUPER_ADMIN, which is the
 * account this script was written for. Every part of that is overridable; see DEFAULTS.
 *
 * Re-running is safe and is the repair path: an existing account has its password reset, its
 * email confirmed, and its સંચાલક row re-activated. Nothing is duplicated, and nothing is
 * ever deleted (admin_profiles_no_delete raises even for service_role - suspension is by
 * status, which --status does).
 *
 * SUPABASE_SECRET_KEY bypasses RLS entirely. Pass it in the environment for the length of
 * one command; never write it into a file in this repository (§49, §75).
 *
 * ⚠ Admin@12345 is a default, not a secret. It is in this file, in package.json's history and
 * in the shell that ran it. Change it from the panel (or by re-running with --password) before
 * this account is anything but a way in to a project with no administrator yet.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { MOBILE_RE, EMAIL_RE } from '../shared/domain/constants.js';

const ROOT = path.resolve(import.meta.dirname, '..');

/** public.admin_role, 0004_rbac.sql:35. */
const ROLES = ['SUPER_ADMIN', 'ADMIN', 'CONTENT_MANAGER', 'COORDINATOR', 'VIEWER'];
/** admins.status check constraint, 0038_admins_table.sql. */
const STATUSES = ['ACTIVE', 'SUSPENDED', 'DISABLED'];
/** profiles.sub_zone_id check constraint, 0001_init.sql:29. */
const SUB_ZONES = ['vedroad', 'varachha', 'navsari'];
/** profiles.smk check constraint. Optional since 0027, so '' means "leave it NULL". */
const SMK_RE = /^[A-Z]{3}[0-9]{3}$/;

const DEFAULTS = {
  email: 'admin@varni.com',
  password: 'Admin@12345',
  name: 'Varni Admin',
  // Empty, and that is the fix 0038 bought. `admins.mobile` is nullable contact information;
  // login is by email and netlify/functions/login-mobile.js resolves numbers against `profiles`,
  // which this script no longer writes. Before 0038 a placeholder was mandatory here — that is
  // where admin@varni.com's permanent 9999999999 came from.
  //
  // A number given with --mobile is written to `admins` only. It becomes a login identifier
  // solely if --with-profile is also passed, because then there is a profiles row carrying it.
  mobile: '',
  smk: '',
  zone: 'surat',
  subZone: 'varachha',
  role: 'SUPER_ADMIN',
  status: 'ACTIVE',
};

/**
 * Thrown rather than process.exit()ed: exiting while supabase-js still holds an open handle
 * trips a libuv assertion on Windows, which buries the message that matters.
 */
class Abort extends Error {}
const fail = (msg) => {
  throw new Abort(msg);
};

/** --key value pairs; --check and --dry-run are bare flags. */
function parseArgs(argv) {
  const flags = new Set(['--check', '--dry-run', '--with-profile']);
  const out = {
    check: argv.includes('--check'),
    dryRun: argv.includes('--dry-run'),
    // Off by default since 0038: an administrator is not a યુવક unless someone says so.
    withProfile: argv.includes('--with-profile'),
  };
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--') || flags.has(argv[i])) continue;
    const key = argv[i].slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    out[key] = argv[i + 1];
    i++;
  }
  return out;
}

/**
 * The URL is public and already committed in .env.local, so read it from there rather than
 * making the caller repeat it. Only the secret comes from the environment.
 */
function supabaseUrl() {
  if (process.env.SUPABASE_URL) return process.env.SUPABASE_URL;
  for (const file of ['.env.local', '.env.example']) {
    const p = path.join(ROOT, file);
    if (!fs.existsSync(p)) continue;
    const m = fs.readFileSync(p, 'utf8').match(/^VITE_SUPABASE_URL=(.+)$/m);
    if (m) return m[1].trim();
  }
  return null;
}

/** Command line beats environment beats default, so a scripted run can set either. */
function settings(args) {
  const pick = (argValue, envValue, fallback) =>
    String(argValue ?? envValue ?? fallback).trim();

  const s = {
    email: pick(args.email, process.env.SEED_ADMIN_EMAIL, DEFAULTS.email).toLowerCase(),
    password: String(args.password ?? process.env.SEED_ADMIN_PASSWORD ?? DEFAULTS.password),
    name: pick(args.name, process.env.SEED_ADMIN_NAME, DEFAULTS.name),
    mobile: pick(args.mobile, process.env.SEED_ADMIN_MOBILE, DEFAULTS.mobile),
    smk: pick(args.smk, process.env.SEED_ADMIN_SMK, DEFAULTS.smk).toUpperCase(),
    zone: pick(args.zone, process.env.SEED_ADMIN_ZONE, DEFAULTS.zone),
    subZone: pick(args.subZone, process.env.SEED_ADMIN_SUB_ZONE, DEFAULTS.subZone),
    role: pick(args.role, process.env.SEED_ADMIN_ROLE, DEFAULTS.role).toUpperCase(),
    status: pick(args.status, process.env.SEED_ADMIN_STATUS, DEFAULTS.status).toUpperCase(),
  };

  // Everything the database would reject, rejected here instead - a CHECK violation arrives
  // as a constraint name and tells the person running this nothing about which flag to fix.
  if (!EMAIL_RE.test(s.email)) fail(`--email "${s.email}" is not an email address.`);
  if (s.password.length < 6) fail('--password must be at least six characters (Supabase Auth minimum).');
  if (!s.name) fail('--name cannot be empty.');
  // Optional now. Only checked when one was actually given, and required outright when a
  // profiles row is being written, because profiles.mobile is NOT NULL.
  if (s.mobile && !MOBILE_RE.test(s.mobile)) {
    fail(`--mobile "${s.mobile}" must be 10 digits starting 6-9.`);
  }
  if (args.withProfile && !s.mobile) {
    fail('--with-profile writes a profiles row, whose mobile is NOT NULL. Pass --mobile too.');
  }
  if (s.smk && !SMK_RE.test(s.smk)) fail('--smk must be three letters then three digits, e.g. PVK147.');
  if (!s.zone) fail('--zone cannot be empty.');
  if (!SUB_ZONES.includes(s.subZone)) fail(`--sub-zone must be one of: ${SUB_ZONES.join(', ')}`);
  if (!ROLES.includes(s.role)) fail(`--role must be one of: ${ROLES.join(', ')}`);
  if (!STATUSES.includes(s.status)) fail(`--status must be one of: ${STATUSES.join(', ')}`);

  return s;
}

/** listUsers is paged; the address may be on any page. */
async function findUserByEmail(db, target) {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) fail(`could not list users: ${error.message}`);
    const hit = data.users.find((u) => (u.email || '').toLowerCase() === target);
    if (hit) return hit;
    if (data.users.length < 1000) return null;
  }
  return null;
}

/** Everyone who currently holds a role, by either route effective_role() consults. */
async function report(db) {
  // One table since 0038 - identity is carried on the row itself, so there is no second read
  // against profiles and no "(no profile row?)" case to report.
  const { data: admins, error } = await db
    .from('admins')
    .select('id, email, name, mobile, role, status, created_at')
    .order('created_at');
  if (error) fail(`could not read admins: ${error.message}`);

  if (!admins?.length) {
    console.log('  public.admins is empty - no administrator by the ordinary route.');
  } else {
    // Which of them are also yuvaks. Both at once is allowed (0038) and is worth showing,
    // because it is the difference between "counted in the roll" and not.
    const { data: profiles, error: pErr } = await db
      .from('profiles')
      .select('id')
      .in('id', admins.map((a) => a.id));
    if (pErr) fail(`could not read profiles: ${pErr.message}`);
    const alsoYuvak = new Set((profiles || []).map((p) => p.id));

    for (const a of admins) {
      const contact = a.mobile ? ` ${a.mobile}` : '';
      const both = alsoYuvak.has(a.id) ? '  (also a યુવક)' : '';
      console.log(
        `  ${a.status.padEnd(9)} ${a.role.padEnd(15)} ${a.name} <${a.email}>${contact}${both}`
      );
    }
  }

  // bootstrap_admins has RLS on with no policy, so PostgREST cannot reach it even with the
  // secret key. Say so rather than printing a misleading empty list.
  console.log(
    `\n${admins?.length || 0} row(s) in public.admins. ` +
      'The bootstrap allowlist (0024) is not readable through PostgREST by design;\n' +
      'use `npm run seed:admin:check` for the founding accounts.'
  );
}

async function seed(db, s, dryRun, withProfile) {
  console.log(`  email    ${s.email}`);
  console.log(`  name     ${s.name}`);
  console.log(`  mobile   ${s.mobile || '(none - admins.mobile is optional since 0038)'}`);
  console.log(`  role     ${s.role}  (${s.status})`);
  console.log(
    `  profile  ${withProfile ? `yes - also a યુવક [${s.zone}/${s.subZone}]${s.smk ? ` smk ${s.smk}` : ''}` : 'no - administrator only'}\n`
  );

  if (dryRun) {
    console.log('  --dry-run: nothing written.\n');
    return;
  }

  // -------------------------------------------------------------- 1. auth account

  let user = await findUserByEmail(db, s.email);

  if (user) {
    // Re-running with a different password should set it, so a forgotten one is fixable
    // without the dashboard. email_confirm matters if the account was made by signUp and the
    // link was never opened - it cannot sign in at all until that is true.
    const { error } = await db.auth.admin.updateUserById(user.id, {
      password: s.password,
      email_confirm: true,
    });
    if (error) fail(`could not update the auth account: ${error.message}`);
    console.log(`  auth      reused ${user.id} - password set, email confirmed`);
  } else {
    const { data, error } = await db.auth.admin.createUser({
      email: s.email,
      password: s.password,
      // Confirmed outright: there may be no deployed site to click a link back into, and an
      // unconfirmed account cannot sign in.
      email_confirm: true,
    });
    if (error) fail(`could not create the auth account: ${error.message}`);
    user = data.user;
    console.log(`  auth      created ${user.id}`);
  }

  // -------------------------------------------------------------- 2. profile row, if asked
  //
  // Skipped entirely by default since 0038. An administrator with no profile is a complete,
  // working account: `public.admins` carries the identity, and nothing in the panel reads
  // `profiles` to decide what an administrator may do.

  const { data: profile, error: readErr } = await db
    .from('profiles')
    .select('id, smk, name, email, mobile, sub_zone_id')
    .eq('id', user.id)
    .maybeSingle();
  if (readErr) fail(`could not read the profile: ${readErr.message}`);

  if (!withProfile && !profile) {
    console.log('  profile   none - not written (pass --with-profile to make this a યુવક too)');
  } else if (profile) {
    console.log(`  profile   exists - ${profile.name} <${profile.email}> ${profile.mobile}`);
    if (s.mobile && profile.mobile !== s.mobile) {
      // profiles_guard_immutable blocks changing mobile and email, service_role included.
      // Saying so is more useful than an update guaranteed to raise.
      console.log(
        `            note: stored mobile ${profile.mobile} differs from --mobile ${s.mobile}.\n` +
          '            mobile and email are immutable by trigger; the row would have to be\n' +
          '            deleted and re-created to change them.'
      );
    }
  } else {
    const row = {
      id: user.id,
      name: s.name,
      email: s.email,
      mobile: s.mobile,
      zone_id: s.zone,
      sub_zone_id: s.subZone,
    };
    if (s.smk) row.smk = s.smk;

    const { error } = await db.from('profiles').insert(row);
    if (error) {
      const which = error.message.includes('profiles_mobile_key')
        ? `mobile ${s.mobile} already belongs to another profile - pass a free --mobile.`
        : error.message.includes('profiles_smk_key')
          ? `SMK ${s.smk} is already taken by another profile.`
          : error.message;
      fail(
        `the auth account exists but the profile insert failed:\n  ${which}\n` +
          'Fix the value and re-run - the account is reused, not duplicated.'
      );
    }
    console.log(`  profile   created - ${s.name} ${s.mobile} [${s.zone}/${s.subZone}]`);
  }

  // -------------------------------------------------------------- 3. સંચાલક record
  //
  // This is the row that actually grants anything. auth.uid() is null here, so admins_guard()
  // (0038) stands aside: no admins.create permission is demanded, the "cannot appoint
  // themselves" rule does not apply, and SUPER_ADMIN may be granted with no SUPER_ADMIN present
  // to grant it. That is the bootstrap door and it is server-side only.

  const { data: existingAdmin, error: adminReadErr } = await db
    .from('admins')
    .select('id, role, status')
    .eq('id', user.id)
    .maybeSingle();
  if (adminReadErr) fail(`could not read admins: ${adminReadErr.message}`);

  if (existingAdmin) {
    if (existingAdmin.role === s.role && existingAdmin.status === s.status) {
      console.log(`  admin     already ${s.role} (${s.status}) - unchanged`);
    } else {
      const { error } = await db
        .from('admins')
        .update({ role: s.role, status: s.status })
        .eq('id', user.id);
      if (error) fail(`could not update the admin record: ${error.message}`);
      console.log(
        `  admin     ${existingAdmin.role} (${existingAdmin.status}) -> ${s.role} (${s.status})`
      );
    }
  } else {
    const { error } = await db.from('admins').insert({
      id: user.id,
      email: s.email,
      name: s.name,
      // null and not '': the column is nullable and a partial UNIQUE index sits on it, so an
      // empty string would be a value two admins could not both hold.
      mobile: s.mobile || null,
      role: s.role,
      status: s.status,
      display_name: s.name,
      // created_by stays NULL: nobody appointed this account, the seed script did. The guard
      // only fills it in when there IS a caller, and there is not one here.
    });
    if (error) fail(`could not create the admin record: ${error.message}`);
    console.log(`  admin     created - ${s.role} (${s.status})`);
  }

  // -------------------------------------------------------------- verify

  const { data: check, error: checkErr } = await db
    .from('admins')
    .select('role, status')
    .eq('id', user.id)
    .maybeSingle();
  if (checkErr) fail(`could not verify the admin record: ${checkErr.message}`);
  if (!check || check.status !== 'ACTIVE') {
    console.log(
      `\nWritten, but effective_role() will return NULL: status is ${check?.status || 'missing'}.\n` +
        'Only ACTIVE opens the panel.\n'
    );
    return;
  }

  console.log('\nDone. effective_role() now returns ' + check.role + ' for this account.\n');
  console.log('Sign in at /admin/ with:');
  console.log(`  email     ${s.email}`);
  console.log(`  password  ${s.password === DEFAULTS.password ? DEFAULTS.password : '(the one you passed)'}`);
  // Only true when a profiles row exists: login-mobile.js resolves numbers against profiles,
  // never against admins.mobile.
  if (withProfile) {
    console.log(`  or mobile ${s.mobile} on the yuvak app, same password.`);
  }
  console.log('');
  if (s.password === DEFAULTS.password) {
    console.log('Change this password before the account matters. It is a default, not a secret.\n');
  }
}

async function main() {
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) {
    fail(
      'SUPABASE_SECRET_KEY is not set.\n' +
        'Supabase -> Project Settings -> API Keys -> the secret (service_role) key.\n' +
        'Pass it in the environment. Do not save it into this repository.'
    );
  }

  const url = supabaseUrl();
  if (!url) fail('Could not find VITE_SUPABASE_URL in .env.local. Set SUPABASE_URL instead.');

  // No session to persist and no token to refresh - this is a one-shot server process.
  const db = createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const args = parseArgs(process.argv.slice(2));
  console.log(`\nproject: ${url}\n`);

  if (args.check) await report(db);
  else await seed(db, settings(args), args.dryRun, args.withProfile);
}

try {
  await main();
} catch (e) {
  console.error(`\n${e instanceof Abort ? e.message : e.stack || e}\n`);
  process.exitCode = 1;
}
