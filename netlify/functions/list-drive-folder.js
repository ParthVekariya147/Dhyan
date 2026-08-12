/**
 * List the સંચાલક's Drive folder — `{ files: [{ id, name }] }` — so the panel can turn the
 * spreadsheet's `Varni(1)` into a file id.
 *
 * Why this has to be a server function
 * ------------------------------------
 * The bulk importer's ફોટો ફાઈલ column holds a *filename*, not a link. Resolving it needs
 * the folder's listing, and a browser cannot fetch drive.google.com: there is no CORS
 * header on any of these endpoints, so the request never reaches JS. There is also no API
 * key in this project and deliberately so — the folder is shared "anyone with the link",
 * which is the whole reason this works without credentials.
 *
 * The technique, and why this exact URL
 * -------------------------------------
 * scripts/build-darshan.mjs enumerates this exact folder the same way, for the same reason:
 *
 *   - the ordinary folder page server-renders only its first ~50 entries and fetches the
 *     rest by script, so scraping it silently truncates a 109-file folder to 50 — the worst
 *     possible failure here, because the missing 59 look exactly like "not in the folder";
 *   - `embeddedfolderview` renders the whole listing as static HTML, which is the only way
 *     to enumerate the folder without a Drive API key.
 *
 * Verified against this folder: 109 image files, the first being `Varni(1).png` with id
 * 17dayguvK91e9oR4CWj_4pcs4SNpCuPSf. That id is then handed to `driveImageUrl()` in
 * shared/domain/drive.js — the lh3 image CDN, never the quota-metered download route.
 *
 * An ordinary function, not a background one
 * ------------------------------------------
 * It has the ordinary 10-second budget, which one HTML fetch fits inside comfortably — so it
 * CAN return real errors, and it MUST, because a panel that cannot tell "you lack the
 * permission" from "the folder is no longer shared" leaves the સંચાલક with nothing to act on.
 *
 * ESM, not CommonJS. The root package.json declares `"type": "module"` and there is no
 * package.json under netlify/, so every .js file here IS an ES module. `exports.handler`
 * is a ReferenceError at load time — that bug shipped once in login-mobile.js and made
 * every mobile login answer 500 while email login went on working and hid it.
 *
 * Needs SUPABASE_URL and SUPABASE_SECRET_KEY in Netlify → Site settings → Environment
 * variables. The secret key is used ONLY as the `apikey` header; the caller's own token is
 * what `has_permission` is evaluated against, so this endpoint can never be used to do
 * something the caller could not do himself.
 */

/** The folder the collection lives in today. Overridden per-request by the folder the
 *  સંચાલક set in પેનલ → સેટિંગ્સ; kept in step with shared/domain/drive.js by hand. */
const DEFAULT_FOLDER_ID = '1qwZibCk9IaU_fmVi8hDJ4hfmCkY3UGfw';

/** Drive ids are URL-safe base64-ish; the shape is checked before it is put in a URL. */
const FOLDER_ID_RE = /^[A-Za-z0-9_-]{20,}$/;

/** Only files a browser could ever paint. The folder also holds the odd PDF and shortcut. */
const IMAGE_RE = /\.(png|jpe?g|webp|avif|gif|tiff?|bmp|heic)$/i;

/**
 * The listing's shape. `id="entry-<id>"` and `flip-entry-title">name<` are separated by a
 * variable amount of markup, hence the bounded lazy gap — bounded so that a malformed page
 * cannot pair one entry's id with the next entry's name.
 */
const ENTRY_RE = /id="entry-([-\w]{20,50})"[\s\S]{0,1500}?flip-entry-title">([^<]+)</g;

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Drive escapes `&` in filenames, and the સંચાલક's filenames are otherwise ASCII + digits. */
const unescapeHtml = (s) =>
  s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return XML_ENTITIES[body] ?? whole;
  });

/** `gu` is the field every other endpoint and admin/src/lib/errors.js already reads. */
const reply = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body),
});

