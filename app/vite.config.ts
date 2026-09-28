import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import type { Connect, Plugin } from 'vite';

// The site root since v2 replaced v1. BL_BASE=/backlog/v2/ still builds the
// old address for a week after the switch (plan C14, step 4).
const base = process.env.BL_BASE ?? '/backlog/';

// In production the repo's images/ is copied to /backlog/images/ (see
// deploy.yml). Locally only app/ is served, so dev and preview (which e2e
// runs against) serve ../images at the same /backlog/images/ path.
const IMAGES = resolve(__dirname, '../images');
const TYPES: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const serveRepoImages: Connect.NextHandleFunction = (req, res, next) => {
  const path = decodeURIComponent((req.url ?? '').split('?')[0]!);
  if (!path.startsWith('/backlog/images/')) return next();
  const file = resolve(IMAGES, path.slice('/backlog/images/'.length));
  if (!file.startsWith(IMAGES + sep) || !existsSync(file) || !statSync(file).isFile()) return next();
  res.setHeader('Content-Type', TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream');
  createReadStream(file).pipe(res);
};
const repoImages: Plugin = {
  name: 'repo-images',
  configureServer(server) { server.middlewares.use(serveRepoImages); },
  configurePreviewServer(server) { server.middlewares.use(serveRepoImages); }
};

export default defineConfig({
  base,
  plugins: [
    react(),
    repoImages,
    VitePWA({
      registerType: 'autoUpdate',
      scope: base,
      base,
      manifest: {
        name: 'Бэклог',
        short_name: 'Бэклог',
        description: 'Игры, сериалы, кино и аниме, до которых хочется добраться.',
        lang: 'ru',
        start_url: base,
        scope: base,
        display: 'standalone',
        background_color: '#eef0f4',
        theme_color: '#eef0f4',
        icons: [
          { src: '/backlog/images/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/backlog/images/icon-512.png', sizes: '512x512', type: 'image/png' }
        ]
      },
      workbox: {
        // Retires v1's caches and tabs once, after v2 took over /backlog/.
        importScripts: ['sw-retire-v1.js'],
        navigateFallback: 'index.html',
        // The old /backlog/v2/ address serves a redirect page (retired-v2/).
        navigateFallbackDenylist: [/\/backlog\/v2\//],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/images/covers/'),
            handler: 'CacheFirst',
            options: { cacheName: 'bl2-covers', expiration: { maxEntries: 500 } }
          }
        ]
      }
    })
  ],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx,js}']
  }
});
