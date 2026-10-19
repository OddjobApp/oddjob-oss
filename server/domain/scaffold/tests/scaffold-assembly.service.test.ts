import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ScaffoldAssemblyService } from "../scaffold-assembly.service.js";
import type { PackManifest, AssemblyManifest } from "@shared/schema/scaffold.js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

// Mock X-Ray composition service to avoid full DB requirement in unit test
vi.mock("@domain/xray/core/xray-composition.service.js", () => ({
  xrayCompositionService: {
    reindexScope: vi.fn().mockResolvedValue({ success: true })
  }
}));

describe("ScaffoldAssemblyService", () => {
  let tmpDir: string;
  let service: ScaffoldAssemblyService;

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
      inject: [
        {
          target: "package.json",
          action: "MERGE_JSON",
          content: { name: "sample-app", dependencies: { express: "^4.18.2" } }
        }
      ],
      templates: []
    },
    {
      id: "auth-jwt",
      name: "JWT Auth Pack",
      version: "1.0.0",
      category: "auth",
      extends: "core-node-express",
      requires: [],
      conflicts: [],
      recommends: [],
      provides: ["auth-provider"],
      inject: [
        {
          target: "package.json",
          action: "MERGE_JSON",
          path: "dependencies",
          content: { jsonwebtoken: "^9.0.0" }
        }
      ],
      templates: []
    }
  ];

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "scaffold-assembly-test-"));
    service = new ScaffoldAssemblyService();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("should assemble a complete application workspace using DAG ordering and AST merging", async () => {
    const manifest: AssemblyManifest = {
      appName: "my-test-app",
      targetDir: tmpDir,
      packs: ["auth-jwt"],
      variables: {}
    };

    const result = await service.assemble(manifest, sampleRegistry);

    expect(result.success).toBe(true);
    expect(result.executedPacks).toEqual(["core-node-express", "auth-jwt"]);

    const pkgPath = path.join(tmpDir, "package.json");
    const pkgRaw = await fs.readFile(pkgPath, "utf-8");
    const pkg = JSON.parse(pkgRaw);

    expect(pkg.dependencies.express).toBe("^4.18.2");
    expect(pkg.dependencies.jsonwebtoken).toBe("^9.0.0");
  });

  it("should perform atomic rollback on error during assembly", async () => {
    const appPath = path.join(tmpDir, "app.ts");
    const originalContent = "const original = true;\n";
    await fs.writeFile(appPath, originalContent, "utf-8");

    const brokenPacks: PackManifest[] = [
      {
        id: "broken-pack",
        name: "Broken Pack",
        version: "1.0.0",
        category: "core",
        requires: ["non-existent-pack"],
        conflicts: [],
        recommends: [],
        provides: [],
        inject: [],
        templates: []
      }
    ];

    const manifest: AssemblyManifest = {
      appName: "rollback-app",
      targetDir: tmpDir,
      packs: ["broken-pack"],
      variables: {}
    };

    const result = await service.assemble(manifest, brokenPacks);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Scaffold pack not found");

    const content = await fs.readFile(appPath, "utf-8");
    expect(content).toBe(originalContent);
  });
});
