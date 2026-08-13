#!/bin/bash
#
# Setup script for Claude Code cloud sessions — વર્ણી ધ્યાન.
#
# This file is the source of truth; the cloud does NOT read it from the repo. Paste its
# contents into claude.ai/code → environment settings → Setup script. Keeping the copy
# here means the next person can see what the environment actually contains, and can diff
# it against the field when something drifts.
#
# It runs as root on Ubuntu 24.04, once, before Claude Code launches. Anthropic then
# snapshots the filesystem and reuses it, so everything written to disk here is free on
# every later session. It re-runs only when this script changes, when the allowed hosts
# change, or when the snapshot expires (~7 days).
#
# Two rules shape the whole file:
#
#   1. It MUST exit 0. A non-zero exit means the session never starts, so every install is
#      tolerated with `|| true` and reported instead of fatal. A missing Chrome costs you
#      `npm run verify`; a hard failure costs you the session.
#   2. It MUST finish inside ~5 minutes or the snapshot never builds and every session pays
#      the cost again. The two slow steps — the Chrome download and the postgres:16 pull —
#      run concurrently for that reason.
#
# What it provisions, and why each one is here rather than in the SessionStart hook:
#
#   Chrome            scripts/verify-*.mjs drive a real browser through puppeteer-core.
#                     puppeteer-core deliberately bundles no browser, so without this the
#                     five verify suites cannot run at all.
#   Gujarati fonts    the entire product is in Gujarati. Chrome on a bare Ubuntu image has
#                     no Gujarati glyphs, so every screenshot and every layout assertion in
#                     verify:mobile / verify:gallery / verify:nav would measure boxes.
#   postgres:16       scripts/test-rls.mjs applies supabase/migrations to a disposable
#                     container (scripts/lib/pgtest.mjs). Pulling ~150 MB per session is
#                     the difference between `npm run test:rls` being usable and not.
#
# Node, npm and Docker are already on the image and are not installed here.
#
set -u

CHROME_ROOT=/opt/chrome
say() { echo "[cloud-setup] $*"; }

say "provisioning વર્ણી ધ્યાન cloud environment"

# ── Chrome runtime libraries and fonts ────────────────────────────────────────────────
#
# Installed one package at a time on purpose. Ubuntu 24.04 renamed a batch of libraries to
# the `t64` suffix (the 64-bit time_t transition), so both spellings are listed and each is
# allowed to fail — one wrong name in a single apt-get invocation would take the whole set
# down with it, and the list has to survive the next base-image bump unattended.
say "installing Chrome runtime libraries and Gujarati fonts"
apt-get update -qq || true

PKGS="
  ca-certificates xdg-utils
  fonts-liberation fonts-noto-core fonts-lohit-gujr fonts-noto-color-emoji
  libnss3 libnspr4 libdbus-1-3 libdrm2 libgbm1 libxcb1 libx11-6 libx11-xcb1
  libxext6 libxfixes3 libxdamage1 libxcomposite1 libxrandr2 libxkbcommon0
  libpango-1.0-0 libcairo2 libexpat1 libudev1
  libasound2t64 libasound2
  libatk1.0-0t64 libatk1.0-0
  libatk-bridge2.0-0t64 libatk-bridge2.0-0
  libcups2t64 libcups2
  libglib2.0-0t64 libglib2.0-0
"
for p in $PKGS; do
  apt-get install -y --no-install-recommends "$p" >/dev/null 2>&1 || true
done
say "font and library pass done"

# ── The two slow downloads, in parallel ───────────────────────────────────────────────

# Chrome for Testing, fetched by @puppeteer/browsers from storage.googleapis.com. That host
# is on the default Trusted allowlist; dl.google.com, which the usual apt repository recipe
# needs, is not — which is why this route is taken instead of adding Google's apt source.
#
# The resolved binary path is written to $CHROME_ROOT/CHROME_PATH because the version is in
# the directory name and changes with every Chrome release. scripts/install_pkgs.sh reads
# that file rather than guessing a glob.
install_chrome() {
  mkdir -p "$CHROME_ROOT"
  local out
  out=$(npx --yes @puppeteer/browsers install chrome@stable --path "$CHROME_ROOT" 2>&1) || {
    say "WARNING: Chrome install failed - npm run verify and the verify:* suites will not run"
    echo "$out" | tail -5
    return 0
  }
  # The installer's last line is "chrome@<version> <absolute path to the binary>".
  local bin
  bin=$(echo "$out" | tail -1 | awk '{print $NF}')
  if [ -x "$bin" ]; then
    echo "$bin" > "$CHROME_ROOT/CHROME_PATH"
    say "Chrome installed: $bin"
  else
    say "WARNING: Chrome installed but the binary path could not be resolved"
  fi
}

# postgres:16 for scripts/test-rls.mjs. dockerd is normally already up; it is started here
# only for the case where it is not, and the whole step is optional — test:rls calls
# dockerAvailable() and skips cleanly when Docker is absent.
pull_postgres() {
  if ! command -v docker >/dev/null 2>&1; then
    say "docker not present - skipping the postgres:16 pull (test:rls will skip)"
    return 0
  fi
  docker info >/dev/null 2>&1 || { dockerd >/tmp/dockerd.log 2>&1 & sleep 8; }
  if docker pull postgres:16 >/dev/null 2>&1; then
    say "postgres:16 image cached - npm run test:rls is ready"
  else
    say "WARNING: postgres:16 pull failed - test:rls will pull it per session or skip"
  fi
}

say "fetching Chrome and postgres:16 concurrently"
install_chrome &
CHROME_JOB=$!
pull_postgres &
PG_JOB=$!
wait "$CHROME_JOB" "$PG_JOB"

# ── Smoke test ────────────────────────────────────────────────────────────────────────
#
# Chrome unpacking is not the same as Chrome running: a missing shared library shows up
# only on launch. Failing here is still not fatal, but it turns a puzzling puppeteer error
# three days later into one line in the environment build log.
if [ -f "$CHROME_ROOT/CHROME_PATH" ]; then
  BIN=$(cat "$CHROME_ROOT/CHROME_PATH")
  if "$BIN" --headless=new --no-sandbox --disable-gpu --dump-dom about:blank >/dev/null 2>&1; then
    say "Chrome launches cleanly"
  else
    say "WARNING: Chrome is installed but will not launch - a shared library is likely missing"
    "$BIN" --headless=new --no-sandbox --dump-dom about:blank 2>&1 | tail -3
  fi
fi

say "setup complete"
exit 0
