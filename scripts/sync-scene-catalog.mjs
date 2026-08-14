/**
 * Fill `public.scene_catalog` from `content/darshan.json` — `npm run catalog`.
 *
 *   npm run catalog:dry                                    report, send nothing
 *   SUPABASE_DB_PASSWORD=... npm run catalog                the real thing
 *   SUPABASE_DB_PASSWORD=... npm run catalog -- --as <uuid> as a named સંચાલક
 *   npm run catalog -- --file some/other/darshan.json      a manifest from elsewhere
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why this script exists at all
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `activity_submit()` says, in its own comment, that it does **not** intersect the submitted
 * દ્રશ્ય ids with a live collection, "because લેવલ ૩ has no fixed list to intersect with"
 * (0021_progress_history_points.sql:804-806). That was simply true. The collection is
 * `content/darshan.json`, a file in the browser bundle; `public.scenes` holds only the rows a
 * સંચાલક has actually touched. So Postgres could exclude a *withheld* દ્રશ્ય through
 * `admin_withheld_scene_ids()` (0029:197) but had no way whatsoever to refuse an id it had
 * simply never heard of. Five hundred invented ids counted as five hundred ticks.
 *
 * 0035_level3_revisions.sql adds `public.scene_catalog` — ids only — and this script is the one
 * thing that fills it. **Until it runs the catalogue is empty, `scene_catalog_ready()` is false,
 * every membership test in `award_points()` is skipped, and behaviour is exactly what it was
 * before the migration** (0035:157-169, :583-588). Applying 0035 changes nothing; running this
 * is what turns the check on. That is deliberate on the migration's part and worth restating
 * here, because it means this script is a deployment step and not a build step: nothing breaks
 * if it is late, and something real changes when it lands.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Every id in the manifest, and NOT only the ones a યુવક can see today
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The યુવક app puts a દ્રશ્ય through two gates before showing it (`src/lib/useScenes.js:107-129`):
 *
 *   1. `isWithheld(row)` — the સંચાલક gate. A `public.scenes` row whose status is not
 *      PUBLISHED/ACTIVE is withheld (`useScenes.js:22-24`).
 *   2. `isLearnable(entry)` — the content gate. A દ્રશ્ય is learnable only with BOTH an image and
 *      a વર્ણન (`shared/domain/darshan.js:54`).
 *
 * **Neither gate is applied to what this script sends, and that is the decision.** The catalogue
 * answers one question and only one — *is this an id of this collection at all* — and both gates
 * are already answered elsewhere, at read time, by people and code that own them:
 *
 *   * Withholding is server-side already. `live_scene_ids()` is *the catalogue minus*
 *     `admin_withheld_scene_ids()` (0035:179-189), evaluated per statement, so a દ્રશ્ય the
 *     સંચાલક withholds at noon stops being payable at noon — without this script running again.
 *     Filtering it out here instead would delete it from the catalogue, and then restoring it
 *     tomorrow would leave the server unable to recognise its own id until somebody remembered
 *     to re-run a Node script. A catalogue that has to be re-synced to undo an admin's toggle is
 *     a catalogue that will be wrong most of the time.
 *   * The content gate moves without the manifest moving. `applyOverlay()` re-derives `active`
 *     from a વર્ણન written in the panel (`shared/domain/darshan.js:93-100`), which is how દ્રશ્ય
 *     ૧૦૧-૧૦૯ go live "by being filled in, not by a deploy". An id that fails `isLearnable`
 *     against the raw manifest today can pass it this afternoon with no rebuild at all.
 *
 * So the catalogue carries every id the manifest contains. It can only ever *reduce* what is
 * paid (0035:521-522), and it must not reduce it for a reason that has already been accounted
 * for twice.
 *
 * `display_index` rides along because it is nullable and free: the column exists so a report
 * printing "દ્રશ્ય ૪૨" need not ask a browser what ૪૨ means (0035:131-138). It is filled from
 * `withDisplayIndex()` — the one derivation of the number a યુવક reads (ORDERING.md §2,
 * `shared/domain/darshan.js:290`) — computed over the manifest alone, so a દ્રશ્ય that the
 * manifest itself cannot number (no image, or no વર્ણન) is sent with no number rather than with
 * a guessed one. It is advisory in the strict sense: the id is what every check turns on, and a
 * સંચાલક who renumbers in the panel moves the display number without moving the id.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * How it authenticates, and why it impersonates rather than bypasses
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `scene_catalog_sync()` is SECURITY DEFINER and opens with `has_permission('darshan.update')`
 * (0035:219-221). That permission is derived from `auth.uid()` through `effective_role()`
 * (0004_rbac.sql:119-150), and `auth.uid()` reads `request.jwt.claims`. A direct psql-style
 * connection has no claims at all, so connecting as the owner is not enough: superuser bypasses
 * *grants*, never a `raise exception` inside the function body.
 *
 * The answer is the same one `scripts/lib/pgtest.mjs:195-213` uses — set `request.jwt.claims` to
 * a real સંચાલક's id for the length of one transaction, and let the database decide from there.
 * The alternative, writing to `public.scene_catalog` directly as the owner, would work and is
 * refused on purpose: it would skip the empty-payload refusal, skip the single-transaction
 * replacement, and put a second writer beside a function whose whole value is being the only one.
 *
 * Who to impersonate is asked of the database rather than assumed: the ACTIVE rows of
 * `admin_profiles` and the founding accounts in `bootstrap_admins` (0024:88-94) are the
 * candidates, and each is probed with `has_permission('darshan.update')` until one answers true.
 * No list of privileged mobiles is copied into this file — 0024 exists precisely because such a
 * list, in the wrong place, was an unclaimed SUPER_ADMIN account.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Credentials
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `SUPABASE_DB_PASSWORD` is the Postgres password from Supabase → Settings → Database, and the
 * connection targets are `scripts/db.mjs`'s, unchanged. It is a real credential with full
 * database access: pass it from the environment for the length of one command, never write it
 * into a file in this repository, and note that nothing in this script prints it, echoes a
 * connection string, or writes either to disk (§49, §75). A failed connection reports the host
 * and the error code, exactly as db.mjs does, and nothing else.
 *
 * This script is NOT `scripts/db.mjs migrate` and must never be confused with it. It applies no
 * SQL file and touches no schema; production's `schema_migrations` bookkeeping has drifted from
 * its schema (db.mjs:78-89) and none of that is this script's business. It calls one function.
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
// Straight from shared/, not a copy. The number this script stores beside an id must be the
// number the two apps derive, and the repo is `"type": "module"` so Node imports it as-is.
import { darshanId, withDisplayIndex } from '../shared/domain/darshan.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const DEFAULT_MANIFEST = path.join(ROOT, 'content', 'darshan.json');

/** db.mjs's project. Kept here rather than imported because db.mjs runs on import. */
const PROJECT_REF = 'tjovudfsodviwijyyvdw';

