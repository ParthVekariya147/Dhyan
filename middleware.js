import { rewrite } from '@vercel/edge';

/**
 * Vercel only. The one route Vercel's ordinary rewrites cannot express.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * WHAT THIS EXISTS FOR
 * ════════════════════════════════════════════════════════════════════════════
 *
 * `/manifest.webmanifest` must be answered by api/manifest.js, which reads the icon the
 * સંચાલક chose out of `settings['app']`. netlify/functions/manifest.js explains at length why
 * that has to be a function rather than a file: an installed Android app is a WebAPK, Chrome
 * re-fetches this URL roughly once a day and compares it with the package on the phone, and a
 * static manifest can never differ from itself - so a new icon would reach nobody who had
 * already installed.
 *
 * Netlify does it with `force = true` in netlify.toml. Vercel has no equivalent, because its
 * `rewrites` are applied ONLY when the path matches no static file - and
 * `dist/manifest.webmanifest` is a real file that vite-plugin-pwa writes on every build. The
 * rewrite in vercel.json would therefore never fire once, silently, while looking correct.
 *
 * Deleting the static file is not the way out: the service worker precaches it, and a precache
 * entry that 404s fails the whole install and takes the PWA down with it.
 *
 * Middleware is the way out, and the only one: it runs BEFORE the filesystem is consulted, so
 * it can shadow a file that exists. Measured on the deployment before this file was added -
 *
 *   /manifest.webmanifest  ->  icons: /icon-192.png …          the built-in mark
 *   /api/manifest          ->  icons: …/app-icon/icon-…?v=1    the સંચાલક's mark
 *
 * - two correct answers, and Chrome reading the wrong one.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * WHY THE MATCHER IS NOT OPTIONAL
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Without `config.matcher` this function runs on EVERY request to the site - every page, every
 * hashed asset, every /api call - to serve one URL that is fetched about once a day per phone.
 * That is a per-request cost and a per-request failure mode bought for nothing. Scoped to the
 * single path, it executes only when that path is asked for.
 *
 * `rewrite` and not `redirect`: the URL a browser holds must stay `/manifest.webmanifest`.
 * A redirect would change the manifest's own address, and a manifest's URL is what `start_url`
 * and `scope` are resolved against.
 *
 * Netlify never loads this file - it reads netlify/functions/ and netlify.toml, and neither
 * names it. Vite never bundles it either: nothing imports it, and it is not an entry point.
 * It is inert everywhere except Vercel's edge.
 */
export const config = {
  matcher: '/manifest.webmanifest',
};

export default function middleware(request) {
  return rewrite(new URL('/api/manifest', request.url));
}
