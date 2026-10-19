/**
 * @xray-scope sdlc-workbench
 * @xray-alias external-sdlc
 * @xray-spec docs/specs/sdlc-workbench-functional-spec.md
 */
import { test, expect } from "@playwright/test";

const app = (route = "") => `/app/${process.env.SDLC_WORKBENCH_SLUG || "sdlc-workbench"}${route}`;

test.describe("SDLC Workbench functional contracts", () => {
  test("presents the governed SDLC lifecycle and specialized workbenches", async ({ page }) => {
    // @behavior sdlc-workbench.lifecycle.navigate-specialized-workbenches
    // @functional-description Users can enter the governed SDLC hub and navigate to each specialized delivery workbench.
    await page.goto(app());
    await expect(page.getByRole("heading", { name: "Enterprise Hybrid AI SDLC" })).toBeVisible();
    for (const name of ["Sprint Zero", "PM Workbench", "Scrum Master", "QA Workbench", "Stakeholder", "Fleet Command"]) {
      await expect(page.getByRole("link", { name: new RegExp(name) })).toBeVisible();
    }
  });

  test("opens lifecycle workbenches for requirements, sprint planning, quality, and approval", async ({ page }) => {
    // @behavior sdlc-workbench.lifecycle.handoff-and-approval-flow
    // @functional-description The delivery lifecycle exposes distinct requirements, sprint-planning, quality, and stakeholder-approval stages.
    const surfaces = [
      ["/pm-workbench", /PM Workbench|Product/i],
      ["/scrum-master-workbench", /Scrum Master/i],
      ["/qa-workbench", /QA Workbench|Quality/i],
      ["/stakeholder-workbench", /Stakeholder|Release/i],
    ] as const;
    for (const [route, heading] of surfaces) {
      await page.goto(app(route));
      await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible();
    }
  });

  test("exposes the agent fleet command surface", async ({ page }) => {
    // @behavior sdlc-workbench.agents.monitor-fleet
    // @functional-description Delivery leaders can open Fleet Command and inspect operational agent states.
    await page.goto(app("/ai-workforce-dashboard"));
    await expect(page.getByRole("heading", { name: "Agent Fleet Command" })).toBeVisible();
    await expect(page.getByText(/Active|Blocked|Idle/).first()).toBeVisible();
  });
});
