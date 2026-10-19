import { db } from "@server/database_service.js";
import { memeticGraph } from "@shared/schema/learning/memetic-graph.js";
import { createLogger } from "@server/utils/logger.js";
import { systemAiService } from "@domain/ai/core/system-ai.service.js";
import { AIClientFactory } from "@domain/ai/core/ai-client.service.js";
import { eq, and } from "drizzle-orm";
import { assertOrgId } from "@server/utils/auth-context.js";

const logger = createLogger("MemeticLearning");

export const memeticLearningService = {
    /**
     * Extracts "Memes" (Patterns) from a completed mission.
     */
    async extractMemesFromMission(missionRunId: number, organizationId?: number): Promise<void> {
        try {
            const aiConfig = await systemAiService.getAiConfig('copilot', organizationId);
            if (!aiConfig) return;
            const client = AIClientFactory.getClient(aiConfig as any);

            const { missionRuns } = await import("@shared/schema/index.js");
            const [run] = await db.select().from(missionRuns).where(eq(missionRuns.id, missionRunId)).limit(1) as any[];
            if (!run) return;

            logger.info(`Extracting memetic patterns from successful run ${missionRunId}...`);

            const extractResult = await client.execute({
                model: aiConfig.model,
                systemPrompt: "You are an Institutional Memory Specialist. Extract reusable 'Memes' (successful logic, UI, or strategy patterns) from this mission trace. Return ONLY a JSON array of { key, type, payload, context }.",
                userPrompt: `Mission Goal: ${run.goal || run.name}\nTrace: ${JSON.stringify((run as any).trace || [])}`,
                requestType: "json",
                responseType: "json"
            } as any, undefined, aiConfig.apiKey ?? "") as any;

            if (extractResult.success && extractResult.output) {
                const memes = typeof extractResult.output === 'string' ? JSON.parse(extractResult.output) : extractResult.output;
                
                for (const meme of memes) {
                    await db.insert(memeticGraph).values({
                        organizationId: assertOrgId(organizationId),
                        key: meme.key,
                        type: meme.type,
                        payload: meme.payload,
                        context: meme.context,
                        confidence: 0.7, // Initial confidence
                        missionRunId
                    });
                }
                logger.info(`Successfully archived ${memes.length} memes to the institutional graph.`);
            }
        } catch (err: any) {
            logger.error(`Memetic Extraction failed for run ${missionRunId}: ${err.message}`);
        }
    },

    /**
     * Retrieves relevant memes for a new mission context.
     */
    async getRelevantMemes(context: any, organizationId?: number): Promise<string> {
        try {
            // In a real implementation, we'd use vector search or complex filtering
            // For now, we fetch the top 5 relevant memes based on type
            const results = await db.select()
                .from(memeticGraph)
                .where(eq(memeticGraph.organizationId, assertOrgId(organizationId)))
                .limit(5);

            if (results.length === 0) return "";

            return `INSTITUTIONAL MEMORY (REUSABLE PATTERNS):\n` + 
                results.map(m => `- [${m.key}]: ${JSON.stringify(m.payload)}`).join('\n');
        } catch (err: any) {
            logger.warn(`Failed to fetch relevant memes: ${err.message}`);
            return "";
        }
    }
};
