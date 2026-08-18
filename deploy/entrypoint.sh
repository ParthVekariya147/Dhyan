#!/usr/bin/env bash
#
# વર્ણી ધ્યાન — start both halves of the container, and stop the container if either one stops.
#
# PID 1 is tini (see the ENTRYPOINT in the Dockerfile), so signals arrive here properly and
# zombies are reaped. This script's only job is the part tini does not do: knowing that these
# two processes are one service.
#
# ════════════════════════════════════════════════════════════════════════════════════════════
# THE RULE THIS FILE EXISTS TO ENFORCE: EITHER DIES → THE CONTAINER DIES
# ════════════════════════════════════════════════════════════════════════════════════════════
#
# The failure this prevents is specific and quiet. If node exits — a bad SUPABASE_URL, an
# uncaught throw at module load, an OOM — and nginx keeps running, then:
#
#   * the site still loads, so nothing looks wrong;
#   * `docker ps` still says Up;
#   * every mobile login answers 502, and EMAIL login keeps working, because that path goes
#     browser → Supabase and never touches this container. So it looks like a password problem,
#     reported by a few યુવકો, for as long as nobody checks the logs.
#
# `wait -n` returns as soon as EITHER child exits. The container then exits too, and
# `restart: unless-stopped` in compose.yaml restarts it — which is the behaviour a supervised
# service should have, and the reason this is nine lines rather than an s6 installation.
#
# bash, not sh: busybox ash does not support `wait -n` dependably. The Dockerfile installs it.

set -uo pipefail

# Recreated here as well as in the Dockerfile. compose.yaml mounts a tmpfs over /tmp, which
# replaces whatever the image had at that path — so without this, nginx starts against
# directories that existed at build time and do not exist at run time.
mkdir -p /tmp/nginx/client_body /tmp/nginx/proxy /tmp/nginx/fastcgi \
         /tmp/nginx/uwsgi /tmp/nginx/scgi

# ── the backend ─────────────────────────────────────────────────────────────────────────────
#
# Bound to 127.0.0.1 by the HOST environment variable set in the Dockerfile — NOT 0.0.0.0.
#
# That single letter of configuration is the main thing bought back by merging the two
# containers. This process holds SUPABASE_SECRET_KEY, which bypasses every RLS policy on every
# table; listening on loopback means it is unreachable from outside this container's network
# namespace even if somebody publishes port 8888 by mistake. nginx reaches it because nginx is
# in the same namespace.
node /app/server/node-server.js &
node_pid=$!

# ── the frontend ────────────────────────────────────────────────────────────────────────────
#
# `daemon off;` so nginx stays in the foreground as a child of this script; otherwise it forks,
# the shell sees it exit immediately, and the container stops the moment it starts.
nginx -g 'daemon off;' &
nginx_pid=$!

# `docker stop` sends TERM to tini, tini forwards it here, and this passes it to both. Without
# it the shell would ignore the signal, tini's ten-second grace period would run out, and the
# container would be killed mid-request — which during a deploy is a dropped mobile login.
# server/node-server.js closes its listener on TERM and lets in-flight requests finish.
shutdown() {
  trap - TERM INT
  kill -TERM "$node_pid" "$nginx_pid" 2>/dev/null || true
  wait "$node_pid" "$nginx_pid" 2>/dev/null || true
  exit 0
}
trap shutdown TERM INT

echo "entrypoint: nginx pid $nginx_pid (0.0.0.0:8080), node pid $node_pid (127.0.0.1:8888)"

# Blocks until the first of the two exits. `|| code=$?` rather than a bare call because the
# whole point is to continue when it returns non-zero.
code=0
wait -n || code=$?

# Whichever one is still up is now serving half a service. Say which died — the exit code alone
# would not distinguish "node crashed" from "nginx crashed", and those have different causes.
if kill -0 "$node_pid" 2>/dev/null; then
  echo "entrypoint: nginx exited ($code) - stopping the container" >&2
else
  echo "entrypoint: node exited ($code) - stopping the container" >&2
  echo "entrypoint: mobile login, create-admin, purge and the manifest are all served by it" >&2
fi

kill -TERM "$node_pid" "$nginx_pid" 2>/dev/null || true
wait 2>/dev/null || true

# Non-zero, ALWAYS — including when the child that died exited 0.
#
# A process that stops on its own is a failure here whatever status it used, because neither of
# these two is ever supposed to stop while the other runs. Exiting 0 would tell Docker this was
# a clean shutdown, and `restart: unless-stopped` does not restart a container that exited 0 —
# so a node process that quit tidily would leave the site up with every mobile login broken,
# which is the exact failure this whole file exists to prevent.
[ "$code" -eq 0 ] && code=1
exit "$code"
