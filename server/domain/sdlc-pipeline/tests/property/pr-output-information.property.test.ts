/**
 * Property Test: PR output contains all required information (Property 11)
 *
 * Feature: autonomous-codegen-pipelines, Property 11: PR output contains all required information
 *
 * For any successful PR generation, the commit message SHALL contain the session
 * objective AND the PR description SHALL contain: objective, changes summary,
 * test results summary, and verification report reference.
 *
 * Uses fast-check for property-based testing with minimum 100 iterations.
 *
 * **Validates: Requirements 5.2, 5.3**
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  buildCommitMessage,
  buildPRDescription,
} from "../../autonomous/pr-generator.service.js";
import type {
  FileOperation,
  VerificationReport,
  VerificationEvent,
  VerificationLevel,
  DetectedConventions,
} from "../../core/types.js";

// ─── Arbitraries ────────────────────────────────────────────────────────────

/**
 * Generates a non-empty objective string (alpha-numeric words).
 * Kept short enough to be realistic but unique enough to search for.
 */
const objectiveArb: fc.Arbitrary<string> = fc
  .array(fc.stringMatching(/^[a-z]{3,10}$/), { minLength: 2, maxLength: 8 })
  .map((words) => words.join(" "));

/** Generates a valid file path */
const filePathArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom("src/", "lib/", "server/", "app/", "utils/"),
    fc.stringMatching(/^[a-z][a-z0-9-]{1,15}$/),
    fc.constantFrom(".ts", ".js", ".tsx", ".jsx", ".json")
  )
  .map(([dir, name, ext]) => `${dir}${name}${ext}`);

/** Generates a non-empty rationale string */
const rationaleArb: fc.Arbitrary<string> = fc
  .array(fc.stringMatching(/^[a-z]{3,8}$/), { minLength: 2, maxLength: 6 })
  .map((words) => words.join(" "));

/** Generates a unique operation ID */
const operationIdArb: fc.Arbitrary<string> = fc
  .nat({ max: 9999 })
  .map((n) => `op-${n}`);

/** Generates a 'create' FileOperation */
const createOperationArb: fc.Arbitrary<FileOperation> = fc
  .tuple(operationIdArb, filePathArb, rationaleArb, fc.string({ minLength: 1, maxLength: 100 }))
  .map(([id, filePath, rationale, newContent]) => ({
    id,
    type: "create" as const,
    filePath,
    dependsOn: [],
    rationale,
    newContent,
  }));

/** Generates a 'modify' FileOperation */
const modifyOperationArb: fc.Arbitrary<FileOperation> = fc
  .tuple(operationIdArb, filePathArb, rationaleArb)
  .map(([id, filePath, rationale]) => ({
    id,
    type: "modify" as const,
    filePath,
    dependsOn: [],
    rationale,
    changes: [
      {
        startLine: 1,
        endLine: 10,
        originalCode: "const x = 1;",
        newCode: "const x = 2;",
        contextLines: 3,
      },
    ],
  }));

/** Generates a 'delete' FileOperation */
const deleteOperationArb: fc.Arbitrary<FileOperation> = fc
  .tuple(operationIdArb, filePathArb, rationaleArb)
  .map(([id, filePath, rationale]) => ({
    id,
    type: "delete" as const,
    filePath,
    dependsOn: [],
    rationale,
  }));

/** Generates any FileOperation */
const fileOperationArb: fc.Arbitrary<FileOperation> = fc.oneof(
  createOperationArb,
  modifyOperationArb,
  deleteOperationArb
);

/** Generates a non-empty array of FileOperations with unique IDs */
const operationsArb: fc.Arbitrary<FileOperation[]> = fc
  .array(fileOperationArb, { minLength: 1, maxLength: 10 })
  .map((ops) => ops.map((op, idx) => ({ ...op, id: `op-${idx}` })));

/** Generates a verification level */
const verificationLevelArb: fc.Arbitrary<VerificationLevel> = fc.constantFrom(
  "none" as const,
  "lint_only" as const,
  "type_check" as const,
  "full_test" as const
);

/** Generates a VerificationEvent */
const verificationEventArb: fc.Arbitrary<VerificationEvent> = fc
  .tuple(
    fc.date({ min: new Date("2024-01-01"), max: new Date("2025-12-31") }),
    fc.constantFrom(
      "step_check" as const,
      "test_loop_iteration" as const,
      "fix_attempt" as const,
      "quality_gate" as const
    ),
    fc.constantFrom("passed" as const, "failed" as const, "skipped" as const),
    fc.nat({ max: 30000 })
  )
  .map(([timestamp, type, status, duration]) => ({
    timestamp,
    type,
    operationId: `op-${duration % 100}`,
    status,
    details: {},
    duration,
  }));

/** Generates a VerificationReport */
const verificationReportArb: fc.Arbitrary<VerificationReport> = fc
  .tuple(
    fc.stringMatching(/^session-[a-z0-9]{4,8}$/),
    verificationLevelArb,
    fc.array(verificationEventArb, { minLength: 0, maxLength: 10 }),
    fc.nat({ max: 20 }),
    fc.nat({ max: 10 })
  )
  .map(([sessionId, verificationLevel, timeline, fixAttempts, successfulFixes]) => {
    const passed = timeline.filter((e) => e.status === "passed").length;
    const failed = timeline.filter((e) => e.status === "failed").length;
    const totalDuration = timeline.reduce((sum, e) => sum + e.duration, 0);
    return {
      sessionId,
      verificationLevel,
      timeline,
      summary: {
        totalChecks: timeline.length,
        passed,
        failed,
        fixAttempts,
        successfulFixes,
        totalDuration,
      },
      finalStatus: failed > 0 ? ("has_failures" as const) : ("all_passed" as const),
    };
  });

