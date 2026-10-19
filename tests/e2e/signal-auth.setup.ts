import { test as setup, expect } from "@playwright/test";
import path from "path";
import fs from "fs";
import { SIGNAL_E2E_USER } from "./helpers/signal-global-setup.js";

/**
 * Authenticates the spatial-signal suite and saves its storage state.
 *
 * Deliberately a separate auth file from `auth.setup.ts`: that one logs into
 * whatever server is on port 5000 (the development database) and writes
 * `playwright/.auth/user.json`. Sharing the file would mean whichever suite ran
 * last decided which database the other one talked to.
 *
 * The retry loop is the suite's real readiness gate. The Playwright `webServer`
 * block only waits for the port to open, and the bootstrap binds it early to
 * serve a startup page — so the first few attempts here legitimately fail while
 * routes are still registering.
 */
const authFile = path.join(process.cwd(), "playwright/.auth/signal-user.json");

setup("authenticate against the test database", async ({ page }) => {
  fs.mkdirSync(path.dirname(authFile), { recursive: true });

  let res: Awaited<ReturnType<typeof page.request.post>> | undefined;
  let lastStatus = 0;

  for (let attempt = 1; attempt <= 40; attempt++) {
    try {
      res = await page.request.post("/api/login", {
        // The field is `username`, but auth-engine resolves it through
        // findByUsernameOrEmail, so the seeded email is a valid credential.
        data: { username: SIGNAL_E2E_USER.email, password: SIGNAL_E2E_USER.password },
      });
      lastStatus = res.status();
      if (res.ok()) break;
    } catch {
      // Connection refused while the server finishes booting — expected early.
    }
    await new Promise((r) => setTimeout(r, 1500));
  }

  expect(
    res?.ok(),
    `Could not log in as ${SIGNAL_E2E_USER.email}; last status ${lastStatus}. ` +
      "Check that globalSetup seeded the user into the test database.",
  ).toBeTruthy();

  await page.context().storageState({ path: authFile });
});
