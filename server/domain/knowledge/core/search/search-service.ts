// @ts-nocheck

import { db } from "../../../../database_service.js";
import {
    fineTuningDatasets,
    fineTuningExamples,
    datasets,
    missions,
    missionBlackboardHistory,
    knowledgeDocuments
} from "@shared/schema/index.js";
import { eq, or, ilike, and, sql, inArray } from "drizzle-orm";
import { createLogger } from "../../../../utils/logger.js";
// Lazy load services to avoid circular dependencies if any
// But for type safety we can import types if separated.
// Using inline imports or lazy imports for now to match original logic style if needed,
// but cleaner is to import at top if no circle.
// jobService and pipelineService are likely safe.


const logger = createLogger("SearchService");

/**
 * Whether vector hits with no securityClassification are still returned.
 *
 * Defaults to FALSE. scripts/backfill-security-classification.ts has stamped all
 * 517,125 points across 119 collections, so the strict filter now returns the same
 * results as the tolerant one — verified on the three queries that previously
 * returned nothing at all.
 *
 * The escape hatch survives because the failure it covers is silent and total: a
 * writer that forgets the field does not raise anything, its chunks simply vanish
 * from search. RAG_ALLOW_UNCLASSIFIED_CHUNKS=true restores retrieval while that is
 * diagnosed, at the cost of exposing unclassified chunks at any clearance.
 */
const ALLOW_UNCLASSIFIED_CHUNKS = process.env.RAG_ALLOW_UNCLASSIFIED_CHUNKS === "true";

export interface SearchResult {
    id: string | number;
    type: "document" | "node" | "job" | "pipeline" | "dataset" | "example" | "mission";
    title: string;
    description?: string;
    textContent?: string;
    url?: string;
    score?: number;
    metadata?: Record<string, any>;
}

export interface QueryClassification {
    queryType: "keyword" | "vector" | "graph" | "unknown";
    confidence: number;
    explanation?: string;
}

