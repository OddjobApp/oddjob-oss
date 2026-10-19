/**
 * Crew Memory Service
 *
 * Agents are workers: they accumulate experience and build their own knowledge
 * graphs as they run missions. This service surfaces that accumulated experience
 * inside a crew discussion, so an agent argues from what it has actually learned
 * rather than from the prompt alone.
 *
 * Why not just call AgentMemoryAcrossMissionsService.recallPriorKnowledge():
 * that method keys on a repositoryId (it was built for codegen missions, where
 * the unit of context is a repo) and filters entries to that one repository. A
 * crew discussion has no repository — the unit of context is the *topic under
 * discussion*. So this recalls across every repository the agent has worked in,
 * ranked against the discussion topic.
 *
 * Scoring mirrors the existing service (semantic similarity + stored confidence
 * + recency decay) so recall behaves consistently across the platform. The
 * code-specific exact-match boost on file paths and module names is dropped —
 * it has no meaning in conversation.
 *
 * Degrades quietly: an agent with no history, an unavailable Qdrant, or a
 * failed embedding all yield an empty context string rather than an error. A
 * crew member without recall should still be able to speak.
 */

import { and, eq } from "drizzle-orm";
import { sql, inArray } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { agentKnowledgeGraphEntries, jobs } from "@shared/schema/index.js";
import { getEmbeddings } from "@domain/knowledge/core/rag-langchain.service.js";
import { searchQdrant } from "@server/integrations/qdrant-client.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("CrewMemoryService");

/** Must match AgentMemoryAcrossMissionsService's collection. */
const COLLECTION_NAME = "agent_knowledge_graph";

/** Prefix identifying knowledge that came out of a crew discussion. */
export const DISCUSSION_SCOPE_PREFIX = "crew-discussion";

/**
 * The knowledge-graph `repository_id` a discussion files under.
 *
 * The KG table has no project column — it was built for codegen missions, where
 * the scope key is a repository — so the Project Space is encoded into that key
 * instead. This is what keeps a conclusion reached inside a private project from
 * surfacing in another project's discussion.
 */
export function discussionScope(projectId: number | null): string {
    return projectId === null
        ? `${DISCUSSION_SCOPE_PREFIX}:unscoped`
        : `${DISCUSSION_SCOPE_PREFIX}:p${projectId}`;
}

export interface CrewRecallResult {
    formattedMemoryContext: string;
    entryCount: number;
}

export class CrewMemoryService {
    /**
     * Agent cards carry no job id — AgentSyncService matches them to jobs by
     * name — but knowledge graph entries are keyed by job id as a string. This
     * resolves card name to the agent id the knowledge graph uses.
     *
     * Cached per process: the card/job mapping does not change within a
     * discussion, and this would otherwise run on every agent turn.
     */
    private agentIdCache = new Map<string, string | null>();

    async resolveAgentId(orgId: number, cardName: string): Promise<string | null> {
        const cacheKey = `${orgId}:${cardName.toLowerCase()}`;
        const cached = this.agentIdCache.get(cacheKey);
        if (cached !== undefined) return cached;

        try {
            const [job] = await db
                .select({ id: jobs.id })
                .from(jobs)
                .where(and(eq(jobs.organizationId, orgId), eq(jobs.name, cardName)))
                .limit(1);

            const resolved = job ? String(job.id) : null;
            this.agentIdCache.set(cacheKey, resolved);
            return resolved;
        } catch (err) {
            logger.warn(
                `Failed to resolve agent id for "${cardName}" in org ${orgId}: ${
                    err instanceof Error ? err.message : String(err)
                }`,
            );
            return null;
        }
    }

