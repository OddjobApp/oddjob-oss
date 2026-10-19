import { createLogger } from "@server/utils/logger.js";
import * as path from "node:path";
import type { FailureDiagnoser, FailingTest } from "./test-loop-controller.service.js";
import type { FailureDiagnosis } from "../core/types.js";

const logger = createLogger("AiFailureDiagnoser");

function buildDiagnosisPrompt(failure: FailingTest, testOutput: string, testBlockCode?: string): string {
  const parts = [
    "You are an expert QA and automation engineer debugging a failing Playwright E2E test.",
    "Analyze the test failure details, the code block of the failing test, and raw output, then produce a JSON response explaining the root cause and suggesting a fix.",
    "",
    "Format your response as a strict JSON object with these fields:",
    '  "rootCause": "Clear explanation of why the test failed (e.g. element selector data-testid=link-dashboard not visible because sidebar was not fully expanded)",',
    '  "affectedFile": "The file path relative to the project workspace root that needs to be fixed (e.g. playwright-test-repo/tests/smoke/dashboard.spec.ts)",',
    '  "suggestedApproach": "Step-by-step description of the code fix to apply"',
    "",
    "Do NOT wrap the response in markdown code blocks. Output raw JSON only. Ensure the output is valid JSON.",
    "",
    `Failing Test: ${failure.testName}`,
    `Test File: ${failure.testFile}`,
    `Error Message: ${failure.errorMessage}`,
  ];

  if (testBlockCode) {
    parts.push(
      "",
      "--- CODE OF FAILING TEST ---",
      testBlockCode,
      "--- END CODE OF FAILING TEST ---"
    );
  }

  parts.push(
    "",
    "--- RAW TEST OUTPUT ---",
    testOutput,
    "--- END RAW TEST OUTPUT ---"
  );

  return parts.join("\n");
}

function normalizeAffectedFile(filePath: string, defaultFile: string): string {
  let normalized = filePath.replace(/\\/g, "/");
  
  // If the LLM returned a path relative to the test repo (like tests/smoke/dashboard.spec.ts),
  // prefix it with the test repository root directory name.
  if (normalized.startsWith("tests/") || normalized.startsWith("utils/")) {
    normalized = `playwright-test-repo/${normalized}`;
  }
  
  // Fallback to normalized default test file if invalid
  if (!normalized || normalized.trim() === "") {
    let def = defaultFile.replace(/\\/g, "/");
    if (def.startsWith("tests/") || def.startsWith("utils/")) {
      def = `playwright-test-repo/${def}`;
    }
    return def;
  }
  
  return normalized;
}

export function createAiFailureDiagnoser(): FailureDiagnoser {
  return {
    async diagnose(failure: FailingTest, testOutput: string, sessionId: string): Promise<FailureDiagnosis> {
      logger.info(`Diagnosing failure for test ${failure.testName} (session ${sessionId})`);

      try {
        const { systemAiService } = await import("@domain/ai/core/system-ai.service.js");
        const { e2eTestIndexerService } = await import("./e2e-test-indexer.service.js");
        
        let testBlockCode = "";
        try {
          let cleanName = failure.testName;
          if (cleanName.includes(" › ")) {
            cleanName = cleanName.split(" › ").pop() || cleanName;
          }
          const fileBasename = path.basename(failure.testFile, ".spec.ts").replace(/\./g, "_");
          const nameSlug = cleanName.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
          const testId = `${fileBasename}:${nameSlug}`;
          
          const indexed = await e2eTestIndexerService.getTestById(testId);
          if (indexed) {
            testBlockCode = indexed.code;
            logger.info(`Successfully retrieved atomic test block code for ${testId}`);
          }
        } catch (idxErr: any) {
          logger.warn(`Could not index and retrieve test block for diagnosis: ${idxErr.message}`);
        }

        const prompt = buildDiagnosisPrompt(failure, testOutput, testBlockCode);

        const rawResponse = await systemAiService.generateText(prompt, {
          serviceKey: "architect",
          temperature: 0.1,
        });

        if (!rawResponse) {
          throw new Error("Gemini returned empty response for failure diagnosis");
        }

        // Strip any markdown code fences if present
        let cleanJson = rawResponse.trim();
        const fenced = cleanJson.match(/^```json\n([\s\S]*?)\n```$/i) || cleanJson.match(/^```\n([\s\S]*?)\n```$/);
        if (fenced) {
          cleanJson = fenced[1].trim();
        }

        const parsed = JSON.parse(cleanJson);
        const resolvedFile = normalizeAffectedFile(parsed.affectedFile, failure.testFile);

        logger.info(`AI diagnosis generated for ${failure.testName}: ${parsed.rootCause}`);

        return {
          testFile: failure.testFile,
          testName: failure.testName,
          errorMessage: failure.errorMessage,
          stackTrace: failure.stackTrace,
          rootCause: parsed.rootCause || `E2E assertion failed: ${failure.errorMessage}`,
          affectedFile: resolvedFile,
          suggestedApproach: parsed.suggestedApproach || "Inspect locator target or expand timeout.",
        };
      } catch (err: any) {
        logger.error(`AI failure diagnosis failed for ${failure.testName}:`, err);
        
        // Return a safe fallback diagnosis so the test loop doesn't crash
        let fallbackFile = failure.testFile.replace(/\\/g, "/");
        if (fallbackFile.startsWith("tests/")) {
          fallbackFile = `playwright-test-repo/${fallbackFile}`;
        }
        
        return {
          testFile: failure.testFile,
          testName: failure.testName,
          errorMessage: failure.errorMessage,
          stackTrace: failure.stackTrace,
          rootCause: `Failed to synthesize AI diagnosis: ${err?.message || err}`,
          affectedFile: fallbackFile,
          suggestedApproach: "Verify test file contents and CSS locator manually.",
        };
      }
    },
  };
}
