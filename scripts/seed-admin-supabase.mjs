/**
 * Create a સંચાલક account directly in Supabase.
 *
 * This replaces scripts/seed-admin.mjs, which granted a Firebase custom claim and means
 * nothing here: on Supabase there is no claim to mint. public.is_admin() decides
 * authority live, by looking up the caller's mobile in the list hardcoded in
 * supabase/migrations/0001_init.sql. So "seeding an admin" is only ever two ordinary
 * writes — an auth account, and a profile row carrying one of those mobiles.
 *
 * The normal path for this is registration in the app. This script exists for the first
 * account, when there is no deployed site to register on, and because it can confirm the
 * email outright instead of waiting on an inbox.
 *
 *   SUPABASE_SECRET_KEY=... SEED_ADMIN_PASSWORD=... npm run seed:admin -- \
 *     --email you@example.com --mobile 9925842081 --smk PVK147 --name "…" --sub-zone varachha
 *
 *   SUPABASE_SECRET_KEY=... npm run seed:admin:check
 *
 * SUPABASE_SECRET_KEY bypasses RLS entirely — it can read and rewrite every yuvak's row.
 * Pass it from the environment for the length of one command; never write it into a file
 * in this repository, and never paste it into a commit (§49, §75).
 *
 * Refusing to promote arbitrary numbers is the point: --mobile must already be in
 * ADMIN_MOBILES, which is a copy of the list inside is_admin(). A number this script
 * would accept but the database would not is worse than useless, so it checks first.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { MOBILE_RE, EMAIL_RE } from '../shared/domain/constants.js';
/*
  The founding numbers, from the module that exists so they cannot reach a browser. This
  script is the only legitimate reader — see shared/domain/admin-bootstrap.js. It runs in
  Node, by hand, with the secret key; nothing here is bundled.
*/
import { ADMIN_MOBILES } from '../shared/domain/admin-bootstrap.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const SUB_ZONES = ['vedroad', 'varachha', 'navsari'];
const SMK_RE = /^[A-Z]{3}[0-9]{3}$/;

/**
 * Thrown rather than process.exit()ed: exiting while supabase-js still holds an open
 * handle trips a libuv assertion on Windows, which buries the message that matters.
 */
class Abort extends Error {}
const fail = (msg) => {
  throw new Abort(msg);
};

/** --key value pairs; --check is a bare flag. */
function parseArgs(argv) {
  const out = { check: argv.includes('--check') };
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--') || argv[i] === '--check') continue;
    const key = argv[i].slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    out[key] = argv[i + 1];
    i++;
  }
  return out;
}

