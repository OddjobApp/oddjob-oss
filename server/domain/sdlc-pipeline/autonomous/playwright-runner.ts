import { createLogger } from "@server/utils/logger.js";
import { exec as execCallback } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";
import type { TestRunner, TestRunResult, FailingTest } from "./test-loop-controller.service.js";

const logger = createLogger("PlaywrightRunner");
const exec = promisify(execCallback);
const DEFAULT_TEST_TIMEOUT_MS = 120_000;
const MAX_TEST_OUTPUT = 20_000;

function truncateOutput(output: string): string {
  if (output.length <= MAX_TEST_OUTPUT) return output;
  return `${output.slice(0, MAX_TEST_OUTPUT)}\n...(truncated, total ${output.length} chars)`;
}

export function parsePlaywrightFailures(testFiles: string[], output: string): FailingTest[] {
  const failingTests: FailingTest[] = [];
  const lines = output.split(/\r?\n/);
  
  let currentFailure: FailingTest | null = null;
  let errorLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^\s*\d+\)\s+\[([^\]]+)\]\s+›\s+(.+?):(\d+):(\d+)\s+›\s+(.+)$/);
    
    if (match) {
      if (currentFailure) {
        currentFailure.errorMessage = errorLines.join("\n").trim();
        failingTests.push(currentFailure);
      }
      
      const browser = match[1];
      const testFile = match[2];
      const testName = match[5];
      
      currentFailure = {
        testFile,
        testName: `${browser} › ${testName}`,
        errorMessage: "",
      };
      errorLines = [];
    } else if (currentFailure) {
      if (line.startsWith("    at ") || line.includes("attachment #1:") || line.match(/^\s*\d+\)/)) {
        currentFailure.errorMessage = errorLines.join("\n").trim();
        failingTests.push(currentFailure);
        currentFailure = null;
        errorLines = [];
      } else {
        errorLines.push(line.trim());
      }
    }
  }

  if (currentFailure) {
    currentFailure.errorMessage = errorLines.join("\n").trim();
    failingTests.push(currentFailure);
  }

  if (failingTests.length === 0) {
    const targets = testFiles.length > 0 ? testFiles : ["E2E tests"];
    return targets.map((testFile) => ({
      testFile,
      testName: "Playwright E2E run",
      errorMessage: truncateOutput(output.trim() || "Playwright test command failed"),
    }));
  }

  return failingTests;
}

export function createPlaywrightRunner(timeoutMs = DEFAULT_TEST_TIMEOUT_MS): TestRunner {
  return {
    async run(testFiles: string[], _sessionId: string): Promise<TestRunResult> {
      const startTime = Date.now();
      const testRepoPath = path.join(process.cwd(), "playwright-test-repo");
      
      let command = "npx playwright test";
      
      if (testFiles.length > 0) {
        const fileArgs: string[] = [];
        const grepArgs: string[] = [];
        
        for (const fileItem of testFiles) {
          if (fileItem.includes("::")) {
            const [rawPath, rawName] = fileItem.split("::");
            let cleanPath = rawPath.replace(/\\/g, "/");
            if (cleanPath.startsWith("playwright-test-repo/")) {
              cleanPath = cleanPath.substring("playwright-test-repo/".length);
            }
            fileArgs.push(cleanPath);
            
            let cleanName = rawName;
            if (cleanName.includes(" › ")) {
              cleanName = cleanName.split(" › ").pop() || cleanName;
            }
            const escapedName = cleanName.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&");
            grepArgs.push(escapedName);
          } else {
            let cleanPath = fileItem.replace(/\\/g, "/");
            if (cleanPath.startsWith("playwright-test-repo/")) {
              cleanPath = cleanPath.substring("playwright-test-repo/".length);
            }
            fileArgs.push(cleanPath);
          }
        }
        
        const filesString = Array.from(new Set(fileArgs)).join(" ");
        const grepString = grepArgs.length > 0 ? ` -g "${grepArgs.join("|")}"` : "";
        command = `npx playwright test ${filesString}${grepString}`;
      }

      logger.info(`[PlaywrightRunner] Running command: ${command}`);

      try {
        const result = await exec(command, {
          cwd: testRepoPath,
          timeout: timeoutMs,
          maxBuffer: 1024 * 1024 * 15,
          env: { ...process.env, CI: "true" },
        });
        
        return {
          passed: true,
          passingTests: testFiles,
          failingTests: [],
          output: truncateOutput([result.stdout, result.stderr].filter(Boolean).join("\n")),
          duration: Date.now() - startTime,
        };
      } catch (error: any) {
        const output = truncateOutput([error.stdout, error.stderr, error.message].filter(Boolean).join("\n"));
        logger.warn("[PlaywrightRunner] Test run failed. Parsing failures...");
        
        return {
          passed: false,
          passingTests: [],
          failingTests: parsePlaywrightFailures(testFiles, output),
          output,
          duration: Date.now() - startTime,
        };
      }
    },
  };
}
