import { db } from "@server/database_service.js";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { agentChatMessages, agentToolHints, pipelines, jobs } from "@shared/schema/index.js";
import { embeddingService } from "./embedding-service.js";
import { formatToolHint } from "@server/prompts/agent-prompts.js";
import { sidecarSyncService } from "../sidecar-sync-service.js";

export const ragService = {
    /**
     * Keyword extraction for fallback
     */
    getKeywords(text: string) {
        return new Set(text.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(w => w.length > 3 && !['what', 'when', 'where', 'how', 'that', 'this', 'with', 'from'].includes(w)));
    },

    /**
     * Compute cosine similarity
     */
    cosineSimilarity(a: number[], b: number[]): number {
        let dotProduct = 0, normA = 0, normB = 0;
        for (let i = 0; i < a.length; i++) {
            dotProduct += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }
        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    },

    /**
     * Fetch relevant examples and tool hints for a query
     */
    /**
     * Fetch relevant examples and tool hints for a query
     */
    async fetchRelevantExamples(query: string, jobId: number | null, organizationId: number, similarityThreshold: number = 0.7, appDeploymentId?: number): Promise<{ context: string; usedExampleIds: number[]; retrospectives: any[] }> {
        const TOOL_HINT_TEMPLATE_HEADER = "### TOOL USAGE HINTS\nBased on your query, here are some specific instructions for using our specialized tools:\n";

        const queryKeywords = this.getKeywords(query);
        const keywordArray = Array.from(queryKeywords);

        // --- TOOL HINTS RETRIEVAL (DB-level filtering) ---
        let toolHintContext = "";
        try {
            let hints: any[] = [];
            if (keywordArray.length > 0 && jobId) {
                const likeConditions = keywordArray.slice(0, 5).map(kw =>
                    sql`LOWER(${agentToolHints.promptPattern}) LIKE ${'%' + kw + '%'}`
                );
                const orCondition = sql.join(likeConditions, sql` OR `);

                hints = await db.select()
                    .from(agentToolHints)
                    .where(and(
                        eq(agentToolHints.jobId, jobId),
                        orCondition
                    ))
                    .limit(5);
            }

            if (Array.isArray(hints) && hints.length > 0) {
                const pipelineIds = hints.map(h => h.pipelineId).filter(Boolean) as number[];

                let pipelineMap: Record<number, string> = {};
                if (pipelineIds.length > 0) {
                    const pipelineData = await db.select({ id: pipelines.id, name: pipelines.name })
                        .from(pipelines)
                        .where(inArray(pipelines.id, pipelineIds));
                    pipelineMap = Object.fromEntries((pipelineData || []).map(p => [p.id, p.name]));
                }

                toolHintContext = TOOL_HINT_TEMPLATE_HEADER;
                toolHintContext += hints.slice(0, 2).map(h => {
                    const pipeName = h.pipelineId ? pipelineMap[h.pipelineId] : (h.toolName || 'unknown');
                    return formatToolHint(pipeName, h.hintText);
                }).join("\n");
                toolHintContext += "\n";
            }
        } catch (e) {
            console.warn("[Rag Service] Failed to fetch tool hints:", e);
        }

        // --- SEMANTIC POSITIVE EXAMPLES RETRIEVAL ---
        let relevantExamples: any[] = [];

        // Try semantic search with embeddings first
        const queryEmbedding = await embeddingService.generateEmbedding(query);

        if (queryEmbedding) {
            try {
                // Vector similarity search with effectiveness weighting
                // Join with jobs to filter by organization
                const candidates = await db.select({
                    message: agentChatMessages,
                    job: jobs
                })
                    .from(agentChatMessages)
                    .leftJoin(jobs, eq(agentChatMessages.jobId, jobs.id))
                    .where(and(
                        // If jobId provided, prioritize it? Or just ensure org match.
                        // For Simulated Experience, we want ANY good example from the Org.
                        eq(jobs.organizationId, organizationId),
                        eq(agentChatMessages.role, 'agent'),
                        eq(agentChatMessages.rating, 1),
                        sql`${agentChatMessages.embedding} IS NOT NULL`
                    ))
                    .orderBy(desc(agentChatMessages.effectivenessScore), desc(agentChatMessages.createdAt))
                    .limit(20);

                if (Array.isArray(candidates) && candidates.length > 0) {
                    const scored = (candidates as any[]).map(c => {
                        try {
                            const embeddingArr = JSON.parse(c.message.embedding || '[]');
                            const similarity = this.cosineSimilarity(queryEmbedding, embeddingArr);
                            const effectivenessBoost = 1 + (c.message.effectivenessScore || 0) * 0.1;
                            // Boost if from same job
                            const sameJobBoost = (jobId && c.message.jobId === jobId) ? 1.2 : 1.0;
                            return { message: c.message, score: similarity * effectivenessBoost * sameJobBoost };
                        } catch {
                            return { message: c.message, score: 0 };
                        }
                    });

                    relevantExamples = scored
                        .filter(s => s.score > similarityThreshold)
                        .map(s => s.message);
                }
            } catch (e) {
                console.warn("[Rag Service] Semantic search failed, falling back to keywords:", e);
            }
        }

        // HYBRID SEARCH
        const keywordCandidates = await db.select({
            message: agentChatMessages,
            job: jobs
        })
            .from(agentChatMessages)
            .leftJoin(jobs, eq(agentChatMessages.jobId, jobs.id))
            .where(and(
                eq(jobs.organizationId, organizationId),
                eq(agentChatMessages.role, 'agent'),
                eq(agentChatMessages.rating, 1)
            ))
            .orderBy(desc(agentChatMessages.createdAt))
            .limit(20);

        let keywordMatches: any[] = [];
        if (Array.isArray(keywordCandidates) && keywordCandidates.length > 0) {
            const scored = (keywordCandidates as any[]).map(c => {
                const metadata = c.message.metadata as any;
                const triggerPrompt = metadata?.triggerPrompt || "";
                const triggerKeywords = this.getKeywords(triggerPrompt);
                let overlap = 0;
                triggerKeywords.forEach(k => { if (queryKeywords.has(k)) overlap++; });
                const baseScore = queryKeywords.size > 0
                    ? overlap / (queryKeywords.size + triggerKeywords.size - overlap)
                    : 0;

                // Boost if from same job
                const sameJobScore = (jobId && c.message.jobId === jobId) ? 1.2 : 1.0;
                return { message: c.message, score: baseScore * 1.5 * sameJobScore };
            });

            keywordMatches = scored
                .filter(s => s.score > 0.2)
                .map(s => s.message);
        }

        // Merge and Deduplicate
        const seenIds = new Set<number>();
        const uniqueExamples = [];

        for (const ex of [...relevantExamples, ...keywordMatches]) {
            if (!seenIds.has(ex.id)) {
                seenIds.add(ex.id);
                uniqueExamples.push(ex);
            }
        }

        relevantExamples = uniqueExamples.slice(0, 3);
        if (relevantExamples.length === 0) return { context: toolHintContext, usedExampleIds: [], retrospectives: [] };

        const examplesContext = relevantExamples.map(r => `
Q: "${(r.metadata as any)?.triggerPrompt || '...'}"
A: "${r.content.substring(0, 300)}..."
`).join("\n");

        const usedExampleIds = relevantExamples.map(r => r.id);

        // --- SIDECAR CONSOLIDATED CONTEXT (Phase 1) ---
        let sidecarContextStr = "";
        if (jobId) {
            try {
                // Assuming userId might be available from a higher context, or we use "system"
                const sidecarData = await sidecarSyncService.fetchConsolidatedContext(query, jobId || undefined, "system", appDeploymentId);
                if (sidecarData && sidecarData.results && sidecarData.results.length > 0) {
                    sidecarContextStr = "\n## LONG-TERM DISTILLED CONTEXT (from Sidecar)\n";
                    sidecarContextStr += sidecarData.results.map((r: any) =>
                        `- ${r.primary_memory?.content || '...'}`
                    ).join("\n") + "\n";
                }
            } catch (e) {
                console.warn("[Rag Service] Failed sidecar context retrieval:", e);
            }
        }

        // --- MISSION RETROSPECTIVES (Golden Plans) ---
        let retrospectiveContext = "";
        let retrievedRetrospectives: any[] = [];
        try {
            retrievedRetrospectives = await this.fetchMissionRetrospectives(query, organizationId, similarityThreshold);
            if (retrievedRetrospectives.length > 0) {
                retrospectiveContext = "\n## PAST SUCCESSFUL STRATEGIES (Golden Plans)\n";
                retrospectiveContext += retrievedRetrospectives.map(r => 
                    `### Plan for similar goal:\n${r.learnedContext}`
                ).join("\n\n") + "\n";
            }
        } catch (e) {
            console.warn("[Rag Service] Failed mission retrospective retrieval:", e);
        }

        return {
            context: toolHintContext + 
                     (examplesContext ? `\n## GOOD EXAMPLE RESPONSES\n${examplesContext}` : "") + 
                     retrospectiveContext +
                     sidecarContextStr,
            usedExampleIds,
            retrospectives: retrievedRetrospectives
        };
    },

    /**
     * Fetch relevant mission retrospectives based on goal embedding
     */
    async fetchMissionRetrospectives(query: string, organizationId: number, similarityThreshold: number = 0.7): Promise<any[]> {
        const { missionRetrospectives } = await import("@shared/schema/index.js");
        const queryEmbedding = await embeddingService.generateEmbedding(query);
        if (!queryEmbedding) return [];

        try {
            const candidates = await db.select()
                .from(missionRetrospectives)
                .where(and(
                    eq(missionRetrospectives.organizationId, organizationId),
                    sql`${missionRetrospectives.embedding} IS NOT NULL`
                ))
                .limit(10);

            if (!Array.isArray(candidates) || candidates.length === 0) return [];

            const scored = (candidates as any[]).map(c => {
                try {
                    const embeddingArr = JSON.parse(c.embedding || '[]');
                    const similarity = this.cosineSimilarity(queryEmbedding, embeddingArr);
                    return { retrospective: c, score: similarity };
                } catch {
                    return { retrospective: c, score: 0 };
                }
            });

            return scored
                .filter(s => s.score > similarityThreshold)
                .sort((a, b) => b.score - a.score)
                .map(s => s.retrospective)
                .slice(0, 3);
        } catch (e) {
            console.error("[Rag Service] fetchMissionRetrospectives failed:", e);
            return [];
        }
    },

    /**
     * Executes surprise-gated memory consolidation via memoryConsolidationService
     */
    async runMemoryConsolidation(organizationId: number) {
        const { memoryConsolidationService } = await import("./memory-consolidation.service.js");
        return memoryConsolidationService.runDigitalSleepCycle(organizationId);
    }
};



