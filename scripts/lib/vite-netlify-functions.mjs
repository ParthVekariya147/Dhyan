/**
 * Run netlify/functions/* inside the Vite dev server.
 *
 * Why this exists at all: mobile login is the one login path that needs a server. Supabase
 * authenticates on email, so a number has to be resolved to one first, and that resolution
 * must not happen in the browser — a lookup readable before sign-in would let anyone walk
 * the range of Indian mobile numbers and harvest ~2,000 yuvaks' email addresses. So the
 * browser POSTs /api/login-mobile and netlify/functions/login-mobile.js does it with the
 * secret key (see that file's header).
 *
 * In production Netlify wires that up: netlify.toml redirects /api/login-mobile to
 * /.netlify/functions/login-mobile and runs the bundled function. `vite` knows about
 * neither — it does not read netlify.toml and has no function runtime — so on :5173 the
 * path matched nothing and POSTs came back 404, while email login (browser → Supabase,
 * no server in the middle) kept working and made it look like the number was at fault.
 *
 * `netlify dev` is the faithful reproduction of production and stays the right tool for
 * checking redirect order, headers and bundling. This plugin is for the ordinary loop:
 * `npm run dev` on :5173 with mobile login working. It deliberately serves BOTH shapes the
 * client uses — /api/<name> (the netlify.toml alias) and /.netlify/functions/<name> (the
 * raw path admin/src/features/darshan/services/importService.js calls) — so a route that
 * works here does not depend on which of the two a caller happened to pick.
 */

import fs from 'node:fs';
import path from 'node:path';
import { loadEnv } from 'vite';

// The function name only — no nesting, no traversal. Anything else falls through to Vite,
// which is also what keeps `..` out of the path built below.
const ROUTE = /^\/(?:api|\.netlify\/functions)\/([a-z0-9-]+)\/?$/;

const FUNCTIONS_DIR = 'netlify/functions';

// Netlify caps a function body at 6 MB; both functions here take small JSON. The ceiling is
// what stops a dev-server request streaming without end.
const MAX_BODY = 6 * 1024 * 1024;

const readBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });

export default function netlifyFunctionsDev() {
  let config;

  return {
    name: 'netlify-functions-dev',
    // Dev only. A production build must never carry this: the functions are Netlify's to
    // run, and the secret key below belongs nowhere near a bundle.
    apply: 'serve',

    configResolved(resolved) {
      config = resolved;
    },

    configureServer(server) {
      /*
        Vite reads .env files for the *client* and exposes only VITE_-prefixed keys, on
        purpose — anything else would end up in the browser bundle. The functions are the
        opposite case: they run in this Node process and read process.env directly, and
        their three variables (SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY)
        are deliberately un-prefixed so they can never leak into it.

        So load the same files again with an empty prefix and copy what is missing. Reading
        them here rather than in the config keeps them in the server process; nothing from
        this object reaches `define`, the client, or the graph Rollup sees.

        Existing process.env wins, which is what makes the per-shell form work:
          $env:SUPABASE_SECRET_KEY = "sb_secret_..."; npm run dev
      */
      const env = loadEnv(config.mode, config.envDir || config.root, '');
      for (const [key, value] of Object.entries(env)) {
        if (process.env[key] === undefined) process.env[key] = value;
      }

      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url || '/', 'http://localhost');
        const match = ROUTE.exec(url.pathname);
        if (!match) return next();

        const name = match[1];
        const file = path.join(config.root, FUNCTIONS_DIR, `${name}.js`);
        // Not one of ours — hand it back rather than answering 404 on Vite's behalf.
        if (!fs.existsSync(file)) return next();

        try {
          const body = await readBody(req);

          /*
            Loaded through ssrLoadModule, not import(): it applies Vite's transform pipeline
            and its module graph, so editing a function is picked up on the next request
            instead of needing a dev-server restart. It also resolves the `../../shared/…`
            import in login-mobile.js the same way esbuild does when Netlify bundles it.
          */
          const mod = await server.ssrLoadModule(`/${FUNCTIONS_DIR}/${name}.js`);
          const handler = mod.handler ?? mod.default?.handler;
          if (typeof handler !== 'function') {
            throw new Error(`${name}.js exports no handler`);
          }

          // The legacy Netlify event shape, which is what these handlers were written
          // against. Only httpMethod and body are read today; the rest is here so a
          // function that starts reading headers or the query string behaves the same.
          const result = await handler(
            {
              rawUrl: `${url.pathname}${url.search}`,
              path: url.pathname,
              httpMethod: req.method,
              headers: req.headers,
              queryStringParameters: Object.fromEntries(url.searchParams),
              body: body || null,
              isBase64Encoded: false,
            },
            {}
          );

          res.statusCode = result?.statusCode ?? 200;
          for (const [key, value] of Object.entries(result?.headers ?? {})) {
            res.setHeader(key, value);
          }
          res.end(result?.body ?? '');
        } catch (e) {
          // Netlify answers 500 when a function throws, so this does too — a dev server that
          // reported something friendlier would hide the failure until deploy.
          server.config.logger.error(`[netlify-functions-dev] ${name} failed: ${e.stack || e}`);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ gu: 'કંઈક ગડબડ થઈ. ફરી પ્રયત્ન કરો.' }));
        }
      });
    },
  };
}
