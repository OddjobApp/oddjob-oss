
import { AIClient } from "@domain/ai/core/ai-client.service.js";
import { AIApiCallConfig } from "@shared/schema/index.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("JanitorService");

export class JanitorService {
    private client: AIClient;
    private apiKey: string;

    constructor(client: AIClient, apiKey: string) {
        this.client = client;
        this.apiKey = apiKey;
    }

    /**
     * Distills episodic memory into a "State Summary" and commits it to the Knowledge Store as lessons learned.
     * Triggered when token usage > 75% or loop limit is reached.
     */
    async distill(history: any[], currentGoal: string, orgId?: number, userId?: string, missionId?: number): Promise<string> {
        logger.info("Distilling episodic memory into state summary...");

        const prompt = `
You are a "Contextual Janitor". Your job is to summarize a long chain of thought and tool execution history into a concise "Current State Summary".
The user's original goal was: "${currentGoal}"

HISTORY TO DISTILL:
${JSON.stringify(history)}

INSTRUCTIONS:
1. Identify what has been accomplished so far.
2. Identify what is currently pending or failed.
3. Extract critical findings, IDs, or data points discovered.
4. Keep the summary under 1000 tokens.
5. Return ONLY the summarized text.
`;

        const config: AIApiCallConfig = {
            model: "gemini-1.5-flash", // Use a balanced model for summarization
            systemPrompt: "You are a concise state summarizer.",
            userPrompt: prompt,
            temperature: 0.1,
            useCache: false,
            saveOutputToFile: false,
            enableQueryExpansion: false
        };

        const res = await this.client.execute(config, undefined, this.apiKey);
        if (!res.success) {
            logger.error("Distillation failed", res.error);
            return "Error during distillation. Context may be fragmented.";
        }

        const summary = res.output || "No summary generated.";

        // --- Episodic "Mission Wikis" (Lessons Learned) ---
        if (orgId && userId && summary.length > 50) {
            try {
                const { ingestFileToKnowledgeStore, getOrCreateIntegrationTopic } = await import("@domain/knowledge/core/knowledge-store.js");

                // Get or create a "Lessons Learned" topic
                const topic = await getOrCreateIntegrationTopic("Lessons Learned", orgId);
                const topicId = (topic as any).id;

                await ingestFileToKnowledgeStore({
                    content: summary,
                    title: `Mission Lesson: ${currentGoal.substring(0, 50)}...`,
                    sourceType: "text",
                    topicId,
                    organizationId: orgId,
                    createdBy: userId,
                    metadata: {
                        type: "distilled_memory",
                        originalGoal: currentGoal,
                        missionId,
                        timestamp: new Date().toISOString()
                    }
                });
                logger.info(`Persisted distilled memory to Lessons Learned for org ${orgId}`);
            } catch (err: any) {
                logger.warn("Failed to persist distilled memory to knowledge store", { error: err.message });
            }
        }

        return summary;
    }
}
