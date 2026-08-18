# વર્ણી ધ્યાન

Two applications, one repository, one Supabase project.

| | | |
| :--- | :--- | :--- |
| **યુવક app** | `/` | `src/` — દર્શન, the daily record, levels, points, the leaderboard |
| **સંચાલક પેનલ** | `/admin` | `admin/src/` — accounts, access, દર્શન import, settings |

They are built by **separate Vite configs and separate Rollup graphs**, so admin code can never
reach the bundle a યુવક downloads. `shared/` — pure domain functions and a Supabase client
factory — is the only thing both import. `scripts/verify-admin-separation.mjs` asserts it on
every CI run.

React 19 · Vite 8 (Rolldown) · react-router-dom 7 · Tailwind 4 · vite-plugin-pwa · Supabase.
**Node 22** (`@supabase/supabase-js` requires `>=22`).

---

## Local development

```bash
npm ci
cp .env.example .env.local     # fill in the two VITE_SUPABASE_* values
npm run dev:all                # યુવક on :5173, સંચાલક on :5174
```

`npm run dev` and `npm run dev:admin` run one app each. Mobile login needs the server-side
functions, which `scripts/lib/vite-netlify-functions.mjs` runs inside the dev server — so set
`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY` in `.env.local` too, or
that one login path answers 503 while email login keeps working.

```bash
npm test          # the domain and scoring suites (some need a local PostgreSQL)
npm run check     # everything: tests, both builds, and the browser verifiers
```

---

## This is not a static site

Five URLs are answered by a server, and three of them hold `SUPABASE_SECRET_KEY`, which
bypasses every Row Level Security policy on every table:

| URL | Function | What breaks without it |
| :-- | :------- | :--------------------- |
| `POST /api/login-mobile` | `netlify/functions/login-mobile.js` | Every mobile login. Email login keeps working, which makes it look like a password problem |
| `POST /api/create-admin` | `netlify/functions/create-admin.js` | Appointing a સંચાલક |
| `POST /api/purge-test-account` | `netlify/functions/purge-test-account.js` | Finishing a test-account purge |
| `POST /.netlify/functions/list-drive-folder` | `netlify/functions/list-drive-folder.js` | The bulk દર્શન importer |
| `GET /manifest.webmanifest` | `netlify/functions/manifest.js` | The app icon on every installed Android home screen — **fails silently** |

Any host for this project has to answer those five, or it is broken in ways that take weeks to
notice.

---

## Deployment

The repository can deploy to three places from the same source. **Netlify is production
today**; the Docker path is the migration target and does not remove either of the others.

| Target | Config | Server side |
| :--- | :--- | :--- |
| **Netlify** *(live)* | `netlify.toml`, `public/_headers` | `netlify/functions/` |
| **Vercel** | `vercel.json`, `middleware.js` | `api/` + `server/vercel-adapter.js` |
| **Docker / VPS** | `Dockerfile`, `compose.yaml` | `server/node-server.js` |

The functions themselves are written once and never ported. `server/vercel-adapter.js` and
`server/node-server.js` are adapters at the boundary — routing, a body read, a status/header/body
write — so there is only ever one copy of every rule.

### Docker: one image, two processes

```
internet ──▶ caddy :80 :443            TLS, auto-renewing certificate
                │
                ▼
   ┌────────────────────────────────────────────────────────┐
   │ app  (varni-dhyan)                                     │
   │   tini PID 1 → entrypoint.sh                           │
   │     ├── nginx 0.0.0.0:8080   dist/, SPA fallbacks,     │
   │     │                        caching, headers          │
   │     └── node  127.0.0.1:8888 netlify/functions/*       │
   └────────────────────────────────────────────────────────┘
                │  published on 127.0.0.1 only
                ▼
           Supabase (managed)
```

`entrypoint.sh` stops the container the moment **either** process exits, so a dead node half
never leaves a site up whose logins all fail. Both processes run as uid 1000; node binds
loopback, so the process holding the secret key is unreachable from outside the container.

### Test it locally

```bash
cp deploy/.env.production.example .env    # fill in; chmod 600 .env
docker compose up -d --build
./deploy/health-check.sh                  # 37 checks against http://127.0.0.1:8080
docker compose down
```

Then look at `/`, `/daily` (refresh it), `/admin/` and `/admin/users` (refresh that too), and
log in with **both** a mobile number and an email — only one of those goes through the server.

### Deploy to a VPS

