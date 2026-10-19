import { test, expect } from "@playwright/test";
import path from "path";
import fs from "fs/promises";

const ARTIFACT_DIR = process.env.E2E_ARTIFACT_DIR || path.resolve("test-results", "trigger-crew-tool");

test("Triggers explicit generate_presentation_deck tool call inside the CREW room", async ({ page }) => {
  test.setTimeout(120000);
  const targetUrl = "http://localhost:5000/workspace/chat/crew-1786647715900-p08cyff";
  console.log(`Navigating to ${targetUrl}...`);
  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);

  const composer = page.locator('textarea, input[type="text"]').last();
  const directPrompt = "Please call the generate_presentation_deck tool immediately to create a deck titled 'Oddjob Platform Architecture' summarizing the 5 control layers.";
  
  console.log(`Submitting direct tool trigger prompt: "${directPrompt}"`);
  await composer.fill(directPrompt);
  await page.keyboard.press("Enter");

  console.log("Waiting for CREW agent to execute tool and return artifact turn...");
  await page.waitForTimeout(15000);

  const shot = path.join(ARTIFACT_DIR, "live_crew_room_artifact_rendered.png");
  await page.screenshot({ path: shot, fullPage: false });
  console.log(`Saved screenshot: ${shot}`);
});
