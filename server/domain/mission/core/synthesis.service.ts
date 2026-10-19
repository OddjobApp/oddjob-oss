import { db } from "@server/database_service.js";
import { missionShadowRuns } from "@shared/schema/missions/index.js";
import { eq, inArray } from "drizzle-orm";
import { systemAiService } from "../../ai/core/system-ai.service.js";
import { AIClientFactory } from "@domain/ai/core/ai-client.service.js";
import { createLogger } from "@server/utils/logger.js";
import { missionRunService } from "./mission-run.service.js";
import { developmentProviderKey } from "@domain/ai/core/org-gemini-key.js";

const logger = createLogger("SynthesisService");

export const synthesisService = {
  /**
   * Synthesize a new shadow candidate from multiple ancestors.
   */
  async synthesizeFromMultiple(parentRunId: number, ancestorShadowIds: number[]) {
    logger.info(`[SynthesisService] Synthesizing new candidate from shadows: ${ancestorShadowIds.join(", ")}`);
    
    // 1. Fetch ancestor data
    const ancestors = await db
      .select()
      .from(missionShadowRuns)
      .where(inArray(missionShadowRuns.id, ancestorShadowIds));
      
    if (ancestors.length < 2) {
      throw new Error("At least two ancestors are required for synthesis.");
    }

    // 2. Perform AI-driven tactic merging
    const synthesizedContext = await this.mergeTacticsWithLLM(ancestors);

    // 3. Create the new Synthesis Shadow Run
    const shadow = await missionRunService.createShadowRun({
      parentRunId,
      missionContext: synthesizedContext,
      modelId: ancestors[0].modelId || "synthesis-hybrid",
      promptVersion: `synth-${Date.now()}`,
      // Track all ancestors for genealogy
      ancestorShadowIds: ancestorShadowIds,
      derivedFromShadowId: ancestors[0].id 
    });

    return shadow;
  },

  /**
   * Use an LLM to merge instructions/content from multiple successful runs.
   */
  async mergeTacticsWithLLM(ancestors: any[]) {
    try {
      const config = await systemAiService.getAiConfig('copilot') || { provider: 'google', model: 'gemini-1.5-pro' };
      const apiKey = config.apiKey || developmentProviderKey();
      const aiClient = AIClientFactory.getClient({ provider: config.provider, baseUrl: config.baseUrl } as any);

      const prompt = `
        You are a Strategic Synthesis Engine. 
        Your task is to merge the "winning tactics" from multiple experimental AI configurations into a single, superior configuration.
        
        ANCESTOR CANDIDATES:
        ${ancestors.map((s, i) => `
        --- CANDIDATE ${i+1} (ID: ${s.id}, Score: ${s.evalScore}) ---
        CONTEXT/RESULT:
        ${JSON.stringify(s.missionContext, null, 2)}
        `).join("\n")}

        TASK:
        1. Identify the most successful instructions, formatting, or data structures across these ancestors.
        2. Resolve any conflicts or redundancies.
        3. Produce a SINGLE JSON "missionContext" that represents the best possible combination of these tactics.
        
        OUTPUT:
        Return ONLY the synthesized JSON object for the "missionContext".
      `;

      const result = await aiClient.execute({
        model: config.model,
        userPrompt: prompt,
        temperature: 0.2,
        systemPrompt: "You are an expert at merging AI configurations. Return ONLY JSON."
      } as any, undefined, apiKey);

      if (!result.success || !result.output) {
        throw new Error("Merge failed: No output from LLM");
      }

      const cleanJson = result.output.replace(/```json|```/g, "").trim();
      return JSON.parse(cleanJson);

    } catch (error: any) {
      logger.error(`[SynthesisService] Tactic merge failure: ${error.message}`);
      // Fallback: return the context of the best ancestor
      const best = ancestors.sort((a, b) => (b.evalScore || 0) - (a.evalScore || 0))[0];
      return best.missionContext;
    }
  }
};


