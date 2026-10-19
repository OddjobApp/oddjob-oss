import type {
    PluginContext,
    PluginManifest,
    PluginMetrics,
    PluginResult,
    Provenance,
} from "../../plugin-runtime/types.js";
import { MEMORY_DECAY_LAMBDA, MEMORY_EPSILON } from "../types.js";

export function clamp(value: number, min = 0, max = 1): number {
    if (!Number.isFinite(value)) return min;
    return Math.max(min, Math.min(max, value));
}

export function makeMemoryManifest(input: {
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
        pod: "memory",
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
            timeoutMs: input.timeoutMs ?? 20,
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
        dbReads: 0,
        dbWrites: 0,
        vectorQueries: 0,
        cacheReads: 0,
        cacheWrites: 0,
        agentCalls: 0,
        outputSizeBytes: 0,
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
    manifest: PluginManifest,
    output: T,
    confidence: number,
    ctx: PluginContext,
    startedAt: string,
    method: string,
    evidenceIds: string[] = []
): PluginResult<T> {
    return {
        pluginName: manifest.name,
        pluginVersion: manifest.version,
        status: "success",
        output,
        confidence: clamp(confidence),
        evidenceIds,
        warnings: [],
        errors: [],
        metrics: metrics(startedAt),
        provenance: provenance(manifest, ctx, method, evidenceIds),
    };
}

/** Compute recency weight: exp(-λ × age_in_days). More recent → higher. */
export function recencyWeight(updatedAtIso: string, nowIso: string): number {
    const ageMs = Date.parse(nowIso) - Date.parse(updatedAtIso);
    if (!Number.isFinite(ageMs) || ageMs < 0) return 1;
    const ageInDays = ageMs / 86_400_000;
    return Math.exp(-MEMORY_DECAY_LAMBDA * ageInDays);
}

/** Frequency weight: saturates at 1 after ~20 occurrences. */
export function frequencyWeight(count: number): number {
    return clamp(1 - Math.exp(-count / 10));
}

/** Context match: how well contextId matches (or scope overlaps) */
export function contextMatchWeight(memoryContextId: string | undefined, queryContextId: string): number {
    if (!memoryContextId) return 0.5;
    return memoryContextId === queryContextId ? 1.0 : 0.4;
}

/** Outcome reliability from a historical match rate. */
export function outcomeReliabilityWeight(matchRate: number | undefined): number {
    return clamp(matchRate ?? 0.7);
}

/** Apply the full memory scoring formula (spec §10). */
export function applyMemoryScore(factors: {
    relevance: number;
    confidence: number;
    similarity: number;
    recency: number;
    frequency: number;
    outcomeReliability: number;
    contextMatch: number;
    permissionWeight: number;
}): number {
    const raw =
        factors.relevance
        * factors.confidence
        * factors.similarity
        * factors.recency
        * factors.frequency
        * factors.outcomeReliability
        * factors.contextMatch
        * factors.permissionWeight;
    return clamp(raw / Math.max(MEMORY_EPSILON, 1));
}