/** Generates DetectedConventions (minimal for this test) */
const conventionsArb: fc.Arbitrary<DetectedConventions> = fc
  .record({
    namingPatterns: fc.constant([]),
    formattingRules: fc.constant([]),
    architecturalPatterns: fc.constant([]),
    testingConventions: fc.constant([]),
    prTemplate: fc.constantFrom(undefined, "## PR Template\n\nDescription:"),
    branchNaming: fc.constantFrom(undefined, "codegen/{session-id}/{objective-slug}"),
  })
  .map((rec) => ({
    namingPatterns: rec.namingPatterns,
    formattingRules: rec.formattingRules,
    architecturalPatterns: rec.architecturalPatterns,
    testingConventions: rec.testingConventions,
    prTemplate: rec.prTemplate,
    branchNaming: rec.branchNaming,
  }));

// ─── Property Tests ─────────────────────────────────────────────────────────

describe("Feature: autonomous-codegen-pipelines, Property 11: PR output contains all required information", () => {
  /**
   * Property 11a: Commit message contains the session objective.
   *
   * For any objective and set of operations, the built commit message
   * SHALL contain the full objective text.
   *
   * **Validates: Requirements 5.2**
   */
  it("commit message contains the session objective text", () => {
    fc.assert(
      fc.property(objectiveArb, operationsArb, (objective, operations) => {
        const commitMessage = buildCommitMessage(objective, operations);

        // The commit message must contain the objective
        expect(commitMessage).toContain(objective);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 11b: Commit message contains a summary of changes.
   *
   * For any non-empty set of operations, the commit message SHALL
   * reference the total number of operations.
   *
   * **Validates: Requirements 5.2**
   */
  it("commit message contains changes summary referencing operation count", () => {
    fc.assert(
      fc.property(objectiveArb, operationsArb, (objective, operations) => {
        const commitMessage = buildCommitMessage(objective, operations);

        // Commit message should reference total operations count
        expect(commitMessage).toContain(`${operations.length} operation(s)`);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 11c: PR description contains the objective.
   *
   * For any objective, operations, report, and conventions, the PR description
   * SHALL contain the objective text.
   *
   * **Validates: Requirements 5.3**
   */
  it("PR description contains the objective", () => {
    fc.assert(
      fc.property(
        objectiveArb,
        operationsArb,
        verificationReportArb,
        conventionsArb,
        (objective, operations, report, conventions) => {
          const description = buildPRDescription(
            objective,
            operations,
            report,
            conventions
          );

          expect(description).toContain(objective);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 11d: PR description contains a changes summary section.
   *
   * For any operations, the PR description SHALL contain a "Changes Summary"
   * section and reference file paths from the operations.
   *
   * **Validates: Requirements 5.3**
   */
  it("PR description contains changes summary section with file paths", () => {
    fc.assert(
      fc.property(
        objectiveArb,
        operationsArb,
        verificationReportArb,
        conventionsArb,
        (objective, operations, report, conventions) => {
          const description = buildPRDescription(
            objective,
            operations,
            report,
            conventions
          );

          // Must contain the changes summary header
          expect(description).toContain("## Changes Summary");

          // Must contain at least one file path from operations
          const hasAtLeastOneFilePath = operations.some((op) =>
            description.includes(op.filePath)
          );
          expect(hasAtLeastOneFilePath).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 11e: PR description contains test results summary.
   *
   * For any verification report, the PR description SHALL contain a
   * "Test Results" section with check counts from the report summary.
   *
   * **Validates: Requirements 5.3**
   */
  it("PR description contains test results summary", () => {
    fc.assert(
      fc.property(
        objectiveArb,
        operationsArb,
        verificationReportArb,
        conventionsArb,
        (objective, operations, report, conventions) => {
          const description = buildPRDescription(
            objective,
            operations,
            report,
            conventions
          );

          // Must contain the test results section
          expect(description).toContain("## Test Results");

          // Must contain the total checks and passed values from the report
          expect(description).toContain(String(report.summary.totalChecks));
          expect(description).toContain(String(report.summary.passed));
          expect(description).toContain(String(report.summary.failed));
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 11f: PR description contains verification report reference.
   *
   * For any verification report, the PR description SHALL contain a
   * "Verification Report" section referencing the session ID and final status.
   *
   * **Validates: Requirements 5.3**
   */
  it("PR description contains verification report reference", () => {
    fc.assert(
      fc.property(
        objectiveArb,
        operationsArb,
        verificationReportArb,
        conventionsArb,
        (objective, operations, report, conventions) => {
          const description = buildPRDescription(
            objective,
            operations,
            report,
            conventions
          );

          // Must contain the verification report section
          expect(description).toContain("## Verification Report");

          // Must reference the session ID
          expect(description).toContain(report.sessionId);

          // Must reference the final status
          expect(description).toContain(report.finalStatus);

          // Must reference the verification level
          expect(description).toContain(report.verificationLevel);
        }
      ),
      { numRuns: 100 }
    );
  });
});
