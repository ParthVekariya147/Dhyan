import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * The યુવક app's build. The સંચાલક panel has its own — admin/vite.config.js — and the two
 * Rollup graphs never meet, so admin code cannot reach this bundle (§5, §50).
 */
export default defineConfig(({ mode }) => {
  /**
   * §64 — VITE_PUBLIC_DARSHAN lifts the login guard on /darshan so the image-delivery
   * regression suite can measure bytes on the wire before a Supabase session exists. It
   * is a verifier flag and must never become a production access bypass.
   *
   * `npm run build:test` supplies it through .env.test, which Vite loads only in mode
   * "test". A production build that carries it anyway — from a stray shell variable or a
   * mis-set Netlify environment variable — fails here instead of publishing દર્શન to
   * anyone with the URL.
   */
  if (mode === 'production' && process.env.VITE_PUBLIC_DARSHAN === '1') {
    throw new Error(
      'VITE_PUBLIC_DARSHAN=1 must never be set on a production build — it is a test-only\n' +
        'flag for scripts/verify-loading.mjs. Use `npm run build:test` for the regression suite.'
    );
  }

  return {
  build: {
    rollupOptions: {
      output: {
        // The Supabase SDK changes far less often than app code, so it is split out of
        // the entry chunk: a redeploy of the app then does not force every yuvak to
        // re-download it. Note what this matches — the literal path
        // `node_modules/@supabase`. If the client package is ever renamed, aliased or
        // replaced, this predicate stops matching *silently*, the SDK falls back into the
        // entry chunk, and nothing here says so; that is precisely how the Firebase →
        // Supabase migration shipped an oversized entry chunk. The `supabase-*.js` chunk
        // assertion in scripts/verify-admin-separation.mjs is the detector. Both builds
        // split the same way, so admin/vite.config.js must change with this.
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
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'નીલકંઠ વર્ણી ધ્યાન',
        short_name: 'વર્ણી ધ્યાન',
        lang: 'gu',
        start_url: '/',
        display: 'standalone',
        background_color: '#100d0a',
        theme_color: '#100d0a',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // IMPORTANT: images are deliberately NOT precached. Precaching would pull all
        // 100 files (6.3 MB) on first load, which is the exact problem this rebuild
        // exists to fix. They are cached at runtime instead — only once actually viewed.
        globPatterns: ['**/*.{js,css,html,woff2,svg}'],
        // The સંચાલક પેનલ is a separate build served from /admin on this same origin,
        // so this worker — which claims '/' — must not answer for it. Without the
        // denylist the navigation fallback serves the યુવક shell for /admin/* from
        // cache, beating Netlify's redirect: the panel would appear to be broken for
        // anyone who had already opened the app once. admin/vite.config.js documents
        // this exclusion as the reason the panel ships no worker of its own.
        navigateFallbackDenylist: [/^\/admin(\/|$)/, /^\/api\//],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/darshan/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'darshan-images',
              expiration: { maxEntries: 250, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  };
});
