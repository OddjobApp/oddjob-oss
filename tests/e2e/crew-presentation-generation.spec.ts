import { test, expect } from "@playwright/test";
import path from "path";
import fs from "fs/promises";

const ARTIFACT_DIR = process.env.E2E_ARTIFACT_DIR || path.resolve("test-results", "crew-presentation-generation");

test.describe("Meeting / CREW Room Document & Presentation Deck Generation", () => {
  test("verifies meeting room UI headers and prompts for presentation deck generation", async ({
    page,
  }) => {
    await fs.mkdir(ARTIFACT_DIR, { recursive: true });

    // 1. Navigate to the meeting chat
    const sessionKey = "crew-1786637686160-bmfbipt";
    console.log(`Navigating to /workspace/chat/${sessionKey}`);
    await page.goto(`/workspace/chat/${sessionKey}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);

    // 2. Verify Meeting header terminology
    const meetingTitle = page.locator("text=Meeting").first();
    await expect(meetingTitle).toBeVisible({ timeout: 10000 });

    // 3. Locate chat composer input
    const composer = page.locator('textarea, input[type="text"]').last();
    await expect(composer).toBeVisible({ timeout: 10000 });

    // 4. Send a request to generate a presentation deck
    const promptText = "Can you generate a presentation deck on Oddjob Platform Architecture?";
    console.log(`Typing prompt: "${promptText}"`);
    await composer.fill(promptText);
    await page.keyboard.press("Enter");

    // Wait for the agent round to process
    console.log("Waiting for meeting agents to respond...");
    await page.waitForTimeout(5000);

    // 5. Take screenshot of the meeting interaction
    const screenshotPath = path.join(ARTIFACT_DIR, "media__meeting_presentation_test.png");
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`Screenshot saved to: ${screenshotPath}`);

    // Verify chat message list is populated
    const messageContainer = page.locator(".chat-message, [data-testid^='turn-'], .flex-col").first();
    await expect(messageContainer).toBeVisible();
  });
});
