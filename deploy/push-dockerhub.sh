#!/usr/bin/env bash
#
# વર્ણી ધ્યાન — build the production image and push it to a personal Docker Hub account.
#
#   ./deploy/push-dockerhub.sh <dockerhub-username> [tag]
#
# ┌──────────────────────────────────────────────────────────────────────────────────────────┐
# │  WHAT THIS IS FOR, AND WHAT IT IS NOT                                                    │
# └──────────────────────────────────────────────────────────────────────────────────────────┘
#
# .github/workflows/deploy.yml is the deploy path: it builds in CI, pushes to GHCR, and the VPS
# pulls. That workflow states why building on a laptop or on the server is the second-class
# route, and none of those reasons stop being true here.
#
# This script exists for the other case — putting the image on a personal Docker Hub account by
# hand: to share it, to pull it onto a machine that has no access to the GitHub package, or to
# run the deploy from a laptop before any CI is wired up. It builds the same Dockerfile with the
# same build arguments the workflow uses, so the artefact is the same shape; what it does not
# give you is "the artefact that was tested is the artefact that ships", because nothing tested
# it. Run `npm run build && npm run verify:separation` first if this image is going to serve
# anyone.
#
# ┌──────────────────────────────────────────────────────────────────────────────────────────┐
# │  WHAT ENDS UP INSIDE THE IMAGE YOU ARE PUBLISHING                                        │
# └──────────────────────────────────────────────────────────────────────────────────────────┘
#
# VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are inlined into the JavaScript, exactly
# as they are on the live site — they are public by design and Row Level Security is what
# protects the data. SUPABASE_SECRET_KEY is NOT here and must never be: it is a runtime
# environment variable on the server, and a build argument would bake it into a layer that
# anyone who can pull the image could read.
#
# Even so, prefer a PRIVATE Docker Hub repository. A public one publishes the સંચાલક પેનલ build
# and the project's Supabase URL to anyone who searches for them, which is not a leak but is
# also not something this સંઘ has any reason to hand out. Docker Hub creates a repository on
# first push as PUBLIC unless you created it as private beforehand, so create it first.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }
log() { printf '\033[36m==>\033[0m %s\n' "$*"; }

USER_NAME="${1:-}"
[ -n "$USER_NAME" ] || die "usage: ./deploy/push-dockerhub.sh <dockerhub-username> [tag]"

# Docker Hub namespaces are lowercase. A capital letter here fails at the push with a message
# about an invalid reference format, several minutes after the build.
case "$USER_NAME" in
  *[A-Z]*) die "Docker Hub usernames are lowercase - use '$(printf '%s' "$USER_NAME" | tr 'A-Z' 'a-z')'" ;;
esac

REPO_NAME="${DOCKERHUB_REPO:-varni-dhyan}"
IMAGE_REPO="docker.io/$USER_NAME/$REPO_NAME"

# The commit SHA, and only the commit SHA — the same rule the workflow follows and for the same
# reason: a mutable `latest` is what makes "which version is live?" unanswerable and turns
# deploy/rollback.sh into a guess. `-dirty` when the tree has uncommitted changes, so an image
# built from work in progress cannot be mistaken later for the commit it names.
if [ -n "${2:-}" ]; then
  TAG="$2"
else
  SHA="$(git rev-parse --short HEAD 2>/dev/null)" || die "not a git checkout - pass a tag explicitly"
  TAG="sha-$SHA"
  git diff --quiet HEAD 2>/dev/null || TAG="$TAG-dirty"
fi

# ── build arguments ────────────────────────────────────────────────────────────────────────
#
# Read from the same files the app is developed against. Only VITE_-prefixed values are used;
# anything else in those files, SUPABASE_SECRET_KEY included, is read into this shell and then
# never passed to docker.
for f in .env .env.local; do
  # shellcheck disable=SC1090
  [ -f "$f" ] && { set -a; . "./$f"; set +a; }
done

[ -n "${VITE_SUPABASE_URL:-}" ] \
  || die "VITE_SUPABASE_URL is not set - put it in .env.local (see .env.example)"
