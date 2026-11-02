import { defineConfig, devices } from '@playwright/test';

/**
 * Locally this reuses servers you already run (npm run dev:api / dev:web).
 * In CI it builds nothing itself — the workflow builds first — and starts the
 * production bundles. Email + AI run on their mock drivers, and the 30s send
 * scheduler is off so the test drives sending deterministically.
 */
const CI = !!process.env.CI;
const env = {
  EMAIL_DRIVER: 'mock',
  AI_DRIVER: 'mock',
  SEND_SCHEDULER: 'off',
};

export default defineConfig({
  testDir: './tests',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: CI ? 1 : 0,
  reporter: CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: CI ? 'npm run start:prod -w apps/api' : 'npm run start:dev -w apps/api',
      cwd: '../..',
      url: 'http://localhost:4000/',
      reuseExistingServer: !CI,
      timeout: 120_000,
      env,
    },
    {
      command: CI ? 'npm run start -w apps/web' : 'npm run dev -w apps/web',
      cwd: '../..',
      url: 'http://localhost:3000/',
      reuseExistingServer: !CI,
      timeout: 120_000,
      env,
    },
  ],
});
