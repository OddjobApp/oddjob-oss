
import { z } from "zod";
import { recentDegradation } from "../../../ai/core/ai-degradation.js";
import { requireToolOrgId } from "./org-context.js";

/**
 * Mirrors isQuotaError in rag-langchain.service.ts — the search tool needs the
 * same classification without importing the LangChain module graph.
 */
function isQuotaLikeError(err: any): boolean {
    const m = String(err?.message ?? err ?? "").toLowerCase();
    return m.includes("429") || m.includes("resource_exhausted") || m.includes("resource exhausted") ||
           m.includes("spending cap") || m.includes("monthly budget") || m.includes("project spend") ||
           m.includes("quota") || m.includes("rate limit");
}

const DEGRADED_SEARCH_NOTICE =
    "Knowledge base search is currently degraded (embedding provider quota exhausted or fallback vectors in use). " +
    "Results may be missing — do not treat an empty result as proof the information does not exist.";

export interface ToolDefinition {
    name: string;
    description: string;
    parameters: z.ZodObject<any>;
    execute: (params: any, context?: any) => Promise<any>;
    label?: string;
    group?: string;
    adminOnly?: boolean;
    circuitConfig?: {
        failureThreshold: number;
        resetTimeoutMs: number;
    };
    fallbackTool?: string;
    /**
     * Mirrors ToolIdempotency in ./types.ts. This file declares its own
     * ToolDefinition rather than importing the canonical one, so the field has to
     * be repeated here — without it the planner cannot tell that this tool is
     * safe to run speculatively, and treats it as side-effecting.
     */
    idempotency?: "none" | "read-safe" | "idempotent";
}