/**
 * The URL is public and already committed in .env.local, so read it from there rather
 * than making the caller repeat it. Only the secret comes from the environment.
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

/** Which of the સંચાલક numbers actually have a profile behind them yet. */
async function report(db) {
  const { data, error } = await db
    .from('profiles')
    .select('id, smk, name, email, mobile, sub_zone_id, created_at')
    .in('mobile', ADMIN_MOBILES);
  if (error) fail(`could not read profiles: ${error.message}`);

  const byMobile = new Map((data || []).map((r) => [r.mobile, r]));
  for (const mobile of ADMIN_MOBILES) {
    const row = byMobile.get(mobile);
    if (!row) {
      console.log(`  ${mobile}  — no profile yet (not an admin until one exists)`);
      continue;
    }
    console.log(`  ${mobile}  — ${row.smk}  ${row.name}  <${row.email}>  [${row.sub_zone_id}]`);
  }
  console.log(`\n${byMobile.size} of ${ADMIN_MOBILES.length} સંચાલક number(s) registered.`);
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

async function seed(db, args) {
  const email = String(args.email || '').trim().toLowerCase();
  const mobile = String(args.mobile || '').trim();
  const smk = String(args.smk || '').trim().toUpperCase();
  const name = String(args.name || '').trim();
  const subZoneId = String(args.subZone || '').trim();
  const zoneId = String(args.zone || 'surat').trim();
  const password = process.env.SEED_ADMIN_PASSWORD;

  if (!EMAIL_RE.test(email)) fail('--email is missing or not an email address.');
  if (!MOBILE_RE.test(mobile)) fail('--mobile must be 10 digits starting 6-9.');
  if (!SMK_RE.test(smk)) fail('--smk must be three letters then three digits, e.g. PVK147.');
  if (!name) fail('--name is required.');
  if (!SUB_ZONES.includes(subZoneId)) fail(`--sub-zone must be one of: ${SUB_ZONES.join(', ')}`);
  if (!password || password.length < 6) {
    fail('SEED_ADMIN_PASSWORD is not set, or is shorter than six characters.');
  }

  // The whole reason the list lives in code: this script cannot invent authority, it can
  // only fill in an account for a number the database already recognises.
  if (!ADMIN_MOBILES.includes(mobile)) {
    fail(
      `${mobile} is not a સંચાલક number.\n` +
        'is_admin() would return false for this account, so seeding it would grant nothing.\n' +
        'Add the number to shared/domain/constants.js *and* to is_admin() in a new\n' +
        'migration first — both, or the UI and the database disagree about who is admin.'
    );
  }

  // -------------------------------------------------------------- auth account

  let user = await findUserByEmail(db, email);

  if (user) {
    console.log(`  auth account ${email} already exists (${user.id})`);
    // Re-running with a different password should set it, so a forgotten one is fixable
    // without the dashboard. email_confirm matters if the account was made by signUp and
    // the confirmation link was never opened — it cannot sign in until it is true.
    const { error } = await db.auth.admin.updateUserById(user.id, {
      password,
      email_confirm: true,
    });
    if (error) fail(`could not update the account: ${error.message}`);
    console.log('  password set and email confirmed');
  } else {
    const { data, error } = await db.auth.admin.createUser({
      email,
      password,
      // Confirmed outright: there is no deployed site to click a link back into yet, and
      // an unconfirmed account cannot sign in at all.
      email_confirm: true,
    });
    if (error) fail(`could not create the account: ${error.message}`);
    user = data.user;
    console.log(`  auth account created (${user.id})`);
  }

  // -------------------------------------------------------------- profile row

  const { data: existing, error: readErr } = await db
    .from('profiles')
    .select('id, smk, name, email, mobile, sub_zone_id')
    .eq('id', user.id)
    .maybeSingle();
  if (readErr) fail(`could not read the profile: ${readErr.message}`);

  if (existing) {
    console.log(`  profile already exists: ${existing.smk} ${existing.name} <${existing.email}>`);
    if (existing.mobile !== mobile || existing.smk !== smk) {
      // profiles_guard_immutable blocks changing these, service_role included. Saying so
      // is more useful than an update that is guaranteed to raise.
      console.log(
        `  note: stored mobile/smk (${existing.mobile}/${existing.smk}) differ from the\n` +
          '        arguments given. These are immutable by trigger and cannot be corrected;\n' +
          '        the row would have to be deleted and re-created.'
      );
    }
  } else {
    // A duplicate mobile or smk belonging to *another* account surfaces here as 23505.
    const { error } = await db.from('profiles').insert({
      id: user.id,
      smk,
      name,
      email,
      mobile,
      zone_id: zoneId,
      sub_zone_id: subZoneId,
    });
    if (error) {
      const which = error.message.includes('profiles_smk_key')
        ? `SMK ${smk} is already taken by another profile.`
        : error.message.includes('profiles_mobile_key')
          ? `mobile ${mobile} is already on another profile.`
          : error.message;
      fail(
        `the auth account exists but the profile insert failed:\n  ${which}\n` +
          'Fix the value and re-run — the account is reused, not duplicated.'
      );
    }
    console.log(`  profile created: ${smk} ${name} [${zoneId}/${subZoneId}]`);
  }

  console.log('\nis_admin() will now return true for this account. Verifying…');
  await report(db);

  console.log(
    '\nSign in at the યુવક app with this email (or the mobile, via /api/login-mobile)\n' +
      'and the password you passed. Nothing else is needed — there is no claim to refresh.\n'
  );
}

async function main() {
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) {
    fail(
      'SUPABASE_SECRET_KEY is not set.\n' +
        'Supabase → Project Settings → API Keys → the secret (service_role) key.\n' +
        'Pass it in the environment. Do not save it into this repository.'
    );
  }

  const url = supabaseUrl();
  if (!url) fail('Could not find VITE_SUPABASE_URL in .env.local. Set SUPABASE_URL instead.');

  // No session to persist and no token to refresh — this is a one-shot server process.
  const db = createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const args = parseArgs(process.argv.slice(2));

  console.log(`\nproject: ${url}`);
  console.log(
    `સંચાલક numbers (is_admin() + shared/domain/constants.js): ${ADMIN_MOBILES.join(', ')}\n`
  );

  if (args.check) await report(db);
  else await seed(db, args);
}

try {
  await main();
} catch (e) {
  console.error(`\n${e instanceof Abort ? e.message : e.stack || e}\n`);
  process.exitCode = 1;
}
