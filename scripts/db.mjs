/**
 * Apply SQL migrations to Supabase, or run a one-off query.
 *
 *   SUPABASE_DB_PASSWORD=... node scripts/db.mjs migrate
 *   SUPABASE_DB_PASSWORD=... node scripts/db.mjs query "select count(*) from public.profiles"
 *
 * SUPABASE_DB_PASSWORD is the Postgres password from Supabase → Settings → Database. It
 * is a real credential with full database access: pass it from the environment, never
 * write it into a file in this repository.
 *
 * Migrations run in filename order and are recorded in public.schema_migrations, so
 * re-running only applies what is new. Each file runs inside a transaction, so a file
 * that fails half way leaves nothing behind.
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIR = path.join(ROOT, 'supabase', 'migrations');
const PROJECT_REF = 'tjovudfsodviwijyyvdw';

const password = process.env.SUPABASE_DB_PASSWORD;
if (!password) {
  console.error(
    'SUPABASE_DB_PASSWORD is not set.\n' +
      'Supabase → Settings → Database → Database password. Pass it in the environment.'
  );
  process.exit(1);
}

/** Direct connection first; the pooler is the fallback when IPv4 is not enabled. */
const CANDIDATES = [
  { host: `db.${PROJECT_REF}.supabase.co`, user: 'postgres' },
  { host: 'aws-0-ap-south-1.pooler.supabase.com', user: `postgres.${PROJECT_REF}` },
  { host: 'aws-1-ap-south-1.pooler.supabase.com', user: `postgres.${PROJECT_REF}` },
];

async function connect() {
  for (const c of CANDIDATES) {
    const client = new pg.Client({
      host: c.host,
      port: 5432,
      user: c.user,
      password,
      database: 'postgres',
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 12000,
    });
    try {
      await client.connect();
      return client;
    } catch (e) {
      console.error(`  ${c.host} → ${e.code || String(e.message).slice(0, 80)}`);
      try { await client.end(); } catch {}
    }
  }
  console.error('\nCould not reach the database from here.');
  process.exit(1);
}

const client = await connect();
const [cmd, ...rest] = process.argv.slice(2);

if (cmd === 'query') {
  const res = await client.query(rest.join(' '));
  console.table(res.rows);
  await client.end();
  process.exit(0);
}

if (cmd !== 'migrate') {
  console.error('usage: node scripts/db.mjs migrate | query "<sql>"');
  await client.end();
  process.exit(1);
}

await client.query(`
  create table if not exists public.schema_migrations (
    name       text primary key,
    applied_at timestamptz not null default now()
  );
`);

const applied = new Set(
  (await client.query('select name from public.schema_migrations')).rows.map((r) => r.name)
);

const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
let ran = 0;

for (const file of files) {
  if (applied.has(file)) {
    console.log(`  = ${file}`);
    continue;
  }
  const sql = fs.readFileSync(path.join(DIR, file), 'utf8');
  try {
    await client.query('begin');
    await client.query(sql);
    await client.query('insert into public.schema_migrations (name) values ($1)', [file]);
    await client.query('commit');
    console.log(`  + ${file}`);
    ran++;
  } catch (e) {
    await client.query('rollback');
    console.error(`\n  ✗ ${file} failed and was rolled back:\n    ${e.message}`);
    await client.end();
    process.exit(1);
  }
}

console.log(`\n${ran} migration(s) applied, ${files.length - ran} already present.`);
await client.end();
