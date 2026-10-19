import { describe, it, expect } from "vitest";
import { scaffoldMcpTools } from "../scaffold-tools.js";

describe("Scaffold MCP Tools", () => {
  it("should expose list_scaffold_packs tool and return available packs", async () => {
    const listTool = scaffoldMcpTools.find(t => t.name === "list_scaffold_packs");
    expect(listTool).toBeDefined();

    const result = await listTool!.handler();
    expect(result.success).toBe(true);
    expect(result.packs.length).toBeGreaterThanOrEqual(2);
  });
});
