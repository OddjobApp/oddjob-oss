import { describe, expect, it } from "vitest";
import { discoveryToolDefinitions } from "./discovery.js";

describe("MCP discovery tools", () => {
    it("advertises organization-scoped capability discovery", () => {
        const tool = discoveryToolDefinitions.find((definition) => definition.name === "discover_capabilities");
        expect(tool).toBeDefined();
        expect(tool?.inputSchema.required).toContain("query");
        expect(tool?.inputSchema.properties).toHaveProperty("limit");
    });

    it("advertises non-executable Evolution proposals separately", () => {
        const tool = discoveryToolDefinitions.find((definition) => definition.name === "discover_capability_proposals");
        expect(tool).toBeDefined();
        expect(tool?.description).toContain("non-executable");
    });
});
