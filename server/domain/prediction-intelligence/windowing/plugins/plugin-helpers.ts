import type {
    PluginContext,
    PluginManifest,
    PluginMetrics,
    PluginResult,
    Provenance,
} from "../../plugin-runtime/types.js";

export function clamp(value: number, min = 0, max = 1): number {
    if (!Number.isFinite(value)) return min;
    return Math.max(min, Math.min(max, value));
}

export function makeWindowManifest(input: {
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
        pod: "temporal-windowing",
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
            timeoutMs: input.timeoutMs ?? 10,
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
            deterministic: true, requiresGovernance: false, producesAction: false,
            producesInference: true, producesPrediction: false, mayIncreaseRisk: false,
        },
        dependencies: { requiredPlugins: [], optionalPlugins: [], externalServices: [] },
        rollout: { status: "active", trafficPercent: 100 },
    };
}

export function metrics(startedAt: string): PluginMetrics {
    const completedAt = new Date().toISOString();
    return {
        startedAt, completedAt,
        durationMs: Date.parse(completedAt) - Date.parse(startedAt),
        dbReads: 0, dbWrites: 0, vectorQueries: 0, cacheReads: 0, cacheWrites: 0, agentCalls: 0, outputSizeBytes: 0,
    };
}

export function provenance(manifest: PluginManifest, ctx: PluginContext, method: string, evidenceIds: string[] = []): Provenance {
    return { source: "plugin", method, pluginName: manifest.name, pluginVersion: manifest.version, evidenceIds, createdAt: ctx.now };
}

export function successResult<T>(
    manifest: PluginManifest, output: T, confidence: number,
    ctx: PluginContext, startedAt: string, method: string, evidenceIds: string[] = []
): PluginResult<T> {
    return {
        pluginName: manifest.name, pluginVersion: manifest.version, status: "success", output,
        confidence: clamp(confidence), evidenceIds, warnings: [], errors: [],
        metrics: metrics(startedAt), provenance: provenance(manifest, ctx, method, evidenceIds),
    };
}

/** exp(-λ × Δt_seconds) */
export function recencyDecay(occurredAt: string, now: string, lambdaPerSec: number): number {
    const ageMs = Date.parse(now) - Date.parse(occurredAt);
    if (!Number.isFinite(ageMs) || ageMs < 0) return 1;
    return Math.exp(-lambdaPerSec * ageMs / 1000);
}

/** log(1 + count) normalised to [0,1] with a cap at count=100 */
export function frequencyScore(count: number): number {
    return clamp(Math.log1p(count) / Math.log1p(100));
}

/** Validate and parse an ISO timestamp, returning null on failure. */
export function parseTimestamp(raw: string): Date | null {
    if (!raw) return null;
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
}