[ -n "${VITE_SUPABASE_PUBLISHABLE_KEY:-}" ] \
  || die "VITE_SUPABASE_PUBLISHABLE_KEY is not set - put it in .env.local"

# Is there already a Docker Hub credential for this account?
#
# NOT `docker info | grep Username`, and not `docker info --format '{{.Username}}'` either —
# that field does not exist on this daemon's info type and the template simply errors. The
# credential is a client-side thing: ~/.docker/config.json either holds it in the `auths` map,
# or names a `credsStore` helper that keeps it in the OS keychain. Docker Desktop uses the
# helper and leaves `auths` EMPTY, so anything that reads `auths` alone reports "not logged in"
# for a machine that is perfectly well logged in — and the script would then demand a token on
# every run.
hub_credential_stored() {
  local config store
  config="${DOCKER_CONFIG:-$HOME/.docker}/config.json"
  [ -f "$config" ] || return 1

  store="$(tr -d ' \t\n' < "$config" | sed -n 's/.*"credsStore":"\([^"]*\)".*/\1/p')"
  if [ -n "$store" ] && command -v "docker-credential-$store" >/dev/null 2>&1; then
    # The helper prints {server: username}. Docker Hub lives under the v1 index address, which
    # is what `docker login` with no registry argument writes to.
    "docker-credential-$store" list 2>/dev/null \
      | grep -q "\"https://index.docker.io/v1/\":\"$USER_NAME\"" && return 0
    return 1
  fi

  # No helper: the credential is base64 in config.json under that same key.
  tr -d ' \t\n' < "$config" | grep -q '"https://index.docker.io/v1/":{"auth"'
}

# ── sign in ────────────────────────────────────────────────────────────────────────────────
#
# Skipped when a credential is already stored, so a repeat push does not re-prompt. Use an
# ACCESS TOKEN as the password, not the account password: Docker Hub → Account settings →
# Personal access tokens → Generate, scope "Read & Write". A token can be revoked on its own,
# an account password cannot.
#
# DOCKERHUB_TOKEN in the environment makes this non-interactive; --password-stdin so the token
# is never an argv entry, where `ps` would show it.
if [ -n "${DOCKERHUB_TOKEN:-}" ]; then
  log "Signing in to Docker Hub as $USER_NAME"
  printf '%s' "$DOCKERHUB_TOKEN" | docker login -u "$USER_NAME" --password-stdin
elif ! hub_credential_stored; then
  log "Signing in to Docker Hub as $USER_NAME (paste an access token as the password)"
  docker login -u "$USER_NAME"
fi

# ── build, tag, push ───────────────────────────────────────────────────────────────────────
#
# --platform linux/amd64 explicitly. A build on an Apple Silicon Mac produces an arm64 image by
# default, which pulls fine and then exits with `exec format error` on an x86 VPS - after the
# swap, in front of users.
log "Building $IMAGE_REPO:$TAG"
docker build \
  --platform linux/amd64 \
  --build-arg VITE_SUPABASE_URL="$VITE_SUPABASE_URL" \
  --build-arg VITE_SUPABASE_PUBLISHABLE_KEY="$VITE_SUPABASE_PUBLISHABLE_KEY" \
  --build-arg VITE_SITE_URL="${VITE_SITE_URL:-}" \
  -t "$IMAGE_REPO:$TAG" \
  -f Dockerfile .

log "Pushing $IMAGE_REPO:$TAG"
docker push "$IMAGE_REPO:$TAG"

DIGEST="$(docker image inspect "$IMAGE_REPO:$TAG" --format '{{index .RepoDigests 0}}' 2>/dev/null || true)"

cat <<EOF

  Pushed: $IMAGE_REPO:$TAG
  Digest: ${DIGEST:-(run 'docker image inspect $IMAGE_REPO:$TAG' for the digest)}

  To deploy it on the VPS, set this in /opt/varni-dhyan/.env

      IMAGE_REPO=$IMAGE_REPO

  and run

      ./deploy/deploy.sh $TAG

  If the Docker Hub repository is private, the server needs a read-only token of its own -
  see docs/DEPLOYMENT.md.
EOF
