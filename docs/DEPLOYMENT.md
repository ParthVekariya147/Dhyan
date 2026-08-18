# Deploying વર્ણી ધ્યાન on your own server

Moving production off Netlify and onto a VPS, in Docker, behind your own domain.

Everything here is written against what this repository actually contains. Where a rule exists
because of a specific line in `netlify.toml`, `public/_headers` or `vite.config.js`, that line
is named, so you can check the translation rather than trust it.

---

## Contents

1. [What this project actually is](#1-what-this-project-actually-is)
2. [The architecture](#2-the-architecture)
3. [The files](#3-the-files)
4. [Environment variables](#4-environment-variables)
5. [Test it locally first](#5-test-it-locally-first)
6. [Setting up the VPS](#6-setting-up-the-vps)
7. [DNS](#7-dns)
8. [HTTPS](#8-https)
9. [The first deploy](#9-the-first-deploy)
10. [Continuous deployment](#10-continuous-deployment)
11. [Rollback, and downtime honestly](#11-rollback-and-downtime-honestly)
12. [The PWA: what happens to the 100+ people who already installed it](#12-the-pwa-what-happens-to-the-100-people-who-already-installed-it)
13. [Supabase: the two dashboard settings that will break if you forget them](#13-supabase-the-two-dashboard-settings-that-will-break-if-you-forget-them)
14. [The backend](#14-the-backend)
15. [Security review](#15-security-review)
16. [Performance](#16-performance)
17. [Cutover checklist](#17-cutover-checklist)
18. [Why there are two proxies, and when to drop one](#18-why-there-are-two-proxies-and-when-to-drop-one)
19. [What you need to supply later](#19-what-you-need-to-supply-later)
20. [Troubleshooting](#20-troubleshooting)

> **Nothing in this repository contains a real domain, IP address, SSH user or secret.** Every
> such value is a placeholder — `YOUR_DOMAIN_HERE`, `YOUR_VPS_IP`, `YOUR_SSH_USER`,
> `YOUR_GITHUB_OWNER` — and §19 lists exactly what has to be filled in when you have them. No
> application source change will be needed at that point.

---

## 1. What this project actually is

**It is not a static site, and treating it as one is the mistake that would take production
down quietly.**

The બંને apps — the યુવક app at `/` and the સંચાલક પેનલ at `/admin` — are static Vite builds.
But five URLs are answered by a server, and three of them hold `SUPABASE_SECRET_KEY`, which
bypasses every Row Level Security policy on every table:

| URL | Function | What breaks without it |
| :-- | :------- | :--------------------- |
| `POST /api/login-mobile` | `netlify/functions/login-mobile.js` | Every mobile-number login in the સંઘ. Email login keeps working, which is what makes the failure look like a password problem. |
| `POST /api/create-admin` | `netlify/functions/create-admin.js` | Appointing a સંચાલક. |
| `POST /api/purge-test-account` | `netlify/functions/purge-test-account.js` | Finishing a test-account purge — the data goes, the login stays. |
| `POST /.netlify/functions/list-drive-folder` | `netlify/functions/list-drive-folder.js` | The bulk દર્શન importer. Note the literal path: `admin/src/features/darshan/services/importService.js` calls it with no `/api/…` alias, deliberately. |
| `GET /manifest.webmanifest` | `netlify/functions/manifest.js` | The app icon on every installed Android home screen. This one fails **silently** — see §12. |

So this deployment ships ONE image running TWO processes — nginx serving the built apps, and
node serving those five paths on loopback beside it. The functions run **unchanged**:
`server/node-server.js` is a third adapter alongside `server/vercel-adapter.js`, not a second
copy of the rules — routing, a body read and a status/header/body write, and nothing else.

§18 sets out what one container costs against two, and what is done about each cost.

### The audit, in one table

| | |
| :-- | :-- |
| **Build command** | `npm run build` = `vite build && vite build --config admin/vite.config.js`, in that order (the યુવક build empties `dist/`, and its service worker precaches by globbing `dist/`) |
| **Build output** | `dist/` — the યુવક app at the root, the panel at `dist/admin/` |
| **Node version** | 22. `@supabase/supabase-js` requires `>=22.0.0`, Vite `^20.19 \|\| >=22.12`; `.github/workflows/ci.yml` pins 22 |
| **Package manager** | npm, `package-lock.json` v3 — `npm ci`, never `npm install` |
| **React / Vite** | React 19.2.8, react-router-dom 7.18.2, Vite 8.2.1 (Rolldown), Tailwind 4.3.3, vite-plugin-pwa 1.3.0 |
| **Build-time env** | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (both public by design), optional `VITE_SITE_URL` |
| **Run-time env** | `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` — read by the node half only, never by the browser |
| **API base URL** | None. Every call is same-origin and relative; nothing in `src/` or `admin/src/` hardcodes a host. The only appearances of `varni-dhyan.netlify.app` in the repository are in comments, docs and one test fixture |
| **Auth** | Supabase Auth. Session in `localStorage` under `varni.auth`, `persistSession: true`, `autoRefreshToken: true` (`shared/supabase/client.js`). Mobile login goes through the function; email login goes browser → Supabase directly |
| **Routing** | `BrowserRouter` for both apps — the panel with `basename="/admin"`. Needs an SPA fallback per app |
| **PWA** | `vite-plugin-pwa`, `registerType: 'autoUpdate'`, worker at `/sw.js` claiming scope `/`, `navigateFallbackDenylist` excluding `/admin` and `/api`. Images are deliberately **not** precached; `/darshan/` is CacheFirst at runtime |
| **Server-side code** | The five functions above. No SSR, no database in the container, no sessions on the server |
| **Existing hosts** | Netlify (`netlify.toml`, `public/_headers`, `netlify/functions/`) and Vercel (`vercel.json`, `api/`, `middleware.js`, `server/vercel-adapter.js`). **Nothing in this deployment removes either** |

### One thing the audit turned up that you should know

`https://varni-dhyan.netlify.app/.netlify/functions/manifest` currently returns the યુવક app
shell, not a manifest — meaning **the live Netlify deployment predates the manifest function**
(committed in `91c20ba`, 15 Aug). The site live today serves the static
`dist/manifest.webmanifest`, so the સંચાલક's icon setting does not reach installed phones on
Netlify right now.

**This is not hypothetical.** With the function wired up locally against the live Supabase
project, `/manifest.webmanifest` returns:

```
"icons":[{"src":"https://<project-ref>.supabase.co/storage/v1/object/public/app-icon/icon-msugsxa2-d7zrqq.png?v=1", …
```

— a custom icon somebody has already chosen in the panel. `https://varni-dhyan.netlify.app/manifest.webmanifest`
returns `/icon-192.png`, the built-in mark. **The icon that was set is reaching nobody today.**

This deployment serves the function, which is what `netlify.toml` has been configured to do
since that commit. That is a difference from what is live today, in the direction of the
repository's stated intent, and it fixes the above. `deploy/health-check.sh` asserts it. If you
want byte-for-byte parity with the current live site instead, delete the
`location = /manifest.webmanifest` block from `deploy/nginx.conf` — and read §12 first, because
that block is the entire delivery mechanism for a new app icon.

---

## 2. The architecture

```
GitHub  ──push──▶  Actions: build both apps, verify, build ONE image, push to GHCR
                        │
                        │ ssh
                        ▼
                   VPS: deploy.sh  ──pull──▶ GHCR
                        │
                        ▼
   internet ──▶ caddy  :80 :443 :443/udp     ← the only public port
                        │  TLS, HTTP/2, HTTP/3, auto-renewing certificate
                        ▼
 ┌───────────────────────────────────────────────────────────────────────┐
 │  app   (one container, one image: varni-dhyan)                        │
 │                                                                       │
 │    tini  PID 1 — signals, zombie reaping                              │
 │      └── entrypoint.sh — stops the container if EITHER child exits    │
 │            ├── nginx  0.0.0.0:8080   dist/, both SPA fallbacks,       │
 │            │                         caching, security headers        │
 │            │                              │ proxies 5 paths           │
 │            │                              ▼                           │
 │            └── node   127.0.0.1:8888  netlify/functions/*             │
 │                       ↑ loopback only — holds SUPABASE_SECRET_KEY     │
 └───────────────────────────────────────────────────────────────────────┘
                        │  8080 published on 127.0.0.1 only
                        ▼
                   Supabase (managed, unchanged)
```

Both processes run as uid 1000 (`node`). Verified in the running container:

```
PID  USER   COMMAND
  1  node   /sbin/tini -- /usr/local/bin/entrypoint.sh
  7  node   bash /usr/local/bin/entrypoint.sh
  9  node   node /app/server/node-server.js      → tcp 127.0.0.1:8888
 10  node   nginx: master process nginx -g daemon off;  → tcp 0.0.0.0:8080
```

Users' દર્શન artwork continues to come straight from `lh3.googleusercontent.com` and never
touches this server — `docs/IMAGE_CONTRACT.md` is the contract, and nothing here changes it.

---

## 3. The files

**Created:**

| File | What it is |
| :--- | :--------- |
| `Dockerfile` | Two stages: `builder` (npm ci + `npm run build`) and `app` (nginx + node in one runtime image) |
| `.dockerignore` | Keeps `node_modules`, `dist/`, `.git` and **every `.env`** out of the build context |
| `deploy/nginx.conf` | The server block. Every rule cites the `netlify.toml` or `public/_headers` line it preserves |
| `deploy/api-proxy.inc` | What the three proxied locations share, written once |
| `deploy/nginx-main.conf` | Replaces /etc/nginx/nginx.conf so the whole server runs non-root |
| `deploy/entrypoint.sh` | Starts both processes; stops the container the moment either one exits |
| `server/node-server.js` | Runs `netlify/functions/*` unchanged. The third adapter, after Netlify's runtime and `server/vercel-adapter.js` |
| `compose.yaml` | The one `app` service. Complete on its own for a local test |
| `compose.production.yaml` | Adds the Caddy TLS edge |
| `deploy/Caddyfile` | Nine lines: certificate, HSTS, www → apex, reverse proxy |
| `deploy/deploy.sh` | Pull → swap → health check → roll back if it fails |
| `deploy/rollback.sh` | Go back to a version that passed its health check |
| `deploy/health-check.sh` | 25 assertions about the live site. The deploy gate |
| `deploy/vps-setup.sh` | A fresh Ubuntu box, ready to deploy to |
| `deploy/.env.production.example` | The template for `.env` |
| `.github/workflows/deploy.yml` | Verify → build → push → deploy → check |
| `.gitattributes` | `eol=lf` for the files that run on Linux |
| `docs/DEPLOYMENT.md` | This file |

**Modified:** none.

**Deliberately untouched** — and this is the point of the exercise:

`src/`, `admin/src/`, `shared/`, `netlify/functions/`, `api/`, `server/vercel-adapter.js`,
`middleware.js`, `vite.config.js`, `admin/vite.config.js`, `index.html`, `public/`,
`package.json`, `package-lock.json`, `netlify.toml`, `vercel.json`, `supabase/`, `scripts/`,
`.github/workflows/ci.yml`.

No component, no route, no style, no query, no function body, no build setting. The Netlify and
Vercel configurations still work; you can deploy to all three from this repository.

---

## 4. Environment variables

Copy `deploy/.env.production.example` to `.env` **beside `compose.yaml`** and fill it in.
`chmod 600 .env`. It is already covered by `.gitignore` and `.dockerignore`.

### The distinction that matters more than anything else here

**`VITE_*` variables are build-time and therefore public.** Vite substitutes them into the
JavaScript every visitor downloads. They are not "sent to the server" — they *are* the file, and
anyone can read them with View Source. **A secret with a `VITE_` prefix is a published secret**,
and the only fix is to rotate the credential.

One claim that is often made and is **not** true of this Dockerfile: that a build argument is
also readable in the image history. The `ARG`/`ENV` live only in the discarded `builder` stage,
and `docker image history varni-dhyan:local` on the finished image lists no build argument
at all — verified. The values are public because Vite inlined them into the JavaScript, not
because of image metadata.

| Variable | Where it is used | Secret? |
| :------- | :--------------- | :------ |
| `VITE_SUPABASE_URL` | build arg → the bundle | No. Public by design |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | build arg → the bundle | No. Public by design — RLS is what protects the data, not key secrecy (`.env.example` says so at length) |
| `VITE_SITE_URL` | build arg → the bundle | No. Optional; usually best unset |
| `SUPABASE_URL` | the node half | No |
| `SUPABASE_PUBLISHABLE_KEY` | the node half | No |
| **`SUPABASE_SECRET_KEY`** | **the node half only** | **YES. Bypasses every RLS policy: full read/write on ~2,000 યુવકોની data, and create/delete of auth users** |
| `DOMAIN`, `ACME_EMAIL` | Caddy | No |
| `IMAGE_REPO`, `GHCR_USER`, `GHCR_TOKEN` | `deploy.sh` | The token is. Read-only, `read:packages` scope |

`SUPABASE_SECRET_KEY` must never appear as a `VITE_` variable, a build argument, a GitHub
Actions secret, or in any file that is committed. It reaches the container from `.env` on the
server, and by no other route.

### GitHub Actions

Secrets: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `DEPLOY_HOST`, `DEPLOY_USER`,
`DEPLOY_SSH_KEY`, optionally `DEPLOY_PORT`.
Variables: `DOMAIN`, optionally `VITE_SITE_URL`.

`SUPABASE_SECRET_KEY` is not in that list and must not be added. `.github/workflows/ci.yml`
already makes the same argument: nothing CI runs should be able to read production data.

---

## 5. Test it locally first

Do this before touching a server. It is the same image the VPS will run.

> Already done once, on Windows with Docker 29.7.2, against the live Supabase project: both
> the image builds, the container comes up healthy with both processes non-root, and all 37 checks in
> `deploy/health-check.sh` pass. A bogus mobile login returned the function's real
> `401 મોબાઈલ નંબર કે પાસવર્ડ બરાબર નથી.`, which is a complete round trip through nginx → the
> `api` container → Supabase and back. Run it yourself anyway on the machine you will deploy
> from — that is what the paragraph below is for.

```bash
cp deploy/.env.production.example .env
# fill in the five Supabase values; DOMAIN and ACME_EMAIL can stay as placeholders

docker compose up -d --build
./deploy/health-check.sh          # defaults to http://127.0.0.1:8080
```

Note there is no `-f compose.production.yaml`: without the overlay there is no Caddy, no TLS and
no certificate request, which is exactly what you want on a laptop.

Then check the things a script cannot:

```
http://127.0.0.1:8080/                       the યુવક app loads
http://127.0.0.1:8080/daily                  refresh on a nested route — must not 404
http://127.0.0.1:8080/admin/                 the panel loads, not the yuvak app
http://127.0.0.1:8080/admin/users            refresh here too
```

- **log in**, with a mobile number *and* with an email — the first goes through the function,
  the second does not, and only testing one hides half the system
- open DevTools → Application → Service Workers: `/sw.js` registered, scope `/`
- Application → Manifest: name, icons, `start_url: /`
- reload twice and watch the Network tab: `/assets/*` should come from disk cache

Stop with `docker compose down`.

Raw commands, if you want them without compose:

```bash
docker build -t varni-dhyan:test \
  --build-arg VITE_SUPABASE_URL="https://xxx.supabase.co" \
  --build-arg VITE_SUPABASE_PUBLISHABLE_KEY="sb_publishable_..." .

docker run -d --name varni-test -p 127.0.0.1:8080:8080 \
  -e SUPABASE_URL=... -e SUPABASE_PUBLISHABLE_KEY=... -e SUPABASE_SECRET_KEY=... \
  varni-dhyan:test

./deploy/health-check.sh http://127.0.0.1:8080
docker rm -f varni-test
```

No network to create and no second container to name — nginx reaches the function server at
`127.0.0.1:8888` inside the same container.

Useful things to look at while it runs:

```bash
docker exec varni-test ps -o pid,user,args     # tini, entrypoint, node, nginx — all as `node`
docker logs varni-test | head -3               # the entrypoint's line, then node's
```

---

## 6. Setting up the VPS

**Specification.** 2 vCPU / 2 GB RAM / 20 GB SSD is comfortable and is what to buy. The
containers themselves need very little — nginx serving static files plus a Node process with no
dependency tree is well under 200 MB resident — so the 2 GB is headroom for the OS, Docker, and
an image pull happening while the site is serving. 1 GB works if you **never** run
`deploy.sh --local`; a Vite build of both apps needs around 2 GB and the OOM killer arrives
mid-deploy. Bandwidth is small: દર્શન artwork comes from Google's CDN, not from you.

Ubuntu 24.04 LTS.

```bash
ssh root@YOUR_VPS_IP
curl -fsSLO https://raw.githubusercontent.com/YOUR_GITHUB_OWNER/YOUR_REPO/main/deploy/vps-setup.sh
# or just scp it up — read it before running it
bash vps-setup.sh
```

It installs Docker from Docker's own apt repository (Ubuntu's `docker.io` has no compose V2
plugin, and every command here is `docker compose`, not `docker-compose`), creates a `deploy`
user, opens 22/80/443 in ufw and nothing else, sets daemon-wide log rotation, schedules a weekly
prune that keeps a week of images so rollback still works, and enables unattended security
upgrades and fail2ban.

Then, on your own machine:

```bash
ssh-copy-id YOUR_SSH_USER@YOUR_VPS_IP
ssh root@YOUR_VPS_IP 'bash vps-setup.sh --harden-ssh'   # refuses if you have no key installed
```

**Two things about that box you should hold in mind.**

`ufw does not filter published Docker ports.` Docker writes DNAT rules into the nat table, ahead
of the INPUT chain ufw builds, so a container published on `0.0.0.0` is reachable from the
internet with `ufw status` still reporting the port closed. The only reason that is not a
problem here is that `compose.yaml` binds `127.0.0.1:8080`. Keep it that way.

`Membership of the docker group is equivalent to root.` Anyone in it can `docker run -v /:/host`
and read any file on the machine. The `deploy` user is in it, so **`DEPLOY_SSH_KEY` in GitHub
Actions is a root credential for this server.** Give it access to nothing else and rotate it the
same hour if it is ever exposed.

Then put the deployment in place:

```bash
ssh YOUR_SSH_USER@YOUR_VPS_IP
git clone YOUR_REPOSITORY_URL /opt/varni-dhyan
cd /opt/varni-dhyan
cp deploy/.env.production.example .env
chmod 600 .env
nano .env
```

---

## 7. DNS

At your registrar, for `YOUR_DOMAIN`:

| Type | Name | Value | TTL |
| :--- | :--- | :---- | :-- |
| `A` | `@` | your server's IPv4 | 300 while migrating, 3600 after |
| `AAAA` | `@` | your server's IPv6, **if it has one** | same |
| `A` | `www` | the same IPv4 | same |
| `AAAA` | `www` | the same IPv6, if any | same |

Only add `AAAA` if the server really has a working IPv6 address and Docker is publishing on it.
A record pointing at an address nothing answers on gives IPv6-capable phones — which is most of
them — a connection that hangs before falling back. `curl -6 https://YOUR_DOMAIN` from elsewhere
is the check.

`www` must exist for the `www.{$DOMAIN}` block in `deploy/Caddyfile` to obtain a certificate. If
you do not want a `www` name at all, delete that block, otherwise Caddy retries an issuance that
cannot succeed.

**Set the short TTL a day before you cut over**, not on the day. TTL changes are themselves
subject to the old TTL.

No IP address is written into the application anywhere, and none should be. The apps make only
same-origin relative calls.

---

## 8. HTTPS

Nothing to do. Caddy obtains a certificate from Let's Encrypt on first start, redirects
`http://` to `https://` with a 308, serves HTTP/2 and HTTP/3, and renews at about a third of the
certificate's remaining life for as long as the container runs.

This is why the edge is Caddy and not nginx + certbot, given there is already an nginx in the
stack. Renewal has to stay automatic, unattended, for years, on a machine nobody logs into
between deploys. certbot is three moving parts — a timer, a renewal hook, an nginx reload — and
when one stops the failure is silent until the certificate expires and everyone in the સંઘ loses
the app on the same morning.

**Canonical form: the apex, without `www`.** `www.YOUR_DOMAIN` 308-redirects to `YOUR_DOMAIN`.
A 308 rather than a 301 because 308 forbids a client from turning a POST into a GET, and the app
POSTs to `/api/login-mobile`.

That choice binds every installed phone: a PWA is bound to its origin, `start_url` and `scope`
resolve against the manifest's URL, a service worker may control no wider a path than the origin
it was served from, and the Supabase session in `localStorage` is keyed by origin.
`https://YOUR_DOMAIN` and `https://www.YOUR_DOMAIN` are two different applications that happen to
show the same pixels. **Changing this later means everybody reinstalls.**

Verify:

```bash
curl -I http://YOUR_DOMAIN          # 308 → https://YOUR_DOMAIN
curl -I https://www.YOUR_DOMAIN     # 308 → https://YOUR_DOMAIN
./deploy/health-check.sh https://YOUR_DOMAIN
```

### If you would rather use nginx and certbot

Nothing in the application depends on the edge. Set `EDGE=off` in `.env`, run
`docker compose -f compose.yaml up -d`, and point a host nginx at `http://127.0.0.1:8080` with
`proxy_set_header X-Forwarded-Proto https;`. Then `certbot --nginx -d YOUR_DOMAIN -d
www.YOUR_DOMAIN`, and check `systemctl list-timers | grep certbot` actually shows a timer. The
things you must not lose are the HTTP→HTTPS redirect, `X-Forwarded-Proto`, and a renewal that
reloads nginx.

---

## 9. The first deploy

```bash
cd /opt/varni-dhyan
./deploy/deploy.sh --local
```

`--local` builds on the server, which is the one time that is the right choice: there is no
image in the registry yet. It needs about 2 GB of RAM — if the box has 1 GB, push a tag from CI
first (§10) and use `./deploy/deploy.sh sha-abc1234` instead.

Then:

```bash
./deploy/health-check.sh https://YOUR_DOMAIN
```

and by hand, on a real phone:

- the app loads, log in with a **mobile number** (the function path) and with an **email**
- refresh on `/daily` and on `/level/4/<something>` — no 404
- `/admin/` opens the panel; refresh on `/admin/users`
- install to the home screen; open the installed app; check the icon
- Chrome DevTools → Application → Service Workers, and Manifest

---

## 10. Continuous deployment

`git push origin main` →

```
verify   npm ci → npm run build → verify:separation → the VITE_PUBLIC_DARSHAN guard
   ↓     (all three are what .github/workflows/ci.yml already runs; nothing new is demanded)
build    docker build  →  ghcr.io/YOUR_GITHUB_OWNER/YOUR_REPO:sha-abc1234   (one image)
   ↓
deploy   ssh deploy@vps 'cd /opt/varni-dhyan && ./deploy/deploy.sh sha-abc1234'
            ├─ record the images that are live now
            ├─ pull the new ones (old ones still serving)
            ├─ swap
            ├─ deploy/health-check.sh against 127.0.0.1:8080
            └─ FAIL → put the old images back, exit non-zero
   ↓
check    the public origin, through DNS and TLS
```

Set `IMAGE_REPO=ghcr.io/YOUR_GITHUB_OWNER/YOUR_REPO` in the server's `.env`. If the GHCR packages are private,
also set `GHCR_USER` and a fine-grained `GHCR_TOKEN` with `read:packages` and nothing else.

**Why the registry rather than "ssh in and build there":** memory (a Vite build wants 2 GB on a
box that is also serving the site, so the OOM killer arrives during a deploy); the artefact that
was verified is the artefact that ships; rollback is a pull rather than a rebuild; and the server
needs no source, no npm access and no build-time secrets.

**Images are tagged with the commit SHA and there is no `latest`.** A mutable tag makes "which
version is live?" unanswerable and rollback a guess.

`npm test` is not in the deploy path. The suite in `package.json` includes scripts that need a
live PostgreSQL (`test-app-shell-db`, `test-rbac-dynamic`, `test-scope`); `ci.yml` does not run
it either. Run it locally before a release. Wiring a database into the deploy path would let a
fixture problem block a frontend deploy, which is the wrong coupling to add while changing hosts.

---

## 11. Rollback, and downtime honestly

```bash
cd /opt/varni-dhyan
./deploy/rollback.sh --list        # every version that passed its health check
./deploy/rollback.sh               # back one
./deploy/rollback.sh sha-abc1234   # to a specific one
```

Seconds, because nothing is rebuilt — the previous image is still on the disk and this points
compose back at it. That is what the per-SHA tags and the week-long prune window are for.

`deploy.sh` already rolls back on its own when a new version fails the health check.
`rollback.sh` is for the other case: a version that *passed* and is nonetheless wrong.

**It undoes the frontend and nothing else.** Supabase is a managed service this deployment does
not touch — a migration applied with `scripts/db.mjs`, a settings row a સંચાલક changed, an
account that was created. If a bad deploy also wrote to the database, a rollback puts old code
in front of new data.

### Downtime, honestly

This is **not** blue/green, and calling it that would be a lie. There is one `app` container, and
replacing it means a window of a second or two with nothing listening.

Three things shrink that window to something nobody notices:

1. `deploy.sh` **pulls before it swaps**, so the download is not part of the outage.
2. `docker compose up -d --wait` starts the new container and waits for its health check.
3. `deploy/Caddyfile` sets `lb_try_duration 10s` and `lb_try_interval 250ms`, so a request that
   arrives during the swap is **retried** rather than answered with a 502. It waits, then
   succeeds.

What is still lost: a request already in flight when the container stops. In practice that is
sub-second and, on a mostly-idle app used a few times a day per person, usually nothing at all.
If you need a real zero, run two `app` replicas behind Caddy and recreate them one at a time —
the container is stateless, so nothing else has to change.

---

## 12. The PWA: what happens to the 100+ people who already installed it

**Read this section before you cut over. It is the part that cannot be undone.**

### The short answer

The origin changes from `https://varni-dhyan.netlify.app` to `https://YOUR_DOMAIN`. **A PWA is
bound to its origin.** Everyone who has installed the app has installed *the Netlify one*, and
it stays pointed at Netlify. There is no manifest field, no header, no service-worker trick and
no server-side action that moves an installed app to a new origin.

**You cannot uninstall it for them, and you cannot delete it remotely.** Nobody can. Every person
who installed the old app has to remove it from their home screen and add the new one. That is
an act only the person holding the phone can perform — `src/components/ReinstallNotice.jsx`
already makes exactly this argument about iOS icons, and it applies with more force here.

### What specifically changes for each person

| | |
| :-- | :-- |
| **The installed app** | Keeps working, still pointing at `varni-dhyan.netlify.app`, for as long as that site exists. It does not follow you. |
| **The Supabase session** | `localStorage` is per-origin, and the session lives under `varni.auth` (`shared/supabase/client.js`). **Everyone logs in again once** on the new domain. |
| **Preferences** | Also per-origin: viewing speed, ધૂન preference, the navigation cache, the "seen this icon" marker, cached progress. All of it re-derives — every reader in `src/lib/` falls back to the સંચાલક's default when its key is absent, deliberately. **No data is lost**: the record of record is Supabase, and none of these keys is a source of truth. |
| **Cached દર્શન images** | The `darshan-images` runtime cache is per-origin, so first દર્શન on the new domain re-fetches from Google's CDN. Bandwidth, not data. |
| **The service worker** | A new one registers at the new origin, from scratch. The old one keeps running on the old origin until that site is gone. |

### Could the origin have been preserved?

**Yes — if the app had been installed from a custom domain in the first place.** Origin is
scheme + host + port. If everyone had installed from `https://dhyan.YOUR_DOMAIN` while it pointed
at Netlify, moving that domain's DNS to your VPS would preserve the origin exactly, every install
would keep working, nobody would log in again, and this section would not exist.

They installed from `varni-dhyan.netlify.app`, which is Netlify's hostname and cannot be pointed
elsewhere. So the reinstall is unavoidable this time.

**The lesson worth acting on today:** once you are on your own domain, you never pay this cost
again. Any future host move is a DNS change.

### The migration that actually works

**Do not** simply switch off the Netlify site, and **do not** put a bare 301 on it either. Here
is why the obvious move fails: the old service worker precached `index.html` with a revision, so
an installed app serves that cached shell from the cache and will not see a redirect you add on
the server. It only picks up a change after the worker updates — which happens on load, because
`registerType: 'autoUpdate'`.

So the sequence is:

1. **Stand up the new domain and verify it completely.** §17 is the checklist. Do not announce
   anything yet. Both sites run in parallel — they share one Supabase project, so a person
   using either sees the same data. There is no split-brain to manage.

2. **Deploy a farewell build to Netlify.** This is the step that reaches installed phones: a new
   build means a new precache manifest, the worker updates on next open, and the new shell is
   what people see. In it:
   - a notice with the new address and the three steps ("remove the app, open the new address,
     Add to Home Screen") — `src/components/ReinstallNotice.jsx` already contains almost
     exactly this copy in Gujarati and is a good model;
   - `navigator.serviceWorker.getRegistrations()` → `unregister()`, and `caches.keys()` →
     `caches.delete()`, so the old worker stops holding a stale copy;
   - keep it a page people can read, not an instant redirect. Someone opening the installed app
     needs to understand what happened.

3. **Tell people, through the channel the સંઘ actually uses.** A notice inside an app is seen by
   whoever opens the app. The people you most need to reach are the ones who open it least.

4. **Leave the Netlify site up for a few months.** It costs nothing and it is the only thing an
   un-migrated phone can still reach. Take it down when the numbers say so.

### The manifest, and why it must keep being served by the function

`netlify/functions/manifest.js` reads the icon out of `settings['app'].appIcon` so the સંચાલક can
change the mark on two thousand home screens without a redeploy. On Android an installed app is a
WebAPK; Chrome re-fetches the manifest roughly once a day, compares it with the package on the
phone, and has Play Services mint a new one when the icon differs. **A static manifest can never
differ from itself**, so serving the static file freezes the icon forever — with nothing failing,
nothing logged, and the panel still reporting "Saved".

Netlify does this with `force = true`. Vercel needs `middleware.js`. Here it is the exact-match
`location = /manifest.webmanifest` in `deploy/nginx.conf`, which beats the real file at that path
because an exact match beats everything in nginx. `deploy/health-check.sh` asserts the
`application/manifest+json` content type, which is what distinguishes the function's answer from
the static file's.

### Every manifest field, verified against what is actually served

Fetched from the running container with the function wired to the live Supabase project:

| Field | Served | Verdict |
| :---- | :----- | :------ |
| `name` | `નીલકંઠ વર્ણી ધ્યાન` | matches `vite.config.js` |
| `short_name` | `વર્ણી ધ્યાન` | matches |
| `lang` | `gu` | matches |
| `start_url` | `/` | matches; correct for an apex-origin install |
| `display` | `standalone` | matches |
| `background_color` | `#100d0a` | matches `index.html`'s `theme-color` |
| `theme_color` | `#100d0a` | matches |
| `icons` | 3 entries — 192×192 `any`, 512×512 `any`, 512×512 `maskable`, all `image/png` | correct; all three URLs return 200 |
| `Content-Type` | `application/manifest+json` | the registered type. Netlify serves the static file as `application/octet-stream` |
| `Cache-Control` | `public, max-age=300, must-revalidate` | five minutes, argued at length in `netlify/functions/manifest.js` |
| `scope` | **absent** | see below |
| `id` | **absent** | see below |

**`scope` and `id` are absent, and I did not add them.** Not an oversight — a constraint:

`scripts/test-app-shell.mjs` contains a group called *"the manifest function has not drifted
from the build"* which reads `netlify/functions/manifest.js` and `vite.config.js` as text and
asserts **every field in the function is found in `vite.config.js`**. That suite passes today —
240 checks, verified by running it. Adding `scope` to the function would fail it unless
`vite.config.js` gained `scope` too, and changing `vite.config.js` is changing the application's
build configuration, which is outside what you asked for.

It also changes nothing. Per the spec, a manifest with no `scope` scopes itself to `start_url`'s
directory, which is `/`; a manifest with no `id` uses `start_url` as its identity. Both defaults
are exactly the explicit values would-be. The only observable consequence is that the function's
manifest string differs from the static file's (which vite-plugin-pwa auto-populates with
`scope: "/"`), so Chrome may re-mint the WebAPK once on Android — and since everyone is
reinstalling at the new origin anyway, that costs nothing here.

If you ever do want them explicit, the change is two lines in `vite.config.js` **and** two in
`netlify/functions/manifest.js`, together, or the drift suite goes red. That is a decision for a
day when you are not also changing hosts.

### A migration page you can deploy to Netlify later

Not wired into the app, and deliberately so — nothing in `src/` was touched. This is a page to
build and publish to the **Netlify** site once the new domain is verified, at which point the
`autoUpdate` worker picks up the new precache manifest on next open and installed phones see it.

```html
<!-- Deploy to the OLD Netlify site only. Never to the new domain. -->
<script>
  // Stop the old worker holding a cached shell, so this page is what people actually see.
  // Order matters: unregister first, then drop the caches it was serving from.
  navigator.serviceWorker?.getRegistrations?.()
    .then(rs => Promise.all(rs.map(r => r.unregister())))
    .then(() => caches?.keys?.())
    .then(keys => Promise.all((keys || []).map(k => caches.delete(k))))
    .catch(() => { /* private mode, or no worker. The notice below still shows. */ });
</script>
```

with a notice beside it in the same Gujarati register the app already uses —
`src/components/ReinstallNotice.jsx` is the model to copy, including its three numbered steps
and its decision to leave "Remove App", "Safari", "Share" and "Add to Home Screen" in English
because those are the words iOS itself prints.

**Do not make it an instant redirect.** Someone opening the installed app needs to read what
happened; a redirect out of a standalone window lands them in a browser with no explanation.
And a bare 301 would not reach them anyway, for the precache reason above.

---

## 13. Supabase: the two dashboard settings that will break if you forget them

The database, RLS, auth and storage are unchanged. Two dashboard settings are tied to the origin,
and **password recovery is the thing that breaks**, quietly, for the person least able to work
around it.

**Authentication → URL Configuration:**

- **Site URL** → `https://YOUR_DOMAIN`
- **Redirect URLs** → add `https://YOUR_DOMAIN/reset-password`

`docs/RECOVERY_CONFIG.md` is the full checklist and currently names the Netlify origin
throughout. Both apps build that URL as `(VITE_SITE_URL || location.origin) + '/reset-password'`
— `src/lib/auth.jsx:576`, `admin/src/lib/adminAuth.jsx:269` — so if the new origin is not in the
list, Supabase refuses the redirect and the link lands on the site root with no session.

**Keep the Netlify entries in the list while both sites are up.** Removing them breaks recovery
for everyone still on the old origin, which during a migration is most people.

Test it, on both origins, before you announce anything: request a reset, open the mail on a
phone, check the address bar, complete the reset.

Nothing else needs changing. Supabase's REST and auth endpoints are not origin-restricted, RLS
policies are unaffected, and Storage URLs are absolute.

---

## 14. The backend

**There is no backend to move.**

The data layer is Supabase — a managed Postgres with RLS, Auth and Storage — which this project
talks to over HTTPS from the browser and from the five functions. It is not in a container here,
and it should not be: `supabase/migrations/` holds 51 migrations, RLS policies are the security
model, and moving it would be a database migration project with nothing to do with leaving
Netlify.

The five functions **are** the server side, and they are already Dockerised as the node half of
the one container this deployment ships. That is the whole of it.

You do **not** need `api.YOUR_DOMAIN`. Every call is same-origin and relative
(`/api/login-mobile`, `/.netlify/functions/list-drive-folder`), which is what lets the functions
send no CORS headers at all — three of them hold the secret key, and making them cross-origin
would be a security change dressed as an architecture change. If you ever do split them onto a
subdomain, `src/lib/auth.jsx` and three files under `admin/src/features/` would need a base URL,
and the functions would need a CORS policy. There is no reason to.

---

## 15. Security review

### What this deployment does

| | |
| :-- | :-- |
| **Public ports** | 80, 443, 443/udp. Nothing else. `app` is on `127.0.0.1:8080`; 8888 is published nowhere and, because node binds `127.0.0.1` inside the container, publishing it would not expose it either |
| **Non-root** | Both processes run as `node` (uid 1000) — verified with `ps` in the running container — with `cap_drop: ALL`, `no-new-privileges`, and a 32 MB tmpfs at `/tmp`. `deploy/nginx-main.conf` is what makes a non-root nginx possible: pid file, all five temp paths and both logs moved off root-owned directories |
| **Secrets** | `SUPABASE_SECRET_KEY` exists only in `.env` (mode 600) and the container's environment. Not in any image, build argument, Actions secret, or commit — scanned and confirmed |
| **Server-side dependency tree** | None. The functions import two files from `shared/domain/` and otherwise use built-in `fetch`, `JSON` and `URL`; `/app` in the image holds no `node_modules` at all |
| **CORS** | None, on purpose. Every call is same-origin; adding CORS would make three secret-key endpoints cross-origin |
| **Security headers** | HSTS at the edge; `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`, `X-Robots-Tag: noindex, nofollow` on every `/admin` path (`public/_headers` parity); `X-Content-Type-Options: nosniff` site-wide (an addition) |
| **Source maps** | Not emitted. Vite's default is `build.sourcemap: false` and neither config overrides it |
| **Directory listing** | `autoindex` is off (nginx default) and not enabled anywhere |
| **Server banner** | `server_tokens off`; Caddy's `-Server` removes its own |
| **Dotted paths** | `location ~ /\.` returns 404, with `^~` exceptions for `/.netlify/functions/` and `/.well-known/` |
| **`/_headers`** | Deleted from `dist/` in the builder. It listed the site's whole cache and security policy and should not be a public URL |
| **Restart policy** | `unless-stopped` on all three services, with health checks |
| **Log exposure** | One line per API request: method, path, status, duration. Never a header, never a body — `/api/login-mobile` receives a password and three endpoints receive a bearer token |
| **SSH** | Key-only after `--harden-ssh`, `PermitRootLogin prohibit-password`, fail2ban on sshd |
| **Image freshness** | Base images are pinned to a minor (`node:22-bookworm-slim` for the build, `node:22-alpine` + Alpine `nginx` for the runtime, `caddy:2.10-alpine` for the edge). Rebuild monthly to pick up patches; `docker scout cves varni-dhyan:local` if you want a report |

### What it deliberately does not do

**No Content-Security-Policy.** The project has none on either host today. The app loads દર્શન
artwork from `lh3.googleusercontent.com`, app icons from Supabase Storage, and embeds
`youtube-nocookie.com`; a policy written without testing every one of those breaks the app in
ways that appear only on the screens nobody opened that day. `public/_headers` makes the same
argument about `frame-ancestors`. If you want one, start in `Content-Security-Policy-Report-Only`
with roughly:

```
default-src 'self';
img-src 'self' data: blob: https://lh3.googleusercontent.com https://<project-ref>.supabase.co;
connect-src 'self' https://<project-ref>.supabase.co;
frame-src https://www.youtube-nocookie.com https://www.youtube.com;
style-src 'self' 'unsafe-inline';
script-src 'self';
```

Watch the report endpoint for a week before enforcing.

**No `preload` on HSTS.** Netlify sends it today; this does not. `preload` submits the domain to
a list compiled into browsers, and removal takes months. Add it once the domain has served HTTPS
reliably for a while and you are certain no subdomain will ever need plain HTTP —
`includeSubDomains` is already there and commits every future subdomain.

**The `deploy` user is in the `docker` group**, which is equivalent to root. §6 explains why that
trade was made and what follows from it.

**No read-only root filesystem.** This is the one protection given up by merging the two
containers into one, and it is stated rather than quietly dropped. In the two-container layout
the api half ran with `read_only: true`, which cost nothing because that process writes no
files. nginx does: a pid file and five temp directories. `deploy/nginx-main.conf` moves every
one of them onto the `/tmp` tmpfs, so almost nothing is left that a read-only root would still
protect — but "almost" is not "nothing", and the flag is off.

**The secret and the web server now share a container.** Also a consequence of merging. In the
split layout, nginx — the process that parses untrusted input all day — had never seen
`SUPABASE_SECRET_KEY` in any form. Now it is an environment variable in the same container.
Two things narrow it, and neither makes it zero:

- node binds `127.0.0.1`, so the endpoint holding the key is unreachable from outside the
  container's network namespace by construction. That is *stronger* than the split layout, where
  the api container listened on `0.0.0.0` and was protected only by the absence of a `ports:`
  entry. `deploy/health-check.sh` asserts it, and the assertion has been negative-tested.
- nginx never reads the environment into a response; there is no SSI, no Lua, no CGI.

If that residual risk matters more to you than the operational simplicity, the split is a
supported shape and §18 says what it would take to go back.

**`npm audit` is not a deploy gate.** The `web` image contains no JavaScript dependencies at
runtime — only built assets — and the `api` image has no dependency tree. Vulnerabilities in
`devDependencies` cannot reach production here. Run `npm audit` on your own schedule; do not let
it block a deploy on a finding that cannot apply.

---

## 16. Performance

| | |
| :-- | :-- |
| **Pre-compressed assets** | The builder writes `gzip -9` twins and nginx serves them with `gzip_static on` — level 9 paid once at build time instead of level 6 per request. A client that sent no `Accept-Encoding` still gets the identical original |
| **Compression at the edge** | Caddy adds zstd for clients that support it. Brotli would need a custom nginx build; the gain over gzip -9 on already-minified JavaScript is a few per cent |
| **Immutable caching** | `/assets/*` and `/admin/assets/*` for a year. Safe because every filename carries a content hash |
| **Fresh shell** | `/`, `/index.html`, `/sw.js`, `/registerSW.js` revalidate on every load, so a deploy is picked up. `public/_headers` parity |
| **HTTP/2 and HTTP/3** | Both, from Caddy, with no configuration |
| **Chunking** | Unchanged. `vite.config.js` splits `@supabase` and `react` into their own chunks so an app redeploy does not re-download the SDK — and `scripts/verify-admin-separation.mjs` asserts it |
| **Image weight** | Measured: `web` 86 MB (nginx-alpine + `dist/` + the gzip twins), `api` 233 MB (node-alpine, and **no `node_modules` at all** — verified: `/app` holds `netlify/functions`, `shared`, `server`, `package.json` and nothing else). The multi-gigabyte builder stage is discarded |
| **Startup** | Under a second for both. The health checks' `start_period` is the floor, not the process |
| **Images** | Untouched: દર્શન artwork is served by `lh3.googleusercontent.com` with its own long-lived cache headers, and the worker's `CacheFirst` rule caches only what is actually viewed. Precaching them would pull 6.3 MB on first load, which `vite.config.js` warns against by name |
| **A CDN, if you ever want one** | Cloudflare in front of the domain, proxied, works without changing anything here — the cache headers already say what may be held and for how long. Do it only if you have visitors far from the server; it adds a second place where a stale `index.html` can hide |

---

## 17. Cutover checklist

**Before**

- [ ] `npm test` passes locally (needs PostgreSQL)
- [ ] `docker compose up -d --build` and `./deploy/health-check.sh` both pass on your machine
- [ ] Log in locally with a **mobile number** and with an **email**
- [ ] `/daily` and `/admin/users` survive a refresh
- [ ] VPS provisioned; `vps-setup.sh` run; `ufw status` shows 22/80/443 only
- [ ] `.env` filled in, `chmod 600`, `SUPABASE_SECRET_KEY` present
- [ ] GitHub secrets set — and `SUPABASE_SECRET_KEY` is **not** among them
- [ ] DNS TTL lowered to 300, a day ahead

**Cutover**

- [ ] `A` (and `AAAA` if applicable) records for apex and `www` point at the server
- [ ] `./deploy/deploy.sh --local` (or a CI tag)
- [ ] `./deploy/health-check.sh https://YOUR_DOMAIN` — all green
- [ ] `curl -I http://YOUR_DOMAIN` → 308; `curl -I https://www.YOUR_DOMAIN` → 308 to apex
- [ ] `curl -s https://YOUR_DOMAIN/manifest.webmanifest -D - | grep -i content-type` →
      `application/manifest+json`
- [ ] Supabase → Authentication → URL Configuration: Site URL and Redirect URLs updated,
      **Netlify entries kept**
- [ ] Password recovery tested end to end on a phone, on both origins
- [ ] Mobile login and email login tested on the new domain
- [ ] સંચાલક panel: log in, open a few pages, refresh on a deep link
- [ ] દર્શન loads; the Drive importer lists a folder
- [ ] Install to a home screen on Android **and** on iPhone; open the installed app; check the
      icon and that it opens standalone
- [ ] DevTools → Application: service worker registered at scope `/`, manifest reads correctly
- [ ] `git push` to `main` and watch the Actions run go green
- [ ] `./deploy/rollback.sh --list` shows entries

**After**

- [ ] Farewell build deployed to Netlify (§12), with the unregister-and-clear-caches step
- [ ] The સંઘ told, through the channel people actually read
- [ ] TTL raised back to 3600
- [ ] Netlify site left running for a few months
- [ ] `docs/RECOVERY_CONFIG.md` updated to name the new origin

---

## 18. Why there are two proxies, and when to drop one

A fair objection: Caddy in front of nginx is two reverse proxies where one might do. Caddy can
serve files, do SPA fallback and set headers; nginx can terminate TLS. Either could be removed.
Here is why neither is, stated so you can overrule it knowingly.

**What each one is actually for:**

One container now runs the whole application; Caddy is the only other one, and it exists solely
for TLS. So the question is really "why is nginx still inside the app container when Caddy could
serve the files?"

| | nginx (inside `app`) | Caddy (the edge) |
| :-- | :--- | :--- |
| Serves `dist/` and `dist/admin/` | ✔ | — |
| Two SPA fallbacks, in the right order | ✔ | — |
| Per-path cache policy (`public/_headers` parity) | ✔ | — |
| `/admin` security headers, at every path they are reached by | ✔ | — |
| Exact-match shadowing of `/manifest.webmanifest` | ✔ | — |
| Proxies the five function paths | ✔ | — |
| TLS, ACME, renewal | — | ✔ |
| HTTP→HTTPS, www→apex, HTTP/2, HTTP/3 | — | ✔ |

nginx is **not** "only serving static assets". It is a 330-line translation of `netlify.toml`
and `public/_headers` in which the correctness of three rules depends on nginx's specific
location-priority semantics — exact `=` beating a real file on disk, `^~` beating a regex,
longer `^~` beating shorter. That is what makes the icon delivery, the dotfile refusal and the
`/admin/assets` split work. Re-expressing it in Caddyfile syntax is a rewrite of the one layer
whose entire job is to be indistinguishable from the old host, and the failures it would
introduce are the quiet kind: a header that stops being sent, a cache rule that silently
inverts. **The 37-check suite passes against this translation. It would have to be re-earned.**

Caddy is there for exactly one property that is hard to keep by hand: a certificate that renews
itself, unattended, for years. That is the argument in §8.

**When to drop Caddy:** if your VPS already runs a reverse proxy on the host. Set `EDGE=off` in
`.env` and point it at `127.0.0.1:8080`. §8 has the certbot notes.

**When to drop nginx:** only if you are willing to re-verify all 37 checks against a Caddyfile
replacement. It is a real option — Caddy's `file_server`, `try_files` and `header` can express
this — but it is a project, not a simplification, and it buys a couple of MB of image.

**What is NOT true:** that this costs a meaningful hop. Caddy → nginx is one bridge-network hop
with keep-alive; nginx → node is loopback. Microseconds.

### One container or two

This deployment ships **one image** — nginx and node together. It began as two, and the split is
still the more orthodox shape, so here is the ledger honestly:

| | one image (what ships) | two images |
| :-- | :--- | :--- |
| Things to pull, tag, roll back | 1 | 2, which must stay in step |
| Total size | 244 MB | 319 MB (86 + 233) |
| PID 1 | tini | Docker's default per container |
| "Which half died?" | `entrypoint.sh` names it and stops the container | separate health checks |
| Restart one half alone | no | yes |
| Read-only root filesystem | no (nginx writes) | yes, on the api half |
| Secret isolated from the web server | no — same container | yes |
| Function server's listen address | `127.0.0.1` — unreachable outside the container | `0.0.0.0`, protected only by having no `ports:` |

The last two rows pull in opposite directions, which is why the merge is defensible rather than
simply worse: it gives up process isolation and gains a stronger network bind.

**Going back to two** is not a rewrite. `deploy/nginx.conf` is the same file either way; it
takes a `resolver 127.0.0.11` line, `proxy_pass http://api:8888`, two runtime stages in the
Dockerfile instead of one, and two services in `compose.yaml`. Everything else — the site rules,
the health check, the deploy scripts' shape — is unchanged.

---

## 19. What you need to supply later

Nothing below is required for the work that is finished. Every one of them is a value to paste
into a file or a dashboard — no source change, no rebuild of the application.

| # | Value | Goes into | Needed for |
| :- | :---- | :-------- | :--------- |
| 1 | `DOMAIN` (bare, no scheme, no `www`) | `.env` on the VPS | Caddy's certificate, the www→apex redirect |
| 2 | `ACME_EMAIL` | `.env` on the VPS | Let's Encrypt expiry warnings |
| 3 | VPS IPv4 (and IPv6 only if it truly has one) | your registrar's DNS | `A` / `AAAA` for `@` and `www` |
| 4 | SSH user + your public key | `vps-setup.sh`, then `authorized_keys` | getting in |
| 5 | A deploy SSH **private** key | GitHub secret `DEPLOY_SSH_KEY` | CI deploys. ⚠ root-equivalent on that box |
| 6 | `DEPLOY_HOST`, `DEPLOY_USER`, optional `DEPLOY_PORT` | GitHub secrets | CI deploys |
| 7 | `IMAGE_REPO` = `ghcr.io/<owner>/<repo>`, lowercase | `.env` on the VPS | pulling images |
| 8 | `GHCR_USER` + read-only `GHCR_TOKEN` | `.env` on the VPS | only if the GHCR packages are private |
| 9 | The five Supabase values | `.env` on the VPS; the two `VITE_*` also as GitHub secrets | everything |
| 10 | Confirmation that `https://<domain>/reset-password` was added to Supabase → Authentication → URL Configuration → Redirect URLs, **with the Netlify entries kept** | the Supabase dashboard | password recovery. §13 |

**Do not send anyone `SUPABASE_SECRET_KEY`, an SSH private key, the database password, or a
production `.env`.** None of them is needed to review or extend this deployment. Items 1–8 are
placeholders today (`YOUR_DOMAIN_HERE`, `YOUR_VPS_IP`, `YOUR_SSH_USER`, `YOUR_GITHUB_OWNER`) and
nothing invents a real value.

---

## 20. Troubleshooting

**`/admin/users` shows the યુવક app.** The `^~ /admin/` location is not winning. Check the
container has the config: `docker compose exec app cat /etc/nginx/conf.d/default.conf | head -40`.

**Every `/api/*` call returns 502 with a Gujarati JSON body.** That is the `@api_down` fallback:
nginx cannot reach the `api` container. `docker compose ps`, then
`docker compose logs --tail 50 app`. Most often `.env` is missing one of the three
`SUPABASE_*` values and compose refused to start the service.

**Mobile login says "મોબાઈલથી લોગિન હજુ ચાલુ થયું નથી".** That is `login-mobile.js` answering 503
because `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` or `SUPABASE_SECRET_KEY` is unset in the `api`
container. `docker compose logs app | head -5` prints which are `MISSING` at startup, without
printing any value.

**The app icon never changes on Android.** `curl -sI https://YOUR_DOMAIN/manifest.webmanifest |
grep -i content-type`. If it is not `application/manifest+json`, the static file is winning and
the exact-match location has been lost. §12 explains why nothing else reports this.

**A password-recovery link lands on the site root with no session.** The origin is not in
Supabase → Authentication → URL Configuration → Redirect URLs. §13.

**Caddy will not get a certificate.** `docker compose logs caddy`. Usual causes: DNS not
resolving to this server yet (`dig +short YOUR_DOMAIN`); port 80 closed, which the ACME http-01
challenge needs even though everything redirects to HTTPS; or a `www` block in the Caddyfile with
no `www` DNS record. Let's Encrypt allows five duplicate certificates a week — if you are near
that, use their staging endpoint while debugging.

**A deploy failed and the site is still up.** That is the design. `deploy.sh` put the previous
images back and exited non-zero. `docker compose logs --tail 100 app` for the build that
failed; `./deploy/rollback.sh --list` to see where you are.

**`docker ps` shows an older image than `.env` and the deploy log claim.** This was a real bug
in `deploy.sh` and `rollback.sh`, found by deploying a deliberately broken image and watching it
pass 37 of 37 checks. Both scripts source `.env` with `set -a`, which **exports** the
currently-live `WEB_IMAGE`; Docker Compose resolves `${VAR}` from the shell environment before
`.env`, so writing the new value to the file was not enough — compose kept re-deploying the old
image while every message reported success, and the next rollback would have "restored" a
version that was never live. The fix is the `export` at the end of `set_env()` in both scripts,
and the comment there explains the full sequence. If you ever fork those scripts, keep it.

Check with:

```bash
grep '^WEB_IMAGE' .env && docker compose ps --format '{{.Service}} {{.Image}}'
```

The two must agree.

**`bad interpreter: /usr/bin/env bash^M`.** A script picked up CRLF line endings.
`.gitattributes` prevents it; if a file predates that, `sed -i 's/\r$//' deploy/*.sh`.

**The site is fine but a stale tab throws on a chunk.** `/assets/*` answers 404 for a file that
no longer exists, where Netlify answered `index.html` with a 200. Both are a failure for a
browser expecting JavaScript; the 404 is the one you can recognise. A reload fixes it, and
`registerType: 'autoUpdate'` means the worker will have updated by then.
