/**
 * Property Test: Change impact analysis correctness (Property 14)
 *
 * Feature: autonomous-codegen-pipelines, Property 14: Change impact analysis correctness
 *
 * For any dependency graph and set of changed files, the `ImpactAnalysis.affectedTestFiles`
 * SHALL include every test file that has a direct or transitive import dependency
 * (within trace depth) on any of the changed files.
 *
 * **Validates: Requirements 7.1**
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { changeImpactAnalyzerService } from "../../autonomous/change-impact-analyzer.service.js";
import type { DependencyGraph, DependencyNode, DependencyEdge } from "../../core/types.js";

// ─── Reference Implementation ───────────────────────────────────────────────

/**
 * Independent reference BFS implementation for verifying the service output.
 *
 * 1. Builds a reverse adjacency map: for each edge source → target,
 *    add target → source (meaning: if target changes, source is affected)
 * 2. BFS from changed files up to traceDepth
 * 3. Filters results for test file patterns
 */
function referenceAffectedTestFiles(
  depGraph: DependencyGraph,
  changedFiles: string[],
  traceDepth: number
): string[] {
  // Build reverse adjacency map: target → set of sources that import it
  const reverseMap = new Map<string, Set<string>>();

  for (const node of depGraph.nodes) {
    if (!reverseMap.has(node.filePath)) {
      reverseMap.set(node.filePath, new Set());
    }
  }

  for (const edge of depGraph.edges) {
    if (!reverseMap.has(edge.target)) {
      reverseMap.set(edge.target, new Set());
    }
    const importers = reverseMap.get(edge.target)!;
    importers.add(edge.source);
  }

  // BFS from changed files up to traceDepth
  const visited = new Set<string>();
  const queue: Array<[string, number]> = [];

  for (const file of changedFiles) {
    if (!visited.has(file)) {
      visited.add(file);
      queue.push([file, 0]);
    }
  }

  while (queue.length > 0) {
    const [currentFile, depth] = queue.shift()!;

    if (depth >= traceDepth) {
      continue;
    }

    const importers = reverseMap.get(currentFile);
    if (!importers) {
      continue;
    }

    for (const importer of importers) {
      if (!visited.has(importer)) {
        visited.add(importer);
        queue.push([importer, depth + 1]);
      }
    }
  }

  // Filter for test files
  const testPatterns = [
    /\.test\.[jt]sx?$/,
    /\.spec\.[jt]sx?$/,
  ];

  return Array.from(visited).filter((file) =>
    testPatterns.some((pattern) => pattern.test(file))
  );
}

// ─── Arbitraries ────────────────────────────────────────────────────────────

/**
 * Generates a random source file path (non-test).
 */
const sourceFilePathArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom("src", "lib", "utils", "core", "services"),
    fc.stringMatching(/^[a-z][a-z0-9\-]{1,12}$/),
    fc.constantFrom(".ts", ".js", ".tsx", ".jsx")
  )
  .map(([dir, name, ext]) => `${dir}/${name}${ext}`);

/**
 * Generates a random test file path.
 */
const testFilePathArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom("src", "lib", "tests", "core", "services"),
    fc.stringMatching(/^[a-z][a-z0-9\-]{1,12}$/),
    fc.constantFrom(".test.ts", ".spec.ts", ".test.tsx", ".spec.jsx")
  )
  .map(([dir, name, ext]) => `${dir}/${name}${ext}`);

/**
 * Generates a random dependency graph with a mix of source and test files,
 * along with edges between them.
 */
const dependencyGraphArb: fc.Arbitrary<{
  graph: DependencyGraph;
  sourceFiles: string[];
  testFiles: string[];
}> = fc
  .tuple(
    // Number of source files: 2-15
    fc.integer({ min: 2, max: 15 }),
    // Number of test files: 1-8
    fc.integer({ min: 1, max: 8 })
  )
  .chain(([numSource, numTest]) => {
    // Generate unique source file paths
    const sourceFilesArb = fc
      .uniqueArray(sourceFilePathArb, { minLength: numSource, maxLength: numSource })
      .filter((arr) => arr.length === numSource);

    // Generate unique test file paths
    const testFilesArb = fc
      .uniqueArray(testFilePathArb, { minLength: numTest, maxLength: numTest })
      .filter((arr) => arr.length === numTest);

    return fc.tuple(sourceFilesArb, testFilesArb);
  })
  .chain(([sourceFiles, testFiles]) => {
    const allFiles = [...sourceFiles, ...testFiles];

    // Generate edges: each file can import from other files
    // We create random edges where source (importer) imports target (imported file)
    const maxEdges = Math.min(allFiles.length * 2, 30);
    const edgeArb: fc.Arbitrary<DependencyEdge> = fc
      .tuple(
        fc.integer({ min: 0, max: allFiles.length - 1 }),
        fc.integer({ min: 0, max: allFiles.length - 1 }),
        fc.constantFrom("static" as const, "dynamic" as const, "type_only" as const)
      )
      .filter(([srcIdx, tgtIdx]) => srcIdx !== tgtIdx) // no self-loops
      .map(([srcIdx, tgtIdx, importType]) => ({
        source: allFiles[srcIdx],
        target: allFiles[tgtIdx],
        importType,
      }));

    const edgesArb = fc.array(edgeArb, { minLength: 1, maxLength: maxEdges });

    return edgesArb.map((edges) => {
      // Deduplicate edges (same source→target pair)
      const edgeSet = new Set<string>();
      const uniqueEdges: DependencyEdge[] = [];
      for (const edge of edges) {
        const key = `${edge.source}→${edge.target}`;
        if (!edgeSet.has(key)) {
          edgeSet.add(key);
          uniqueEdges.push(edge);
        }
      }

      const nodes: DependencyNode[] = allFiles.map((filePath) => ({
        filePath,
        exports: ["default"],
        language: "typescript",
      }));

      return {
        graph: { nodes, edges: uniqueEdges },
        sourceFiles,
        testFiles,
      };
    });
  });

