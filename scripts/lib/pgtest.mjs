/**
 * A real Postgres, with the real migrations, for the tests that cannot be honest without one.
 *
 * Everything in scripts/test-*.mjs so far tests a pure function over plain data, which is the
 * right shape for shared/domain/*. But roughly half of what this application promises is not
 * in those modules at all — it is in RLS policies, BEFORE triggers and SECURITY DEFINER
 * functions, and none of that can be reached from JavaScript. A suite that mocked the Supabase
 * client to test "a યુવક cannot read another યુવક's progress" would be asserting that the mock
 * returns what the test author typed into it, which is not a fact about this application.
 *
 * So: `docker run postgres:16`, apply supabase/test/prelude.sql (the Supabase surface the
 * migrations assume — see that file), apply every migration in the same filename order
 * scripts/db.mjs uses, and then speak SQL to it as an ordinary signed-in user.
 *
 * The container is disposable and is destroyed on the way out, including on failure. Nothing
 * here can touch a real project: there is no code path in this file that reads
 * SUPABASE_DB_PASSWORD, SUPABASE_URL or any other credential, and the connection is pinned to
 * 127.0.0.1 on a port of this file's choosing.
 */
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const run = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, '..', '..');
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations');
const PRELUDE = path.join(ROOT, 'supabase', 'test', 'prelude.sql');

const NAME = 'varni-rls-test';
// Overridable because 55433 is not always bindable. Windows reserves blocks of the dynamic
// range for Hyper-V (`netsh interface ipv4 show excludedportrange protocol=tcp`), and on a
// machine where 55431-55530 is excluded the container starts and the bind fails with
// EACCES — which reads as a permissions problem and is really a port that was spoken for.
// Any free port does; the default is unchanged so nothing that works today moves.
const PORT = Number(process.env.VARNI_PGTEST_PORT) || 55433;
const PASSWORD = 'varni-test-only';

