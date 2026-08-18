#!/usr/bin/env bash
#
# વર્ણી ધ્યાન — is this deployment actually serving the application?
#
#   ./deploy/health-check.sh                          # http://127.0.0.1:8080
#   ./deploy/health-check.sh https://YOUR_DOMAIN      # the real thing, through TLS
#
# Exit 0 if every check passes, 1 otherwise. deploy/deploy.sh runs this before it accepts a new
# version, and rolls back on a non-zero exit.
#
# ════════════════════════════════════════════════════════════════════════════════════════════
# WHY IT CHECKS THESE THINGS AND NOT "IS THE CONTAINER UP"
# ════════════════════════════════════════════════════════════════════════════════════════════
#
# The container being up is what Docker's HEALTHCHECK already reports, and it has never been
# the interesting question. Every check below corresponds to something that has a specific,
# quiet way of breaking on a host migration — a rule in netlify.toml that was not translated,
# a header in public/_headers that was dropped, a function that was never wired up. A deploy
# where nginx is running and the સંચાલક panel 404s is a deploy that passes a container health
# check and fails this one.
#
# ════════════════════════════════════════════════════════════════════════════════════════════
# NOTHING HERE WRITES, AND NOTHING HERE NEEDS A LOGIN
# ════════════════════════════════════════════════════════════════════════════════════════════
#
# This is a promise about a script that is pointed at PRODUCTION, so it is worth being exact.
# Every request below is one of three kinds:
#
#   * a GET of a static file or of the app shell;
#   * a GET against a POST-only handler, which returns 405 from the handler's own first line;
#   * a POST carrying NO Authorization header and NO valid identifier, which the handler
#     refuses with 401 or 400 before it reads or writes anything.
#
# `purge-test-account` is destructive when it succeeds. It is exercised at the one point in its
# control flow where it provably cannot be: the `/^Bearer\s+\S+/i` check that sits above every
# `fetch` in the file. No account is touched, no password that could match one is sent, no
# session is needed, and it is safe to run as often as you like.
#
# The section numbering: 1 edge, 2 યુવક app, 3 સંચાલક panel, 4 functions, 5 PWA, 6 caching,
# 7 security, 8 TLS. Sections 7 and 8 are the ones that fail on a misconfigured edge rather
# than a misconfigured application.

set -u -o pipefail

BASE="${1:-http://127.0.0.1:8080}"
BASE="${BASE%/}"

# Total per-request budget. Generous, because the first request after a deploy may wait on
# Caddy's retry window (deploy/Caddyfile, lb_try_duration).
CURL=(curl --silent --show-error --max-time 15 --location --proto-default https)

pass=0
fail=0

green() { printf '\033[32m%s\033[0m' "$1"; }
red()   { printf '\033[31m%s\033[0m' "$1"; }

