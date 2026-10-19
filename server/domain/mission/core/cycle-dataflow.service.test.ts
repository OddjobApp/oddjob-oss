import { describe, it, expect } from "vitest";
import {
  getOutputDecls,
  declaresOutputs,
  validateOutputValue,
  validateDataFlowContracts,
} from "./cycle-dataflow.service.js";

describe("getOutputDecls — output declaration shapes", () => {
  it("treats a string[] as existence-only declarations", () => {
    expect(getOutputDecls({ outputs: ["plan", "report"] })).toEqual({ plan: {}, report: {} });
  });

  it("reads scalar type shorthand", () => {
    expect(getOutputDecls({ outputs: { plan: "array" } })).toEqual({ plan: { type: "array" } });
  });

  it("reads a full contract with schema + required", () => {
    const decls = getOutputDecls({
      outputs: { plan: { type: "object", schema: { tasks: "array" }, required: true } },
    });
    expect(decls.plan).toEqual({ type: "object", schema: { tasks: "array" }, required: true });
  });

  it("falls back to config.outputs and reports declaresOutputs", () => {
    expect(getOutputDecls({ config: { outputs: ["x"] } })).toEqual({ x: {} });
    expect(declaresOutputs({ outputs: ["x"] })).toBe(true);
    expect(declaresOutputs({})).toBe(false);
  });
});

describe("validateOutputValue — runtime contract checks", () => {
  it("flags a missing required value", () => {
    expect(validateOutputValue(null, {}).valid).toBe(false);
    expect(validateOutputValue(undefined, { type: "array" }).errors[0]).toMatch(/missing/);
  });

  it("allows a missing value when required=false", () => {
    expect(validateOutputValue(null, { required: false }).valid).toBe(true);
  });

  it("enforces scalar type", () => {
    expect(validateOutputValue([1, 2], { type: "array" }).valid).toBe(true);
    expect(validateOutputValue("nope", { type: "array" }).valid).toBe(false);
    expect(validateOutputValue(5, { type: "number" }).valid).toBe(true);
  });

  it("enforces a field schema on objects", () => {
    const decl = { type: "object" as const, schema: { tasks: "array" as const, owner: "string" as const } };
    expect(validateOutputValue({ tasks: [], owner: "me" }, decl).valid).toBe(true);
    const bad = validateOutputValue({ tasks: "x" }, decl);
    expect(bad.valid).toBe(false);
    expect(bad.errors.some((e) => /missing field "owner"/.test(e))).toBe(true);
    expect(bad.errors.some((e) => /field "tasks" expected array/.test(e))).toBe(true);
  });

  it("passes presence-only declarations for any non-null value", () => {
    expect(validateOutputValue("anything", {}).valid).toBe(true);
  });
});

describe("validateDataFlowContracts — static validation", () => {
  const src = (name: string, outputs?: any) => ({ name, outputs });
  const sink = (name: string, dataFlows: any[]) => ({ name, dataFlows });

  it("passes when the source declares the pulled output", () => {
    const bps = [
      src("Build", { plan: "array" }),
      sink("QA", [{ sourceBlueprint: "Build", sourceOutputKey: "plan", targetInputKey: "plan" }]),
    ];
    const r = validateDataFlowContracts(bps as any);
    expect(r.errors).toEqual([]);
  });

  it("errors when the source is not a blueprint in the cycle", () => {
    const bps = [sink("QA", [{ sourceBlueprint: "Ghost", sourceOutputKey: "x", targetInputKey: "y" }])];
    const r = validateDataFlowContracts(bps as any);
    expect(r.errors.some((e) => /not a blueprint/.test(e))).toBe(true);
  });

  it("errors on an undeclared key when the source declares other outputs (typo)", () => {
    const bps = [
      src("Build", { plan: "array" }),
      sink("QA", [{ sourceBlueprint: "Build", sourceOutputKey: "plna", targetInputKey: "p" }]),
    ];
    const r = validateDataFlowContracts(bps as any);
    expect(r.errors.some((e) => /undeclared output "plna"/.test(e))).toBe(true);
  });

  it("warns (not errors) when the source declares no outputs at all (legacy)", () => {
    const bps = [
      src("Build"),
      sink("QA", [{ sourceBlueprint: "Build", sourceOutputKey: "plan", targetInputKey: "p" }]),
    ];
    const r = validateDataFlowContracts(bps as any);
    expect(r.errors).toEqual([]);
    expect(r.warnings.some((w) => /no output contracts/.test(w))).toBe(true);
  });
});
