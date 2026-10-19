import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createLogger } from "@server/utils/logger.js";
import { systemAiService } from "@domain/ai/core/system-ai.service.js";
import { createPlaywrightRunner } from "./playwright-runner.js";
import { parseTestFile, type ParsedTest } from "./e2e-test-indexer.service.js";
import type { TestRunner } from "./test-loop-controller.service.js";
import type { UIBehaviorContract } from "./ui-behavior-reconciler.service.js";

const logger = createLogger("E2ETestAuthoring");

export interface E2ETestDraft {
  behaviorId: string;
  testName: string;
  targetFile: string;
  code: string;
  rationale: string;
}

export interface TestAuthoringResult {
  status: "applied" | "rejected" | "skipped";
  behaviorId: string;
  targetFile?: string;
  testId?: string;
  reason?: string;
}

export interface TestDraftGenerator {
  generate(behavior: UIBehaviorContract, existingTests: ParsedTest[]): Promise<E2ETestDraft | null>;
}

interface AuthoringDependencies {
  generator: TestDraftGenerator;
  runner: TestRunner;
  testRepoRoot: string;
}

function cleanJson(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function safeSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70) || "generated";
}

function defaultTargetFile(behavior: UIBehaviorContract): string {
  const routePart = behavior.route ? behavior.route.replace(/^\/+/, "") : path.basename(behavior.sourceFile).replace(/\.[^.]+$/, "");
  return `tests/regression/generated/${safeSlug(routePart)}.spec.ts`;
}

function buildAuthoringPrompt(behavior: UIBehaviorContract, existingTests: ParsedTest[]): string {
  const examples = existingTests.slice(0, 4).map((test) => test.code).join("\n\n");
  return [
    "You are authoring one atomic Playwright test for Oddjob.",
    "Return strict JSON only with: testName, targetFile, code, rationale.",
    `targetFile must be under tests/regression/generated/ and end in .spec.ts. Prefer ${defaultTargetFile(behavior)}.`,
    "code must contain exactly one test('name', async ({ page }) => { ... }); block.",
    `The first line inside the test body must be: // @behavior ${behavior.id}`,
    "Use accessible roles, labels, or stable data-testid selectors. Do not use nth(), arbitrary sleeps, page.evaluate(), test.only(), or destructive production actions.",
    "Assert a visible, externally observable outcome. Do not invent credentials or test data.",
    "",
    `Behavior contract: ${JSON.stringify(behavior, null, 2)}`,
    examples ? `\nExisting repository examples:\n${examples}` : "",
  ].join("\n");
}

export function createAiTestDraftGenerator(): TestDraftGenerator {
  return {
    async generate(behavior, existingTests) {
      const raw = await systemAiService.generateText(buildAuthoringPrompt(behavior, existingTests), {
        serviceKey: "codegen",
        temperature: 0.1,
      });
      if (!raw) return null;
      const parsed = JSON.parse(cleanJson(raw));
      return {
        behaviorId: behavior.id,
        testName: String(parsed.testName ?? "").trim(),
        targetFile: String(parsed.targetFile ?? defaultTargetFile(behavior)).replace(/\\/g, "/"),
        code: String(parsed.code ?? "").trim(),
        rationale: String(parsed.rationale ?? "Generated from an uncovered UI behavior contract"),
      };
    },
  };
}

