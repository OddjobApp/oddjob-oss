import { describe, it, expect } from "vitest";
import { SATScaffoldResolver } from "../sat-scaffold-resolver.js";
import type { PackManifest } from "@shared/schema/scaffold.js";

describe("SATScaffoldResolver (Boolean Satisfiability & MaxSAT)", () => {
  /**
   * PackManifest is `z.infer`, which is the schema's OUTPUT type: the arrays
   * the schema defaults are required on the way out, even though a hand-written
   * manifest omits them. Spelling them once here keeps each fixture to the
   * fields the dependency solve actually turns on.
   */
  const pack = (
    over: Pick<PackManifest, "id" | "name" | "category"> & Partial<PackManifest>,
  ): PackManifest => ({
    version: "1.0.0",
    requires: [],
    conflicts: [],
    recommends: [],
    provides: [],
    inject: [],
    templates: [],
    ...over,
  });

  const mockRegistry: PackManifest[] = [
    pack({
      id: "core-host",
      name: "Core Host",
      category: "core",
      recommends: ["observability-pack"],
    }),
    pack({
      id: "auth-jwt",
      name: "JWT Auth",
      category: "auth",
      requires: ["core-host"],
      conflicts: ["auth-oauth"],
    }),
    pack({
      id: "auth-oauth",
      name: "OAuth Auth",
      category: "auth",
      requires: ["core-host"],
      conflicts: ["auth-jwt"],
    }),
    pack({
      id: "observability-pack",
      name: "OTel Observability",
      category: "observability",
      requires: ["core-host"],
    }),
  ];

  it("should solve a valid dependency configuration using DPLL", () => {
    const solver = new SATScaffoldResolver(mockRegistry);
    const result = solver.solve(["auth-jwt"]);

    expect(result.satisfiable).toBe(true);
    const ids = result.selectedPacks.map(p => p.id);
    expect(ids).toContain("auth-jwt");
    expect(ids).toContain("core-host");
    expect(ids).toContain("observability-pack"); // Soft recommendation satisfied
    expect(ids).not.toContain("auth-oauth"); // unrelated/conflicting packs stay off
  });

  it("includes dependencies of an accepted recommendation", () => {
    const registry = [
      pack({ id: "requested", name: "Requested", category: "core", recommends: ["addon"] }),
      pack({ id: "addon", name: "Addon", category: "ui", requires: ["addon-core"] }),
      pack({ id: "addon-core", name: "Addon Core", category: "core" }),
      pack({ id: "unrelated", name: "Unrelated", category: "ui" }),
    ];
    const result = new SATScaffoldResolver(registry).solve(["requested"]);
    const ids = result.selectedPacks.map((item) => item.id);
    expect(ids).toEqual(expect.arrayContaining(["requested", "addon", "addon-core"]));
    expect(ids).not.toContain("unrelated");
  });

  it("rejects dependency cycles instead of returning a truncated execution order", () => {
    const registry = [
      pack({ id: "cycle-a", name: "Cycle A", category: "core", requires: ["cycle-b"] }),
      pack({ id: "cycle-b", name: "Cycle B", category: "core", requires: ["cycle-a"] }),
    ];
    const result = new SATScaffoldResolver(registry).solve(["cycle-a"], { includeRecommendations: false });
    expect(result.satisfiable).toBe(false);
    expect(result.proofExplanation).toContain("cyclic dependency");
  });

  it("should reject mutually conflicting packs with UNSAT proof", () => {
    const solver = new SATScaffoldResolver(mockRegistry);
    const result = solver.solve(["auth-jwt", "auth-oauth"]);

    expect(result.satisfiable).toBe(false);
    expect(result.proofExplanation).toContain("Unsatisfiable");
    expect(result.conflictsDetected.length).toBeGreaterThan(0);
  });

  it("should fail gracefully when requested pack does not exist", () => {
    const solver = new SATScaffoldResolver(mockRegistry);
    const result = solver.solve(["non-existent-pack"]);

    expect(result.satisfiable).toBe(false);
    expect(result.unresolvedDependencies).toContain("non-existent-pack");
  });
});
