
import { db } from "@server/database_service.js";
import { missions, missionRuns, jobs } from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { systemAiService } from "@domain/ai/core/system-ai.service.js";
import { AIClientFactory } from "@domain/ai/core/ai-client.service.js";
import { VIBE_CRITIC_PROMPT } from "../core/prompts.js";

import { createHash } from "node:crypto";
import { z } from "zod";
import { MissionContextSchema } from "./mission-types.js";

const logger = createLogger("VibeDetector");

const auditCache = new Map<string, VibeAuditResult>();

export const VibeAuditResultSchema = z.object({
    alignmentScore: z.number().min(0).max(1),
    driftDetected: z.boolean(),
    critique: z.string(),
    suggestedNudges: z.array(z.string())
});

export type VibeAuditResult = z.infer<typeof VibeAuditResultSchema>;

export const vibeDetector = {
    /**
     * Conducts a qualitative audit of the current wave output against the intended vibe.
     */
    async runAudit(missionRunId: number): Promise<VibeAuditResult> {
        logger.info(`Running Vibe Audit for Mission Run ${missionRunId}`);

        const [run] = await db.select().from(missionRuns).where(eq(missionRuns.id, missionRunId)).limit(1);
        if (!run) throw new Error("Mission run not found");


        const parsedContext = MissionContextSchema.safeParse(run.missionContext);
        const blackboard = parsedContext.success ? parsedContext.data : {} as any;
        const vibeIntent = blackboard.vibe_intent || "No intent defined.";
        const waveOutput = blackboard.latest_wave_output || "No output captured yet.";

        // Mach 1: Hash-based Memoization
        const outputHash = createHash("sha256").update(`${vibeIntent}|${waveOutput}`).digest("hex");
        if (auditCache.has(outputHash)) {
            logger.info(`[Mach 1] Cache Hit: Skipping AI Audit for hash ${outputHash.substring(0, 8)}`);
            return auditCache.get(outputHash)!;
        }

        // 1. Recruit the Vibe Critic
        const [criticJob] = await db.select().from(jobs).where(eq(jobs.name, "Vibe Critic")).limit(1);
        
        // 2. Perform LLM-based audit
        const systemPrompt = VIBE_CRITIC_PROMPT;
        const userPrompt = `
        INTENDED VIBE:
        ${vibeIntent}

        CURRENT WAVE OUTPUT:
        ${waveOutput}

        Perform a "Vibe Audit". Identify drift and provide nudges for the next wave.
        `;

        try {
            const aiConfig = await systemAiService.getAiConfig('copilot');
            if (!aiConfig) throw new Error("AI Configuration not found");

            const aiClient = AIClientFactory.getClient({ 
                provider: aiConfig.provider as any,
                baseUrl: aiConfig.baseUrl 
            });

            const result = await aiClient.execute({
                model: aiConfig.model,
                systemPrompt: systemPrompt,
                userPrompt: userPrompt,
                requestType: "json",
                temperature: 0.2,
                useCache: false,
                saveOutputToFile: false
            }, undefined, aiConfig.apiKey ?? "");

            if (!result.success || !result.output) {
                throw new Error(result.error || "No output from AI Critic");
            }

            const responseBody = JSON.parse(result.output);
            
            // Map common AI field name variations to our schema
            const response = {
                alignmentScore: responseBody.alignment_score ?? responseBody.alignmentScore ?? 0.5,
                driftDetected: responseBody.drift_detected ?? responseBody.driftDetected ?? true,
                critique: responseBody.critique || "No critique provided.",
                suggestedNudges: responseBody.suggested_nudges || responseBody.nudges || []
            };

            const auditParsed = VibeAuditResultSchema.safeParse(response);
            
            if (!auditParsed.success) {
                logger.error(`Vibe Audit validation failed: ${auditParsed.error.message}`);
                throw new Error("Malformed Vibe Audit response from AI");
            }

            const auditResult = auditParsed.data;

            // Store in Mach 1 Cache
            auditCache.set(outputHash, auditResult);

            return auditResult;
        } catch (err: any) {
            logger.error(`Vibe Audit failed: ${err.message}`);
            return {
                alignmentScore: 0,
                driftDetected: true,
                critique: "Audit process failed. Assume high drift.",
                suggestedNudges: ["Verify LLM connectivity", "Simplify vibe intent"]
            };
        }
    }
};
