/**
 * @xray-scope agent-training-workbench
 * @xray-spec docs/specs/agent-training-workbench-functional-spec.md
 */
import { test, expect } from "@playwright/test";

const app = (route = "") => `/app/${process.env.AGENT_TRAINING_WORKBENCH_SLUG || "agent-training-workbench"}${route}`;

test.describe("Agent Training Workbench functional contracts", () => {
  test("presents the governed agent-improvement lifecycle", async ({ page }) => {
    // @behavior agent-training-workbench.lifecycle.navigate-training-stages
    // @functional-description Training operators can navigate the complete governed agent-improvement lifecycle.
    await page.goto(app());
    await expect(page.getByRole("heading", { name: "Agent Performance & Training Platform" })).toBeVisible();
    for (const name of ["Eval Dashboard", "Failure Analysis", "Training Sign-off", "Training Corpus", "Promotion Gate", "Simulation Arena"]) {
      await expect(page.getByRole("link", { name: new RegExp(name) })).toBeVisible();
    }
  });

  test("opens corpus, simulation, evaluation, and failure-analysis surfaces", async ({ page }) => {
    // @behavior agent-training-workbench.lifecycle.evaluate-and-analyze
    // @functional-description Training operators can move from corpus preparation and simulation into evaluation and failure analysis.
    const surfaces = [
      ["/training-corpus", /Training Corpus/i],
      ["/simulation-arena", /Simulation/i],
      ["/eval-dashboard", /Eval|Evaluation/i],
      ["/failure-analysis", /Failure Analysis/i],
    ] as const;
    for (const [route, heading] of surfaces) {
      await page.goto(app(route));
      await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible();
    }
  });

  test("opens human sign-off and promotion gates", async ({ page }) => {
    // @behavior agent-training-workbench.governance.sign-off-and-promote
    // @functional-description Human sign-off and promotion are explicit, separate governance gates.
    await page.goto(app("/training-sign-off"));
    await expect(page.getByRole("heading", { name: "Training Sign-off" })).toBeVisible();
    await page.goto(app("/promotion-gate"));
    await expect(page.getByRole("heading", { name: "Promotion Gate" })).toBeVisible();
  });
});
