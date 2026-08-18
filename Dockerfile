# syntax=docker/dockerfile:1.7
#
# વર્ણી ધ્યાન — production image. ONE image, frontend and backend together.
#
# ┌──────────────────────────────────────────────────────────────────────────────────────────┐
# │  WHAT IS IN HERE, AND WHY IT IS NOT A STATIC SITE                                        │
# └──────────────────────────────────────────────────────────────────────────────────────────┘
#
# The યુવક app at `/` and the સંચાલક પેનલ at `/admin` are static Vite builds. But five URLs are
# answered by a server, and three of them hold SUPABASE_SECRET_KEY, which bypasses every Row
# Level Security policy on every table:
#
#   POST /api/login-mobile                        every mobile login in the સંઘ
#   POST /api/create-admin                        appointing a સંચાલક
#   POST /api/purge-test-account                  finishing a test-account purge
#   POST /.netlify/functions/list-drive-folder    the bulk દર્શન importer
#   GET  /manifest.webmanifest                    the app icon on ~2,000 home screens
#
# So the image runs two processes:
#
#   nginx  on 0.0.0.0:8080   serves dist/, does both SPA fallbacks, caching, security headers,
#                            and proxies those five paths to →
#   node   on 127.0.0.1:8888 netlify/functions/* UNCHANGED, behind server/node-server.js
#
# The functions are not ported, rewritten or duplicated. server/node-server.js is a third
# adapter beside server/vercel-adapter.js — routing, a body read, a status/header/body write.
#
# ┌──────────────────────────────────────────────────────────────────────────────────────────┐
# │  TWO PROCESSES IN ONE CONTAINER — WHAT THAT COSTS AND HOW IT IS PAID FOR                 │
# └──────────────────────────────────────────────────────────────────────────────────────────┘
#
# Docker's model is one process per container, and combining them gives up three things. Each
# is bought back deliberately rather than ignored:
#
#   1. PID 1 and signal handling. `tini` is PID 1, so signals reach both children and zombie
#      processes are reaped. Without it `docker stop` would be a ten-second kill.
#   2. "Which half died?" deploy/entrypoint.sh waits on BOTH and exits the moment either one
#      does, so a node crash stops the container instead of leaving nginx serving a site whose
#      logins all fail. `restart: unless-stopped` then restarts it.
#   3. Isolation of the secret. In a two-container layout SUPABASE_SECRET_KEY lived only in the
#      api container and nginx had never seen it. Here they share a container, so the mitigation
#      is narrower and explicit: **node binds 127.0.0.1, not 0.0.0.0**. The function server is
#      unreachable from outside this container's network namespace even if someone published
#      port 8888 by mistake — which is a property the two-container layout did not have.
#      docs/DEPLOYMENT.md states the residual risk plainly rather than claiming it is nil.

# ══════════════════════════════════════════════════════════════════════════════════════════
# STAGE 1 — builder
# ══════════════════════════════════════════════════════════════════════════════════════════
#
# Debian rather than Alpine, deliberately. Vite 8 bundles with Rolldown, whose native binding is
# a napi module; the lockfile carries both the glibc and the musl build, but the glibc one is
# what .github/workflows/ci.yml exercises on every push. This stage is discarded, so its size
# buys nothing worth a different libc under the one step that must not surprise us.
#
# Node 22: @supabase/supabase-js declares `"node": ">=22.0.0"` and Vite `^20.19 || >=22.12`.
FROM node:22-bookworm-slim AS builder

WORKDIR /app

ENV NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    PUPPETEER_SKIP_DOWNLOAD=1 \
    CI=true

COPY package.json package-lock.json ./

# `npm ci`, never `npm install`: it installs exactly what package-lock.json pins and fails if
# the two disagree, which is the property that makes an image reproducible. Dev dependencies are
# needed — vite, @vitejs/plugin-react, tailwindcss and vite-plugin-pwa are all devDependencies.
# None of it survives into the runtime stage.
RUN --mount=type=cache,target=/root/.npm \
    npm ci

