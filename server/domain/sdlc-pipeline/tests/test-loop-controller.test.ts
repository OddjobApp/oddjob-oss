import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createVitestRunner,
  testLoopControllerService,
  type TestRunner,
  type TestRunResult,
  type FailureDiagnoser,
  type FixGenerator,
  type FailingTest,
} from "../autonomous/test-loop-controller.service.js";
import type { FailureDiagnosis, AppliedFix } from "../core/types.js";

// ─── Test Helpers ───────────────────────────────────────────────────────────

function makeFailingTest(overrides: Partial<FailingTest> = {}): FailingTest {
  return {
    testFile: overrides.testFile ?? "src/example.test.ts",
    testName: overrides.testName ?? "should do something",
    errorMessage: overrides.errorMessage ?? "Expected true but got false",
    stackTrace: overrides.stackTrace,
  };
}

function makeDiagnosis(failure: FailingTest): FailureDiagnosis {
  return {
    testFile: failure.testFile,
    testName: failure.testName,
    errorMessage: failure.errorMessage,
    stackTrace: failure.stackTrace,
    rootCause: `Root cause for ${failure.testName}`,
    affectedFile: failure.testFile.replace(".test.", "."),
    suggestedApproach: "Fix the code",
  };
}

function makeFix(diagnosis: FailureDiagnosis): AppliedFix {
  return {
    filePath: diagnosis.affectedFile,
    changes: [
      {
        startLine: 1,
        endLine: 1,
        originalCode: "// broken",
        newCode: "// fixed",
        contextLines: 0,
      },
    ],
    description: `Fix for ${diagnosis.rootCause}`,
  };
}

/**
 * Creates a test runner that follows a sequence of results.
 * Each call to run() returns the next result in the sequence.
 */
function createSequentialTestRunner(results: TestRunResult[]): TestRunner {
  let callIndex = 0;
  return {
    async run(_testFiles: string[], _sessionId: string): Promise<TestRunResult> {
      const result = results[callIndex] ?? results[results.length - 1];
      callIndex++;
      return result;
    },
  };
}

function createAllPassRunner(): TestRunner {
  return {
    async run(testFiles: string[], _sessionId: string): Promise<TestRunResult> {
      return {
        passed: true,
        passingTests: testFiles,
        failingTests: [],
        output: "All tests passed.",
        duration: 10,
      };
    },
  };
}

function createAlwaysFailingRunner(failures: FailingTest[]): TestRunner {
  return {
    async run(testFiles: string[], _sessionId: string): Promise<TestRunResult> {
      return {
        passed: false,
        passingTests: testFiles.filter(
          (f) => !failures.some((fail) => fail.testFile === f)
        ),
        failingTests: failures,
        output: "Tests failed.",
        duration: 10,
      };
    },
  };
}

function createDefaultDiagnoser(): FailureDiagnoser {
  return {
    async diagnose(
      failure: FailingTest,
      _testOutput: string,
      _sessionId: string
    ): Promise<FailureDiagnosis> {
      return makeDiagnosis(failure);
    },
  };
}

