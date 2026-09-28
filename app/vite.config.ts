import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const base = process.env.BL_BASE ?? '/backlog/v2/';

export default defineConfig({
  base,
  plugins: [
    react(),
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