# ok <description> <condition-already-evaluated:0|1> [detail]
ok() {
  if [ "$2" -eq 0 ]; then
    printf '  %s %s\n' "$(green PASS)" "$1"
    pass=$((pass + 1))
  else
    printf '  %s %s\n' "$(red FAIL)" "$1"
    [ $# -ge 3 ] && printf '         %s\n' "$3"
    fail=$((fail + 1))
  fi
}

# The status code alone.
status() { "${CURL[@]}" -o /dev/null -w '%{http_code}' "$1" 2>/dev/null; }

# Response headers, lowercased, for grepping.
headers() { "${CURL[@]}" -o /dev/null -D - "$1" 2>/dev/null | tr 'A-Z' 'a-z'; }

# Status of a request that must NOT follow redirects — used where the redirect is the subject.
status_noredir() {
  curl --silent --show-error --max-time 15 -o /dev/null -w '%{http_code}' "$1" 2>/dev/null
}
location_of() {
  curl --silent --show-error --max-time 15 -o /dev/null -D - "$1" 2>/dev/null \
    | tr 'A-Z' 'a-z' | sed -n 's/^location: *//p' | tr -d '\r'
}

printf '\nવર્ણી ધ્યાન — health check against %s\n\n' "$BASE"

# ── 1. the containers themselves ────────────────────────────────────────────────────────────
printf 'edge\n'
code=$(status "$BASE/healthz")
[ "$code" = "200" ]; ok "/healthz answers 200 (nginx is serving)" $? "got $code"

# ── 2. the યુવક app shell ───────────────────────────────────────────────────────────────────
printf '\nયુવક app\n'
body=$("${CURL[@]}" "$BASE/" 2>/dev/null)
printf '%s' "$body" | grep -q 'id="root"'
ok "/ returns the app shell" $? "no <div id=\"root\"> in the response"

printf '%s' "$body" | grep -q 'rel="manifest"'
ok "/ links the web app manifest" $?

# THE SPA FALLBACK, which is netlify.toml's `/* → /index.html`. A deep route has no file behind
# it — every path in src/App.jsx is a BrowserRouter route — so this is what makes a refresh on
# /daily work rather than 404.
deep=$("${CURL[@]}" "$BASE/level/4/some-activity/revision" 2>/dev/null)
printf '%s' "$deep" | grep -q 'id="root"'
ok "a deep route falls back to the app shell (SPA routing)" $?

# ── 3. the સંચાલક panel, its own build under /admin ─────────────────────────────────────────
printf '\nસંચાલક panel\n'
code=$(status_noredir "$BASE/admin")
loc=$(location_of "$BASE/admin")
{ [ "$code" = "301" ] && [ "$loc" = "/admin/" ]; }
ok "/admin redirects to /admin/ (301)" $? "got $code, location '$loc'"

admin=$("${CURL[@]}" "$BASE/admin/" 2>/dev/null)
printf '%s' "$admin" | grep -q '/admin/assets/'
ok "/admin/ serves the panel build, not the યુવક shell" $? \
   "no /admin/assets/ reference — the yuvak catch-all may be winning"

# netlify.toml's `/admin/* → /admin/index.html`, which must come before the yuvak catch-all. If
# it is missing, this returns the યુવક app, which boots at an /admin path and redirects to '/'
# — indistinguishable from "the panel refuses to open".
deepadmin=$("${CURL[@]}" "$BASE/admin/users" 2>/dev/null)
printf '%s' "$deepadmin" | grep -q '/admin/assets/'
ok "/admin/users deep-links into the panel" $?

# public/_headers, the /admin/* block. The panel can suspend an account, read two thousand
# mobile numbers and grant SUPER_ADMIN; these three are not optional.
h=$(headers "$BASE/admin/users")
printf '%s' "$h" | grep -q 'x-frame-options: *deny'
ok "/admin/users sends X-Frame-Options: DENY" $?
printf '%s' "$h" | grep -q 'x-robots-tag: *noindex'
ok "/admin/users sends X-Robots-Tag: noindex" $?
printf '%s' "$h" | grep -q 'referrer-policy: *same-origin'
ok "/admin/users sends Referrer-Policy: same-origin" $?

# ── 4. all five function paths ──────────────────────────────────────────────────────────────
#
# ⚠ NOTHING IN THIS SECTION WRITES, DELETES OR AUTHENTICATES ANYTHING.
#
# Two shapes are used, and both were chosen by reading the handlers rather than by guessing:
#
#   * GET against a POST-only handler → 405. The status can only come from the handler's own
#     first line, so it proves nginx location → proxy → container DNS → Node → module load →
#     handler export, and touches nothing at all.
#
#   * POST with no Authorization header → 401. create-admin.js and purge-test-account.js both
#     refuse with `not-authenticated` BEFORE they parse the body, before they read the
#     database and before they reach any code that could create or delete. Verified in the
#     source: the `/^Bearer\s+\S+/i` test sits above every `fetch` in both files. This is the
#     only safe way to prove those two endpoints are wired, and it is genuinely safe — a purge
#     cannot happen without a valid token AND a valid UUID, neither of which is sent.
#
# `purge-test-account` in particular is destructive when it succeeds. It is checked here at the
# one point in its control flow where it cannot do anything.
printf '\nfunctions\n'
code=$(status "$BASE/api/login-mobile")
[ "$code" = "405" ]; ok "GET /api/login-mobile → 405 from the function" $? \
  "got $code — 404 means the proxy is not wired, 502 means the api container is down"

code=$(status "$BASE/.netlify/functions/list-drive-folder")
[ "$code" = "405" ]; ok "GET /.netlify/functions/list-drive-folder → 405" $? \
  "got $code — this literal path is what the દર્શન importer calls"

# post <path> <json> — a POST that carries no credentials of any kind.
post() {
  "${CURL[@]}" -X POST -H 'Content-Type: application/json' -d "$2" "$1" 2>/dev/null
}
post_status() {
  "${CURL[@]}" -o /dev/null -w '%{http_code}' -X POST \
    -H 'Content-Type: application/json' -d "$2" "$1" 2>/dev/null
}

code=$(post_status "$BASE/api/create-admin" '{}')
{ [ "$code" = "401" ] || [ "$code" = "503" ]; }
ok "POST /api/create-admin with no token → 401 (refused before any write)" $? \
  "got $code — 503 means the api container has no SUPABASE_* variables"

code=$(post_status "$BASE/api/purge-test-account" '{}')
{ [ "$code" = "401" ] || [ "$code" = "503" ]; }
ok "POST /api/purge-test-account with no token → 401 (refused before any delete)" $? \
  "got $code — 503 means the api container has no SUPABASE_* variables"

# A malformed number, which login-mobile.js rejects on shape before it looks anything up. No
# account is touched and no password is sent that could match one.
# `fnbody`, not `body`: $body holds the app shell and the caching section below reads the entry
# chunk's hashed filename out of it. Overwriting it here would silently skip that check.
fnbody=$(post "$BASE/api/login-mobile" '{"mobile":"1","password":"x"}')
code=$(post_status "$BASE/api/login-mobile" '{"mobile":"1","password":"x"}')
{ [ "$code" = "400" ] || [ "$code" = "503" ]; }
ok "POST /api/login-mobile with a malformed number → 400" $? "got $code"

printf '%s' "$fnbody" | grep -q '"gu"'
ok "the function's error carries a Gujarati \`gu\` field (the shape clients parse)" $?

# Every endpoint must answer JSON, not an nginx or Caddy HTML error page — src/lib/auth.jsx and
# admin/src/lib/errors.js both parse the body, and HTML there is what turns "the server is
# restarting" into "unexpected token < in JSON at position 0".
for path in /api/login-mobile /api/create-admin /api/purge-test-account \
            /.netlify/functions/list-drive-folder; do
  ct=$(headers "$BASE$path" | sed -n 's/^content-type: *//p' | head -n 1)
  case "$ct" in application/json*) r=0 ;; *) r=1 ;; esac
  ok "$path answers application/json" "$r" "got '$ct'"