/** Is there a docker to run this on at all? Reported, never guessed at. */
export function dockerAvailable() {
  try {
    execFileSync('docker', ['info'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Start the container, apply the prelude and every migration, and hand back a connected
 * client plus the way to tear it all down.
 *
 * Migrations are applied in `readdirSync(...).sort()` order — the same line scripts/db.mjs
 * uses — so a file that only applies because of where it sorts (0012_darshan_reorder.sql
 * before 0012_level4_repeat_access.sql, 0017_level4_repeat_restored.sql before
 * 0017_profiles_guard_status.sql) applies here in exactly the order it does in production.
 * Each file runs in its own transaction, so a failure names the file that failed.
 */
export async function startDatabase({ quiet = false } = {}) {
  const say = (m) => { if (!quiet) console.log(m); };

  // A container left behind by an interrupted run would otherwise hold the port and, worse,
  // serve a database with the previous run's rows in it.
  try { await run('docker', ['rm', '-f', NAME]); } catch { /* nothing to remove */ }

  say(`  starting postgres:16 (container ${NAME}, port ${PORT})…`);
  await run('docker', [
    'run', '-d', '--name', NAME,
    '-e', `POSTGRES_PASSWORD=${PASSWORD}`,
    '-e', 'POSTGRES_DB=postgres',
    '-p', `127.0.0.1:${PORT}:5432`,
    'postgres:16',
    // fsync off: this database exists for the length of one test run and is then destroyed.
    '-c', 'fsync=off', '-c', 'full_page_writes=off',
  ]);

  const stop = async () => {
    try { await run('docker', ['rm', '-f', NAME]); } catch { /* already gone */ }
  };

  try {
    // pg_isready inside the container, because the port being open is not the same thing as
    // the server accepting connections — postgres:16 starts, runs initdb, and restarts.
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try {
        await run('docker', ['exec', NAME, 'pg_isready', '-U', 'postgres', '-d', 'postgres']);
        ready = true;
        break;
      } catch {
        await sleep(500);
      }
    }
    if (!ready) throw new Error('postgres did not become ready within 30s');

    const newClient = () => new pg.Client({
      host: '127.0.0.1',
      port: PORT,
      user: 'postgres',
      password: PASSWORD,
      database: 'postgres',
      connectionTimeoutMillis: 10000,
    });

    /*
      The first connection can still be refused for a moment after pg_isready answers, so this
      retries — but it keeps the last error and reports it. An earlier version swallowed them
      all and raised a bare "could not connect", which is the least useful sentence available:
      a wrong password, a port already held by another container and a server still starting
      are three different problems with three different fixes.

      A fresh client per attempt, because node-postgres refuses to reconnect one that has
      already failed ("Client has already been connected").
    */
    let connected = null;
    let lastError = null;
    for (let i = 0; i < 25; i++) {
      const c = newClient();
      try {
        await c.connect();
        connected = c;
        break;
      } catch (e) {
        lastError = e;
        try { await c.end(); } catch { /* never opened */ }
        await sleep(400);
      }
    }
    if (!connected) {
      throw new Error(`could not connect to the test database: ${lastError?.message || lastError}`);
    }
    const client = connected;

    await client.query(fs.readFileSync(PRELUDE, 'utf8'));
    say('  prelude applied');

    const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      const sql = fs.readFileSync(path.join(MIGRATIONS, file), 'utf8');
      try {
        await client.query('begin');
        await client.query(sql);
        await client.query('commit');
      } catch (e) {
        await client.query('rollback').catch(() => {});
        throw new Error(`migration ${file} failed to apply:\n    ${e.message}`);
      }
    }
    say(`  ${files.length} migrations applied`);

    return { client, stop, files };
  } catch (e) {
    await stop();
    throw e;
  }
}

/**
 * Run `fn` as a signed-in યુવક, with RLS enforced.
 *
 * Two halves, and both are needed. `set local role authenticated` is what makes the policies
 * apply at all — RLS is skipped for the table owner, so a check run as `postgres` passes
 * whatever it was written to test. Setting `request.jwt.claims` is what auth.uid() reads (see
 * supabase/test/prelude.sql), and it is the only channel through which any policy in this
 * schema learns who the caller is.
 *
 * Everything happens inside a transaction that is always rolled back, so one test cannot leave
 * a row behind for the next one to trip over. Fixtures are created outside this helper, as the
 * owner.
 */
export async function asUser(client, uid, fn, { commit = false } = {}) {
  await client.query('begin');
  try {
    await client.query('set local role authenticated');
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: uid, role: 'authenticated' }),
    ]);
    const out = await fn();
    // `commit` is for the handful of checks that need a second connection to *see* the write —
    // the concurrency test for 0025's unique index, above all, where a rolled-back first
    // submit would leave nothing for the second one to collide with. Everything else rolls
    // back, so no test can leave a row behind for the next one to trip over.
    if (commit) await client.query('commit');
    return out;
  } finally {
    await client.query('rollback').catch(() => {});
    await client.query('reset role').catch(() => {});
  }
}

/** The same, for a visitor with no session at all: auth.uid() is NULL. */
export async function asAnon(client, fn) {
  await client.query('begin');
  try {
    await client.query('set local role anon');
    await client.query(`select set_config('request.jwt.claims', '', true)`);
    return await fn();
  } finally {
    await client.query('rollback').catch(() => {});
    await client.query('reset role').catch(() => {});
  }
}

/**
 * Did this statement fail, and with what?
 *
 * Returns `{ ok: false, message, code }` instead of throwing, because "this is refused" is the
 * expected outcome of most tests in the security matrix and a try/catch around every one of
 * them would bury what is being asserted. `code` is the SQLSTATE — '42501' is RLS or a missing
 * grant, 'P0001' is a `raise exception` in a trigger, and telling them apart matters: they are
 * different defences and a test that accepts either would pass when one of them disappeared.
 */
export async function attempt(client, sql, params = []) {
  try {
    const res = await client.query(sql, params);
    return { ok: true, rows: res.rows, count: res.rowCount };
  } catch (e) {
    return { ok: false, message: String(e.message || e), code: e.code };
  }
}
