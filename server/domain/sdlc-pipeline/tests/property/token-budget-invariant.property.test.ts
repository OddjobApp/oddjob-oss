/**
 * Property-based test for Token Budget Invariant.
 *
 * **Property 2: Token budget invariant**
 *
 * For any repository exceeding 10,000 files and any configured token budget,
 * the `RepositoryContext.tokenCount` SHALL be less than or equal to the
 * configured `contextTokenBudget`.
 *
 * **Validates: Requirements 1.2**
 *
 * Uses fast-check for property-based testing with a minimum of 100 iterations.
 * Tag: Feature: autonomous-codegen-pipelines, Property 2: Token budget invariant
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  applyTokenBudget,
  estimateTokenCount,
  LARGE_REPO_FILE_THRESHOLD,
} from "../../autonomous/repository-context-loader.service.js";
import type {
  RepositoryContext,
  FileTreeNode,
  RelevantFile,
} from "../../core/types.js";

// ─── Generators ───────────────────────────────────────────────────────────────

/**
 * Generate a random file path string (simulating a file in a large repo).
 */
const filePathArb = fc
  .tuple(
    fc.array(
      fc.stringOf(fc.constantFrom(...("abcdefghijklmnopqrstuvwxyz".split(""))), {
        minLength: 2,
        maxLength: 10,
      }),
      { minLength: 1, maxLength: 4 }
    ),
    fc.constantFrom(".ts", ".js", ".tsx", ".jsx", ".py", ".go")
  )
  .map(([segments, ext]) => segments.join("/") + "/file" + ext);

/**
 * Generate a RelevantFile with a content string whose size contributes to token count.
 * Content is sized to ensure the total context can exceed the budget.
 */
const relevantFileArb = fc
  .tuple(
    filePathArb,
    // Content between 100 and 10,000 characters (25-2500 tokens approx)
    fc.string({ minLength: 100, maxLength: 10_000 }),
    fc.double({ min: 0.01, max: 1.0, noNaN: true })
  )
  .map(([path, content, score]): RelevantFile => ({
    path,
    content,
    relevanceScore: score,
  }));

/**
 * Generate a large set of relevant files that will exceed a token budget.
 * We generate between 10 and 50 files with enough content to exceed budgets.
 */
const relevantFilesArb = fc.array(relevantFileArb, {
  minLength: 10,
  maxLength: 50,
});

/**
 * Generate a flat FileTreeNode array simulating >10,000 files.
 * We don't need actual 10k nodes — we just generate a representative set
 * and the test passes the totalFileCount directly to applyTokenBudget.
 */
const projectStructureArb = fc
  .array(
    filePathArb.map(
      (p): FileTreeNode => ({
        path: p,
        type: "file",
        language: "typescript",
        size: 1000,
      })
    ),
    { minLength: 5, maxLength: 20 }
  );

/**
 * Generate a token budget value (realistic range: 1,000 to 500,000 tokens).
 */
const tokenBudgetArb = fc.integer({ min: 1_000, max: 500_000 });

/**
 * Generate a totalFileCount that exceeds the LARGE_REPO_FILE_THRESHOLD (10,000).
 */
const largeFileCountArb = fc.integer({
  min: LARGE_REPO_FILE_THRESHOLD + 1,
  max: 100_000,
});

/**
 * Build a RepositoryContext with given relevant files and project structure,
 * where tokenCount is computed from the content (mimicking the real service).
 */
function buildContext(
  relevantFiles: RelevantFile[],
  projectStructure: FileTreeNode[]
): RepositoryContext {
  const tokenCount = estimateTokenCount(relevantFiles, projectStructure);

  return {
    projectStructure,
    dependencyGraph: { nodes: [], edges: [] },
    conventions: {
      namingPatterns: [],
      formattingRules: [],
      architecturalPatterns: [],
      testingConventions: [],
    },
    languageMetadata: {
      primaryLanguage: "typescript",
      frameworks: [],
    },
    relevantFiles,
    tokenCount,
  };
}

// ─── Property Tests ───────────────────────────────────────────────────────────

describe("Feature: autonomous-codegen-pipelines, Property 2: Token budget invariant", () => {
  /**
   * **Validates: Requirements 1.2**
   *
   * For any repository exceeding 10,000 files and any configured token budget,
   * after applying applyTokenBudget, the resulting RepositoryContext.tokenCount
   * SHALL be less than or equal to the configured contextTokenBudget.
   */
  it("tokenCount <= contextTokenBudget after applyTokenBudget for large repos", () => {
    fc.assert(
      fc.property(
        relevantFilesArb,
        projectStructureArb,
        tokenBudgetArb,
        largeFileCountArb,
        (relevantFiles, projectStructure, budget, totalFileCount) => {
          // Build a context with potentially over-budget token count
          const context = buildContext(relevantFiles, projectStructure);

          // Apply the token budget enforcement
          const result = applyTokenBudget(context, budget, totalFileCount);

          // The invariant: tokenCount must be <= budget after enforcement
          expect(result.tokenCount).toBeLessThanOrEqual(budget);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 1.2**
   *
   * When context is already within budget, applyTokenBudget preserves the context
   * without unnecessary modifications (idempotency for under-budget inputs).
   */
  it("preserves context unchanged when tokenCount is already within budget", () => {
    fc.assert(
      fc.property(
        relevantFilesArb,
        projectStructureArb,
        largeFileCountArb,
        (relevantFiles, projectStructure, totalFileCount) => {
          const context = buildContext(relevantFiles, projectStructure);

          // Set a budget well above the current token count
          const generousBudget = context.tokenCount + 100_000;

          const result = applyTokenBudget(context, generousBudget, totalFileCount);

          // Should preserve all relevant files when under budget
          expect(result.relevantFiles.length).toBe(context.relevantFiles.length);
          expect(result.tokenCount).toBeLessThanOrEqual(generousBudget);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 1.2**
   *
   * For very tight budgets (near minimum), the invariant still holds.
   * The function should trim aggressively when needed but never exceed the budget.
   */
  it("enforces invariant even with very tight token budgets", () => {
    fc.assert(
      fc.property(
        relevantFilesArb,
        projectStructureArb,
        largeFileCountArb,
        (relevantFiles, projectStructure, totalFileCount) => {
          const context = buildContext(relevantFiles, projectStructure);

          // Use a very tight budget — just the metadata overhead (2000 tokens)
          const tightBudget = 2_001;

          const result = applyTokenBudget(context, tightBudget, totalFileCount);

          expect(result.tokenCount).toBeLessThanOrEqual(tightBudget);
        }
      ),
      { numRuns: 100 }
    );
  });
});
