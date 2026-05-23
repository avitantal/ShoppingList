import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    viewport: { width: 414, height: 896 },
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
