// @ts-nocheck

import { queryBuilderService } from "@domain/knowledge/core/query-builder.service.js";
import { VisualQuerySchema } from "../tools/query-builder.js";
import { successResponse, errorResponse, type ToolContext } from "./utils.js";
import { cacheService } from "@domain/core/cache-service.js";
import { db } from "../../database_service.js";
import { orgs } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import crypto from "crypto";
import { graphService } from "../../domain/knowledge/index.js";
import { z } from "zod";

const SearchPlatformNodesSchema = z.object({
    query: z.string(),
    label: z.string().optional(),
    limit: z.number().default(20)
});

export async function handleQueryPlatformStructure(args: unknown, context?: ToolContext) {
    try {
        console.log("[MCP] handleQueryPlatformStructure CALLED with args:", JSON.stringify(args));
        const input = VisualQuerySchema.parse(args);
        console.log("[MCP] handleQueryPlatformStructure parsed successfully");

        const [systemOrg] = await db.select().from(orgs).where(eq(orgs.name, "Oddjob System")).limit(1);
        if (!systemOrg) {
            throw new Error("System Organization not found");
        }

        const orgContext = { organizationId: systemOrg.id, userId: "oddjob-system" };
        const queryHash = crypto.createHash("md5").update(JSON.stringify(input)).digest("hex");
        const cacheKey = `platform:structure:query:${queryHash}`;

        const results = await cacheService.getOrFetch(
            cacheKey,
            async () => {
                console.log("[MCP] handleQueryPlatformStructure cache MISS");
                return await queryBuilderService.executeQuery(input as any, orgContext as any);
            },
            { ttl: 3600, tags: ["knowledge"] }
        );

        return successResponse(
            {
                nodes: results.nodes.map(n => ({
                    id: n.id,
                    name: n.name,
                    type: n.label,
                    properties: n.data,
                })),
                relationships: results.edges.map(e => ({
                    id: e.id,
                    source: e.sourceId,
                    target: e.targetId,
                    type: e.relation,
                })),
                executionTimeMs: results.executionTimeMs,
                source: "redis-cache"
            },
            `Query executed successfully. Found ${results.nodes.length} nodes and ${results.edges.length} relationships.`
        );
    } catch (error: any) {
        console.error(`[MCP: query_platform_structure] Error:`, error);
        return errorResponse(error.message);
    }
}

export async function handleSearchPlatformNodes(args: unknown, context?: ToolContext) {
    try {
        console.log("[MCP] handleSearchPlatformNodes CALLED with args:", JSON.stringify(args));
        const input = SearchPlatformNodesSchema.parse(args);
        console.log("[MCP] handleSearchPlatformNodes parsed successfully:", JSON.stringify(input));

        const [systemOrg] = await db.select().from(orgs).where(eq(orgs.name, "Oddjob System")).limit(1);
        if (!systemOrg) {
            console.error("[MCP] System Org NOT FOUND");
            throw new Error("System Organization not found");
        }
        console.log("[MCP] Found System Org ID:", systemOrg.id);

        const orgContext = { organizationId: systemOrg.id, userId: "oddjob-system" };

        console.log("[MCP] Calling graphService.searchNodes...");
        let { nodes } = await graphService.searchNodes(orgContext, {
            query: input.query,
            label: input.label,
            limit: input.limit
        });
        console.log("[MCP] graphService.searchNodes returned", nodes.length, "nodes");

        // Fallback: If exact phrase yields 0 results, try splitting into keywords (OR logic)
        if (nodes.length === 0 && input.query.trim().split(/\s+/).length > 1) {
            console.log("[MCP] Exact match failed. Falling back to keyword search...");
            const keywords = input.query.trim().split(/\s+/).filter(k => k.length > 2); // Ignore short words

            if (keywords.length > 0) {
                const keywordResults = await Promise.all(keywords.map(keyword =>
                    graphService.searchNodes(orgContext, {
                        query: keyword,
                        label: input.label,
                        limit: 20 // Increased limit to find buried nodes
                    })
                ));

                // Dedup results based on ID
                const seenIds = new Set<number>();
                for (const result of keywordResults) {
                    for (const node of result.nodes) {
                        if (!seenIds.has(node.id)) {
                            seenIds.add(node.id);
                            nodes.push(node);
                        }
                    }
                }
                console.log("[MCP] Keyword search found", nodes.length, "unique nodes");
            }
        }

        return successResponse(
            {
                nodes: nodes.map(n => ({
                    id: n.id,
                    name: n.name,
                    type: n.label,
                    properties: n.data,
                }))
            },
            `Found ${nodes.length} technical entities matching "${input.query}" (or keywords).`
        );
    } catch (error: any) {
        console.error(`[MCP: search_platform_nodes] Error:`, error);
        return errorResponse(error.message);
    }
}

