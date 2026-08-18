#!/usr/bin/env bash
#
# વર્ણી ધ્યાન — put a new version live, and refuse to leave a broken one there.
#
#   ./deploy/deploy.sh sha-abc1234     # a tag built and pushed by GitHub Actions
#   ./deploy/deploy.sh --local         # build from the checkout on this machine
#
# Run from the deployment directory (the one holding compose.yaml and .env). GitHub Actions
# invokes the first form over SSH; the second exists for a VPS with no registry access and for
# the first deploy of all, before any image has been pushed.
#
# ════════════════════════════════════════════════════════════════════════════════════════════
# THE ORDER OF OPERATIONS IS THE WHOLE DESIGN
# ════════════════════════════════════════════════════════════════════════════════════════════
#
#   1. remember which image is live right now          ← this is what makes rollback possible
#   2. PULL the new image, with the old one still serving
#   3. swap
#   4. ask deploy/health-check.sh whether the site actually works
#   5. if not, put step 1's image back and exit non-zero
#
# Step 2 before step 3 is the difference between a swap that takes about a second and one that
# takes as long as a download. Step 4 is the difference between a deploy and a deploy you can
# trust: `docker compose up -d --wait` reports that the containers are healthy, and a container
# can be perfectly healthy while serving the યુવક app at /admin/users.
#
# ════════════════════════════════════════════════════════════════════════════════════════════
# WHY THE HEALTH CHECK RUNS AGAINST LOOPBACK AND NOT THE DOMAIN
# ════════════════════════════════════════════════════════════════════════════════════════════
#
# http://127.0.0.1:8080 is the app container directly. Aiming the gate at the public domain
# instead would fold DNS, the TLS edge and the certificate into the pass/fail of an application
# deploy — so an expired certificate would roll back a perfectly good build, and a DNS
# propagation delay would look like a bad one. Those are real problems with their own fix;
# they are not this build's fault and must not trigger this build's rollback.
#
# Check the public origin separately, after: ./deploy/health-check.sh https://<domain>

set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
ENV_FILE="$ROOT/.env"
HISTORY="$ROOT/.deploy-history"
HEALTH="$ROOT/deploy/health-check.sh"

log()  { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
warn() { printf '\033[33m! %s\033[0m\n' "$*" >&2; }
die()  { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[ -f "$ENV_FILE" ] || die ".env not found in $ROOT — copy deploy/.env.production.example to .env"
[ -x "$HEALTH" ] || chmod +x "$HEALTH"

# `set -a` exports everything the file defines, so the values are available to this script AND
# inherited by docker compose. Compose reads .env for ${VAR} interpolation on its own too; both
# paths are wanted, because this script reads IMAGE_REPO and GHCR_TOKEN itself.
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

# The TLS edge is included whenever compose.production.yaml is present. `EDGE=off` in .env
# opts out — for a VPS that already runs its own reverse proxy on the host, or for testing the
# application containers alone.
#
# Written as an `if` and not `A && B && C`, deliberately: under `set -e`, a trailing compound
# list that evaluates false ends the script, so the one-line spelling would make a missing
# overlay file abort the deploy with no message at all.
COMPOSE=(docker compose -f compose.yaml)
if [ -f "$ROOT/compose.production.yaml" ] && [ "${EDGE:-on}" != "off" ]; then
  COMPOSE+=(-f compose.production.yaml)
fi

# ── read the argument ───────────────────────────────────────────────────────────────────────
TAG="${1:-}"
[ -n "$TAG" ] || die "usage: $0 <image-tag> | --local"

# ── remember what is live, before anything changes ──────────────────────────────────────────
#
# Read from .env rather than from `docker ps`, because .env is what compose will use to bring
# the previous version back — the two must be the same string or a rollback restores something
# other than what was running.
PREV_APP="${APP_IMAGE:-}"

# ── set_env KEY VALUE — rewrite one line of .env, AND export it ─────────────────────────────
#
# The temp file is created beside .env and moved over it, so the replacement is atomic: a
# machine that loses power mid-deploy has either the old file or the new one, never half of
# either. `chmod 600` is reapplied because the file holds SUPABASE_SECRET_KEY.
#
# ════════════════════════════════════════════════════════════════════════════════════════════
# THE `export` ON THE LAST LINE IS LOAD-BEARING. REMOVING IT SILENTLY BREAKS EVERY DEPLOY.
# ════════════════════════════════════════════════════════════════════════════════════════════
#
# Docker Compose resolves ${VAR} from the shell environment FIRST and from .env only as a
# fallback — "values set in the shell environment override those set in the .env file". This
# script sources .env at the top with `set -a`, which exports APP_IMAGE with the value of the
# version that is CURRENTLY LIVE.
#
# So writing the new value to the file is not enough. Without the export below, the sequence is:
#
#   1. source .env            → APP_IMAGE=<old> is exported into this shell
#   2. pull <new>             → succeeds
#   3. set_env APP_IMAGE <new> → the FILE now says <new>
#   4. docker compose up      → compose reads the EXPORTED <old> and re-deploys the old image
#   5. health check           → passes, because the old version was fine
#   6. "Live: <new>"          → a lie. Production never changed.
#
# Nothing fails. Nothing is logged. `docker ps` shows the old image while .env, .deploy-history
# and this script's own output all name the new one — and the next rollback would "restore" a
# version that was never live. This was found by deploying a deliberately broken image and
# watching it pass 37 of 37 checks.
set_env() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp "$ENV_FILE.XXXXXX")"
  grep -v "^${key}=" "$ENV_FILE" > "$tmp" || true
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$ENV_FILE"
  export "$key=$value"
}

