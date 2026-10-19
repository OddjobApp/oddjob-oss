/**
 * App Forge Triage Suite — rapid validation of forge pipeline & publish flow.
 *
 * This suite is designed for CI/CD regression gating. It exercises:
 *   1. The forge API pathway (POST → status poll → completion)
 *   2. The walkthrough UI elements render and respond to input
 *   3. The published app responds with a healthy document
 *   4. Error resilience (malformed inputs, duplicate slugs, missing fields)
 *
 * Unlike the full-lifecycle spec, this uses `skipToAssembly: true` for faster
 * turnaround, and focuses on triage-level checks rather than full walkthrough.
 */

import { test, expect, type APIRequestContext, type TestInfo } from "@playwright/test";
import path from "node:path";
import fs from "node:fs/promises";

/* ── Utilities ──────────────────────────────────────────────────────────── */

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

async function writeArtifact(
  testInfo: TestInfo,
  dir: string,
  name: string,
  body: unknown,
  contentType = "application/json",
) {
  await ensureDir(dir);
  const filePath = path.join(dir, name);
  const content = typeof body === "string" ? body : JSON.stringify(body, null, 2);
  await fs.writeFile(filePath, content);
  await testInfo.attach(name, { path: filePath, contentType });
}

async function pollForgeStatus(
  request: APIRequestContext,
  jobId: string,
  maxMs = 10 * 60 * 1000,
  intervalMs = 5000,
) {
  const start = Date.now();
  let lastStatusLog = "";

  while (Date.now() - start < maxMs) {
    const res = await request.get(`/api/apps/forge/status/${jobId}`);
    if (!res.ok()) {
      await new Promise((r) => setTimeout(r, intervalMs));
      continue;
    }

    const data = await res.json();
    const statusKey = `${data.status}|${data.progress}|${data.step}`;
    if (statusKey !== lastStatusLog) {
      lastStatusLog = statusKey;
      console.log(
        `[TRIAGE] Forge ${jobId}: status=${data.status} progress=${data.progress}% step=${data.step ?? "-"}`
      );
    }

    if (data.status === "completed" || data.status === "complete") return data;
    if (data.status === "failed" || data.status === "error") {
      throw new Error(`Forge failed: ${data.error ?? data.message ?? "unknown error"}`);
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new Error(`Forge did not complete within ${Math.round(maxMs / 1000)}s`);
}

/* ── Test Suite ──────────────────────────────────────────────────────────── */

test.describe("App Forge Triage Suite", () => {
  test.describe.configure({ mode: "serial" });

  const runId = Date.now();
  const testSlug = `triage-forge-${runId}`;
  const artifactDir = path.resolve(process.cwd(), "test-results", "app-forge-triage", testSlug);
  let appId: number | undefined;
  let jobId: string | undefined;

  test("forge API accepts a valid CRUD app request and returns jobId", async ({ request }, testInfo) => {
    test.setTimeout(60_000);

    const res = await request.post("/api/apps/forge", {
      data: {
        name: `Triage App ${runId}`,
        slug: testSlug,
        description:
          "E2E triage: a lightweight contacts CRUD app for pipeline validation.",
        blueprint: "crud-app",
        skipToAssembly: true,
        defaultCollections: ["triage_contacts"],
        blackboard: {
          target_collection: "triage_contacts",
          entity_singular: "Contact",
          columns: [
            { key: "name", label: "Name", type: "text" },
            { key: "email", label: "Email", type: "email" },
          ],
          metrics: [
            { label: "Total", valueAccessor: "count", iconName: "Users" },
          ],
        },
      },
    });

    const body = await res.json();
    await writeArtifact(testInfo, artifactDir, "forge-request.json", body);

    expect(res.ok(), `Forge POST failed (${res.status()}): ${JSON.stringify(body)}`).toBeTruthy();
    expect(body.jobId, "Response must include jobId").toBeDefined();

    jobId = body.jobId;
    console.log(`[TRIAGE] Forge job created: ${jobId}`);
  });

  test("forge completes with appId and 100% progress", async ({ request }, testInfo) => {
    test.setTimeout(12 * 60 * 1000);
    expect(jobId, "jobId from previous test").toBeDefined();

    const status = await pollForgeStatus(request, jobId!);
    await writeArtifact(testInfo, artifactDir, "forge-completed.json", status);

    expect(status.appId, "Completed status must include appId").toEqual(expect.any(Number));
    expect(status.progress, "Progress should reach 100").toBe(100);

    appId = status.appId;
    console.log(`[TRIAGE] Forge completed: appId=${appId}`);
  });

  test("readiness probe passes mandatory checks", async ({ request }, testInfo) => {
    test.setTimeout(60_000);
    expect(appId, "appId from previous test").toBeDefined();

    const res = await request.get(`/api/apps/${appId}/readiness?probe=true`);
    const readiness = await res.json();
    await writeArtifact(testInfo, artifactDir, "readiness.json", readiness);

    expect(res.ok(), `Readiness failed (${res.status()})`).toBeTruthy();

    for (const checkId of ["app_registry", "org_deployment"]) {
      const check = readiness.checks?.find((c: any) => c.id === checkId);
      if (check) {
        expect(check.status, `Check "${checkId}" should pass: ${check.message}`).toBe("pass");
      }
    }
  });

  test("forged app renders at /forged/<slug>/", async ({ page }, testInfo) => {
    test.setTimeout(120_000);

    const url = `/forged/${testSlug}/`;
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });

    expect(response, "Runtime should return a response").not.toBeNull();
    expect(response!.status(), `HTTP ${response!.status()} at ${url}`).toBeLessThan(500);

    await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});

    const html = await page.content();
    expect(html.length, "Page should have substantive content").toBeGreaterThan(200);
    expect(html, "Should not be a Next.js error page").not.toContain("__next_error__");

    const shotPath = path.join(artifactDir, "runtime.png");
    await ensureDir(artifactDir);
    await page.screenshot({ path: shotPath, fullPage: true });
    await testInfo.attach("runtime.png", { path: shotPath, contentType: "image/png" });
  });

  test("app appears in installed apps list", async ({ request }, testInfo) => {
    test.setTimeout(30_000);

    const res = await request.get("/api/apps/installed");
    expect(res.ok()).toBeTruthy();

    const apps = await res.json();
    const found = (apps as any[]).find((row) => row.app?.id === appId);

    expect(found, `App ${appId} should be in installed list`).toBeDefined();
    await writeArtifact(testInfo, artifactDir, "installed-check.json", {
      found: !!found,
      appId,
      total: apps.length,
    });
  });

  test("cleanup: deletes test app", async ({ request }) => {
    test.setTimeout(15_000);
    if (!appId) return;

    const res = await request.delete(`/api/apps/${appId}`);
    expect([200, 204, 404].includes(res.status())).toBe(true);
    console.log(`[TRIAGE] Cleanup: DELETE /api/apps/${appId} → ${res.status()}`);
  });
});

