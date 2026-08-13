# Claude Code cloud sessions

What to configure at [claude.ai/code](https://claude.ai/code) so a cloud session can build,
test and verify વર્ણી ધ્યાન, and why each piece is where it is.

A cloud session is a fresh Ubuntu 24.04 VM that clones this repository and runs Claude Code
inside it. It arrives with Node 20/21/22 (22 on `PATH`), Docker, PostgreSQL 16, git and the
usual utilities. It does **not** arrive with a browser, Gujarati fonts, `node_modules`, or
any knowledge of this project's Supabase instance. That gap is what the three files below
close.

## Two-minute setup

| # | Where | What |
| :- | :---- | :--- |
| 1 | claude.ai/code → environment → **Setup script** | paste all of [`scripts/cloud-setup.sh`](../scripts/cloud-setup.sh) |
| 2 | claude.ai/code → environment → **Environment variables** | paste the two `VITE_SUPABASE_*` lines from [`.env.cloud.example`](../.env.cloud.example), with real values |
| 3 | nothing to do | [`.claude/settings.json`](../.claude/settings.json) is committed, so the SessionStart hook is already wired |

Leave network access at **Trusted**. Every host the setup script reaches - `archive.ubuntu.com`,
`registry.npmjs.org`, `storage.googleapis.com`, `registry-1.docker.io` - is on the default
allowlist. At **None**, every install fails.

## The three pieces

### `scripts/cloud-setup.sh` - the setup script

Runs **once as root, before Claude Code launches**. Anthropic then snapshots the filesystem
and reuses it, so this cost is paid on the first session and no other. It re-runs only when
the script text changes, when the allowed hosts change, or when the snapshot expires after
about seven days.

It provisions three things, all of which survive in the snapshot:

- **Chrome**, via `@puppeteer/browsers` from `storage.googleapis.com`. `puppeteer-core`
  deliberately bundles no browser, so without this the five `verify:*` suites cannot run.
  The apt route is not used because `dl.google.com` is not on the allowlist.
- **Gujarati fonts** (`fonts-lohit-gujr`, `fonts-noto-core`). The product is entirely in
  Gujarati; on a bare Ubuntu image Chrome renders it as boxes, so `verify:mobile`,
  `verify:gallery` and `verify:nav` would be measuring the wrong layout.
- **The `postgres:16` image**, so `npm run test:rls` does not pull ~150 MB per session.

Two constraints govern the file, and both are the reason it looks defensive:

- **It must exit 0.** A non-zero exit means the session never starts. Every install is
  wrapped in `|| true` and reported instead. A missing Chrome costs you `npm run verify`; a
  hard failure costs you the whole session.
- **It must finish in about five minutes**, or the snapshot never builds and every session
  pays again. The Chrome download and the Docker pull therefore run concurrently.

The cloud does not read this file from the repository - you paste it. It lives here so the
next person can see what the environment contains and diff it against the field when the
two drift.

### `scripts/install_pkgs.sh` - the SessionStart hook

Runs **after Claude Code launches, on every session including resumed ones**. It is the
right home for anything that depends on the checkout rather than on the VM:

- `npm ci`, skipped when `node_modules` is already current, because this hook runs on every
  resume and `npm ci` rebuilds the tree from scratch each time it is called;
- `CHROME_PATH`, exported through `$CLAUDE_ENV_FILE`. The `verify:*` scripts read
  `process.env.CHROME_PATH` and fall back to a Windows path, which is correct on the
  machine this project is developed on and useless on Ubuntu;
- `.env.local`, written from the environment variables, and only when absent.

Its first line is `[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0`. That variable is
`true` only on a session VM, so running `claude` locally in this repository executes
nothing here and leaves your working tree alone.

### `.env.cloud.example` - the environment variables

Two values, both public by design:

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

They are required rather than optional: `src/lib/supabase.js` builds its client at module
scope and `shared/supabase/client.js` throws when either is missing, so a bundle built
without them crashes on load. `.github/workflows/ci.yml` sets the same pair for the same
reason.

**No secret belongs in that field.** A cloud environment has no secrets store - every value
is readable in plain text by anyone who can use the environment. `SUPABASE_SECRET_KEY`
bypasses every RLS policy, and `SUPABASE_DB_PASSWORD` is full database access. Both stay
where they are today: Netlify site settings, and your own shell. The reasoning, and the
full list, is in the comments of `.env.cloud.example`.

## What runs in a cloud session

| Command | Needs | Works in the cloud |
| :------ | :---- | :----------------- |
| `npm test` | nothing - 8 pure suites over `shared/domain/*` | yes, even unconfigured |
| `npm run test:rls` | Docker | yes |
| `npm run build` | the two `VITE_` values | yes, once step 2 is done |
| `npm run verify:separation` | a build | yes |
| `npm run verify`, `verify:mobile`, `verify:gallery`, `verify:nav`, `verify:admin` | Chrome + the two `VITE_` values | yes |
| `npm run check` | all of the above | yes |
| `npm run seed:admin` | `SUPABASE_SECRET_KEY` | no - run it locally |
| `node scripts/db.mjs` | `SUPABASE_DB_PASSWORD` | no - run it locally |

The two that do not run are the two that touch production data, which is the intended
outcome rather than a limitation to work around.

## When something is wrong

**`npm run build` fails on a missing Supabase value.** Step 2 was skipped, or the variables
were added after the session started - a running session keeps the values it started with.
Start a new session.

**A `verify:*` suite cannot find Chrome.** Read the environment build log for the
`[cloud-setup]` lines. If it says Chrome will not launch, a shared library is missing from
the `PKGS` list in `scripts/cloud-setup.sh`; the failing library name is in the three lines
printed after the warning.

**Gujarati renders as boxes in a screenshot.** `fonts-lohit-gujr` did not install. It is in
Ubuntu's universe component, so check that `apt-get update` succeeded.

**Setup script changes appear to do nothing.** Editing the script invalidates the snapshot,
but only for sessions started afterwards. Resuming an existing session never re-runs it.