COPY . .

# ── build-time configuration ───────────────────────────────────────────────────────────────
#
# READ THIS BEFORE ADDING ANOTHER ONE.
#
# A Vite build inlines every VITE_-prefixed value into JavaScript that every visitor downloads.
# These two are public by design — the project URL and the publishable key, which grant nothing
# on their own; Row Level Security is what protects the data (.env.example says so at length).
#
# VITE_* here, and nothing else, ever. SUPABASE_SECRET_KEY is a runtime environment variable and
# must never appear in this stage in any form.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
# Optional. Unset is right almost always — the app then uses the origin the page is running on.
# Whatever it resolves to must be listed under Supabase → Authentication → URL Configuration →
# Redirect URLs, or password recovery silently breaks.
ARG VITE_SITE_URL

ENV VITE_SUPABASE_URL=${VITE_SUPABASE_URL} \
    VITE_SUPABASE_PUBLISHABLE_KEY=${VITE_SUPABASE_PUBLISHABLE_KEY} \
    VITE_SITE_URL=${VITE_SITE_URL}

# Fail here rather than at 3 a.m. in a browser. shared/supabase/client.js throws when either
# value is missing — in the yuvak's browser, on load, as a blank page.
RUN test -n "$VITE_SUPABASE_URL" \
  || (echo "ERROR: build arg VITE_SUPABASE_URL is empty. See docs/DEPLOYMENT.md." >&2; exit 1)
RUN test -n "$VITE_SUPABASE_PUBLISHABLE_KEY" \
  || (echo "ERROR: build arg VITE_SUPABASE_PUBLISHABLE_KEY is empty. See docs/DEPLOYMENT.md." >&2; exit 1)

# The project's own build command, unchanged. `npm run build` is `build:yuvak && build:admin`,
# and the order is load-bearing for two reasons netlify.toml spells out: the યુવક build empties
# dist/, and its service worker precaches by globbing dist/, so building the panel afterwards
# keeps admin chunks out of the yuvak's precache manifest.
RUN npm run build

# Pre-compressed twins for `gzip_static on`. This changes no bytes anyone receives: nginx serves
# file.js.gz only to a client that sent `Accept-Encoding: gzip`, and the identical uncompressed
# file is still there for one that did not. What it buys is gzip -9 paid once at build time
# instead of level 6 paid on every request. Images and fonts are skipped — already compressed.
RUN find dist -type f \
      \( -name '*.js' -o -name '*.css' -o -name '*.html' -o -name '*.svg' \
         -o -name '*.json' -o -name '*.webmanifest' \) \
      -size +1024c \
      -exec gzip -9 -k -f {} \;

# public/_headers is copied into dist/ by Vite because it lives in public/. It is Netlify's and
# Cloudflare's caching declaration and means nothing to nginx — deploy/nginx.conf restates every
# rule in it — but a file listing a site's cache and security policy should not be a public URL.
RUN rm -f dist/_headers dist/_redirects


# ══════════════════════════════════════════════════════════════════════════════════════════
# STAGE 2 — app  (the only image this repository ships)
# ══════════════════════════════════════════════════════════════════════════════════════════
FROM node:22-alpine AS app

