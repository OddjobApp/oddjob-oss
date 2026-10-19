/**
 * Property Test: Human review threshold enforcement (Property 6)
 *
 * Feature: autonomous-codegen-pipelines, Property 6: Human review threshold enforcement
 *
 * For any EditPlan with `totalFileCount > maxFileCount`, the plan's
 * `requiresHumanReview` flag SHALL be `true`. Conversely, for any plan with
 * `totalFileCount <= maxFileCount`, `requiresHumanReview` SHALL be `false`.
 *
 * **Validates: Requirements 2.5**
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { changePlannerService } from "../../autonomous/change-planner.service.js";
import type {
  RepositoryContext,
  RelevantFile,
  DependencyGraph,
  DetectedConventions,
} from "../../core/types.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Builds a minimal RepositoryContext with a given number of relevant files.
 * Each relevant file has a relevanceScore > 0 to ensure it becomes an operation.
 */
function buildContextWithFileCount(fileCount: number): RepositoryContext {
  const relevantFiles: RelevantFile[] = Array.from(
    { length: fileCount },
    (_, i) => ({
      path: `src/module-${i}/file-${i}.ts`,
      content: `// content for file ${i}\nconst x = ${i};\nexport default x;\n`,
      relevanceScore: 0.5,
    })
  );

  const dependencyGraph: DependencyGraph = {
    nodes: relevantFiles.map((f) => ({
      filePath: f.path,
      exports: ["default"],
      language: "typescript",
    })),
    edges: [],
  };

  const conventions: DetectedConventions = {
    namingPatterns: [],
    formattingRules: [],
    architecturalPatterns: ["service-layer"],
    testingConventions: [],
  };

  return {
    projectStructure: [{ path: "src", type: "directory" }],
    dependencyGraph,
    conventions,
    languageMetadata: {
      primaryLanguage: "typescript",
      frameworks: [],
      packageManager: "npm",
    },
    relevantFiles,
    tokenCount: fileCount * 50,
  };
}

// ─── Property Tests ─────────────────────────────────────────────────────────

describe("Feature: autonomous-codegen-pipelines, Property 6: Human review threshold enforcement", () => {
  it("when totalFileCount > maxFileCount, requiresHumanReview is true", async () => {
    await fc.assert(
      fc.asyncProperty(
        // maxFileCount between 1 and 100
        fc.integer({ min: 1, max: 100 }),
        // extra files above the threshold (1-100 extra)
        fc.integer({ min: 1, max: 100 }),
        async (maxFileCount, extraFiles) => {
          const totalFileCount = maxFileCount + extraFiles; // always > maxFileCount
          const context = buildContextWithFileCount(totalFileCount);

          const plan = await changePlannerService.generatePlan(
            "session-threshold-test",
            "Test objective exceeding threshold",
            context,
            maxFileCount
          );

          expect(plan.totalFileCount).toBeGreaterThan(maxFileCount);
          expect(plan.requiresHumanReview).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("when totalFileCount <= maxFileCount, requiresHumanReview is false", async () => {
    await fc.assert(
      fc.asyncProperty(
        // maxFileCount between 1 and 100
        fc.integer({ min: 1, max: 100 }),
        // totalFileCount is between 1 and maxFileCount (inclusive)
        fc.integer({ min: 1, max: 100 }),
        async (maxFileCount, rawFileCount) => {
          // Ensure totalFileCount <= maxFileCount
          const totalFileCount = Math.min(rawFileCount, maxFileCount);
          const context = buildContextWithFileCount(totalFileCount);

          const plan = await changePlannerService.generatePlan(
            "session-threshold-test",
            "Test objective within threshold",
            context,
            maxFileCount
          );

          expect(plan.totalFileCount).toBeLessThanOrEqual(maxFileCount);
          expect(plan.requiresHumanReview).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("boundary: totalFileCount exactly equals maxFileCount means no review required", async () => {
    await fc.assert(
      fc.asyncProperty(
        // maxFileCount between 1 and 100, and use that exact count for files
        fc.integer({ min: 1, max: 100 }),
        async (maxFileCount) => {
          const context = buildContextWithFileCount(maxFileCount);

          const plan = await changePlannerService.generatePlan(
            "session-boundary-test",
            "Test objective at exact boundary",
            context,
            maxFileCount
          );

          // At exactly the threshold, no review required (uses strict >)
          expect(plan.totalFileCount).toBe(maxFileCount);
          expect(plan.requiresHumanReview).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("default maxFileCount of 50 is enforced when none specified", async () => {
    await fc.assert(
      fc.asyncProperty(
        // totalFileCount between 51 and 200 (above default threshold of 50)
        fc.integer({ min: 51, max: 200 }),
        async (totalFileCount) => {
          const context = buildContextWithFileCount(totalFileCount);

          // No maxFileCount passed - should default to 50
          const plan = await changePlannerService.generatePlan(
            "session-default-threshold",
            "Test objective exceeding default threshold",
            context
          );

          expect(plan.totalFileCount).toBeGreaterThan(50);
          expect(plan.requiresHumanReview).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});
