import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SystemGraphService } from "./system-graph.service.js";

/**
 * These tests run the real implementation against a synthetic source tree —
 * no mocking of SystemGraphService itself. A mocked assessChangeImpact would
 * only assert that the mock returns what the mock was told to return.
 */

let repoRoot: string;

async function write(relPath: string, content: string) {
  const full = path.join(repoRoot, relPath);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, "utf-8");
}

beforeAll(async () => {
  repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sysgraph-"));

  // A widely-depended-upon leaf.
  await write("server/domain/core/hub.service.ts", "export const hub = {};\n");

  // 12 direct dependents, via a mix of relative and aliased specifiers.
  for (let i = 0; i < 12; i++) {
    const viaAlias = i % 2 === 0;
    const specifier = viaAlias
      ? '"@domain/core/hub.service.js"'
      : '"../core/hub.service.js"';
    await write(
      `server/domain/feature/dep${i}.service.ts`,
      `import { hub } from ${specifier};\nexport const dep${i} = hub;\n`,
    );
  }

  // A second layer that imports dep0 — reachable only transitively from hub.
  await write(
    "server/domain/feature/second-layer.service.ts",
    'import { dep0 } from "./dep0.service.js";\nexport const s = dep0;\n',
  );

  // An isolated file nothing imports.
  await write("server/domain/lonely/orphan.service.ts", "export const orphan = 1;\n");

  // A schema file (high-leverage) with a single dependent.
  await write("shared/schema/widgets.ts", "export const widgets = {};\n");
  await write(
    "server/domain/feature/widget.service.ts",
    'import { widgets } from "@shared/schema/widgets.js";\nexport const w = widgets;\n',
  );

  // A file that only *mentions* hub.service in a comment and a string — the old
  // substring-matching approach would have counted this as a dependency.
  await write(
    "server/domain/feature/mentions-only.service.ts",
    '// references hub.service.ts in prose\nconst s = "hub.service";\nexport default s;\n',
  );

  SystemGraphService.invalidateCache();
});

afterAll(async () => {
  await fs.rm(repoRoot, { recursive: true, force: true });
  SystemGraphService.invalidateCache();
});