done

# ── 5. the manifest, and the icon on ~2,000 home screens ────────────────────────────────────
printf '\nPWA\n'
mh=$(headers "$BASE/manifest.webmanifest")
mb=$("${CURL[@]}" "$BASE/manifest.webmanifest" 2>/dev/null)

printf '%s' "$mb" | grep -q '"start_url"'
ok "/manifest.webmanifest is a manifest" $?

printf '%s' "$mb" | grep -q '"icons"'
ok "/manifest.webmanifest declares icons" $?

# The difference between the function answering and the static file winning. Netlify serves the
# static dist/manifest.webmanifest as application/octet-stream; the function sets the registered
# type. If this fails, the exact-match location in deploy/nginx.conf is not taking priority —
# and the સંચાલક's chosen icon will never reach an installed Android phone, silently.
printf '%s' "$mh" | grep -q 'content-type: *application/manifest+json'
ok "/manifest.webmanifest is served by the function, not the static file" $? \
   "Content-Type is not application/manifest+json — see netlify/functions/manifest.js"

# The service worker decides which version of the app every installed phone runs. A cached copy
# is a deploy that never arrives.
sh=$(headers "$BASE/sw.js")
printf '%s' "$sh" | grep -qE 'cache-control:.*(max-age=0|no-cache|no-store)'
ok "/sw.js is not cached (deploys can reach installed phones)" $?

code=$(status "$BASE/registerSW.js")
[ "$code" = "200" ]; ok "/registerSW.js is served" $? "got $code"

for icon in /icon-192.png /icon-512.png /icon-maskable-512.png /apple-touch-icon.png /favicon.svg; do
  code=$(status "$BASE$icon")
  [ "$code" = "200" ]; ok "$icon is served" $? "got $code"
done

# ── 6. caching, which is what makes the second visit fast ───────────────────────────────────
printf '\ncaching\n'
# The entry chunk, read out of index.html so this follows the build rather than a fixed name.
asset=$(printf '%s' "$body" | sed -n 's/.*src="\(\/assets\/index-[^"]*\.js\)".*/\1/p' | head -n 1)
if [ -n "$asset" ]; then
  ah=$(headers "$BASE$asset")
  printf '%s' "$ah" | grep -q 'cache-control:.*immutable'
  ok "$asset is immutable for a year" $?
else
  ok "found the entry chunk in index.html" 1 "no /assets/index-*.js in the shell"
fi

ih=$(headers "$BASE/")
printf '%s' "$ih" | grep -qE 'cache-control:.*(max-age=0|no-cache|no-store)'
ok "/ is revalidated (a deploy is picked up)" $?

# ── 7. security ─────────────────────────────────────────────────────────────────────────────
printf '\nsecurity\n'

# NO SECRET-SHAPED TOKEN IN ANYTHING THE SERVER HANDS OUT.
#
# `sb_secret_` followed by real key characters. The bare prefix on its own is NOT searched for,
# and that distinction matters: @supabase/supabase-js contains the literal strings
# `sb_publishable_` and `sb_secret_` inside a function that classifies a key by its prefix, so
# every build of this app has contained the substring `sb_secret_` since the SDK was added.
# A naive grep finds it, concludes the worst, and sends somebody rotating keys for no reason.
# What would be a real leak is the prefix followed by a key body, which is what this matches.
leak=0
for path in / /assets/ /admin/ /manifest.webmanifest /api/login-mobile; do
  if "${CURL[@]}" "$BASE$path" 2>/dev/null | grep -qE 'sb_secret_[A-Za-z0-9_-]{8,}|service_role'; then
    leak=1
    printf '         leaked at %s\n' "$path"
  fi
