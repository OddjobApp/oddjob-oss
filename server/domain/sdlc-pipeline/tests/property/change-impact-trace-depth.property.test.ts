/**
 * Property Test: Trace depth boundary (Property 15)
 *
 * Feature: autonomous-codegen-pipelines, Property 15: Trace depth boundary
 *
 * For any dependency chain of length N and configured trace depth D, the
 * ChangeImpactAnalyzer SHALL include dependents up to exactly D levels of
 * transitive imports and SHALL NOT include dependents at depth D+1 or beyond.
 *
 * **Validates: Requirements 7.2**
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as fc from "fast-check";
import { changeImpactAnalyzerService } from "../../autonomous/change-impact-analyzer.service.js";
import type { DependencyGraph, DependencyNode, DependencyEdge } from "../../core/types.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Builds a linear dependency chain of length N:
 *   file0 ← file1 ← file2 ← ... ← fileN
 *
 * Each file(i) imports file(i-1). So if file0 is changed:
 *   - file1 is at depth 1 (imports file0)
 *   - file2 is at depth 2 (imports file1)
 *   - fileN is at depth N
 *
 * Edge convention: source is the importer, target is the imported file.
 * Reverse traversal: target → importers (who imports target).
 */
function buildLinearChainGraph(chainLength: number): {
  graph: DependencyGraph;
  filePaths: string[];
} {
  const filePaths: string[] = [];
  const nodes: DependencyNode[] = [];
  const edges: DependencyEdge[] = [];

  for (let i = 0; i <= chainLength; i++) {
    const filePath = `src/chain/file${i}.ts`;
    filePaths.push(filePath);
    nodes.push({
      filePath,
      exports: [`export${i}`],
      language: "typescript",
    });
  }

  // file(i) imports file(i-1): source=file(i), target=file(i-1)
  for (let i = 1; i <= chainLength; i++) {
    edges.push({
      source: filePaths[i],
      target: filePaths[i - 1],
      importType: "static",
    });
  }

  return {
    graph: { nodes, edges },
    filePaths,
  };
}

// ─── Arbitraries ────────────────────────────────────────────────────────────

/**
 * Generates a random chain length N (2–20) and trace depth D (1–10)
 * where D < N (ensures there are files beyond the trace depth).
 */
const chainAndDepthArb = fc
  .integer({ min: 2, max: 20 })
  .chain((chainLength) =>
    fc
      .integer({ min: 1, max: Math.min(10, chainLength - 1) })
      .map((traceDepth) => ({ chainLength, traceDepth }))
  );

/**
 * Generates a random chain length N (1–20) and trace depth D (N–20)
 * where D >= N (trace depth covers the entire chain or exceeds it).
 */
const chainWithSufficientDepthArb = fc
  .integer({ min: 1, max: 15 })
  .chain((chainLength) =>
    fc
      .integer({ min: chainLength, max: 20 })
      .map((traceDepth) => ({ chainLength, traceDepth }))
  );

// ─── Property Tests ─────────────────────────────────────────────────────────

describe("Feature: autonomous-codegen-pipelines, Property 15: Trace depth boundary", () => {
  beforeEach(() => {
    changeImpactAnalyzerService.invalidateCache("prop-test-session");
  });

  it("includes all dependents up to exactly D levels when chain length > D", async () => {
    await fc.assert(
      fc.asyncProperty(chainAndDepthArb, async ({ chainLength, traceDepth }) => {
        // Invalidate cache to avoid stale state between iterations
        changeImpactAnalyzerService.invalidateCache("prop-test-session");

        const { graph, filePaths } = buildLinearChainGraph(chainLength);

        // Change file0 (the root of the chain)
        const result = await changeImpactAnalyzerService.analyzeImpact(
          "prop-test-session",
          [filePaths[0]],
          graph,
          traceDepth
        );

        // Combine all affected files (both test and source)
        const allAffected = new Set([
          ...result.affectedTestFiles,
          ...result.affectedSourceFiles,
        ]);

        // Files 1 through D should ALL be included (depths 1..D)
        for (let depth = 1; depth <= traceDepth; depth++) {
          expect(allAffected.has(filePaths[depth])).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("does NOT include dependents at depth D+1 or beyond", async () => {
    await fc.assert(
      fc.asyncProperty(chainAndDepthArb, async ({ chainLength, traceDepth }) => {
        changeImpactAnalyzerService.invalidateCache("prop-test-session");

        const { graph, filePaths } = buildLinearChainGraph(chainLength);

        const result = await changeImpactAnalyzerService.analyzeImpact(
          "prop-test-session",
          [filePaths[0]],
          graph,
          traceDepth
        );

        const allAffected = new Set([
          ...result.affectedTestFiles,
          ...result.affectedSourceFiles,
        ]);

        // Files at depth D+1 through N should NOT be included
        for (let depth = traceDepth + 1; depth <= chainLength; depth++) {
          expect(allAffected.has(filePaths[depth])).toBe(false);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("includes the changed file itself in the affected set", async () => {
    await fc.assert(
      fc.asyncProperty(chainAndDepthArb, async ({ chainLength, traceDepth }) => {
        changeImpactAnalyzerService.invalidateCache("prop-test-session");

        const { graph, filePaths } = buildLinearChainGraph(chainLength);

        const result = await changeImpactAnalyzerService.analyzeImpact(
          "prop-test-session",
          [filePaths[0]],
          graph,
          traceDepth
        );

        const allAffected = new Set([
          ...result.affectedTestFiles,
          ...result.affectedSourceFiles,
        ]);

        // The changed file itself (depth 0) should always be included
        expect(allAffected.has(filePaths[0])).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it("includes all chain files when trace depth covers entire chain", async () => {
    await fc.assert(
      fc.asyncProperty(chainWithSufficientDepthArb, async ({ chainLength, traceDepth }) => {
        changeImpactAnalyzerService.invalidateCache("prop-test-session");

        const { graph, filePaths } = buildLinearChainGraph(chainLength);

        const result = await changeImpactAnalyzerService.analyzeImpact(
          "prop-test-session",
          [filePaths[0]],
          graph,
          traceDepth
        );

        const allAffected = new Set([
          ...result.affectedTestFiles,
          ...result.affectedSourceFiles,
        ]);

        // When D >= N, ALL files in the chain should be included
        for (let i = 0; i <= chainLength; i++) {
          expect(allAffected.has(filePaths[i])).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("reports the correct traceDepth value in the result", async () => {
    await fc.assert(
      fc.asyncProperty(chainAndDepthArb, async ({ chainLength, traceDepth }) => {
        changeImpactAnalyzerService.invalidateCache("prop-test-session");

        const { graph, filePaths } = buildLinearChainGraph(chainLength);

        const result = await changeImpactAnalyzerService.analyzeImpact(
          "prop-test-session",
          [filePaths[0]],
          graph,
          traceDepth
        );

        expect(result.traceDepth).toBe(traceDepth);
      }),
      { numRuns: 100 }
    );
  });
});
