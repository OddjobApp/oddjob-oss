import type { PluginContext, PluginManifest, PluginMetrics, PluginResult, Provenance } from "../../plugin-runtime/types.js";
import { CALIBRATION_EPSILON } from "../types.js";

export function clamp(v: number, min = 0, max = 1): number {
    return !Number.isFinite(v) ? min : Math.max(min, Math.min(max, v));
}

export function makeCalibrationManifest(input: {
    name: string; subPod: string; capability: string; description: string;
    inputTypes: string[]; outputTypes: string[]; timeoutMs?: number;
    latencyClass?: "realtime" | "interactive" | "analysis" | "batch";
}): PluginManifest {
    return {
        name: input.name, version: "1.0.0", pod: "calibration",
        subPod: input.subPod, capability: input.capability, description: input.description,
        owner: "prediction-intelligence", inputTypes: input.inputTypes, outputTypes: input.outputTypes,
        execution: { type: "typescript_in_process", mode: "sync", latencyClass: input.latencyClass ?? "interactive", timeoutMs: input.timeoutMs ?? 15, retryable: false, maxRetries: 0 },
        state: { readsState: false, writesState: false, stateKeys: [] },
        storage: { postgres: { read: false, write: false, tables: [] }, qdrant: { read: false, write: false, collections: [] }, redis: { read: false, write: false, keyPrefixes: [] }, objectStorage: { read: false, write: false, buckets: [] } },
        agents: { usesAgents: false, allowedForHotPath: false, maxAgentCalls: 0 },
        safety: { deterministic: true, requiresGovernance: false, producesAction: false, producesInference: true, producesPrediction: false, mayIncreaseRisk: false },
        dependencies: { requiredPlugins: [], optionalPlugins: [], externalServices: [] },
        rollout: { status: "active", trafficPercent: 100 },
    };
}

export function metrics(startedAt: string): PluginMetrics {
    const completedAt = new Date().toISOString();
    return { startedAt, completedAt, durationMs: Date.parse(completedAt) - Date.parse(startedAt), dbReads: 0, dbWrites: 0, vectorQueries: 0, cacheReads: 0, cacheWrites: 0, agentCalls: 0, outputSizeBytes: 0 };
}

export function provenance(manifest: PluginManifest, ctx: PluginContext, method: string, evidenceIds: string[] = []): Provenance {
    return { source: "plugin", method, pluginName: manifest.name, pluginVersion: manifest.version, evidenceIds, createdAt: ctx.now };
}

export function successResult<T>(manifest: PluginManifest, output: T, confidence: number, ctx: PluginContext, startedAt: string, method: string, evidenceIds: string[] = []): PluginResult<T> {
    return { pluginName: manifest.name, pluginVersion: manifest.version, status: "success", output, confidence: clamp(confidence), evidenceIds, warnings: [], errors: [], metrics: metrics(startedAt), provenance: provenance(manifest, ctx, method, evidenceIds) };
}

/** Brier score: (probability - outcome)² */
export function brierScore(probability: number, correct: boolean): number {
    return (probability - (correct ? 1 : 0)) ** 2;
}

/** Log loss: -log(p) if correct, -log(1-p) if wrong */
export function logLoss(probability: number, correct: boolean): number {
    const p = clamp(probability, CALIBRATION_EPSILON, 1 - CALIBRATION_EPSILON);
    return correct ? -Math.log(p) : -Math.log(1 - p);
}

/** Keyword overlap score between two label strings */
export function keywordOverlap(a: string, b: string): number {
    const tokA = a.toLowerCase().replace(/[^a-z0-9]/g, " ").split(/\s+/).filter(t => t.length > 2);
    const tokB = new Set(b.toLowerCase().replace(/[^a-z0-9]/g, " ").split(/\s+/).filter(t => t.length > 2));
    if (!tokA.length || !tokB.size) return 0;
    const overlap = tokA.filter(t => tokB.has(t) || [...tokB].some(tb => t.includes(tb) || tb.includes(t))).length;
    return clamp(overlap / Math.max(tokA.length, tokB.size));
}
