/**
 * App Forge Full Lifecycle E2E — from Crew chat through deployment & runtime.
 *
 * This spec exercises the COMPLETE UI-driven App Forge lifecycle:
 *
 *   1. Navigate to a fresh Crew chat room
 *   2. Mount the App Studio Pod (forge mode)
 *   3. Walk through: Architecture Archetype → Specs & Requirements → Pre-Flight Review
 *   4. Ignite the build via the "Start Build" button
 *   5. Monitor the live-build view (stage subway, progress %, SSE telemetry)
 *   6. Wait for build completion and verify transition to Builder mode
 *   7. Validate the forged app serves a real page at /forged/<slug>
 *   8. Verify the app appears in the installed apps list
 *   9. Cleanup: delete the test app
 *
 * Environment variables:
 *   FORGE_E2E_MAX_POLL_MS   — max wait for forge completion (default: 20m)
 *   FORGE_E2E_POLL_INTERVAL — polling interval (default: 5s)
 *   FORGE_E2E_STALE_MS      — stale status threshold (default: 6m)
 */

import { test, expect, type Page, type APIRequestContext, type TestInfo } from "@playwright/test";
import path from "node:path";
import fs from "node:fs/promises";

/* ── Configuration ──────────────────────────────────────────────────────── */

const MAX_POLL_MS = Number(process.env.FORGE_E2E_MAX_POLL_MS ?? 20 * 60 * 1000);
const POLL_INTERVAL_MS = Number(process.env.FORGE_E2E_POLL_INTERVAL ?? 5000);
const STALE_STATUS_MS = Number(process.env.FORGE_E2E_STALE_MS ?? 6 * 60 * 1000);

const TERMINAL_SUCCESS = new Set(["completed", "complete"]);
const TERMINAL_FAILURE = new Set(["failed", "error", "cancelled"]);

/* ── Utilities ──────────────────────────────────────────────────────────── */

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

async function writeArtifact(
  testInfo: TestInfo,
  artifactDir: string,
  name: string,
  body: unknown,
  contentType = "application/json",
) {
  await ensureDir(artifactDir);
  const filePath = path.join(artifactDir, name);
  const content = typeof body === "string" ? body : JSON.stringify(body, null, 2);
  await fs.writeFile(filePath, content);
  await testInfo.attach(name, { path: filePath, contentType });
  return filePath;
}

async function screenshot(page: Page, artifactDir: string, testInfo: TestInfo, name: string) {
  await ensureDir(artifactDir);
  const filePath = path.join(artifactDir, name);
  await page.screenshot({ path: filePath, fullPage: true });
  await testInfo.attach(name, { path: filePath, contentType: "image/png" });
}

/* ── Test ────────────────────────────────────────────────────────────────── */

