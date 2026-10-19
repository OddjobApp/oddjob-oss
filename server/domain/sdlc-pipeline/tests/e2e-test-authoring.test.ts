import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createE2ETestAuthoringService,
  validateTestDraft,
  type E2ETestDraft,
} from "../autonomous/e2e-test-authoring.service.js";
import type { TestRunner } from "../autonomous/test-loop-controller.service.js";
import type { UIBehaviorContract } from "../autonomous/ui-behavior-reconciler.service.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

function behavior(): UIBehaviorContract {
  return {
    id: "ui.health.navigation.e2e-tests.12345678",
    name: "Navigate to E2E tests",
    kind: "navigation",
    route: "/health/e2e-tests",
    actor: "authenticated user",
    preconditions: ["The user has an active session"],
    action: "Navigate to /health/e2e-tests",
    expectedOutcome: "The E2E test health screen is rendered",
    sourceFile: "client/src/modules/health/pages/HealthOverview.tsx",
    sourceRefs: ["documentation:ui-spec"],
    confidence: 0.9,
    risk: "low",
    needsClarification: false,
    introducedByVersionId: "v2",
  };
}

function draft(contract = behavior()): E2ETestDraft {
  return {
    behaviorId: contract.id,
    testName: "opens E2E test health",
    targetFile: "tests/regression/generated/health-e2e.spec.ts",
    rationale: "Covers the new Health navigation behavior",
    code: `test('opens E2E test health', async ({ page }) => {\n  // @behavior ${contract.id}\n  await page.goto('/health/e2e-tests');\n  await expect(page.getByRole('heading', { name: 'E2E Test Health' })).toBeVisible();\n});`,
  };
}

async function tempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "oddjob-e2e-author-"));
  temporaryRoots.push(root);
  return root;
}

describe("E2E test authoring", () => {
  it("rejects drafts that escape the generated regression directory", () => {
    const unsafe = { ...draft(), targetFile: "../tests/smoke/dashboard.spec.ts" };
    expect(validateTestDraft(unsafe, behavior())).toContain(
      "Target file must stay under tests/regression/generated and end in .spec.ts",
    );
  });

  it("writes a valid atomic test only after two passing validation runs", async () => {
    const root = await tempRoot();
    let runCount = 0;
    const runner: TestRunner = {
      async run(testFiles) {
        runCount++;
        return { passed: true, passingTests: testFiles, failingTests: [], output: "ok", duration: 1 };
      },
    };
    const service = createE2ETestAuthoringService({
      testRepoRoot: root,
      runner,
      generator: { async generate(contract) { return draft(contract); } },
    });

    const result = await service.authorAndValidate(behavior(), [], "session-1");
    const written = await fs.readFile(path.join(root, draft().targetFile), "utf8");
    expect(result).toMatchObject({ status: "applied", testId: "health-e2e:opens_e2e_test_health" });
    expect(runCount).toBe(2);
    expect(written).toContain(`@behavior ${behavior().id}`);
  });

  it("rolls back a generated file when validation fails", async () => {
    const root = await tempRoot();
    const runner: TestRunner = {
      async run(testFiles) {
        return {
          passed: false,
          passingTests: [],
          failingTests: [{ testFile: testFiles[0], testName: "draft", errorMessage: "failed" }],
          output: "failed",
          duration: 1,
        };
      },
    };
    const service = createE2ETestAuthoringService({
      testRepoRoot: root,
      runner,
      generator: { async generate(contract) { return draft(contract); } },
    });

    const result = await service.authorAndValidate(behavior(), [], "session-2");
    await expect(fs.stat(path.join(root, draft().targetFile))).rejects.toThrow();
    expect(result).toMatchObject({ status: "rejected", reason: "Generated test did not pass two validation runs" });
  });
});