```bash
# 1. server, once — Docker, a deploy user, ufw (22/80/443 only), log rotation
ssh root@YOUR_VPS_IP && bash vps-setup.sh
ssh-copy-id YOUR_SSH_USER@YOUR_VPS_IP
ssh root@YOUR_VPS_IP 'bash vps-setup.sh --harden-ssh'

# 2. code and configuration
ssh YOUR_SSH_USER@YOUR_VPS_IP
git clone YOUR_REPOSITORY_URL /opt/varni-dhyan && cd /opt/varni-dhyan
cp deploy/.env.production.example .env && chmod 600 .env && nano .env

# 3. DNS: A (and AAAA only if the box really has IPv6) for @ and www → YOUR_VPS_IP

# 4. first deploy  (--local builds on the server and needs ~2 GB RAM)
./deploy/deploy.sh --local

# 5. verify the public origin
./deploy/health-check.sh https://YOUR_DOMAIN
```

Caddy obtains and renews the certificate on its own. `www` redirects to the apex with a 308.

### Continuous deployment

`git push origin main` → GitHub Actions builds both apps, runs the same three checks `ci.yml`
runs, builds one image tagged with the commit SHA, pushes it to GHCR, then SSHes in and runs
`deploy.sh`. That script pulls while the old version is still serving, swaps, runs the 37 checks
and **puts the previous image back if any of them fail**, exiting non-zero.

Images are built in CI rather than on the server because a Vite build of both apps wants ~2 GB
and the server is also serving the site.

### Rollback

```bash
cd /opt/varni-dhyan
./deploy/rollback.sh --list        # every version that passed its health check
./deploy/rollback.sh               # back one
./deploy/rollback.sh sha-abc1234   # to a specific tag
```

Seconds, because nothing is rebuilt. It undoes the frontend only — Supabase is a managed service
this deployment does not touch.

### Environment variables

**`VITE_*` are build-time and therefore public.** Vite inlines them into JavaScript every
visitor downloads; they *are* the file. `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`
are public by design — Row Level Security is what protects the data, not key secrecy.

**`SUPABASE_SECRET_KEY` is the one real secret.** It bypasses every RLS policy. Never with a
`VITE_` prefix, never as a build argument, never in a GitHub secret, never committed. It reaches
the container from `.env` on the server and by no other route. A CI step fails the build if a
secret-shaped key ever reaches `dist/`.

### ⚠ Changing origin breaks every installed PWA

A PWA is bound to its origin. Everyone who installed from `varni-dhyan.netlify.app` stays
pointed there, **and nobody can uninstall it for them remotely.** Each person has to install
again from the new domain, and everyone logs in once more — the session lives in per-origin
`localStorage`. No data is lost; Supabase is the source of truth and every local key is a cache
or a preference with a fallback.

Two Supabase dashboard settings must be updated or password recovery breaks silently:
Authentication → URL Configuration → **Site URL** and **Redirect URLs**
(`https://YOUR_DOMAIN/reset-password`), keeping the Netlify entries while both sites are up.

**[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)** has all of this with the reasoning attached: the
migration plan for existing users, the security review, DNS and HTTPS, the cutover checklist,
and troubleshooting.

---

## Documentation

| | |
| :--- | :--- |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Docker, VPS, DNS, HTTPS, CI/CD, PWA migration, security |
| [`docs/ACCESS_CONTROL.md`](docs/ACCESS_CONTROL.md) | Roles, permissions, scopes |
| [`docs/RECOVERY_CONFIG.md`](docs/RECOVERY_CONFIG.md) | Password recovery, and the Supabase settings it depends on |
| [`docs/IMAGE_CONTRACT.md`](docs/IMAGE_CONTRACT.md) · [`docs/DARSHAN_DATA_CONTRACT.md`](docs/DARSHAN_DATA_CONTRACT.md) | દર્શન artwork and its data |
| [`docs/POINT_SYSTEM_ARCHITECTURE.md`](docs/POINT_SYSTEM_ARCHITECTURE.md) · [`docs/POINT_DATA_FLOW.md`](docs/POINT_DATA_FLOW.md) | Points |
| [`docs/DAILY_RECORD_ARCHITECTURE.md`](docs/DAILY_RECORD_ARCHITECTURE.md) | The daily record |
| [`docs/LEVEL3_REVISIONS.md`](docs/LEVEL3_REVISIONS.md) · [`docs/EXCEL_CONTRACT.md`](docs/EXCEL_CONTRACT.md) | Level 3 revisions, the spreadsheet format |
| [`docs/CLOUD_SETUP.md`](docs/CLOUD_SETUP.md) | Claude Code cloud sessions |
