import { describe, it, expect } from "vitest";
import {
  generateMutants,
  applyMutation,
  runMutationTesting,
  createRealMutationRunner,
  type MutationRunner,
} from "../autonomous/mutation-tester.js";
import * as os from "node:os";
import * as path from "node:path";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";

describe("generateMutants", () => {
  it("emits multiple mutants for a line that both branches and returns", () => {
    const mutants = generateMutants({
      filePath: "calc.ts",
      newCode: "function f(a, b) {\n  if (a === b) return true;\n  return a + b;\n}",
    });
    const line2 = mutants.filter((m) => m.location.startLine === 2).map((m) => m.mutationType);
    expect(line2).toContain("negate_conditional");
    expect(line2).toContain("return_value");
  });

  it("skips comment-only lines", () => {
    const mutants = generateMutants({ filePath: "c.ts", newCode: "// return true;\nconst x = 1;" });
    expect(mutants.every((m) => m.location.startLine !== 1)).toBe(true);
  });
});

describe("applyMutation", () => {
  it("negates an equality operator", () => {
    const [m] = generateMutants({ filePath: "c.ts", newCode: "if (a === b) {}" }).filter(
      (x) => x.mutationType === "negate_conditional"
    );
    expect(applyMutation("if (a === b) {}", m)).toBe("if (a !== b) {}");
  });

  it("flips a boolean return", () => {
    const [m] = generateMutants({ filePath: "c.ts", newCode: "return true;" }).filter(
      (x) => x.mutationType === "return_value"
    );
    expect(applyMutation("return true;", m)).toBe("return false;");
  });

  it("returns null when the mutant's line is out of range", () => {
    expect(
      applyMutation("one line", {
        id: "x",
        filePath: "c.ts",
        mutationType: "increment",
        location: { startLine: 99, endLine: 99 },
        survived: false,
      })
    ).toBeNull();
  });
});

describe("runMutationTesting", () => {
  it("scores survivors as a weak assertion", async () => {
    const runner: MutationRunner = { async runMutant(m) { return { survived: m.mutationType === "return_value" }; } };
    const result = await runMutationTesting(
      [{ filePath: "c.ts", newCode: "return true;" }],
      runner,
      { testFiles: ["c.test.ts"], sessionId: "s" }
    );
    expect(result.injectedCount).toBeGreaterThan(0);
    expect(result.survivedCount).toBe(1);
    expect(result.weakAssertionDetected).toBe(true);
    expect(result.forcedRefactorIteration).toBe(true);
  });

  it("reports full score when every mutant is killed", async () => {
    const result = await runMutationTesting(
      [{ filePath: "c.ts", newCode: "return true;" }],
      { async runMutant() { return { survived: false }; } },
      { testFiles: [], sessionId: "s" }
    );
    expect(result.mutationScore).toBe(1);
    expect(result.weakAssertionDetected).toBe(false);
  });
});

describe("createRealMutationRunner", () => {
  it("applies a mutant, runs tests, and reverts the file", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "mut-"));
    try {
      const src = "export function f() {\n  return true;\n}\n";
      await writeFile(path.join(dir, "f.ts"), src, "utf-8");
      const [mutant] = generateMutants({ filePath: "f.ts", newCode: src }).filter(
        (m) => m.mutationType === "return_value"
      );

      const survivor = createRealMutationRunner({ workspaceRoot: dir, runTests: async () => ({ passed: true }) });
      const r1 = await survivor.runMutant(mutant, { testFiles: ["f.test.ts"], sessionId: "s" });
      expect(r1.survived).toBe(true);
      expect(await readFile(path.join(dir, "f.ts"), "utf-8")).toBe(src); // reverted

      const killer = createRealMutationRunner({ workspaceRoot: dir, runTests: async () => ({ passed: false }) });
      const r2 = await killer.runMutant(mutant, { testFiles: ["f.test.ts"], sessionId: "s" });
      expect(r2.survived).toBe(false);
      expect(await readFile(path.join(dir, "f.ts"), "utf-8")).toBe(src); // reverted
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
