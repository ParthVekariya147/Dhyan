/**
 * Run a Netlify function on Vercel, unchanged.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why an adapter and not a port
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The site is deployed twice, to Netlify and to Vercel, from one repository. The five
 * functions under netlify/functions/ are where the project's privileged work happens: they
 * hold the secret key, the two-identity argument in create-admin.js, the never-500 promise in
 * manifest.js. Netlify is the origin every installed phone in the સંઘ already points at, and
 * those files are serving it right now.
 *
 * So they are not touched. Porting them would mean editing live, load-bearing code to gain a
 * second host - and the version running for two thousand yuvaks would be the one carrying the
 * new bug. Instead this translates at the boundary, and netlify/functions/ stays the single
 * copy of every rule. There is nothing to keep in step, because there is only one of it.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * What actually differs between the two runtimes
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Less than it looks. A Netlify handler is a pure function - `(event) => { statusCode, headers,
 * body }` - and all five read exactly three fields of `event`: `httpMethod`, `headers` and
 * `body`. None reads `queryStringParameters`, `path` or the context argument. Vercel hands a
 * Node request/response pair instead, so the translation is those three fields in and a
 * three-line write out.
 *
 * The one real trap is the body. Vercel parses a JSON request body into an object before the
 * function sees it; Netlify passes the raw string, and every one of these handlers does its own
 * `JSON.parse(event.body || '{}')`. Handing a parsed object to a handler that expects a string
 * makes `JSON.parse` throw on `[object Object]`, which each handler reports as "વિગત બરાબર
 * નથી." - a valid request refused as malformed, on the login path, with nothing in the logs
 * saying why. `rawBody()` below exists entirely to close that gap, and it handles the parsed
 * and unparsed cases both, because which one Vercel gives depends on the Content-Type it saw
 * and is not worth betting the mobile login on.
 *
 * `isBase64Encoded` is deliberately unhandled: it is for binary responses and none of the five
 * returns anything but JSON. A function that starts to would need this file to grow a branch -
 * hence this sentence, rather than silent truncation.
 */

/**
 * The request body as the string a Netlify handler expects.
 *
 * Four cases, in the order they actually occur: already a string (no parser ran), a Buffer
 * (raw parser), an object (JSON parser ran - re-serialised, so the handler's own parse gets
 * what it would have got from Netlify), or nothing yet, in which case the stream is still
 * unread and is drained here. An empty body arrives as '' and every handler already reads
 * that as `{}`.
 */
async function rawBody(req) {
  if (typeof req.body === 'string') return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  if (req.body && typeof req.body === 'object') return JSON.stringify(req.body);

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Wrap a Netlify handler as a Vercel serverless function.
 *
 * Usage, and the whole of it:
 *
 *   import { handler } from '../netlify/functions/login-mobile.js';
 *   export default toVercel(handler);
 *
 * Header names arrive lowercased on both platforms - Node's http module lowercases them and
 * Netlify does the same - so `event.headers.authorization`, which create-admin.js,
 * purge-test-account.js and list-drive-folder.js all read, resolves identically here.
 */
export function toVercel(handler) {
  return async function vercelHandler(req, res) {
    let out;
    try {
      out = await handler({
        httpMethod: req.method,
        headers: req.headers,
        body: await rawBody(req),
      });
    } catch (e) {
      // A Netlify handler that throws would be a 500 from Netlify's runtime; this keeps the
      // same outcome rather than letting the rejection surface as Vercel's own error page,
      // which is HTML and would reach admin/src/lib/errors.js as unparseable.
      console.error('vercel-adapter: handler threw:', e);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ code: 'server-error', gu: 'કંઈક ગડબડ થઈ. ફરી પ્રયત્ન કરો.' }));
      return;
    }

    res.statusCode = out?.statusCode ?? 200;
    for (const [name, value] of Object.entries(out?.headers ?? {})) {
      res.setHeader(name, value);
    }
    res.end(out?.body ?? '');
  };
}