export const searchService = {
    /**
     * Classify query intent using heuristics (and optionally AI)
     */
    async classifySearchQuery(query: string): Promise<QueryClassification> {
        const q = query.toLowerCase();

        // Graph query patterns
        const graphPatterns = [
            /connections? between/i,
            /related to/i,
            /linked to/i,
            /relationships? (of|between|with)/i,
            /show me.*and.*connections/i,
            /how is .* connected/i,
            /find .* that (links?|connects?)/i,
            /graph of/i,
            /network of/i,
        ];

        // Semantic/RAG query patterns (questions, explanations)
        const semanticPatterns = [
            /^(how|what|why|when|where|who|which|can|could|would|should|is|are|do|does|did)/i,
            /explain/i,
            /describe/i,
            /tell me about/i,
            /summarize/i,
            /meaning of/i,
            /documentation (for|about|on)/i,
        ];

        // Check for graph patterns
        for (const pattern of graphPatterns) {
            if (pattern.test(q)) {
                return {
                    queryType: "graph",
                    confidence: 0.85,
                    explanation: "Detected entity relationship query",
                };
            }
        }

        // Check for semantic patterns
        for (const pattern of semanticPatterns) {
            if (pattern.test(q)) {
                return {
                    queryType: "vector",
                    confidence: 0.8,
                    explanation: "Detected natural language question",
                };
            }
        }

        // Short queries (1-3 words) are likely keyword searches
        const wordCount = query.split(/\s+/).length;
        if (wordCount <= 3) {
            return {
                queryType: "keyword",
                confidence: 0.9,
                explanation: "Short keyword search",
            };
        }

        // Default to vector for longer, ambiguous queries
        return {
            queryType: "vector",
            confidence: 0.6,
            explanation: "Using semantic search for complex query",
        };
    },

    /**
     * Execute unified search across multiple backends
     */
    async executeUnifiedSearch(
        query: string,
        queryType: "keyword" | "vector" | "graph" | "dataset" | "unknown",
        organizationId: number | null,
        options: {
            limit?: number;
            before?: string;
            after?: string;
            updated_before?: string;
            updated_after?: string;
            /**
             * Project Space retrieval boundary (PROJECT_SPACES_DESIGN §6.4). When set,
             * results are narrowed to this project instead of searching org-wide.
             *
             * Opt-in: callers that pass nothing get exactly today's org-wide behaviour,
             * so adding the option changes no existing caller.
             */
            projectId?: number | null;
        } = {}
    ): Promise<SearchResult[]> {
        const projectScope = typeof options.projectId === "number" ? options.projectId : null;
        const results: SearchResult[] = [];

        try {
            const searchContext: OrgContext = {
                organizationId: organizationId as any,
                userId: 'system',
                isAdmin: false,
                isSuperAdmin: false,
                isOrgAdmin: false,
                role: 'system'
            };

            const { GovernancePolicyService } = await import("../../../governor/core/governance-policy.service.js");
            const securityClearance = GovernancePolicyService.getSecurityClearance(searchContext);

            console.log(`[SearchService] Executing Unified Search (${queryType}) for org: ${organizationId} | Clearance: ${securityClearance}`);
            const queryLower = query.toLowerCase();

            // Define parallel sub-tasks using Promise.allSettled for maximum concurrency and resilience

            // ── Task 1: Jobs & Pipelines ──────────────────────────────────────────
            const searchJobsAndPipelines = async (): Promise<SearchResult[]> => {
                if (queryType === "dataset" || queryType === "graph") return [];
                const res: SearchResult[] = [];
                try {
                    const { jobService } = await import("../../../jobs/job.service.js");
                    const { pipelineService } = await import("../../../pipeline/core/pipeline.service.js");

                    const [allJobs, allPipelines] = await Promise.all([
                        jobService.list(searchContext).catch(() => ({ items: [] })),
                        pipelineService.list(searchContext, { includeInactive: true }).catch(() => [])
                    ]);

                    const matchingJobs = (allJobs.items || [])
                        .filter((j: any) => j.name?.toLowerCase().includes(queryLower) || j.description?.toLowerCase().includes(queryLower))
                        .slice(0, 5);

                    for (const job of matchingJobs) {
                        res.push({
                            id: job.id,
                            type: "job",
                            title: job.name,
                            description: `${job.type} job`,
                            url: `/jobs/${job.id}`,
                            score: 0.7,
                        });
                    }

                    const matchingPipelines = (allPipelines || [])
                        .filter((p: any) => p.name?.toLowerCase().includes(queryLower) || p.description?.toLowerCase().includes(queryLower))
                        .slice(0, 5);

                    for (const pipeline of matchingPipelines) {
                        res.push({
                            id: pipeline.id,
                            type: "pipeline",
                            title: pipeline.name,
                            description: pipeline.description || `Pipeline`,
                            url: `/pipelines/${pipeline.id}`,
                            score: 0.7,
                        });
                    }
                } catch (e: any) {
                    logger.warn("[SearchService] Jobs/Pipelines search failed:", e?.message);
                }
                return res;
            };

            // ── Task 2: Datasets & Examples ───────────────────────────────────────
            const searchDatasetsAndExamples = async (): Promise<SearchResult[]> => {
                if (queryType !== "keyword" && queryType !== "dataset" && queryType !== "unknown") return [];
                const res: SearchResult[] = [];
                try {
                    const [matchingGeneric, matchingFineTuning] = await Promise.all([
                        db.select()
                            .from(datasets)
                            .where(and(
                                or(ilike(datasets.name, `%${query}%`), ilike(datasets.description, `%${query}%`)),
                                // Datasets carry a real project_id (migration 0007), so this
                                // narrowing is exact rather than inferred.
                                projectScope ? eq(datasets.projectId, projectScope) : undefined,
                            ))
                            .limit(5)
                            .catch(() => []),
                        db.select()
                            .from(fineTuningDatasets)
                            .where(or(ilike(fineTuningDatasets.name, `%${query}%`), ilike(fineTuningDatasets.description, `%${query}%`)))
                            .limit(5)
                            .catch(() => [])
                    ]);

                    for (const ds of matchingGeneric) {
                        res.push({
                            id: `gen-ds-${ds.id}`,
                            type: "dataset",
                            title: ds.name,
                            description: ds.description || "Structured Dataset",
                            url: `/knowledge/datasets/${ds.id}`,
                            score: 0.85,
                        });
                    }

                    for (const ds of matchingFineTuning) {
                        res.push({
                            id: `ds-${ds.id}`,
                            type: "dataset",
                            title: `Training: ${ds.name}`,
                            description: ds.description || "Training Dataset",
                            url: `/knowledge/fine-tuning/datasets/${ds.id}`,
                            score: 0.8,
                        });
                    }

                    if (res.length < 5) {
                        const matchingExamples = await db
                            .select({
                                id: fineTuningExamples.id,
                                input: fineTuningExamples.input,
                                output: fineTuningExamples.output,
                                datasetId: fineTuningExamples.datasetId,
                                datasetName: fineTuningDatasets.name
                            })
                            .from(fineTuningExamples)
                            .innerJoin(fineTuningDatasets, eq(fineTuningExamples.datasetId, fineTuningDatasets.id))
                            .where(or(ilike(fineTuningExamples.input, `%${query}%`), ilike(fineTuningExamples.output, `%${query}%`)))
                            .limit(5)
                            .catch(() => []);

                        for (const ex of matchingExamples) {
                            res.push({
                                id: `ex-${ex.id}`,
                                type: "example",
                                title: `Example in ${ex.datasetName}`,
                                description: ex.input.substring(0, 100) + "...",
                                url: `/knowledge/fine-tuning/datasets/${ex.datasetId}`,
                                score: 0.75,
                                metadata: { fullInput: ex.input, fullOutput: ex.output }
                            });
                        }
                    }
                } catch (e: any) {
                    logger.warn("[SearchService] Dataset search failed:", e?.message);
                }
                return res;
            };

            // ── Task 3: Knowledge Graph Nodes ─────────────────────────────────────
            const searchGraphNodes = async (): Promise<SearchResult[]> => {
                if (queryType !== "graph" && queryType !== "unknown") return [];
                const res: SearchResult[] = [];
                try {
                    const { knowledgeService } = await import("../../knowledge.service.js");
                    const { nodes } = await knowledgeService.searchNodes(
                        { organizationId, userId: "system", isSuperAdmin: false },
                        {
                            query: query,
                            limit: options.limit || 10,
                            excludeLabels: ["AgentReasoning"],
                            temporal: (options.before || options.after) ? {
                                before: options.before,
                                after: options.after,
                                field: 'created'
                            } : (options.updated_before || options.updated_after) ? {
                                before: options.updated_before,
                                after: options.updated_after,
                                field: 'updated'
                            } : undefined
                        }
                    );

                    for (const node of nodes || []) {
                        res.push({
                            id: node.id,
                            type: "node",
                            title: node.name,
                            description: `${node.label} entity${node.externalId ? ` (${node.externalId})` : ""}`,
                            url: `/knowledge/graph?nodeId=${node.id}`,
                            score: 0.8,
                            metadata: { label: node.label, data: node.data },
                        });
                    }
                } catch (e: any) {
                    logger.warn("[SearchService] Graph search failed:", e?.message);
                }
                return res;
            };

            // ── Task 4: Vector Document RAG (with 3.5s timeout) ───────────────────
            const searchVectorDocs = async (): Promise<SearchResult[]> => {
                if (queryType === "dataset" || queryType === "graph" || queryType === "keyword") return [];
                const res: SearchResult[] = [];
                try {
                    const { retrieveSimilarDocuments } = await import("../rag-langchain.service.js") as any;
                    if (typeof retrieveSimilarDocuments === 'function') {
                        const vectorOptions: any = { 
                            k: options.limit || 5, 
                            organizationId,
                            before: options.before || options.updated_before,
                            after: options.after || options.updated_after,
                            since: options.after || options.updated_after,
                            filter: {
                                must: [
                                    // Escape hatch, OFF by default — see ALLOW_UNCLASSIFIED_CHUNKS.
                                    //
                                    // A bare `range` excludes any point LACKING the key, and
                                    // no indexed chunk ever carried securityClassification:
                                    // 0 of 7826 points matched in org 342, 0 of 5064 in org
                                    // 291. The same query without the filter returned 5
                                    // documents. So the vector arm of unified search returned
                                    // nothing for every query in every org, silently — agents
                                    // concluded the knowledge base held nothing about this
                                    // platform and fell back to searching the public web.
                                    //
                                    // Accepting is_empty restores retrieval while the backfill
                                    // runs, at the cost of exposing unclassified chunks at any
                                    // clearance. Gate it off with
                                    // RAG_ALLOW_UNCLASSIFIED_CHUNKS=false once backfilled;
                                    // scripts/backfill-security-classification.ts reports what
                                    // remains.
                                    ALLOW_UNCLASSIFIED_CHUNKS
                                        ? {
                                            should: [
                                                { key: "securityClassification", range: { lte: securityClearance } },
                                                { is_empty: { key: "securityClassification" } },
                                            ],
                                        }
                                        : {
                                            key: "securityClassification",
                                            range: { lte: securityClearance },
                                        }
                                ]
                            }
                        };

                        // Wrap vector search in a 3.5-second timeout so a slow embedding model doesn't hang copilot
                        const vectorPromise = retrieveSimilarDocuments(query, vectorOptions);
                        const timeoutPromise = new Promise<any[]>((resolve) => setTimeout(() => resolve([]), 3500));
                        let vectorResults = await Promise.race([vectorPromise, timeoutPromise]);

                        // Project narrowing for vector hits.
                        //
                        // The Qdrant payload predates Project Spaces and carries no
                        // projectId, so filtering inside the vector query would match
                        // nothing and silently return an EMPTY result set — a far worse
                        // failure than searching too broadly. Instead map the hits back
                        // through rag_assets -> knowledge_documents.project_id, which is
                        // exact and needs no reindex.
                        //
                        // Fail-open by design: a hit whose project cannot be determined
                        // is KEPT. Retrieval silently losing documents is the one
                        // outcome worth engineering hardest against.
                        const sourceByAsset = new Map<number, {
                            projectId: number | null;
                            documentId: number | null;
                            documentUrl: string | null;
                        }>();

                        if (Array.isArray(vectorResults) && vectorResults.length > 0) {
                            try {
                                const assetIds = vectorResults
                                    .map((d: any) => Number(d?.metadata?.assetId))
                                    .filter((n: number) => Number.isInteger(n));

                                if (assetIds.length > 0) {
                                    const rows = await db
                                        .select({
                                            assetId: knowledgeDocuments.id,
                                            projectId: knowledgeDocuments.projectId,
                                            documentId: knowledgeDocuments.id,
                                            documentUrl: knowledgeDocuments.url,
                                        })
                                        .from(knowledgeDocuments)
                                        .where(inArray(knowledgeDocuments.id, assetIds));

                                    for (const row of rows) {
                                        sourceByAsset.set(row.assetId, {
                                            projectId: row.projectId,
                                            documentId: row.documentId,
                                            documentUrl: row.documentUrl,
                                        });
                                    }

                                    if (projectScope) {
                                        vectorResults = vectorResults.filter((d: any) => {
                                            const assetId = Number(d?.metadata?.assetId);
                                            if (!Number.isInteger(assetId)) return true;      // unknown -> keep
                                            const owner = sourceByAsset.get(assetId)?.projectId;
                                            if (owner === undefined || owner === null) return true; // unattached -> keep
                                            return owner === projectScope;
                                        });
                                    }
                                }
                            } catch (scopeErr) {
                                logger.warn("[SearchService] Project scoping of vector hits failed; returning unscoped results:", scopeErr);
                            }
                        }

                        for (const doc of vectorResults || []) {
                            const assetId = Number(doc.metadata?.assetId);
                            const source = Number.isInteger(assetId) ? sourceByAsset.get(assetId) : undefined;
                            // Current Knowledge Document vectors use the document's
                            // primary key as assetId. Keep the DB lookup for older
                            // indexes, but do not discard the canonical ID already
                            // present in modern payloads.
                            const documentId = source?.documentId
                                ?? (doc.metadata?.assetType === "Knowledge Document" && Number.isInteger(assetId)
                                    ? assetId
                                    : null);
                            const documentUrl = source?.documentUrl
                                || (documentId != null
                                    ? `/knowledge/store?documentId=${documentId}`
                                    : `/knowledge/store`);
                            res.push({
                                id: doc.metadata?.assetId || doc.metadata?.assetKey || `doc-${Date.now()}`,
                                type: "document",
                                title: doc.metadata?.name || doc.metadata?.jobName || "Document",
                                textContent: doc.pageContent,
                                description: doc.pageContent?.substring(0, 150) + "...",
                                url: (doc.metadata as any)?.url || documentUrl,
                                score: doc.metadata?.score || 0.75,
                                metadata: {
                                    ...doc.metadata,
                                    knowledgeDocumentId: documentId,
                                },
                            });
                        }
                    }
                } catch (vectorError) {
                    logger.warn("[SearchService] Vector search unavailable:", vectorError);
                }
                return res;
            };

            // ── Task 5: Past Missions ─────────────────────────────────────────────
            const searchPastMissions = async (): Promise<SearchResult[]> => {
                if (queryType !== "keyword" && queryType !== "unknown") return [];
                const res: SearchResult[] = [];
                try {
                    const matchingMissions = await db
                        .select({
                            id: missions.id,
                            name: missions.name,
                            intent: missions.objective,
                            blackboard: missions.blackboard
                        })
                        .from(missions)
                        .where(
                            and(
                                eq(missions.organizationId, organizationId),
                                or(
                                    ilike(missions.name, `%${query}%`),
                                    ilike(missions.objective, `%${query}%`),
                                    sql`COALESCE(${missions.blackboard}::text, '') ilike ${`%${query}%`}`
                                )
                            )
                        )
                        .limit(5);

                    for (const mission of matchingMissions) {
                        res.push({
                            id: `mission-${mission.id}`,
                            type: "mission",
                            title: `Past Mission: ${mission.name}`,
                            description: mission.intent?.substring(0, 150) + "...",
                            url: `/missions/${mission.id}`,
                            score: 0.8,
                            metadata: { missionId: mission.id, intent: mission.intent }
                        });
                    }
                } catch (e: any) {
                    logger.warn("[SearchService] Past missions search failed:", e?.message);
                }
                return res;
            };

            // Execute all search tasks concurrently!
            const tasksResults = await Promise.allSettled([
                searchJobsAndPipelines(),
                searchDatasetsAndExamples(),
                searchGraphNodes(),
                searchVectorDocs(),
                searchPastMissions()
            ]);

            for (const r of tasksResults) {
                if (r.status === "fulfilled" && Array.isArray(r.value)) {
                    results.push(...r.value);
                }
            }

            results.sort((a, b) => (b.score || 0) - (a.score || 0));
            return results.slice(0, 15);
        } catch (error: any) {
            logger.error("[SearchService] Execution error", error);
            return results;
        }
    },

    /**
     * Execute hybrid search combining keyword, vector, and graph search
     */
    async executeHybridSearch(
        query: string,
        organizationId: number | null,
        options: {
            weights?: { keyword: number; vector: number; graph: number };
            similarityThreshold?: number;
            maxResults?: number;
        } = {}
    ): Promise<SearchResult[]> {
        const {
            weights = { keyword: 0.3, vector: 0.5, graph: 0.2 },
            similarityThreshold = 0.7,
            maxResults = 20
        } = options;

        try {
            // 1. Execute all search types in parallel
            const [keywordResults, vectorResults, graphResults] = await Promise.all([
                this.executeUnifiedSearch(query, "keyword", organizationId),
                this.executeUnifiedSearch(query, "vector", organizationId),
                this.executeUnifiedSearch(query, "graph", organizationId)
            ]);

            // 2. Normalize scores to 0-1 range
            const normalizeScores = (results: SearchResult[]) => {
                if (!results.length) return [];
                const scores = results.map(r => r.score || 0);
                const maxScore = Math.max(...scores);
                const minScore = Math.min(...scores);
                const range = maxScore - minScore || 1;

                return results.map(r => ({
                    ...r,
                    normalizedScore: ((r.score || 0) - minScore) / range
                }));
            };

            const normalizedKeyword = normalizeScores(keywordResults);
            const normalizedVector = normalizeScores(vectorResults);
            const normalizedGraph = normalizeScores(graphResults);

            // 3. Combine results with weighted scores
            const combinedMap = new Map<string, SearchResult & { combinedScore: number }>();

            const addToMap = (results: any[], weight: number) => {
                results.forEach(result => {
                    const key = `${result.type}-${result.id}`;
                    const existing = combinedMap.get(key);
                    const weightedScore = (result.normalizedScore || 0) * weight;

                    if (existing) {
                        existing.combinedScore += weightedScore;
                    } else {
                        combinedMap.set(key, {
                            ...result,
                            combinedScore: weightedScore
                        });
                    }
                });
            };

            addToMap(normalizedKeyword, weights.keyword);
            addToMap(normalizedVector, weights.vector);
            addToMap(normalizedGraph, weights.graph);

            // 4. Sort by combined score and return top results
            const combined = Array.from(combinedMap.values())
                .sort((a, b) => b.combinedScore - a.combinedScore)
                .slice(0, maxResults)
                .map(({ combinedScore, ...result }) => ({
                    ...result,
                    score: combinedScore
                }));

            return combined;
        } catch (error: any) {
            logger.error("[SearchService] Hybrid search error", error);
            return [];
        }
    }
};

export default searchService;


