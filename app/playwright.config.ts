import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // Hinting off whatever the machine's font settings say, so text keeps the
  // same widths (and the same line breaks) here and on CI's runner.
  use: { baseURL: 'http://localhost:4173/backlog/', launchOptions: { args: ['--font-render-hinting=none'] } },
  webServer: { command: 'npm run build:e2e && npm run preview', url: 'http://localhost:4173/backlog/', reuseExistingServer: true, timeout: 180_000 },
  projects: [
    { name: 'phone', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } }
  ]
});
