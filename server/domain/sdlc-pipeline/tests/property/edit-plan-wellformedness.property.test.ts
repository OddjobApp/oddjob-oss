/**
 * Property-based tests for Edit Plan Operation Well-Formedness.
 *
 * Feature: autonomous-codegen-pipelines, Property 5: Edit plan operation well-formedness
 *
 * For any `modify` FileOperation in an EditPlan, the operation SHALL have a non-empty
 * `changes` array with valid line ranges (`startLine <= endLine`) and `contextLines > 0`.
 * Additionally, every operation (regardless of type) SHALL have a non-empty `rationale` string.
 *
 * Uses fast-check for property-based testing with minimum 100 iterations.
 *
 * **Validates: Requirements 2.3, 2.4**
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

import { changePlannerService } from "../../autonomous/change-planner.service.js";
import type {
  EditPlan,
  FileOperation,
  CodeChange,
} from "../../core/types.js";

// ─── fast-check Arbitraries ─────────────────────────────────────────────────

/** Generates a non-empty string (trimmed) for rationale */
const nonEmptyStringArb = fc
  .string({ minLength: 1, maxLength: 100 })
  .filter((s) => s.trim().length > 0);

/** Generates a valid file path */
const filePathArb = fc
  .tuple(
    fc.constantFrom("src/", "lib/", "server/", "app/"),
    fc.stringMatching(/^[a-z][a-z0-9-]{0,20}$/),
    fc.constantFrom(".ts", ".js", ".tsx", ".jsx")
  )
  .map(([dir, name, ext]) => `${dir}${name}${ext}`);

/** Generates a unique operation ID */
const operationIdArb = fc
  .tuple(fc.constant("op-"), fc.nat({ max: 999 }))
  .map(([prefix, n]) => `${prefix}${n}`);

/**
 * Generates a valid CodeChange with:
 * - startLine <= endLine
 * - contextLines > 0
 */
const validCodeChangeArb: fc.Arbitrary<CodeChange> = fc
  .tuple(
    fc.nat({ max: 1000 }).map((n) => n + 1), // startLine >= 1
    fc.nat({ max: 100 }),                      // offset for endLine
    fc.nat({ max: 50 }).map((n) => n + 1),    // contextLines > 0
    fc.string({ minLength: 0, maxLength: 50 }),
    fc.string({ minLength: 0, maxLength: 50 })
  )
  .map(([startLine, offset, contextLines, originalCode, newCode]) => ({
    startLine,
    endLine: startLine + offset, // ensures startLine <= endLine
    originalCode,
    newCode,
    contextLines,
  }));

/** Generates a non-empty array of valid CodeChanges */
const validCodeChangesArb = fc.array(validCodeChangeArb, {
  minLength: 1,
  maxLength: 5,
});

/**
 * Generates a well-formed 'modify' FileOperation:
 * - Non-empty `changes` array with valid line ranges and contextLines > 0
 * - Non-empty `rationale` string
 */
const wellFormedModifyOpArb: fc.Arbitrary<FileOperation> = fc
  .tuple(operationIdArb, filePathArb, nonEmptyStringArb, validCodeChangesArb)
  .map(([id, filePath, rationale, changes]) => ({
    id,
    type: "modify" as const,
    filePath,
    dependsOn: [],
    rationale,
    changes,
  }));

/**
 * Generates a well-formed 'create' FileOperation:
 * - Non-empty `rationale` string
 */
const wellFormedCreateOpArb: fc.Arbitrary<FileOperation> = fc
  .tuple(operationIdArb, filePathArb, nonEmptyStringArb, fc.string({ minLength: 0, maxLength: 200 }))
  .map(([id, filePath, rationale, newContent]) => ({
    id,
    type: "create" as const,
    filePath,
    dependsOn: [],
    rationale,
    newContent,
  }));

/**
 * Generates a well-formed 'delete' FileOperation:
 * - Non-empty `rationale` string
 */
const wellFormedDeleteOpArb: fc.Arbitrary<FileOperation> = fc
  .tuple(operationIdArb, filePathArb, nonEmptyStringArb)
  .map(([id, filePath, rationale]) => ({
    id,
    type: "delete" as const,
    filePath,
    dependsOn: [],
    rationale,
  }));

/** Generates any well-formed FileOperation (any type) */
const wellFormedOperationArb: fc.Arbitrary<FileOperation> = fc.oneof(
  wellFormedModifyOpArb,
  wellFormedCreateOpArb,
  wellFormedDeleteOpArb
);

/**
 * Generates a well-formed EditPlan with unique operation IDs.
 * Operations have no inter-dependencies (valid DAG with no edges).
 */
