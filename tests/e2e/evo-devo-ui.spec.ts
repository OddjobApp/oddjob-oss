import { test, expect } from "@playwright/test";

/**
 * The evo-devo read surface, end to end.
 *
 * The engine shipped with fourteen endpoints and no client code calling any of
 * them. These assertions are deliberately about REACHABILITY — that the read
 * routes respond and the Flight Deck renders the tab — because "the API exists"
 * was already true and was not the same as the feature being usable.
 */
test.describe("Evo-Devo read surface", () => {
  test("the read endpoints respond for an authenticated member", async ({ request }) => {
    const genomes = await request.get("/api/evolution/evo-devo/genomes");
    expect(genomes.ok(), await genomes.text()).toBeTruthy();
    expect(Array.isArray(await genomes.json())).toBe(true);

    const populations = await request.get("/api/evolution/evo-devo/populations");
    expect(populations.ok(), await populations.text()).toBeTruthy();
    expect(Array.isArray(await populations.json())).toBe(true);
  });

  test("the Flight Deck exposes an Evo-Devo tab that renders", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("oddjob:spatial:onboarding-complete", "true");
    });
    await page.goto("/admin/evolution");

    const tab = page.getByTestId("deck-tab-evo-devo");
    await expect(tab).toBeVisible({ timeout: 30_000 });

    await tab.click();
    // The panel renders even with no genomes — an empty state is a state, and
    // a blank tab would be indistinguishable from a broken one.
    await expect(page.getByTestId("evo-devo-panel")).toBeVisible();
    await expect(page.getByText("Genomes", { exact: false }).first()).toBeVisible();
  });
});
