import { describe, it, expect } from "vitest";
import { ScaffoldRegistryService } from "../scaffold-registry.service.js";

describe("ScaffoldRegistryService", () => {
  it("should scan packages/scaffold-registry and load valid PackManifests", async () => {
    const service = new ScaffoldRegistryService();
    const packs = await service.loadAllPacks();

    expect(packs.length).toBeGreaterThanOrEqual(2);

    const expressPack = packs.find(p => p.id === "core-node-express");
    expect(expressPack).toBeDefined();
    expect(expressPack?.category).toBe("core");

    const jwtPack = packs.find(p => p.id === "auth-jwt");
    expect(jwtPack).toBeDefined();
    expect(jwtPack?.extends).toBe("core-node-express");
  });
});
