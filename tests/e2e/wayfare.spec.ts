import { test, expect, type Page } from "@playwright/test";
// Real room acceptance only. The previous suite rendered a handwritten demo
// document, so it could pass while the installed Wayfare app was broken.
const roomUrl = process.env.WAYFARE_E2E_ROOM;
async function mount(page: Page) {
  await page.goto(roomUrl!);
  await expect(
    page.getByRole("button", { name: "App studio", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "App studio", exact: true }).click();
  const selector = page.getByTestId("crew-app-studio-canvas").getByRole("combobox");
  await expect(selector).toBeVisible();
  await selector.click();
  await page
    .getByRole("option", { name: "Wayfare Long-Haul Planner", exact: true })
    .click();
  const app = page.frameLocator('iframe[title="Wayfare Long-Haul Planner"]');
  await expect(
    app.getByRole("heading", { name: "Wayfare", exact: true }),
  ).toBeVisible();
  return app;
}
test.describe("Wayfare installed CREW surface", () => {
  test.skip(
    !roomUrl,
    "Set WAYFARE_E2E_ROOM to an authenticated, isolated acceptance room. This suite never substitutes mock HTML.",
  );
  test("mounts real trip and EV controls without seeded demonstration people", async ({
    page,
  }) => {
    const app = await mount(page);
    await expect(
      app.getByRole("button", { name: "Save trip", exact: true }),
    ).toBeVisible();
    await expect(
      app.getByRole("button", { name: "Configure EV", exact: true }),
    ).toBeVisible();
    await expect(app.getByText("Sarah Miller", { exact: true })).toHaveCount(0);
  });
  test("opens an existing acceptance trip and exposes its vehicle and consumption fields", async ({
    page,
  }) => {
    test.skip(
      !process.env.WAYFARE_E2E_TRIP_NAME,
      "Set the exact name of a saved acceptance trip.",
    );
    const app = await mount(page);
    await app
      .getByRole("button", {
        name: new RegExp(process.env.WAYFARE_E2E_TRIP_NAME!),
      })
      .click();
    await expect(app.getByLabel("Trip name", { exact: true })).toHaveValue(
      process.env.WAYFARE_E2E_TRIP_NAME!,
    );
    await expect(
      app.getByRole("heading", { name: "Mapbox journey & leg forecast" }),
    ).toBeVisible();
  });
  test("uses live Mapbox geometry and per-leg tables", async ({ page }) => {
    test.skip(
      process.env.WAYFARE_E2E_LIVE_MAPBOX !== "1" ||
        !process.env.WAYFARE_E2E_TRIP_NAME,
      "Live provider calls require explicit test opt-in and a saved acceptance trip.",
    );
    const app = await mount(page);
    await app
      .getByRole("button", {
        name: new RegExp(process.env.WAYFARE_E2E_TRIP_NAME!),
      })
      .click();
    await app
      .getByRole("button", { name: "Calculate journey", exact: true })
      .click();
    await expect(
      app.getByRole("region", { name: "Mapbox journey map" }),
    ).toBeVisible({ timeout: 100000 });
    await expect(app.getByRole("table")).toBeVisible();
    await expect(app.locator("canvas.mapboxgl-canvas")).toBeVisible();
  });
});

