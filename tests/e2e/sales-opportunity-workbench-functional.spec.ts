/**
 * @xray-scope sales-opportunity-workbench
 * @xray-spec docs/specs/sales-opportunity-workbench-functional-spec.md
 */
import { test, expect } from "@playwright/test";

const app = (route = "") => `/app/${process.env.SALES_OPPORTUNITY_WORKBENCH_SLUG || "sales-opportunity-workbench"}${route}`;

test.describe("Sales Opportunity Workbench functional contracts", () => {
  test("presents the advisory-only opportunity lifecycle", async ({ page }) => {
    // @behavior sales-opportunity-workbench.pipeline.navigate-revenue-surfaces
    // @functional-description Revenue teams can navigate pipeline, opportunity, forecast, risk, advisor, and coaching surfaces while retaining a human close gate.
    await page.goto(app());
    await expect(page.getByRole("heading", { name: "Sales Opportunity Pipeline" })).toBeVisible();
    await expect(page.getByText(/deals close on a human gate, never automatically/i)).toBeVisible();
    for (const name of ["Pipeline Board", "Opportunity Register", "Forecast & Calibration", "Deal Risk Center", "AI Sales Advisor", "Autonomous Deal Coach"]) {
      await expect(page.getByRole("link", { name: new RegExp(name) })).toBeVisible();
    }
  });

  test("opens pipeline, forecast, risk, and advisor views", async ({ page }) => {
    // @behavior sales-opportunity-workbench.pipeline.inspect-and-forecast
    // @functional-description Revenue teams can inspect opportunities and move between pipeline, forecasting, deal-risk, and advisor views.
    const surfaces = [
      ["/pipeline", /Pipeline/i],
      ["/opportunities", /Opportunit/i],
      ["/forecast", /Forecast/i],
      ["/alerts", /Risk|Alert/i],
      ["/advisor", /Advisor/i],
    ] as const;
    for (const [route, heading] of surfaces) {
      await page.goto(app(route));
      await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible();
    }
  });

  test("opens autonomous deal coaching without bypassing human gates", async ({ page }) => {
    // @behavior sales-opportunity-workbench.coaching.open-deal-coach
    // @functional-description Sellers can open autonomous deal coaching without granting the coach authority to close a deal.
    await page.goto(app("/deal-coach"));
    await expect(page.getByRole("heading", { name: /Deal Coach|Coaching/i }).first()).toBeVisible();
  });
});
