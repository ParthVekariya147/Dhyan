/**
 * Vercel's entry point for the database-backed web app manifest. The function is
 * netlify/functions/manifest.js, unchanged.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * READ THIS BEFORE ASSUMING THE TWO HOSTS BEHAVE THE SAME. THEY DO NOT.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * On Netlify this function answers /manifest.webmanifest, and it takes `force = true` in
 * netlify.toml to make it do so - static files are served before redirects are consulted, and
 * vite-plugin-pwa really does build dist/manifest.webmanifest. That flag's comment in
 * netlify.toml explains at length why it is load-bearing.
 *
 * Vercel has no equivalent. Its rewrites are applied only when the path matches no static file,
 * so a rewrite from /manifest.webmanifest could never fire while dist/manifest.webmanifest
 * exists - and it must exist, because the service worker precaches it and an install that 404s
 * takes the PWA down with it. The documented way to shadow a static file on Vercel is edge
 * middleware, which for a non-Next project means writing the `x-middleware-rewrite` header by
 * hand; that is an internal protocol, and betting the manifest - the one file with a
 * never-fail requirement - on an undocumented header is a worse trade than the difference it
 * would fix.
 *
 * So on the Vercel origin /manifest.webmanifest serves the STATIC manifest from the build, and
 * a new icon set in પેનલ → સેટિંગ્સ does not reach it. This endpoint is still deployed and still
 * correct at /api/manifest, so the behaviour can be verified and is one rewrite away if Vercel
 * ever becomes the origin phones point at.
 *
 * This costs nothing today: the WebAPK update path that the whole design exists for runs
 * against whichever origin an app was installed from, and that is Netlify for every installed
 * phone in the સંઘ. It would cost everything the moment Vercel became the primary host with
 * this note unread.
 */
import { handler } from '../netlify/functions/manifest.js';
import { toVercel } from '../server/vercel-adapter.js';

export default toVercel(handler);
