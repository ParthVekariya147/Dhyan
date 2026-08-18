/**
 * Run netlify/functions/* on a plain Node server, unchanged.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS
 * ════════════════════════════════════════════════════════════════════════════
 *
 * The site is deployed to Netlify today and to Vercel from the same repository, and is now
 * also deployed to a VPS in Docker. Three hosts, one copy of every rule: the five functions
 * under netlify/functions/ hold the secret key, the two-identity argument in create-admin.js
 * and the never-500 promise in manifest.js, and they are serving ~2,000 યુવકો right now.
 *
 * So they are not touched. server/vercel-adapter.js makes the same argument at length and
 * reaches the same conclusion: translate at the boundary, and netlify/functions/ stays the
 * single copy. This file is that boundary for a container. It is the third adapter, not a
 * second implementation — there is no business logic below this line, only routing, a body
 * read and a status/header/body write.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * THE ROUTE TABLE IS NETLIFY'S, PATH FOR PATH
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Every entry below exists because netlify.toml or Netlify's own function routing answers
 * that exact path on the origin every installed phone points at today. Nothing is widened:
 *
 *   /api/login-mobile                          netlify.toml redirect  → login-mobile
 *   /api/create-admin                          netlify.toml redirect  → create-admin
 *   /api/purge-test-account                    netlify.toml redirect  → purge-test-account
 *   /manifest.webmanifest                      netlify.toml redirect, force = true → manifest
 *   /.netlify/functions/<any of the five>      Netlify's native path for a bundled function
 *
 * `/api/manifest` and `/api/list-drive-folder` are deliberately absent: netlify.toml declares
 * no redirect for either, so neither is reachable on Netlify. Vercel exposes them as a side
 * effect of routing api/ by filename; that is Vercel's accident, not a contract, and adding
 * them here would be this deployment inventing a public endpoint of its own.
 *
 * The one path that looks wrong and is not: admin/src/features/darshan/services/
 * importService.js calls the literal `/.netlify/functions/list-drive-folder`, with a comment
 * saying it deliberately uses no `/api/…` alias. That is why the second shape is served.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * WHAT IS NOT HERE, AND WHY
 * ════════════════════════════════════════════════════════════════════════════
 *
 * No CORS headers. Not one of the five sends an Access-Control-Allow-Origin today, because
 * all five are called same-origin by a page nginx served from the same host. Adding CORS
 * would turn three endpoints that hold the secret key into cross-origin endpoints, which is
 * a security change dressed as a compatibility fix.
 *
 * No request logging of bodies or headers. `/api/login-mobile` receives a password on every
 * mobile login and `authorization: Bearer <jwt>` reaches three of the five. One line is
 * logged per request — method, path, status, duration — and never a header or a body.
 *
 * No function timeout. Netlify cuts a function off at ten seconds; nothing here needs more
 * than a fraction of that (manifest.js bounds its own read at three seconds on purpose), and
 * a ceiling invented here would be a new way for create-admin to fail halfway. The socket
 * timeouts at the bottom of this file are about sockets, not about handlers.
 */

import http from 'node:http';

import { handler as createAdmin } from '../netlify/functions/create-admin.js';
import { handler as listDriveFolder } from '../netlify/functions/list-drive-folder.js';
import { handler as loginMobile } from '../netlify/functions/login-mobile.js';
import { handler as manifest } from '../netlify/functions/manifest.js';
import { handler as purgeTestAccount } from '../netlify/functions/purge-test-account.js';

const PORT = Number(process.env.PORT) || 8888;

// 0.0.0.0 inside the container, which is not the same as "on the internet": compose puts this
// service on a private bridge network and publishes no port for it, so the only thing that can
// reach it is the web container. docs/DEPLOYMENT.md draws the picture.
const HOST = process.env.HOST || '0.0.0.0';

/**
 * Netlify caps a function request body at 6 MB. The same ceiling is applied here, for the same
 * reason scripts/lib/vite-netlify-functions.mjs applies it in dev: without one, a request body
 * streams without end and the process is the thing that runs out. All five handlers take small
 * JSON.
 */
const MAX_BODY = 6 * 1024 * 1024;

/** The five handlers, by the name Netlify bundles them under. */
const FUNCTIONS = new Map([
  ['create-admin', createAdmin],
  ['list-drive-folder', listDriveFolder],
  ['login-mobile', loginMobile],
  ['manifest', manifest],
  ['purge-test-account', purgeTestAccount],
]);

/**
 * The aliases netlify.toml declares. Anything not in this table and not under
 * /.netlify/functions/ is a 404 — including /api/<name> for a function Netlify does not alias.
 */
const ALIASES = new Map([
  ['/api/login-mobile', 'login-mobile'],
  ['/api/create-admin', 'create-admin'],
  ['/api/purge-test-account', 'purge-test-account'],
  ['/manifest.webmanifest', 'manifest'],
]);

/** `/.netlify/functions/<name>`, with no nesting and no traversal. */
const NATIVE_ROUTE = /^\/\.netlify\/functions\/([a-z0-9-]+)\/?$/;

