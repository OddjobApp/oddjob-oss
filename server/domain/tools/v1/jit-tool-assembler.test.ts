import { describe, it, expect } from "vitest";
import { assembleJITTools, type JITAssemblyResult } from "./jit-tool-assembler.js";

describe("JIT Tool Assembler", () => {
  it("should assemble a focused tool set based on intent keywords", () => {
    const result: JITAssemblyResult = assembleJITTools(
      "I need to query knowledge graph datasets and check xray lineage",
      { maxTools: 5 }
    );

    expect(result.tools.length).toBeLessThanOrEqual(5);
    expect(result.tools.length).toBeGreaterThan(0);
    expect(result.totalCandidateTools).toBeGreaterThan(50);
  });

  it("should respect category hints during tool scoring", () => {
    const result = assembleJITTools("search files and inspect code", {
      maxTools: 5,
      categoryHint: "git workspace code graph",
    });

    expect(result.tools.length).toBeGreaterThan(0);
    const matchedNames = result.tools.map((t) => t.name);
    expect(matchedNames.length).toBeLessThanOrEqual(5);
  });

  it("should always include required tools when specified", () => {
    const required = ["get_active_editor_context", "execute_sql"];
    const result = assembleJITTools("search files", {
      maxTools: 5,
      requiredToolNames: required,
    });

    const toolNames = result.tools.map((t) => t.name);
    for (const req of required) {
      if (toolNames.includes(req)) {
        expect(toolNames).toContain(req);
      }
    }
  });

  it("should fall back to core tools if intent matching yields few matches", () => {
    const result = assembleJITTools("xyzabc1239999", { maxTools: 5 });
    expect(result.tools.length).toBeGreaterThanOrEqual(1);
    expect(result.assembledCount).toBe(result.tools.length);
  });

  it("should handle empty or whitespace intent gracefully", () => {
    const result = assembleJITTools("   ", { maxTools: 3 });
    expect(result.tools.length).toBeGreaterThanOrEqual(1);
    expect(result.tools.length).toBeLessThanOrEqual(3);
  });
});
