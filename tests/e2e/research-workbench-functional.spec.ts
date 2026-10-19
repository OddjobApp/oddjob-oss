/**
 * @xray-scope research-workbench
 * @xray-spec docs/specs/research-workbench-functional-spec.md
 */
import { test, expect } from "@playwright/test";

const app = (route = "") => `/app/${process.env.RESEARCH_WORKBENCH_SLUG || "research-workbench"}${route}`;

test.describe("Research Workbench functional contracts", () => {
  test("presents the end-to-end research workflow", async ({ page }) => {
    // @behavior research-workbench.workflow.navigate-research-stages
    // @functional-description Researchers can navigate a complete research-to-action workflow from one hub.
    await page.goto(app());
    await expect(page.getByRole("heading", { name: "Research & RFC Synthesis Platform" })).toBeVisible();
    for (const name of ["Ingestion & Synthesis Hub", "Decision Control Panel", "Draft & Review Sandbox", "Shared Memory Library", "Visual Knowledge Graph Explorer", "Action & Backlog Provisioner"]) {
      await expect(page.getByRole("link", { name: new RegExp(name) })).toBeVisible();
    }
  });

  test("opens ingestion, decision, drafting, and knowledge-management surfaces", async ({ page }) => {
    // @behavior research-workbench.workflow.execute-review-and-curate
    // @functional-description Researchers can move among ingestion, governed decisions, draft review, shared memory, and knowledge-graph exploration.
    const surfaces = [
      ["/ingestion-hub", /Ingestion|Research/i],
      ["/decision-panel", /Decision/i],
      ["/draft-sandbox", /Draft & Review Sandbox/i],
      ["/memory-library", /Memory|Knowledge/i],
      ["/knowledge-graph", /Knowledge Graph/i],
    ] as const;
    for (const [route, heading] of surfaces) {
      await page.goto(app(route));
      await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible();
    }
  });

  test("opens action provisioning for researched findings", async ({ page }) => {
    // @behavior research-workbench.workflow.provision-actions
    // @functional-description Verified research findings can be handed off to the action and backlog provisioning surface.
    await page.goto(app("/backlog-provisioner"));
    await expect(page.getByRole("heading", { name: /Backlog|Action/i }).first()).toBeVisible();
  });
});
