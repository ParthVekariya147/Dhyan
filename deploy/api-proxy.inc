# Everything the three proxied locations in deploy/nginx.conf need, written once.
#
# It is a separate file rather than three copies for one reason: a header that is set in two of
# the three places is worse than a header that is set in none, because the endpoint that lacks
# it is the one nobody notices. The three locations are /manifest.webmanifest, /api/ and
# /.netlify/functions/ — see nginx.conf for what each one preserves.
#
# The upstream is 127.0.0.1:8888 — server/node-server.js, running in this same container and
# bound to loopback only. nginx.conf explains why no `resolver` directive is needed for it.

# HTTP/1.1 with an empty Connection header is what enables keep-alive to the upstream. Without
# both lines nginx opens a new TCP connection per request, which on the mobile login path is a
# handshake in front of a handshake.
proxy_http_version 1.1;
proxy_set_header Connection "";

# The client's view of the request, forwarded rather than replaced.
#
# None of the five functions reads any of these today — they read `httpMethod`, `headers` and
# `body`, and of the headers only `authorization`. They are set anyway because the alternative
# is a function server that sees every request as coming from loopback on plain HTTP, and the
# first time anything needs a real client address or scheme (a rate limit, a log, an audit row)
# it would be looking at the proxy's own.
#
# $http_x_forwarded_proto with a fallback to $scheme, and not a bare "http": TLS is terminated
# at the edge in front of nginx, so the edge's value is the true one and $scheme here is always
# plain http.
proxy_set_header Host              $host;
proxy_set_header X-Real-IP         $remote_addr;
proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;
proxy_set_header X-Forwarded-Host  $host;

# Buffering off: all five functions answer with small JSON — the largest is one Drive folder
# listing — and buffering a response that fits in a single packet only delays it.
proxy_buffering off;
proxy_request_buffering off;

# 5s to connect (the function server is in this container on loopback; anything slower means it
# is down, not busy), 30s to answer. Netlify cuts a function off at ten seconds and nothing
# here needs a fraction of that, so this ceiling exists to free a socket rather than to
# discipline a handler — server/node-server.js makes the same argument from the other side.
proxy_connect_timeout 5s;
proxy_send_timeout    30s;
proxy_read_timeout    30s;

# Never retry a failed request against the upstream.
#
# THIS IS NOT A DEFAULT AND IT MUST NOT BE REMOVED. nginx's default `proxy_next_upstream` includes
# `error` and `timeout`, and it applies to any request method — so a POST to /api/create-admin
# that times out after the function has already created the auth.users row would be sent again,
# and the second attempt would fail on a user that now exists. The same reasoning covers
# /api/purge-test-account, which deletes. These endpoints are not idempotent and a proxy must
# not pretend they are.
proxy_next_upstream off;

# A real response from the function — including its 401, 403, 405 and 503 — is passed to the
# client untouched. `off` is the default and is restated because the whole error contract
# depends on it: every caller reads a `gu` field out of the body, so an endpoint whose refusal
# was replaced by an nginx page would be an endpoint with no message to show.
proxy_intercept_errors off;

# What nginx itself produces when it cannot reach the function server at all — in the second or
# two before node has finished booting, or if node has crashed (deploy/entrypoint.sh then stops
# the container, but nginx may answer a request or two first). That case is NOT covered by the
# line above, which only governs responses the upstream actually sent, and nginx's own 502 body
# is HTML.
# src/lib/auth.jsx and admin/src/lib/errors.js both parse the body as JSON, so HTML there is
# what turns "the server is restarting" into "unexpected token < in JSON at position 0".
error_page 502 503 504 = @api_down;