export const handler = async (event) => {
  // GET would be cacheable and would put the folder id in a proxy log; POST also matches
  // the other two functions, so the panel has one shape to call.
  if (event.httpMethod !== 'POST') return reply(405, { gu: 'Wrong method.' });

  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) {
    console.error('list-drive-folder: SUPABASE_URL / SUPABASE_SECRET_KEY not set');
    return reply(500, { gu: 'The server is not configured yet. Please inform whoever built the panel.' });
  }

  // ---------------------------------------------------------------- who is asking
  //
  // This endpoint is public — anything on the internet can POST to it. Without this check
  // it is a free, authenticated-looking proxy that will fetch a Google Drive listing for
  // anybody. `darshan.update` is the permission it is *for*: the only reason to enumerate
  // the folder is to write image URLs onto દ્રશ્યો, and the write itself is refused by RLS
  // anyway, so refusing here keeps the two answers consistent instead of letting someone
  // walk the folder and fail at the last step.
  //
  // The caller's own token, never the secret key: `has_permission` reads auth.uid(), so
  // authenticating this call as the service role would evaluate the permission of nobody.
  const token = (event.headers?.authorization || event.headers?.Authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return reply(401, { gu: 'Please log in again.' });

  try {
    const allowed = await fetch(`${url}/rest/v1/rpc/has_permission`, {
      method: 'POST',
      headers: {
        apikey: secret,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ perm: 'darshan.update' }),
    });
    if (!allowed.ok) {
      console.warn('list-drive-folder: has_permission replied', allowed.status);
      return reply(401, { gu: 'Please log in again.' });
    }
    if ((await allowed.json()) !== true) {
      return reply(403, { gu: 'You do not have permission to change Darshan content.' });
    }
  } catch (e) {
    console.error('list-drive-folder: permission check failed', e);
    return reply(502, { gu: 'Could not verify your permission. Please try again.' });
  }

  // ---------------------------------------------------------------- which folder
  //
  // Defaulted, overridable, and validated. The default is the folder the collection
  // actually lives in, so the ordinary case needs no input at all; the override exists
  // because the સંચાલક will one day have a second folder, and hard-coding it would make
  // that a code change (§62). The shape check is what stops the override from being an
  // arbitrary-URL fetcher: the id is interpolated into a fixed drive.google.com URL and
  // anything that is not id-shaped is refused before that happens.
  let folderId = DEFAULT_FOLDER_ID;
  try {
    const body = JSON.parse(event.body || '{}');
    if (body.folderId) folderId = String(body.folderId).trim();
  } catch {
    return reply(400, { gu: 'The request could not be read.' });
  }
  if (!FOLDER_ID_RE.test(folderId)) {
    return reply(400, { gu: 'That does not look like a Google Drive folder id.' });
  }

  // ---------------------------------------------------------------- fetch the listing
  let html;
  try {
    const res = await fetch(`https://drive.google.com/embeddedfolderview?id=${folderId}#list`, {
      redirect: 'follow',
      // Drive serves a reduced page to clients it does not recognise as browsers.
      headers: { 'User-Agent': 'Mozilla/5.0' },
      // Well inside the 10s an ordinary function gets, so a slow Drive returns a sentence
      // rather than Netlify's own timeout page, which is HTML and would confuse the caller.
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return reply(502, {
        gu: `Drive would not give the folder listing (replied ${res.status}). Open the folder in Drive → Share → General access → "Anyone with the link", then try again.`,
      });
    }
    html = await res.text();
  } catch (e) {
    console.error('list-drive-folder: fetch failed', e);
    return reply(502, { gu: 'Could not reach Google Drive. Please try again in a moment.' });
  }

  // ---------------------------------------------------------------- parse
  const files = [];
  const seen = new Set();
  for (const [, id, rawName] of html.matchAll(ENTRY_RE)) {
    const name = unescapeHtml(rawName).trim();
    if (!IMAGE_RE.test(name)) continue;
    // The listing repeats each entry in the grid and list views of the same page; the id
    // is what makes them the same file.
    if (seen.has(id)) continue;
    seen.add(id);
    files.push({ id, name });
  }

  if (!files.length) {
    // Zero is never a plausible answer for a folder that is meant to hold the artwork, so
    // it is reported as a failure rather than returned as an empty list that the panel
    // would render as "no file matched any row" 109 times over.
    return reply(502, {
      gu: 'The folder listing came back empty. Check that the folder is shared as "Anyone with the link" and that it still holds the images.',
    });
  }

  console.log(`list-drive-folder: ${files.length} image files in ${folderId}`);
  return reply(200, { folderId, count: files.length, files });
};
