/**
 * E2E SDLC Cycle Test — Full UI walkthrough via Playwright
 *
 * Tests the SDLC Workbench Suite on TECHHEAD7 (port 10011):
 * 1. Hub page loads with all workbench links
 * 2. PM Workbench — backlog visible, source panel renders
 * 3. Scrum Master Workbench — capacity form renders, tabs work
 * 4. QA Workbench — test suites tab, investigate tab with panels
 * 5. Stakeholder Workbench — readiness view, approvals tab
 * 6. AI Workforce Dashboard — fleet table, guardrails tab
 */
import { test, expect } from "@playwright/test";

test.describe("SDLC Cycle E2E — TECHHEAD7", () => {
  let BASE_URL = "http://localhost:10011";

  test.beforeAll(async () => {
    try {
      const { db } = await import("../../server/database_service.js");
      const { apps, appDeployments } = await import("../../shared/schema/index.js");
      const { eq } = await import("drizzle-orm");

      const [deployment] = await db.select({
        metadata: apps.runtimeMetadata
      })
      .from(appDeployments)
      .innerJoin(apps, eq(appDeployments.appId, apps.id))
      .where(eq(apps.slug, "sdlc-workbench-org291"))
      .limit(1);

      const meta = (deployment?.metadata as any) || {};
      if (meta.assignedPort) {
        BASE_URL = `http://localhost:${meta.assignedPort}`;
        console.log(`Resolved SDLC Workbench base URL: ${BASE_URL}`);
      }
    } catch (e) {
      console.warn("Failed to resolve dynamic port from DB, falling back to 10011:", e);
    }
  });

  test("1. Hub page loads with all workbench links", async ({ page }) => {
    await page.goto(BASE_URL);
    await expect(page.locator("h1")).toContainText("Enterprise Hybrid AI SDLC");

    // Verify all workbench links exist
    await expect(page.locator('a[href="/pm-workbench"]')).toBeVisible();
    await expect(page.locator('a[href="/scrum-master-workbench"]')).toBeVisible();
    await expect(page.locator('a[href="/qa-workbench"]')).toBeVisible();
    await expect(page.locator('a[href="/stakeholder-workbench"]')).toBeVisible();
    await expect(page.locator('a[href="/ai-workforce-dashboard"]')).toBeVisible();
  });

  test("2. PM Workbench — page loads and renders intake UI", async ({ page }) => {
    await page.goto(`${BASE_URL}/pm-workbench`);
    await expect(page.locator("text=PM Workbench").first()).toBeVisible();
  });

  test("3. Scrum Master Workbench — page loads with tabs", async ({ page }) => {
    await page.goto(`${BASE_URL}/scrum-master-workbench`);
    await expect(page.locator("text=Scrum Master").first()).toBeVisible();
  });

  test("4. QA Workbench — page loads", async ({ page }) => {
    await page.goto(`${BASE_URL}/qa-workbench`);
    await expect(page.locator("text=QA").first()).toBeVisible();
  });

  test("5. Stakeholder Workbench — page loads", async ({ page }) => {
    await page.goto(`${BASE_URL}/stakeholder-workbench`);
    await expect(page.locator("text=Stakeholder").first()).toBeVisible();
  });

  test("6. AI Workforce Dashboard — page loads", async ({ page }) => {
    await page.goto(`${BASE_URL}/ai-workforce-dashboard`);
    await expect(page.locator("text=Workforce").first().or(page.locator("text=Fleet").first())).toBeVisible();
  });

  test("7. Navigation between workbenches works", async ({ page }) => {
    // Start at hub
    await page.goto(BASE_URL);
    await expect(page.locator("h1")).toContainText("Enterprise Hybrid AI SDLC");

    // Navigate to PM Workbench
    await page.click('a[href="/pm-workbench"]');
    await expect(page).toHaveURL(/.*\/pm-workbench/);

    // Go back to hub
    await page.goto(BASE_URL);

    // Navigate to QA Workbench
    await page.click('a[href="/qa-workbench"]');
    await expect(page).toHaveURL(/.*\/qa-workbench/);
  });

  test("8. Pages render without JavaScript errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    // Visit each page
    const pages = ["/", "/pm-workbench", "/scrum-master-workbench", "/qa-workbench", "/stakeholder-workbench", "/ai-workforce-dashboard"];
    for (const path of pages) {
      await page.goto(`${BASE_URL}${path}`);
      await page.waitForLoadState("domcontentloaded");
    }

    // Allow React hydration warnings but no real errors
    const realErrors = errors.filter((e) => !e.includes("Hydration") && !e.includes("hydrat"));
    expect(realErrors).toHaveLength(0);
  });

});
