import { z } from "zod";
import type { ToolDefinition } from "./types.js";
import { xrayCompositionService } from "../../../xray/core/xray-composition.service.js";
import { db } from "@server/database_service.js";
import { xrayNodeDocumentation } from "@shared/schema/index.js";
import { and, eq, ilike, or, desc } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { requireToolOrgId } from "./org-context.js";

const logger = createLogger("XRayTools");

/** Cap on returned spec text. rescue-dispatch alone is 136KB. */
const MAX_SPEC_CHARS = 12000;

export const XRAY_TOOLS: Record<string, ToolDefinition> = {
    list_xray_specs: {
        name: "list_xray_specs",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "List X-Ray Specs",
        group: "Documentation",
        description:
            "List the architecture specs documented for this organization's X-Ray nodes — the authoritative written documentation for apps, scopes and screens. " +
            "Returns node ids and summaries, not full text. Call this first when you do not know which spec you need, then read one with get_xray_spec.",
        parameters: z.object({
            nodeType: z.string().optional().describe("Optionally filter by node type (e.g. 'app_architecture', 'screen')."),
        }),
        execute: async (params, context) => {
            const orgId = context?.organizationId;
            if (!orgId) return "Cannot list X-Ray specs without organization context.";

            try {
                const rows = await db
                    .select({
                        nodeId: xrayNodeDocumentation.nodeId,
                        nodeType: xrayNodeDocumentation.nodeType,
                        summary: xrayNodeDocumentation.summary,
                        status: xrayNodeDocumentation.status,
                        updatedAt: xrayNodeDocumentation.updatedAt,
                    })
                    .from(xrayNodeDocumentation)
                    .where(
                        params.nodeType
                            ? and(eq(xrayNodeDocumentation.organizationId, orgId), eq(xrayNodeDocumentation.nodeType, params.nodeType))
                            : eq(xrayNodeDocumentation.organizationId, orgId),
                    )
                    .orderBy(desc(xrayNodeDocumentation.updatedAt))
                    .limit(100);

                if (rows.length === 0) {
                    return params.nodeType
                        ? `No X-Ray specs of type '${params.nodeType}' are documented for this organization.`
                        : "No X-Ray specs are documented for this organization.";
                }

                return JSON.stringify(
                    {
                        count: rows.length,
                        specs: rows.map((r) => ({
                            nodeId: r.nodeId,
                            nodeType: r.nodeType,
                            summary: r.summary || null,
                            status: r.status,
                            updatedAt: r.updatedAt,
                        })),
                    },
                    null,
                    2,
                );
            } catch (err: any) {
                return `Failed to list X-Ray specs: ${err.message}`;
            }
        },
    },

    get_xray_spec: {
        name: "get_xray_spec",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "Get X-Ray Spec",
        group: "Documentation",
        description:
            "Read the full architecture spec written for a specific X-Ray node — the authoritative documentation for how an app, scope or screen is built. " +
            "This is an EXACT lookup by node id or name, not a similarity search: it returns that node's spec or tells you plainly that none exists. " +
            "Prefer it over search_unified_knowledge when you already know which component you are asking about.",
        parameters: z.object({
            node: z.string().describe("Node id (e.g. 'scope::rescue-dispatch') or just its name (e.g. 'rescue-dispatch')."),
            offset: z.number().optional().describe("Character offset, for reading a long spec in successive calls."),
        }),
        execute: async (params, context) => {
            const orgId = context?.organizationId;
            if (!orgId) return "Cannot read an X-Ray spec without organization context.";

            const needle = String(params.node ?? "").trim();
            if (!needle) return "Provide a node id or name to look up.";

            try {
                // Exact id first, then a name match against the label half of the
                // id. A keyed lookup either finds the node or does not — unlike a
                // vector search, which always returns its nearest neighbour and
                // presents it as an answer.
                const rows = await db
                    .select()
                    .from(xrayNodeDocumentation)
                    .where(
                        and(
                            eq(xrayNodeDocumentation.organizationId, orgId),
                            or(
                                eq(xrayNodeDocumentation.nodeId, needle),
                                ilike(xrayNodeDocumentation.nodeId, `%::${needle}`),
                                ilike(xrayNodeDocumentation.nodeId, `%${needle}%`),
                            ),
                        ),
                    )
                    .orderBy(desc(xrayNodeDocumentation.updatedAt))
                    .limit(5);

                if (rows.length === 0) {
                    return `No X-Ray spec is documented for '${needle}'. Call list_xray_specs to see which nodes have specs — do not infer the architecture from the node's name.`;
                }

                const exact = rows.find((r) => r.nodeId === needle) ?? rows[0];
                const offset = Math.max(0, Number(params.offset ?? 0));
                const body = exact.content ?? "";
                const slice = body.slice(offset, offset + MAX_SPEC_CHARS);
                const truncated = offset + MAX_SPEC_CHARS < body.length;

                logger.info(`[XRayTools] Served spec ${exact.nodeId} (${body.length} chars, offset ${offset})`);

                const alternatives = rows.filter((r) => r.id !== exact.id).map((r) => r.nodeId);

                return [
                    `# X-Ray Spec: ${exact.nodeId} (${exact.nodeType})`,
                    exact.summary ? `\n${exact.summary}` : "",
                    `\nStatus: ${exact.status} · updated ${exact.updatedAt?.toISOString?.() ?? exact.updatedAt}`,
                    alternatives.length > 0 ? `\nOther nodes also matched: ${alternatives.join(", ")}` : "",
                    `\n---\n`,
                    slice,
                    truncated
                        ? `\n\n[Truncated at ${offset + MAX_SPEC_CHARS} of ${body.length} characters. Call again with offset=${offset + MAX_SPEC_CHARS} for more.]`
                        : "",
                ].join("");
            } catch (err: any) {
                return `Failed to read X-Ray spec for '${needle}': ${err.message}`;
            }
        },
    },

    execute_visual_query: {
        name: "execute_visual_query",

        idempotency: "read-safe",
        label: "Execute Visual Query (X-Ray)",
        description: "Queries the Oddjob System X-Ray graph to discover nodes (pipelines, agents, datasets, missions, apps, etc.) and their structural relationships (TRIGGERS, WRITES_TO, READS_FROM, BELONGS_TO). Essential for understanding cross-domain platform topology.",
        parameters: z.object({
            scope: z.string().optional().describe("Scope of the graph to query. Use 'oddjob' for global platform entities, or a forged app slug. Defaults to 'oddjob'."),
            filterType: z.string().optional().describe("Optionally filter by node type (e.g. 'dataset', 'job_definition', 'pipeline', 'mission')."),
        }),
        execute: async (params, context) => {
            try {
                const scope = params.scope || "oddjob";
                const orgId = requireToolOrgId(context); 
                
                logger.info(`[XRayTools] Copilot querying X-Ray graph for scope: ${scope}`);
                const graph = await xrayCompositionService.buildGraph(scope, orgId);
                
                // If a filter type is provided, attempt to prune nodes to reduce LLM context load
                if (params.filterType && graph.nodes) {
                    const typeFilter = params.filterType.toLowerCase();
                    const filteredNodes = graph.nodes.filter((n: any) => n.type === typeFilter);
                    const filteredNodeIds = new Set(filteredNodes.map((n: any) => n.id));
                    
                    // Keep edges where at least ONE endpoint connects to a filtered node
                    const filteredEdges = (graph.edges || []).filter((e: any) => 
                        filteredNodeIds.has(e.source) || filteredNodeIds.has(e.target)
                    );
                    
                    const lightFilteredNodes = filteredNodes.slice(0, 50).map((n: any) => ({
                        id: n.id,
                        type: n.type,
                        label: n.label || n.data?.name || n.id
                    }));

                    const lightFilteredEdges = filteredEdges.slice(0, 50).map((e: any) => ({
                        source: e.source,
                        target: e.target,
                        type: e.type || e.label
                    }));

                    return {
                        message: `Successfully retrieved filtered X-Ray Graph (scope: ${scope}, type: ${typeFilter})`,
                        data: {
                            summary: `Found ${filteredNodes.length} ${typeFilter} nodes and ${filteredEdges.length} related edges. (Truncated to 50 nodes/edges for context limits)`,
                            nodes: lightFilteredNodes,
                            edges: lightFilteredEdges
                        }
                    };
                }

                // If graph is massively large, just return a top-level summary to prevent context blowouts, 
                // but usually for a workspace it's fine.
                const nodeCount = graph.nodes?.length || 0;
                const edgeCount = graph.edges?.length || 0;

                // Strip heavy payload data to prevent LLM context limit blowouts
                const lightNodes = (graph.nodes || []).slice(0, 50).map((n: any) => ({
                    id: n.id,
                    type: n.type,
                    label: n.label || n.data?.name || n.id
                }));

                const lightEdges = (graph.edges || []).slice(0, 50).map((e: any) => ({
                    source: e.source,
                    target: e.target,
                    type: e.type || e.label
                }));

                return {
                    message: `Successfully retrieved X-Ray Graph (scope: ${scope})`,
                    data: {
                        summary: `Graph contains ${nodeCount} nodes and ${edgeCount} edges. (Truncated to 50 nodes/edges for context limits)`,
                        nodes: lightNodes,
                        edges: lightEdges
                    }
                };
            } catch (err: any) {
                return {
                    error: true,
                    message: `Failed to execute visual query: ${err.message}`
                };
            }
        }
    }
};
