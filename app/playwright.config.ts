import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://localhost:4173/backlog/v2/' },
  webServer: { command: 'npm run build:e2e && npm run preview', url: 'http://localhost:4173/backlog/v2/', reuseExistingServer: true, timeout: 180_000 },
  projects: [
    { name: 'phone', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } }
  ]
});
