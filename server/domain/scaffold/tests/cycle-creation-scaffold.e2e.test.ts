import { describe, it, expect } from "vitest";
import { DAGResolver } from "@domain/scaffold/dag-resolver.js";
import { ASTRuleEngine } from "@domain/scaffold/ast-rule-engine.js";
import { ScaffoldAssemblyService } from "@domain/scaffold/scaffold-assembly.service.js";
import type { PackManifest, AssemblyManifest } from "@shared/schema/scaffold.js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

describe("Cycle Creation & Dynamic Scaffold Integration E2E", () => {
  let tmpWorkspace: string;

  const cycleBlueprintPacks: PackManifest[] = [
    {
      id: "core-node-express",
      name: "Node Express Core",
      version: "1.0.0",
      category: "core",
      requires: [],
      conflicts: [],
      recommends: [],
      provides: ["web-host"],
      inject: [
        {
          target: "package.json",
          action: "MERGE_JSON",
          content: { name: "cycle-assembled-app", dependencies: { express: "^4.19.2" } }
        }
      ],
      templates: []
    },
    {
      id: "auth-jwt",
      name: "JWT Authentication",
      version: "1.0.0",
      category: "auth",
      extends: "core-node-express",
      requires: ["data-postgres-drizzle"],
      conflicts: ["auth-session"],
      recommends: [],
      provides: ["auth-provider"],
      inject: [
        {
          target: "src/app.ts",
          action: "AST_ADD_MIDDLEWARE",
          import: "import { authMiddleware } from './middleware/auth.js';",
          use: "app.use('/api', authMiddleware);"
        },
        {
          target: "package.json",
          action: "MERGE_JSON",
          path: "dependencies",
          content: { jsonwebtoken: "^9.0.2" }
        }
      ],
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
      inject: [
        {
          target: "package.json",
          action: "MERGE_JSON",
          path: "dependencies",
          content: { "drizzle-orm": "^0.30.0" }
        }
      ],
      templates: []
    }
  ];

  beforeEach(async () => {
    tmpWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), "cycle-scaffold-e2e-"));
    // Pre-create host app entry point file
    const appPath = path.join(tmpWorkspace, "src/app.ts");
    await fs.mkdir(path.dirname(appPath), { recursive: true });
    await fs.writeFile(appPath, "import express from 'express';\nconst app = express();\n", "utf-8");
  });

  afterEach(async () => {
    await fs.rm(tmpWorkspace, { recursive: true, force: true });
  });

  it("should simulate Cycle Creation and assemble feature packs in topological order", async () => {
    // 1. Operator creates cycle with blueprint requiring JWT Auth
    const cycleAssemblyManifest: AssemblyManifest = {
      appName: "q3-launch-cycle",
      targetDir: tmpWorkspace,
      packs: ["auth-jwt"],
      variables: { cycleName: "Q3 Operational Launch" }
    };

    // 2. DAG Engine resolves topological execution order
    const resolver = new DAGResolver(cycleBlueprintPacks);
    const executionOrder = resolver.resolveExecutionOrder(cycleAssemblyManifest.packs);

    expect(executionOrder.map(p => p.id)).toEqual([
      "core-node-express",
      "data-postgres-drizzle",
      "auth-jwt"
    ]);

    // 3. Assembly Service executes pipeline
    const assemblyService = new ScaffoldAssemblyService();
    const result = await assemblyService.assemble(cycleAssemblyManifest, cycleBlueprintPacks);

    expect(result.success).toBe(true);
    expect(result.executedPacks).toEqual([
      "core-node-express",
      "data-postgres-drizzle",
      "auth-jwt"
    ]);

    // 4. Verify AST Transformations & Package Merges
    const appTs = await fs.readFile(path.join(tmpWorkspace, "src/app.ts"), "utf-8");
    expect(appTs).toContain('import { authMiddleware } from "./middleware/auth.js";');
    expect(appTs).toContain("app.use('/api', authMiddleware);");

    const pkgJson = JSON.parse(await fs.readFile(path.join(tmpWorkspace, "package.json"), "utf-8"));
    expect(pkgJson.dependencies.express).toBe("^4.19.2");
    expect(pkgJson.dependencies["drizzle-orm"]).toBe("^0.30.0");
    expect(pkgJson.dependencies.jsonwebtoken).toBe("^9.0.2");
  });
});
