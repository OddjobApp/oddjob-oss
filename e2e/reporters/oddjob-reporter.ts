import type { Reporter, FullConfig, Suite, TestCase, TestResult, FullResult } from "@playwright/test/reporter";

export interface OddjobTestReport {
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

export class OddjobReporter implements Reporter {
  private startTime: number = 0;
  private failures: Array<{ title: string; file: string; error: string; stack?: string }> = [];
  private passed: number = 0;
  private failed: number = 0;
  private skipped: number = 0;

  onBegin(config: FullConfig, suite: Suite) {
    this.startTime = Date.now();
    console.log(`[OddjobReporter] Starting E2E test execution: ${suite.allTests().length} total tests`);
  }

  onTestEnd(test: TestCase, result: TestResult) {
    if (result.status === "passed") {
      this.passed++;
    } else if (result.status === "failed" || result.status === "timedOut") {
      this.failed++;
      this.failures.push({
        title: test.title,
        file: test.location.file,
        error: result.error?.message || "Test execution failed",
        stack: result.error?.stack
      });
    } else {
      this.skipped++;
    }
  }

  async onEnd(result: FullResult) {
    const durationMs = Date.now() - this.startTime;
    const report: OddjobTestReport = {
      suiteName: "Playwright E2E Suite",
      totalTests: this.passed + this.failed + this.skipped,
      passed: this.passed,
      failed: this.failed,
      skipped: this.skipped,
      durationMs,
      failures: this.failures,
      executedAt: new Date().toISOString()
    };

    console.log(`[OddjobReporter] E2E Execution Finished in ${durationMs}ms: ${this.passed} passed, ${this.failed} failed, ${this.skipped} skipped.`);

    // Transmit execution telemetry to Oddjob backend API if configured
    const apiUrl = process.env.ODDJOB_API_URL || "http://localhost:5000/api/testing/playwright/report-execution";
    try {
      if (process.env.ODDJOB_REPORT_ENABLED === "true") {
        await fetch(apiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(report)
        });
        console.log(`[OddjobReporter] Telemetry successfully transmitted to ${apiUrl}`);
      }
    } catch (err: any) {
      console.warn(`[OddjobReporter] Failed to send telemetry to ${apiUrl}: ${err.message}`);
    }
  }
}

export default OddjobReporter;