    /**
     * Recalls an agent's prior patterns and lessons relevant to the topic under
     * discussion, across every repository it has worked in.
     *
     * @param topic      What the crew is discussing — the text recall is ranked against.
     * @param maxEntries Cap on entries returned.
     * @param tokenBudget Approximate token ceiling for the formatted block.
     */
    async recallForDiscussion(
        orgId: number,
        cardName: string,
        topic: string,
        maxEntries = 4,
        tokenBudget = 700,
        projectId: number | null = null,
    ): Promise<CrewRecallResult> {
        const empty: CrewRecallResult = { formattedMemoryContext: "", entryCount: 0 };

        const agentId = await this.resolveAgentId(orgId, cardName);
        if (!agentId) return empty;

        let entries;
        try {
            entries = await db
                .select()
                .from(agentKnowledgeGraphEntries)
                .where(
                    and(
                        eq(agentKnowledgeGraphEntries.organizationId, orgId),
                        eq(agentKnowledgeGraphEntries.agentId, agentId),
                    ),
                );
        } catch (err) {
            logger.warn(
                `Knowledge graph lookup failed for agent ${agentId}: ${
                    err instanceof Error ? err.message : String(err)
                }`,
            );
            return empty;
        }

        if (entries.length === 0) return empty;

        // Project Space gate. Discussion-derived knowledge is visible only to
        // discussions in the same Project Space — otherwise a conclusion from a
        // private project would leak into another project's room through recall.
        // Mission-derived entries (repository-scoped, predating Project Spaces)
        // keep their existing org-wide visibility; narrowing those is a separate
        // decision from the leak this closes.
        const ownScope = discussionScope(projectId);
        entries = entries.filter((e) => {
            const repo = String(e.repositoryId ?? "");
            if (!repo.startsWith(`${DISCUSSION_SCOPE_PREFIX}:`)) return true;
            return repo === ownScope;
        });

        if (entries.length === 0) return empty;

        // Semantic similarity against the discussion topic. Optional — without
        // it, entries still rank by confidence and recency.
        const semanticScores = new Map<number, number>();
        try {
            const vector = await getEmbeddings().embedQuery(topic);
            if (vector.length > 0) {
                const hits = await searchQdrant(vector, {
                    limit: 100,
                    collection: COLLECTION_NAME,
                    filter: {
                        must: [
                            { key: "organizationId", match: { value: orgId } },
                            { key: "agentId", match: { value: agentId } },
                        ],
                    },
                });
                for (const hit of hits) semanticScores.set(Number(hit.id), hit.score);
            }
        } catch (err) {
            logger.debug(
                `Semantic recall unavailable for agent ${agentId}, falling back to confidence+recency: ${
                    err instanceof Error ? err.message : String(err)
                }`,
            );
        }

        const now = Date.now();
        const scored = entries
            .map((entry) => {
                const similarity = semanticScores.get(entry.id) ?? 0;
                const ageDays = (now - new Date(entry.updatedAt).getTime()) / (1000 * 60 * 60 * 24);
                const recency = Math.exp(-ageDays / 30);
                const score = 0.5 * similarity + 0.3 * ((entry.confidence ?? 0) / 100) + 0.2 * recency;
                return { entry, score };
            })
            .sort((a, b) => b.score - a.score)
            .slice(0, maxEntries);

        // The most recent critique is admitted OUTSIDE the ranked slots.
        //
        // Ranking it alongside everything else was the flaw: a critique is
        // feedback on how the agent just performed, and it competes on semantic
        // similarity to the NEW topic — which it will usually lose, because it
        // is about conduct rather than subject matter. So the one entry written
        // precisely to change the next turn was the one least likely to be read
        // during it. Pinning it costs one slot and is the whole point of having
        // written it down.
        const latestCritique = entries
            .filter((e) => e.type === "discussion_critique")
            .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
        if (latestCritique && !scored.some((s) => s.entry.id === latestCritique.id)) {
            scored.unshift({ entry: latestCritique, score: Number.POSITIVE_INFINITY });
        }

        if (scored.length === 0) return empty;

        // Record the access, matching the existing service's bookkeeping.
        try {
            await db
                .update(agentKnowledgeGraphEntries)
                .set({ accessCount: sql`access_count + 1`, lastAccessed: new Date() })
                .where(inArray(agentKnowledgeGraphEntries.id, scored.map((s) => s.entry.id)));
        } catch {
            // Statistics only — never fail a turn over it.
        }

        const charBudget = tokenBudget * 4;
        let context = "";
        let used = 0;

        for (const { entry } of scored) {
            const ageDays = Math.floor((now - new Date(entry.updatedAt).getTime()) / (1000 * 60 * 60 * 24));
            const label = String(entry.type).replace(/_/g, " ").toUpperCase();
            const line = `- [${label}] (confidence ${entry.confidence ?? 0}%, ${ageDays}d ago) ${entry.content}\n`;
            if (used + line.length > charBudget) break;
            context += line;
            used += line.length;
        }

        if (!context) return empty;

        return { formattedMemoryContext: context.trimEnd(), entryCount: scored.length };
    }
}

export const crewMemoryService = new CrewMemoryService();
