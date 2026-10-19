import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for Oddjob E2E tests.
 */
export default defineConfig({
  testDir: './tests',
  timeout: 60 * 1000,
  expect: {
    timeout: 10000
  },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  
  /* Configure html and our custom Oddjob reporter */
  reporter: [
    ['html', { open: 'never' }],
    ['list'],
    ['./utils/oddjob-reporter.ts']
  ],

  use: {
    baseURL: process.env.ODDJOB_BASE_URL || 'http://localhost:5000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
  },

  projects: [
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts/,
    },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'playwright/.auth/user.json',
      },
      dependencies: ['setup'],
    },
  ],
});
