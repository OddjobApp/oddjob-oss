import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { createAiFixGenerator, extractCode } from "../autonomous/ai-fix-generator.js";
import type { FailureDiagnosis } from "../core/types.js";

const ORIGINAL = "export function add(a, b) {\n  return a - b; // bug\n}\n";
const CORRECTED = "export function add(a, b) {\n  return a + b;\n}\n";

function makeDiagnosis(affectedFile: string): FailureDiagnosis {
  return {
    testFile: "add.test.ts",
    testName: "adds two numbers",
    errorMessage: "expected 3 but got -1",
    rootCause: "subtraction used instead of addition",
    affectedFile,
    suggestedApproach: "use + instead of -",
  };
}

describe("createAiFixGenerator", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "aifix-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("generates a whole-file fix, applies it, then reverts it", async () => {
    await writeFile(path.join(dir, "add.ts"), ORIGINAL, "utf-8");
    const gen = createAiFixGenerator({ workspaceRoot: dir, synthesize: async () => CORRECTED });

    const fix = await gen.generateFix(makeDiagnosis("add.ts"), "s1");
    expect(fix.filePath).toBe("add.ts");
    expect(fix.changes).toHaveLength(1);
    expect(fix.changes[0].originalCode).toBe(ORIGINAL);
    expect(fix.changes[0].newCode).toBe(CORRECTED);

    await gen.applyFix(fix, "s1");
    expect(await readFile(path.join(dir, "add.ts"), "utf-8")).toBe(CORRECTED);

    await gen.revertFix(fix, "s1");
    expect(await readFile(path.join(dir, "add.ts"), "utf-8")).toBe(ORIGINAL);
  });

  it("throws when the AI returns no usable change", async () => {
    await writeFile(path.join(dir, "add.ts"), ORIGINAL, "utf-8");
    const gen = createAiFixGenerator({ workspaceRoot: dir, synthesize: async () => "" });
    await expect(gen.generateFix(makeDiagnosis("add.ts"), "s1")).rejects.toThrow(/no usable change/);
  });

  it("throws when the affected file cannot be read", async () => {
    const gen = createAiFixGenerator({ workspaceRoot: dir, synthesize: async () => CORRECTED });
    await expect(gen.generateFix(makeDiagnosis("missing.ts"), "s1")).rejects.toThrow(/could not read/);
  });
});

describe("extractCode", () => {
  it("strips a fenced code block", () => {
    expect(extractCode("```ts\nconst x = 1;\n```")).toBe("const x = 1;");
  });
  it("returns plain text unchanged", () => {
    expect(extractCode("const y = 2;")).toBe("const y = 2;");
  });
});
