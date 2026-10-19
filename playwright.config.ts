import { defineConfig, devices } from '@playwright/test';

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
    testDir: './tests/e2e',
    // Playwright specs are *.spec.ts. Without this, the default testMatch also claims
    // *.test.ts files — which vitest owns, per the include globs in vitest.config.ts.
    // Loading one of those under Playwright aborts collection for the entire suite.
    testMatch: '**/*.spec.ts',
    /* Presentation demos (*.demo.spec.ts) are headed, sleep-driven walkthroughs, not
       regression tests — they cannot pass on a headless CI runner. Excluded by default;
       run them with `npm run test:demos`. */
    testIgnore: process.env.RUN_DEMOS === 'true' ? [] : ['**/*.demo.spec.ts'],
    /* Maximum time one test can run for. */
    timeout: 120 * 1000,
    expect: {
        /**
         * Maximum time expect() should wait for the condition to be met.
         * For example in `await expect(locator).toHaveText();`
         */
        timeout: 15000
    },
    /* Run tests in files in parallel */
    fullyParallel: false,
    /* Fail the build on CI if you accidentally left test.only in the source code. */
    forbidOnly: !!process.env.CI,
    /* Retry on CI only */
    retries: process.env.CI ? 2 : 0,
    /* Opt out of parallel tests on local. */
    workers: 1,
    /* Reporter to use. See https://playwright.dev/docs/test-reporters */
    reporter: 'html',
    /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
    use: {
        /* Maximum time each action such as `click()` can take. Defaults to 0 (no limit). */
        actionTimeout: 0,
        /* Base URL to use in actions like `await page.goto('/')`. */
        baseURL: 'http://localhost:5000',

        /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
        video: 'on-first-retry',
    },

    /* Configure projects for major browsers */
    projects: [
        { name: 'setup', testMatch: /.*\.setup\.ts/ },
        {
            name: 'chromium',
            use: {
                ...devices['Desktop Chrome'],
                // Use prepared auth state.
                storageState: 'playwright/.auth/user.json',
                // Run in non-headless mode for visual testing
                headless: process.env.HEADED === "true" ? false : true,
                // Slow down actions for visibility
                launchOptions: {
                    slowMo: 100,
                },
            },
            dependencies: ['setup'],
        },
        {
            /*
             * Edge, for layout regressions Chromium does not reproduce.
             *
             * Same engine, different chrome: Edge reserves space for its own
             * sidebar and reports a different usable width at the breakpoints
             * where the rails compete for it, so a width bug can be invisible
             * in Chromium and present here.
             *
             * Scoped to the layout and accessibility specs rather than the whole
             * suite. Running everything twice would roughly double a suite that
             * launches real missions, to re-prove behaviour that has nothing to
             * do with the browser.
             */
            name: 'msedge',
            testMatch: ['**/*accessibility.spec.ts', '**/*layout.spec.ts', '**/*overflow.spec.ts'],
            use: {
                ...devices['Desktop Edge'],
                channel: 'msedge',
                storageState: 'playwright/.auth/user.json',
                headless: process.env.HEADED === "true" ? false : true,
            },
            dependencies: ['setup'],
        },
    ],

    /* Folder for test artifacts such as screenshots, videos, traces, etc. */
    outputDir: 'test-results/',

    /* Run your local dev server before starting the tests */
    webServer: {
      command: 'npm run dev',
      port: 5000,
      timeout: 180 * 1000,
      reuseExistingServer: !process.env.CI,
    },
});
