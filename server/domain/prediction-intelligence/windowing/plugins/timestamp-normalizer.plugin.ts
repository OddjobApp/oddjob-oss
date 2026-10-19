import type { PredictionPlugin, PluginContext, PluginDecision, PluginResult, PluginHealth } from "../../plugin-runtime/types.js";
import type { TimestampNormalizerPluginInput, TimestampNormalizationResult } from "../types.js";
import { makeWindowManifest, successResult, parseTimestamp } from "./plugin-helpers.js";

const manifest = makeWindowManifest({
    name: "timestamp-normalizer",
    subPod: "timestamp-normalizer",
    capability: "temporal.normalize_timestamp",
    description: "Normalizes timestamps to UTC, detects clock skew, applies repair policy (spec §11).",
    inputTypes: ["TimestampNormalizerPluginInput"],
    outputTypes: ["TimestampNormalizationResult"],
    timeoutMs: 5,
});

export const timestampNormalizerPlugin: PredictionPlugin<TimestampNormalizerPluginInput, TimestampNormalizationResult> = {
    manifest,

    async canHandle(input: TimestampNormalizerPluginInput): Promise<PluginDecision> {
        return { shouldRun: true, reason: "timestamp normalization always runs", priority: 100, estimatedCost: { latencyMs: 0, dbReads: 0, vectorQueries: 0, agentCalls: 0 } };
    },

    async execute(input: TimestampNormalizerPluginInput, ctx: PluginContext): Promise<PluginResult<TimestampNormalizationResult>> {
        const startedAt = new Date().toISOString();
        const ingestedAt = input.ingestedAt ?? ctx.now;
        const parsed = parseTimestamp(input.raw);
        let wasRepaired = false;
        let normalizedAt: string;

        if (!parsed) {
            if (input.repairPolicy === "reject") {
                return {
                    pluginName: manifest.name, pluginVersion: manifest.version, status: "failed", confidence: 0,
                    evidenceIds: [], warnings: [], errors: [{ code: "INVALID_TIMESTAMP", message: `Cannot parse timestamp: ${input.raw}` }],
                    metrics: { startedAt, completedAt: new Date().toISOString(), durationMs: 0, dbReads: 0, dbWrites: 0, vectorQueries: 0, cacheReads: 0, cacheWrites: 0, agentCalls: 0, outputSizeBytes: 0 },
                    provenance: { source: "plugin", method: "timestamp_normalization", pluginName: manifest.name, pluginVersion: manifest.version, evidenceIds: [], createdAt: ctx.now },
                };
            }
            normalizedAt = ingestedAt;
            wasRepaired = true;
        } else {
            normalizedAt = parsed.toISOString();
        }

        // Clock-skew: if timestamp is in the future (> 30s), clamp to now
        const skewMs = Date.parse(normalizedAt) - Date.parse(ctx.now);
        if (skewMs > 30_000) {
            normalizedAt = ctx.now;
            wasRepaired = true;
        }

        const result: TimestampNormalizationResult = {
            normalizedAt,
            ingestedAt,
            wasRepaired,
            timezoneMetadata: input.sourceTimezone ? { original: input.sourceTimezone } : undefined,
        };
        return successResult(manifest, result, wasRepaired ? 0.7 : 1.0, ctx, startedAt, "timestamp_normalization");
    },

    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
