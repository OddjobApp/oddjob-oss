import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";
import { configureTestEnvironment } from "./tests/configure-test-environment.js";

/**
 * Playwright configuration for the spatial-signal E2E suite.
 *
 * A separate config rather than a project inside `playwright.config.ts` because
 * these specs need a server pointed at a DIFFERENT DATABASE. Scenarios here
 * pause cycles, resume them, re-queue mission runs and bump world-state
 * versions; run against the development database they would corrupt real
 * fleet state, and `npm run dev` reads DATABASE_URL from `.env`.
 *
 * `configureTestEnvironment()` is the same guard the vitest bootstrap applies:
 * it reads TEST_DATABASE_URL, refuses any database whose name lacks a distinct
 * "test" segment, and only then exports DATABASE_URL. A dev URL cannot reach the
 * server started below even if one is present in the environment.
 */
loadEnv({ path: ".env.test", override: true });
const { databaseUrl } = configureTestEnvironment();

/**
 * Deliberately not 5000. A developer's `npm run dev` is usually already bound
 * there against the development database, and `reuseExistingServer` would
 * happily adopt it — running the whole suite against exactly the database this
 * config exists to avoid.
 */
const PORT = Number(process.env.SIGNAL_E2E_PORT ?? 5100);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: ["**/signal-spatial-*.spec.ts", "**/evo-devo-*.spec.ts", "**/signal-auth.setup.ts"],
  globalSetup: "./tests/e2e/helpers/signal-global-setup.ts",

  /* Spatial evaluation involves H3 rasterisation and, for the surprise loop, a
     full autonomy pass; 2 minutes is comfortable for the slowest scenario. */
  timeout: 120 * 1000,
  expect: { timeout: 15_000 },

  /* Serial, and non-negotiable: these scenarios mutate cycle status and
     world-state versions. Scenario 4 asserts a cycle went active -> paused;
     Scenario 6 asserts paused -> active. Run in parallel they would race each
     other and the assertions would be meaningless. */
  fullyParallel: false,
  workers: 1,

  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"], ["html", { outputFolder: "playwright-report/signals" }]],
  outputDir: "test-results/signals",

  use: {
    baseURL: BASE_URL,
    actionTimeout: 0,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "on-first-retry",
  },

  projects: [
    { name: "signal-setup", testMatch: /signal-auth\.setup\.ts/ },
    {
      name: "signals",
      use: {
        ...devices["Desktop Chrome"],
        storageState: "playwright/.auth/signal-user.json",
        headless: process.env.HEADED !== "true",
      },
      dependencies: ["signal-setup"],
    },
  ],

  webServer: {
    /* dev:server only — not `npm run dev`, which also starts the worker fleet
       and the python sidecar. Neither is needed here, and the worker would open
       a second connection to the test database and process queued mission jobs
       out from under the assertions that check they were queued. */
    command: "npx tsx server/index.ts",
    /* Port readiness, not `/api/health/v1/health`: the deep check returns 503
       when Redis or Qdrant are unavailable, neither of which this suite uses.
       The bootstrap binds the port early and serves a startup page while it
       initialises, so port-open alone is not "ready" — the real gate is the
       retry loop in signal-auth.setup.ts, which polls /api/login until routes
       are actually registered. */
    port: PORT,
    timeout: 180 * 1000,
    /* Never adopt a stranger's server: it would almost certainly be the dev one
       on the dev database. */
    reuseExistingServer: false,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      NODE_ENV: "development",
      PORT: String(PORT),
      DATABASE_URL: databaseUrl,
      /* Mission re-queues are asserted by reading the queue, not by letting a
         worker drain it. */
      SKIP_WORKERS: "true",
      /* The in-process surprise path is the one under test; the consumer path
         would double-deliver nothing (the stamp dedupes) but adds a broker
         dependency the suite does not need. */
      KAFKA_ENABLED: "false",
    },
  },
});