describe("SystemGraphService.assessChangeImpact", () => {
  it("resolves both relative and aliased import specifiers as dependents", async () => {
    const result = await SystemGraphService.assessChangeImpact(
      { filePath: "server/domain/core/hub.service.ts" },
      { repoRoot },
    );

    expect(result.directDependents).toBe(12);
    expect(result.affectedNodes).toContain("server/domain/feature/dep0.service.ts");
    expect(result.affectedNodes).toContain("server/domain/feature/dep1.service.ts");
  });

  it("does not count files that merely mention the name in comments or strings", async () => {
    const result = await SystemGraphService.assessChangeImpact(
      { filePath: "server/domain/core/hub.service.ts" },
      { repoRoot },
    );

    expect(result.affectedNodes).not.toContain(
      "server/domain/feature/mentions-only.service.ts",
    );
  });

  it("includes transitive dependents beyond depth 1", async () => {
    const result = await SystemGraphService.assessChangeImpact(
      { filePath: "server/domain/core/hub.service.ts" },
      { repoRoot },
    );

    // second-layer imports dep0, which imports hub.
    expect(result.affectedNodes).toContain(
      "server/domain/feature/second-layer.service.ts",
    );
    expect(result.transitiveDependents).toBeGreaterThan(result.directDependents);
  });

  it("respects maxDepth", async () => {
    const shallow = await SystemGraphService.assessChangeImpact(
      { filePath: "server/domain/core/hub.service.ts" },
      { repoRoot, maxDepth: 1 },
    );

    expect(shallow.affectedNodes).not.toContain(
      "server/domain/feature/second-layer.service.ts",
    );
    expect(shallow.transitiveDependents).toBe(shallow.directDependents);
  });

  it("scores an isolated file as low risk", async () => {
    const result = await SystemGraphService.assessChangeImpact(
      { filePath: "server/domain/lonely/orphan.service.ts" },
      { repoRoot },
    );

    expect(result.directDependents).toBe(0);
    expect(result.riskScore).toBeLessThan(0.7);
  });

  it("elevates a high-leverage schema file above its raw dependent count", async () => {
    const schema = await SystemGraphService.assessChangeImpact(
      { filePath: "shared/schema/widgets.ts" },
      { repoRoot },
    );
    const ordinary = await SystemGraphService.assessChangeImpact(
      { filePath: "server/domain/feature/dep0.service.ts" },
      { repoRoot },
    );

    // Both have exactly one direct dependent; only the schema file is structural.
    expect(schema.directDependents).toBe(1);
    expect(ordinary.directDependents).toBe(1);
    expect(schema.riskScore).toBeGreaterThan(ordinary.riskScore);
    expect(schema.reason).toContain("database schema");
  });

  it("fails closed for a path that is not in the dependency index", async () => {
    const result = await SystemGraphService.assessChangeImpact(
      { filePath: "server/domain/does/not/exist.service.ts" },
      { repoRoot },
    );

    // An unrecognised path must not read as "safe" — that is precisely the
    // case the gate exists to catch.
    expect(result.riskScore).toBeGreaterThan(0.7);
  });

  it("normalizes absolute and backslashed paths to repo-relative form", async () => {
    const absolute = path.join(repoRoot, "server/domain/core/hub.service.ts");
    const result = await SystemGraphService.assessChangeImpact(
      { filePath: absolute },
      { repoRoot },
    );

    expect(result.directDependents).toBe(12);
  });

  it("still scores the change when the AST symbol index is unavailable", async () => {
    // No knowledge pod is registered in this test process. Symbol lookup is
    // supplementary detail and must never be able to fail the assessment — a
    // stale or absent indexer cannot be allowed to break the safety gate.
    const result = await SystemGraphService.assessChangeImpact(
      { filePath: "server/domain/core/hub.service.ts" },
      { repoRoot },
    );

    expect(result.affectedSymbols).toEqual([]);
    expect(result.directDependents).toBe(12);
    expect(result.riskScore).toBeGreaterThan(0);
  });

  it("keeps separate indexes per repoRoot", async () => {
    const otherRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sysgraph-other-"));
    try {
      // Same relative path, different tree, no dependents at all.
      const full = path.join(otherRoot, "server/domain/core/hub.service.ts");
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, "export const hub = {};\n", "utf-8");

      const other = await SystemGraphService.assessChangeImpact(
        { filePath: "server/domain/core/hub.service.ts" },
        { repoRoot: otherRoot },
      );
      const original = await SystemGraphService.assessChangeImpact(
        { filePath: "server/domain/core/hub.service.ts" },
        { repoRoot },
      );

      expect(other.directDependents).toBe(0);
      expect(original.directDependents).toBe(12);
    } finally {
      await fs.rm(otherRoot, { recursive: true, force: true });
    }
  });

  it("provides depthBreakdown mapping dependents to their traversal depth", async () => {
    const result = await SystemGraphService.assessChangeImpact(
      { filePath: "server/domain/core/hub.service.ts" },
      { repoRoot },
    );

    expect(result.depthBreakdown).toBeDefined();
    expect(result.depthBreakdown?.[1]?.length).toBe(12);
    expect(result.depthBreakdown?.[2]).toContain("server/domain/feature/second-layer.service.ts");
  });

  it("exports topology graph with node categories and edge connections", async () => {
    const topology = await SystemGraphService.getTopologyGraph({ repoRoot });

    expect(topology.nodes.length).toBeGreaterThan(10);
    expect(topology.edges.length).toBeGreaterThan(10);
    expect(topology.stats.totalFiles).toBeGreaterThan(10);

    const hubNode = topology.nodes.find(n => n.id === "server/domain/core/hub.service.ts");
    expect(hubNode).toBeDefined();
    expect(hubNode?.category).toBe("server");
    expect(hubNode?.directDependents).toBe(12);

    const schemaNode = topology.nodes.find(n => n.id === "shared/schema/widgets.ts");
    expect(schemaNode).toBeDefined();
    expect(schemaNode?.category).toBe("shared");
    expect(schemaNode?.isHighLeverage).toBe(true);
    expect(schemaNode?.leverageReason).toBe("database schema");
  });

  it("computes accurate system statistics and cache metadata", async () => {
    const stats = await SystemGraphService.getSystemStats({ repoRoot });

    expect(stats.totalFiles).toBeGreaterThan(10);
    expect(stats.totalEdges).toBeGreaterThan(10);
    expect(stats.highLeverageCount).toBeGreaterThanOrEqual(1);
    expect(stats.cacheAgeMs).toBeGreaterThanOrEqual(0);
  });
});
