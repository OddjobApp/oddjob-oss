/**
 * Prompt Evolution Engine
 *
 * Closes the self-improvement loop:
 *   failure cluster → AI-mutated prompt candidate → shadow execution → fitness gate → promotion
 *
 * How it works:
 * 1. `scanAndMutate()` reads low-performing prompt versions (fitness < threshold)
 * 2. For each, calls AI to generate a mutated candidate and stores it in `promptVersions` as "experimental"
 * 3. `routeWithShadowing()` wraps any live prompt call — 10% of traffic goes to the experimental candidate
 * 4. After N shadow runs, `evaluateAndPromote()` compares fitness scores and promotes if improved
 */

import { db } from "@server/database_service.js";
import { createLogger } from "@server/utils/logger.js";
import {
  promptVersions,
  promptPerformanceLogs,
  failureClusters,
  orgLearningProfiles,
} from "@shared/schema/learning/index.js";
import { eq, and, desc, lt, sql, inArray } from "drizzle-orm";
import { systemAiService } from "@domain/ai/core/system-ai.service.js";
import { AIClientFactory } from "@domain/ai/core/ai-client.service.js";
import { adaptiveLearningService } from "./adaptive-learning.service.js";
import { LocalSLMService } from "@domain/ai/core/local-slm.service.js";
import fs from "fs";
import path from "path";

const logger = createLogger("PromptEvolutionEngine");

const FITNESS_THRESHOLD = 50;           // Mutate prompts below this fitness
const SHADOW_MIN_RUNS = 10;             // Min shadow runs before evaluating promotion
const PROMOTION_IMPROVEMENT_DELTA = 5;  // Must beat baseline by this many fitness points

export interface MutationResult {
  success: boolean;
  newVersionId?: string;
  promptType?: string;
  message: string;
}

export interface ShadowRouteResult {
  id: number;
  versionId: string;
  isShadow: boolean;
  prompt: string;
}

export class PromptEvolutionEngineService {

  // =========================================================================
  // MUTATION SCAN
  // =========================================================================

  /**
   * Scans all prompt versions below the fitness threshold and generates
   * AI-mutated candidates for each. Safe to run on a schedule (e.g., daily).
   */
  async scanAndMutate(organizationId: number): Promise<MutationResult[]> {
    logger.info(`[PromptEvolution] Scanning for low-fitness prompts in org ${organizationId}`);
    const results: MutationResult[] = [];

    try {
      // Find under-performing active prompt versions
      const lowFitness = await db.query.promptVersions.findMany({
        where: and(
          eq(promptVersions.organizationId, organizationId),
          eq(promptVersions.status, "active"),
          lt(sql`COALESCE(CAST(${promptVersions.fitnessScore} AS FLOAT), 0)`, FITNESS_THRESHOLD)
        ),
        orderBy: desc(promptVersions.usageCount), // Prioritize well-used ones
        limit: 5,
      });

      if (lowFitness.length === 0) {
        logger.info(`[PromptEvolution] No low-fitness prompts found for org ${organizationId}.`);
        return [];
      }

      // Pull recent failure context to inform mutations
      const failureContext = await db.query.failureClusters.findMany({
        where: and(
          eq(failureClusters.organizationId, organizationId),
          eq(failureClusters.status, "active")
        ),
        orderBy: desc(failureClusters.incidentCount),
        limit: 5,
      });

      const failureSummary = failureContext
        .map(f => `- ${f.domain}: ${f.name} (${f.incidentCount} incidents)`)
        .join("\n");

      for (const version of lowFitness) {
        const result = await this.mutatePromptVersion(organizationId, version, failureSummary);
        results.push(result);
      }
    } catch (err: any) {
      logger.error(`[PromptEvolution] scanAndMutate failed: ${err.message}`);
    }

    return results;
  }

