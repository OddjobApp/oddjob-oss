
import { db } from "@server/database_service.js";
import { missions } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { aiConfigResolver } from "@domain/ai/core/ai-config-resolver.js";
// import { generateChatCompletion } from "@server/ai/llm.js";

const logger = createLogger("BlackboardSummarizer");

export class BlackboardSummarizer {
    private static THRESHOLD_BYTES = 30 * 1024; // 30KB
    private static KEEP_RECENT_MESSAGES = 10;

    /**
     * Checks if a blackboard needs summarization and triggers it if so.
     */
    static async checkAndSummarize(missionId: number, blackboard: any, orgId?: number): Promise<boolean> {
        const size = JSON.stringify(blackboard).length;
        if (size < this.THRESHOLD_BYTES) return false;

        logger.info(`[BlackboardSummarizer] Mission ${missionId} blackboard size (${Math.round(size / 1024)}KB) exceeds threshold. Summarizing...`);
        
        try {
            const summarized = await this.summarize(blackboard, orgId);
            await db.update(missions)
                .set({ blackboard: summarized, updatedAt: new Date() })
                .where(eq(missions.id, missionId));
            
            logger.info(`[BlackboardSummarizer] Mission ${missionId} summarized successfully.`);
            return true;
        } catch (err) {
            logger.error(`[BlackboardSummarizer] Failed to summarize mission ${missionId}:`, err);
            return false;
        }
    }

    private static async summarize(blackboard: any, orgId?: number): Promise<any> {
        const messages = blackboard.messages || [];
        if (messages.length <= this.KEEP_RECENT_MESSAGES + 5) {
            // Not enough messages to meaningfully summarize without losing too much context
            return blackboard;
        }

        const messagesToSummarize = messages.slice(0, -this.KEEP_RECENT_MESSAGES);
        const recentMessages = messages.slice(-this.KEEP_RECENT_MESSAGES);

        const historyText = messagesToSummarize.map((m: any) => `[${m.role}] ${m.sender || m.role}: ${m.content}`).join("\n");

        const prompt = `
            You are a "Context Condenser" for an autonomous mission system.
            The following is a history of messages and actions from a mission.
            Your goal is to produce a concise "Mission Digest" that captures:
            1. The original intent and current progress.
            2. Key decisions made.
            3. Important artifacts or findings.
            4. Any blockers identified.

            Be extremely concise but don't lose names of files, tools, or specific values.
            Use a structured format (Markdown).

            History to condense:
            ${historyText}
        `;

        const config = await aiConfigResolver.resolveOrgConfig('concierge', orgId ?? null);

        // const summary = await generateChatCompletion({
        //     model: config.model,
        //     messages: [{ role: "user", content: prompt }],
        //     credentialId: config.credentialId
        // });
        const summary = "[Summary Placeholder - LLM service not wired]";

        const digestMessage = {
            id: `digest-${Date.now()}`,
            role: "system",
            sender: "Context Summarizer",
            content: `### 📂 MISSION CONTEXT DIGEST (Compressed)\n\n${summary}\n\n*Historical detail removed to maintain token efficiency.*`,
            timestamp: new Date().toISOString()
        };

        return {
            ...blackboard,
            messages: [digestMessage, ...recentMessages],
            lastSummaryTimestamp: new Date().toISOString()
        };
    }
}