done
[ "$leak" -eq 0 ]; ok "no secret-shaped token in any response body" $?

# The entry chunk specifically — this is the file every visitor downloads and the one place a
# mis-prefixed environment variable would surface.
if [ -n "${asset:-}" ]; then
  if "${CURL[@]}" "$BASE$asset" 2>/dev/null | grep -qE 'sb_secret_[A-Za-z0-9_-]{8,}'; then
    ok "the entry chunk carries no secret key" 1 "$asset contains a secret-shaped token"
  else
    ok "the entry chunk carries no secret key" 0
  fi
fi

# Response headers must not carry server internals back out.
sv=$(headers "$BASE/" | sed -n 's/^server: *//p' | head -n 1)
case "$sv" in *nginx/[0-9]*|*Caddy/[0-9]*) r=1 ;; *) r=0 ;; esac
ok "no server version in the Server header" "$r" "got '$sv'"

# THE FUNCTION SERVER MUST NOT BE REACHABLE EXCEPT THROUGH THE PROXY.
#
# node binds 127.0.0.1 INSIDE the container — HOST=127.0.0.1 in the Dockerfile — and compose
# publishes no port for 8888. So the process holding SUPABASE_SECRET_KEY is unreachable from
# outside the container by construction, not merely by configuration: publishing the port would
# not even expose it, because it is not listening on an address the port mapping could reach.
#
# Asserted from outside anyway. A connection to 8888 on this host must be refused. It is checked
# rather than assumed because `HOST=0.0.0.0` plus a stray `- "8888:8888"` are two small edits
# that together would publish an endpoint that bypasses every RLS policy in the project.
host="${BASE#*://}"; host="${host%%/*}"; host="${host%%:*}"
if curl --silent --max-time 3 -o /dev/null "http://$host:8888/healthz" 2>/dev/null; then
  ok "the function server is NOT reachable directly on 8888" 1 \
     "http://$host:8888/healthz answered — check HOST in the Dockerfile and ports in compose.yaml"
else
  ok "the function server is NOT reachable directly on 8888" 0
fi

# Compose's own view, when this runs on the deployment host. Skipped elsewhere — CI checking a
# public URL has no Docker socket and should not be made to look like a failure.
if command -v docker >/dev/null 2>&1 && [ -f compose.yaml ]; then
  unhealthy=$(docker compose ps --format '{{.Service}} {{.Health}}' 2>/dev/null \
              | grep -vE ' healthy$' | grep -v '^$' || true)
  [ -z "$unhealthy" ]; ok "every container reports healthy" $? "$unhealthy"
fi

# ── 8. TLS, only when the check is aimed at a real origin ───────────────────────────────────
case "$BASE" in
  https://*)
    printf '\nTLS\n'
    th=$(headers "$BASE/")
    printf '%s' "$th" | grep -q 'strict-transport-security'
    ok "HSTS is set" $?

    plain="http://${BASE#https://}"
    code=$(status_noredir "$plain/")
    case "$code" in 301|302|307|308) r=0 ;; *) r=1 ;; esac
    ok "http:// redirects to https://" "$r" "got $code from $plain"

    # THE REGRESSION THIS EXISTS FOR.
    #
    # nginx defaults to `absolute_redirect on`, which builds the Location out of the scheme it
    # is itself serving — plain HTTP, behind the TLS edge. The 301 on /admin then answered
    # `Location: http://<domain>/admin/`: a downgrade to plaintext on the one URL a સંચાલક
    # types by hand, corrected only by a second redirect back up. `absolute_redirect off` in
    # deploy/nginx.conf fixes it, and this is what stops it coming back.
    loc=$(location_of "$BASE/admin")
    case "$loc" in
      http://*) r=1 ;;
      *)        r=0 ;;
    esac
    ok "/admin does not redirect down to http://" "$r" "Location: $loc"

    # Same class of fault, one level up: any redirect anywhere must stay on https.
    loc=$(location_of "$plain/admin/users")
    case "$loc" in
      https://*|"") r=0 ;;
      *)            r=1 ;;
    esac
    ok "a deep http:// link is upgraded, not left on http" "$r" "Location: $loc"
    ;;
esac

# ── the verdict ─────────────────────────────────────────────────────────────────────────────
printf '\n%s passed, %s failed\n\n' "$pass" "$fail"
[ "$fail" -eq 0 ] || exit 1
