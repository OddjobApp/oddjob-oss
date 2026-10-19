import { db } from "@server/database_service.js";
import { agentChatMessages } from "@shared/schema/index.js";
import { and, eq, gt, asc } from "drizzle-orm";
import {
    formatTrajectory,
    normalizeAlternation,
    type TrajectoryFormat,
    type TrajectoryTurn,
} from "../../mission/core/cycle-trajectory.service.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("ConversationTrajectory");

const DEFAULT_SYSTEM = "You are the Oddjob assistant.";

/**
 * Exports conversational-assistant trajectories (from agentChatMessages) as
 * fine-tuning/eval JSONL in OpenAI / Anthropic / Gemini formats — the assistant
 * counterpart to the cycle trajectory export. Reuses the shared formatter so both
 * paths stay consistent. (Hermes #4 — trajectory capture for evals/training.)
 */
export const conversationTrajectoryService = {
    async exportAsJsonl(
        organizationId: number,
        format: TrajectoryFormat,
        opts: { userId?: string; sinceDays?: number; limit?: number; minTurns?: number } = {},
    ): Promise<{ jsonl: string; trajectories: number; turns: number }> {
        const conds: any[] = [eq(agentChatMessages.organizationId, organizationId)];
        if (opts.userId) conds.push(eq(agentChatMessages.userId, opts.userId));
        if (opts.sinceDays) {
            conds.push(gt(agentChatMessages.createdAt, new Date(Date.now() - opts.sinceDays * 86_400_000)));
        }

        const rows = await db
            .select({
                sessionId: agentChatMessages.sessionId,
                userId: agentChatMessages.userId,
                role: agentChatMessages.role,
                content: agentChatMessages.content,
            })
            .from(agentChatMessages)
            .where(and(...conds))
            .orderBy(asc(agentChatMessages.createdAt))
            .limit(opts.limit ?? 5000);

        // Group into conversations by session (fallback: per-user bucket).
        const groups = new Map<string, TrajectoryTurn[]>();
        for (const r of rows) {
            const key = r.sessionId || `user:${r.userId}`;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key)!.push({ role: r.role === "agent" ? "assistant" : "user", content: r.content });
        }

        const minTurns = opts.minTurns ?? 2;
        const lines: string[] = [];
        let turns = 0;
        for (const conv of groups.values()) {
            const norm = normalizeAlternation(conv);
            if (norm.length < minTurns) continue;
            lines.push(JSON.stringify(formatTrajectory(format, DEFAULT_SYSTEM, norm)));
            turns += norm.length;
        }

        logger.info(`[ConversationTrajectory] org=${organizationId} trajectories=${lines.length} turns=${turns} format=${format}`);
        return { jsonl: lines.length ? lines.join("\n") + "\n" : "", trajectories: lines.length, turns };
    },
};