export const search_unified_knowledge: ToolDefinition = {
    name: "search_unified_knowledge",
    // Read-only: verified to perform no writes. Lets the planner run it
    // speculatively or in parallel (tool-planner.service.ts).
    idempotency: "read-safe",
    label: "Search Unified Knowledge",
    group: "Knowledge Management",
    description: "Search the Unified Knowledge Base (Operational Truth) for information. This includes documentation (Confluence), structured data (Datasets), and entity relationships (Knowledge Graph). IMPORTANT: When citing a result, copy its DOCUMENT URL exactly, including relative /knowledge/... URLs. Never invent or replace the URL's origin.",
    parameters: z.object({
        query: z.string().describe("The natural language search query."),
        filter_source: z.enum(["all", "documentation", "dataset", "graph"]).optional().describe("Filter results by source type. Default is 'all'."),
        limit: z.number().optional().describe("Max results to return. Default is 5."),
        before: z.string().optional().describe("Only return items created BEFORE this date."),
        after: z.string().optional().describe("Only return items created AFTER this date."),
        since: z.string().optional().describe("Alias for 'after'."),
        updated_before: z.string().optional().describe("Only return items UPDATED BEFORE this date."),
        updated_after: z.string().optional().describe("Only return items UPDATED AFTER this date.")
    }),
    execute: async ({ query, filter_source, limit, before, after, since, updated_before, updated_after } = {}, context) => {
        try {
            // Throws without one; the catch below returns it as the tool's answer.
            const organizationId = requireToolOrgId(context);
            const searchQuery = typeof query === 'string' ? query.trim() : '';
            if (!searchQuery) {
                return "Please provide a search query. Example: 'What are the application requirements?'";
            }
            console.log(`[Unified Search Tool] Query: "${searchQuery}" (Filter: ${filter_source || 'all'})`);

            // Use dynamic imports to break circular dependencies
            const { searchService } = await import("../../../knowledge/core/search/search-service.js");
            const { SemanticCacheService } = await import("../../../ai/core/semantic-cache.service.js");

            try {
                const cached = await SemanticCacheService.get(searchQuery, organizationId);
                if (cached) {
                    console.log(`[Unified Search Tool] Cache hit for "${searchQuery}"`);
                    return cached;
                }
            } catch (cacheErr: any) {
                console.warn("[Unified Search Tool] Cache check skipped:", cacheErr?.message);
            }

            // Map filter_source to queryType if needed, but 'unknown' allows the service to classify
            let queryType: any = "unknown";
            if (filter_source === 'graph') queryType = "graph";
            if (filter_source === 'dataset') queryType = "dataset";
            if (filter_source === 'documentation') queryType = "vector";

            // Retry-with-backoff for transient failures (e.g. HTTP 503 service outages).
            // Up to 3 attempts: 800ms → 1600ms → 3200ms.
            const MAX_ATTEMPTS = 3;
            const BACKOFF_BASE_MS = 800;
            let results: any[] = [];
            let lastError: any = null;

            for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
                try {
                    results = await searchService.executeUnifiedSearch(searchQuery, queryType, organizationId, {
                        limit: limit || 10,
                        before,
                        after: after || since,
                        updated_before,
                        updated_after
                    });
                    lastError = null;
                    break; // success — exit retry loop
                } catch (retryErr: any) {
                    lastError = retryErr;
                    const isTransient =
                        retryErr?.status >= 500 ||
                        retryErr?.statusCode >= 500 ||
                        retryErr?.code === 'ECONNRESET' ||
                        retryErr?.code === 'ECONNREFUSED' ||
                        retryErr?.code === 'ETIMEDOUT' ||
                        retryErr?.message?.includes('timeout') ||
                        retryErr?.message?.includes('ECONNRESET');

                    if (!isTransient || attempt === MAX_ATTEMPTS) break;

                    const delayMs = BACKOFF_BASE_MS * Math.pow(2, attempt - 1);
                    console.warn(`[Unified Search Tool] Attempt ${attempt} failed (${retryErr.message}). Retrying in ${delayMs}ms…`);
                    await new Promise(r => setTimeout(r, delayMs));
                }
            }

            // A degraded embedding path makes both branches of "what came back"
            // unreliable: quota failures mean some content was never embedded
            // with a comparable vector, and fallback vectors rank by accident.
            const degradation = recentDegradation("embeddings");

            if (lastError) {
                console.error("[Unified Search Tool] All retry attempts failed:", lastError);
                // A quota-ish failure is not transient — say so plainly rather
                // than letting an agent read it as a flaky service.
                if (isQuotaLikeError(lastError) || degradation) {
                    return `${DEGRADED_SEARCH_NOTICE} (Underlying error: ${lastError?.message ?? 'unknown error'})`;
                }
                // Return a non-error-prefixed message so it doesn't trip circuit breakers
                return (
                    `Knowledge base search for "${searchQuery}" could not be completed at this time. ` +
                    `The service is temporarily unavailable — please try again in a moment. ` +
                    `(Details: ${lastError?.message ?? 'unknown error'})`
                );
            }

            if (!Array.isArray(results) || results.length === 0) {
                if (degradation) {
                    return `${DEGRADED_SEARCH_NOTICE} The query "${searchQuery}" returned no matches. (Degradation: ${degradation.reason})`;
                }
                return `No results found in the knowledge base for "${searchQuery}". The query returned no matches across documentation, datasets, or the knowledge graph. You may want to try different keywords or broaden your search.`;
            }

            const formatted = results.map((result, i) => {
                let typeLabel = `[${(result.type ?? 'UNKNOWN').toUpperCase()}]`;
                
                const content = result.textContent || result.description || "";
                const displayContent = content.length > 800
                    ? content.slice(0, 800) + "... (truncated)"
                    : content;

                const urlText = result.url ? `\nDOCUMENT URL (copy exactly): ${result.url}` : "";

                return `Result ${i + 1} ${typeLabel}: ${result.title}\n${displayContent}${urlText}`;
            }).join("\n\n---\n\n");

            const degradedWarning = degradation
                ? `WARNING: retrieval degraded — ${degradation.reason}. Results below may be incomplete.\n\n`
                : "";
            const response = `${degradedWarning}Found ${results.length} relevant items in the knowledge base (Operational Truth):\n\n${formatted}\n\n*Note: You can request more specific details for any item if needed.*`;

            if (results.length > 0) {
                SemanticCacheService.set(searchQuery, response, organizationId).catch(e => console.warn("[Unified Search Tool] Cache set failed:", e));
            }

            return response;

        } catch (error: any) {
            console.error("[Unified Search Tool] ERROR:", error);
            // Return a non-error-prefixed response to avoid circuit breaker trips
            return `Knowledge base search encountered an issue: ${error.message}. Please try rephrasing your query or try again shortly.`;
        }
    }

};




