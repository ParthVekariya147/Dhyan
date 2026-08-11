import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
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
});