function createDefaultFixGenerator(): FixGenerator {
  return {
    async generateFix(
      diagnosis: FailureDiagnosis,
      _sessionId: string
    ): Promise<AppliedFix> {
      return makeFix(diagnosis);
    },
    async applyFix(_fix: AppliedFix, _sessionId: string): Promise<void> {},
    async revertFix(_fix: AppliedFix, _sessionId: string): Promise<void> {},
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("TestLoopControllerService", () => {
  const sessionId = "test-session-loop";

  beforeEach(() => {
    // Reset configuration to defaults before each test
    testLoopControllerService.configure({
      testRunner: createAllPassRunner(),
      failureDiagnoser: createDefaultDiagnoser(),
      fixGenerator: createDefaultFixGenerator(),
    });
  });

  // ─── All Pass Initial Run ─────────────────────────────────────────────

  describe("all tests pass initially", () => {
    it("should return 'all_passed' with 0 attempts when tests pass on first run", async () => {
      testLoopControllerService.configure({
        testRunner: createAllPassRunner(),
      });

      const result = await testLoopControllerService.executeLoop(
        sessionId,
        ["src/a.test.ts", "src/b.test.ts"],
        5
      );

      expect(result.status).toBe("all_passed");
      expect(result.totalAttempts).toBe(0);
      expect(result.fixAttempts).toHaveLength(0);
      expect(result.failingTests).toHaveLength(0);
      expect(result.passingTests).toContain("src/a.test.ts");
      expect(result.passingTests).toContain("src/b.test.ts");
    });
  });

  // ─── Max Attempts Enforcement ─────────────────────────────────────────

  describe("max attempts enforcement", () => {
    it("should report exhausted on a real failing Vitest invocation instead of stubbed success", async () => {
      testLoopControllerService.configure({
        testRunner: createVitestRunner(30_000),
        failureDiagnoser: createDefaultDiagnoser(),
        fixGenerator: createDefaultFixGenerator(),
      });

      const missingTestFile = "server/domain/sdlc-pipeline/tests/does-not-exist.test.ts";
      const result = await testLoopControllerService.executeLoop(
        sessionId,
        [missingTestFile],
        0
      );

      expect(result.status).toBe("exhausted");
      expect(result.failingTests[0]).toContain(missingTestFile);
      expect(result.passingTests).toHaveLength(0);
    });

    it("should terminate loop after maxAttempts iterations", async () => {
      const failure = makeFailingTest({
        testFile: "src/widget.test.ts",
        testName: "renders correctly",
      });

      testLoopControllerService.configure({
        testRunner: createAlwaysFailingRunner([failure]),
        failureDiagnoser: createDefaultDiagnoser(),
        fixGenerator: createDefaultFixGenerator(),
      });

      const maxAttempts = 3;
      const result = await testLoopControllerService.executeLoop(
        sessionId,
        ["src/widget.test.ts"],
        maxAttempts
      );

      expect(result.status).toBe("exhausted");
      expect(result.totalAttempts).toBe(maxAttempts);
      expect(result.fixAttempts).toHaveLength(maxAttempts);
      expect(result.failingTests.length).toBeGreaterThan(0);
    });

    it("should not exceed maxAttempts of 1", async () => {
      const failure = makeFailingTest();

      testLoopControllerService.configure({
        testRunner: createAlwaysFailingRunner([failure]),
        failureDiagnoser: createDefaultDiagnoser(),
        fixGenerator: createDefaultFixGenerator(),
      });

      const result = await testLoopControllerService.executeLoop(
        sessionId,
        ["src/example.test.ts"],
        1
      );

      expect(result.totalAttempts).toBe(1);
      expect(result.fixAttempts).toHaveLength(1);
    });

    it("should return 'exhausted' when max attempts reached with remaining failures", async () => {
      const failure = makeFailingTest({
        testFile: "src/core.test.ts",
        testName: "processes data",
      });

      testLoopControllerService.configure({
        testRunner: createAlwaysFailingRunner([failure]),
        failureDiagnoser: createDefaultDiagnoser(),
        fixGenerator: createDefaultFixGenerator(),
      });

      const result = await testLoopControllerService.executeLoop(
        sessionId,
        ["src/core.test.ts"],
        5
      );

      expect(result.status).toBe("exhausted");
      expect(result.totalAttempts).toBe(5);
      expect(result.failingTests).toContain("src/core.test.ts::processes data");
    });
  });

  // ─── Regression Detection ─────────────────────────────────────────────

  describe("regression detection", () => {
    it("should detect and revert a fix that introduces new failures", async () => {
      const originalFailure = makeFailingTest({
        testFile: "src/auth.test.ts",
        testName: "validates token",
      });

      const regressionFailure: FailingTest = {
        testFile: "src/user.test.ts",
        testName: "creates user",
        errorMessage: "Unexpected undefined",
      };

      // Initial run: auth test fails
      // After fix: auth test still fails + user test now fails (regression)
      const runner = createSequentialTestRunner([
        // Initial run
        {
          passed: false,
          passingTests: ["src/user.test.ts"],
          failingTests: [originalFailure],
          output: "auth test failed",
          duration: 10,
        },
        // After fix attempt 1: introduces regression
        {
          passed: false,
          passingTests: [],
          failingTests: [originalFailure, regressionFailure],
          output: "auth and user tests failed",
          duration: 10,
        },
        // After revert + attempt 2: same as before
        {
          passed: false,
          passingTests: ["src/user.test.ts"],
          failingTests: [originalFailure],
          output: "auth test failed",
          duration: 10,
        },
      ]);

      const revertSpy = vi.fn();

      testLoopControllerService.configure({
        testRunner: runner,
        failureDiagnoser: createDefaultDiagnoser(),
        fixGenerator: {
          async generateFix(diagnosis, _sessionId) {
            return makeFix(diagnosis);
          },
          async applyFix(_fix, _sessionId) {},
          async revertFix(_fix, _sessionId) {
            revertSpy();
          },
        },
      });

      const result = await testLoopControllerService.executeLoop(
        sessionId,
        ["src/auth.test.ts", "src/user.test.ts"],
        2
      );

      // First attempt should have regression_detected outcome
      expect(result.fixAttempts[0].outcome).toBe("regression_detected");
      expect(result.fixAttempts[0].newFailuresIntroduced).toContain(
        "src/user.test.ts::creates user"
      );
      // Revert should have been called
      expect(revertSpy).toHaveBeenCalled();
    });

    it("should record 'regression_detected' outcome with new failure names", async () => {
      const originalFailure = makeFailingTest({
        testFile: "src/api.test.ts",
        testName: "returns 200",
      });

      const newFailure: FailingTest = {
        testFile: "src/db.test.ts",
        testName: "connects to DB",
        errorMessage: "Connection refused",
      };

      const runner = createSequentialTestRunner([
        // Initial: api test fails
        {
          passed: false,
          passingTests: ["src/db.test.ts"],
          failingTests: [originalFailure],
          output: "",
          duration: 5,
        },
        // After fix: new failure introduced
        {
          passed: false,
          passingTests: [],
          failingTests: [originalFailure, newFailure],
          output: "",
          duration: 5,
        },
      ]);

      testLoopControllerService.configure({
        testRunner: runner,
        failureDiagnoser: createDefaultDiagnoser(),
        fixGenerator: createDefaultFixGenerator(),
      });

      const result = await testLoopControllerService.executeLoop(
        sessionId,
        ["src/api.test.ts", "src/db.test.ts"],
        1
      );

      expect(result.fixAttempts[0].outcome).toBe("regression_detected");
      expect(result.fixAttempts[0].newFailuresIntroduced).toEqual([
        "src/db.test.ts::connects to DB",
      ]);
    });
  });

  // ─── Partially Fixed ──────────────────────────────────────────────────

  describe("partially fixed", () => {
    it("should return 'partially_fixed' when some but not all failures are resolved", async () => {
      const failure1 = makeFailingTest({
        testFile: "src/a.test.ts",
        testName: "test A",
      });
      const failure2 = makeFailingTest({
        testFile: "src/b.test.ts",
        testName: "test B",
      });

      const runner = createSequentialTestRunner([
        // Initial: both fail
        {
          passed: false,
          passingTests: [],
          failingTests: [failure1, failure2],
          output: "",
          duration: 5,
        },
        // After fix 1: failure1 resolved, failure2 remains
        {
          passed: false,
          passingTests: ["src/a.test.ts"],
          failingTests: [failure2],
          output: "",
          duration: 5,
        },
        // After fix 2: failure2 still remains (fix failed)
        {
          passed: false,
          passingTests: ["src/a.test.ts"],
          failingTests: [failure2],
          output: "",
          duration: 5,
        },
      ]);

      testLoopControllerService.configure({
        testRunner: runner,
        failureDiagnoser: createDefaultDiagnoser(),
        fixGenerator: createDefaultFixGenerator(),
      });

      const result = await testLoopControllerService.executeLoop(
        sessionId,
        ["src/a.test.ts", "src/b.test.ts"],
        2
      );

      expect(result.status).toBe("partially_fixed");
      expect(result.fixAttempts.some((a) => a.outcome === "resolved")).toBe(true);
      expect(result.failingTests.length).toBeGreaterThan(0);
    });
  });

  // ─── Fix Succeeds Mid-Loop ────────────────────────────────────────────

  describe("fix resolves all failures", () => {
    it("should return 'all_passed' when fix resolves all remaining failures", async () => {
      const failure = makeFailingTest({
        testFile: "src/calc.test.ts",
        testName: "adds numbers",
      });

      const runner = createSequentialTestRunner([
        // Initial: failure
        {
          passed: false,
          passingTests: [],
          failingTests: [failure],
          output: "",
          duration: 5,
        },
        // After fix: all pass
        {
          passed: true,
          passingTests: ["src/calc.test.ts"],
          failingTests: [],
          output: "All tests passed.",
          duration: 5,
        },
      ]);

      testLoopControllerService.configure({
        testRunner: runner,
        failureDiagnoser: createDefaultDiagnoser(),
        fixGenerator: createDefaultFixGenerator(),
      });

      const result = await testLoopControllerService.executeLoop(
        sessionId,
        ["src/calc.test.ts"],
        5
      );

      expect(result.status).toBe("all_passed");
      expect(result.totalAttempts).toBe(1);
      expect(result.fixAttempts[0].outcome).toBe("resolved");
      expect(result.failingTests).toHaveLength(0);
    });
  });

  // ─── Stall Warning ────────────────────────────────────────────────────

  describe("stall warning logging", () => {
    it("should log a warning when a fix attempt exceeds 60 seconds", async () => {
      const failure = makeFailingTest({
        testFile: "src/slow.test.ts",
        testName: "slow test",
      });

      // We'll create a slow runner that introduces actual measurable delay
      // but mock Date.now to control time perception for the stall threshold.
      // The key: the service computes attemptDuration = Date.now() - attemptStartTime
      // We need attemptDuration > 60_000.

      // Strategy: make the test runner artificially slow by having applyFix take "time"
      // by manipulating Date.now calls in a controlled way.
      let nowValue = 1_000_000;
      const originalDateNow = Date.now;

      // Override Date.now globally for this test
      Date.now = () => nowValue;

      // Create a fix generator where applyFix advances the clock past 60s
      const fixGenerator: FixGenerator = {
        async generateFix(diagnosis, _sessionId) {
          return makeFix(diagnosis);
        },
        async applyFix(_fix, _sessionId) {
          // Simulate a slow fix application by advancing time by 65 seconds
          nowValue += 65_000;
        },
        async revertFix(_fix, _sessionId) {},
      };

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const runner = createSequentialTestRunner([
        // Initial: failure
        {
          passed: false,
          passingTests: [],
          failingTests: [failure],
          output: "fail",
          duration: 5,
        },
        // After fix: still fails
        {
          passed: false,
          passingTests: [],
          failingTests: [failure],
          output: "still fail",
          duration: 5,
        },
      ]);

      testLoopControllerService.configure({
        testRunner: runner,
        failureDiagnoser: createDefaultDiagnoser(),
        fixGenerator,
      });

      const result = await testLoopControllerService.executeLoop(
        sessionId,
        ["src/slow.test.ts"],
        1
      );

      // Restore Date.now before assertions
      Date.now = originalDateNow;

      // The stall warning should have been logged via console.warn (the logger's output)
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("exceeded 60 seconds")
      );

      // The attempt duration should exceed 60,000ms
      expect(result.fixAttempts[0].duration).toBeGreaterThan(60_000);

      warnSpy.mockRestore();
    });
  });

  // ─── Fix Attempt Record Completeness ──────────────────────────────────

  describe("fix attempt record fields", () => {
    it("should record all required fields in FixAttemptRecord", async () => {
      const failure = makeFailingTest({
        testFile: "src/widget.test.ts",
        testName: "renders widget",
        errorMessage: "Cannot read property 'x' of undefined",
        stackTrace: "at Widget.render (widget.ts:10)",
      });

      const runner = createSequentialTestRunner([
        {
          passed: false,
          passingTests: [],
          failingTests: [failure],
          output: "widget test failed",
          duration: 10,
        },
        {
          passed: false,
          passingTests: [],
          failingTests: [failure],
          output: "still failing",
          duration: 10,
        },
      ]);

      testLoopControllerService.configure({
        testRunner: runner,
        failureDiagnoser: createDefaultDiagnoser(),
        fixGenerator: createDefaultFixGenerator(),
      });

      const result = await testLoopControllerService.executeLoop(
        sessionId,
        ["src/widget.test.ts"],
        1
      );

      expect(result.fixAttempts).toHaveLength(1);
      const record = result.fixAttempts[0];

      // Verify all required fields
      expect(record.attemptNumber).toBe(1);
      expect(record.timestamp).toBeInstanceOf(Date);
      expect(record.duration).toBeGreaterThanOrEqual(0);
      expect(record.outcome).toBeDefined();
      expect(["resolved", "failed", "regression_detected", "reverted"]).toContain(
        record.outcome
      );

      // Verify diagnosis completeness
      expect(record.diagnosis).toBeDefined();
      expect(record.diagnosis.testFile).toBe("src/widget.test.ts");
      expect(record.diagnosis.testName).toBe("renders widget");
      expect(record.diagnosis.errorMessage).toBe(
        "Cannot read property 'x' of undefined"
      );
      expect(record.diagnosis.rootCause).toBeTruthy();
      expect(record.diagnosis.affectedFile).toBeTruthy();
      expect(record.diagnosis.suggestedApproach).toBeTruthy();

      // Verify applied fix
      expect(record.appliedFix).toBeDefined();
      expect(record.appliedFix.filePath).toBeTruthy();
      expect(record.appliedFix.changes).toBeDefined();
      expect(record.appliedFix.description).toBeTruthy();

      // Verify newFailuresIntroduced is an array
      expect(Array.isArray(record.newFailuresIntroduced)).toBe(true);
    });

    it("should have sequential attempt numbers starting at 1", async () => {
      const failure = makeFailingTest();

      testLoopControllerService.configure({
        testRunner: createAlwaysFailingRunner([failure]),
        failureDiagnoser: createDefaultDiagnoser(),
        fixGenerator: createDefaultFixGenerator(),
      });

      const result = await testLoopControllerService.executeLoop(
        sessionId,
        ["src/example.test.ts"],
        4
      );

      expect(result.fixAttempts).toHaveLength(4);
      for (let i = 0; i < 4; i++) {
        expect(result.fixAttempts[i].attemptNumber).toBe(i + 1);
      }
    });
  });

  // ─── Escalation on Consecutive Regressions ────────────────────────────

  describe("escalation", () => {
    it("should escalate after 3 consecutive regressions", async () => {
      const originalFailure = makeFailingTest({
        testFile: "src/core.test.ts",
        testName: "core test",
      });

      const regressionFailure: FailingTest = {
        testFile: "src/new.test.ts",
        testName: "new test",
        errorMessage: "regression",
      };

      // Every fix attempt introduces a regression
      const runner = createSequentialTestRunner([
        // Initial
        {
          passed: false,
          passingTests: ["src/new.test.ts"],
          failingTests: [originalFailure],
          output: "",
          duration: 5,
        },
        // After attempt 1: regression
        {
          passed: false,
          passingTests: [],
          failingTests: [originalFailure, regressionFailure],
          output: "",
          duration: 5,
        },
        // After attempt 2: regression again
        {
          passed: false,
          passingTests: [],
          failingTests: [originalFailure, regressionFailure],
          output: "",
          duration: 5,
        },
        // After attempt 3: regression again
        {
          passed: false,
          passingTests: [],
          failingTests: [originalFailure, regressionFailure],
          output: "",
          duration: 5,
        },
      ]);

      testLoopControllerService.configure({
        testRunner: runner,
        failureDiagnoser: createDefaultDiagnoser(),
        fixGenerator: createDefaultFixGenerator(),
      });

      const result = await testLoopControllerService.executeLoop(
        sessionId,
        ["src/core.test.ts", "src/new.test.ts"],
        10
      );

      expect(result.status).toBe("escalated");
      expect(
        result.fixAttempts.every((a) => a.outcome === "regression_detected")
      ).toBe(true);
    });
  });

  // ─── Duration Tracking ────────────────────────────────────────────────

  describe("duration tracking", () => {
    it("should record a positive total duration", async () => {
      testLoopControllerService.configure({
        testRunner: createAllPassRunner(),
      });

      const result = await testLoopControllerService.executeLoop(
        sessionId,
        ["src/a.test.ts"],
        5
      );

      expect(result.duration).toBeGreaterThanOrEqual(0);
    });
  });
});