/**
 * The body as the string a Netlify handler expects.
 *
 * Every one of the five does its own `JSON.parse(event.body || '{}')`, so what they must
 * receive is the raw string — the trap server/vercel-adapter.js documents, where a
 * pre-parsed object reaches JSON.parse as "[object Object]" and a valid login is refused as
 * malformed. Nothing parses anything here, so the trap cannot open.
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('request body too large'), { tooLarge: true }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const json = (res, statusCode, body) => {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
};

/**
 * The message every handler already returns for an unexpected failure, so a caller reading
 * admin/src/lib/errors.js or src/lib/auth.jsx sees one shape whatever went wrong.
 */
const SERVER_ERROR = { code: 'server-error', gu: 'કંઈક ગડબડ થઈ. ફરી પ્રયત્ન કરો.' };

const server = http.createServer(async (req, res) => {
  const started = process.hrtime.bigint();
  const url = new URL(req.url || '/', 'http://localhost');
  const pathname = url.pathname;

  // Never logged, never routed anywhere else: this is what Docker's HEALTHCHECK and
  // deploy/health-check.sh ask, and it must not depend on Supabase, on the network or on a
  // handler. It answers "this process is accepting connections", which is the only thing a
  // restart policy can act on.
  if (pathname === '/healthz') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end('ok\n');
    return;
  }

  const native = NATIVE_ROUTE.exec(pathname);
  const name = ALIASES.get(pathname) ?? (native ? native[1] : null);
  const handler = name ? FUNCTIONS.get(name) : null;

  const finish = (status) => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    // Method, path, status, duration. No header and no body, ever — see the header note.
    console.log(`${req.method} ${pathname} ${status} ${ms.toFixed(1)}ms`);
  };

  if (!handler) {
    json(res, 404, { code: 'not-found', gu: 'આ સરનામું મળ્યું નથી.' });
    finish(404);
    return;
  }

  let body;
  try {
    body = await readBody(req);
  } catch (e) {
    if (e?.tooLarge) {
      json(res, 413, { code: 'too-large', gu: 'વિગત બહુ મોટી છે.' });
      finish(413);
      return;
    }
    json(res, 400, { code: 'bad-request', gu: 'વિગત બરાબર નથી.' });
    finish(400);
    return;
  }

  let out;
  try {
    // The legacy Netlify event shape, which is what these handlers were written against.
    // They read `httpMethod`, `headers` and `body` and nothing else — the rest is here so a
    // function that starts reading the query string or path behaves identically to Netlify,
    // exactly as scripts/lib/vite-netlify-functions.mjs supplies it in dev.
    //
    // Node lowercases incoming header names, and so does Netlify, so
    // `event.headers.authorization` — which create-admin.js, purge-test-account.js and
    // list-drive-folder.js all read to evaluate the CALLER's permission rather than the
    // secret key's — resolves the same here.
    out = await handler(
      {
        rawUrl: `${pathname}${url.search}`,
        path: pathname,
        httpMethod: req.method,
        headers: req.headers,
        queryStringParameters: Object.fromEntries(url.searchParams),
        body: body || null,
        isBase64Encoded: false,
      },
      {}
    );
  } catch (e) {
    // Netlify answers 500 when a handler throws; so does Vercel through the adapter, and so
    // does the dev plugin. Anything friendlier here would hide a real fault behind a message
    // that reads like a user error.
    console.error(`node-server: ${name} threw:`, e);
    json(res, 500, SERVER_ERROR);
    finish(500);
    return;
  }

  const status = out?.statusCode ?? 200;
  res.statusCode = status;
  for (const [key, value] of Object.entries(out?.headers ?? {})) {
    res.setHeader(key, value);
  }
  res.end(out?.body ?? '');
  finish(status);
});

/**
 * Socket-level ceilings, not handler ceilings.
 *
 * `requestTimeout` is Node's guard against a client that opens a connection and dribbles;
 * 30 seconds is far beyond anything these five do and far below Node's 5-minute default.
 * `keepAliveTimeout` must exceed nginx's `keepalive_timeout` for the upstream, or nginx
 * reuses a connection Node has just closed and the request fails with a 502 that appears at
 * random under load. deploy/nginx.conf keeps its side at 60s; this is 65.
 */
server.requestTimeout = 30_000;
server.headersTimeout = 35_000;
server.keepAliveTimeout = 65_000;

server.listen(PORT, HOST, () => {
  // Which of the three variables are present, and never their values. A deployment missing
  // SUPABASE_SECRET_KEY does not fail here — login-mobile.js answers 503 "મોબાઈલથી લોગિન હજુ
  // ચાલુ થયું નથી" and manifest.js falls back to the built-in icons at 200, both on purpose —
  // so this line is the only place the omission is visible before a યુવક finds it.
  const present = ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY']
    .map((k) => `${k}=${process.env[k] ? 'set' : 'MISSING'}`)
    .join(' ');
  console.log(`node-server listening on ${HOST}:${PORT} — ${present}`);
});

/**
 * SIGTERM is what `docker stop` and `docker compose up -d` send when a container is replaced.
 * Closing the server stops new connections and lets in-flight requests finish, which is the
 * difference between a deploy that drops a mobile login and one that does not.
 */
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    console.log(`node-server: ${signal} — closing`);
    server.close(() => process.exit(0));
    // A connection held open past this is not worth the container hanging for.
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}
