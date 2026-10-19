
import { queryBuilderService } from "@domain/knowledge/core/query-builder.service.js";
import { VisualQuerySchema } from "../tools/query-builder.js";
import { successResponse, errorResponse, getOrgContext, type ToolContext } from "./utils.js";

export async function handleExecuteVisualQuery(args: unknown, context?: ToolContext) {
    try {
        const input = VisualQuerySchema.parse(args);
        const orgContext = getOrgContext(context);

        console.log(`[MCP: execute_visual_query] Org: ${orgContext.organizationId}, Nodes: ${input.nodes.length}, Rels: ${input.relationships.length}`);

        const results = await queryBuilderService.executeQuery(input as any, orgContext as any);

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
                executionTimeMs: results.executionTimeMs
            },
            `Query executed successfully. Found ${results.nodes.length} nodes and ${results.edges.length} relationships.`
        );
    } catch (error: any) {
        console.error(`[MCP: execute_visual_query] Error:`, error);
        return errorResponse(error.message);
    }
}

