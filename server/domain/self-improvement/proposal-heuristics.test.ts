import { describe, it, expect } from "vitest";
import {
  stripCommentsAndStrings,
  isSyntacticallyValid,
  containsConstructInCode,
  evaluateProposalConstructs,
} from "./proposal-heuristics.js";

const RESILIENCE = [/\bretry\b/i, /backoff/i, /circuit ?breaker/i];

describe("proposal-heuristics", () => {
  describe("stripCommentsAndStrings", () => {
    it("removes line comments, block comments, and string/template literals", () => {
      const code = `
        const x = 1; // retry here
        /* backoff in a block comment */
        const s = "retry in a string";
        const t = \`backoff in a template\`;
      `;
      const stripped = stripCommentsAndStrings(code);
      expect(stripped).not.toMatch(/retry/i);
      expect(stripped).not.toMatch(/backoff/i);
      expect(stripped).toContain("const x = 1");
    });
  });

  describe("containsConstructInCode", () => {
    it("does NOT match a keyword that only appears in a comment", () => {
      const code = `function f() { return 1; } // TODO: add retry/backoff later`;
      expect(containsConstructInCode(code, RESILIENCE)).toBe(false);
    });

    it("does NOT match a keyword that only appears in a string", () => {
      const code = `const label = "retry"; export const k = label;`;
      expect(containsConstructInCode(code, RESILIENCE)).toBe(false);
    });

    it("matches a keyword used in real code", () => {
      const code = `async function call() { await retry(() => doThing(), { backoff: true }); }`;
      expect(containsConstructInCode(code, RESILIENCE)).toBe(true);
    });
  });

  describe("isSyntacticallyValid", () => {
    it("is false for empty content", () => {
      expect(isSyntacticallyValid("")).toBe(false);
      expect(isSyntacticallyValid("   \n  ")).toBe(false);
    });

    it("is false for syntactically broken code", () => {
      expect(isSyntacticallyValid("function ( { return")).toBe(false);
    });

    it("is true for well-formed TypeScript (ignoring missing-module semantics)", () => {
      expect(isSyntacticallyValid(`import { x } from "nonexistent"; export const y: number = x + 1;`)).toBe(true);
    });
  });

  describe("evaluateProposalConstructs", () => {
    const fail = { code: "SIM_FAILURE", message: "no resilience construct" };

    it("fails closed on invalid syntax", () => {
      const res = evaluateProposalConstructs("function ( {", RESILIENCE, fail);
      expect(res.ok).toBe(false);
      expect(res.reason?.code).toBe("SIM_INVALID_CHANGE");
    });

    it("fails when valid code lacks the construct (and a comment can't fake it)", () => {
      const res = evaluateProposalConstructs(`export const f = () => 1; // retry`, RESILIENCE, fail);
      expect(res.ok).toBe(false);
      expect(res.reason).toEqual(fail);
    });

    it("passes when valid code introduces the construct", () => {
      const res = evaluateProposalConstructs(`export async function f() { await retry(() => g()); }`, RESILIENCE, fail);
      expect(res.ok).toBe(true);
      expect(res.reason).toBeUndefined();
    });
  });
});
