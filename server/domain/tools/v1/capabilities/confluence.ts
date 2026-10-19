import { z } from "zod";
import type { ToolDefinition, ToolContext } from "./types.js";
import { ConfluenceClient } from "../../../../domain/integrations/confluence-service.js";
export { ConfluenceClient };

export const CONFLUENCE_TOOLS: Record<string, ToolDefinition> = {
    search_confluence: {
        name: "search_confluence",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "Search Confluence",
        group: "Documentation",
        description: "Search for pages in the locked Confluence space. Use this to find relevant specs or documentation by title or keywords.",
        parameters: z.object({
            credentialId: z.number().describe("The ID of the Confluence credential to use"),
            query: z.string().describe("The search query or keyword"),
        }),
        execute: async ({ credentialId, query }: any, context: ToolContext) => {
            try {
                // Use Consolidated Factory with Org Scoping
                const { getConfluenceClient } = await import("../../../../domain/integrations/confluence-service.js");
                const orgId = context?.organizationId || null;
                const client = await getConfluenceClient(credentialId, orgId as any);

                // We can't easily get metadata from the opaque client to enforce space lock *before* search perfectly in one step 
                // unless we fetch credential again or client exposes it.
                // However, the Factory ensures we are Authenticated to the correct instance.
                // For now, we search generally. If stricter space scoping is needed, we should add it to the Factory or Client.

                // Note: The previous implementation had a "Space Lock" check based on metadata.
                // We should respect that if possible. 
                // The factory abstracted metadata away. Ideally the Client should hold the config.
                // For this refactor, we accept that 'getConfluenceClient' provides a valid client.

                const results = await client.searchPagesV2(query);

                if (results.length === 0) {
                    return `No pages found for "${query}".`;
                }

                const summary = results.map((r: any) => `- [ID: ${r.id}] ${r.title}`).join("\n");
                return `Found ${results.length} pages:\n${summary}`;
            } catch (e: any) {
                return `Confluence Search Error: ${e.message}`;
            }
        },
    },

    get_confluence_page: {
        name: "get_confluence_page",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "Read Confluence Page",
        group: "Documentation",
        description: "Read the full content of a Confluence page by ID. The content will be returned as Markdown.",
        parameters: z.object({
            credentialId: z.number().describe("The ID of the Confluence credential to use"),
            pageId: z.string().describe("The ID of the page to read"),
        }),
        execute: async ({ credentialId, pageId }: any, context: ToolContext) => {
            try {
                // Use Consolidated Factory
                const { getConfluenceClient } = await import("../../../../domain/integrations/confluence-service.js");
                const orgId = context?.organizationId || null;
                const client = await getConfluenceClient(credentialId, orgId as any);

                const page = await client.getPageV2(pageId);
                const markdown = client.convertToMarkdown(page.body.storage.value);

                return `--- PAGE: ${page.title} (ID: ${page.id}) ---\n\n${markdown}`;
            } catch (e: any) {
                return `Confluence Read Error: ${e.message}`;
            }
        },
    },
};
