/**
 * Property Test: Edit plan dependency graph validity (Property 4)
 *
 * Feature: autonomous-codegen-pipelines, Property 4: Edit plan dependency graph validity
 *
 * For any generated EditPlan, all `dependsOn` references in every FileOperation
 * point to existing operation IDs within the same plan, AND the dependency graph
 * formed by these references is acyclic (topological sort succeeds).
 *
 * **Validates: Requirements 2.1, 2.2**
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  topologicalSort,
  changePlannerService,
} from "../../autonomous/change-planner.service.js";
import type { FileOperation, EditPlan } from "../../core/types.js";

// ─── Arbitraries ────────────────────────────────────────────────────────────

/**
 * Generates a unique operation ID string.
 */
function operationIdArb(index: number): fc.Arbitrary<string> {
  return fc.constant(`op-${index}`);
}

/**
 * Generates a valid FileOperation with dependencies only pointing to
 * previously generated operation IDs (ensuring a DAG structure).
 */
function validFileOperationArb(
  index: number,
  existingIds: string[]
): fc.Arbitrary<FileOperation> {
  const id = `op-${index}`;
  const typeArb = fc.constantFrom("create" as const, "modify" as const, "delete" as const);
  const filePathArb = fc.stringMatching(/^[a-z][a-z0-9/\-_.]{2,40}\.(ts|js|tsx|jsx)$/);

  // Dependencies can only reference existing IDs (generated earlier in the list)
  const dependsOnArb =
    existingIds.length === 0
      ? fc.constant([] as string[])
      : fc.subarray(existingIds, { minLength: 0, maxLength: Math.min(existingIds.length, 5) });

  const rationaleArb = fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ,.;:!?'\-]{5,80}$/);

  return fc.tuple(typeArb, filePathArb, dependsOnArb, rationaleArb).map(
    ([type, filePath, dependsOn, rationale]) => {
      const base: FileOperation = {
        id,
        type,
        filePath,
        dependsOn,
        rationale,
      };

      if (type === "create") {
        return { ...base, newContent: "// generated content" };
      } else if (type === "modify") {
        return {
          ...base,
          changes: [
            {
              startLine: 1,
              endLine: 5,
              originalCode: "// old code",
              newCode: "// new code",
              contextLines: 3,
            },
          ],
        };
      }
      // delete — no additional fields needed
      return base;
    }
  );
}

/**
 * Generates a valid EditPlan with 1-20 operations where all dependencies
 * form a valid DAG (each operation only depends on earlier operations).
 */
const validEditPlanArb: fc.Arbitrary<EditPlan> = fc
  .integer({ min: 1, max: 20 })
  .chain((numOps) => {
    // Build operations sequentially so each can only depend on earlier ones
    let arb: fc.Arbitrary<FileOperation[]> = fc.constant([]);

    for (let i = 0; i < numOps; i++) {
      arb = arb.chain((ops) => {
        const existingIds = ops.map((op) => op.id);
        return validFileOperationArb(i, existingIds).map((newOp) => [
          ...ops,
          newOp,
        ]);
      });
    }

    return arb;
  })
  .map((operations) => {
    const dependencyOrder = operations.map((op) => op.id);
    return {
      sessionId: "session-test",
      objective: "Test objective for property testing",
      operations,
      dependencyOrder,
      totalFileCount: operations.length,
      requiresHumanReview: false,
    };
  });

/**
 * Generates an invalid EditPlan with at least one dangling dependency reference
 * (referencing a non-existent operation ID).
 */
const invalidRefEditPlanArb: fc.Arbitrary<EditPlan> = fc
  .integer({ min: 1, max: 10 })
  .chain((numOps) => {
    let arb: fc.Arbitrary<FileOperation[]> = fc.constant([]);

    for (let i = 0; i < numOps; i++) {
      arb = arb.chain((ops) => {
        const existingIds = ops.map((op) => op.id);
        return validFileOperationArb(i, existingIds).map((newOp) => [
          ...ops,
          newOp,
        ]);
      });
    }

    return arb;
  })
  .chain((operations) => {
    // Pick a random operation and add a non-existent dependency
    const targetIdx = Math.floor(Math.random() * operations.length);
    return fc
      .stringMatching(/^op-nonexistent-[a-z0-9]{3,8}$/)
      .map((fakeId) => {
        const ops = [...operations];
        ops[targetIdx] = {
          ...ops[targetIdx],
          dependsOn: [...ops[targetIdx].dependsOn, fakeId],
        };
        return ops;
      });
  })
  .map((operations) => ({
    sessionId: "session-invalid-ref",
    objective: "Invalid reference test",
    operations,
    dependencyOrder: operations.map((op) => op.id),
    totalFileCount: operations.length,
    requiresHumanReview: false,
  }));

