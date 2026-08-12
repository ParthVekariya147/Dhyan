import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Serve the repository's `public/` at the server root, in dev only.
 *
 * In production both apps sit on one Netlify origin where the યુવક build has already
 * published `public/` at `/`, so a root-absolute path like `/favicon.svg` resolves. The
 * panel's own dev server is a second origin on :5174 and nothing there answers those paths,
 * so they 404 locally while being correct deployed. This middleware mounts them where
 * production has them.
 *
 * Vite's own `publicDir` does not solve it: those files are served beneath `base`, which is
 * `/admin/` here, so they would answer at `/admin/…` and a root-absolute path would still
 * miss.
 *
 * This used to matter most for દર્શન thumbnails, which were `/darshan/001-640.<hash>.webp`
 * files emitted by the local encoder. There are no such files now — artwork is fetched from
 * Google's CDN by absolute https URL, which works identically on either origin — so what is
 * left here is the icons and the manifest.
 *
 * `apply: 'serve'` — dev only. The build is untouched: `dist/admin` must not carry a second
 * copy of what the યુવક build already emits to the site root (§7).
 */
function sharedPublicAtRoot(dir) {
  const TYPES = {
    '.avif': 'image/avif',
    '.webp': 'image/webp',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.json': 'application/json',
    '.webmanifest': 'application/manifest+json',
    '.ico': 'image/x-icon',
  };

  return {
    name: 'dhyan:shared-public-at-root',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = decodeURIComponent((req.url || '').split('?')[0]);

        // Anything Vite owns is left alone: the panel's own routes live under base, and
        // /@vite, /@fs and /node_modules are its dev plumbing.
        if (!pathname.startsWith('/') || pathname.startsWith('/admin/') || pathname.startsWith('/@') || pathname.startsWith('/node_modules/')) {
          return next();
        }

        // Resolved and then re-checked against `dir`, so a crafted `..` cannot read
        // outside the folder being published. A dev server still binds a port.
        const file = path.resolve(dir, '.' + pathname);
        if (!file.startsWith(dir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
          return next();
        }

        const type = TYPES[path.extname(file).toLowerCase()];
        if (type) res.setHeader('Content-Type', type);
        // No immutable header in dev: an icon edited while the server is running should be
        // visible on reload, not cached past it. Production sets caching from public/_headers.
        res.setHeader('Cache-Control', 'no-cache');
        fs.createReadStream(file).pipe(res);
      });
    },
  };
}

/**
 * સંચાલક પેનલ — a build of its own.
 *
 * This is the whole point of the separation (§5, §50). Rollup never sees admin/src and
 * src/ in the same graph, so no amount of careless importing can put admin code into
 * the bundle a yuvak downloads to reach the login screen. The two builds share only
 * shared/ — pure domain functions and a Supabase client factory — and the Supabase
 * project itself.
 *
 * Differences from the યુવક build, all deliberate:
 *   - no VitePWA. One service worker per origin is enough, and the યુવક app's worker
 *     already claims '/'. Its navigateFallbackDenylist excludes /admin so it does not
 *     serve the yuvak shell for an admin URL.
 *   - no Tailwind. The panel has its own stylesheet (admin/src/app/admin.css); §8 says
 *     not to share UI, and the two are meant to look nothing alike.
 *   - base '/admin/' so the panel can be served from the same Netlify site. Point
 *     `publish` at dist/admin and set base to '/' if it ever moves to its own
 *     subdomain — that is the only line that changes.
 *
 * Environment variables come from the repository root, so both apps read one .env.local.
 */
export default defineConfig({
  root: __dirname,
  base: '/admin/',
  envDir: path.resolve(__dirname, '..'),

  build: {
    outDir: path.resolve(__dirname, '..', 'dist', 'admin'),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Same reasoning as the યુવક build: the Supabase SDK changes far less often
        // than panel code, so a redeploy should not re-download it.
        manualChunks(id) {
          if (id.includes('node_modules/@supabase')) {
            return 'supabase';
          }
          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) {
            return 'react';
          }
        },
      },
    },
  },
  server: { port: 5174 },
  plugins: [react(), sharedPublicAtRoot(path.resolve(__dirname, '..', 'public'))],
});