# nginx 1.30, built --with-http_gzip_static_module, which deploy/nginx.conf depends on
#   (verified: `nginx -V` on this base lists it).
# bash for `wait -n` in the entrypoint — busybox ash does not support it reliably.
# tini as PID 1, for signals and zombie reaping.
RUN apk add --no-cache nginx bash tini \
 && rm -rf /var/cache/apk/* /etc/nginx/http.d/default.conf

WORKDIR /app

ENV NODE_ENV=production \
    PORT=8888 \
    HOST=127.0.0.1

# ── the backend ────────────────────────────────────────────────────────────────────────────
#
# Note what is NOT copied: node_modules. netlify/functions/*.js import exactly two files between
# them — shared/domain/constants.js and shared/domain/appicon.js — and neither has an import of
# its own. Everything else they use is `fetch`, `JSON` and `URL`, built into Node 22. So the
# server half of this image has no npm dependency tree at all.
#
# package.json is copied for ONE field: `"type": "module"`. netlify/ has no package.json of its
# own, so this is what makes every .js under it an ES module — the same fact Netlify's bundler
# relies on, and the one that made `exports.handler = …` a load-time ReferenceError once
# (netlify/functions/login-mobile.js documents that incident). Nothing is installed from it.
COPY --chown=node:node package.json ./package.json
COPY --chown=node:node netlify/functions ./netlify/functions
COPY --chown=node:node shared ./shared
COPY --chown=node:node server ./server

# ── the frontend ───────────────────────────────────────────────────────────────────────────
COPY --from=builder /app/dist /usr/share/nginx/html

# ── nginx ──────────────────────────────────────────────────────────────────────────────────
#
# nginx-main.conf REPLACES the packaged /etc/nginx/nginx.conf. That is what lets the whole
# server run as a non-root user: the pid file, every temp path and both logs are moved somewhere
# uid 1000 can write, and the `user nginx;` directive — meaningless without root, and a warning
# on every start — is gone.
#
# nginx.conf itself is unchanged from the two-container layout apart from the upstream address.
# It is a line-by-line translation of netlify.toml and public/_headers and is the reason this
# deployment is indistinguishable from the old host.
COPY deploy/nginx-main.conf /etc/nginx/nginx.conf
COPY deploy/nginx.conf      /etc/nginx/http.d/default.conf
COPY deploy/api-proxy.inc   /etc/nginx/http.d/api-proxy.inc
COPY deploy/entrypoint.sh   /usr/local/bin/entrypoint.sh

# The directories nginx writes to, owned by the user that will run it. /tmp/nginx is recreated
# by the entrypoint as well, because compose mounts a tmpfs over /tmp at run time.
RUN mkdir -p /tmp/nginx/client_body /tmp/nginx/proxy /tmp/nginx/fastcgi \
             /tmp/nginx/uwsgi /tmp/nginx/scgi \
 # THE COMPILED-IN DEFAULT ERROR LOG, which is not the one nginx-main.conf declares.
 #
 # Alpine's nginx is built with --error-log-path=/var/lib/nginx/logs/error.log, and nginx opens
 # that path BEFORE it has read a line of configuration — so `error_log /dev/stderr` cannot
 # prevent it. As a non-root user the open fails and every start, including `nginx -t`, prints
 #   nginx: [alert] could not open error log file: … (13: Permission denied)
 # which is noise that trains an operator to ignore startup output. Symlinking it to stderr
 # sends those earliest messages to the same place as all the others.
 && mkdir -p /var/lib/nginx/logs \
 && ln -sf /dev/stderr /var/lib/nginx/logs/error.log \
 && chown -R node:node /tmp/nginx /var/lib/nginx \
 && chmod +x /usr/local/bin/entrypoint.sh \
 && rm -f /usr/share/nginx/html/50x.html

# The base image ships /usr/share/nginx/html/50x.html — an nginx-branded error page the COPY
# above does not replace, so it would be a reachable URL announcing which server software is
# running. Removed above; `server_tokens off` in nginx.conf hides the version.

# Fail the build on a malformed config rather than at `docker compose up` on the VPS. Run as the
# unprivileged user, so this also proves the paths above are writable by it.
USER node
RUN nginx -t

EXPOSE 8080

# Both halves, because either one being down is the site being down. nginx is asked through the
# port the world uses; node is asked on loopback, which is the only address it listens on.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q --tries=1 --spider http://127.0.0.1:8080/healthz \
   && wget -q --tries=1 --spider http://127.0.0.1:8888/healthz || exit 1

# tini as PID 1: forwards signals to both children and reaps zombies. Without it `docker stop`
# would wait its full timeout and then kill, which during a deploy is a dropped mobile login.
ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/entrypoint.sh"]