# ════════════════════════════════════════════════════════════════════════════════════════════
# 1 & 2 — obtain the new image
# ════════════════════════════════════════════════════════════════════════════════════════════

if [ "$TAG" = "--local" ]; then
  log "Building from this checkout (no registry)"
  # A tag that is unique per build, so the previous image survives on disk and rollback has
  # something to go back to. `git rev-parse` when this is a checkout; the date otherwise.
  STAMP="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || date -u +%Y%m%d-%H%M%S)"
  NEW_APP="varni-dhyan:$STAMP"

  # WARNING, and it is the reason --local is the second-class path: a Vite build of both apps
  # needs on the order of 2 GB of RAM. On a 1 GB VPS the kernel's OOM killer takes the build
  # — and, on a machine that is also serving the site, sometimes takes something else with it.
  # Build in CI and pull the result unless you have a specific reason not to.
  APP_IMAGE="$NEW_APP" "${COMPOSE[@]}" build
else
  [ -n "${IMAGE_REPO:-}" ] || die "IMAGE_REPO is not set in .env (e.g. ghcr.io/owner/repo)"
  NEW_APP="$IMAGE_REPO:$TAG"

  if [ -n "${GHCR_TOKEN:-}" ]; then
    log "Signing in to the registry"
    # --password-stdin so the token is never an argv entry, where `ps` would show it.
    printf '%s' "$GHCR_TOKEN" \
      | docker login ghcr.io -u "${GHCR_USER:?GHCR_USER is required when GHCR_TOKEN is set}" \
        --password-stdin
  fi

  log "Pulling $NEW_APP"
  # The old containers are still serving throughout this. If the pull fails, nothing has
  # changed and the site is untouched — which is why it happens before the swap and not after.
  docker pull "$NEW_APP"
fi

# ════════════════════════════════════════════════════════════════════════════════════════════
# 3 — swap
# ════════════════════════════════════════════════════════════════════════════════════════════

set_env APP_IMAGE "$NEW_APP"

log "Starting $NEW_APP"
# --wait blocks until every service reports healthy (or its start_period plus retries run out),
# so the health check below is measuring a settled system rather than a booting one.
# --no-build because the images already exist; a rebuild here would be a second, different build.
#
# `|| true` and NOT a bare call: --wait exits non-zero when a container never becomes healthy,
# and under `set -e` that would end the script here — skipping the rollback, which is the one
# thing that must happen when a new version does not come up. The failure is not swallowed; the
# health check below is what decides, and it will fail too.
started=1
if [ "$TAG" = "--local" ]; then
  "${COMPOSE[@]}" up -d --wait --remove-orphans || started=0
else
  "${COMPOSE[@]}" up -d --wait --no-build --remove-orphans || started=0
fi
[ "$started" -eq 1 ] || warn "compose reported a container that never became healthy"

# ════════════════════════════════════════════════════════════════════════════════════════════
# 4 — the gate
# ════════════════════════════════════════════════════════════════════════════════════════════

log "Health check"
if "$HEALTH" "http://127.0.0.1:${WEB_PORT:-8080}"; then
  printf '%s\t%s\n' "$(date -u +%FT%TZ)" "$NEW_APP" >> "$HISTORY"

  # Anything not referenced by a container or by the last few entries of .deploy-history is
  # disk nobody needs. `--filter until=168h` keeps a week, which is longer than any rollback
  # this process supports and short enough that a small VPS does not fill up.
  log "Pruning images older than a week"
  docker image prune --force --filter "until=168h" >/dev/null || true

  log "Live: $NEW_APP"
  exit 0
fi

# ════════════════════════════════════════════════════════════════════════════════════════════
# 5 — the rollback
# ════════════════════════════════════════════════════════════════════════════════════════════

warn "Health check FAILED — rolling back"

if [ -z "$PREV_APP" ]; then
  # The first deploy on a fresh machine has nothing to go back to. Say so plainly rather than
  # leaving the operator to work out why the rollback did nothing; the containers are left
  # running so the logs can be read.
  die "No previous version recorded — this looks like the first deploy.
     The new version is running and failing its health check.
     Read the logs:  docker compose logs --tail 100 app
     Stop it with:   docker compose down"
fi

set_env APP_IMAGE "$PREV_APP"
# `|| true` for the same reason as above: if the previous version also fails to become healthy,
# the two messages at the bottom of this file are far more useful than `set -e` exiting here.
"${COMPOSE[@]}" up -d --wait --no-build --remove-orphans || true

if "$HEALTH" "http://127.0.0.1:${WEB_PORT:-8080}" >/dev/null 2>&1; then
  die "Rolled back to $PREV_APP — the site is serving the previous version.
     The build that failed was $NEW_APP.
     Read its logs with:  docker compose logs --tail 100 app"
fi

die "ROLLBACK ALSO FAILED ITS HEALTH CHECK. The site may be down.
     docker compose ps
     docker compose logs --tail 200 app
     Previous image: $PREV_APP"
