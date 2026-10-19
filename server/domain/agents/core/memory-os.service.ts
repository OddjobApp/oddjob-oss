import { db } from "@server/database_service.js";
import { agentLongTermMemories } from "@shared/schema/index.js";
import { eq, and, desc, or, ilike, isNull } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { longTermMemoryService, MemoryQuery } from "./long-term-memory.service.js";

const logger = createLogger("MemoryOS");

export interface ShortTermMemoryEntry {
    id: string;
    sessionId: string;
    role: "user" | "agent" | "system" | "tool";
    content: string;
    timestamp: number;
    metadata?: Record<string, any>;
}

/**
 * Insight categories, and the long-term memory `type` each promotes into.
 *
 * `agent_long_term_memories.type` is one of preference/fact/entity/strategy,
 * and until this map existed the service could only ever emit `strategy` and
 * `fact` — which is why the table held 51 rows, every one of them `strategy`,
 * and personalization had nothing to draw on. Categories that describe how the
 * user wants to be worked with become preferences; named things become
 * entities.
 */
export const INSIGHT_CATEGORY_TO_MEMORY_TYPE = {
    decision: "strategy",
    constraint: "strategy",
    fact: "fact",
    feedback: "fact",
    preference: "preference",
    entity: "entity",
} as const;

export type InsightCategory = keyof typeof INSIGHT_CATEGORY_TO_MEMORY_TYPE;

/**
 * Importance at or above which a mid-term insight is promoted to long-term memory.
 *
 * Lowered from 8 to 7 on 2026-08-21. At 8 the extractor's scoring habits made
 * one category unreachable in practice rather than in principle: it reliably
 * scores `entity` insights at 7 ("oddjob-db is the container running dev
 * Postgres" is true and useful, but reads as less weighty than a constraint),
 * so entities were extracted and then always dropped. A live run produced four
 * insights, promoted three, and discarded the only entity among them.
 *
 * The trade is precision for coverage — 7 admits weaker items, and recall is
 * ranked rather than filtered, so a marginal memory costs a slot rather than a
 * wrong answer. Re-measure with `npm run evals:memory` if this moves again.
 */
export const PROMOTION_IMPORTANCE_THRESHOLD = 7;

export interface MidTermSessionInsight {
    id: string;
    sessionId: string;
    organizationId: number;
    userId?: string;
    topic: string;
    takeaway: string;
    importance: number; // 1 - 10
    category: InsightCategory;
    createdAt: number;
}

export interface ContextualRecallQuery {
    sessionId?: string;
    organizationId: number;
    userId?: string;
    queryText: string;
    limitShortTerm?: number;
    limitMidTerm?: number;
    limitLongTerm?: number;
}

export interface ContextualMemoryBundle {
    shortTerm: ShortTermMemoryEntry[];
    midTerm: MidTermSessionInsight[];
    longTerm: any[];
    synthesizedContextString: string;
}

export class MemoryOSService {
    // In-memory working buffer for short-term turns (backed by session ID)
    private static shortTermStore = new Map<string, ShortTermMemoryEntry[]>();
    private static midTermStore = new Map<string, MidTermSessionInsight[]>();
    private static MAX_SHORT_TERM_PER_SESSION = 20;

    /**
     * Ceiling on tracked sessions.
     *
     * These maps are process-lifetime statics and `clearSession` is only called
     * on explicit teardown, so without a ceiling every session the server ever
     * sees is retained until restart. The per-session FIFO caps turns, not
     * sessions. Eviction is oldest-first, which Map iteration order gives us.
     */
    private static MAX_TRACKED_SESSIONS = 500;

    private static evictOldestSessionsIfNeeded(): void {
        while (this.shortTermStore.size > this.MAX_TRACKED_SESSIONS) {
            const oldest = this.shortTermStore.keys().next().value;
            if (oldest === undefined) break;
            this.shortTermStore.delete(oldest);
            this.midTermStore.delete(oldest);
            logger.debug(`[MemoryOS] Evicted least-recent session from working memory: ${oldest}`);
        }
    }

