
import { db } from "../../../../database_service.js";
import { createLogger } from "../../../../utils/logger.js";
import { sql, eq, and, or, inArray, ne } from "drizzle-orm";
import { knowledgeNodes, knowledgeEdges, knowledgeTopics, datasetItems } from "@shared/schema/index.js";
import type { KnowledgeNode, KnowledgeEdge } from "@shared/schema/index.js";
import type { OrgContext } from "../../../../domain/jobs/job.service.js";
import { graphService } from "../graph/graph-service.js";
import { withQueryTracking } from "@domain/knowledge/core/query-monitor.service.js";

const logger = createLogger("ContextService");

export const contextService = {
    /**
     * Get graph context for a pipeline run
     */
    async getRunContext(runId: number, orgContext: OrgContext): Promise<{ nodes: KnowledgeNode[]; edges: KnowledgeEdge[] }> {
        return withQueryTracking("contextService.getRunContext", async () => {
            // 1. Get Edges created by this run and explicit nodes in parallel
            const [initialRunEdges, explicitRunNodes] = await Promise.all([
                db.select().from(knowledgeEdges).where(eq(knowledgeEdges.lastUpdatedByRunId, runId)),
                db.select({ id: knowledgeNodes.id }).from(knowledgeNodes).where(eq(knowledgeNodes.pipelineExecutionId, runId))
            ]);

            const nodeIds = new Set<number>();
            let runEdges = initialRunEdges;

            if (runEdges.length === 0 && explicitRunNodes.length > 0) {
                const ids = explicitRunNodes.map(n => n.id);
                runEdges = await db
                    .select()
                    .from(knowledgeEdges)
                    // @ts-ignore
                    .where(or(inArray(knowledgeEdges.sourceId, ids), inArray(knowledgeEdges.targetId, ids)));
            }

            if (runEdges.length === 0 && explicitRunNodes.length === 0) {
                return { nodes: [], edges: [] };
            }

            // 2. Identify Semantic Targets and history
            const targetIds = Array.from(new Set(runEdges.map(e => e.targetId)));
            let historyEdges: KnowledgeEdge[] = [];
            if (targetIds.length > 0) {
                // Ensure history edges are relevant to the organization if needed, though they are linked to targets which are likely in org
                historyEdges = await db.select().from(knowledgeEdges)
                    .where(and(
                        // @ts-ignore
                        inArray(knowledgeEdges.targetId, targetIds),
                        ne(knowledgeEdges.lastUpdatedByRunId, runId)
                    ))
                    .limit(500);
            }

            const allEdges = [...runEdges, ...historyEdges];
            allEdges.forEach(e => { nodeIds.add(e.sourceId); nodeIds.add(e.targetId); });
            explicitRunNodes.forEach(n => nodeIds.add(n.id));

            if (nodeIds.size === 0) return { nodes: [], edges: [] };

            const nodes = await db.select().from(knowledgeNodes).where(inArray(knowledgeNodes.id, Array.from(nodeIds)));
            return { nodes, edges: allEdges };
        }, { table: "knowledge_edges", operation: "select" });
    },

    /**
     * Get graph context for a dataset
     */
    async getDatasetContext(datasetId: number, orgContext: OrgContext): Promise<{ nodes: KnowledgeNode[]; edges: KnowledgeEdge[] }> {
        return withQueryTracking("contextService.getDatasetContext", async () => {
            // 1. Find Pipeline Execution IDs linked to this Dataset
            const items = await db
                .selectDistinct({ pipelineExecutionId: datasetItems.pipelineExecutionId })
                .from(datasetItems)
                .where(eq(datasetItems.datasetId, datasetId));

            const executionIds = items
                .map(i => i.pipelineExecutionId)
                .filter((id): id is number => id !== null);

            if (executionIds.length === 0) {
                return { nodes: [], edges: [] };
            }

            // 2. Get Edges created by these runs
            const runEdges = await db
                .select()
                .from(knowledgeEdges)
                .where(inArray(knowledgeEdges.lastUpdatedByRunId, executionIds));

            const nodeIds = new Set<number>();

            // 3. Get Nodes directly linked to these runs
            const explicitRunNodes = await db
                .select({ id: knowledgeNodes.id })
                .from(knowledgeNodes)
                .where(inArray(knowledgeNodes.pipelineExecutionId, executionIds));

            if (runEdges.length === 0 && explicitRunNodes.length === 0) {
                return { nodes: [], edges: [] };
            }

            // 4. Identify Semantic Targets (History) within context
            const targetIds = Array.from(new Set(runEdges.map(e => e.targetId)));
            const sourceIds = Array.from(new Set(runEdges.map(e => e.sourceId)));

            explicitRunNodes.forEach(n => nodeIds.add(n.id));
            sourceIds.forEach(id => nodeIds.add(id));
            targetIds.forEach(id => nodeIds.add(id));

            if (nodeIds.size === 0) return { nodes: [], edges: [] };

            const nodes = await db
                .select()
                .from(knowledgeNodes)
                .where(inArray(knowledgeNodes.id, Array.from(nodeIds)));

            return { nodes, edges: runEdges };
        }, { table: "knowledge_edges", operation: "select" });
    },

    /**
     * Compare Pipeline Runs (Forensics)
     */
    async comparePipelineRuns(
        orgContext: OrgContext,
        pipelineIds: number[],
        baselineWindow: { start_time: string; end_time: string },
        comparisonWindow: { start_time: string; end_time: string }
    ) {
        return withQueryTracking("contextService.comparePipelineRuns", async () => {
            const getExecutions = async (pIds: number[], start: Date, end: Date) => {
                const { pipelineExecutions } = await import("@shared/schema/index.js");
                if (pIds.length === 0) return [];
                return await db
                    .select()
                    .from(pipelineExecutions)
                    .where(and(
                        inArray(pipelineExecutions.pipelineId, pIds),
                        sql`${pipelineExecutions.startedAt} >= ${start}`,
                        sql`${pipelineExecutions.startedAt} <= ${end}`,
                        eq(pipelineExecutions.status, "completed")
                    ))
                    .orderBy(pipelineExecutions.startedAt);
            };

            const [baselineExecutions, comparisonExecutions] = await Promise.all([
                getExecutions(
                    pipelineIds,
                    new Date(baselineWindow.start_time),
                    new Date(baselineWindow.end_time)
                ),
                getExecutions(
                    pipelineIds,
                    new Date(comparisonWindow.start_time),
                    new Date(comparisonWindow.end_time)
                )
            ]);

            const [baselineNodes, comparisonNodes] = await Promise.all([
                graphService.getNodesByExecutionIds(baselineExecutions.map((e: any) => e.id), orgContext),
                graphService.getNodesByExecutionIds(comparisonExecutions.map((e: any) => e.id), orgContext)
            ]);

            return {
                baselineResults: {
                    executionCount: baselineExecutions.length,
                    nodeCount: baselineNodes.length,
                    executions: baselineExecutions.map((e: any) => ({ id: e.id, startedAt: e.startedAt, status: e.status })),
                    nodes: baselineNodes
                },
                comparisonResults: {
                    executionCount: comparisonExecutions.length,
                    nodeCount: comparisonNodes.length,
                    executions: comparisonExecutions.map((e: any) => ({ id: e.id, startedAt: e.startedAt, status: e.status })),
                    nodes: comparisonNodes
                }
            };
        }, { table: "pipeline_executions", operation: "select" });
    },

    /**
     * Find shortest path between two nodes (BFS)
     */
    async findPath(sourceId: number, targetId: number, orgContext: OrgContext): Promise<{ nodes: KnowledgeNode[]; edges: KnowledgeEdge[] }> {
        return withQueryTracking("contextService.findPath", async () => {
            if (sourceId === targetId) {
                const node = await graphService.getNodeById(sourceId, orgContext);
                return { nodes: [node], edges: [] };
            }

            const queue: number[] = [sourceId];
            const visited = new Map<number, { parentId: number, edgeId: number } | null>();
            visited.set(sourceId, null);

            let reached = false;
            while (queue.length > 0 && !reached) {
                const currentId = queue.shift()!;
                if (currentId === targetId) {
                    reached = true;
                    break;
                }

                const edges = await graphService.getNodeEdges(currentId, orgContext, "both");
                for (const edge of edges) {
                    const neighborId = edge.sourceId === currentId ? edge.targetId : edge.sourceId;
                    if (!visited.has(neighborId)) {
                        visited.set(neighborId, { parentId: currentId, edgeId: edge.id });
                        queue.push(neighborId);
                        if (neighborId === targetId) {
                            reached = true;
                            break;
                        }
                    }
                }
            }

            if (!reached) return { nodes: [], edges: [] };

            // Reconstruct path
            const pathNodes: KnowledgeNode[] = [];
            const pathEdges: KnowledgeEdge[] = [];
            let curr = targetId;

            while (curr !== sourceId) {
                const info = visited.get(curr)!;
                pathNodes.push(await graphService.getNodeById(curr, orgContext));
                const edge = await graphService.getEdgeById(info.edgeId, orgContext);
                if (edge) pathEdges.push(edge);
                curr = info.parentId;
            }
            pathNodes.push(await graphService.getNodeById(sourceId, orgContext));

            return { nodes: pathNodes.reverse(), edges: pathEdges.reverse() };
        }, { table: "knowledge_edges", operation: "select" });
    },

    /**
     * Compare two pipeline executions to find added, removed, and changed nodes/edges.
     */
    async compareExecutions(baselineRunId: number, candidateRunId: number, orgContext: OrgContext) {
        return withQueryTracking("contextService.compareExecutions", async () => {
            const [baseline, candidate] = await Promise.all([
                this.getRunContext(baselineRunId, orgContext),
                this.getRunContext(candidateRunId, orgContext)
            ]);

            // Helper to generate unique key for logical entity comparison
            const getNodeKey = (n: KnowledgeNode) => n.externalId || `${n.label}:${n.name}`;

            const baselineMap = new Map<string, KnowledgeNode>();
            baseline.nodes.forEach(n => baselineMap.set(getNodeKey(n), n));

            const added: KnowledgeNode[] = [];
            const removed: KnowledgeNode[] = [];
            const changed: { from: KnowledgeNode, to: KnowledgeNode }[] = [];
            const unchanged: KnowledgeNode[] = [];

            // 1. Compare Nodes
            for (const node of candidate.nodes) {
                const key = getNodeKey(node);
                const baseNode = baselineMap.get(key);

                if (!baseNode) {
                    added.push(node);
                } else {
                    // Check for changes (simplified)
                    // If content changed or different fingerprint
                    if (JSON.stringify(node.data) !== JSON.stringify(baseNode.data)) {
                        changed.push({ from: baseNode, to: node });
                    } else {
                        unchanged.push(node);
                    }
                    baselineMap.delete(key);
                }
            }

            // Remaining in baseline are removed
            for (const node of baselineMap.values()) {
                removed.push(node);
            }

            return {
                added,
                removed,
                changed,
                unchanged,
                baselineCount: baseline.nodes.length,
                candidateCount: candidate.nodes.length
            };
        }, { table: "knowledge_nodes", operation: "select" });
    },

    /**
     * Get distinct Agent Sessions from AgentReasoning nodes
     */
    async getAgentSessions(orgContext: OrgContext, limit = 50) {
        return withQueryTracking("contextService.getAgentSessions", async () => {
            // Distinct session IDs from AgentReasoning nodes
            // We use a raw query or smart group by to get latest timestamp per session
            const result = await db.execute(sql`
                SELECT 
                    data->>'sessionId' as "sessionId",
                    MAX(created_at) as "lastActive",
                    COUNT(*) as "stepCount"
                FROM knowledge_nodes
                WHERE label = 'AgentReasoning'
                AND organization_id = ${orgContext.organizationId}
                GROUP BY data->>'sessionId'
                ORDER BY "lastActive" DESC
                LIMIT ${limit}
            `);

            return result.rows.map((row: any) => ({
                sessionId: row.sessionId,
                lastActive: row.lastActive,
                stepCount: row.stepCount
            }));
        }, { table: "knowledge_nodes", operation: "select" });
    },

    /**
     * Get full trace for an Agent Session
     */
    async getAgentTrace(sessionId: string, orgContext: OrgContext) {
        return withQueryTracking("contextService.getAgentTrace", async () => {
            // Get all reasoning nodes for this session
            const nodes = await db
                .select()
                .from(knowledgeNodes)
                .where(and(
                    eq(knowledgeNodes.label, 'AgentReasoning'),
                    sql`data->>'sessionId' = ${sessionId}`,
                    eq(knowledgeNodes.organizationId, orgContext.organizationId as number)
                ))
                .orderBy(knowledgeNodes.createdAt);

            if (nodes.length === 0) return { nodes: [], edges: [] };

            const nodeIds = nodes.map(n => n.id);
            if (nodeIds.length === 0) return { nodes, edges: [] };

            // Get edges describing the flow (FOLLOWED_BY)
            // CHUNK nodeIds to avoid PostgreSQL ROW expressions limit (1664)
            const CHUNK_SIZE = 1000;
            const edges: KnowledgeEdge[] = [];

            for (let i = 0; i < nodeIds.length; i += CHUNK_SIZE) {
                const chunk = nodeIds.slice(i, i + CHUNK_SIZE);
                const chunkEdges = await db
                    .select()
                    .from(knowledgeEdges)
                    .where(and(
                        eq(knowledgeEdges.relation, 'FOLLOWED_BY'),
                        or(
                            inArray(knowledgeEdges.sourceId, chunk),
                            inArray(knowledgeEdges.targetId, chunk)
                        )
                    ));
                edges.push(...chunkEdges);
            }

            // Deduplicate edges just in case
            const uniqueEdges = Array.from(new Map(edges.map(e => [e.id, e])).values());

            return { nodes, edges: uniqueEdges };
        }, { table: "knowledge_nodes", operation: "select" });
    },
};


