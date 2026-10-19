/**
 * @xray-scope scrum-master-workbench
 * @xray-spec docs/specs/scrum-master-workbench-functional-spec.md
 */
import { test, expect } from "@playwright/test";

const app = () => `/app/${process.env.SCRUM_MASTER_WORKBENCH_SLUG || "scrum-master-workbench"}`;

test.describe("Scrum Master Workbench functional contracts", () => {
  test("presents sprint planning and delivery controls", async ({ page }) => {
    // @behavior scrum-master-workbench.sprint.navigate-planning-surfaces
    // @functional-description Scrum leaders can access capacity, backlog, blocker, retrospective, and AI planning controls.
    await page.goto(app());
    await expect(page.getByRole("heading", { name: "Scrum Master Workbench" })).toBeVisible();
    for (const tab of ["Capacity & Planning", "Sprint Backlog", "Blockers", "Retrospective"]) {
      await expect(page.getByRole("tab", { name: tab })).toBeVisible();
    }
    await expect(page.getByRole("button", { name: "Toggle AI Sprint Planner chat" })).toBeVisible();
  });

  test("moves between capacity, backlog, blockers, and retrospective views", async ({ page }) => {
    // @behavior scrum-master-workbench.sprint.switch-operational-views
    // @functional-description Selecting an operational tab makes its corresponding sprint-management view active.
    await page.goto(app());
    for (const tab of ["Sprint Backlog", "Blockers", "Retrospective", "Capacity & Planning"]) {
      const control = page.getByRole("tab", { name: tab });
      await control.click();
      await expect(control).toHaveAttribute("aria-selected", "true");
    }
  });

  test("opens the AI sprint-planning assistant", async ({ page }) => {
    // @behavior scrum-master-workbench.sprint.open-ai-planner
    // @functional-description Scrum leaders can explicitly open the AI Sprint Planner from the workbench.
    await page.goto(app());
    await page.getByRole("button", { name: "Toggle AI Sprint Planner chat" }).click();
    await expect(page.getByText(/AI Sprint Planner|Sprint Planner/i).first()).toBeVisible();
  });
});
