import { QAService as PlaywrightQAService, type TestResult } from '../services/qa.service.js';

export class QAService {
  /**
   * The main entry point for the QA domain.
   * Runs an automated QA test suite against a deployed application.
   *
   * @param testCode The Playwright test code.
   * @param appUrl The URL of the running application.
   * @returns A TestResult object.
   */
  static async runApplicationAudit(testCode: string, appUrl: string): Promise<TestResult> {
    return PlaywrightQAService.runPlaywrightTest(testCode, appUrl);
  }
}
