
import { db } from "@server/database_service.js";
import { agentLongTermMemories } from "@shared/schema/index.js";
import { eq, and, desc, or, ilike, isNull, inArray } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { embeddingService } from "@domain/knowledge/core/rag/embedding-service.js";
import { searchQdrant, upsertQdrantPoints, deleteQdrantPoints } from "@server/integrations/qdrant-client.js";

const logger = createLogger("LongTermMemory");

/**
 * Vector index for cross-mission memories.
 *
 * The point id IS the `agent_long_term_memories` row id, so Postgres stays the
 * single source of truth for content and Qdrant only ever answers "which rows".
 * Hits are hydrated from Postgres after the search, which also means a stale
 * point cannot resurrect deleted content.
 */
export const LTM_COLLECTION = "agent_long_term_memory";

export interface MemoryQuery {
    organizationId: number;
    userId?: string;
    type?: string;
    search?: string;
    limit?: number;
}

/**
 * Embed text for the memory index, or return null.
 *
 * Null covers BOTH a null result and a zero-length vector. Under a Gemini
 * spending cap the provider answers 200 with an empty vector instead of
 * erroring — an empty vector indexes nothing and matches nothing, so treating
 * it as success is how a memory system goes quietly dark. Callers read null as
 * "vector search is unavailable right now" and fall back to the substring scan.
 */
async function embedForMemory(text: string): Promise<number[] | null> {
    try {
        const vector = await embeddingService.generateEmbedding(text);
        if (!Array.isArray(vector) || vector.length === 0) return null;
        return vector;
    } catch (err: any) {
        logger.warn(`Embedding unavailable for long-term memory: ${err?.message}`);
        return null;
    }
}

