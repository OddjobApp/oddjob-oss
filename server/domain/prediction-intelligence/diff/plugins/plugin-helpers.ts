import { randomUUID } from "crypto";
import type {
    PluginContext,
    PluginManifest,
    PluginMetrics,
    PluginResult,
    Provenance,
} from "../../plugin-runtime/types.js";
import type { DiffRecord, DiffType } from "../types.js";
import { PREDICTION_IMPACT_WEIGHT, DIFF_EPSILON } from "../types.js";
import type { RealmName } from "../../quant/types.js";

export function clamp(value: number, min = 0, max = 1): number {
    if (!Number.isFinite(value)) return min;
    return Math.max(min, Math.min(max, value));
}

export function makeDiffManifest(input: {
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
        pod: "diff",
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

/** Build a DiffRecord with auto significance (to be refined by significance plugin). */
export function buildDiff(input: {
    contextId: string;
    type: DiffType;
    realm?: RealmName;
    sourceRefId?: string;
    targetRefId?: string;
    before?: unknown;
    after?: unknown;
    magnitude: number;
    entropyDelta?: number;
    direction?: string;
    driftDetected?: boolean;
    anomalyDetected?: boolean;
    evidenceIds?: string[];
    explanation?: string;
    now: string;
}): DiffRecord {
    // Preliminary significance — will be refined by significance scoring plugin
    const preliminarySignificance = clamp(
        input.magnitude * (PREDICTION_IMPACT_WEIGHT[input.type] ?? 0.65) * (input.anomalyDetected ? 1.3 : 1.0)
    );
    return {
        id: randomUUID(),
        contextId: input.contextId,
        type: input.type,
        realm: input.realm,
        sourceRefId: input.sourceRefId,
        targetRefId: input.targetRefId,
        before: input.before,
        after: input.after,
        magnitude: clamp(input.magnitude),
        entropyDelta: input.entropyDelta,
        significance: preliminarySignificance,
        direction: input.direction,
        driftDetected: input.driftDetected ?? false,
        anomalyDetected: input.anomalyDetected ?? false,
        evidenceIds: input.evidenceIds ?? [],
        explanation: input.explanation,
        createdAt: input.now,
    };
}
