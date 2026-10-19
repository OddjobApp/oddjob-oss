/**
 * Change Planner Service — Unit Tests
 *
 * Tests for edit plan generation, topological sort, dependency computation,
 * and plan validation.
 */

import { describe, it, expect } from "vitest";
import {
  changePlannerService,
  topologicalSort,
  computeOperationDependencies,
  generateRationale,
} from "../autonomous/change-planner.service.js";
import type {
  FileOperation,
  RepositoryContext,
  DependencyGraph,
  DetectedConventions,
} from "../core/types.js";

// ─── Test Fixtures ──────────────────────────────────────────────────────────

function makeMinimalContext(overrides?: Partial<RepositoryContext>): RepositoryContext {
  return {
    projectStructure: [
      { path: "src", type: "directory" },
      { path: "src/index.ts", type: "file", language: "typescript" },
    ],
    dependencyGraph: { nodes: [], edges: [] },
    conventions: {
      namingPatterns: [],
      formattingRules: [],
      architecturalPatterns: ["service-layer"],
      testingConventions: [
        { framework: "vitest", filePattern: "*.test.ts", location: "tests/" },
      ],
    },
    languageMetadata: {
      primaryLanguage: "typescript",
      frameworks: ["express"],
      packageManager: "npm",
      buildTool: "vite",
      testRunner: "vitest",
    },
    relevantFiles: [],
    tokenCount: 5000,
    ...overrides,
  };
}

function makeConventions(overrides?: Partial<DetectedConventions>): DetectedConventions {
  return {
    namingPatterns: [
      { scope: "services", pattern: ".*\\.service\\.ts$", examples: ["auth.service.ts"] },
    ],
    formattingRules: [{ rule: "indent", value: 2 }],
    architecturalPatterns: ["DDD", "service-layer"],
    testingConventions: [
      { framework: "vitest", filePattern: "*.test.ts", location: "tests/" },
    ],
    ...overrides,
  };
}

// ─── Topological Sort Tests ─────────────────────────────────────────────────

describe("topologicalSort", () => {
  it("should return operations in dependency order", () => {
    const operations: FileOperation[] = [
      { id: "op-0", type: "create", filePath: "types.ts", dependsOn: [], rationale: "base types", newContent: "" },
      { id: "op-1", type: "create", filePath: "service.ts", dependsOn: ["op-0"], rationale: "service", newContent: "" },
      { id: "op-2", type: "create", filePath: "controller.ts", dependsOn: ["op-1"], rationale: "controller", newContent: "" },
    ];

    const sorted = topologicalSort(operations);

    expect(sorted).toEqual(["op-0", "op-1", "op-2"]);
  });

  it("should handle operations with no dependencies", () => {
    const operations: FileOperation[] = [
      { id: "op-0", type: "create", filePath: "a.ts", dependsOn: [], rationale: "a", newContent: "" },
      { id: "op-1", type: "create", filePath: "b.ts", dependsOn: [], rationale: "b", newContent: "" },
      { id: "op-2", type: "create", filePath: "c.ts", dependsOn: [], rationale: "c", newContent: "" },
    ];

    const sorted = topologicalSort(operations);

    // All should appear (order is deterministic due to sorting)
    expect(sorted).toHaveLength(3);
    expect(sorted).toContain("op-0");
    expect(sorted).toContain("op-1");
    expect(sorted).toContain("op-2");
  });

  it("should throw on circular dependencies", () => {
    const operations: FileOperation[] = [
      { id: "op-0", type: "create", filePath: "a.ts", dependsOn: ["op-1"], rationale: "a", newContent: "" },
      { id: "op-1", type: "create", filePath: "b.ts", dependsOn: ["op-0"], rationale: "b", newContent: "" },
    ];

    expect(() => topologicalSort(operations)).toThrow("Circular dependency");
  });

  it("should handle diamond dependencies correctly", () => {
    const operations: FileOperation[] = [
      { id: "op-0", type: "create", filePath: "base.ts", dependsOn: [], rationale: "base", newContent: "" },
      { id: "op-1", type: "create", filePath: "left.ts", dependsOn: ["op-0"], rationale: "left", newContent: "" },
      { id: "op-2", type: "create", filePath: "right.ts", dependsOn: ["op-0"], rationale: "right", newContent: "" },
      { id: "op-3", type: "create", filePath: "merged.ts", dependsOn: ["op-1", "op-2"], rationale: "merged", newContent: "" },
    ];

    const sorted = topologicalSort(operations);

    // op-0 must be first, op-3 must be last
    expect(sorted.indexOf("op-0")).toBe(0);
    expect(sorted.indexOf("op-3")).toBe(3);
    // op-1 and op-2 must come after op-0 and before op-3
    expect(sorted.indexOf("op-1")).toBeGreaterThan(0);
    expect(sorted.indexOf("op-1")).toBeLessThan(3);
    expect(sorted.indexOf("op-2")).toBeGreaterThan(0);
    expect(sorted.indexOf("op-2")).toBeLessThan(3);
  });

  it("should skip non-existent dependency references gracefully", () => {
    const operations: FileOperation[] = [
      { id: "op-0", type: "create", filePath: "a.ts", dependsOn: ["op-missing"], rationale: "a", newContent: "" },
      { id: "op-1", type: "create", filePath: "b.ts", dependsOn: ["op-0"], rationale: "b", newContent: "" },
    ];

    // Should not throw; non-existent deps are skipped
    const sorted = topologicalSort(operations);
    expect(sorted).toEqual(["op-0", "op-1"]);
  });
});

