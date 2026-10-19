import { randomUUID } from "crypto";
import type {
    PluginContext,
    PluginManifest,
    PluginMetrics,
    PluginResult,
    Provenance,
} from "../../plugin-runtime/types.js";
import type { GraphNode, GraphEdge, GraphNodeType, GraphEdgeType } from "../types.js";
import { GRAPH_EPSILON } from "../types.js";

export function clamp(value: number, min = 0, max = 1): number {
    if (!Number.isFinite(value)) return min;
    return Math.max(min, Math.min(max, value));
}

export function makeGraphManifest(input: {
    name: string;
    subPod: string;
    capability: string;
    description: string;
    inputTypes: string[];
    outputTypes: string[];
    timeoutMs?: number;
    latencyClass?: "realtime" | "interactive" | "analysis" | "batch";
}): PluginManifest {
    return {
        name: input.name,
        version: "1.0.0",
        pod: "graph",
        subPod: input.subPod,
        capability: input.capability,
        description: input.description,
        owner: "prediction-intelligence",
        inputTypes: input.inputTypes,
        outputTypes: input.outputTypes,
        execution: {
            type: "typescript_in_process",
            mode: "sync",
            latencyClass: input.latencyClass ?? "realtime",
            timeoutMs: input.timeoutMs ?? 15,
            retryable: false,
            maxRetries: 0,
        },
        state: { readsState: false, writesState: false, stateKeys: [] },
        storage: {
            postgres: { read: false, write: false, tables: [] },
            qdrant: { read: false, write: false, collections: [] },
            redis: { read: false, write: false, keyPrefixes: [] },
            objectStorage: { read: false, write: false, buckets: [] },
        },
        agents: { usesAgents: false, allowedForHotPath: true, maxAgentCalls: 0 },
        safety: {
            deterministic: true,
            requiresGovernance: false,
            producesAction: false,
            producesInference: true,
            producesPrediction: false,
            mayIncreaseRisk: false,
        },
        dependencies: { requiredPlugins: [], optionalPlugins: [], externalServices: [] },
        rollout: { status: "active", trafficPercent: 100 },
    };
}

export function metrics(startedAt: string): PluginMetrics {
    const completedAt = new Date().toISOString();
    return {
        startedAt,
        completedAt,
        durationMs: Date.parse(completedAt) - Date.parse(startedAt),
        dbReads: 0, dbWrites: 0, vectorQueries: 0, cacheReads: 0, cacheWrites: 0, agentCalls: 0, outputSizeBytes: 0,
    };
}

export function provenance(manifest: PluginManifest, ctx: PluginContext, method: string, evidenceIds: string[] = []): Provenance {
    return {
        source: "plugin",
        method,
        pluginName: manifest.name,
        pluginVersion: manifest.version,
        evidenceIds,
        createdAt: ctx.now,
    };
}

export function successResult<T>(
    manifest: PluginManifest, output: T, confidence: number, ctx: PluginContext, startedAt: string, method: string, evidenceIds: string[] = []
): PluginResult<T> {
    return {
        pluginName: manifest.name, pluginVersion: manifest.version, status: "success", output,
        confidence: clamp(confidence), evidenceIds, warnings: [], errors: [],
        metrics: metrics(startedAt), provenance: provenance(manifest, ctx, method, evidenceIds),
    };
}

/** Compute edge weight from strength × confidence (spec §10). */
export function edgeWeight(strength: number, confidence: number): number {
    return clamp(strength * confidence);
}

/** Build a complete GraphNode. */
export function buildNode(input: {
    id?: string;
    type: GraphNodeType;
    label?: string;
    contextId?: string;
    refId: string;
    properties?: Record<string, unknown>;
    now: string;
}): GraphNode {
    const now = input.now;
    return {
        id: input.id ?? randomUUID(),
        type: input.type,
        label: input.label,
        contextId: input.contextId,
        refId: input.refId,
        properties: input.properties ?? {},
        createdAt: now,
        updatedAt: now,
    };
}

/** Build a complete GraphEdge. */
export function buildEdge(input: {
    id?: string;
    contextId?: string;
    sourceNodeId: string;
    targetNodeId: string;
    type: GraphEdgeType;
    strength: number;
    confidence: number;
    direction?: "directed" | "undirected";
    evidenceIds?: string[];
    provenance: Provenance;
    properties?: Record<string, unknown>;
    now: string;
}): GraphEdge {
    return {
        id: input.id ?? randomUUID(),
        contextId: input.contextId,
        sourceNodeId: input.sourceNodeId,
        targetNodeId: input.targetNodeId,
        type: input.type,
        strength: clamp(input.strength),
        confidence: clamp(input.confidence),
        weight: edgeWeight(input.strength, input.confidence),
        direction: input.direction ?? "directed",
        evidenceIds: input.evidenceIds ?? [],
        provenance: input.provenance,
        properties: input.properties ?? {},
        createdAt: input.now,
        updatedAt: input.now,
    };
}
