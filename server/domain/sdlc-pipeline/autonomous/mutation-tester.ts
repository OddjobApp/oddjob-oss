/**
 * Automated Mutation Testing (Extension 4 — test_loop phase, full_test tier)
 *
 * When the self-healing loop reaches `all_passed`, minor syntactic mutations are
 * injected into the newly written code and the suite is re-run. A mutation that
 * *survives* (tests still pass) exposes a weak assertion — the loop flags it and
 * forces a test-refactor iteration.
 *
 * This module owns the deterministic mutant *generation*. Executing a mutant
 * (applying it and re-running the suite) is delegated to an injectable
 * `MutationRunner`, mirroring the test-loop controller's other runners. The
 * default runner is conservative — it reports every mutant as killed, so the
 * feature never raises a false weak-assertion alarm until a real runner is wired.
 */

import * as nodePath from "node:path";
import { readFile as fsReadFile, writeFile as fsWriteFile } from "node:fs/promises";
import type {
  InjectedMutation,
  MutationType,
  MutationTesting,
} from "../core/types.js";

export interface ChangedFileForMutation {
  filePath: string;
  newCode: string;
}

export interface MutationRunnerContext {
  testFiles: string[];
  sessionId: string;
}

export interface MutationRunResult {
  survived: boolean;      // true = suite still passed with the mutant applied
  killingTest?: string;   // the test that caught it, when killed
}

export interface MutationRunner {
  runMutant(mutant: InjectedMutation, ctx: MutationRunnerContext): Promise<MutationRunResult>;
}

// Conservative default: assume the suite catches every mutation. Used in tests
// and until a real runner is wired at startup (see runner-wiring.ts).
export const killAllMutationRunner: MutationRunner = {
  async runMutant() {
    return { survived: false };
  },
};

// ─── Real mutant application ────────────────────────────────────────────────

/**
 * Transform a single source line for a given mutation type. Returns the mutated
 * line, or `null` when the token the mutant targets is not present. Imperfect
 * transforms bias safe: a mutant that breaks compilation makes the suite fail →
 * the mutant is *killed*, never a false weak-assertion signal.
 */
function mutateLine(line: string, type: MutationType): string | null {
  switch (type) {
    case "negate_conditional": {
      if (line.includes("===")) return line.replace("===", "!==");
      if (line.includes("!==")) return line.replace("!==", "===");
      if (/[^=!]==[^=]/.test(line)) return line.replace(/([^=!])==([^=])/, "$1!=$2");
      if (/[^=!]!=[^=]/.test(line)) return line.replace(/([^=!])!=([^=])/, "$1==$2");
      return null;
    }
    case "conditional_boundary": {
      if (line.includes("<=")) return line.replace("<=", "<");
      if (line.includes(">=")) return line.replace(">=", ">");
      const lt = line.replace(/([^<>=!/])<(?![/=])/, "$1<=");
      if (lt !== line) return lt;
      const gt = line.replace(/([^<>=!])>(?![=])/, "$1>=");
      if (gt !== line) return gt;
      return null;
    }
    case "return_value": {
      const re = /(return\s+)(true|false|null|undefined|-?\d+)/;
      if (!re.test(line)) return null;
      const map: Record<string, string> = { true: "false", false: "true", null: "undefined", undefined: "null" };
      return line.replace(re, (_all, pre, val) => pre + (val in map ? map[val] : String(Number(val) + 1)));
    }
    case "arithmetic_operator": {
      const re = /([\w)\]])\s([+\-*/])\s([\w(])/;
      if (!re.test(line)) return null;
      const swap: Record<string, string> = { "+": "-", "-": "+", "*": "/", "/": "*" };
      return line.replace(re, (_a, l, op, r) => `${l} ${swap[op]} ${r}`);
    }
    case "increment": {
      if (line.includes("++")) return line.replace("++", "--");
      if (line.includes("--")) return line.replace("--", "++");
      return null;
    }
    case "string_literal": {
      const re = /(["'])([^"'\n]{2,})\1/;
      if (!re.test(line)) return null;
      return line.replace(re, (_a, q, inner) => `${q}${inner}_MUT${q}`);
    }
    case "remove_call": {
      const re = /\b[a-zA-Z_$][\w$]*\s*\([^)]*\)\s*;/;
      if (!re.test(line)) return null;
      return line.replace(re, "/* mutant: call removed */ void 0;");
    }
  }
}

/**
 * Apply a mutant to full file content. Returns the mutated content, or `null`
 * when the mutation could not be applied (caller treats that as a killed mutant).
 */
export function applyMutation(content: string, mutant: InjectedMutation): string | null {
  const lines = content.split("\n");
  const idx = mutant.location.startLine - 1;
  if (idx < 0 || idx >= lines.length) return null;
  const mutated = mutateLine(lines[idx], mutant.mutationType);
  if (mutated === null || mutated === lines[idx]) return null;
  lines[idx] = mutated;
  return lines.join("\n");
}

