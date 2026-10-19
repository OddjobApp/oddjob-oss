import {
    SearchDocumentsInput,
    ListDocumentsInput,
    GetDocumentContentInput,
    SearchUnifiedInput,
} from "../tools/documents.js";
import { documentService } from "../../domain/knowledge/core/extraction/document-service.js";
import { db } from "@server/database_service.js";
import { and, eq, inArray } from "drizzle-orm";
import { searchService, type SearchResult } from "../../domain/knowledge/core/search/search-service.js";
import { successResponse, errorResponse, getOrgContext, type ToolContext } from "./utils.js";
import { hasResourcePermission } from "@shared/schema/index.js";

export async function handleSearchDocuments(args: unknown, context?: ToolContext) {
    try {
        const input = SearchDocumentsInput.parse(args);
        const orgContext = getOrgContext(context);

        const allDocuments = await documentService.listDocuments(orgContext, {
            limit: 500, // Fetch more docs to improve search accuracy
            topicIds: context?.allowedTopicIds || undefined
        });

        // Apply resource scoping filter (New)
        let documents = allDocuments;
        if (context?.resourceScoping) {
            documents = allDocuments.filter(d => 
                hasResourcePermission(context.permissions || [], "document:read", d.url || "", context.resourceScoping)
            );
        }

        if (documents.length > 0) {
            // console.log(`[handleSearchDocuments] Sample fetched doc: ${documents[0].title} (ID: ${documents[0].id})`);
        }

        const queryLower = input.query?.toLowerCase();
        if (!queryLower) {
            return successResponse(
                documents.slice(0, input.limit).map((d: any) => ({
                    id: d.id,
                    title: d.title,
                    content: d.textContent?.substring(0, 500) || "",
                    source: d.sourceType,
                })),
                `Found ${documents.length} documents`
            );
        }

        // Filter and score documents (Scored Fuzzy + Strict Bonus)
        const tokens = queryLower.split(/\s+/).filter(t => t.length > 0);

        // Add Stemming-Lite (e.g. specs => specifications)
        const expandedTokens = tokens.flatMap(t => {
            if (t === 'specs') return [t, 'specifications', 'requirement', 'requirements'];
            if (t === 'specifications') return [t, 'specs', 'requirement', 'requirements', 'documentation'];
            return [t];
        });

        let filtered = documents
            .map((d: any) => {
                const title = d.title?.toLowerCase() || "";
                // STRIP HTML for scoring and display (LLM friendly)
                const rawContent = d.textContent || "";
                const cleanContent = rawContent.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
                const content = cleanContent.toLowerCase();

                let score = 0;
                let matchesAll = true;

                tokens.forEach(token => {
                    const synonyms: Record<string, string[]> = {
                        'specs': ['specs', 'specifications', 'requirement', 'requirements'],
                        'specifications': ['specifications', 'specs', 'requirement', 'requirements', 'documentation'],
                        'documentation': ['documentation', 'manual', 'specs', 'specifications']
                    };
                    const variants = synonyms[token] || [token];

                    const inTitle = variants.some(v => title.includes(v));
                    const inContent = variants.some(v => content.includes(v));

                    if (inTitle) score += 10;
                    if (inContent) score += 2;

                    if (!inTitle && !inContent) {
                        matchesAll = false;
                    }
                });

                // Bonus for matching all tokens (Strict match / Satisfied Synonyms)
                if (matchesAll) score += 15;

                // Bonus for exact title matches
                if (input.query && title.includes(input.query.toLowerCase())) {
                    score += 30;
                }

                return {
                    ...d,
                    textContent: cleanContent, // Return cleaned content to Agent
                    _score: score
                };
            })
            .filter(d => d._score > 0)
            .sort((a, b) => b._score - a._score);

        const limitedResults = filtered.slice(0, input.limit);

        return successResponse(
            limitedResults.map((d: any) => ({
                id: d.id,
                title: d.title,
                content: d.textContent?.substring(0, 1000) || "", // Longer preview, cleaned of HTML
                source: d.sourceType,
                url: d.url || `/knowledge/documents/${d.id}`,
                score: d._score
            })),
            `Found ${filtered.length} documents matching "${input.query}"${filtered.length > input.limit ? ` (showing top ${input.limit})` : ''}`
        );
    } catch (error: any) {
        return errorResponse(`Document search failed: ${error.message}`);
    }
}

