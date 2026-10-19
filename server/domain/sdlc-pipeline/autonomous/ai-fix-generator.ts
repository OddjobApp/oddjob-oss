/**
 * AI Fix Generator (Test Loop Controller integration)
 *
 * A real FixGenerator: given a failure diagnosis, asks the platform's system AI
 * (Gemini-first) for a corrected version of the affected file, then applies /
 * reverts it on disk. The original content is carried inside the AppliedFix
 * (`changes[0].originalCode`), so revert is stateless.
 *
 * Fail-safe: if the AI is unavailable or returns no usable change, generateFix
 * throws — the test loop records the attempt and terminates as "exhausted",
 * exactly as the fail-closed default did.
 */

import * as nodePath from "node:path";
import { readFile as fsReadFile, writeFile as fsWriteFile } from "node:fs/promises";
import { createLogger } from "@server/utils/logger.js";
import type { FixGenerator } from "./test-loop-controller.service.js";
import type { AppliedFix, FailureDiagnosis } from "../core/types.js";

const logger = createLogger("AiFixGenerator");

export interface FixSynthesisInput {
  diagnosis: FailureDiagnosis;
  filePath: string;
  fileContent: string;
}

/** Produces the corrected full-file content for the affected file. */
export type FixSynthesizer = (input: FixSynthesisInput) => Promise<string>;

export interface AiFixGeneratorOptions {
  workspaceRoot: string;
  /** Override the LLM call (used in tests); defaults to the Gemini system AI. */
  synthesize?: FixSynthesizer;
}

function buildFixPrompt(input: FixSynthesisInput, isAtomicBlock = false): string {
  const { diagnosis, filePath, fileContent } = input;
  const targetLabel = isAtomicBlock ? "test block" : "source file";
  return [
    "You are an autonomous software engineer fixing a failing test.",
    `Return ONLY the complete corrected contents of the ${targetLabel} — no prose, no explanation, no markdown fences.`,
    "",
    `Failing test: ${diagnosis.testFile} :: ${diagnosis.testName}`,
    `Error: ${diagnosis.errorMessage}`,
    `Root cause: ${diagnosis.rootCause}`,
    `Suggested approach: ${diagnosis.suggestedApproach}`,
    "",
    isAtomicBlock ? "--- CURRENT TEST BLOCK CODE ---" : "--- CURRENT FILE CONTENTS ---",
    fileContent,
    isAtomicBlock ? "--- END TEST BLOCK CODE ---" : "--- END FILE CONTENTS ---",
    "",
    `Output the full corrected ${targetLabel}:`,
  ].join("\n");
}

/** Strip markdown code fences and surrounding whitespace from an LLM response. */
export function extractCode(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```[a-zA-Z0-9]*\n([\s\S]*?)\n```$/);
  if (fenced) return fenced[1].trim();
  // Tolerate a leading/trailing fence without a clean pair.
  return trimmed.replace(/^```[a-zA-Z0-9]*\n?/, "").replace(/\n?```$/, "").trim();
}

async function defaultSynthesize(input: FixSynthesisInput): Promise<string> {
  const { systemAiService } = await import("@domain/ai/core/system-ai.service.js");
  const raw = await systemAiService.generateText(buildFixPrompt(input), {
    serviceKey: "architect",
    temperature: 0.1,
  });
  return extractCode(raw ?? "");
}

function resolvePath(workspaceRoot: string, filePath: string): string {
  return nodePath.isAbsolute(filePath) ? filePath : nodePath.join(workspaceRoot, filePath);
}

/**
 * Build a real FixGenerator backed by the system AI. Whole-file replacement is
 * used (simpler and safer than parsing LLM line-diffs); the single CodeChange
 * spans the file and carries both the original and corrected content.
 */
export function createAiFixGenerator(opts: AiFixGeneratorOptions): FixGenerator {
  const synthesize = opts.synthesize ?? defaultSynthesize;

  return {
    async generateFix(diagnosis: FailureDiagnosis, sessionId: string): Promise<AppliedFix> {
      const rel = diagnosis.affectedFile;
      const abs = resolvePath(opts.workspaceRoot, rel);

      let original: string;
      try {
        original = await fsReadFile(abs, "utf-8");
      } catch (err: any) {
        throw new Error(`AI fix generator could not read ${rel}: ${err?.message ?? err}`);
      }

      // Check if this is an E2E spec file and we can use atomic test repair
      const isE2E = rel.includes("playwright-test-repo") || rel.endsWith(".spec.ts");
      let testBlockCode = "";
      let testId = "";

      if (isE2E) {
        try {
          const { e2eTestIndexerService } = await import("./e2e-test-indexer.service.js");
          let cleanName = diagnosis.testName;
          if (cleanName.includes(" › ")) {
            cleanName = cleanName.split(" › ").pop() || cleanName;
          }
          const fileBasename = nodePath.basename(rel, ".spec.ts").replace(/\./g, "_");
          const nameSlug = cleanName.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
          testId = `${fileBasename}:${nameSlug}`;

          const indexed = await e2eTestIndexerService.getTestById(testId);
          if (indexed) {
            testBlockCode = indexed.code;
          }
        } catch (err: any) {
          logger.warn(`Could not resolve E2E test block code for atomic fix: ${err.message}`);
        }
      }

      let corrected: string;
      if (testBlockCode) {
        logger.info(`Surgically repairing E2E test block ${testId} for ${rel}`);
        const customSynthesize = async (inp: FixSynthesisInput): Promise<string> => {
          const { systemAiService } = await import("@domain/ai/core/system-ai.service.js");
          const raw = await systemAiService.generateText(buildFixPrompt(inp, true), {
            serviceKey: "architect",
            temperature: 0.1,
          });
          return extractCode(raw ?? "");
        };
        const correctedBlock = await customSynthesize({ diagnosis, filePath: rel, fileContent: testBlockCode });
        
        if (!correctedBlock || !correctedBlock.trim() || correctedBlock === testBlockCode) {
          throw new Error(`AI fix generator produced no usable change for test block in ${rel}`);
        }

        const { e2eTestIndexerService } = await import("./e2e-test-indexer.service.js");
        corrected = e2eTestIndexerService.assembleSpecContent(original, rel, testId, correctedBlock);
      } else {
        corrected = await synthesize({ diagnosis, filePath: rel, fileContent: original });
      }

      if (!corrected || !corrected.trim() || corrected === original) {
        throw new Error(`AI fix generator produced no usable change for ${rel}`);
      }

      logger.info(`Generated AI fix for ${rel} (session ${sessionId})`);
      return {
        filePath: rel,
        changes: [
          {
            startLine: 1,
            endLine: original.split("\n").length,
            originalCode: original,
            newCode: corrected,
            contextLines: 0,
          },
        ],
        description: `AI fix: ${diagnosis.rootCause}`,
      };
    },

    async applyFix(fix: AppliedFix, _sessionId: string): Promise<void> {
      const change = fix.changes[0];
      if (!change) throw new Error("AppliedFix has no changes to apply");
      await fsWriteFile(resolvePath(opts.workspaceRoot, fix.filePath), change.newCode, "utf-8");
    },

    async revertFix(fix: AppliedFix, _sessionId: string): Promise<void> {
      const change = fix.changes[0];
      if (!change) return;
      await fsWriteFile(resolvePath(opts.workspaceRoot, fix.filePath), change.originalCode, "utf-8");
    },
  };
}