  /**
   * Calls AI to generate an improved version of a given prompt.
   */
  /**
   * Calls AI to generate an improved version of a given prompt.
   */
  private async mutatePromptVersion(
    organizationId: number,
    version: any,
    failureSummary: string
  ): Promise<MutationResult> {
    try {
      // 1. Failure cluster context pruning
      const prunedSummary = failureSummary
        .split("\n")
        .slice(0, 3) // Limit to top 3 failure clusters
        .map(line => line.substring(0, 150)) // Truncate line length
        .join("\n");

      // 2. Dynamic mutation temperature based on fitness
      const parentFitness = parseFloat(version.fitnessScore || "50");
      const mutationTemp = Math.max(0.2, Math.min(0.8, (100 - parentFitness) / 100));

      const mutationPrompt = `You are a Prompt Engineer optimizing AI agent prompts.

ORIGINAL PROMPT (fitness score: ${version.fitnessScore || "unknown"}/100):
${version.systemPrompt}

KNOWN FAILURE PATTERNS IN THIS ORGANIZATION (PRUNED):
${prunedSummary || "None recorded."}

TASK: Produce an improved version of this prompt that:
1. Addresses the known failure patterns above
2. Keeps the same intent and format
3. Is clearer, more specific, and reduces ambiguity
4. Does NOT change tool names, JSON schemas, or protocol formats

Return ONLY the improved prompt text. No explanation, no markdown wrapping.`;

      let mutatedPrompt = "";

      // 3. Ollama local SLM check & execution
      let ollamaRunning = false;
      try {
        const res = await fetch("http://localhost:11434/api/tags", { signal: AbortSignal.timeout(1000) });
        ollamaRunning = res.ok;
      } catch {
        ollamaRunning = false;
      }

      if (ollamaRunning) {
        logger.info(`[PromptEvolution] Ollama is healthy. Mutating via local model deepseek-r1:latest...`);
        const localResult = await LocalSLMService.execute('reason', mutationPrompt, true);
        if (localResult) {
          mutatedPrompt = localResult.trim();
        }
      }

      // 4. Cloud Fallback if local SLM is not running or failed
      if (!mutatedPrompt) {
        logger.info(`[PromptEvolution] Running mutation via cloud AI with temp ${mutationTemp}...`);
        const aiConfig = await systemAiService.getAiConfig("copilot", organizationId);
        if (!aiConfig) {
          return { success: false, message: "No AI config available" };
        }

        const aiClient = AIClientFactory.getClient(aiConfig as any);
        const result = await aiClient.execute({
          model: aiConfig.model,
          userPrompt: mutationPrompt,
          temperature: mutationTemp,
        } as any, undefined, aiConfig.apiKey || "");

        if (result.success && result.output) {
          mutatedPrompt = result.output.trim();
        }
      }

      if (!mutatedPrompt) {
        return { success: false, message: "AI mutation returned no output", promptType: version.promptType };
      }

      const evolutionResult = await adaptiveLearningService.evolvePrompt(
        organizationId,
        version.promptType,
        version.versionId,
        "ai_mutation",
        mutatedPrompt,
        `AI-generated mutation targeting: ${prunedSummary.slice(0, 100)}`
      );

      logger.info(`[PromptEvolution] Mutated prompt version ${version.versionId} → ${evolutionResult.newVersionId}`);
      return {
        success: true,
        newVersionId: evolutionResult.newVersionId,
        promptType: version.promptType,
        message: `Mutation created: ${evolutionResult.newVersionId}`,
      };
    } catch (err: any) {
      logger.error(`[PromptEvolution] Failed to mutate version ${version.versionId}: ${err.message}`);
      return { success: false, message: err.message, promptType: version.promptType };
    }
  }

  // =========================================================================
  // SHADOW ROUTING
  // =========================================================================

