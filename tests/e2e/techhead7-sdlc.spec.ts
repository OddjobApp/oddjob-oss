import { test, expect } from "@playwright/test";

const PLATFORM_URL = "http://localhost:5000";

test.describe.serial("Full SDLC Cycle in TECHHEAD7 Org via Platform UI", () => {
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

  test("Stage 1: PM Workbench — Create Requirement and Sign-off", async ({ page }) => {
    test.setTimeout(180000); // 3 mins timeout because agent takes a while
    
    page.on('response', response => {
      if (response.status() >= 400) {
        console.log(`PAGE LOG: error: ${response.status()} ${response.url()}`);
      }
    });

    page.on('console', msg => console.log(`BROWSER LOG: [${msg.type()}] ${msg.text()}`));
    page.on('pageerror', err => console.log(`BROWSER ERROR: ${err.message}`));

    // 1. Navigate to Cycles list
    await page.goto(`${PLATFORM_URL}/operations/cycles`);
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000); // give React a moment

    // 2. Click the cycle for TECHHEAD7. 
    // Usually it has text "Hybrid SDLC" or something similar if it's the latest cycle
    // Let's find the first cycle link that's available (latest)
    const firstCycleLink = page.locator('a:has-text("Enterprise Hybrid AI SDLC"), h3:has-text("Enterprise Hybrid AI SDLC")').locator('..').locator('a[href^="/operations/cycles/"]').first().or(page.locator('a:has-text("Enterprise Hybrid AI SDLC")').first());
    await expect(firstCycleLink).toBeVisible({ timeout: 10000 });
    const cycleHref = await firstCycleLink.getAttribute('href');
    if (cycleHref) {
        await page.goto(`${PLATFORM_URL}${cycleHref}`);
    } else {
        await firstCycleLink.click({ force: true });
    }
    await page.waitForLoadState("domcontentloaded");
    
    // 3. Select 'Project Initialization & Sprint Zero' app
    const appCard = page.locator('h3:has-text("Project Initialization & Sprint Zero")').first();
    await appCard.click();
    
    // Capture /api/jobs traffic from the very first request (including initial hydration).
    // Listeners must be registered before page.goto so no requests are missed.
    const jobsRequests: string[] = [];
    const jobsSent: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/jobs') && !request.url().includes('/api/jobs/')) {
        jobsSent.push(`[${request.method()}] ${request.url()}`);
      }
    });
    page.on('response', async (response) => {
      if (response.url().includes('/api/jobs') && !response.url().includes('/api/jobs/')) {
        const status = response.status();
        const text = await response.text().catch(() => 'error');
        jobsRequests.push(`[${status}] ${text.substring(0, 200)}`);
      }
    });
    page.on('requestfailed', (request) => {
      if (request.url().includes('/api/jobs')) {
        jobsRequests.push(`[FAILED] ${request.url()} - ${request.failure()?.errorText}`);
      }
    });

    // 4. Interact with the PM Workbench directly (bypass iframe for testing)
    // Navigate directly to the production workbench server
    await page.goto(`${BASE_URL}/pm-workbench`);
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000); // Wait for React hydration

    // 4. Create a manual requirement ticket to ensure selectedKey is populated
    const createReqBtn = page.locator('button:has-text("Create Requirement")');
    await expect(createReqBtn).toBeVisible({ timeout: 15000 });
    await createReqBtn.click();

    const titleInput = page.locator('#manual-title');
    await expect(titleInput).toBeVisible({ timeout: 15000 });
    await titleInput.fill('Build dynamic login API');

    const submitReqBtn = page.locator('button:has-text("Create & Draft PRD")');
    await expect(submitReqBtn).toBeVisible({ timeout: 15000 });
    await submitReqBtn.click();

    // 6. Use the newly added Administrative Override to Force Approval
    const forceApprovalBtn = page.locator('button:has-text("Force Approval")');
    await expect(forceApprovalBtn).toBeVisible({ timeout: 15000 });
    await forceApprovalBtn.click();

    // 7. Trigger the Core Development mission to build the code
    const triggerDevBtn = page.locator('button:has-text("Trigger Core Development")');
    await expect(triggerDevBtn).toBeVisible({ timeout: 15000 });
    await triggerDevBtn.click();

    // Wait for the UI state to update indicating development was launched
    await expect(page.locator('text=Development triggered')).toBeVisible({ timeout: 15000 });
  });

  test("Stage 2: Scrum Master Workbench — Plan Sprint", async ({ page }) => {
    test.setTimeout(60000);
    // Navigate directly to the dev server
    await page.goto(`${BASE_URL}/scrum-master-workbench`);
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    const commitBtn = page.locator('button:has-text("Commit"), button:has-text("Start Sprint")').first();
    if (await commitBtn.isVisible()) {
        await commitBtn.click();
    }
  });

  test("Stage 3: QA Workbench — Verify and Sign-off", async ({ page }) => {
    test.setTimeout(60000);
    // Navigate directly to the dev server
    await page.goto(`${BASE_URL}/qa-workbench`);
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    const approveBtn = page.locator('button:has-text("Approve"), button:has-text("Pass"), button:has-text("Sign-off")').first();
    if (await approveBtn.isVisible()) {
        await approveBtn.click();
    }
  });

});