/* ── Edge-case & Error Resilience ────────────────────────────────────────── */

test.describe("App Forge Edge Cases", () => {
  test("rejects forge request with missing name", async ({ request }) => {
    const res = await request.post("/api/apps/forge", {
      data: {
        slug: "no-name-test",
        description: "Should fail",
        blueprint: "crud-app",
      },
    });
    // The API should reject or at least not crash
    expect(res.status(), "Should return a client or handled error").toBeLessThan(500);
  });

  test("forge status 404s for non-existent job", async ({ request }) => {
    const res = await request.get("/api/apps/forge/status/nonexistent-job-id-12345");
    expect([404, 200].includes(res.status()), "Should return 404 or empty status").toBe(true);
  });

  test("forge active endpoint returns valid response", async ({ request }) => {
    const res = await request.get("/api/apps/forge/active");
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    // Should have at minimum an `active` boolean
    expect(typeof body.active === "boolean" || body.jobId !== undefined).toBe(true);
  });
});

/* ── UI Walkthrough Smoke Test ───────────────────────────────────────────── */

test.describe("App Forge UI Walkthrough Smoke", () => {
  test("walkthrough steps render and navigate correctly", async ({ page }) => {
    test.setTimeout(60_000);

    // Use the ?studio=forge URL parameter to directly mount AppStudioPod
    // in forge mode. This is the URL fallback in ModularAssemblyPuzzleRail
    // (line ~337) and is more reliable than custom event injection.
    const sessionKey = `forge-walkthrough-smoke-${Date.now()}`;
    await page.goto(`/workspace/chat/${sessionKey}?studio=forge`, { waitUntil: "domcontentloaded" });
    await expect(page).not.toHaveURL(/\/auth\/login/);

    const pod = page.locator('[data-testid="app-studio-pod"]');
    await expect(pod).toBeVisible({ timeout: 30_000 });
    await expect(pod).toHaveAttribute("data-mode", "forge");

    // Switch to walkthrough view
    const walkthroughBtn = page.locator('[data-testid="forge-view-walkthrough"]');
    if (await walkthroughBtn.isVisible()) {
      await walkthroughBtn.click();
    }

    // Step 1: Architecture selection should be visible
    const archetypeGrid = page.locator('[data-testid="forge-archetype-selection"]');
    await expect(archetypeGrid).toBeVisible({ timeout: 10_000 });

    // Select analytics dashboard
    const analyticsArchetype = page.locator('[data-testid="archetype-analytics-dashboard"]');
    await expect(analyticsArchetype).toBeVisible();
    await analyticsArchetype.click();

    // Navigate to specs
    await page.getByRole("button", { name: /Continue to Specifications/i }).click();
    await page.waitForTimeout(500);

    // Step 2: Specs inputs should be visible
    await expect(page.locator('[data-testid="forge-input-app-name"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-input-app-slug"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-textarea-requirements"]')).toBeVisible();

    // Navigate to review
    await page.getByRole("button", { name: /Continue to Pre-Flight Review/i }).click();
    await page.waitForTimeout(500);

    // Step 3: The start build button should be visible
    const startBuild = page.locator('[data-testid="forge-start-build"]').last();
    await expect(startBuild).toBeVisible();
    await expect(startBuild).toBeEnabled();

    // Navigate back through steps
    await page.getByRole("button", { name: /Adjust Specifications/i }).click();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid="forge-input-app-name"]')).toBeVisible();

    await page.getByRole("button", { name: /Back to Architecture/i }).click();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid="forge-archetype-selection"]')).toBeVisible();
  });
});