  /**
   * Wraps a prompt lookup with shadow routing: 10% of calls go to the
   * experimental candidate (if one exists) for A/B evaluation.
   * Returns the selected prompt and a flag indicating if it's a shadow run.
   */
  async routeWithShadowing(
    organizationId: number,
    promptType: string,
    shadowRate: number = 0.1
  ): Promise<ShadowRouteResult | null> {
    // Get the active (baseline) version
    const baseline = await adaptiveLearningService.selectPromptVersion(organizationId, promptType, false);
    if (!baseline) return null;

    // Check if there's an experimental candidate
    const experimental = await adaptiveLearningService.selectPromptVersion(organizationId, promptType, true);

    let selected: { id: number; versionId: string; isShadow: boolean; prompt: string };

    if (experimental && Math.random() < shadowRate) {
      logger.info(`[PromptEvolution] Shadow routing to experimental version ${experimental.versionId} for type ${promptType}`);
      selected = { id: experimental.id, versionId: experimental.versionId, isShadow: true, prompt: experimental.prompt };
    } else {
      selected = { id: baseline.id, versionId: baseline.versionId, isShadow: false, prompt: baseline.prompt };
    }

    // Inject codebase-specific skill profile conventions
    const finalPrompt = await this.injectSkillProfile(organizationId, selected.prompt);

    return {
      id: selected.id,
      versionId: selected.versionId,
      isShadow: selected.isShadow,
      prompt: finalPrompt
    };
  }

  // =========================================================================
  // PROMOTION GATE
  // =========================================================================

  /**
   * Evaluates experimental prompt versions that have accumulated enough shadow
   * runs. If they beat the baseline by PROMOTION_IMPROVEMENT_DELTA fitness
   * points, promotes them to "active" and retires the old baseline.
   */
  async evaluateAndPromote(organizationId: number, minRuns?: number): Promise<{ promoted: number; retired: number }> {
    let promoted = 0;
    let retired = 0;
    const thresholdRuns = minRuns !== undefined ? minRuns : SHADOW_MIN_RUNS;

    try {
      const experimentals = await db.query.promptVersions.findMany({
        where: and(
          eq(promptVersions.organizationId, organizationId),
          eq(promptVersions.status, "experimental"),
          sql`${promptVersions.usageCount} >= ${thresholdRuns}`
        ),
      });

      for (const exp of experimentals) {
        if (!exp.parentVersionId) continue;

        // Get parent baseline fitness
        const parent = await db.query.promptVersions.findFirst({
          where: eq(promptVersions.versionId, exp.parentVersionId),
        });

        if (!parent) continue;

        const expFitness = parseFloat(exp.fitnessScore || "0");
        const parentFitness = parseFloat(parent.fitnessScore || "0");

        if (expFitness >= parentFitness + PROMOTION_IMPROVEMENT_DELTA) {
          logger.info(`[PromptEvolution] Promoting ${exp.versionId} (fitness ${expFitness}) over ${parent.versionId} (fitness ${parentFitness})`);

          await db.update(promptVersions)
            .set({ status: "active", updatedAt: new Date() })
            .where(eq(promptVersions.versionId, exp.versionId));

          await db.update(promptVersions)
            .set({ status: "archived", updatedAt: new Date() })
            .where(eq(promptVersions.versionId, parent.versionId));

          promoted++;
          retired++;
        } else {
          logger.info(`[PromptEvolution] ${exp.versionId} did not beat baseline (${expFitness} vs ${parentFitness}). Retiring experimental.`);
          await db.update(promptVersions)
            .set({ status: "archived", updatedAt: new Date() })
            .where(eq(promptVersions.versionId, exp.versionId));
          retired++;
        }
      }
    } catch (err: any) {
      logger.error(`[PromptEvolution] evaluateAndPromote failed: ${err.message}`);
    }

    return { promoted, retired };
  }