    /**
     * Record a short-term observation or dialogue turn
     */
    static recordShortTerm(entry: Omit<ShortTermMemoryEntry, "id" | "timestamp">): ShortTermMemoryEntry {
        const fullEntry: ShortTermMemoryEntry = {
            ...entry,
            id: `stm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            timestamp: Date.now()
        };

        const list = this.shortTermStore.get(entry.sessionId) || [];
        list.push(fullEntry);

        // FIFO eviction if capacity exceeded
        if (list.length > this.MAX_SHORT_TERM_PER_SESSION) {
            const evicted = list.shift();
            logger.debug(`[MemoryOS] Short-term turn evicted for session ${entry.sessionId}: ${evicted?.id}`);
        }

        this.shortTermStore.set(entry.sessionId, list);
        this.evictOldestSessionsIfNeeded();
        return fullEntry;
    }

    /**
     * Record a mid-term session takeaway or key decision
     */
    static recordMidTerm(insight: Omit<MidTermSessionInsight, "id" | "createdAt">): MidTermSessionInsight {
        const fullInsight: MidTermSessionInsight = {
            ...insight,
            id: `mtm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            createdAt: Date.now()
        };

        const list = this.midTermStore.get(insight.sessionId) || [];
        list.push(fullInsight);
        this.midTermStore.set(insight.sessionId, list);

        // High-importance insights promote to long-term memory automatically.
        if (insight.importance >= PROMOTION_IMPORTANCE_THRESHOLD) {
            void this.promoteToLongTerm(fullInsight);
        }

        return fullInsight;
    }

    /**
     * Consolidate dialogue chain into mid-term takeaways and optionally promote to long-term
     */
    static async consolidateSession(
        sessionId: string,
        organizationId: number,
        userId?: string,
        extractedInsights?: Array<{ topic: string; takeaway: string; category: MidTermSessionInsight["category"]; importance: number }>
    ): Promise<MidTermSessionInsight[]> {
        const turns = this.shortTermStore.get(sessionId) || [];
        const insights: MidTermSessionInsight[] = [];

        // Caller-supplied insights win; otherwise read them out of the dialogue.
        //
        // What used to be here instead was a digest reading "Session conversation
        // with N turns spanning <ISO date>" — durable, promotable, and worth
        // nothing to a later session. Producing no insight is a better outcome
        // than producing that one, so the extractor is allowed to return none.
        const items = extractedInsights && extractedInsights.length > 0
            ? extractedInsights
            : turns.length > 0
                ? await this.extractInsights(turns)
                : [];

        for (const item of items) {
            const insight = this.recordMidTerm({
                sessionId,
                organizationId,
                userId,
                topic: item.topic,
                takeaway: item.takeaway,
                importance: item.importance,
                category: item.category
            });
            insights.push(insight);
        }

        logger.info(`[MemoryOS] Consolidated session ${sessionId}: generated ${insights.length} mid-term takeaways.`);
        return insights;
    }

    /**
     * Read durable insights out of a dialogue chain.
     *
     * This is the write path the tier hierarchy was missing. Tiering an empty
     * corpus changes nothing, and before this the only thing that ever reached
     * long-term memory from a conversation was a turn-count digest.
     *
     * The prompt is deliberately biased toward silence: an empty array is a
     * valid, common, and correct answer. A memory system that invents a
     * takeaway per session poisons every later recall with filler that
     * out-ranks the real thing.
     */
    static async extractInsights(
        turns: ShortTermMemoryEntry[]
    ): Promise<Array<{ topic: string; takeaway: string; category: InsightCategory; importance: number }>> {
        if (turns.length === 0) return [];

        const transcript = turns
            .map(t => `${t.role.toUpperCase()}: ${t.content}`)
            .join("\n")
            .slice(-12000);

        const prompt = `Read this conversation and extract only the things worth remembering in a LATER, unrelated session.

TRANSCRIPT
${transcript}

Extract an item ONLY if it is durable — true beyond this conversation. Examples of what qualifies:
- preference: how this user wants work done ("prefers Gemini over OpenAI", "wants terse replies")
- fact: a stable truth about their systems or org ("prod Postgres is on port 5433")
- entity: a named system, service, person, or repo and what it is
- constraint: a rule that must hold ("never run destructive seeds against dev")
- decision: a choice made that later work should respect
- feedback: a correction the user gave that should change future behaviour

Do NOT extract: what happened in this session, tool call results, task status,
summaries of the conversation, anything already obvious from the codebase, or
anything phrased as a one-off request.

Return raw JSON: {"insights": [{"topic": "<= 8 words", "takeaway": "one sentence, self-contained", "category": "preference|fact|entity|constraint|decision|feedback", "importance": 1-10}]}

Most conversations contain nothing durable. If so return {"insights": []}. Do not invent items to fill the list.`;

        try {
            const { systemAiService } = await import("@domain/ai/core/system-ai.service.js");
            const result = await systemAiService.generateJson(prompt, "concierge", {
                systemPrompt: "You extract durable memories from conversations. Return ONLY raw JSON. Prefer an empty list over a weak item.",
                temperature: 0.1,
            });

            const raw = Array.isArray(result?.insights) ? result.insights : [];

            const extracted = raw
                .filter((i: any) => i && typeof i.topic === "string" && typeof i.takeaway === "string" && i.topic.trim() && i.takeaway.trim())
                .map((i: any) => ({
                    topic: String(i.topic).trim().slice(0, 120),
                    takeaway: String(i.takeaway).trim().slice(0, 1000),
                    category: (i.category in INSIGHT_CATEGORY_TO_MEMORY_TYPE ? i.category : "fact") as InsightCategory,
                    // Clamp to the 1-10 integer scale the DB column actually stores.
                    // A model answering 0.8 must not land as importance 0.
                    importance: Math.max(1, Math.min(10, Math.round(Number(i.importance) || 5))),
                }));

            logger.info(`[MemoryOS] Extracted ${extracted.length} durable insight(s) from ${turns.length} turns.`);
            return extracted;
        } catch (err: any) {
            logger.warn(`[MemoryOS] Insight extraction failed: ${err?.message}`);
            return [];
        }
    }