export interface RealMutationRunnerOptions {
  /** Root the mutant's (relative) filePath resolves against. */
  workspaceRoot: string;
  /** Executes the affected tests; `passed: true` ⇒ mutant survived (weak). */
  runTests: (testFiles: string[]) => Promise<{ passed: boolean }>;
}

/**
 * A real MutationRunner: writes the mutant to disk, runs the affected tests to
 * see whether they still pass (mutant survived), and always reverts the file.
 * Any read/apply/run error is treated as a killed mutant (fail-safe).
 */
export function createRealMutationRunner(opts: RealMutationRunnerOptions): MutationRunner {
  return {
    async runMutant(mutant, ctx) {
      const abs = nodePath.isAbsolute(mutant.filePath)
        ? mutant.filePath
        : nodePath.join(opts.workspaceRoot, mutant.filePath);

      let original: string;
      try {
        original = await fsReadFile(abs, "utf-8");
      } catch {
        return { survived: false }; // unreadable target → treat as killed
      }

      const mutated = applyMutation(original, mutant);
      if (mutated === null || mutated === original) {
        return { survived: false }; // no meaningful mutation applied → killed
      }

      try {
        await fsWriteFile(abs, mutated, "utf-8");
        const { passed } = await opts.runTests(ctx.testFiles);
        return { survived: passed };
      } catch {
        return { survived: false }; // execution error → killed
      } finally {
        // Always restore the original source (best effort).
        await fsWriteFile(abs, original, "utf-8").catch(() => undefined);
      }
    },
  };
}

const MAX_MUTANTS = 25;

// Per-line mutation detectors, in priority order (one mutant per matching line
// per category, capped globally).
const DETECTORS: Array<{ type: MutationType; re: RegExp }> = [
  { type: "return_value", re: /\breturn\s+(true|false|null|undefined|-?\d+)\b/ },
  { type: "negate_conditional", re: /(===|!==|==(?!=)|!=(?!=))/ },
  { type: "conditional_boundary", re: /(^|[^<>=!/])(<=|>=|<(?![/=])|>(?![=]))/ },
  { type: "arithmetic_operator", re: /[\w)\]]\s[+\-*/]\s[\w(]/ },
  { type: "increment", re: /(\+\+|--)/ },
  { type: "string_literal", re: /["'][^"'\n]{2,}["']/ },
  { type: "remove_call", re: /\b[a-zA-Z_$][\w$]*\s*\([^)]*\)\s*;/ },
];

function shortId(filePath: string): string {
  const base = filePath.split(/[/\\]/).pop() ?? filePath;
  return base.replace(/[^a-zA-Z0-9]+/g, "-");
}

/** Enumerate candidate mutants for a single changed file (bounded, deterministic). */
export function generateMutants(file: ChangedFileForMutation): InjectedMutation[] {
  const mutants: InjectedMutation[] = [];
  const lines = file.newCode.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip comment-only and empty lines to avoid mutating non-executable text.
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;

    // Emit one mutant per matching detector on the line (a line that both
    // returns and branches yields both a return_value and a conditional mutant);
    // the global MAX_MUTANTS cap in runMutationTesting keeps the set bounded.
    for (const det of DETECTORS) {
      if (det.re.test(line)) {
        mutants.push({
          id: `mut-${shortId(file.filePath)}-${i + 1}-${det.type}`,
          filePath: file.filePath,
          mutationType: det.type,
          location: { startLine: i + 1, endLine: i + 1 },
          survived: false, // filled in by the runner
        });
      }
    }
  }

  return mutants;
}

/**
 * Generate mutants across all changed files, execute each via the runner, and
 * assemble the MutationTesting telemetry block.
 */
export async function runMutationTesting(
  changedFiles: ChangedFileForMutation[],
  runner: MutationRunner,
  ctx: MutationRunnerContext
): Promise<MutationTesting> {
  const mutants = changedFiles.flatMap((f) => generateMutants(f)).slice(0, MAX_MUTANTS);

  for (const mutant of mutants) {
    const result = await runner.runMutant(mutant, ctx);
    mutant.survived = result.survived;
    if (result.killingTest) mutant.killingTest = result.killingTest;
  }

  const injectedCount = mutants.length;
  const survivedCount = mutants.filter((m) => m.survived).length;
  const killedCount = injectedCount - survivedCount;
  const mutationScore = injectedCount > 0 ? Number((killedCount / injectedCount).toFixed(4)) : 1;
  const weakAssertionDetected = survivedCount > 0;

  return {
    enabled: true,
    tier: "full_test",
    mutationsInjected: mutants,
    injectedCount,
    survivedCount,
    killedCount,
    mutationScore,
    weakAssertionDetected,
    forcedRefactorIteration: weakAssertionDetected,
    refactorIterationsTriggered: weakAssertionDetected ? 1 : 0,
  };
}
