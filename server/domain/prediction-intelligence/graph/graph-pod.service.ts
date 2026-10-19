import { randomUUID } from "crypto";
import { db } from "@server/database_service.js";
import { createLogger } from "@server/utils/logger.js";
import { eq, and, or, inArray, desc } from "drizzle-orm";
import {
    graphNodes as graphNodesTable,
    graphEdges as graphEdgesTable,
    graphSnapshots as graphSnapshotsTable,
    graphDiffs as graphDiffsTable,
} from "@shared/schema/prediction/graph.js";
import { createPluginContext } from "../plugin-runtime/plugin-runtime.js";
import type { DomainContext } from "../quant/types.js";
import type { Provenance } from "../plugin-runtime/types.js";
import type {
    GraphPort,
    GraphNode,
    GraphEdge,
    GraphNodeType,
    GraphEdgeType,
    GraphNeighborhood,
    RelationshipPath,
    GraphFeatureSet,
    GraphDiff,
    GraphDiffChange,
    GraphProjection,
    GraphSnapshot,
    UpsertGraphNodeInput,
    UpsertGraphEdgeInput,
    GraphNeighborInput,
    GraphPathInput,
    GraphFeatureInput,
    GraphDiffInput,
    GraphProjectionInput,
    GraphSnapshotInput,
    PredictionMode,
} from "./types.js";
import { GRAPH_DEPTH_LIMITS } from "./types.js";
import { graphTraversalPlugin } from "./plugins/graph-traversal.plugin.js";
import { graphFeatureExtractorPlugin } from "./plugins/graph-feature-extractor.plugin.js";
import { clamp, buildNode, buildEdge, edgeWeight } from "./plugins/plugin-helpers.js";

const logger = createLogger("GraphPod");

function domainCtxToPluginCtx(domainCtx: DomainContext, contextId: string) {
    return createPluginContext({
        contextId,
        mode: domainCtx.mode,
        requestId: domainCtx.requestId,
        correlationId: domainCtx.correlationId,
        permissions: {
            canWriteInferences: true,
            canWritePredictions: false,
            canCallAgents: false,
            canReadSensitiveData: false,
            canUseGeographicData: false,
            canUseSpatialData: false,
        },
    });
}