// ─── Dependency Computation Tests ───────────────────────────────────────────

describe("computeOperationDependencies", () => {
  it("should detect dependencies from the dependency graph edges", () => {
    const operations: FileOperation[] = [
      { id: "op-0", type: "create", filePath: "src/types.ts", dependsOn: [], rationale: "types", newContent: "" },
      { id: "op-1", type: "modify", filePath: "src/service.ts", dependsOn: [], rationale: "service" },
    ];

    const depGraph: DependencyGraph = {
      nodes: [
        { filePath: "src/types.ts", exports: ["MyType"], language: "typescript" },
        { filePath: "src/service.ts", exports: ["myService"], language: "typescript" },
      ],
      edges: [
        { source: "src/service.ts", target: "src/types.ts", importType: "static" },
      ],
    };

    const result = computeOperationDependencies(operations, depGraph);

    // service.ts imports from types.ts, so op-1 depends on op-0
    expect(result[1].dependsOn).toContain("op-0");
  });

  it("should return empty dependencies when no edges connect operations", () => {
    const operations: FileOperation[] = [
      { id: "op-0", type: "create", filePath: "src/a.ts", dependsOn: [], rationale: "a", newContent: "" },
      { id: "op-1", type: "create", filePath: "src/b.ts", dependsOn: [], rationale: "b", newContent: "" },
    ];

    const depGraph: DependencyGraph = { nodes: [], edges: [] };

    const result = computeOperationDependencies(operations, depGraph);

    expect(result[0].dependsOn).toEqual([]);
    expect(result[1].dependsOn).toEqual([]);
  });
});

// ─── Rationale Generation Tests ─────────────────────────────────────────────

