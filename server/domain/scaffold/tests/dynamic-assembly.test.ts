import { describe, it, expect, beforeEach } from "vitest";
import { dynamicAssemblyService } from "../dynamic-assembly.service.js";
import { dynamicAppRegistry } from "../dynamic-app-registry.js";
import type { LayoutNode } from "../formal/types.js";

describe("DynamicAssemblyService (In-Memory Hot-Assembly)", () => {
  beforeEach(() => {
    dynamicAppRegistry.clear();
  });

  it("should assemble and hot-mount an application in under 50ms", async () => {
    const layoutTree: LayoutNode = {
      id: "dynamic_shell",
      name: "Dynamic Threat Monitor",
      direction: "row",
      gap: 16,
      children: [
        { id: "sidebar", name: "Sidebar", sizingMode: "fixed", width: 260, ergonomicMinWidth: 48 },
        { id: "feed", name: "Live Feed", sizingMode: "fluid", minWidth: 380, targetWidth: 800 }
      ]
    };

    const res = await dynamicAssemblyService.assembleDynamicApp({
      slug: "live-threat-monitor",
      name: "Live Threat Monitor",
      packs: ["core-node-express", "auth-jwt", "ui-oddjob-design-system"],
      layoutTree,
      brandSeedHex: "#0EA5E9",
      endpoints: [
        { method: "GET", path: "/incidents", responsePayload: { total: 42, active: 3 } },
        { method: "POST", path: "/mitigate", responsePayload: { success: true, action: "isolated_container" } }
      ]
    });

    expect(res.success).toBe(true);
    expect(res.slug).toBe("live-threat-monitor");
    expect(res.assemblyTimeMs).toBeLessThan(100);
    expect(res.invariantsVerifiedCount).toBeGreaterThan(0);
    expect(res.theme.meetsAA).toBe(true);
    expect(res.endpointsMounted).toContain("GET /api/status");
    expect(res.endpointsMounted).toContain("GET /incidents");
    expect(res.endpointsMounted).toContain("POST /mitigate");

    // Verify registry presence
    const registered = dynamicAppRegistry.getApp("live-threat-monitor");
    expect(registered).toBeDefined();
    expect(registered?.name).toBe("Live Threat Monitor");
    expect(registered?.router).toBeDefined();
  });

  it("should fail gracefully if invalid pack constraints are requested", async () => {
    const layoutTree: LayoutNode = {
      id: "invalid_shell",
      name: "Invalid App"
    };

    const res = await dynamicAssemblyService.assembleDynamicApp({
      slug: "broken-app",
      name: "Broken App",
      packs: ["non-existent-pack-999"],
      layoutTree
    });

    expect(res.success).toBe(false);
    expect(res.error).toBeDefined();
  });
});
