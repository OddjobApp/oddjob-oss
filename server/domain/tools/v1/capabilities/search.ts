import { z } from "zod";
import type { ToolDefinition } from "./types.js";

import { db } from "@server/database_service.js";
import { credentials } from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";

export interface KnowledgeEvidence {
    sourceId: string;
    sourceType: string;
    title: string;
    confidence: number;        // 0-1 from adjustedScore or score
    freshnessScore: number;    // 1.0 if < 7 days, 0.5 if < 30 days, 0.0 if older
    freshnessAgeDays: number;  // days since capturedAt
    lineage: string[];         // linkedNodeIds from metadata
    verificationStatus: string;
    isStale: boolean;          // true if freshnessAgeDays > 30
}

export interface UnifiedSearchResult {
    content: string;
    evidence: KnowledgeEvidence[];
    staleWarnings: string[];
}


const search_unified_knowledge_params = z.object({
    query: z.string().describe("The natural language search query."),
    filter_source: z.enum(["all", "documentation", "dataset", "graph"]).optional().describe("Filter results by source type. Default is 'all'."),
    limit: z.number().optional().describe("Max results to return. Default is 5.")
});

const search_unified_knowledge: ToolDefinition<typeof search_unified_knowledge_params> = {
    name: "search_unified_knowledge",
    // Read-only: verified to perform no writes. Lets the planner run it
    // speculatively or in parallel (tool-planner.service.ts).
    idempotency: "read-safe",
    label: "Search Unified Knowledge",
    group: "Knowledge Management",
    description: "Search the Unified Knowledge Base (Operational Truth) for information. This includes documentation (Confluence), structured data (Datasets), and entity relationships (Knowledge Graph). IMPORTANT: If a search result provides a 'URL' field, you MUST provide that direct link in your response for the user to verify.",
    parameters: search_unified_knowledge_params,
    execute: async (args, context): Promise<UnifiedSearchResult | string> => {
        const { query, filter_source, limit } = args;
        const { organizationId, userId } = context ?? {};
        try {
            const searchQuery = typeof query === 'string' ? query.trim() : '';
            if (!searchQuery) {
                return "Please provide a search query. Example: 'What are the application requirements?'";
            }
            console.log(`[Unified Search] Query: "${searchQuery}" (Filter: ${filter_source || 'all'})`);

            // 0. Semantic Cache Check
            if (organizationId) {
                const { SemanticCacheService } = await import("@domain/ai/core/semantic-cache.service.js");
                const cached = await SemanticCacheService.get(searchQuery, organizationId);
                if (cached) {
                    // Cached value is a plain string from before evidence was added — return as-is
                    if (typeof cached === "string") return cached;
                    return cached as UnifiedSearchResult;
                }
            }

            // 1. Construct Filter (Optional)
            let filter: any = {};
            if (filter_source && filter_source !== 'all') {
                const typeMap: Record<string, string> = {
                    "documentation": "knowledge_document",
                    "dataset": "dataset_row",
                    "graph": "graph_node"
                };

                let qdrantSourceType = typeMap[filter_source];
                if (filter_source === 'documentation') {
                    filter = {
                        should: [
                            { key: "sourceType", match: { value: "text" } },
                            { key: "sourceType", match: { value: "upload" } },
                            { key: "sourceType", match: { value: "link" } },
                            { key: "sourceType", match: { value: "confluence" } },
                            { key: "sourceType", match: { value: "integration" } }
                        ]
                    };
                } else if (qdrantSourceType) {
                    filter = {
                        must: [
                            { key: "sourceType", match: { value: qdrantSourceType } }
                        ]
                    };
                }
            }

            // 2. Execute Semantic Search (Hybrid)
            const { retrieveSimilarDocuments } = await import("@domain/knowledge/core/rag-langchain.service.js");
            const results = await retrieveSimilarDocuments(searchQuery, {
                k: limit || 5,
                organizationId: organizationId || null,
                filter: Object.keys(filter).length > 0 ? filter : undefined,
                recencyBias: 0.1,
                authorityBias: 0.2
            });

            if (results.length === 0) {
                return "No relevant information found in the knowledge base.";
            }

            // Try to find the Confluence base URL to fix broken links
            let confluenceBaseUrl = "";
            try {
                if (organizationId) {
                    const [cred] = await db.select().from(credentials).where(and(eq(credentials.organizationId, organizationId), eq(credentials.type, 'confluence'))).limit(1);
                    if (cred && cred.metadata) {
                        const m = cred.metadata as any;
                        confluenceBaseUrl = m.baseUrl || "";
                        if (confluenceBaseUrl.endsWith('/wiki')) {
                            confluenceBaseUrl = confluenceBaseUrl.replace(/\/wiki$/, '');
                        }
                    }
                }
            } catch (e) {
                console.warn("[Unified Search] Failed to get confluence base url fallback:", e);
            }

            const now = Date.now();

            // 3. Build evidence array and format results for the Agent
            const evidence: KnowledgeEvidence[] = [];
            const staleWarnings: string[] = [];

            const formatted = results.map((doc, i) => {
                const meta = doc.metadata;
                let typeLabel = "[Doc]";
                if (meta.sourceType === 'dataset_row') typeLabel = "[Data]";
                if (meta.sourceType === 'graph_node') typeLabel = "[Entity]";

                const content = doc.pageContent.length > 1000
                    ? doc.pageContent.slice(0, 1000) + "... (truncated)"
                    : doc.pageContent;

                let directUrl = (meta as any).url || (meta as any).directUrl;

                if (directUrl && typeof directUrl === 'string') {
                    if (directUrl.startsWith('undefined')) {
                        directUrl = directUrl.replace(/^undefined/, '');
                    }
                    if (!directUrl.startsWith('http') && confluenceBaseUrl) {
                        if (!directUrl.startsWith('/')) directUrl = '/' + directUrl;
                        directUrl = confluenceBaseUrl + directUrl;
                    }
                }

                const urlText = directUrl ? `\nURL: ${directUrl}` : "";

                // --- Build KnowledgeEvidence for this result ---
                const confidence = typeof doc.adjustedScore === "number" ? doc.adjustedScore : (typeof doc.score === "number" ? doc.score : 0);

                let freshnessAgeDays = 0;
                let freshnessScore = 1.0;
                if (meta.capturedAt) {
                    try {
                        const capturedMs = new Date(meta.capturedAt).getTime();
                        if (!isNaN(capturedMs)) {
                            freshnessAgeDays = Math.floor((now - capturedMs) / (1000 * 60 * 60 * 24));
                            if (freshnessAgeDays < 7) {
                                freshnessScore = 1.0;
                            } else if (freshnessAgeDays < 30) {
                                freshnessScore = 0.5;
                            } else {
                                freshnessScore = 0.0;
                            }
                        }
                    } catch (_) { /* non-fatal */ }
                }

                const isStale = freshnessAgeDays > 30;
                const title = meta.name || `Result ${i + 1}`;
                const sourceId = String(meta.assetId ?? meta.chunkId ?? `result-${i}`);
                const lineage = Array.isArray((meta as any).linkedNodeIds)
                    ? (meta as any).linkedNodeIds.map(String)
                    : [];

                const ev: KnowledgeEvidence = {
                    sourceId,
                    sourceType: meta.sourceType || "unknown",
                    title,
                    confidence: Math.min(1, Math.max(0, confidence)),
                    freshnessScore,
                    freshnessAgeDays,
                    lineage,
                    verificationStatus: meta.verificationStatus || "unknown",
                    isStale,
                };
                evidence.push(ev);

                if (isStale) {
                    staleWarnings.push(`Source '${title}' is ${freshnessAgeDays} days old — verify freshness.`);
                }

                return `Result ${i + 1} ${typeLabel}: ${meta.name}\n${content}\nSource: ${meta.sourceType} (ID: ${meta.assetId})${urlText}`;
            }).join("\n\n---\n\n");

            const content = `Found ${results.length} relevant items in the knowledge base (Operational Truth):\n\n${formatted}\n\n*Note: Use 'get_document_details' or 'get_dataset_details' for full content if needed.*`;

            const response: UnifiedSearchResult = { content, evidence, staleWarnings };

            // 4. Update Semantic Cache (Fire and Forget)
            if (organizationId && results.length > 0) {
                const { SemanticCacheService } = await import("@domain/ai/core/semantic-cache.service.js");
                SemanticCacheService.set(searchQuery, response as any, organizationId || null).catch(e => console.warn("[Unified Search] Cache set failed:", e));
            }

            return response;

        } catch (error: any) {
            console.error("[Unified Search Tool] ERROR:", error);
            if (error.message?.includes("404") || error.message?.includes("Not Found")) {
                return "The knowledge base search service is temporarily unavailable (Model Not Found).";
            }
            return `I encountered an unexpected error while searching: ${error.message}.`;
        }
    }
};

export const UNIFIED_SEARCH_TOOLS = {
    search_unified_knowledge
};