describe("generateRationale", () => {
  it("should include the operation type and objective", () => {
    const conventions = makeConventions();
    const rationale = generateRationale(
      { type: "create", filePath: "src/new.service.ts" },
      conventions,
      "Add user authentication"
    );

    expect(rationale).toContain("Create new file");
    expect(rationale).toContain("Add user authentication");
  });

  it("should reference architectural patterns", () => {
    const conventions = makeConventions({ architecturalPatterns: ["DDD", "CQRS"] });
    const rationale = generateRationale(
      { type: "modify", filePath: "src/handler.ts" },
      conventions,
      "Refactor handler"
    );

    expect(rationale).toContain("DDD");
    expect(rationale).toContain("CQRS");
  });

  it("should reference matching naming conventions", () => {
    const conventions = makeConventions({
      namingPatterns: [
        { scope: "services", pattern: ".*\\.service\\.ts$", examples: ["auth.service.ts"] },
      ],
    });
    const rationale = generateRationale(
      { type: "create", filePath: "src/user.service.ts" },
      conventions,
      "Add user service"
    );

    expect(rationale).toContain("naming convention");
    expect(rationale).toContain("services");
  });

  it("should reference testing conventions for test files", () => {
    const conventions = makeConventions();
    const rationale = generateRationale(
      { type: "create", filePath: "tests/auth.test.ts" },
      conventions,
      "Add auth tests"
    );

    expect(rationale).toContain("testing convention");
    expect(rationale).toContain("vitest");
  });
});

// ─── Plan Validation Tests ──────────────────────────────────────────────────

describe("changePlannerService.validatePlan", () => {
  it("should validate a well-formed plan successfully", () => {
    const plan = {
      sessionId: "session-1",
      objective: "Add feature X",
      operations: [
        {
          id: "op-0",
          type: "create" as const,
          filePath: "src/types.ts",
          dependsOn: [],
          rationale: "Create type definitions",
          newContent: "export interface Foo {}",
        },
        {
          id: "op-1",
          type: "modify" as const,
          filePath: "src/service.ts",
          dependsOn: ["op-0"],
          rationale: "Add service logic",
          changes: [
            { startLine: 1, endLine: 5, originalCode: "old", newCode: "new", contextLines: 3 },
          ],
        },
      ],
      dependencyOrder: ["op-0", "op-1"],
      totalFileCount: 2,
      requiresHumanReview: false,
    };

    const result = changePlannerService.validatePlan(plan);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("should detect invalid dependency references", () => {
    const plan = {
      sessionId: "session-1",
      objective: "Fix bug",
      operations: [
        {
          id: "op-0",
          type: "modify" as const,
          filePath: "src/fix.ts",
          dependsOn: ["op-nonexistent"],
          rationale: "Fix the bug",
          changes: [
            { startLine: 1, endLine: 1, originalCode: "x", newCode: "y", contextLines: 2 },
          ],
        },
      ],
      dependencyOrder: ["op-0"],
      totalFileCount: 1,
      requiresHumanReview: false,
    };

    const result = changePlannerService.validatePlan(plan);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.keyword === "referenceIntegrity")).toBe(true);
  });

  it("should detect circular dependencies", () => {
    const plan = {
      sessionId: "session-1",
      objective: "Circular",
      operations: [
        {
          id: "op-0",
          type: "create" as const,
          filePath: "a.ts",
          dependsOn: ["op-1"],
          rationale: "Create a",
          newContent: "",
        },
        {
          id: "op-1",
          type: "create" as const,
          filePath: "b.ts",
          dependsOn: ["op-0"],
          rationale: "Create b",
          newContent: "",
        },
      ],
      dependencyOrder: [],
      totalFileCount: 2,
      requiresHumanReview: false,
    };

    const result = changePlannerService.validatePlan(plan);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.keyword === "acyclicDependency")).toBe(true);
  });

  it("should detect modify operations without changes", () => {
    const plan = {
      sessionId: "session-1",
      objective: "Modify without changes",
      operations: [
        {
          id: "op-0",
          type: "modify" as const,
          filePath: "src/file.ts",
          dependsOn: [],
          rationale: "Modify something",
          changes: [],
        },
      ],
      dependencyOrder: ["op-0"],
      totalFileCount: 1,
      requiresHumanReview: false,
    };

    const result = changePlannerService.validatePlan(plan);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.keyword === "required")).toBe(true);
  });

  it("should detect invalid line ranges in code changes", () => {
    const plan = {
      sessionId: "session-1",
      objective: "Bad line range",
      operations: [
        {
          id: "op-0",
          type: "modify" as const,
          filePath: "src/file.ts",
          dependsOn: [],
          rationale: "Has bad line range",
          changes: [
            { startLine: 10, endLine: 5, originalCode: "x", newCode: "y", contextLines: 3 },
          ],
        },
      ],
      dependencyOrder: ["op-0"],
      totalFileCount: 1,
      requiresHumanReview: false,
    };

    const result = changePlannerService.validatePlan(plan);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.keyword === "lineRange")).toBe(true);
  });

  it("should detect empty rationale", () => {
    const plan = {
      sessionId: "session-1",
      objective: "No rationale",
      operations: [
        {
          id: "op-0",
          type: "create" as const,
          filePath: "src/new.ts",
          dependsOn: [],
          rationale: "",
          newContent: "content",
        },
      ],
      dependencyOrder: ["op-0"],
      totalFileCount: 1,
      requiresHumanReview: false,
    };

    const result = changePlannerService.validatePlan(plan);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.keyword === "minLength")).toBe(true);
  });
});

