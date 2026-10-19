import { z } from "zod";
import type { ToolDefinition, ToolContext } from "./types.js";

// Helper function to extract text from MCP response format
function extractMcpText(mcpResult: any): string {
    if (mcpResult?.content && Array.isArray(mcpResult.content)) {
        const textContent = mcpResult.content.find((c: any) => c.type === "text");
        if (textContent?.text) {
            return textContent.text;
        }
    }
    return JSON.stringify(mcpResult, null, 2);
}

export const PLATFORM_STRUCTURE_TOOLS: Record<string, ToolDefinition> = {
    search_platform_nodes: {
        name: "search_platform_nodes",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "Search Platform Entities",
        group: "System Architecture",
        description: "Search for technical entities within the Oddjob platform (services, UI components, API routes, database schemas). Use this to find where a specific feature is located in the code.",
        parameters: z.object({
            query: z.string().describe("Search term (e.g., 'SaaS', 'Connector', 'Auth')"),
            label: z.string().optional().describe("Optional: Filter by node type (Service, Route, UIComponent, Schema)"),
            limit: z.number().optional().default(10),
        }),
        execute: async (params: any, context: ToolContext) => {
            const { handleSearchPlatformNodes } = await import("../../../../mcp/handlers.js");
            const result = await handleSearchPlatformNodes(params, context);
            return extractMcpText(result);
        }
    },
    query_platform_structure: {
        name: "query_platform_structure",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "Query Platform Structure",
        group: "System Architecture",
        description: "Explore relationship paths between technical entities (e.g., 'How do I navigate to the SaaS Connector screen?').",
        parameters: z.object({}).passthrough().describe("Structured VisualQuery object for relationship traversal"),
        execute: async (params: any, context: ToolContext) => {
            const { handleQueryPlatformStructure } = await import("../../../../mcp/handlers.js");
            const result = await handleQueryPlatformStructure(params, context);
            return extractMcpText(result);
        }
    }
};


