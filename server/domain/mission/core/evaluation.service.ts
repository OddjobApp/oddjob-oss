import { db } from "@server/database_service.js";
import { missionRuns, missionShadowRuns, missions } from "@shared/schema/missions/index.js";
import { eq, and } from "drizzle-orm";
import { systemAiService } from "../../ai/core/system-ai.service.js";
import { AIClientFactory } from "@domain/ai/core/ai-client.service.js";
import { createLogger } from "@server/utils/logger.js";
import { developmentProviderKey } from "@domain/ai/core/org-gemini-key.js";

const logger = createLogger("EvaluationService");

export interface EvaluationResult {
  score: number;
  isImproved: boolean;
  reasoning: string;
  delta?: string;
}

export const evaluationService = {
  /**
   * Compare a shadow run's deliverable against its primary parent.
   */
  async compareShadowRun(shadowRunId: number): Promise<EvaluationResult | null> {
    logger.info(`[EvaluationService] Evaluating shadow run ${shadowRunId}`);
    
    // 1. Fetch shadow run data
    const [shadow] = await db
      .select()
      .from(missionShadowRuns)
      .where(eq(missionShadowRuns.id, shadowRunId))
      .limit(1);
      
    if (!shadow) {
      logger.error(`Shadow run ${shadowRunId} not found`);
      return null;
    }
    
    // 2. Fetch primary run (parent)
    const [primary] = await db
      .select()
      .from(missionRuns)
      .where(eq(missionRuns.id, shadow.parentRunId))
      .limit(1);
      
    if (!primary) {
      logger.error(`Primary parent run ${shadow.parentRunId} not found for shadow ${shadowRunId}`);
      return null;
    }
    
    // 3. Fetch deliverables from missionContext
    const primaryResult = (primary.missionContext as any)?.result || "";
    const shadowResult = (shadow.missionContext as any)?.result || "";
    
    if (!primaryResult || !shadowResult) {
      logger.warn(`Missing result for comparison in shadow run ${shadowRunId}. Primary exists: ${!!primaryResult}, Shadow exists: ${!!shadowResult}`);
      return null;
    }
    
    // 4. Get Mission context (Objective & Goal)
    const [mission] = await db
        .select()
        .from(missions)
        .where(eq(missions.id, primary.missionId as number))
        .limit(1);
    
    const objective = mission?.objective || "No objective defined";
    const targetMetric = mission?.targetMetric ? JSON.stringify(mission.targetMetric) : "General quality optimization";
    const steeringNudge = (mission as any)?.humanSteeringNudge || null;

    // 5. Execute Judge Model
    return await this.judgeWithLLM(primaryResult, shadowResult, objective, targetMetric, steeringNudge);
  },

  /**
   * Use an LLM to perform a side-by-side comparison.
   */
  async judgeWithLLM(
    primaryContent: string,
    shadowContent: string,
    objective: string,
    goal: string,
    steeringNudge?: string | null,
    modelOverride?: { provider: string; model: string; baseUrl?: string }
  ): Promise<EvaluationResult> {
    try {
      const systemConfig = await systemAiService.getAiConfig('copilot') || { provider: 'google', model: 'gemini-1.5-pro' };
      const config = modelOverride
        ? { ...systemConfig, provider: modelOverride.provider, model: modelOverride.model, baseUrl: modelOverride.baseUrl ?? systemConfig.baseUrl }
        : systemConfig;
      const apiKey = this.resolveApiKey(config);
      const aiClient = AIClientFactory.getClient({ provider: config.provider, baseUrl: config.baseUrl } as any);

      const prompt = `
        You are an impartial Judge for an AI experimentation platform. 
        Your task is to compare the outputs of two AI configurations (Primary vs Shadow) and determine if the SHADOW version is an improvement.

        MISSION OBJECTIVE:
        "${objective}"

        OPTIMIZATION GOAL / TARGET METRIC:
        "${goal}"

        ${steeringNudge ? `
        HUMAN STEERING NUDGE (CRITICAL GUIDANCE):
        "The user has provided specific steering for this optimization cycle: ${steeringNudge}. 
        Prioritize this guidance above all other general criteria."
        ` : ''}

        ---
        PRIMARY DELIVERABLE (Baseline):
        ${primaryContent.substring(0, 10000)}

        ---
        SHADOW DELIVERABLE (Experimental):
        ${shadowContent.substring(0, 10000)}

        ---
        JUDGING CRITERIA:
        1. Accuracy & alignment with mission objective.
        2. Adherence to the optimization goal (quality, tone, detail, or specific metric).
        ${steeringNudge ? `3. STRICT ADHERENCE to the Human Steering Nudge: "${steeringNudge}"` : '3. Formatting and structural integrity.'}
        4. Conciseness vs. Completeness (depending on goal).

        OUTPUT INSTRUCTIONS:
        - Assign a relative score (0-100) where 50 means identical, >50 means shadow is better, <50 means primary is better.
        - set isImproved to true ONLY if there is a significant, noticeable improvement.
        - Provide a 2-3 sentence reasoning.
        - Respond ONLY with the following JSON format:
        {
          "score": number,
          "isImproved": boolean,
          "reasoning": "string",
          "delta": "string summary of the difference"
        }
      `;

      const result = await aiClient.execute({
        model: config.model,
        userPrompt: prompt,
        temperature: 0,
        systemPrompt: "You are a strict, objective technical evaluator. Return only JSON."
      } as any, undefined, apiKey);

      if (!result.success || !result.output) {
         throw new Error("AI Judge returned no output");
      }

      // Cleanup response from potential markdown blocks
      const cleanJson = result.output.replace(/```json|```/g, "").trim();
      return JSON.parse(cleanJson) as EvaluationResult;

    } catch (error: any) {
      logger.error(`[EvaluationService] Judge Model failure: ${error.message}`);
      return {
        score: 0,
        isImproved: false,
        reasoning: `Evaluation failed: ${error.message}`,
        delta: "Evaluation error"
      };
    }
  },

  resolveApiKey(config: any): string {
    return config.apiKey || developmentProviderKey();
  }
};


