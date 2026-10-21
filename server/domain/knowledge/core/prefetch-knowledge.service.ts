import { search_unified_knowledge } from "../../tools/v1/capabilities/search-core.js";
import { researchPredictor } from "../../prediction-intelligence/prediction/research-predictor.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("PrefetchKnowledge");

export class PrefetchKnowledgeService {
    /**
     * Predicts and prefetches knowledge for a mission using the prediction engine.
     */
    static async prefetchForMission(missionPrompt: string, organizationId: number | null, userId: string): Promise<void> {
        logger.info(`[PrefetchKnowledge] Starting prefetch for mission: "${missionPrompt.substring(0, 50)}..."`);

        try {
            // 1. Use Prediction Engine (ResearchPredictor) to get priority keywords
            const now = Date.now();
            const predictionResult = await researchPredictor.predictResearchTargets(missionPrompt, { now } as any);
            
            const queries: string[] = predictionResult.priorityKeywords || [];
            
            // Fallback to extraction if prediction engine returns nothing or very few keywords
            if (queries.length < 2) {
                logger.info("[PrefetchKnowledge] Prediction engine returned few keywords, adding fallback queries...");
                // Add some default queries based on the prompt or use a simple heuristic
                const words = missionPrompt.split(' ').filter(w => w.length > 4).slice(0, 3);
                queries.push(...words);
            }

            logger.info(`[PrefetchKnowledge] Predicted queries/keywords: ${JSON.stringify(queries)}`);

            // 2. Execute searches to populate cache. This must be the registered
            // tool: the cache is shared, and agents get back whatever this writes.

            for (const query of queries) {
                try {
                    logger.info(`[PrefetchKnowledge] Prefetching query: "${query}"`);
                    // This will automatically populate the semantic cache!
                    await search_unified_knowledge.execute(
                        { query, filter_source: "all", limit: 5 },
                        { organizationId, userId, named: {}, positional: {} }
                    );
                } catch (e) {
                    logger.warn(`[PrefetchKnowledge] Failed to prefetch query "${query}": ${e instanceof Error ? e.message : String(e)}`);
                }
            }

            logger.info("[PrefetchKnowledge] Prefetch complete.");

        } catch (error) {
            logger.error(`[PrefetchKnowledge] Error during prefetch: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}
