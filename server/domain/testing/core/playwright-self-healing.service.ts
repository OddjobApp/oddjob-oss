import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("PlaywrightSelfHealing");

export interface PlaywrightExecutionReport {
  suiteName: string;
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  failures: Array<{
    title: string;
    file: string;
    error: string;
    stack?: string;
  }>;
  executedAt: string;
}

export interface SelfHealingDiagnosis {
  testTitle: string;
  file: string;
  diagnosis: "UI_DRIFT" | "CODE_BUG" | "FLAKY_TIMEOUT";
  actionTaken: "FLAGGED_FOR_REVIEW" | "LOGGED_TO_DATASET_71" | "RETRY_QUEUED";
  suggestedSelector?: string;
  bugDatasetId?: number;
  evaluatedAt: string;
}

export class PlaywrightSelfHealingService {
  private executionHistory: PlaywrightExecutionReport[] = [];

  /**
   * Records test execution report and triggers diagnostic on failures.
   */
  async processExecutionReport(report: PlaywrightExecutionReport) {
    logger.info(`[PlaywrightSelfHealing] Processing report for '${report.suiteName}': ${report.passed} passed, ${report.failed} failed`);
    this.executionHistory.push(report);

    const diagnoses: SelfHealingDiagnosis[] = [];

    for (const failure of report.failures) {
      const diagnosis = await this.diagnoseAndHeal(failure);
      diagnoses.push(diagnosis);
    }

    return {
      reportSummary: {
        total: report.totalTests,
        passed: report.passed,
        failed: report.failed,
        durationMs: report.durationMs
      },
      diagnoses
    };
  }

  /**
   * Classifies a single test failure by error signature.
   *
   * NOTE: this is heuristic triage, not auto-healing. For selector/locator failures
   * we do not have the real page DOM here, so we flag the failure for review with a
   * best-effort selector parsed from the error message (if any) rather than
   * fabricating a replacement selector.
   */
  async diagnoseAndHeal(failure: { title: string; file: string; error: string }): Promise<SelfHealingDiagnosis> {
    logger.info(`[PlaywrightSelfHealing] Diagnosing failure: '${failure.title}' in ${failure.file}`);

    const isSelectorError = failure.error.includes("locator") || failure.error.includes("selector") || failure.error.includes("element");
    const isTimeout = failure.error.includes("timeout") || failure.error.includes("exceeded");

    if (isSelectorError) {
      // Best-effort: surface the selector the test was actually looking for, parsed
      // from the Playwright error (e.g. locator('...') / getByTestId('...')).
      const selectorMatch = failure.error.match(/(?:locator|getBy\w+)\(\s*['"`]([^'"`]+)['"`]/);
      return {
        testTitle: failure.title,
        file: failure.file,
        diagnosis: "UI_DRIFT",
        actionTaken: "FLAGGED_FOR_REVIEW",
        suggestedSelector: selectorMatch?.[1],
        evaluatedAt: new Date().toISOString()
      };
    }

    if (isTimeout) {
      return {
        testTitle: failure.title,
        file: failure.file,
        diagnosis: "FLAKY_TIMEOUT",
        actionTaken: "RETRY_QUEUED",
        evaluatedAt: new Date().toISOString()
      };
    }

    // Actual application code bug -> Log to Dataset ID 71
    logger.warn(`[PlaywrightSelfHealing] Code Bug detected in '${failure.title}'. Logging defect to Dataset ID 71.`);
    return {
      testTitle: failure.title,
      file: failure.file,
      diagnosis: "CODE_BUG",
      actionTaken: "LOGGED_TO_DATASET_71",
      bugDatasetId: 71,
      evaluatedAt: new Date().toISOString()
    };
  }

  /**
   * Returns current E2E test suite health metrics.
   */
  async getHealthMetrics() {
    const totalRuns = this.executionHistory.length;
    const totalFailed = this.executionHistory.reduce((sum, r) => sum + r.failed, 0);
    const totalPassed = this.executionHistory.reduce((sum, r) => sum + r.passed, 0);
    const totalTests = totalFailed + totalPassed;

    const passRate = totalTests > 0 ? Math.round((totalPassed / totalTests) * 100) : 100;

    return {
      totalRuns,
      totalTestsExecuted: totalTests,
      passed: totalPassed,
      failed: totalFailed,
      passRate,
      healthStatus: passRate >= 95 ? "HEALTHY" : passRate >= 80 ? "DEGRADED" : "CRITICAL",
      lastExecutedAt: this.executionHistory[this.executionHistory.length - 1]?.executedAt || null
    };
  }
}

export const playwrightSelfHealingService = new PlaywrightSelfHealingService();
