import type { PredictionPlugin, PluginContext, PluginDecision, PluginResult, PluginHealth } from "../../plugin-runtime/types.js";
import type { SignificanceScoringPluginInput, DiffRecord } from "../types.js";
import { PREDICTION_IMPACT_WEIGHT } from "../types.js";
import { clamp, makeDiffManifest, successResult } from "./plugin-helpers.js";

const manifest = makeDiffManifest({
    name: "significance-scoring",
    subPod: "significance-scoring",
    capability: "diff.significance_scoring",
    description: "Scores how important each diff is using the full significance formula (spec §25).",
    inputTypes: ["SignificanceScoringPluginInput"],
    outputTypes: ["DiffRecord[]"],
    timeoutMs: 8,
});

function computeSignificance(diff: DiffRecord, baselineDeviation: number, realmAgreement: number): number {
    const predictionImpact = PREDICTION_IMPACT_WEIGHT[diff.type] ?? 0.65;
    // velocity_weight: 1 + (velocity/10) * 0.3 → max 1.3 at velocity=10
    const velocityWeight = diff.velocity != null ? clamp(1 + (diff.velocity / 10) * 0.3, 1, 1.3) : 1.0;
    // acceleration_weight: 1 + (acceleration/10) * 0.2 → max 1.2 at acceleration=10
    const accelerationWeight = diff.acceleration != null ? clamp(1 + (diff.acceleration / 10) * 0.2, 1, 1.2) : 1.0;
    const anomalyWeight = diff.anomalyDetected ? 1.35 : 1.0;
    const entropyBoost = diff.entropyDelta != null && Math.abs(diff.entropyDelta) > 0.2 ? 1.1 : 1.0;

    const raw = diff.magnitude
        * velocityWeight
        * accelerationWeight
        * predictionImpact
        * anomalyWeight
        * baselineDeviation
        * realmAgreement
        * entropyBoost;

    return clamp(raw);
}

export const significanceScoringPlugin: PredictionPlugin<SignificanceScoringPluginInput, DiffRecord[]> = {
    manifest,

    async canHandle(input: SignificanceScoringPluginInput): Promise<PluginDecision> {
        const ok = !!input?.contextId && Array.isArray(input?.diffs);
        return {
            shouldRun: ok,
            reason: ok ? "valid significance input" : "missing contextId or diffs",
            priority: 75,
            estimatedCost: { latencyMs: 1, dbReads: 0, vectorQueries: 0, agentCalls: 0 },
        };
    },

    async execute(input: SignificanceScoringPluginInput, ctx: PluginContext): Promise<PluginResult<DiffRecord[]>> {
        const startedAt = new Date().toISOString();
        const baselineDeviation = clamp(input.baselineDeviation ?? 1.0, 0.5, 1.5);
        const realmAgreement = clamp(input.realmAgreementScore ?? 0.7);

        const scored: DiffRecord[] = input.diffs.map(diff => ({
            ...diff,
            significance: computeSignificance(diff, baselineDeviation, realmAgreement),
        }));

        scored.sort((a, b) => b.significance - a.significance);

        const avgSig = scored.length > 0 ? scored.reduce((s, d) => s + d.significance, 0) / scored.length : 0;
        return successResult(manifest, scored, clamp(avgSig), ctx, startedAt, "significance_scoring");
    },

    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