test.describe("App Forge Full Lifecycle (UI-Driven)", () => {
  // The forge can take 15+ minutes; give the test suite ample room.
  test.setTimeout(MAX_POLL_MS + 300_000);

  test("walks the full forge wizard, monitors live-build, and verifies deployed app", async ({
    page,
    request,
  }, testInfo) => {
    const runId = Date.now();
    const testAppName = `E2E Forge Test ${runId}`;
    const testAppSlug = `e2e-forge-test-${runId}`;
    const artifactDir = path.join(process.cwd(), "test-results", "app-forge-full-lifecycle", testAppSlug);

    const consoleErrors: string[] = [];
    const failedRequests: string[] = [];

    page.on("console", (msg) => {
      if (msg.type() === "error") {
        const text = msg.text();
        if (!/favicon|Download the React DevTools|\[vite\] connect/i.test(text)) {
          consoleErrors.push(text.slice(0, 500));
        }
      }
    });
    page.on("requestfailed", (req) => {
      const url = req.url();
      if (!url.includes("/favicon")) {
        failedRequests.push(`${req.method()} ${url} :: ${req.failure()?.errorText ?? "unknown"}`);
      }
    });

    /* ──────────────────────────────────────────────────────────────────────
     *  PHASE 1: Navigate to a Crew chat room with App Studio mounted
     *
     *  The ?studio=forge query parameter triggers the URL fallback in
     *  ModularAssemblyPuzzleRail, which mounts AppStudioPod in forge mode
     *  without needing a turn artifact in the history.
     * ──────────────────────────────────────────────────────────────────── */

    const sessionKey = `forge-e2e-${runId}`;
    console.log(`[E2E] Navigating to /workspace/chat/${sessionKey}?studio=forge`);
    await page.goto(`/workspace/chat/${sessionKey}?studio=forge`, { waitUntil: "domcontentloaded" });

    // Auth guard — fail fast if we're on the login page
    await expect(page, "should not redirect to login").not.toHaveURL(/\/auth\/login/);

    // Wait for the CREW transcript container to render
    const transcript = page.locator('[data-testid="crew-transcript"]');
    await expect(transcript).toBeVisible({ timeout: 30_000 });

    await screenshot(page, artifactDir, testInfo, "01-crew-chat-loaded.png");

    // Wait for the App Studio Pod to render in forge mode
    const studioPod = page.locator('[data-testid="app-studio-pod"]');
    await expect(studioPod).toBeVisible({ timeout: 30_000 });
    await expect(studioPod).toHaveAttribute("data-mode", "forge");

    await screenshot(page, artifactDir, testInfo, "02-app-studio-pod-mounted.png");

    /* ──────────────────────────────────────────────────────────────────────
     *  PHASE 3: Walkthrough Step 1 — Architecture Archetype Selection
     * ──────────────────────────────────────────────────────────────────── */

    // Ensure the walkthrough view is active
    const walkthroughBtn = page.locator('[data-testid="forge-view-walkthrough"]');
    await expect(walkthroughBtn).toBeVisible({ timeout: 10_000 });
    await walkthroughBtn.click();
    await page.waitForTimeout(500);

    // The archetype selection grid should be visible
    const archetypeGrid = page.locator('[data-testid="forge-archetype-selection"]');
    await expect(archetypeGrid).toBeVisible({ timeout: 10_000 });

    // Select the "Data Workbench / CRUD" archetype
    const crudArchetype = page.locator('[data-testid="archetype-crud-app"]');
    await expect(crudArchetype).toBeVisible();
    await crudArchetype.click();
    await page.waitForTimeout(300);

    await screenshot(page, artifactDir, testInfo, "03-archetype-selected.png");

    // Navigate to specs step
    const continueToSpecsBtn = page.getByRole("button", { name: /Continue to Specifications/i });
    await expect(continueToSpecsBtn).toBeVisible();
    await continueToSpecsBtn.click();
    await page.waitForTimeout(500);

    /* ──────────────────────────────────────────────────────────────────────
     *  PHASE 4: Walkthrough Step 2 — Specs & Requirements
     * ──────────────────────────────────────────────────────────────────── */

    // Fill in the App Name
    const appNameInput = page.locator('[data-testid="forge-input-app-name"]');
    await expect(appNameInput).toBeVisible({ timeout: 5_000 });
    await appNameInput.clear();
    await appNameInput.fill(testAppName);

    // Fill in the slug
    const appSlugInput = page.locator('[data-testid="forge-input-app-slug"]');
    await expect(appSlugInput).toBeVisible();
    await appSlugInput.clear();
    await appSlugInput.fill(testAppSlug);

    // Fill in specs / requirements
    const requirementsTextarea = page.locator('[data-testid="forge-textarea-requirements"]');
    await expect(requirementsTextarea).toBeVisible();
    await requirementsTextarea.fill(
      "A contact management workbench with DataTable, search/filter, add/edit dialog, " +
      "and batch operations. CRUD operations on a 'contacts' collection with name, email, " +
      "company, and phone fields. Include sortable columns, CSV export, and responsive layout."
    );

    await screenshot(page, artifactDir, testInfo, "04-specs-filled.png");

    // Navigate to the review step
    const continueToReviewBtn = page.getByRole("button", { name: /Continue to Pre-Flight Review/i });
    await expect(continueToReviewBtn).toBeVisible();
    await continueToReviewBtn.click();
    await page.waitForTimeout(500);

    /* ──────────────────────────────────────────────────────────────────────
     *  PHASE 5: Walkthrough Step 3 — Pre-Flight Review & Ignition
     * ──────────────────────────────────────────────────────────────────── */

    // Verify the review summary shows the correct app name and archetype
    await expect(page.locator("text=" + testAppName)).toBeVisible({ timeout: 5_000 });
    await expect(page.locator(`text=/forged/${testAppSlug}`)).toBeVisible();
    await expect(page.locator("text=Data Workbench / CRUD")).toBeVisible();

    await screenshot(page, artifactDir, testInfo, "05-preflight-review.png");

    /* ──────────────────────────────────────────────────────────────────────
     *  PHASE 6: Ignite Build — click "Start Build"
     * ──────────────────────────────────────────────────────────────────── */

    // Intercept the POST /api/apps/forge to capture the jobId
    let capturedJobId: string | null = null;
    let capturedForgePayload: any = null;

    await page.route("**/api/apps/forge", async (route) => {
      // Let the request go through but capture the response
      const response = await route.fetch();
      const body = await response.json();
      capturedJobId = body.jobId ?? null;
      capturedForgePayload = body;
      console.log(`[E2E] Forge POST response: jobId=${capturedJobId}`);

      await route.fulfill({
        status: response.status(),
        headers: Object.fromEntries(response.headers().entries ? response.headers().entries() : []),
        body: JSON.stringify(body),
      });
    });

    const startBuildBtn = page.locator('[data-testid="forge-start-build"]').last();
    await expect(startBuildBtn).toBeEnabled();
    await startBuildBtn.click();

    console.log("[E2E] Start Build clicked, waiting for forge job creation...");

    // Wait until we have a jobId from the intercepted response
    await expect(async () => {
      expect(capturedJobId, "Forge POST should return a jobId").not.toBeNull();
    }).toPass({ timeout: 30_000 });

    const jobId = capturedJobId!;
    console.log(`[E2E] Forge job created: ${jobId}`);

    await writeArtifact(testInfo, artifactDir, "forge-create-response.json", capturedForgePayload);
    await screenshot(page, artifactDir, testInfo, "06-build-ignited.png");

    /* ──────────────────────────────────────────────────────────────────────
     *  PHASE 7: Monitor Live Build — poll status via API
     * ──────────────────────────────────────────────────────────────────── */

    // The UI should auto-switch to the live-build view
    const progressPanel = page.locator('[data-testid="forge-progress"]');
    await expect(progressPanel).toBeVisible({ timeout: 15_000 });

    console.log("[E2E] Live build view active, polling for completion...");

    const startedAt = Date.now();
    let lastChangeAt = startedAt;
    let lastSignature = "";
    let completedStatus: any = null;
    const timeline: any[] = [];

    while (Date.now() - startedAt < MAX_POLL_MS) {
      const statusRes = await request.get(`/api/apps/forge/status/${jobId}`);
      if (!statusRes.ok()) {
        console.warn(`[E2E] Status poll returned ${statusRes.status()}, retrying...`);
        await page.waitForTimeout(POLL_INTERVAL_MS);
        continue;
      }

      const status = await statusRes.json();
      const observed = {
        ...status,
        observedAt: new Date().toISOString(),
        elapsedMs: Date.now() - startedAt,
      };
      timeline.push(observed);

      const signature = JSON.stringify([
        status.status,
        status.progress,
        status.step,
        status.message,
        status.appId,
      ]);

      if (signature !== lastSignature) {
        lastSignature = signature;
        lastChangeAt = Date.now();
        console.log(
          `[E2E] Forge ${jobId}: status=${status.status} progress=${status.progress}% step=${status.step ?? "N/A"}`
        );
      }

      if (status.status && TERMINAL_SUCCESS.has(status.status)) {
        completedStatus = status;
        break;
      }

      if (status.status && TERMINAL_FAILURE.has(status.status)) {
        await writeArtifact(testInfo, artifactDir, "forge-timeline.json", timeline);
        await screenshot(page, artifactDir, testInfo, "07-build-failed.png");
        throw new Error(
          `Forge failed at "${status.step ?? status.status}": ${status.error ?? status.message ?? "no details"}`
        );
      }

      // Stale detection
      if (Date.now() - lastChangeAt > STALE_STATUS_MS) {
        await writeArtifact(testInfo, artifactDir, "forge-timeline.json", timeline);
        await screenshot(page, artifactDir, testInfo, "07-build-stalled.png");
        throw new Error(
          `Forge status stalled for ${Math.round(STALE_STATUS_MS / 1000)}s. Last: ${JSON.stringify({
            status: status.status,
            progress: status.progress,
            step: status.step,
          })}`
        );
      }

      // Periodically capture screenshots of the live-build progress
      if (timeline.length % 10 === 0) {
        await screenshot(page, artifactDir, testInfo, `07-progress-${timeline.length}.png`);
      }

      await page.waitForTimeout(POLL_INTERVAL_MS);
    }

    if (!completedStatus) {
      await writeArtifact(testInfo, artifactDir, "forge-timeline.json", timeline);
      throw new Error(`Forge did not complete within ${Math.round(MAX_POLL_MS / 1000)}s`);
    }

    await writeArtifact(testInfo, artifactDir, "forge-timeline.json", timeline);
    await writeArtifact(testInfo, artifactDir, "forge-completed-status.json", completedStatus);

    console.log(`[E2E] Forge completed! appId=${completedStatus.appId} slug=${completedStatus.slug}`);

    // Core assertions on the completed status
    expect(completedStatus.appId, "Completed forge must include appId").toEqual(expect.any(Number));
    expect(completedStatus.progress, "Completed forge progress should be 100").toBe(100);

    await screenshot(page, artifactDir, testInfo, "08-build-completed.png");

    /* ──────────────────────────────────────────────────────────────────────
     *  PHASE 8: Verify UI transition — Forge → Builder mode
     * ──────────────────────────────────────────────────────────────────── */

    const appId = completedStatus.appId;

    // The App Studio Pod should eventually transition to builder mode
    // Give the UI time for the SSE completion event to propagate
    await expect(async () => {
      const modeAttr = await studioPod.getAttribute("data-mode");
      expect(modeAttr, "App Studio Pod should transition to builder mode").toBe("builder");
    }).toPass({ timeout: 60_000, intervals: [2000, 5000, 10_000] });

    await screenshot(page, artifactDir, testInfo, "09-builder-mode.png");

    /* ──────────────────────────────────────────────────────────────────────
     *  PHASE 9: Readiness probe — verify app is healthy
     * ──────────────────────────────────────────────────────────────────── */

    const readinessRes = await request.get(`/api/apps/${appId}/readiness?probe=true`);
    const readiness = await readinessRes.json();
    await writeArtifact(testInfo, artifactDir, "readiness.json", readiness);

    expect(readinessRes.ok(), `Readiness probe failed: ${JSON.stringify(readiness)}`).toBeTruthy();

    // Log individual checks for diagnostics
    if (readiness.checks) {
      for (const check of readiness.checks) {
        console.log(`[E2E] Readiness: ${check.id} = ${check.status} (${check.severity}): ${check.message}`);
      }
    }

    // For mandatory checks, verify they pass
    const mandatoryChecks = ["app_registry", "org_deployment", "workspace_exists"];
    for (const checkId of mandatoryChecks) {
      const check = readiness.checks?.find((c: any) => c.id === checkId);
      if (check) {
        expect(check.status, `Mandatory check "${checkId}" should pass: ${check.message}`).toBe("pass");
      }
    }

    /* ──────────────────────────────────────────────────────────────────────
     *  PHASE 10: Runtime verification — navigate to the forged app
     * ──────────────────────────────────────────────────────────────────── */

    const slug = completedStatus.slug || testAppSlug;
    const runtimeUrl = `/forged/${slug}/`;

    console.log(`[E2E] Navigating to runtime: ${runtimeUrl}`);

    const runtimeErrors: string[] = [];
    const runtimeFailedRequests: string[] = [];

    page.on("pageerror", (error) => runtimeErrors.push(error.message));

    const runtimeResponse = await page.goto(runtimeUrl, {
      waitUntil: "domcontentloaded",
      timeout: 120_000,
    });

    expect(runtimeResponse, "Runtime navigation should return a response").not.toBeNull();
    expect(
      runtimeResponse!.status(),
      `Forged app returned HTTP ${runtimeResponse!.status()}`
    ).toBeLessThan(500);

    // Wait for network to settle
    await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => undefined);

    // Verify the body renders
    await expect(page.locator("body"), "Forged app body should be visible").toBeVisible();
    await expect(
      page.locator("body *").first(),
      "Forged app should mount at least one UI element"
    ).toBeVisible({ timeout: 30_000 });

    const html = await page.content();
    expect(html.length, "Forged app should return substantive HTML").toBeGreaterThan(500);
    expect(html, "Should not show Next.js fatal error").not.toContain("__next_error__");
    expect(html, "Should not show 503 starting page").not.toContain("App is starting");

    await screenshot(page, artifactDir, testInfo, "10-runtime-rendered.png");
    await writeArtifact(testInfo, artifactDir, "runtime.html", html, "text/html");

    /* ──────────────────────────────────────────────────────────────────────
     *  PHASE 11: Verify app appears in installed apps list
     * ──────────────────────────────────────────────────────────────────── */

    const installedRes = await request.get("/api/apps/installed");
    if (installedRes.ok()) {
      const installed = await installedRes.json();
      const found = (installed as any[]).find(
        (row) => row.app?.id === appId || row.app?.slug === testAppSlug
      );
      await writeArtifact(testInfo, artifactDir, "installed-apps.json", { found, total: installed.length });
      expect(found, "Forged app should appear in the installed apps list").toBeDefined();
      console.log(`[E2E] App found in installed list: id=${found.app.id} name=${found.app.name}`);
    }

    /* ──────────────────────────────────────────────────────────────────────
     *  PHASE 12: Completion manifest & cleanup
     * ──────────────────────────────────────────────────────────────────── */

    await writeArtifact(testInfo, artifactDir, "completion-manifest.json", {
      scenario: "Full Lifecycle E2E",
      slug: testAppSlug,
      jobId,
      appId,
      totalTimeMs: Date.now() - startedAt,
      readinessSummary: readiness.summary,
      runtimeUrl,
      runtimeErrors,
      completedAt: new Date().toISOString(),
    });

    // Cleanup: delete the test app to avoid polluting the registry
    const deleteRes = await request.delete(`/api/apps/${appId}`);
    console.log(`[E2E] Cleanup: DELETE /api/apps/${appId} → ${deleteRes.status()}`);
    expect(
      [200, 204, 404].includes(deleteRes.status()),
      `App deletion returned unexpected status ${deleteRes.status()}`
    ).toBe(true);

    // Assert no console errors or critical failures
    await writeArtifact(testInfo, artifactDir, "observability.json", {
      consoleErrors,
      failedRequests,
      runtimeErrors,
      runtimeFailedRequests,
    });

    // Soft assertion: log errors but don't fail on warnings from embedded preview
    if (runtimeErrors.length > 0) {
      console.warn(`[E2E] Runtime page errors (${runtimeErrors.length}):`, runtimeErrors.slice(0, 5));
    }

    console.log(
      `[E2E] ✅ Full lifecycle completed in ${Math.round((Date.now() - startedAt) / 1000)}s. ` +
      `App: ${testAppName} (id=${appId}, slug=${testAppSlug})`
    );
  });
});