export const longTermMemoryService = {
    /**
     * Store a cross-mission memory.
     *
     * Returns the row id, or undefined if the write failed. The row is written
     * first and indexed second: an indexing failure must never lose the memory,
     * and a memory that is present but unindexed is still reachable through the
     * substring fallback in `recall`.
     */
    async remember(data: {
        organizationId: number;
        userId?: string;
        type: 'preference' | 'fact' | 'entity' | 'strategy';
        key?: string;
        content: string;
        importance?: number;
        source?: string;
        confidence?: number;
        metadata?: Record<string, any>;
    }): Promise<number | undefined> {
        let memoryId: number | undefined;

        try {
            // If a key is provided, check if we should update instead of insert
            if (data.key) {
                const [existing] = await db.select()
                    .from(agentLongTermMemories)
                    .where(and(
                        eq(agentLongTermMemories.organizationId, data.organizationId),
                        eq(agentLongTermMemories.key, data.key),
                        data.userId ? eq(agentLongTermMemories.userId, data.userId) : undefined
                    ))
                    .limit(1);

                if (existing) {
                    await db.update(agentLongTermMemories)
                        .set({
                            content: data.content,
                            importance: data.importance ?? existing.importance,
                            source: data.source ?? existing.source,
                            confidence: data.confidence ?? existing.confidence,
                            metadata: { ...(existing.metadata as any || {}), ...(data.metadata || {}) },
                            updatedAt: new Date()
                        })
                        .where(eq(agentLongTermMemories.id, existing.id));

                    logger.debug(`Updated long-term memory for key: ${data.key}`);
                    memoryId = existing.id;
                }
            }

            if (memoryId === undefined) {
                const [inserted] = await db.insert(agentLongTermMemories).values({
                    organizationId: data.organizationId,
                    userId: data.userId,
                    type: data.type,
                    key: data.key,
                    content: data.content,
                    importance: data.importance ?? 5,
                    source: data.source ?? "manual",
                    confidence: data.confidence ?? 100,
                    metadata: data.metadata ?? {},
                }).returning({ id: agentLongTermMemories.id });

                memoryId = inserted?.id;
                logger.info(`Agent remembered new ${data.type}: ${data.key || data.content.substring(0, 30)}`);
            }
        } catch (err: any) {
            logger.error(`Failed to remember: ${err.message}`);
            return undefined;
        }

        if (memoryId !== undefined) {
            await this.index(memoryId, {
                organizationId: data.organizationId,
                userId: data.userId,
                type: data.type,
                content: data.content,
            });
        }

        return memoryId;
    },

    /**
     * Add or refresh one memory's vector point.
     *
     * Failure is logged at error level and reported in the return value rather
     * than thrown: the caller has already committed the row. Note that nothing
     * here stamps a column asserting the row is indexed — the only trustworthy
     * answer to "is this indexed?" comes from asking Qdrant, which is what the
     * backfill script does.
     */
    async index(
        memoryId: number,
        row: { organizationId: number; userId?: string | null; type: string; content: string },
    ): Promise<boolean> {
        const vector = await embedForMemory(row.content);
        if (!vector) {
            logger.error(
                `Long-term memory ${memoryId} was stored but NOT indexed: the embedding provider ` +
                `returned nothing. It stays reachable only by substring match until a backfill runs.`,
            );
            return false;
        }

        try {
            await upsertQdrantPoints(
                [{
                    id: memoryId,
                    vector,
                    payload: {
                        memoryId,
                        organizationId: row.organizationId,
                        userId: row.userId ?? null,
                        type: row.type,
                    },
                }],
                LTM_COLLECTION,
                vector.length,
            );
            return true;
        } catch (err: any) {
            logger.error(`Failed to index long-term memory ${memoryId}: ${err?.message}`);
            return false;
        }
    },

    /** Drop a memory's vector point. Best-effort; a stale point cannot leak content because hits are hydrated from Postgres. */
    async unindex(memoryId: number): Promise<void> {
        try {
            await deleteQdrantPoints([memoryId], LTM_COLLECTION);
        } catch (err: any) {
            logger.warn(`Failed to unindex long-term memory ${memoryId}: ${err?.message}`);
        }
    },

    /**
     * Recall relevant long-term memories.
     *
     * With a search term this runs a vector search and hydrates the hits from
     * Postgres, preserving Qdrant's ranking. It falls back to the original
     * substring scan whenever the vector path cannot answer — no embedding, a
     * Qdrant error, or zero hits (the normal state for rows written before the
     * index existed). Every fallback is logged, so a degraded search is visible
     * rather than silent.
     */
    async recall(query: MemoryQuery) {
        if (query.search) {
            const vectorResults = await this._recallByVector(query);
            if (vectorResults !== null) return vectorResults;
        }

        return this._recallBySql(query);
    },

    /** Vector path. Returns null when it cannot answer, so `recall` can fall back. */
    async _recallByVector(query: MemoryQuery) {
        const vector = await embedForMemory(query.search!);
        if (!vector) {
            logger.warn(`Vector recall unavailable (no embedding) — falling back to substring match for org ${query.organizationId}`);
            return null;
        }

        try {
            const must: any[] = [
                { key: "organizationId", match: { value: query.organizationId } },
            ];

            if (query.type) {
                must.push({ key: "type", match: { value: query.type } });
            }

            if (query.userId) {
                // Mirrors the SQL path: the user's own memories plus org-wide ones.
                must.push({
                    should: [
                        { key: "userId", match: { value: query.userId } },
                        { is_empty: { key: "userId" } },
                    ],
                });
            }

            const hits = await searchQdrant(vector, {
                collection: LTM_COLLECTION,
                limit: query.limit || 20,
                filter: { must },
            });

            if (hits.length === 0) return null;

            const ids = hits.map((h: any) => Number(h.id)).filter((id) => Number.isFinite(id));
            if (ids.length === 0) return null;

            // Hydrate from Postgres, re-asserting the org filter. The payload is a
            // copy, and a copy can drift; the row is the authority on who owns it.
            const rows = await db.select()
                .from(agentLongTermMemories)
                .where(and(
                    inArray(agentLongTermMemories.id, ids),
                    eq(agentLongTermMemories.organizationId, query.organizationId),
                ));

            if (rows.length === 0) return null;

            const byId = new Map(rows.map((r) => [r.id, r]));
            return ids
                .map((id) => byId.get(id))
                .filter((r): r is typeof rows[number] => r !== undefined);
        } catch (err: any) {
            logger.warn(`Vector recall failed (${err?.message}) — falling back to substring match`);
            return null;
        }
    },

    /** Original substring/importance scan. Also the no-search listing path. */
    async _recallBySql(query: MemoryQuery) {
        try {
            const conditions = [
                eq(agentLongTermMemories.organizationId, query.organizationId)
            ];

            if (query.userId) {
                conditions.push(or(
                    eq(agentLongTermMemories.userId, query.userId),
                    isNull(agentLongTermMemories.userId) // Include organization-wide facts
                )!);
            }

            if (query.type) {
                conditions.push(eq(agentLongTermMemories.type, query.type));
            }

            if (query.search) {
                conditions.push(ilike(agentLongTermMemories.content, `%${query.search}%`));
            }

            const results = await db.select()
                .from(agentLongTermMemories)
                .where(and(...conditions))
                .orderBy(desc(agentLongTermMemories.importance), desc(agentLongTermMemories.updatedAt))
                .limit(query.limit || 20);

            return results;
        } catch (err: any) {
            logger.error(`Failed to recall: ${err.message}`);
            return [];
        }
    },

    /**
     * Get a formatted string of memories for LLM context
     */
    async getContextString(organizationId: number, userId?: string, search?: string) {
        const memories = await this.recall({ organizationId, userId, search, limit: 10 });
        if (memories.length === 0) return "";

        return `
### CROSS-MISSION LONG-TERM MEMORY (System Knowledge)
These are facts, preferences, and strategies remembered from previous interactions. Use them to maintain consistency and user personalization:
${memories.map(m => `- [${m.type.toUpperCase()}] ${m.key ? m.key + ': ' : ''}${m.content}`).join('\n')}
`;
    }
};