/**
 * Generates a random trace depth between 1 and 6.
 */
const traceDepthArb: fc.Arbitrary<number> = fc.integer({ min: 1, max: 6 });

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Counter to ensure unique session IDs across all property test invocations */
let sessionCounter = 0;
function uniqueSessionId(prefix: string): string {
  return `${prefix}-${Date.now()}-${++sessionCounter}`;
}

// ─── Property Tests ─────────────────────────────────────────────────────────

describe("Feature: autonomous-codegen-pipelines, Property 14: Change impact analysis correctness", () => {
  it("affectedTestFiles includes every test file reachable within traceDepth from changed files", async () => {
    await fc.assert(
      fc.asyncProperty(
        dependencyGraphArb,
        traceDepthArb,
        async ({ graph, sourceFiles, testFiles }, traceDepth) => {
          // Pick a random subset of source files as changed files (at least 1)
          const changedFiles =
            sourceFiles.length > 0
              ? sourceFiles.slice(0, Math.max(1, Math.floor(sourceFiles.length / 2)))
              : [];

          if (changedFiles.length === 0) return;

          // Use a unique session ID to avoid caching interference
          const sessionId = uniqueSessionId("prop-14-correctness");

          // Compute expected via reference BFS
          const expectedTestFiles = referenceAffectedTestFiles(
            graph,
            changedFiles,
            traceDepth
          );

          // Compute actual via the service
          const result = await changeImpactAnalyzerService.analyzeImpact(
            sessionId,
            changedFiles,
            graph,
            traceDepth
          );

          // Clean up cache
          changeImpactAnalyzerService.invalidateCache(sessionId);

          // Every expected test file must appear in the service output
          const actualTestFileSet = new Set(result.affectedTestFiles);

          for (const expectedFile of expectedTestFiles) {
            expect(actualTestFileSet.has(expectedFile)).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("affectedTestFiles is a subset of test files in the dependency graph", async () => {
    await fc.assert(
      fc.asyncProperty(
        dependencyGraphArb,
        traceDepthArb,
        async ({ graph, sourceFiles }, traceDepth) => {
          const changedFiles = sourceFiles.slice(0, Math.max(1, Math.floor(sourceFiles.length / 3)));
          if (changedFiles.length === 0) return;

          const sessionId = uniqueSessionId("prop-14-subset");

          const result = await changeImpactAnalyzerService.analyzeImpact(
            sessionId,
            changedFiles,
            graph,
            traceDepth
          );

          // Clean up cache
          changeImpactAnalyzerService.invalidateCache(sessionId);

          // All affected test files should match test file patterns
          const testPatterns = [/\.test\.[jt]sx?$/, /\.spec\.[jt]sx?$/];
          for (const file of result.affectedTestFiles) {
            const isTest = testPatterns.some((p) => p.test(file));
            expect(isTest).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("changed files that are test files themselves appear in affectedTestFiles", async () => {
    await fc.assert(
      fc.asyncProperty(
        dependencyGraphArb,
        traceDepthArb,
        async ({ graph, testFiles }, traceDepth) => {
          // Use test files as the changed files
          const changedTestFiles = testFiles.slice(0, Math.max(1, Math.ceil(testFiles.length / 2)));
          if (changedTestFiles.length === 0) return;

          const sessionId = uniqueSessionId("prop-14-self");

          const result = await changeImpactAnalyzerService.analyzeImpact(
            sessionId,
            changedTestFiles,
            graph,
            traceDepth
          );

          // Clean up cache
          changeImpactAnalyzerService.invalidateCache(sessionId);

          // Each changed test file should appear as affected
          const actualTestFileSet = new Set(result.affectedTestFiles);
          for (const testFile of changedTestFiles) {
            expect(actualTestFileSet.has(testFile)).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