    /**
     * Promote a mid-term takeaway into persistent Long-Term Memory
     */
    static async promoteToLongTerm(insight: MidTermSessionInsight): Promise<void> {
        try {
            await longTermMemoryService.remember({
                organizationId: insight.organizationId,
                userId: insight.userId,
                type: INSIGHT_CATEGORY_TO_MEMORY_TYPE[insight.category] ?? "fact",
                key: `memoryos:${insight.topic.toLowerCase().replace(/\s+/g, "_")}`,
                content: `${insight.topic}: ${insight.takeaway}`,
                importance: insight.importance,
                source: "auto_extracted",
                metadata: {
                    sourceSessionId: insight.sessionId,
                    promotedFrom: "mid_term",
                    originalCategory: insight.category
                }
            });
            logger.info(`[MemoryOS] Promoted insight to Long-Term Memory: "${insight.topic}"`);
        } catch (err: any) {
            logger.error(`[MemoryOS] Failed to promote insight to Long-Term Memory: ${err?.message}`);
        }
    }

    /**
     * Context-Aware Unified Retrieval across Short, Mid, and Long-Term Tiers
     */
    static async recallUnifiedContext(query: ContextualRecallQuery): Promise<ContextualMemoryBundle> {
        const shortTermLimit = query.limitShortTerm ?? 6;
        const midTermLimit = query.limitMidTerm ?? 4;
        const longTermLimit = query.limitLongTerm ?? 5;

        // 1. Short-Term Working Memory
        //
        // The zero guards are load-bearing: `arr.slice(-0)` is `arr.slice(0)`,
        // which returns the WHOLE array. A caller asking for zero turns —
        // because the transcript is already in its prompt — would otherwise get
        // every turn back and double it.
        let shortTerm: ShortTermMemoryEntry[] = [];
        if (shortTermLimit > 0 && query.sessionId && this.shortTermStore.has(query.sessionId)) {
            const allTurns = this.shortTermStore.get(query.sessionId)!;
            shortTerm = allTurns.slice(-shortTermLimit);
        }

        // 2. Mid-Term Session Insights
        let midTerm: MidTermSessionInsight[] = [];
        if (midTermLimit > 0 && query.sessionId && this.midTermStore.has(query.sessionId)) {
            const allInsights = this.midTermStore.get(query.sessionId)!;
            midTerm = allInsights.slice(-midTermLimit);
        }

        // 3. Long-Term Persistent Memories (vector-ranked; see longTermMemoryService.recall)
        let longTerm: any[] = [];
        if (longTermLimit > 0) try {
            longTerm = await longTermMemoryService.recall({
                organizationId: query.organizationId,
                userId: query.userId,
                search: query.queryText,
                limit: longTermLimit
            });
        } catch (err: any) {
            logger.warn(`[MemoryOS] Long-term recall error: ${err?.message}`);
        }

        // Synthesize prompt-injectable context block
        const contextSections: string[] = [];

        if (longTerm.length > 0) {
            contextSections.push(
                `### Established Long-Term Knowledge:\n` +
                longTerm.map(lt => `- [${lt.type?.toUpperCase() || "FACT"}] ${lt.content}`).join("\n")
            );
        }

        if (midTerm.length > 0) {
            contextSections.push(
                `### Session Key Decisions & Facts:\n` +
                midTerm.map(mt => `- [${mt.category.toUpperCase()}] ${mt.topic}: ${mt.takeaway}`).join("\n")
            );
        }

        if (shortTerm.length > 0) {
            contextSections.push(
                `### Recent Working Context (${shortTerm.length} turns):\n` +
                shortTerm.map(st => `${st.role.toUpperCase()}: ${st.content}`).join("\n")
            );
        }

        return {
            shortTerm,
            midTerm,
            longTerm,
            synthesizedContextString: contextSections.join("\n\n")
        };
    }

    /**
     * Clear ephemeral session state (for test teardowns and session terminations)
     */
    static clearSession(sessionId: string): void {
        this.shortTermStore.delete(sessionId);
        this.midTermStore.delete(sessionId);
    }
}

export const memoryOSService = MemoryOSService;