/**
 * Generates an EditPlan with a cycle in the dependency graph.
 * Creates at least 2 operations that form a cycle.
 */
const cyclicEditPlanArb: fc.Arbitrary<EditPlan> = fc
  .integer({ min: 2, max: 10 })
  .chain((numOps) => {
    return fc.integer({ min: 0, max: numOps - 2 }).map((cycleStart) => {
      const cycleEnd = cycleStart + 1;
      const operations: FileOperation[] = [];

      for (let i = 0; i < numOps; i++) {
        const deps: string[] = [];

        // Create a cycle: cycleStart depends on cycleEnd, cycleEnd depends on cycleStart
        if (i === cycleStart) {
          deps.push(`op-${cycleEnd}`);
        } else if (i === cycleEnd) {
          deps.push(`op-${cycleStart}`);
        }

        operations.push({
          id: `op-${i}`,
          type: "create",
          filePath: `src/file-${i}.ts`,
          dependsOn: deps,
          rationale: `Operation ${i} for cyclic test`,
          newContent: "// content",
        });
      }

      return operations;
    });
  })
  .map((operations) => ({
    sessionId: "session-cyclic",
    objective: "Cyclic dependency test",
    operations,
    dependencyOrder: [],
    totalFileCount: operations.length,
    requiresHumanReview: false,
  }));

// ─── Property Tests ─────────────────────────────────────────────────────────

describe("Feature: autonomous-codegen-pipelines, Property 4: Edit plan dependency graph validity", () => {
  it("all dependsOn references point to existing operation IDs within the same plan", () => {
    fc.assert(
      fc.property(validEditPlanArb, (plan) => {
        const operationIds = new Set(plan.operations.map((op) => op.id));

        for (const op of plan.operations) {
          for (const depId of op.dependsOn) {
            expect(operationIds.has(depId)).toBe(true);
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  it("dependency graph formed by dependsOn references is acyclic (topological sort succeeds)", () => {
    fc.assert(
      fc.property(validEditPlanArb, (plan) => {
        // topologicalSort should not throw for a valid DAG
        const sorted = topologicalSort(plan.operations);

        // All operation IDs should be present in the sorted output
        expect(sorted.length).toBe(plan.operations.length);
        const sortedSet = new Set(sorted);
        for (const op of plan.operations) {
          expect(sortedSet.has(op.id)).toBe(true);
        }

        // Verify topological ordering: for each operation, all its dependencies
        // must appear earlier in the sorted order
        const positionOf = new Map(sorted.map((id, idx) => [id, idx]));
        for (const op of plan.operations) {
          for (const depId of op.dependsOn) {
            expect(positionOf.get(depId)!).toBeLessThan(positionOf.get(op.id)!);
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  it("validatePlan detects dangling dependency references in invalid plans", () => {
    fc.assert(
      fc.property(invalidRefEditPlanArb, (plan) => {
        const result = changePlannerService.validatePlan(plan);

        // The plan should be invalid due to reference integrity errors
        expect(result.valid).toBe(false);
        expect(
          result.errors.some((e) => e.keyword === "referenceIntegrity")
        ).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it("validatePlan detects cycles in cyclic dependency graphs", () => {
    fc.assert(
      fc.property(cyclicEditPlanArb, (plan) => {
        const result = changePlannerService.validatePlan(plan);

        // The plan should be invalid due to circular dependency
        expect(result.valid).toBe(false);
        expect(
          result.errors.some((e) => e.keyword === "acyclicDependency")
        ).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it("topologicalSort throws on cyclic operations", () => {
    fc.assert(
      fc.property(cyclicEditPlanArb, (plan) => {
        expect(() => topologicalSort(plan.operations)).toThrow(
          /[Cc]ircular dependency/
        );
      }),
      { numRuns: 100 }
    );
  });
});
