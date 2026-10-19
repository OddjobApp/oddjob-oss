import { describe, it, expect, beforeEach } from "vitest";
import { changeImpactAnalyzerService } from "../autonomous/change-impact-analyzer.service.js";
import type { DependencyGraph } from "../core/types.js";

// ─── Test Helpers ───────────────────────────────────────────────────────────

function makeGraph(
  nodes: Array<{ filePath: string; exports?: string[]; language?: string }>,
  edges: Array<{ source: string; target: string; importType?: "static" | "dynamic" | "type_only" }>
): DependencyGraph {
  return {
    nodes: nodes.map((n) => ({
      filePath: n.filePath,
      exports: n.exports ?? [],
      language: n.language ?? "typescript",
    })),
    edges: edges.map((e) => ({
      source: e.source,
      target: e.target,
      importType: e.importType ?? "static",
    })),
  };
}

function emptyGraph(): DependencyGraph {
  return { nodes: [], edges: [] };
}

describe("ChangeImpactAnalyzerService", () => {
  beforeEach(() => {
    // Clear cache between tests
    changeImpactAnalyzerService.invalidateCache("test-session");
  });

  describe("analyzeImpact", () => {
    it("should return affected test files that directly import a changed file", async () => {
      const graph = makeGraph(
        [
          { filePath: "src/utils.ts" },
          { filePath: "src/utils.test.ts" },
        ],
        [
          { source: "src/utils.test.ts", target: "src/utils.ts" },
        ]
      );

      const result = await changeImpactAnalyzerService.analyzeImpact(
        "test-session",
        ["src/utils.ts"],
        graph
      );

      expect(result.affectedTestFiles).toContain("src/utils.test.ts");
      expect(result.affectedSourceFiles).toContain("src/utils.ts");
      expect(result.fullSuiteFallback).toBe(false);
      expect(result.confidence).toBe("high");
    });

    it("should trace transitive dependencies within trace depth", async () => {
      // A → B → C → C.test.ts (chain of depth 3)
      const graph = makeGraph(
        [
          { filePath: "src/a.ts" },
          { filePath: "src/b.ts" },
          { filePath: "src/c.ts" },
          { filePath: "src/c.test.ts" },
        ],
        [
          { source: "src/b.ts", target: "src/a.ts" },
          { source: "src/c.ts", target: "src/b.ts" },
          { source: "src/c.test.ts", target: "src/c.ts" },
        ]
      );

      const result = await changeImpactAnalyzerService.analyzeImpact(
        "test-session",
        ["src/a.ts"],
        graph,
        3
      );

      expect(result.affectedTestFiles).toContain("src/c.test.ts");
      expect(result.affectedSourceFiles).toContain("src/a.ts");
      expect(result.affectedSourceFiles).toContain("src/b.ts");
      expect(result.affectedSourceFiles).toContain("src/c.ts");
      expect(result.traceDepth).toBe(3);
    });

    it("should NOT trace beyond the configured trace depth", async () => {
      // A → B → C → D.test.ts (chain of depth 3, but limit to 2)
      const graph = makeGraph(
        [
          { filePath: "src/a.ts" },
          { filePath: "src/b.ts" },
          { filePath: "src/c.ts" },
          { filePath: "src/d.test.ts" },
        ],
        [
          { source: "src/b.ts", target: "src/a.ts" },
          { source: "src/c.ts", target: "src/b.ts" },
          { source: "src/d.test.ts", target: "src/c.ts" },
        ]
      );

      const result = await changeImpactAnalyzerService.analyzeImpact(
        "test-session",
        ["src/a.ts"],
        graph,
        2 // Only trace 2 levels deep
      );

      // d.test.ts is at depth 3 from a.ts, so should NOT be included
      expect(result.affectedTestFiles).not.toContain("src/d.test.ts");
      // c.ts is at depth 2, should be included
      expect(result.affectedSourceFiles).toContain("src/c.ts");
      expect(result.traceDepth).toBe(2);
    });

    it("should default to trace depth of 3", async () => {
      const graph = makeGraph(
        [{ filePath: "src/a.ts" }],
        []
      );

      const result = await changeImpactAnalyzerService.analyzeImpact(
        "test-session",
        ["src/a.ts"],
        graph
      );

      expect(result.traceDepth).toBe(3);
    });

    it("should fallback to full test suite when dependency graph is empty", async () => {
      const result = await changeImpactAnalyzerService.analyzeImpact(
        "test-session",
        ["src/some-file.ts"],
        emptyGraph()
      );

      expect(result.fullSuiteFallback).toBe(true);
      expect(result.confidence).toBe("low");
    });

    it("should return all test files from nodes during fallback", async () => {
      // Graph with nodes but no edges would still be "available"
      // For a truly empty graph (no nodes, no edges), fallback returns empty test list
      const result = await changeImpactAnalyzerService.analyzeImpact(
        "test-session",
        ["src/some-file.ts"],
        emptyGraph()
      );

      expect(result.fullSuiteFallback).toBe(true);
      expect(result.affectedTestFiles).toEqual([]);
      expect(result.affectedSourceFiles).toEqual(["src/some-file.ts"]);
    });

    it("should identify test files using various patterns", async () => {
      const graph = makeGraph(
        [
          { filePath: "src/service.ts" },
          { filePath: "src/service.test.ts" },
          { filePath: "src/service.spec.ts" },
          { filePath: "src/__tests__/service.ts" },
          { filePath: "tests/service.ts" },
        ],
        [
          { source: "src/service.test.ts", target: "src/service.ts" },
          { source: "src/service.spec.ts", target: "src/service.ts" },
          { source: "src/__tests__/service.ts", target: "src/service.ts" },
          { source: "tests/service.ts", target: "src/service.ts" },
        ]
      );

      const result = await changeImpactAnalyzerService.analyzeImpact(
        "test-session",
        ["src/service.ts"],
        graph
      );

      expect(result.affectedTestFiles).toContain("src/service.test.ts");
      expect(result.affectedTestFiles).toContain("src/service.spec.ts");
      expect(result.affectedTestFiles).toContain("src/__tests__/service.ts");
      expect(result.affectedTestFiles).toContain("tests/service.ts");
    });

    it("should set confidence to 'medium' when changed files are not all in graph", async () => {
      const graph = makeGraph(
        [{ filePath: "src/known.ts" }],
        []
      );

      const result = await changeImpactAnalyzerService.analyzeImpact(
        "test-session",
        ["src/known.ts", "src/unknown.ts"], // unknown.ts not in graph
        graph
      );

      expect(result.confidence).toBe("medium");
    });

    it("should set confidence to 'high' when all changed files are in graph", async () => {
      const graph = makeGraph(
        [
          { filePath: "src/a.ts" },
          { filePath: "src/b.ts" },
        ],
        []
      );

      const result = await changeImpactAnalyzerService.analyzeImpact(
        "test-session",
        ["src/a.ts", "src/b.ts"],
        graph
      );

      expect(result.confidence).toBe("high");
    });

    it("should handle multiple changed files", async () => {
      const graph = makeGraph(
        [
          { filePath: "src/a.ts" },
          { filePath: "src/b.ts" },
          { filePath: "src/a.test.ts" },
          { filePath: "src/b.test.ts" },
        ],
        [
          { source: "src/a.test.ts", target: "src/a.ts" },
          { source: "src/b.test.ts", target: "src/b.ts" },
        ]
      );

      const result = await changeImpactAnalyzerService.analyzeImpact(
        "test-session",
        ["src/a.ts", "src/b.ts"],
        graph
      );

      expect(result.affectedTestFiles).toContain("src/a.test.ts");
      expect(result.affectedTestFiles).toContain("src/b.test.ts");
    });

    it("should handle diamond dependencies without duplication", async () => {
      // A → B, A → C, B → D, C → D (D appears via two paths)
      const graph = makeGraph(
        [
          { filePath: "src/a.ts" },
          { filePath: "src/b.ts" },
          { filePath: "src/c.ts" },
          { filePath: "src/d.test.ts" },
        ],
        [
          { source: "src/b.ts", target: "src/a.ts" },
          { source: "src/c.ts", target: "src/a.ts" },
          { source: "src/d.test.ts", target: "src/b.ts" },
          { source: "src/d.test.ts", target: "src/c.ts" },
        ]
      );

      const result = await changeImpactAnalyzerService.analyzeImpact(
        "test-session",
        ["src/a.ts"],
        graph,
        3
      );

      // d.test.ts should appear exactly once
      const dTestCount = result.affectedTestFiles.filter(
        (f) => f === "src/d.test.ts"
      ).length;
      expect(dTestCount).toBe(1);
    });
  });

  describe("invalidateCache", () => {
    it("should allow cache invalidation without error", () => {
      // Calling invalidateCache on non-existent session should not throw
      expect(() => {
        changeImpactAnalyzerService.invalidateCache("nonexistent-session");
      }).not.toThrow();
    });

    it("should clear cached results for subsequent calls", async () => {
      const graph = makeGraph(
        [
          { filePath: "src/a.ts" },
          { filePath: "src/a.test.ts" },
        ],
        [
          { source: "src/a.test.ts", target: "src/a.ts" },
        ]
      );

      // First call caches the adjacency map
      await changeImpactAnalyzerService.analyzeImpact(
        "test-session",
        ["src/a.ts"],
        graph
      );

      // Invalidate cache
      changeImpactAnalyzerService.invalidateCache("test-session");

      // Subsequent call should still work (rebuilds cache)
      const result = await changeImpactAnalyzerService.analyzeImpact(
        "test-session",
        ["src/a.ts"],
        graph
      );

      expect(result.affectedTestFiles).toContain("src/a.test.ts");
    });
  });
});