// ─── generatePlan Integration Tests ─────────────────────────────────────────

describe("changePlannerService.generatePlan", () => {
  it("should produce a valid edit plan for a context with relevant files", async () => {
    const context = makeMinimalContext({
      relevantFiles: [
        { path: "src/auth.ts", content: "export function login() {}\n", relevanceScore: 0.9 },
        { path: "src/user.ts", content: "export interface User {}\n", relevanceScore: 0.7 },
      ],
      dependencyGraph: {
        nodes: [
          { filePath: "src/auth.ts", exports: ["login"], language: "typescript" },
          { filePath: "src/user.ts", exports: ["User"], language: "typescript" },
        ],
        edges: [
          { source: "src/auth.ts", target: "src/user.ts", importType: "static" },
        ],
      },
    });

    const plan = await changePlannerService.generatePlan(
      "session-123",
      "Add password reset feature",
      context
    );

    expect(plan.sessionId).toBe("session-123");
    expect(plan.objective).toBe("Add password reset feature");
    expect(plan.operations.length).toBeGreaterThan(0);
    expect(plan.totalFileCount).toBe(plan.operations.length);
    expect(plan.requiresHumanReview).toBe(false);
    expect(plan.dependencyOrder.length).toBe(plan.operations.length);

    // Each operation should have a non-empty rationale
    for (const op of plan.operations) {
      expect(op.rationale.length).toBeGreaterThan(0);
    }

    // Validate the plan passes structural checks
    const validation = changePlannerService.validatePlan(plan);
    expect(validation.valid).toBe(true);
  });

  it("should produce a create operation when no relevant files exist", async () => {
    const context = makeMinimalContext({ relevantFiles: [] });

    const plan = await changePlannerService.generatePlan(
      "session-456",
      "Build a new authentication module",
      context
    );

    expect(plan.operations.length).toBe(1);
    expect(plan.operations[0].type).toBe("create");
    expect(plan.operations[0].filePath).toContain("build-a-new-authentication-module");
  });

  it("should include dependency order covering all operations", async () => {
    const context = makeMinimalContext({
      relevantFiles: [
        { path: "src/a.ts", content: "export const a = 1;\n", relevanceScore: 0.8 },
        { path: "src/b.ts", content: "import { a } from './a';\n", relevanceScore: 0.6 },
      ],
      dependencyGraph: {
        nodes: [
          { filePath: "src/a.ts", exports: ["a"], language: "typescript" },
          { filePath: "src/b.ts", exports: ["b"], language: "typescript" },
        ],
        edges: [
          { source: "src/b.ts", target: "src/a.ts", importType: "static" },
        ],
      },
    });

    const plan = await changePlannerService.generatePlan(
      "session-789",
      "Update exports",
      context
    );

    // dependencyOrder should contain all operation IDs
    const allIds = plan.operations.map((op) => op.id);
    for (const id of allIds) {
      expect(plan.dependencyOrder).toContain(id);
    }
  });
});
