import { describe, expect, it } from "vitest";
import {
  deriveBehaviorContracts,
  extractUiSignals,
  mapBehaviorCoverage,
  type UIBehaviorContract,
} from "../autonomous/ui-behavior-reconciler.service.js";
import type { ParsedTest } from "../autonomous/e2e-test-indexer.service.js";

describe("UI behavior reconciler", () => {
  it("recognizes newly introduced navigation and actions", () => {
    const previous = extractUiSignals(`export function Page() { return <div>Health</div>; }`);
    const current = extractUiSignals(`
      export function Page() {
        const run = () => fetch('/api/health/e2e-tests/run');
        return <div><a href="/health/e2e-tests">Tests</a><Button onClick={run}>Run Suite Now</Button></div>;
      }
    `);

    const contracts = deriveBehaviorContracts({
      versionId: "v2-test",
      sourceFile: "client/src/modules/health/pages/HealthOverview.tsx",
      current,
      previous,
      changeSummary: "Add E2E testing entry and run control",
      documentation: "E2E testing validates UI changes.",
    });

    expect(contracts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "navigation", route: "/health/e2e-tests", confidence: 0.9 }),
      expect.objectContaining({ kind: "action", action: "Activate Run Suite Now", confidence: 0.9 }),
    ]));
  });

  it("does not classify styling-only changes as new behavior", () => {
    const previous = extractUiSignals(`<Button>Run Suite Now</Button>`);
    const current = extractUiSignals(`<Button className="text-fuchsia-300">Run Suite Now</Button>`);
    expect(deriveBehaviorContracts({
      versionId: "v2-style",
      sourceFile: "client/src/modules/health/pages/HealthOverview.tsx",
      current,
      previous,
    })).toEqual([]);
  });

  it("links an atomic test to a behavior through its behavior marker", () => {
    const behavior: UIBehaviorContract = {
      id: "ui.health.action.run-suite.12345678",
      name: "Run Suite Now action",
      kind: "action",
      route: "/health/e2e-tests",
      actor: "authenticated user",
      preconditions: [],
      action: "Activate Run Suite Now",
      expectedOutcome: "A validation run starts",
      sourceFile: "client/src/modules/health/pages/TestHealthDashboard.tsx",
      sourceRefs: [],
      confidence: 0.9,
      risk: "low",
      needsClarification: false,
      introducedByVersionId: "v2",
    };
    const test: ParsedTest = {
      id: "generated:run_suite_now",
      testName: "runs the E2E suite",
      filePath: "playwright-test-repo/tests/regression/generated/health.spec.ts",
      startLine: 1,
      endLine: 5,
      code: `test('runs the E2E suite', async ({ page }) => { // @behavior ${behavior.id}\n await expect(page).toHaveURL('/health');\n});`,
    };

    expect(mapBehaviorCoverage([behavior], [test])[0]).toMatchObject({ covered: true, tests: [test] });
  });
});
