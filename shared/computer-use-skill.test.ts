import { describe, expect, it } from "vitest";
import { buildRuntimeInputSchema, skillDefinitionSchema } from "./computer-use-skill";
const step = { kind: "fill", url: "https://example.com", at: 0, target: { tag: "input", css: "#account" }, value: "{{account}}" };
describe("learned skill editing contract", () => {
  it("prevents a deleted variable from leaving an executable broken template", () => {
    expect(skillDefinitionSchema.safeParse({ inputs: [], steps: [step] }).success).toBe(false);
    expect(skillDefinitionSchema.safeParse({ inputs: [{ name: "account", type: "string" }], steps: [step] }).success).toBe(true);
  });
  it("rejects secret values, executable URL schemes and ambiguous output names", () => {
    expect(skillDefinitionSchema.safeParse({ inputs: [], steps: [{ ...step, secret: "password", value: "secret" }] }).success).toBe(false);
    expect(skillDefinitionSchema.safeParse({ inputs: [], steps: [{ kind: "navigate", url: "javascript:alert(1)", at: 0 }] }).success).toBe(false);
    const output = { kind: "extract", extractMode: "url", output: "link", url: "https://example.com", at: 0 };
    expect(skillDefinitionSchema.safeParse({ inputs: [], steps: [output, output] }).success).toBe(false);
    expect(skillDefinitionSchema.safeParse({ inputs: [], steps: [output] }).success).toBe(true);
  });

  it("buildRuntimeInputSchema compiles and validates runtime arguments correctly", () => {
    const schema = buildRuntimeInputSchema([
      { name: "query", type: "string", required: true },
      { name: "count", type: "number", required: false },
      { name: "start_date", type: "date", required: true }
    ]);

    const validResult = schema.safeParse({
      query: "Oddjob agent",
      count: "15", // should transform string to number
      start_date: "2026-09-25"
    });
    expect(validResult.success).toBe(true);
    if (validResult.success) {
      expect(validResult.data.count).toBe(15);
      expect(validResult.data.query).toBe("Oddjob agent");
    }

    // Missing required field
    const invalidMissing = schema.safeParse({
      query: "Oddjob agent"
    });
    expect(invalidMissing.success).toBe(false);

    // Optional field omitted is fine
    const validOmitted = schema.safeParse({
      query: "Oddjob agent",
      start_date: "2026-09-25"
    });
    expect(validOmitted.success).toBe(true);
  });
});
