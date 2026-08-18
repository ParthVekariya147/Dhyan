#!/usr/bin/env bash
#
# વર્ણી ધ્યાન — go back to a version that worked.
#
#   ./deploy/rollback.sh              # the version before the current one
#   ./deploy/rollback.sh --list       # what is available to go back to
#   ./deploy/rollback.sh sha-abc1234  # a specific tag
#
# Run from the deployment directory (the one holding compose.yaml and .env).
#
# ════════════════════════════════════════════════════════════════════════════════════════════
# WHEN TO REACH FOR THIS
# ════════════════════════════════════════════════════════════════════════════════════════════
#
# deploy/deploy.sh already rolls back on its own when a new version fails deploy/health-check.sh
# — that path needs nothing from anybody. This file is for the other case: a version that PASSED
# the health check and is nonetheless wrong. A broken screen the checks do not cover, a
# regression somebody reports an hour later, a change that turns out to have been a bad idea.
#
# It is fast because nothing is rebuilt. The previous image is still on the disk and this points
# compose back at it, which is the entire reason deploy.sh tags every build with a commit SHA
# instead of overwriting `latest`.
#
# ════════════════════════════════════════════════════════════════════════════════════════════
# WHAT IT DOES NOT UNDO
# ════════════════════════════════════════════════════════════════════════════════════════════
#
# The frontend, and only the frontend. Supabase is a managed service this deployment does not
# touch: a database migration applied with scripts/db.mjs, a settings row a સંચાલક changed, an
# account that was created — none of it moves. If a bad deploy also wrote to the database, this
# brings back the old code in front of the new data, which may or may not be what you want.
# Read supabase/migrations/ before assuming a rollback is complete.

set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
ENV_FILE="$ROOT/.env"
HISTORY="$ROOT/.deploy-history"
HEALTH="$ROOT/deploy/health-check.sh"

log()  { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
die()  { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[ -f "$ENV_FILE" ] || die ".env not found in $ROOT"
[ -f "$HISTORY" ] || die "no .deploy-history in $ROOT — nothing has been deployed by deploy.sh yet.
     What is on the disk:  docker image ls | grep varni-dhyan"

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

COMPOSE=(docker compose -f compose.yaml)
if [ -f "$ROOT/compose.production.yaml" ] && [ "${EDGE:-on}" != "off" ]; then
  COMPOSE+=(-f compose.production.yaml)
fi

# ── --list ──────────────────────────────────────────────────────────────────────────────────
#
# .deploy-history records only deploys that PASSED their health check, one per line, so
# everything listed here is a version that was live and working. That is the property that
# makes it a safe thing to roll back to, and the reason deploy.sh writes the line after the
# gate rather than before it.
if [ "${1:-}" = "--list" ]; then
  printf '\nDeploys that passed their health check, newest last:\n\n'
  printf '  %-22s  %s\n' "WHEN (UTC)" "IMAGE"
  while IFS=$'\t' read -r when image _rest; do
    printf '  %-22s  %s\n' "$when" "$image"
  done < "$HISTORY"
  printf '\n  currently live: %s\n\n' "${APP_IMAGE:-<unset>}"
  exit 0
fi

# Identical to deploy.sh's, including the `export` on the last line — which is not optional.
# Docker Compose reads ${VAR} from the shell environment before it reads .env, and this script
# sourced .env at the top with `set -a`, exporting the CURRENTLY LIVE image names. Writing the
# rollback target to the file without exporting it would leave compose re-deploying the version
# being rolled away from, while every message here reported success. deploy.sh's copy of this
# comment sets out the full sequence and how it was found.
set_env() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp "$ENV_FILE.XXXXXX")"
  grep -v "^${key}=" "$ENV_FILE" > "$tmp" || true
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$ENV_FILE"
  export "$key=$value"
}

# ── pick the target ─────────────────────────────────────────────────────────────────────────
TARGET_TAG="${1:-}"

if [ -n "$TARGET_TAG" ]; then
  [ -n "${IMAGE_REPO:-}" ] || die "IMAGE_REPO is not set in .env"
  TARGET_APP="$IMAGE_REPO:$TARGET_TAG"
else
  # The second-to-last line: the last one is what is running now. `tail -2 | head -1` rather
  # than an index, so this is correct whether the file holds two entries or two hundred.
  line="$(tail -n 2 "$HISTORY" | head -n 1)"
  [ "$(wc -l < "$HISTORY")" -ge 2 ] || die "only one deploy in .deploy-history — there is no previous version.
     Name a tag explicitly:  $0 <tag>       (see $0 --list)"
  TARGET_APP="$(printf "%s" "$line" | cut -f2)"
fi

[ -n "$TARGET_APP" ] || die "could not work out which image to roll back to"

log "Rolling back to $TARGET_APP"

# Present locally, or pullable. A rollback that discovers the old image was pruned should say
# so here, before it has stopped anything, rather than halfway through the swap.
for image in "$TARGET_APP"; do
  if ! docker image inspect "$image" >/dev/null 2>&1; then
    log "Not on this machine — pulling $image"
    docker pull "$image" || die "cannot obtain $image.
     It may have been pruned locally and removed from the registry.
     What is on the disk:  docker image ls | grep varni-dhyan"
  fi
done

set_env APP_IMAGE "$TARGET_APP"

"${COMPOSE[@]}" up -d --wait --no-build --remove-orphans || true

log "Health check"
if "$HEALTH" "http://127.0.0.1:${WEB_PORT:-8080}"; then
  # Recorded like any other deploy, so a second `rollback.sh` with no argument steps back from
  # here rather than returning to the version just rolled away from.
  printf '%s\t%s\n' "$(date -u +%FT%TZ)" "$TARGET_APP" >> "$HISTORY"
  log "Live: $TARGET_APP"
  exit 0
fi

die "The rolled-back version did not pass its health check either.
     docker compose ps
     docker compose logs --tail 200
     Older versions:  $0 --list"
