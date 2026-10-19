import { describe, it, expect } from "vitest";
import { DAGResolver } from "../dag-resolver.js";
import type { PackManifest } from "@shared/schema/scaffold.js";

describe("DAGResolver", () => {
  const sampleRegistry: PackManifest[] = [
    {
      id: "core-node-express",
      name: "Node Express Core",
      version: "1.0.0",
      category: "core",
      requires: [],
      conflicts: [],
      recommends: [],
      provides: ["web-host"],
      inject: [],
      templates: []
    },
    {
      id: "data-postgres-drizzle",
      name: "Postgres Drizzle ORM",
      version: "1.0.0",
      category: "data",
      extends: "core-node-express",
      requires: [],
      conflicts: [],
      recommends: [],
      provides: ["database"],
      inject: [],
      templates: []
    },
    {
      id: "auth-jwt",
      name: "JWT Auth Pack",
      version: "1.0.0",
      category: "auth",
      extends: "core-node-express",
      requires: ["data-postgres-drizzle"],
      conflicts: ["auth-session"],
      recommends: [],
      provides: ["auth-provider"],
      inject: [],
      templates: []
    },
    {
      id: "auth-session",
      name: "Session Auth Pack",
      version: "1.0.0",
      category: "auth",
      extends: "core-node-express",
      requires: ["data-postgres-drizzle"],
      conflicts: ["auth-jwt"],
      recommends: [],
      provides: ["auth-provider"],
      inject: [],
      templates: []
    }
  ];

  it("should correctly resolve prerequisite dependencies in topological order", () => {
    const resolver = new DAGResolver(sampleRegistry);
    const resolved = resolver.resolveExecutionOrder(["auth-jwt"]);
    const ids = resolved.map(p => p.id);

    expect(ids).toEqual(["core-node-express", "data-postgres-drizzle", "auth-jwt"]);
  });

  it("should throw an error if a requested pack conflicts with another", () => {
    const resolver = new DAGResolver(sampleRegistry);
    expect(() => {
      resolver.resolveExecutionOrder(["auth-jwt", "auth-session"]);
    }).toThrowError(/Scaffold conflict rule violation/);
  });

  it("should throw an error on circular dependencies", () => {
    const circularRegistry: PackManifest[] = [
      {
        id: "pack-a",
        name: "Pack A",
        version: "1.0.0",
        category: "core",
        requires: ["pack-b"],
        conflicts: [],
        recommends: [],
        provides: [],
        inject: [],
        templates: []
      },
      {
        id: "pack-b",
        name: "Pack B",
        version: "1.0.0",
        category: "core",
        requires: ["pack-a"],
        conflicts: [],
        recommends: [],
        provides: [],
        inject: [],
        templates: []
      }
    ];

    const resolver = new DAGResolver(circularRegistry);
    expect(() => {
      resolver.resolveExecutionOrder(["pack-a"]);
    }).toThrowError(/Circular dependency/);
  });
});
