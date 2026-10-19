import { test, expect } from "@playwright/test";

test.describe("Dashboard & Platform Navigation Smoke Tests", () => {
  test("should load main agency dashboard and render platform title", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveTitle(/Oddjob/i);
  });

  test("should display system navigation menu items", async ({ page }) => {
    await page.goto("/dashboard");
    const nav = page.locator("nav");
    await expect(nav).toBeVisible();
  });
});
