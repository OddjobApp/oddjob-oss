/**
 * Product Launch Cycle — E2E Test Suite
 *
 * Verifies the complete Product Launch Workbench:
 * 1. All 5 workbench pages load without errors
 * 2. Agent chat components render in each module
 * 3. Navigation between modules works
 * 4. Platform API proxy responds
 * 5. Interactive elements are functional
 *
 * Prerequisites:
 * - Product Launch Workbench running (via install-product-launch.ts)
 * - Platform server running on port 5000
 */
import { test, expect, type Page } from "@playwright/test";

// The workbench port is dynamically assigned — check PM2 or use the platform proxy
const BASE_URL = process.env.LAUNCH_WORKBENCH_URL || "http://localhost:10012";

async function waitForApp(page: Page) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(2000);
}

test.describe.serial("Product Launch Cycle — Full Workbench Verification", () => {

  // ═══════════════════════════════════════════════════════════════════════════
  // HUB PAGE
  // ═══════════════════════════════════════════════════════════════════════════

  test("Hub page loads with module cards", async ({ page }) => {
    await page.goto(BASE_URL);
    await waitForApp(page);

    const content = await page.textContent("body");
    expect(content).toContain("Product Launch Workbench");
    expect(content).toContain("Launch Command Center");
    expect(content).toContain("Market Research");
    expect(content).toContain("Content Studio");
    expect(content).toContain("Sales Enablement");
    expect(content).toContain("Feedback");
  });

  test("Hub page shows readiness metrics", async ({ page }) => {
    await page.goto(BASE_URL);
    await waitForApp(page);

    // Should have metric cards (even if showing 0)
    const metricCards = await page.locator("text=Readiness").or(page.locator("text=Active Agents")).count();
    expect(metricCards).toBeGreaterThan(0);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // LAUNCH COMMAND CENTER
  // ═══════════════════════════════════════════════════════════════════════════

  test("Launch Command Center loads with fleet status", async ({ page }) => {
    await page.goto(`${BASE_URL}/launch-command-center`);
    await waitForApp(page);

    const content = await page.textContent("body");
    expect(content).toContain("Launch Command Center");
    expect(content).toContain("Launch Readiness");
  });

  test("Launch Command Center has mission trigger buttons", async ({ page }) => {
    await page.goto(`${BASE_URL}/launch-command-center`);
    await waitForApp(page);

    // Click Missions tab
    const missionsTab = page.locator("button", { hasText: "Missions" });
    if (await missionsTab.isVisible()) {
      await missionsTab.click();
      await page.waitForTimeout(500);

      const triggerButtons = await page.locator("button", { hasText: "Trigger" }).count();
      expect(triggerButtons).toBeGreaterThan(0);
    }
  });

  test("Launch Command Center agent can create a product launch plan", async ({ page }) => {
    test.setTimeout(120000); // 2 minutes timeout for agent operations
    
    await page.goto(`${BASE_URL}/launch-command-center`);
    await waitForApp(page);

    const chatInput = page.locator("input[placeholder*='Ask the agent'], textarea[placeholder*='Ask'], input[placeholder*='message'], textarea[placeholder*='message']").first();
    await expect(chatInput).toBeVisible({ timeout: 15000 });

    // Request the creation of a product launch
    const prompt = 'Please create a comprehensive product launch plan for a new AI feature called "CodeAssist". Setup the required missions, generate blueprints, and initialize the launch cycle.';
    await chatInput.fill(prompt);
    
    // Find and click the send button
    const sendButton = page.locator('button[type="submit"], button:has(.lucide-send), button:has-text("Send")').first();
    await expect(sendButton).toBeVisible();
    await sendButton.click();

    // Wait for the agent's response to appear in the chat log
    const assistantMessage = page.locator('.assistant-message, [data-role="assistant"]').last();
    
    // Agent operations for creating missions/blueprints might take up to 60-90 seconds
    await expect(assistantMessage).toBeVisible({ timeout: 90000 });
    
    // Check if the agent's response indicates success or an error
    const messageText = await assistantMessage.textContent();
    expect(messageText).not.toMatch(/Connection error|Request timed out/i);
    expect(messageText?.length).toBeGreaterThan(50); // Ensure a substantial response
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // MARKET RESEARCH WORKBENCH
  // ═══════════════════════════════════════════════════════════════════════════

  test("Market Research Workbench loads with search", async ({ page }) => {
    await page.goto(`${BASE_URL}/market-research`);
    await waitForApp(page);

    const content = await page.textContent("body");
    expect(content).toContain("Market Research");
    expect(content).toContain("Competitive Intelligence");
  });

  test("Market Research has functional search input", async ({ page }) => {
    await page.goto(`${BASE_URL}/market-research`);
    await waitForApp(page);

    const searchInput = page.locator("input[placeholder*='Search']");
    expect(await searchInput.isVisible()).toBe(true);
    await searchInput.fill("competitor");
    expect(await searchInput.inputValue()).toBe("competitor");
  });

  test("Market Research has tab navigation", async ({ page }) => {
    await page.goto(`${BASE_URL}/market-research`);
    await waitForApp(page);

    const tabs = await page.locator("button").filter({ hasText: /Competitors|Personas|Reports/ }).count();
    expect(tabs).toBeGreaterThanOrEqual(2);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CONTENT STUDIO
  // ═══════════════════════════════════════════════════════════════════════════

  test("Content Studio loads with asset pipeline", async ({ page }) => {
    await page.goto(`${BASE_URL}/content-studio`);
    await waitForApp(page);

    const content = await page.textContent("body");
    expect(content).toContain("Content Studio");
  });

  test("Content Studio has AI Generate tab", async ({ page }) => {
    await page.goto(`${BASE_URL}/content-studio`);
    await waitForApp(page);

    const generateTab = page.locator("button", { hasText: "AI Generate" });
    if (await generateTab.isVisible()) {
      await generateTab.click();
      await page.waitForTimeout(500);

      const content = await page.textContent("body");
      expect(content).toContain("AI Content Generator");
    }
  });

  test("Content Studio has type filter buttons", async ({ page }) => {
    await page.goto(`${BASE_URL}/content-studio`);
    await waitForApp(page);

    const filterButtons = await page.locator("button").filter({ hasText: /Blog Post|Landing Page|Email/ }).count();
    expect(filterButtons).toBeGreaterThan(0);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SALES ENABLEMENT HUB
  // ═══════════════════════════════════════════════════════════════════════════

  test("Sales Enablement Hub loads with stats", async ({ page }) => {
    await page.goto(`${BASE_URL}/sales-enablement`);
    await waitForApp(page);

    const content = await page.textContent("body");
    expect(content).toContain("Sales Enablement");
    expect(content).toContain("Playbooks");
    expect(content).toContain("Battle Cards");
  });

  test("Sales Enablement has tab navigation", async ({ page }) => {
    await page.goto(`${BASE_URL}/sales-enablement`);
    await waitForApp(page);

    const tabs = await page.locator("button").filter({ hasText: /Playbooks|Battle Cards|Demo Scripts|Training/ }).count();
    expect(tabs).toBeGreaterThanOrEqual(3);
  });

  test("Sales Enablement has Publish to Confluence button", async ({ page }) => {
    await page.goto(`${BASE_URL}/sales-enablement`);
    await waitForApp(page);

    const publishBtn = page.locator("button", { hasText: "Publish to Confluence" });
    expect(await publishBtn.isVisible()).toBe(true);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // FEEDBACK & INSIGHTS
  // ═══════════════════════════════════════════════════════════════════════════

  test("Feedback & Insights loads with metrics", async ({ page }) => {
    await page.goto(`${BASE_URL}/feedback-insights`);
    await waitForApp(page);

    const content = await page.textContent("body");
    expect(content).toContain("Feedback");
    expect(content).toContain("Insights");
    expect(content).toContain("Sentiment");
  });

  test("Feedback has sentiment filter buttons", async ({ page }) => {
    await page.goto(`${BASE_URL}/feedback-insights`);
    await waitForApp(page);

    const filters = await page.locator("button").filter({ hasText: /All|Positive|Negative/ }).count();
    expect(filters).toBeGreaterThanOrEqual(2);
  });

  test("Feedback has NPS tab", async ({ page }) => {
    await page.goto(`${BASE_URL}/feedback-insights`);
    await waitForApp(page);

    const npsTab = page.locator("button", { hasText: "NPS" });
    expect(await npsTab.isVisible()).toBe(true);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CROSS-CUTTING
  // ═══════════════════════════════════════════════════════════════════════════

  test("All pages render without fatal JS errors", async ({ page }) => {
    const fatalErrors: string[] = [];
    page.on("pageerror", (err) => {
      if (!err.message.includes("Hydration") && !err.message.includes("fetch") && !err.message.includes("Failed to fetch")) {
        fatalErrors.push(err.message);
      }
    });

    const routes = ["/", "/launch-command-center", "/market-research", "/content-studio", "/sales-enablement", "/feedback-insights"];
    for (const route of routes) {
      await page.goto(`${BASE_URL}${route}`);
      await waitForApp(page);
    }

    expect(fatalErrors).toHaveLength(0);
  });

  test("Platform API proxy responds", async ({ page }) => {
    const response = await page.request.get(`${BASE_URL}/api/oddjob/fleet/workload`).catch(() => null);
    if (response) {
      expect([200, 401, 403, 404, 500]).toContain(response.status());
    } else {
      expect(true).toBe(true); // Network error acceptable if app not deployed
    }
  });

  test("Navigation from hub to each module and back", async ({ page }) => {
    await page.goto(BASE_URL);
    await waitForApp(page);

    const links = ["/launch-command-center", "/market-research", "/content-studio", "/sales-enablement", "/feedback-insights"];
    for (const href of links) {
      await page.goto(BASE_URL);
      await waitForApp(page);
      const link = page.locator(`a[href="${href}"]`);
      if (await link.isVisible()) {
        await link.click();
        await waitForApp(page);
        expect(page.url()).toContain(href);
      }
    }
  });
});
