import { describe, it, expect } from "vitest";
import { playwrightSelfHealingService, type PlaywrightExecutionReport } from "../../server/domain/testing/core/playwright-self-healing.service.js";

describe("Playwright E2E Integration & Self-Healing Unit Tests", () => {
  it("should process test execution report and calculate health metrics", async () => {
    const report: PlaywrightExecutionReport = {
      suiteName: "Playwright E2E Suite",
      totalTests: 5,
      passed: 4,
      failed: 1,
      skipped: 0,
      durationMs: 4500,
      failures: [
        {
          title: "should click navigation dashboard button",
          file: "e2e/tests/smoke/dashboard.spec.ts",
          error: "locator.click: Target page, context or browser has been closed. Timeout 30000ms exceeded waiting for selector button.nav-item-btn"
        }
      ],
      executedAt: new Date().toISOString()
    };

    const result = await playwrightSelfHealingService.processExecutionReport(report);
    expect(result.reportSummary.passed).toBe(4);
    expect(result.reportSummary.failed).toBe(1);
    expect(result.diagnoses.length).toBe(1);
    expect(result.diagnoses[0].diagnosis).toBe("UI_DRIFT");
    // Selector failures are flagged for review, not auto-"healed" with a fabricated selector
    expect(result.diagnoses[0].actionTaken).toBe("FLAGGED_FOR_REVIEW");
    expect(result.diagnoses[0]).not.toHaveProperty("healedSelector");

    const health = await playwrightSelfHealingService.getHealthMetrics();
    expect(health.totalRuns).toBeGreaterThan(0);
    expect(health.passRate).toBe(80);
    expect(health.healthStatus).toBe("DEGRADED");
  });

  it("should diagnose actual application code bug and route to Dataset ID 71", async () => {
    const bugFailure = {
      title: "should compute billing total accurately",
      file: "e2e/tests/regression/billing.spec.ts",
      error: "AssertionError: expected $120.00 to equal $150.00"
    };

    const diagnosis = await playwrightSelfHealingService.diagnoseAndHeal(bugFailure);
    expect(diagnosis.diagnosis).toBe("CODE_BUG");
    expect(diagnosis.actionTaken).toBe("LOGGED_TO_DATASET_71");
    expect(diagnosis.bugDatasetId).toBe(71);
  });
});
