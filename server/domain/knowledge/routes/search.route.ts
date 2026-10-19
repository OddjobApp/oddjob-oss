import { Router, type Request, type Response } from "express";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { getUserOrgContext } from "../../../utils/auth-context.js";
import { asyncHandler } from "../../../middleware/error-handler.js";
import { BadRequestError } from "@server/utils/errors.js";
import { createLogger } from "@server/utils/logger.js";
import { searchService } from "../core/search/search-service.js";
import { withProjectScope } from "../../../middleware/project-scope.js";

const router = Router();
const logger = createLogger("Search");

// UNIVERSAL SEARCH: AI-Powered Query Classification & Routing
// Project scope narrows retrieval to the active Project Space instead of searching
// org-wide (PROJECT_SPACES_DESIGN §6.4). `scope: "org"` in the body opts back out.
router.post("/universal", requireAuth, withProjectScope(), asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const { query, limit, before, after, updated_before, updated_after, scope } = req.body;
    const projectId = scope === "org" ? null : (req.projectId ?? null);

    if (!query || typeof query !== "string" || query.trim().length < 2) {
        throw new BadRequestError("Query must be at least 2 characters");
    }

    const cleanQuery = query.trim();

    // Step 1: Classify the query using AI or heuristics
    const classification = await searchService.classifySearchQuery(cleanQuery);

    // Step 2: Execute appropriate search based on classification
    const searchResults = await searchService.executeUnifiedSearch(
        cleanQuery,
        classification.queryType,
        orgContext.organizationId,
        {
            limit: limit || 10,
            before,
            after,
            updated_before,
            updated_after,
            projectId
        }
    );

    // Step 3: If graph query, also get graph data for visualization
    let graphData = undefined;
    if (classification.queryType === "graph" && orgContext.organizationId) {
        try {
            const { semanticGraphQuery } = await import("../../../knowledge/knowledge-graph-service.js");
            const graphResult = await semanticGraphQuery(cleanQuery, orgContext.organizationId);
            if (graphResult.nodes.length > 0) {
                graphData = {
                    nodes: graphResult.nodes.slice(0, 20).map((n: any) => ({
                        id: n.id,
                        label: n.label,
                        name: n.name,
                    })),
                    edges: graphResult.edges.slice(0, 30).map((e: any) => ({
                        sourceId: e.sourceId,
                        targetId: e.targetId,
                        relation: e.relation,
                    })),
                };
            }
        } catch (graphErr) {
            logger.warn("[Universal Search] Graph query failed", { correlationId: req.correlationId }, graphErr);
        }
    }

    res.json({
        queryType: classification.queryType,
        confidence: classification.confidence,
        explanation: classification.explanation,
        searchResults,
        graphData,
    });
}));

// SEMANTIC SEARCH: Dedicated semantic/hybrid search endpoint
router.post("/semantic", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const { query, mode = "semantic", similarityThreshold = 0.7, maxResults = 10, before, after, updated_before, updated_after } = req.body;

    if (!query || typeof query !== "string" || query.trim().length < 2) {
        throw new BadRequestError("Query must be at least 2 characters");
    }

    const cleanQuery = query.trim();
    let searchResults;

    const searchOptions = {
        limit: maxResults,
        before,
        after,
        updated_before,
        updated_after
    };

    if (mode === "hybrid") {
        // Use hybrid search
        searchResults = await searchService.executeHybridSearch(
            cleanQuery,
            orgContext.organizationId,
            {
                similarityThreshold,
                maxResults,
                weights: { keyword: 0.3, vector: 0.5, graph: 0.2 },
                ...searchOptions
            }
        );
    } else if (mode === "semantic") {
        // Use vector search
        searchResults = await searchService.executeUnifiedSearch(
            cleanQuery,
            "vector",
            orgContext.organizationId,
            searchOptions
        );
    } else {
        // Use keyword search
        searchResults = await searchService.executeUnifiedSearch(
            cleanQuery,
            "keyword",
            orgContext.organizationId,
            searchOptions
        );
    }

    // Filter by similarity threshold if provided
    const filteredResults = searchResults.filter(
        (r: any) => (r.score || 0) >= similarityThreshold
    ).slice(0, maxResults);

    res.json({
        query: cleanQuery,
        mode,
        results: filteredResults,
        total: filteredResults.length
    });
}));

// FIND SIMILAR: Find items similar to a given item
router.post("/find-similar", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const { id, type, limit = 10, threshold = 0.7 } = req.body;

    if (!id || !type) {
        throw new BadRequestError("ID and type are required");
    }

    // For now, use the item's title/content as the search query
    // In a full implementation, we'd fetch the item's embedding and search by vector
    const searchResults = await searchService.executeUnifiedSearch(
        `similar to ${type} ${id}`,
        "vector",
        orgContext.organizationId
    );

    const filteredResults = searchResults
        .filter((r: any) => r.id !== id && (r.score || 0) >= threshold)
        .slice(0, limit);

    res.json({
        sourceId: id,
        sourceType: type,
        results: filteredResults,
        total: filteredResults.length
    });
}));

export default router;


