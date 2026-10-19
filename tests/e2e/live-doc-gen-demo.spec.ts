import { test, expect } from "@playwright/test";
import path from "path";
import fs from "fs/promises";

const ARTIFACT_DIR = process.env.E2E_ARTIFACT_DIR || path.resolve("test-results", "live-doc-gen-demo");

test.describe("Live Document Generation Demo in CREW Chat and Missions", () => {
  test("runs interactive demo on live CREW chat and captures UI artifacts", async ({ page }) => {
    test.setTimeout(120000);
    await fs.mkdir(ARTIFACT_DIR, { recursive: true });

    // 1. Navigate to the CREW chat room specified by the user
    const targetUrl = "http://localhost:5000/workspace/chat/crew-1786647715900-p08cyff";
    console.log(`Navigating to ${targetUrl}...`);
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);

    // Capture initial chat state
    const shot1 = path.join(ARTIFACT_DIR, "demo_crew_chat_initial.png");
    await page.screenshot({ path: shot1, fullPage: false });
    console.log(`Saved screenshot: ${shot1}`);

    // 2. Locate chat composer input
    const composer = page.locator('textarea, input[type="text"]').last();
    if (await composer.isVisible()) {
      const demoPrompt = "Please generate an Executive Presentation Deck summarizing the 5-Layer AI Control Plane Architecture and key operational metrics.";
      console.log(`Submitting document generation prompt: "${demoPrompt}"`);
      await composer.fill(demoPrompt);
      await page.keyboard.press("Enter");

      // Wait for the multi-agent crew round to process and render
      console.log("Waiting for CREW agents to respond and generate document artifacts...");
      await page.waitForTimeout(10000);

      // Capture resulting chat state with artifact
      const shot2 = path.join(ARTIFACT_DIR, "demo_crew_chat_response.png");
      await page.screenshot({ path: shot2, fullPage: false });
      console.log(`Saved screenshot: ${shot2}`);
    }

    // 3. Navigate to Operations / Missions to show Mission Deliverables
    console.log("Navigating to /operations to inspect Mission Deliverables...");
    await page.goto("http://localhost:5000/operations", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);

    const shot3 = path.join(ARTIFACT_DIR, "demo_operations_overview.png");
    await page.screenshot({ path: shot3, fullPage: false });
    console.log(`Saved screenshot: ${shot3}`);

    console.log("Demo execution complete!");
  });
});
