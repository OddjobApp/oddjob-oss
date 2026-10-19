import { z } from "zod";
import type { ToolDefinition, ToolContext } from "./types.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("QueryTools");

/**
 * Saved queries as something an agent can run.
 *
 * A saved query was previously reachable only from the Query Builder page: no
 * agent tool could list or execute one, and the single outbound path from a
 * result set turned it into LLM fine-tuning examples. So a query could be
 * built and named by a person and then be invisible to every agent and every
 * document in the platform.
 *
 * These two tools close that. Results come back in the `render_table` shape, so
 * the room renders them as a table rather than the model retyping rows into
 * prose — and the same result set can be handed to a document generator as
 * markdown.
 */

/** Queries are org-scoped; an agent turn without an org must not read any. */
function orgContextFrom(context: ToolContext) {
    const organizationId = context?.organizationId != null ? Number(context.organizationId) : null;
    return {
        userId: String(context?.userId ?? "agent"),
        organizationId,
        isAdmin: !!(context as any)?.isAdmin,
        isSuperAdmin: !!(context as any)?.isSuperAdmin,
        isOrgAdmin: !!(context as any)?.isOrgAdmin,
    };
}

export const QUERY_TOOLS: Record<string, ToolDefinition> = {
    list_saved_queries: {
        name: "list_saved_queries",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "List Saved Queries",
        group: "Knowledge",
        riskLevel: "low",
        description:
            "Lists the saved knowledge-graph queries available to this organization, with their names and descriptions. " +
            "Call this before run_saved_query so you use a query that exists rather than guessing a name.",
        parameters: z.object({}),
        execute: async (_args, context: ToolContext) => {
            try {
                const { queryAssemblyService } = await import("@domain/knowledge/core/query-assembly.service.js");
                const queries = await queryAssemblyService.list(orgContextFrom(context) as any);

                if (queries.length === 0) {
                    return JSON.stringify({
                        success: true,
                        count: 0,
                        queries: [],
                        message:
                            "This organization has no saved queries yet. They are created in the Query Builder at /knowledge/query-builder.",
                    });
                }

                return JSON.stringify({
                    success: true,
                    count: queries.length,
                    queries,
                    message: `${queries.length} saved quer${queries.length === 1 ? "y" : "ies"}: ${queries.map((q) => q.name).join(", ")}.`,
                });
            } catch (err: any) {
                logger.error(`list_saved_queries failed: ${err.message}`);
                return `Could not list saved queries: ${err.message}`;
            }
        },
    },

    run_saved_query: {
        name: "run_saved_query",
        idempotency: "read-safe",
        label: "Run Saved Query",
        group: "Knowledge",
        riskLevel: "low",
        description:
            "Runs a saved knowledge-graph query by name or id and renders the results as a table. " +
            "Use this whenever asked about data a saved query covers, instead of describing what the query would return. " +
            "The table is displayed to the user automatically — do not repeat its rows in your reply.",
        parameters: z.object({
            query: z
                .union([z.string(), z.number()])
                .describe("Saved query name (exact or partial) or numeric id, from list_saved_queries."),
            title: z.string().optional().describe("Optional heading for the rendered table; defaults to the query name."),
        }),
        execute: async (params, context: ToolContext) => {
            try {
                const { queryAssemblyService } = await import("@domain/knowledge/core/query-assembly.service.js");
                const orgContext = orgContextFrom(context);

                if (orgContext.organizationId == null) {
                    return "Cannot run a saved query without an organization in context.";
                }

                const resultSet = await queryAssemblyService.run(params.query as any, orgContext as any);

                if (resultSet.rows.length === 0) {
                    // No artifact for an empty result: a table with headers and
                    // no rows reads as a rendering failure rather than an answer.
                    return JSON.stringify({
                        success: true,
                        queryName: resultSet.name,
                        rowCount: 0,
                        message: `"${resultSet.name}" ran successfully and matched nothing.`,
                    });
                }

                // The `assistant_table` envelope the Rich-UI table tool emits,
                // so this renders through the path that already exists.
                return JSON.stringify({
                    type: "assistant_table",
                    title: params.title || resultSet.name,
                    description: resultSet.truncated
                        ? `${resultSet.rows.length} of ${resultSet.totalMatched} matched nodes`
                        : resultSet.description || `${resultSet.rows.length} row${resultSet.rows.length === 1 ? "" : "s"}`,
                    columns: resultSet.columns,
                    rows: resultSet.rows,
                    queryId: resultSet.queryId,
                    // Keep the executable graph declaration with the result so
                    // the Assembly Stack can show what produced a report. The
                    // generated Cypher preview is intentionally not used: the
                    // visual structure is what the query engine executes.
                    queryDefinition: resultSet.queryDefinition,
                    executionTimeMs: resultSet.executionTimeMs,
                    truncated: resultSet.truncated,
                    lineage: {
                        source: { type: "saved_query", id: resultSet.queryId, name: resultSet.name },
                        output: { type: "query_result", rowCount: resultSet.rows.length },
                    },
                });
            } catch (err: any) {
                logger.warn(`run_saved_query failed: ${err.message}`);
                return `Could not run that query: ${err.message}`;
            }
        },
    },
};
