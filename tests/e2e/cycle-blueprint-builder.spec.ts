import { test, expect } from "@playwright/test";

test.describe("Cycle Blueprint Builder", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/operations/cycles/new", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("textbox", { name: "Cycle name" })).toBeVisible();
  });

  test("Timeline, Flow, and Data share the same draft", async ({ page }) => {
    const name = `Release contract ${Date.now()}`;
    const cycleName = page.getByRole("textbox", { name: "Cycle name" });
    await cycleName.fill(name);

    await expect(page.getByText("Operational stage")).toBeVisible();

    await page.getByRole("button", { name: "Flow" }).click();
    await expect(page.getByRole("heading", { name: "Execution flow" })).toBeVisible();

    await page.getByRole("button", { name: "Data" }).click();
    await expect(page.getByRole("heading", { name: "Data mappings" })).toBeVisible();
    await expect(cycleName).toHaveValue(name);

    await page.getByRole("button", { name: "Timeline" }).click();
    await expect(cycleName).toHaveValue(name);
  });

  test("creates and persists a new phase through the authoring shell", async ({ page }) => {
    const initialPhases = page.locator("[data-cycle-phase]");
    const initialCount = await initialPhases.count();

    await page.getByRole("button", { name: "mission", exact: true }).click();
    await expect(initialPhases).toHaveCount(initialCount + 1);

    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(/Saved locally just now|Saved to Oddjob/)).toBeVisible();
  });

  test("exposes named authoring controls to assistive technology", async ({ page }) => {
    await expect(page.getByRole("textbox", { name: "Cycle name" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Timeline" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Flow" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Data" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Validate" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create Cycle" })).toBeDisabled();
  });
});
