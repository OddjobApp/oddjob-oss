import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createLogger } from '@server/utils/logger.js';
import { layoutFormalService } from '@server/domain/scaffold/formal/layout-formal.service.js';
import type { LayoutNode, ProofCertificate, SynthesizedRepair, ViewportBounds } from '@server/domain/scaffold/formal/types.js';

const execAsync = promisify(exec);
const logger = createLogger('QAService');

export interface TestResult {
  success: boolean;
  summary: string;
  output: string;
}

export interface FormalLayoutQAResult {
  passed: boolean;
  certificate: ProofCertificate;
  repair?: SynthesizedRepair;
  summary: string;
}

export class QAService {
  /**
   * Pre-flight mathematical layout verification across continuous viewport spectrum
   * Eliminates the need for slow/flaky Playwright tests when verifying geometric invariants.
   */
  static verifyLayoutFormally(
    layoutTree: LayoutNode,
    viewport?: ViewportBounds,
    autoRepair: boolean = true
  ): FormalLayoutQAResult {
    logger.info(`[QAService] Running formal QF_LRA verification on '${layoutTree.id}'`);
    
    if (autoRepair) {
      const res = layoutFormalService.verifyAndSynthesize(layoutTree, viewport);
      const certificate = res.repair?.success ? res.repair.proof : res.certificate;
      const passed = certificate.status === "PASSED";
      const summary = passed
        ? `Formal QA Passed: ${certificate.checkedInvariantsCount} invariants verified (Auto-repaired: ${Boolean(res.repair)}).`
        : `Formal QA Failed: ${res.certificate.violations.length} violation(s) detected.`;

      return {
        passed,
        certificate,
        repair: res.repair,
        summary
      };
    }

    const cert = layoutFormalService.verify(layoutTree, viewport);
    const passed = cert.status === "PASSED";
    const summary = passed
      ? `Formal QA Passed: ${cert.checkedInvariantsCount} invariants verified.`
      : `Formal QA Failed: ${cert.violations.length} violation(s) detected.`;

    return {
      passed,
      certificate: cert,
      summary
    };
  }

  /**
   * Runs a Playwright test against a given URL.
   *
   * @param testCode The Playwright test code to execute.
   * @param appUrl The URL of the application to test.
   * @returns A TestResult object with the outcome.
   */
  static async runPlaywrightTest(testCode: string, appUrl: string): Promise<TestResult> {
    const tempDir = path.join(process.cwd(), 'temp', 'qa');
    await fs.mkdir(tempDir, { recursive: true });
    const testFilePath = path.join(tempDir, `test-${Date.now()}.spec.ts`);

    try {
      await fs.writeFile(testFilePath, testCode, 'utf-8');
      logger.info(`Executing Playwright test: ${testFilePath}`);

      const command = `npx playwright test ${testFilePath}`;
      const { stdout, stderr } = await execAsync(command, {
        env: {
          ...process.env,
          APP_URL: appUrl,
        },
        timeout: 120_000, // 2-minute timeout for the test run
      });

      const output = stdout + stderr;
      const success = !output.includes('failing');

      logger.info(`Playwright test completed. Success: ${success}`);
      
      return {
        success,
        summary: success ? 'All tests passed' : 'Some tests failed',
        output,
      };

    } catch (error: any) {
      logger.error('Playwright test execution failed', { error });
      return {
        success: false,
        summary: 'Test execution failed',
        output: error.stdout || error.stderr || error.message,
      };
    } finally {
      // Clean up the temporary test file
      await fs.rm(testFilePath, { force: true });
    }
  }
}