function rowToNode(row: typeof graphNodesTable.$inferSelect): GraphNode {
    return {
        id: row.id,
        type: row.type as GraphNodeType,
        label: row.label ?? undefined,
        contextId: row.contextId ?? undefined,
        refId: row.refId,
        properties: (row.properties as Record<string, unknown>) ?? {},
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}

function rowToEdge(row: typeof graphEdgesTable.$inferSelect): GraphEdge {
    return {
        id: row.id,
        contextId: row.contextId ?? undefined,
        sourceNodeId: row.sourceNodeId,
        targetNodeId: row.targetNodeId,
        type: row.type as GraphEdgeType,
        strength: row.strength,
        confidence: row.confidence,
        weight: row.weight,
        direction: row.direction as "directed" | "undirected",
        evidenceIds: (row.evidenceIds as unknown as string[]) ?? [],
        provenance: (row.provenance as unknown as Provenance) ?? {
            source: "graph-pod",
            method: "fallback",
            pluginName: "graph-pod",
            pluginVersion: "1.0.0",
            evidenceIds: [],
            createdAt: row.createdAt.toISOString()
        },
        validFrom: row.validFrom?.toISOString(),
        validTo: row.validTo?.toISOString(),
        properties: (row.properties as Record<string, unknown>) ?? {},
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}

// ============================================================================
// GraphPod implementation
// ============================================================================

class GraphPod implements GraphPort {

    // ── Node upsert ────────────────────────────────────────────────────────
    async upsertNode(input: UpsertGraphNodeInput, ctx: DomainContext): Promise<GraphNode> {
        const now = new Date();
        const id = input.id ?? randomUUID();

        await db.insert(graphNodesTable).values({
            id,
            contextId: input.contextId ?? null,
            type: input.type,
            label: input.label ?? null,
            refId: input.refId,
            properties: (input.properties ?? {}) as any,
            createdAt: now,
            updatedAt: now,
        }).onConflictDoUpdate({
            target: graphNodesTable.id,
            set: {
                label: input.label ?? null,
                properties: (input.properties ?? {}) as any,
                updatedAt: now,
            },
        });

        return {
            id,
            type: input.type,
            label: input.label,
            contextId: input.contextId,
            refId: input.refId,
            properties: input.properties ?? {},
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
        };
    }

    // ── Edge upsert ────────────────────────────────────────────────────────
    async upsertEdge(input: UpsertGraphEdgeInput, ctx: DomainContext): Promise<GraphEdge> {
        const now = new Date();
        const id = input.id ?? randomUUID();
        const weight = edgeWeight(input.strength, input.confidence);

        await db.insert(graphEdgesTable).values({
            id,
            contextId: input.contextId ?? null,
            sourceNodeId: input.sourceNodeId,
            targetNodeId: input.targetNodeId,
            type: input.type,
            strength: clamp(input.strength),
            confidence: clamp(input.confidence),
            weight,
            direction: input.direction ?? "directed",
            evidenceIds: (input.evidenceIds ?? []) as unknown as string[],
            provenance: (input.provenance ?? {}) as any,
            validFrom: input.validFrom ? new Date(input.validFrom) : null,
            validTo: input.validTo ? new Date(input.validTo) : null,
            properties: (input.properties ?? {}) as any,
            createdAt: now,
            updatedAt: now,
        }).onConflictDoUpdate({
            target: graphEdgesTable.id,
            set: {
                strength: clamp(input.strength),
                confidence: clamp(input.confidence),
                weight,
                updatedAt: now,
            },
        });

        return {
            id,
            contextId: input.contextId,
            sourceNodeId: input.sourceNodeId,
            targetNodeId: input.targetNodeId,
            type: input.type,
            strength: clamp(input.strength),
            confidence: clamp(input.confidence),
            weight,
            direction: input.direction ?? "directed",
            evidenceIds: input.evidenceIds ?? [],
            provenance: input.provenance,
            validFrom: input.validFrom,
            validTo: input.validTo,
            properties: input.properties ?? {},
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
        };
    }

    // ── Neighbor traversal ─────────────────────────────────────────────────
    async getNeighbors(input: GraphNeighborInput, ctx: DomainContext): Promise<GraphNeighborhood> {
        const mode = (input.mode ?? ctx.mode) as PredictionMode;
        const depthLimits = GRAPH_DEPTH_LIMITS[mode];
        const depth = Math.min(input.depth ?? 1, depthLimits.maxDepth);
        const maxNodes = Math.min(input.maxNodes ?? depthLimits.maxNodes, depthLimits.maxNodes);
        const pluginCtx = domainCtxToPluginCtx(ctx, input.nodeId);

        // Fetch relevant edges (1 hop for now; recursion happens in plugin)
        const edgeRows = await db
            .select()
            .from(graphEdgesTable)
            .where(
                and(
                    input.contextId ? eq(graphEdgesTable.contextId, input.contextId) : undefined,
                    or(
                        eq(graphEdgesTable.sourceNodeId, input.nodeId),
                        eq(graphEdgesTable.targetNodeId, input.nodeId),
                    ),
                )
            )
            .limit(maxNodes * 4);

        const nodeIds = new Set<string>([input.nodeId]);
        for (const e of edgeRows) { nodeIds.add(e.sourceNodeId); nodeIds.add(e.targetNodeId); }

        const nodeRows = await db
            .select()
            .from(graphNodesTable)
            .where(inArray(graphNodesTable.id, [...nodeIds]));

        const result = await graphTraversalPlugin.execute({
            startNodeId: input.nodeId,
            edges: edgeRows.map(rowToEdge),
            nodes: nodeRows.map(rowToNode),
            depth,
            edgeTypes: input.edgeTypes,
            nodeTypes: input.nodeTypes,
            maxNodes,
        }, pluginCtx);

        return result.output ?? {
            startNodeId: input.nodeId,
            depth,
            nodes: [],
            edges: [],
            truncated: false,
        };
    }

    // ── Path finding (MVP: returns single-hop paths only) ──────────────────
    async findPaths(input: GraphPathInput, ctx: DomainContext): Promise<RelationshipPath[]> {
        // Find direct edges between source and target
        const edgeRows = await db
            .select()
            .from(graphEdgesTable)
            .where(
                and(
                    eq(graphEdgesTable.sourceNodeId, input.sourceNodeId),
                    eq(graphEdgesTable.targetNodeId, input.targetNodeId),
                )
            )
            .limit(input.maxPaths ?? 5);

        if (edgeRows.length === 0) return [];

        const [sourceRow, targetRow] = await Promise.all([
            db.select().from(graphNodesTable).where(eq(graphNodesTable.id, input.sourceNodeId)).limit(1),
            db.select().from(graphNodesTable).where(eq(graphNodesTable.id, input.targetNodeId)).limit(1),
        ]);

        if (!sourceRow[0] || !targetRow[0]) return [];

        return edgeRows.map(edgeRow => {
            const edge = rowToEdge(edgeRow);
            return {
                id: randomUUID(),
                sourceNodeId: input.sourceNodeId,
                targetNodeId: input.targetNodeId,
                nodes: [rowToNode(sourceRow[0]), rowToNode(targetRow[0])],
                edges: [edge],
                pathStrength: edge.weight,
                confidence: edge.confidence,
                explanation: `${sourceRow[0].label ?? input.sourceNodeId} ${edge.type} ${targetRow[0].label ?? input.targetNodeId} (weight=${edge.weight.toFixed(3)})`,
            };
        });
    }

    // ── Feature extraction ─────────────────────────────────────────────────
    async extractFeatures(input: GraphFeatureInput, ctx: DomainContext): Promise<GraphFeatureSet> {
        const pluginCtx = domainCtxToPluginCtx(ctx, input.nodeId);
        const neighborhood = await this.getNeighbors({
            nodeId: input.nodeId,
            contextId: input.contextId,
            depth: 1,
            mode: input.mode ?? ctx.mode as PredictionMode,
        }, ctx);

        const result = await graphFeatureExtractorPlugin.execute({
            nodeId: input.nodeId,
            neighbors: neighborhood,
            contextId: input.contextId,
        }, pluginCtx);

        return result.output ?? {
            nodeId: input.nodeId,
            contextId: input.contextId,
            features: {},
            evidenceNodeIds: [],
            evidenceEdgeIds: [],
            createdAt: ctx.now,
        };
    }

    // ── Diff ───────────────────────────────────────────────────────────────
    async diff(input: GraphDiffInput, ctx: DomainContext): Promise<GraphDiff> {
        const changes: GraphDiffChange[] = [];
        const currentNodeIds = new Set(input.currentNodes.map(n => n.id));
        const currentEdgeIds = new Set(input.currentEdges.map(e => e.id));

        // For MVP: detect added nodes/edges vs snapshot
        for (const node of input.currentNodes) {
            changes.push({
                type: "node_added",
                nodeId: node.id,
                after: { type: node.type, label: node.label },
                confidence: 1,
                explanation: `Node '${node.label ?? node.id}' (${node.type}) added`,
            });
        }
        for (const edge of input.currentEdges) {
            changes.push({
                type: "edge_added",
                edgeId: edge.id,
                after: { type: edge.type, weight: edge.weight },
                confidence: 1,
                explanation: `Edge ${edge.type} (weight=${edge.weight.toFixed(3)}) added`,
            });
        }

        const id = randomUUID();
        const diffRecord: GraphDiff = {
            id,
            contextId: input.contextId,
            previousSnapshotId: input.previousSnapshotId,
            summary: {
                nodesAdded: input.currentNodes.length,
                nodesRemoved: 0,
                edgesAdded: input.currentEdges.length,
                edgesRemoved: 0,
                edgeWeightsChanged: 0,
                shapeChanged: input.currentNodes.length > 0 || input.currentEdges.length > 0,
            },
            changes,
            createdAt: ctx.now,
        };

        // Persist async
        db.insert(graphDiffsTable).values({
            id,
            contextId: input.contextId ?? null,
            previousSnapshotId: input.previousSnapshotId ?? null,
            currentSnapshotId: null,
            changes: changes as any,
            summary: diffRecord.summary as any,
            createdAt: new Date(ctx.now),
        }).catch(err => logger.warn("graph diff persist failed", { err: String(err) }));

        return diffRecord;
    }

    // ── Projection ─────────────────────────────────────────────────────────
    async project(input: GraphProjectionInput, ctx: DomainContext): Promise<GraphProjection> {
        const limit = input.limit ?? 100;

        const [nodeRows, edgeRows] = await Promise.all([
            db.select().from(graphNodesTable)
                .where(
                    and(
                        input.contextId ? eq(graphNodesTable.contextId, input.contextId) : undefined,
                        inArray(graphNodesTable.type, input.nodeTypes as unknown as string[]),
                    )
                )
                .limit(limit),

            db.select().from(graphEdgesTable)
                .where(
                    and(
                        input.contextId ? eq(graphEdgesTable.contextId, input.contextId) : undefined,
                        inArray(graphEdgesTable.type, input.edgeTypes as unknown as string[]),
                    )
                )
                .limit(limit),
        ]);

        return {
            id: randomUUID(),
            contextId: input.contextId,
            nodeTypes: input.nodeTypes,
            edgeTypes: input.edgeTypes,
            nodes: nodeRows.map(rowToNode),
            edges: edgeRows.map(rowToEdge),
            createdAt: ctx.now,
        };
    }

    // ── Snapshot ───────────────────────────────────────────────────────────
    async snapshot(input: GraphSnapshotInput, ctx: DomainContext): Promise<GraphSnapshot> {
        const [nodeCount, edgeCount] = await Promise.all([
            db.select({ count: graphNodesTable.id })
                .from(graphNodesTable)
                .where(input.contextId ? eq(graphNodesTable.contextId, input.contextId) : undefined)
                .then(r => r.length),
            db.select({ count: graphEdgesTable.id })
                .from(graphEdgesTable)
                .where(input.contextId ? eq(graphEdgesTable.contextId, input.contextId) : undefined)
                .then(r => r.length),
        ]);

        const id = randomUUID();
        const now = new Date(ctx.now);

        await db.insert(graphSnapshotsTable).values({
            id,
            contextId: input.contextId ?? null,
            snapshotType: input.snapshotType,
            nodeCount,
            edgeCount,
            summary: { nodeCount, edgeCount } as any,
            createdAt: now,
        });

        return {
            id,
            contextId: input.contextId,
            snapshotType: input.snapshotType,
            nodeCount,
            edgeCount,
            summary: { nodeCount, edgeCount },
            createdAt: ctx.now,
        };
    }
}

export const graphPod = new GraphPod();
export type { GraphPod };
