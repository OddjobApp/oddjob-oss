import { z } from "zod";
import type { ToolDefinition, ToolContext } from "./types.js";
import { assertOrgId } from "@server/utils/auth-context.js";

/**
 * Dataset record access and ad-hoc aggregation for agents.
 *
 * Backs `dataset-analytics-tool.service.ts`, which shipped implemented but
 * unregistered — the crew persona prompt named these tools while nothing defined
 * them, so agents were told to call names that did not exist.
 *
 * `list_datasets` is NOT redefined here; it already lives in DATA_TOOLS.
 */

/**
 * ToolContext does not satisfy OrgContext — userId and the admin flags are
 * optional on one and required on the other — so build it explicitly rather than
 * spreading, and hard-fail without an org instead of widening the query.
 */
function toOrgContext(context: ToolContext) {
    return {
        organizationId: assertOrgId(context?.organizationId),
        userId: context?.userId || "system",
        isAdmin: !!context?.isAdmin,
        isSuperAdmin: !!context?.isSuperAdmin,
        isOrgAdmin: !!context?.isOrgAdmin,
    };
}

export const DATASET_ANALYTICS_TOOLS: Record<string, ToolDefinition> = {
    get_dataset_items: {
        name: "get_dataset_items",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "Get Dataset Records",
        group: "Datasets & External",
        description:
            "Retrieve rows from a dataset, optionally filtered on one field. Use to inspect actual records before computing anything over them.",
        parameters: z.object({
            datasetId: z.number().describe("Numeric dataset id, from list_datasets"),
            limit: z.number().optional().default(50).describe("Max rows to return (1-200)"),
            offset: z.number().optional().default(0),
            filterField: z.string().optional().describe("Field name to filter on"),
            filterValue: z.string().optional().describe("Exact value the field must equal (case-insensitive)"),
        }),
        execute: async (params: any, context: ToolContext) => {
            const { datasetAnalyticsTool } = await import("@domain/crew/core/dataset-analytics-tool.service.js");
            const limit = Math.min(Math.max(Number(params.limit) || 50, 1), 200);

            const { items, total } = await datasetAnalyticsTool.getDatasetItems(
                Number(params.datasetId),
                toOrgContext(context),
                {
                    limit,
                    offset: Math.max(Number(params.offset) || 0, 0),
                    filterField: params.filterField,
                    filterValue: params.filterValue,
                },
            );

            if (items.length === 0) {
                return `No records matched in dataset ${params.datasetId}. (${total} row(s) in the dataset before filtering.)`;
            }

            // Say what fraction was returned, so a partial page is never read as the whole set.
            const shown = `Showing ${items.length} of ${total} row(s) from dataset ${params.datasetId}.`;
            return `${shown}\n\n${JSON.stringify(items, null, 2)}`;
        },
    },

    calculate_dataset_metric: {
        name: "calculate_dataset_metric",
        idempotency: "read-safe",
        label: "Calculate Dataset Metric",
        group: "Datasets & External",
        description:
            "Compute an aggregate (avg, sum, median, min, max, count) over one numeric field of a dataset, with optional equality filters. Returns the value together with how many rows it covered — quote that scope, and never present a truncated result as the true figure.",
        parameters: z.object({
            datasetId: z.number().optional().describe("Numeric dataset id — prefer this over datasetName"),
            datasetName: z.string().optional().describe("Dataset name; resolved by fuzzy match if no id is given"),
            numericField: z.string().describe("Field to aggregate, e.g. 'resolution_hours'"),
            aggregation: z.enum(["avg", "sum", "median", "min", "max", "count", "summary"]),
            filters: z
                .array(z.object({ field: z.string(), value: z.union([z.string(), z.number(), z.boolean()]) }))
                .optional()
                .describe("Equality filters applied before aggregating"),
        }),
        execute: async (params: any, context: ToolContext) => {
            if (!params.datasetId && !params.datasetName) {
                return "Error: provide either datasetId or datasetName. Call list_datasets first to find one.";
            }

            // Resolve the org OUTSIDE the try: a missing organization is an
            // authorization failure and must propagate, not be flattened into a
            // string that reads like a computation problem.
            const orgContext = toOrgContext(context);

            const { datasetAnalyticsTool } = await import("@domain/crew/core/dataset-analytics-tool.service.js");
            try {
                const result = await datasetAnalyticsTool.calculateMetric(
                    {
                        datasetId: params.datasetId,
                        datasetName: params.datasetName,
                        numericField: params.numericField,
                        aggregation: params.aggregation,
                        filters: params.filters,
                    },
                    orgContext,
                );

                // summaryText already names the dataset that answered (which may differ
                // from the requested name after a fuzzy match) and flags truncation.
                return JSON.stringify(
                    {
                        dataset: { id: result.datasetId, name: result.datasetName },
                        metric: result.metric,
                        aggregation: result.aggregation,
                        value: result.value,
                        currency: result.currency,
                        matchedRecords: result.count,
                        rowsScanned: result.rowsScanned,
                        totalRows: result.totalRows,
                        truncated: result.truncated,
                        summary: result.summaryText,
                        sampleRows: result.sampleRows,
                    },
                    null,
                    2,
                );
            } catch (e: any) {
                // Surface the failure. Returning a plausible-looking zero here would be
                // read as a real measurement.
                return `Error computing metric: ${e?.message || String(e)}`;
            }
        },
    },
};