  /**
   * Forces immediate baseline promotion evaluation for a specific experimental version,
   * skipping the shadow runs threshold check.
   */
  async evaluateAndPromoteImmediate(
    organizationId: number,
    experimentalVersionId: string
  ): Promise<{ success: boolean; promoted: boolean; message: string }> {
    try {
      const exp = await db.query.promptVersions.findFirst({
        where: and(
          eq(promptVersions.organizationId, organizationId),
          eq(promptVersions.versionId, experimentalVersionId),
          eq(promptVersions.status, "experimental")
        ),
      });

      if (!exp) {
        return { success: false, promoted: false, message: `Experimental version ${experimentalVersionId} not found or not in experimental status.` };
      }

      if (!exp.parentVersionId) {
        return { success: false, promoted: false, message: "Experimental version has no parent version to evaluate against." };
      }

      const parent = await db.query.promptVersions.findFirst({
        where: eq(promptVersions.versionId, exp.parentVersionId),
      });

      if (!parent) {
        return { success: false, promoted: false, message: `Parent version ${exp.parentVersionId} not found.` };
      }

      const expFitness = parseFloat(exp.fitnessScore || "0");
      const parentFitness = parseFloat(parent.fitnessScore || "0");

      if (expFitness >= parentFitness + PROMOTION_IMPROVEMENT_DELTA) {
        logger.info(`[PromptEvolution] Immediate promotion: Promoting ${exp.versionId} (fitness ${expFitness}) over ${parent.versionId} (fitness ${parentFitness})`);

        await db.update(promptVersions)
          .set({ status: "active", updatedAt: new Date() })
          .where(eq(promptVersions.versionId, exp.versionId));

        await db.update(promptVersions)
          .set({ status: "archived", updatedAt: new Date() })
          .where(eq(promptVersions.versionId, parent.versionId));

        return { success: true, promoted: true, message: `Promoted ${exp.versionId} over ${parent.versionId} (fitness ${expFitness} vs ${parentFitness}).` };
      } else {
        logger.info(`[PromptEvolution] Immediate evaluation: ${exp.versionId} did not beat baseline (${expFitness} vs ${parentFitness}). Retiring experimental.`);
        
        await db.update(promptVersions)
          .set({ status: "archived", updatedAt: new Date() })
          .where(eq(promptVersions.versionId, exp.versionId));

        return { success: true, promoted: false, message: `Experimental version did not beat baseline. Retired ${exp.versionId}.` };
      }
    } catch (err: any) {
      logger.error(`[PromptEvolution] evaluateAndPromoteImmediate failed: ${err.message}`);
      return { success: false, promoted: false, message: err.message };
    }
  }

  /**
   * Rolls back an active prompt version to its parent version.
   */
  async rollbackPromptVersion(organizationId: number, versionId: string): Promise<{ success: boolean; message: string }> {
    try {
      const version = await db.query.promptVersions.findFirst({
        where: and(
          eq(promptVersions.organizationId, organizationId),
          eq(promptVersions.versionId, versionId)
        )
      });

      if (!version) {
        return { success: false, message: `Version ${versionId} not found.` };
      }

      if (version.status !== "active") {
        return { success: false, message: `Only active versions can be rolled back. Current status is ${version.status}.` };
      }

      if (!version.parentVersionId) {
        return { success: false, message: `Version ${versionId} has no parent version to roll back to.` };
      }

      const parentVersion = await db.query.promptVersions.findFirst({
        where: and(
          eq(promptVersions.organizationId, organizationId),
          eq(promptVersions.versionId, version.parentVersionId)
        )
      });

      if (!parentVersion) {
        return { success: false, message: `Parent version ${version.parentVersionId} not found.` };
      }

      // Rollback: set current version to "retired" and parent version to "active"
      await db.update(promptVersions)
        .set({ status: "retired", retiredAt: new Date(), updatedAt: new Date() })
        .where(eq(promptVersions.versionId, versionId));

      await db.update(promptVersions)
        .set({ status: "active", updatedAt: new Date() })
        .where(eq(promptVersions.versionId, version.parentVersionId));

      logger.info(`[PromptEvolution] Rolled back active prompt from ${versionId} to parent ${version.parentVersionId}`);
      return { success: true, message: `Successfully rolled back to parent version ${version.parentVersionId}` };
    } catch (err: any) {
      logger.error(`[PromptEvolution] rollbackPromptVersion failed: ${err.message}`);
      return { success: false, message: err.message };
    }
  }

