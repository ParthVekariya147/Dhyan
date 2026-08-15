/**
 * Vercel's entry point for the database-backed web app manifest. The function is
 * netlify/functions/manifest.js, unchanged.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * HOW /manifest.webmanifest REACHES THIS FILE, WHICH DIFFERS BY HOST
 * ────────────────────────────────────────────────────────────────────────────
 *
 * On Netlify it takes `force = true` in netlify.toml - static files are served before redirects
 * are consulted, and vite-plugin-pwa really does build dist/manifest.webmanifest. That flag's
 * comment in netlify.toml explains at length why it is load-bearing.
 *
 * On Vercel it takes middleware.js at the repository root, because Vercel's `rewrites` are
 * applied only when the path matches no static file - so the rewrite in vercel.json can never
 * fire while dist/manifest.webmanifest exists, and it must exist, since the service worker
 * precaches it. Middleware runs before the filesystem is consulted and is the only thing on
 * Vercel that can shadow a real file.
 *
 * Two hosts, two mechanisms, one requirement: this function answers that URL, or an installed
 * Android phone never learns of a new icon. If either mechanism is removed, the symptom is not
 * an error anywhere - it is a manifest that is merely out of date, on a path nothing tests by
 * looking at. `curl -s <origin>/manifest.webmanifest | grep app-icon` is how you tell.
 */
import { handler } from '../netlify/functions/manifest.js';
import { toVercel } from '../server/vercel-adapter.js';

export default toVercel(handler);
