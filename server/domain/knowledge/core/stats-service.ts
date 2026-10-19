
import { db } from "@server/database_service.js";
import { createLogger } from "@server/utils/logger.js";
import { sql, eq, and, or, desc, inArray } from "drizzle-orm";
import { knowledgeNodes, knowledgeEdges, knowledgeTopics, fineTuningDatasets, fineTuningExamples, datasetItems } from "@shared/schema/index.js";
import { getOrgConditions } from "../../../utils/index.js";
import type { OrgContext } from "../../../domain/jobs/job.service.js";
import { graphService } from "./graph/graph-service.js";
import { withQueryTracking } from "@domain/knowledge/core/query-monitor.service.js";

const logger = createLogger("StatsService");

export const statsService = {
    /**
     * Get Graph Metrics (Counts of nodes, edges, etc.)
     */
    async getGraphMetrics(orgContext: OrgContext) {
        const nodeConditions = getOrgConditions(orgContext, knowledgeNodes);
        const edgeConditions = getOrgConditions(orgContext, knowledgeEdges);

        const [nodeCount] = await db
            .select({ count: sql<number>`cast(count(*) as int)` })
            .from(knowledgeNodes)
            .where(and(...nodeConditions));

        const [edgeCount] = await db
            .select({ count: sql<number>`cast(count(*) as int)` })
            .from(knowledgeEdges)
            .where(and(...edgeConditions));

        const labels = await db
            .select({ label: knowledgeNodes.label, count: sql<number>`cast(count(*) as int)` })
            .from(knowledgeNodes)
            .where(and(...nodeConditions))
            .groupBy(knowledgeNodes.label);

        return {
            nodes: {
                total: nodeCount?.count || 0,
                byLabel: labels.reduce((acc, curr) => ({ ...acc, [curr.label]: curr.count }), {})
            },
            edges: {
                total: edgeCount?.count || 0
            }
        };
    },

    /**
     * Get graph statistics
     */
    async getStats(orgContext: OrgContext): Promise<{
        totalNodes: number;
        totalEdges: number;
        nodesByType: Record<string, number>;
        edgesByType: Record<string, number>;
    }> {
        // searchNodes expects searchOptions, but limit default is 50. We want a lot.
        // Use graphService to avoid duplication
        const { nodes } = await graphService.searchNodes(orgContext, { limit: 10000 });
        const nodeIds = nodes.map(n => n.id);

        let edges: any[] = [];
        if (nodeIds.length > 0) {
            edges = await db
                .select()
                .from(knowledgeEdges)
                .where(
                    or(
                        sql`${knowledgeEdges.sourceId} = ANY(${nodeIds})`,
                        sql`${knowledgeEdges.targetId} = ANY(${nodeIds})`
                    )
                );
        }

        const nodesByType: Record<string, number> = {};
        for (const node of nodes) {
            // node.label is what we have in schema, effectively nodeType
            nodesByType[node.label] = (nodesByType[node.label] || 0) + 1;
        }

        const edgesByType: Record<string, number> = {};
        for (const edge of edges) {
            // edge.relation is what we have in schema
            edgesByType[edge.relation] = (edgesByType[edge.relation] || 0) + 1;
        }

        return {
            totalNodes: nodes.length,
            totalEdges: edges.length,
            nodesByType,
            edgesByType,
        };
    },

    async getStagingStats(orgContext: OrgContext): Promise<any> {
        return withQueryTracking("statsService.getStagingStats", async () => {
            const orgCondition = orgContext.organizationId ? eq(knowledgeNodes.organizationId, orgContext.organizationId) : sql`1=1`;

            const stats = await db.select({ status: knowledgeNodes.verificationStatus, label: knowledgeNodes.label, count: sql<number>`count(*)` })
                .from(knowledgeNodes).where(orgCondition).groupBy(knowledgeNodes.verificationStatus, knowledgeNodes.label);

            const topicStats = await db.select({ topicId: knowledgeNodes.knowledgeTopicId, topicName: knowledgeTopics.name, status: knowledgeNodes.verificationStatus, count: sql<number>`count(*)` })
                .from(knowledgeNodes).leftJoin(knowledgeTopics, eq(knowledgeNodes.knowledgeTopicId, knowledgeTopics.id)).where(orgCondition)
                .groupBy(knowledgeNodes.knowledgeTopicId, knowledgeTopics.name, knowledgeNodes.verificationStatus);

            const byStatus: Record<string, number> = { staging: 0, verified: 0, rejected: 0 };
            const byLabel: Record<string, any> = {};
            const byTopic: Record<string, any> = {};

            stats.forEach(row => {
                const st = row.status as string || 'unknown';
                byStatus[st] = (byStatus[st] || 0) + Number(row.count);
                if (!byLabel[row.label]) byLabel[row.label] = { staging: 0, verified: 0, rejected: 0 };
                if (byLabel[row.label][st] !== undefined) byLabel[row.label][st] += Number(row.count);
            });

            topicStats.forEach(row => {
                const key = row.topicId ? String(row.topicId) : 'none';
                if (!byTopic[key]) byTopic[key] = { id: row.topicId, name: row.topicName || '(No Topic)', staging: 0, verified: 0, rejected: 0 };
                const st = row.status as string || 'unknown';
                if (byTopic[key][st] !== undefined) byTopic[key][st] += Number(row.count);
            });

            return { byStatus, byLabel, byTopic, totalStaging: byStatus.staging };
        }, { table: 'knowledge_nodes', operation: 'select' });
    },

    async getDashboardStats(orgContext: OrgContext) {
        return withQueryTracking("statsService.getDashboardStats", async () => {
            const orgCondition = orgContext.organizationId ? eq(knowledgeNodes.organizationId, orgContext.organizationId) : sql`1=1`;
            const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);


            // Main Stats
            const stats = await db.select({ status: knowledgeNodes.verificationStatus, verifiedAt: knowledgeNodes.verifiedAt, count: sql<number>`count(*)` })
                .from(knowledgeNodes).where(orgCondition).groupBy(knowledgeNodes.verificationStatus, knowledgeNodes.verifiedAt);

            let [totalNodes, pendingApprovals, verifiedToday, rejectedToday] = [0, 0, 0, 0];
            stats.forEach(row => {
                const count = Number(row.count);
                totalNodes += count;
                if (row.status === "staging") pendingApprovals += count;
                else if (row.status === "verified" && row.verifiedAt && new Date(row.verifiedAt) >= todayStart) verifiedToday += count;
                else if (row.status === "rejected" && row.verifiedAt && new Date(row.verifiedAt) >= todayStart) rejectedToday += count;
            });

            const topPending = await db.select({ id: knowledgeNodes.id, name: knowledgeNodes.name, label: knowledgeNodes.label, confidenceScore: knowledgeNodes.confidenceScore, createdAt: knowledgeNodes.createdAt, topicName: knowledgeTopics.name })
                .from(knowledgeNodes).leftJoin(knowledgeTopics, eq(knowledgeNodes.knowledgeTopicId, knowledgeTopics.id))
                .where(and(orgCondition, eq(knowledgeNodes.verificationStatus, "staging"))).orderBy(desc(knowledgeNodes.confidenceScore)).limit(5);

            // Calculate topics summary
            const topicStatsRaw = await db.select({
                topicId: knowledgeNodes.knowledgeTopicId,
                topicName: knowledgeTopics.name,
                total: sql<number>`count(*)`,
                verified: sql<number>`count(case when ${knowledgeNodes.verificationStatus} = 'verified' then 1 end)`,
                staging: sql<number>`count(case when ${knowledgeNodes.verificationStatus} = 'staging' then 1 end)`
            })
                .from(knowledgeNodes)
                .leftJoin(knowledgeTopics, eq(knowledgeNodes.knowledgeTopicId, knowledgeTopics.id))
                .where(orgCondition)
                .groupBy(knowledgeNodes.knowledgeTopicId, knowledgeTopics.name);

            const topicsSummary = topicStatsRaw
                .map(r => ({
                    id: r.topicId || 0,
                    name: r.topicName || 'Unassigned',
                    total: Number(r.total),
                    verified: Number(r.verified),
                    staging: Number(r.staging)
                }))
                .sort((a, b) => b.total - a.total);

            const labelStatsRaw = await db.select({
                label: knowledgeNodes.label,
                count: sql<number>`count(*)`
            })
                .from(knowledgeNodes)
                .where(orgCondition)
                .groupBy(knowledgeNodes.label)
                .orderBy(desc(sql`count(*)`));

            // Dataset Stats
            const datasetOrgCondition = orgContext.organizationId
                ? eq(fineTuningDatasets.organizationId, orgContext.organizationId)
                : sql`1=1`;

            const [datasetCount] = await db.select({ count: sql<number>`count(*)` })
                .from(fineTuningDatasets)
                .where(datasetOrgCondition);

            const [exampleCount] = await db.select({ count: sql<number>`count(*)` })
                .from(fineTuningExamples)
                .innerJoin(fineTuningDatasets, eq(fineTuningExamples.datasetId, fineTuningDatasets.id))
                .where(datasetOrgCondition);

            // Recent Examples (last 5)
            const recentExamples = await db.select({
                id: fineTuningExamples.id,
                input: fineTuningExamples.input,
                output: fineTuningExamples.output,
                datasetId: fineTuningExamples.datasetId,
                datasetName: fineTuningDatasets.name,
                createdAt: fineTuningExamples.createdAt,
                humanConfidence: fineTuningExamples.humanConfidence
            })
                .from(fineTuningExamples)
                .innerJoin(fineTuningDatasets, eq(fineTuningExamples.datasetId, fineTuningDatasets.id))
                .where(datasetOrgCondition)
                .orderBy(desc(fineTuningExamples.createdAt))
                .limit(5);

            // Extraction Trends
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
            sevenDaysAgo.setHours(0, 0, 0, 0);

            const extractionTrendsRaw = await db.select({
                date: sql<string>`date(${knowledgeNodes.createdAt})`,
                verified: sql<number>`count(case when ${knowledgeNodes.verificationStatus} = 'verified' then 1 end)`,
                staging: sql<number>`count(case when ${knowledgeNodes.verificationStatus} = 'staging' then 1 end)`,
                rejected: sql<number>`count(case when ${knowledgeNodes.verificationStatus} = 'rejected' then 1 end)`,
            })
                .from(knowledgeNodes)
                .where(and(orgCondition, sql`${knowledgeNodes.createdAt} >= ${sevenDaysAgo.toISOString()}`))
                .groupBy(sql`date(${knowledgeNodes.createdAt})`)
                .orderBy(sql`date(${knowledgeNodes.createdAt})`);

            // Fill in missing days
            const extractionTrends: { date: string; verified: number; staging: number; rejected: number }[] = [];
            const today = new Date();
            for (let i = 6; i >= 0; i--) {
                const d = new Date(today);
                d.setDate(d.getDate() - i);
                const dateStr = d.toISOString().split('T')[0];
                const existing = extractionTrendsRaw.find(r => r.date === dateStr);
                extractionTrends.push({
                    date: dateStr,
                    verified: Number(existing?.verified || 0),
                    staging: Number(existing?.staging || 0),
                    rejected: Number(existing?.rejected || 0)
                });
            }

            return {
                totalNodes,
                pendingApprovals,
                verifiedToday,
                rejectedToday,
                pendingNodes: topPending,
                topicsSummary,
                labelsSummary: labelStatsRaw.map(r => ({
                    label: r.label,
                    count: Number(r.count)
                })),
                extractionTrends,
                datasetStats: {
                    totalDatasets: Number(datasetCount?.count || 0),
                    totalExamples: Number(exampleCount?.count || 0),
                    recentExamples: recentExamples.map(ex => ({
                        id: ex.id,
                        input: ex.input?.substring(0, 100) + (ex.input?.length > 100 ? '...' : ''),
                        output: ex.output?.substring(0, 100) + (ex.output?.length > 100 ? '...' : ''),
                        datasetId: ex.datasetId,
                        datasetName: ex.datasetName,
                        createdAt: ex.createdAt,
                        humanConfidence: ex.humanConfidence
                    }))
                }
            };
        }, { table: 'knowledge_nodes', operation: 'select' });
    },

    /**
     * Get Sankey Chart Data
     */
    async getSankeyChartData(
        orgContext: OrgContext,
        runId: number | null,
        dimensions: string[] = ['User', 'Component', 'Infrastructure'],
        datasetId: number | null = null
    ): Promise<{ nodes: any[]; links: any[] }> {
        return withQueryTracking("statsService.getSankeyChartData", async () => {
            const organizationId = orgContext.organizationId || null;

            if (runId) {
                return this.getPipelineRunSankey([runId], dimensions);
            }

            if (datasetId) {
                const items = await db
                    .select({ runId: datasetItems.pipelineExecutionId })
                    .from(datasetItems)
                    .where(eq(datasetItems.datasetId, datasetId));

                const runIds = items
                    .map(i => i.runId)
                    .filter((id): id is number => id !== null);

                if (runIds.length === 0) return { nodes: [], links: [] };
                return this.getPipelineRunSankey(runIds, dimensions);
            }

            // --- Legacy "Hub" Mode for Global View
            const conditions = [];
            if (organizationId === null) {
                conditions.push(sql`${knowledgeNodes.organizationId} IS NULL`);
            } else {
                conditions.push(eq(knowledgeNodes.organizationId, organizationId));
            }

            conditions.push(or(
                eq(knowledgeNodes.label, 'Ticket'),
                eq(knowledgeNodes.label, 'Incident'),
                eq(knowledgeNodes.label, 'Issue')
            )!);

            const hubs = await db
                .select({
                    id: knowledgeNodes.id,
                    name: knowledgeNodes.name,
                    label: knowledgeNodes.label,
                    externalId: knowledgeNodes.externalId
                })
                .from(knowledgeNodes)
                .where(and(...conditions))
                .limit(10000);

            if (hubs.length === 0) {
                return { nodes: [], links: [] };
            }

            const hubIds = hubs.map(h => h.id);
            const orgCondition = organizationId === null ? sql`${knowledgeEdges.organizationId} IS NULL` : eq(knowledgeEdges.organizationId, organizationId);

            const relevantEdges = await db
                .select({
                    sourceId: knowledgeEdges.sourceId,
                    targetId: knowledgeEdges.targetId,
                })
                .from(knowledgeEdges)
                .where(and(
                    orgCondition,
                    or(
                        inArray(knowledgeEdges.sourceId, hubIds),
                        inArray(knowledgeEdges.targetId, hubIds)
                    )
                ));

            // Collect all neighbor IDs
            const neighborIds = new Set<number>(hubIds);
            relevantEdges.forEach(e => {
                neighborIds.add(e.sourceId);
                neighborIds.add(e.targetId);
            });

            const nodesOrgCondition = organizationId === null ? sql`${knowledgeNodes.organizationId} IS NULL` : eq(knowledgeNodes.organizationId, organizationId);
            const allNodes = await db
                .select({
                    id: knowledgeNodes.id,
                    label: knowledgeNodes.label,
                    name: knowledgeNodes.name
                })
                .from(knowledgeNodes)
                .where(and(
                    nodesOrgCondition,
                    inArray(knowledgeNodes.id, Array.from(neighborIds))
                ));

            const nodeMap = new Map<number, { label: string; name: string }>();
            allNodes.forEach(n => nodeMap.set(n.id, n));

            // Build Adjacency
            const adj: Record<number, number[]> = {};
            relevantEdges.forEach(e => {
                if (!adj[e.sourceId]) adj[e.sourceId] = [];
                if (!adj[e.targetId]) adj[e.targetId] = [];

                // Undirected connection for discovery
                adj[e.sourceId].push(e.targetId);
                adj[e.targetId].push(e.sourceId);
            });

            // Traverse Dimensions
            const links: Record<string, { count: number; ticketIds: number[] }> = {};
            const sankeyNodesMap: Map<string, { id: string; layer: number; name: string }> = new Map();

            for (const hub of hubs) {
                const neighbors = adj[hub.id] || [];
                const attributes: Record<string, string> = {};

                attributes[hub.label] = hub.name;

                neighbors.forEach(nid => {
                    const n = nodeMap.get(nid);
                    if (n) attributes[n.label] = n.name;
                });

                for (let i = 0; i < dimensions.length - 1; i++) {
                    const sourceLabel = dimensions[i];
                    const targetLabel = dimensions[i + 1];

                    if (attributes[sourceLabel] && attributes[targetLabel]) {
                        const sourceName = attributes[sourceLabel];
                        const targetName = attributes[targetLabel];

                        if (sourceName === targetName && sourceLabel === targetLabel) continue;

                        const sourceId = `${sourceLabel}::${sourceName}`;
                        const targetId = `${targetLabel}::${targetName}`;

                        if (!sankeyNodesMap.has(sourceId)) sankeyNodesMap.set(sourceId, { id: sourceId, layer: i, name: sourceName });
                        if (!sankeyNodesMap.has(targetId)) sankeyNodesMap.set(targetId, { id: targetId, layer: i + 1, name: targetName });

                        const key = `${sourceId}|${targetId}`;
                        if (!links[key]) links[key] = { count: 0, ticketIds: [] };

                        links[key].count++;
                        links[key].ticketIds.push(hub.id);
                    }
                }
            }

            return {
                nodes: Array.from(sankeyNodesMap.values()),
                links: Object.entries(links).map(([key, data]) => {
                    const [source, target] = key.split('|');
                    return { source, target, value: data.count, ticketIds: data.ticketIds };
                })
            };
        }, { table: 'knowledge_nodes', operation: 'select' });
    },

    /**
     * Pipeline Run Sankey Helper
     */
    async getPipelineRunSankey(
        runIds: number[],
        dimensions: string[]
    ): Promise<{ nodes: any[]; links: any[] }> {
        // 1. Fetch Core Run Nodes
        const coreNodes = await db
            .select({
                id: knowledgeNodes.id,
                label: knowledgeNodes.label,
                name: knowledgeNodes.name
            })
            .from(knowledgeNodes)
            .where(inArray(knowledgeNodes.pipelineExecutionId, runIds));

        if (coreNodes.length === 0) return { nodes: [], links: [] };

        const coreNodeIds = coreNodes.map(n => n.id);
        const nodeMap = new Map(coreNodes.map(n => [n.id, n]));

        // 2. Fetch Edges
        const edges = await db
            .select({
                sourceId: knowledgeEdges.sourceId,
                targetId: knowledgeEdges.targetId,
            })
            .from(knowledgeEdges)
            .where(or(
                inArray(knowledgeEdges.lastUpdatedByRunId, runIds),
                inArray(knowledgeEdges.sourceId, coreNodeIds),
                inArray(knowledgeEdges.targetId, coreNodeIds)
            ));

        // 3. Fetch Boundary Nodes
        const neighborIds = new Set<number>();
        edges.forEach(e => {
            if (!nodeMap.has(e.sourceId)) neighborIds.add(e.sourceId);
            if (!nodeMap.has(e.targetId)) neighborIds.add(e.targetId);
        });

        if (neighborIds.size > 0) {
            const neighbors = await db
                .select({
                    id: knowledgeNodes.id,
                    label: knowledgeNodes.label,
                    name: knowledgeNodes.name
                })
                .from(knowledgeNodes)
                .where(inArray(knowledgeNodes.id, Array.from(neighborIds)));

            neighbors.forEach(n => nodeMap.set(n.id, n));
        }

        // 4. Trace Flows
        const linksMap: Record<string, number> = {};
        const sankeyNodeMap: Map<string, any> = new Map();

        const addSankeyNode = (n: { label: string; name: string }, layer: number) => {
            const id = `${n.label}::${n.name}`;
            if (!sankeyNodeMap.has(id)) {
                sankeyNodeMap.set(id, { id, name: n.name, layer });
            }
            return id;
        };

        for (let i = 0; i < dimensions.length - 1; i++) {
            const srcLabel = dimensions[i];
            const tgtLabel = dimensions[i + 1];

            for (const edge of edges) {
                const nodeA = nodeMap.get(edge.sourceId);
                const nodeB = nodeMap.get(edge.targetId);

                if (!nodeA || !nodeB) continue;

                let source = null;
                let target = null;

                if (nodeA.label === srcLabel && nodeB.label === tgtLabel) {
                    source = nodeA;
                    target = nodeB;
                }
                else if (nodeB.label === srcLabel && nodeA.label === tgtLabel) {
                    source = nodeB;
                    target = nodeA;
                }

                if (source && target) {
                    if (source.name === target.name) continue;

                    const sId = addSankeyNode(source, i);
                    const tId = addSankeyNode(target, i + 1);

                    const key = `${sId}|${tId}`;
                    linksMap[key] = (linksMap[key] || 0) + 1;
                }
            }
        }

        const finalLinks = Object.entries(linksMap).map(([key, count]) => {
            const [source, target] = key.split('|');
            return { source, target, value: count };
        });

        return {
            nodes: Array.from(sankeyNodeMap.values()),
            links: finalLinks
        };
    },

    /**
     * Get Matrix Summary (Aggregated edges for dependency matrix)
     */
    async getMatrixSummary(
        orgContext: OrgContext,
        filters: {
            datasetId?: number;
            pipelineExecutionId?: number;
            pipelineId?: number;
            topicId?: number;
            labels?: string[];
            limit?: number;
        } = {}
    ): Promise<{ nodes: any[]; matrix: Record<string, { weight: number; count: number }> }> {
        return withQueryTracking("statsService.getMatrixSummary", async () => {
            const limit = filters.limit || 200;

            // 1. Fetch Nodes
            const { nodes } = await graphService.searchNodes(orgContext, {
                datasetIds: filters.datasetId ? [filters.datasetId] : undefined,
                pipelineExecutionId: filters.pipelineExecutionId,
                pipelineId: filters.pipelineId,
                knowledgeTopicId: filters.topicId,
                label: filters.labels && filters.labels.length > 0 ? filters.labels[0] : undefined, // searchNodes only supports single label for now
                limit
            });

            if (nodes.length === 0) return { nodes: [], matrix: {} };

            const nodeIds = nodes.map(n => n.id);

            // 2. Fetch Edges connecting these nodes
            const edges = await db
                .select()
                .from(knowledgeEdges)
                .where(
                    and(
                        inArray(knowledgeEdges.sourceId, nodeIds),
                        inArray(knowledgeEdges.targetId, nodeIds)
                    )
                );

            // 3. Aggregate Matrix
            const matrix: Record<string, { weight: number; count: number }> = {};
            for (const edge of edges) {
                const key = `${edge.sourceId}-${edge.targetId}`;
                if (!matrix[key]) {
                    matrix[key] = { weight: 0, count: 0 };
                }
                matrix[key].weight += (edge.weight || 1);
                matrix[key].count += 1;
            }

            return {
                nodes: nodes.map(n => ({
                    id: n.id,
                    name: n.name,
                    label: n.label,
                    confidenceScore: n.confidenceScore
                })),
                matrix
            };
        }, { table: 'knowledge_edges', operation: 'select' });
    },
};