// ------------------------------------------------------------------ CLI
//
// The flag vocabulary is build-darshan.mjs's, deliberately: `--dry-run` means "report, write
// nothing" in this repository and must go on meaning that (`npm run darshan:dry`).
const argv = process.argv.slice(2);
const has = (name) => argv.includes(name);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? null : argv[i + 1];
};

if (has('--help') || has('-h')) {
  console.log(`
  npm run catalog:dry                                what would be sent, and nothing is
  SUPABASE_DB_PASSWORD=… npm run catalog             sync content/darshan.json
  … npm run catalog -- --file <path>                 a different manifest
  … npm run catalog -- --as <uuid>                   impersonate a named admin
  … npm run catalog -- --dry-run                     report, send nothing

  The catalogue is public.scene_catalog (0035). Until this runs it is empty, and an empty
  catalogue checks nothing - behaviour is exactly what it was before the migration.
`);
  process.exit(0);
}

const dryRun = has('--dry-run');
const manifestPath = path.resolve(ROOT, flag('--file') ?? DEFAULT_MANIFEST);
const asUid = flag('--as');

// ------------------------------------------------------------------ read the manifest
//
// Loudly, and refusing every unusable shape by name.
//
// The reasoning is the SQL's own and is repeated here rather than left to it (0035:206-209):
// handing `scene_catalog_sync()` an empty list is far more likely to be a broken build step than
// a deliberate emptying of the collection, and the consequence — every id becomes unrecognised
// and every તિક stops being paid — is too expensive to allow by accident. The function refuses
// an empty payload with SQLSTATE 23514; this refuses it a round trip earlier, with a sentence
// that names the file it could not read, because "check_violation" from a stored procedure is
// not a diagnosis.
function readManifest(file) {
  if (!fs.existsSync(file)) {
    fail(
      `no manifest at ${path.relative(ROOT, file)}.\n` +
        '  The catalogue is built from the same file the app ships. Run `npm run darshan` first.'
    );
  }

  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    fail(`could not read ${path.relative(ROOT, file)}: ${e.code || e.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    fail(`${path.relative(ROOT, file)} is not valid JSON: ${e.message}`);
  }

  if (!Array.isArray(parsed)) {
    fail(`${path.relative(ROOT, file)} is not an array of scenes - it is ${typeof parsed}.`);
  }

  if (parsed.length === 0) {
    fail(
      `${path.relative(ROOT, file)} holds no scenes.\n` +
        '  Refusing to sync an empty collection, for scene_catalog_sync()\'s own reason: an empty\n' +
        '  catalogue would make every id unrecognised and every tick stop being paid. An empty\n' +
        '  manifest is a broken build far more often than it is a deliberate emptying.'
    );
  }

  return parsed;
}

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

const entries = readManifest(manifestPath);

// ------------------------------------------------------------------ build the payload
//
// `withDisplayIndex()` and not a local counter: it sorts canonically, breaks ties on the id, and
// numbers only the entries a યુવક would be shown — the single derivation ORDERING.md §8 rule 1
// asks every screen and every script to use. Running it here means the number stored beside an
// id is the number the app prints beside the same id, and not a second opinion about it.
const sequenced = withDisplayIndex(entries);

const payload = [];
const seen = new Set();
const duplicates = [];
const unusable = [];

for (const entry of sequenced) {
  // `entry.id` is what content/darshan.json actually carries (build-darshan.mjs:186); the
  // fallback is `darshanId()` so a hand-written or older manifest carrying only the number is
  // still usable, and so the id is derived by the one function that derives ids anywhere.
  const n = entry.n ?? entry.index;
  const id = String(entry.id || (Number.isInteger(n) ? darshanId(n) : '')).trim();

  if (!id) {
    unusable.push(n ?? '(no number)');
    continue;
  }
  if (seen.has(id)) {
    duplicates.push(id);
    continue;
  }
  seen.add(id);

  // The key is omitted rather than sent as null when there is no number. `scene_catalog_sync()`
  // stores a `display_index` only for a JSON *number* (0035:234-236), so both spellings land the
  // same way — but omitting it says "unknown" at the payload rather than relying on a cast, and
  // the column is nullable precisely because an id is valid whether or not its number is known.
  payload.push(
    Number.isInteger(entry.displayIndex)
      ? { id, index: entry.displayIndex }
      : { id }
  );
}

if (payload.length === 0) {
  fail(
    `not one usable id in ${path.relative(ROOT, manifestPath)}.\n` +
      '  Every entry lacked both an `id` and a usable number, so there is nothing to catalogue.\n' +
      '  Sending this would be refused by scene_catalog_sync() anyway (SQLSTATE 23514).'
  );
}

const numbered = payload.filter((p) => p.index !== undefined).length;

// ------------------------------------------------------------------ report what will be sent
const list = (a, cap = 12) =>
  a.length ? a.slice(0, cap).join(', ') + (a.length > cap ? ` …+${a.length - cap}` : '') : 'none';

console.log(`manifest             : ${path.relative(ROOT, manifestPath)}  (${entries.length} entries)`);
console.log(`ids to send          : ${payload.length}`);
console.log(`  carrying a number  : ${numbered}`);
// Named rather than counted, because "no number" has exactly one cause worth acting on: the
// entry does not pass the manifest's own content gate — no image link, or no વર્ણન written yet —
// so `withDisplayIndex()` gave it none (shared/domain/darshan.js:279, :327). It is still
// catalogued, and it becomes numbered on the next sync after the gap is filled.
console.log(`  no number yet      : ${payload.length - numbered}  (no image or no caption in the manifest)`);
console.log(`first / last         : ${payload[0].id} … ${payload.at(-1).id}`);
if (duplicates.length) console.log(`⚠ duplicate ids skipped : ${list(duplicates)}`);
if (unusable.length) console.log(`⚠ entries with no id    : ${list(unusable)}`);

if (dryRun) {
  console.log(`\ndry run — nothing sent, and no connection was opened.`);
  console.log(`  the payload would be a JSON array like [{"id":"${payload[0].id}"${
    payload[0].index === undefined ? '' : `,"index":${payload[0].index}`
  }}, …]`);
  process.exit(0);
}

// ------------------------------------------------------------------ connect
//
// db.mjs's candidates and db.mjs's reporting, line for line: direct connection first, the pooler
// as the fallback for when IPv4 is not enabled. `DATABASE_URL` is honoured ahead of both so this
// can be pointed at a throwaway container (`scripts/lib/pgtest.mjs`) without a production
// password existing in the shell at all — the URL itself is never printed.
const password = process.env.SUPABASE_DB_PASSWORD;
const url = process.env.DATABASE_URL;

if (!password && !url) {
  fail(
    'SUPABASE_DB_PASSWORD is not set.\n' +
      '  Supabase → Settings → Database → Database password. Pass it in the environment.\n' +
      '  Nothing was sent. `npm run catalog:dry` needs no credential at all.'
  );
}

const CANDIDATES = url
  ? [{ label: 'DATABASE_URL', config: { connectionString: url, connectionTimeoutMillis: 12000 } }]
  : [
      { host: `db.${PROJECT_REF}.supabase.co`, user: 'postgres' },
      { host: 'aws-0-ap-south-1.pooler.supabase.com', user: `postgres.${PROJECT_REF}` },
      { host: 'aws-1-ap-south-1.pooler.supabase.com', user: `postgres.${PROJECT_REF}` },
    ].map((c) => ({
      label: c.host,
      config: {
        host: c.host,
        port: 5432,
        user: c.user,
        password,
        database: 'postgres',
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 12000,
      },
    }));

async function connect() {
  for (const c of CANDIDATES) {
    const client = new pg.Client(c.config);
    try {
      await client.connect();
      return client;
    } catch (e) {
      // The host and the code, never the credential — the same line db.mjs prints.
      console.error(`  ${c.label} → ${e.code || String(e.message).slice(0, 80)}`);
      try { await client.end(); } catch {}
    }
  }
  fail('could not reach the database from here. Nothing was sent.');
}

const client = await connect();

// A client whose server goes away mid-session emits 'error', and an EventEmitter with no
// listener throws asynchronously — burying whatever really went wrong. pgtest.mjs:143-156
// explains this at length; one no-op listener keeps the real message.
client.on('error', () => {});

// ------------------------------------------------------------------ who signs the change
//
// The candidates come from the database, and the database decides which of them may do this.
// `has_permission()` is asked once per candidate under that candidate's claims, so what is
// tested is exactly what `scene_catalog_sync()` will test a moment later.
const claimsFor = (uid) => JSON.stringify({ sub: uid, role: 'authenticated' });

async function mayUpdateDarshan(uid) {
  await client.query('begin');
  try {
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [claimsFor(uid)]);
    const res = await client.query(`select public.has_permission('darshan.update') as ok`);
    return res.rows[0]?.ok === true;
  } catch {
    return false;
  } finally {
    await client.query('rollback').catch(() => {});
  }
}

async function resolveActor() {
  if (asUid) {
    if (!/^[0-9a-f-]{36}$/i.test(asUid)) {
      fail(`--as expects a profile uuid, not ${JSON.stringify(asUid)}.`);
    }
    if (!(await mayUpdateDarshan(asUid))) {
      fail(
        `${asUid} does not hold darshan.update, so scene_catalog_sync() would refuse it (42501).\n` +
          '  Nothing was sent.'
      );
    }
    return { id: asUid, via: '--as' };
  }

  // ACTIVE administrators first, then the founding accounts — the same order effective_role()
  // resolves in (0004:119-140, reissued by 0024 to read bootstrap_admins). Ordered by role and
  // then by id so two runs on the same database choose the same person, which matters only for
  // the line this prints but costs nothing.
  const { rows } = await client.query(`
    select ap.id, ap.role::text as role, 'admin_profiles' as src
      from public.admin_profiles ap
     where ap.status = 'ACTIVE'
     union all
    select b.id, 'BOOTSTRAP' as role, 'bootstrap_admins' as src
      from public.bootstrap_admins b
     order by role, id
  `);

  for (const row of rows) {
    if (await mayUpdateDarshan(row.id)) return { id: row.id, via: row.src };
  }

  fail(
    'no account on this database holds darshan.update.\n' +
      `  ${rows.length} candidate(s) were tried (admin_profiles + bootstrap_admins) and every one\n` +
      '  was refused by has_permission(). Nothing was sent. Name one explicitly with --as <uuid>\n' +
      '  if the right account is somewhere else.'
  );
}

const actor = await resolveActor();
// The id and where it came from; never a name, a mobile or an email. This is a deployment log
// line, and 0024's whole argument is that the founding accounts are a target list.
console.log(`\nsigning as           : ${actor.id}  (${actor.via})`);

// ------------------------------------------------------------------ before, sync, after
//
// "How many were already there" is asked before the write and against this exact payload, so the
// summary can separate three genuinely different outcomes: ids that were already catalogued, ids
// this run adds, and ids the catalogue held that the manifest no longer names. The third is
// expected to be zero forever — ids are never removed from the manifest (ORDERING.md §1) — and
// is printed anyway, because the day it is not zero is the day somebody needs to know.
const ids = payload.map((p) => p.id);

const before = (await client.query(
  `select
     (select count(*) from public.scene_catalog)                                as total,
     (select count(*) from public.scene_catalog where id = any($1::text[]))     as present`,
  [ids]
)).rows[0];

const wasReady = Number(before.total) > 0;

// Can this connection speak as `authenticated`? On Supabase the `postgres` role is a member of
// it, and going through the same role the panel does exercises the grant on the function as well
// as the permission inside it. Where the role does not exist or is not grantable — a bare
// postgres:16 with no prelude — the call still runs as the owner, which reaches the same function
// body. Asked rather than assumed, because a failed SET ROLE aborts the transaction it is in.
//
// The membership test is scoped to the row rather than written as `exists(…) and pg_has_role(…)`:
// SQL does not promise to short-circuit `and`, and `pg_has_role()` raises rather than returning
// false when the role name does not exist.
const canAssume = (await client.query(
  `select coalesce((
     select pg_has_role(current_user, r.oid, 'member')
     from pg_roles r where r.rolname = 'authenticated'
   ), false) as ok`
)).rows[0].ok === true;

let stored;
await client.query('begin');
try {
  if (canAssume) await client.query('set local role authenticated');
  await client.query(`select set_config('request.jwt.claims', $1, true)`, [claimsFor(actor.id)]);

  // One call, one transaction. The function replaces the catalogue wholesale inside it — delete
  // and insert together — so there is no instant at which the catalogue is momentarily empty and
  // therefore no instant at which a concurrent નોંધાવો is checked against nothing (0035:199-209).
  const res = await client.query(`select public.scene_catalog_sync($1::jsonb) as n`, [
    JSON.stringify(payload),
  ]);
  stored = Number(res.rows[0].n);

  await client.query('commit');
} catch (e) {
  await client.query('rollback').catch(() => {});
  await client.end().catch(() => {});

  // The two refusals this function is built around, named in its own terms rather than left as
  // a SQLSTATE. Both mean nothing was written: the whole sync is one transaction.
  if (e.code === '23514') {
    fail(
      `the database refused the payload: ${e.message}\n` +
        '  Nothing was written and the catalogue is unchanged.'
    );
  }
  if (e.code === '42501') {
    fail(
      `${actor.id} does not hold darshan.update after all — scene_catalog_sync() refused it.\n` +
        '  Nothing was written and the catalogue is unchanged.'
    );
  }
  if (e.code === '42883') {
    fail(
      'public.scene_catalog_sync(jsonb) does not exist on this database.\n' +
        '  0035_level3_revisions.sql has not been applied here. Apply it first:\n' +
        '    SUPABASE_DB_PASSWORD=… node scripts/db.mjs apply 0035_level3_revisions.sql'
    );
  }
  fail(`the sync failed and was rolled back:\n  ${e.message}`);
}

const after = (await client.query(
  `select count(*) as total, max(synced_at) as at from public.scene_catalog`
)).rows[0];

const live = (await client.query(
  `select cardinality(public.live_scene_ids()) as n, public.scene_catalog_ready() as ready`
)).rows[0];

await client.end();

// ------------------------------------------------------------------ summary
const alreadyThere = Number(before.present);
const added = stored - alreadyThere;
const removed = Number(before.total) - alreadyThere;

console.log(`\nids sent             : ${payload.length}`);
console.log(`ids stored           : ${stored}   ← scene_catalog_sync()'s own count`);
console.log(`  already catalogued : ${alreadyThere}`);
console.log(`  new to the catalogue: ${added}`);
if (removed > 0) {
  console.log(`  dropped            : ${removed}  ← the manifest no longer names these ids`);
}
console.log(`catalogue now holds  : ${after.total}   (synced_at ${after.at?.toISOString?.() ?? after.at})`);
// The catalogue minus what the સંચાલક has withheld — the array `award_points()` actually filters
// against (0035:179-189). Printed because the difference between the two numbers is the only
// visible sign of how much of the collection is currently withheld.
console.log(`payable today        : ${live.n}   ← live_scene_ids(): the catalogue minus the withheld`);

if (!wasReady && live.ready === true) {
  console.log(
    '\n  The catalogue was empty before this run, so this is the moment id checking begins.\n' +
      '  From now on an id that is not in the list counts as nothing rather than as a tick.\n' +
      '  Re-run this after every `npm run darshan` that adds a scene.'
  );
} else {
  console.log('\n  Re-run this after every `npm run darshan` that adds a scene.');
}