  /**
   * Generates a fine-tuning dataset from successful logs for a given prompt type.
   * Writes the dataset as JSONL to scratch/training_data_${promptType}.jsonl
   */
  async generateTrainingDataset(organizationId: number, promptType: string): Promise<{ filePath: string; count: number }> {
    try {
      // Find all successful logs for this prompt type
      const successfulLogs = await db.query.promptPerformanceLogs.findMany({
        where: and(
          eq(promptPerformanceLogs.organizationId, organizationId),
          eq(promptPerformanceLogs.promptType, promptType),
          eq(promptPerformanceLogs.success, true)
        ),
        orderBy: desc(promptPerformanceLogs.createdAt),
        limit: 1000,
      });

      if (successfulLogs.length === 0) {
        throw new Error(`No successful logs found for prompt type ${promptType}.`);
      }

      // We need prompt versions to get the system prompts
      const versionIds = [...new Set(successfulLogs.map(log => log.promptVersionId))];
      const versions = await db.query.promptVersions.findMany({
        where: inArray(promptVersions.id, versionIds)
      });

      const versionMap = new Map(versions.map(v => [v.id, v]));

      // Format as JSONL examples
      const jsonlLines: string[] = [];
      for (const log of successfulLogs) {
        const version = versionMap.get(log.promptVersionId);
        if (!version) continue;

        // Construct a structured messages array for fine-tuning
        const systemPrompt = version.systemPrompt;
        const inputContext = `Input context hash: ${log.inputHash || "N/A"}. Mission: ${log.missionId || "N/A"}. Job: ${log.jobId || "N/A"}.`;
        const completionResult = `Execution succeeded. Score: ${log.outputQualityScore || "100"}. Feedback: ${log.userFeedback || "None"}.`;

        const item = {
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: inputContext },
            { role: "assistant", content: completionResult }
          ]
        };

        jsonlLines.push(JSON.stringify(item));
      }

      const scratchDir = path.join(process.cwd(), "scratch");
      if (!fs.existsSync(scratchDir)) {
        fs.mkdirSync(scratchDir, { recursive: true });
      }

      const filePath = path.join(scratchDir, `training_data_${promptType}.jsonl`);
      fs.writeFileSync(filePath, jsonlLines.join("\n"), "utf-8");

      logger.info(`[PromptEvolution] Generated training dataset at ${filePath} with ${jsonlLines.length} examples.`);
      return { filePath, count: jsonlLines.length };
    } catch (err: any) {
      logger.error(`[PromptEvolution] generateTrainingDataset failed: ${err.message}`);
      throw err;
    }
  }

  /**
   * Injects organization/codebase skill profile preferences into the system prompt.
   */
  async injectSkillProfile(organizationId: number, systemPrompt: string): Promise<string> {
    try {
      const profile = await db.query.orgLearningProfiles.findFirst({
        where: eq(orgLearningProfiles.organizationId, organizationId),
      });

      if (!profile || !profile.learningEnabled) {
        return systemPrompt;
      }

      const preferences: string[] = [];

      if (profile.preferredFramework) {
        preferences.push(`- Preferred Framework: ${profile.preferredFramework}`);
      }
      if (profile.preferredUiLibrary) {
        preferences.push(`- Preferred UI Library: ${profile.preferredUiLibrary}`);
      }
      if (profile.preferredStyling) {
        preferences.push(`- Preferred Styling: ${profile.preferredStyling}`);
      }
      if (profile.preferredDataFetching) {
        preferences.push(`- Preferred Data Fetching: ${profile.preferredDataFetching}`);
      }
      if (profile.communicationStyle) {
        preferences.push(`- Communication Style: ${profile.communicationStyle}`);
      }
      if (profile.customSystemPromptAdditions) {
        preferences.push(`- Additional Organization Rules: ${profile.customSystemPromptAdditions}`);
      }

      if (preferences.length === 0) {
        return systemPrompt;
      }

      const skillProfileText = `
### CODEBASE PERSONA & TECHNICAL PREFERENCES
You must adhere to the following codebase-specific conventions and organization personas:
${preferences.join("\n")}
`;

      return `${systemPrompt}\n${skillProfileText}`;
    } catch (err: any) {
      logger.error(`[PromptEvolution] injectSkillProfile failed: ${err.message}`);
      return systemPrompt;
    }
  }
}

export const promptEvolutionEngine = new PromptEvolutionEngineService();
