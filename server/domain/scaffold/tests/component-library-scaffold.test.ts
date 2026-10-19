import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ScaffoldRegistryService } from "@server/domain/scaffold/scaffold-registry.service.js";
import { scaffoldAssemblyService } from "@server/domain/scaffold/scaffold-assembly.service.js";
import type { AssemblyManifest } from "@shared/schema/scaffold.js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

describe("Component Library Scaffold Integration Test", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "component-lib-scaffold-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("should load and assemble @oddjob/design-system component library pack", async () => {
    const registryService = new ScaffoldRegistryService();
    const packs = await registryService.loadAllPacks();

    const uiPack = packs.find(p => p.id === "ui-oddjob-design-system");
    expect(uiPack).toBeDefined();
    expect(uiPack?.provides).toContain("ui-component-library");

    const manifest: AssemblyManifest = {
      appName: "design-system-app",
      targetDir: tmpDir,
      packs: ["ui-oddjob-design-system"],
      variables: {}
    };

    const packRegistryDir = path.resolve(process.cwd(), "packages/scaffold-registry");
    const result = await scaffoldAssemblyService.assemble(manifest, packs, packRegistryDir);

    expect(result.success).toBe(true);
    expect(result.executedPacks).toEqual(["core-node-express", "ui-oddjob-design-system"]);

    const pkgPath = path.join(tmpDir, "package.json");
    const pkg = JSON.parse(await fs.readFile(pkgPath, "utf-8"));

    expect(pkg.dependencies["@oddjob/design-system"]).toBe("*");
    expect(pkg.dependencies["lucide-react"]).toBe("^0.368.0");

    const providerFile = path.join(tmpDir, "src/components/DesignSystemProvider.tsx");
    const providerContent = await fs.readFile(providerFile, "utf-8");
    expect(providerContent).toContain("oddjob-design-system-root");
  });

  it("should assemble multi-pack app with core, auth, and UI design system without AST collision", async () => {
    const registryService = new ScaffoldRegistryService();
    const packs = await registryService.loadAllPacks();

    const manifest: AssemblyManifest = {
      appName: "full-featured-app",
      targetDir: tmpDir,
      packs: ["auth-jwt", "ui-oddjob-design-system"],
      variables: {}
    };

    const packRegistryDir = path.resolve(process.cwd(), "packages/scaffold-registry");
    const result = await scaffoldAssemblyService.assemble(manifest, packs, packRegistryDir);

    expect(result.success).toBe(true);
    expect(result.executedPacks).toContain("core-node-express");
    expect(result.executedPacks).toContain("auth-jwt");
    expect(result.executedPacks).toContain("ui-oddjob-design-system");

    const pkgPath = path.join(tmpDir, "package.json");
    const pkg = JSON.parse(await fs.readFile(pkgPath, "utf-8"));

    // Check dependencies merged from all 3 packs
    expect(pkg.dependencies["express"]).toBeDefined();
    expect(pkg.dependencies["jsonwebtoken"]).toBeDefined();
    expect(pkg.dependencies["@oddjob/design-system"]).toBe("*");
  });
});