const wellFormedEditPlanArb: fc.Arbitrary<EditPlan> = fc
  .tuple(
    fc.uuid(),
    nonEmptyStringArb,
    fc.array(wellFormedOperationArb, { minLength: 1, maxLength: 10 })
  )
  .map(([sessionId, objective, ops]) => {
    // Ensure unique operation IDs
    const uniqueOps = ops.map((op, idx) => ({ ...op, id: `op-${idx}` }));
    return {
      sessionId,
      objective,
      operations: uniqueOps,
      dependencyOrder: uniqueOps.map((op) => op.id),
      totalFileCount: uniqueOps.length,
      requiresHumanReview: false,
    };
  });

/**
 * Generates an EditPlan containing at least one 'modify' operation with
 * well-formed changes.
 */
const editPlanWithModifyArb: fc.Arbitrary<EditPlan> = fc
  .tuple(
    fc.uuid(),
    nonEmptyStringArb,
    wellFormedModifyOpArb,
    fc.array(wellFormedOperationArb, { minLength: 0, maxLength: 5 })
  )
  .map(([sessionId, objective, modifyOp, otherOps]) => {
    const allOps = [modifyOp, ...otherOps].map((op, idx) => ({
      ...op,
      id: `op-${idx}`,
    }));
    return {
      sessionId,
      objective,
      operations: allOps,
      dependencyOrder: allOps.map((op) => op.id),
      totalFileCount: allOps.length,
      requiresHumanReview: false,
    };
  });

// ─── Property Tests ─────────────────────────────────────────────────────────

describe("Feature: autonomous-codegen-pipelines, Property 5: Edit plan operation well-formedness", () => {
  /**
   * Property 5a: For any `modify` FileOperation, `changes` is non-empty (length > 0).
   *
   * **Validates: Requirements 2.3**
   */
  describe("Modify operations have non-empty changes array", () => {
    it("any well-formed modify operation has at least one change entry", () => {
      fc.assert(
        fc.property(editPlanWithModifyArb, (plan) => {
          const modifyOps = plan.operations.filter((op) => op.type === "modify");

          for (const op of modifyOps) {
            expect(op.changes).toBeDefined();
            expect(op.changes!.length).toBeGreaterThan(0);
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 5b: For any `modify` FileOperation, each change has valid
   * line range: `startLine <= endLine`.
   *
   * **Validates: Requirements 2.3**
   */
  describe("Modify operations have valid line ranges (startLine <= endLine)", () => {
    it("all code changes in modify operations have startLine <= endLine", () => {
      fc.assert(
        fc.property(editPlanWithModifyArb, (plan) => {
          const modifyOps = plan.operations.filter((op) => op.type === "modify");

          for (const op of modifyOps) {
            for (const change of op.changes!) {
              expect(change.startLine).toBeLessThanOrEqual(change.endLine);
            }
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 5c: For any `modify` FileOperation, each change has
   * `contextLines > 0`.
   *
   * **Validates: Requirements 2.3**
   */
  describe("Modify operations have contextLines > 0", () => {
    it("all code changes in modify operations have positive contextLines", () => {
      fc.assert(
        fc.property(editPlanWithModifyArb, (plan) => {
          const modifyOps = plan.operations.filter((op) => op.type === "modify");

          for (const op of modifyOps) {
            for (const change of op.changes!) {
              expect(change.contextLines).toBeGreaterThan(0);
            }
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 5d: For ALL operations (any type), `rationale` is a non-empty string.
   *
   * **Validates: Requirements 2.4**
   */
  describe("All operations have non-empty rationale", () => {
    it("every operation regardless of type has a non-empty rationale string", () => {
      fc.assert(
        fc.property(wellFormedEditPlanArb, (plan) => {
          for (const op of plan.operations) {
            expect(typeof op.rationale).toBe("string");
            expect(op.rationale.trim().length).toBeGreaterThan(0);
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 5e: Any well-formed plan (meeting all well-formedness constraints)
   * passes `changePlannerService.validatePlan()`.
   *
   * **Validates: Requirements 2.3, 2.4**
   */
  describe("Well-formed plans pass validatePlan()", () => {
    it("any plan with valid modify operations and non-empty rationale passes validation", () => {
      fc.assert(
        fc.property(wellFormedEditPlanArb, (plan) => {
          const result = changePlannerService.validatePlan(plan);
          expect(result.valid).toBe(true);
          expect(result.errors).toHaveLength(0);
        }),
        { numRuns: 100 }
      );
    });

    it("plans with modify operations containing valid changes pass validation", () => {
      fc.assert(
        fc.property(editPlanWithModifyArb, (plan) => {
          const result = changePlannerService.validatePlan(plan);
          expect(result.valid).toBe(true);
          expect(result.errors).toHaveLength(0);
        }),
        { numRuns: 100 }
      );
    });
  });
});
