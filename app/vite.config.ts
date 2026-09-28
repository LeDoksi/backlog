import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import type { Connect, Plugin } from 'vite';

const base = process.env.BL_BASE ?? '/backlog/v2/';

// In production the repo's images/ sits at the site root next to v1 (see
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
          { src: '../images/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '../images/icon-512.png', sizes: '512x512', type: 'image/png' }
        ]
      },
      workbox: {
        navigateFallback: 'index.html',
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