export function validateTestDraft(draft: E2ETestDraft, behavior: UIBehaviorContract): string[] {
  const errors: string[] = [];
  if (draft.behaviorId !== behavior.id) errors.push("Draft behavior ID does not match the requested contract");
  if (!/^tests\/regression\/generated\/[a-z0-9._/-]+\.spec\.ts$/i.test(draft.targetFile)) {
    errors.push("Target file must stay under tests/regression/generated and end in .spec.ts");
  }
  if (draft.targetFile.includes("..")) errors.push("Target file cannot contain parent-directory traversal");
  if (!draft.testName) errors.push("Test name is required");
  if (!draft.code.includes(`@behavior ${behavior.id}`)) errors.push("Test must contain its behavior marker");
  if (!/\bexpect\s*\(/.test(draft.code)) errors.push("Test must contain an assertion");
  if (/test\.(?:only|skip|fixme)\s*\(/.test(draft.code)) errors.push("Focused or skipped tests cannot be authored automatically");
  if (/\b(?:page\.evaluate|waitForTimeout|request\.delete)\s*\(/.test(draft.code)) errors.push("Draft uses a disallowed operation");
  const parsed = parseTestFile(draft.targetFile, draft.code);
  if (parsed.length !== 1) errors.push("Draft must contain exactly one parseable atomic test block");
  else if (parsed[0].testName !== draft.testName) errors.push("Draft testName must match the Playwright block name");
  return errors;
}

function resolveTarget(testRepoRoot: string, targetFile: string): string | null {
  const root = path.resolve(testRepoRoot);
  const target = path.resolve(root, targetFile);
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  return target.startsWith(prefix) ? target : null;
}

async function readExisting(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

function assembledContent(existing: string | null, draft: E2ETestDraft): string {
  if (!existing) return `import { test, expect } from '@playwright/test';\n\n${draft.code}\n`;
  return `${existing.trimEnd()}\n\n${draft.code}\n`;
}

export function createE2ETestAuthoringService(overrides: Partial<AuthoringDependencies> = {}) {
  const dependencies: AuthoringDependencies = {
    generator: overrides.generator ?? createAiTestDraftGenerator(),
    runner: overrides.runner ?? createPlaywrightRunner(),
    testRepoRoot: overrides.testRepoRoot ?? path.join(process.cwd(), "playwright-test-repo"),
  };

  return {
    async authorAndValidate(
      behavior: UIBehaviorContract,
      existingTests: ParsedTest[],
      sessionId: string,
    ): Promise<TestAuthoringResult> {
      if (behavior.confidence < 0.85 || behavior.needsClarification || behavior.risk !== "low") {
        return {
          status: "skipped",
          behaviorId: behavior.id,
          reason: "Behavior requires clarification or review before automatic test authoring",
        };
      }

      let draft: E2ETestDraft | null;
      try {
        draft = await dependencies.generator.generate(behavior, existingTests);
      } catch (error: any) {
        return { status: "rejected", behaviorId: behavior.id, reason: `Draft generation failed: ${error?.message ?? error}` };
      }
      if (!draft) return { status: "rejected", behaviorId: behavior.id, reason: "Test generator returned no draft" };

      const errors = validateTestDraft(draft, behavior);
      if (errors.length > 0) {
        return { status: "rejected", behaviorId: behavior.id, targetFile: draft.targetFile, reason: errors.join("; ") };
      }

      const targetPath = resolveTarget(dependencies.testRepoRoot, draft.targetFile);
      if (!targetPath) return { status: "rejected", behaviorId: behavior.id, reason: "Resolved target escaped the test repository" };
      const previous = await readExisting(targetPath);
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, assembledContent(previous, draft), "utf8");

      const runnerTarget = draft.targetFile.replace(/\\/g, "/");
      try {
        const firstRun = await dependencies.runner.run([runnerTarget], `${sessionId}:author:1`);
        const secondRun = firstRun.passed
          ? await dependencies.runner.run([runnerTarget], `${sessionId}:author:2`)
          : firstRun;
        if (!firstRun.passed || !secondRun.passed) {
          if (previous === null) await fs.rm(targetPath, { force: true });
          else await fs.writeFile(targetPath, previous, "utf8");
          return {
            status: "rejected",
            behaviorId: behavior.id,
            targetFile: draft.targetFile,
            reason: "Generated test did not pass two validation runs",
          };
        }
      } catch (error: any) {
        if (previous === null) await fs.rm(targetPath, { force: true });
        else await fs.writeFile(targetPath, previous, "utf8");
        return { status: "rejected", behaviorId: behavior.id, targetFile: draft.targetFile, reason: `Validation failed: ${error?.message ?? error}` };
      }

      const [parsed] = parseTestFile(draft.targetFile, draft.code);
      logger.info(`Authored and validated ${parsed.id} for behavior ${behavior.id}`);
      return { status: "applied", behaviorId: behavior.id, targetFile: draft.targetFile, testId: parsed.id };
    },
  };
}

export const e2eTestAuthoringService = createE2ETestAuthoringService();