export async function handleListDocuments(args: unknown, context?: ToolContext) {
    try {
        const input = ListDocumentsInput.parse(args);
        const orgContext = getOrgContext(context);

        const documents = await documentService.listDocuments(orgContext, {
            limit: input.limit,
            topicIds: context?.allowedTopicIds || undefined
        });

        let filtered = documents;
        if (input.search) {
            const searchLower = input.search.toLowerCase();
            filtered = documents.filter((d: any) => d.title?.toLowerCase().includes(searchLower));
        }

        return successResponse(
            filtered.map((d: any) => ({
                id: d.id,
                title: d.title,
                url: d.url || `/knowledge/documents/${d.id}`, // Prefer direct URL column
                sourceType: d.sourceType,
                createdAt: d.createdAt,
            })),
            `Found ${filtered.length} documents`
        );
    } catch (error: any) {
        return errorResponse(error.message);
    }
}

export async function handleGetDocumentContent(args: unknown, context?: ToolContext) {
    try {
        const input = GetDocumentContentInput.parse(args);
        const orgContext = getOrgContext(context);

        const document = await documentService.getDocumentById(input.documentId, orgContext);

        // 1. Resource Scoping (New)
        if (context?.resourceScoping) {
            if (!hasResourcePermission(context.permissions || [], "document:read", document.url || "", context.resourceScoping)) {
                return errorResponse(`Access denied: document resource "${document.url}" is not in your allowed scoping rules.`);
            }
        }

        // 2. Legacy Topic Scoping
        if (context?.allowedTopicIds && context.allowedTopicIds.length > 0) {
            const { knowledgeTopicDocuments } = await import("@shared/schema/index.js");
            const relations = await db
                .select()
                .from(knowledgeTopicDocuments)
                .where(and(
                    eq(knowledgeTopicDocuments.documentId, document.id),
                    inArray(knowledgeTopicDocuments.topicId, context.allowedTopicIds)
                ));

            if (relations.length === 0) {
                return errorResponse("Access to this document is restricted (not in allowed topics)");
            }
        }

        return successResponse({
            id: document.id,
            title: document.title,
            sourceType: document.sourceType,
            url: document.url,
            content: document.textContent,
            metadata: document.metadata,
            createdAt: document.createdAt,
        });
    } catch (error: any) {
        return errorResponse(error.message);
    }
}

export async function handleSearchUnified(args: unknown, context?: ToolContext) {
    try {
        const input = SearchUnifiedInput.parse(args);
        const orgContext = getOrgContext(context);

        const results = await searchService.executeUnifiedSearch(input.query, "unknown", orgContext.organizationId);

        // Format for MCP
        let confluenceBaseUrl = "";
        try {
            if (orgContext.organizationId) {
                const { credentials } = await import("@shared/schema/index.js");
                const [cred] = await db.select().from(credentials).where(and(eq(credentials.organizationId, orgContext.organizationId), eq(credentials.type, 'confluence'))).limit(1);
                if (cred && cred.metadata) {
                    const m = cred.metadata as any;
                    confluenceBaseUrl = m.baseUrl || "";
                    if (confluenceBaseUrl.endsWith('/wiki')) {
                        confluenceBaseUrl = confluenceBaseUrl.replace(/\/wiki$/, '');
                    }
                }
            }
        } catch (e) {
            console.warn("[MCP Unified Search] Failed to get confluence base url fallback:", e);
        }

        const formatted = results.map((r: SearchResult) => {
            let rawUrl: string | undefined = r.url || (r.metadata as any)?.url;
            if (typeof rawUrl === 'string') {
                if (rawUrl.startsWith('undefined')) rawUrl = rawUrl.replace(/^undefined/, '');
                if (!rawUrl.startsWith('http') && confluenceBaseUrl) {
                    if (!rawUrl.startsWith('/')) rawUrl = '/' + rawUrl;
                    rawUrl = confluenceBaseUrl + rawUrl;
                }
            }
            
            return {
                id: r.id,
                type: r.type,
                title: r.title,
                snippet: r.description?.substring(0, 500) || "",
                score: r.score,
                source: r.type, // Map type to source for backend compat
                url: rawUrl,
                lastModified: (r.metadata as any)?.capturedAt || "Unknown",
                metadata: r.metadata
            };
        });

        return successResponse(
            formatted,
            `Found ${formatted.length} results across all sources for "${input.query}"`
        );

    } catch (error: any) {
        return errorResponse(`Unified search failed: ${error.message}`);
    }
}

