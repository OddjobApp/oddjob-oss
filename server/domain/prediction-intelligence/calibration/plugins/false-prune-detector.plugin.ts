import { randomUUID } from "crypto";
import type { PredictionPlugin, PluginContext, PluginDecision, PluginResult, PluginHealth } from "../../plugin-runtime/types.js";
import type { FalsePruneDetectorPluginInput, CalibrationSignal } from "../types.js";
import { clamp, makeCalibrationManifest, successResult } from "./plugin-helpers.js";

const manifest = makeCalibrationManifest({
    name: "false-prune-detector",
    subPod: "false-prune-detector",
    capability: "calibration.false_prune_detection",
    description: "Detects when pruned branches matched the observed outcome and emits pruning rule adjustment signals (spec §20).",
    inputTypes: ["FalsePruneDetectorPluginInput"],
    outputTypes: ["CalibrationSignal[]"],
    timeoutMs: 8,
});

export const falsePruneDetectorPlugin: PredictionPlugin<FalsePruneDetectorPluginInput, CalibrationSignal[]> = {
    manifest,

    async canHandle(input: FalsePruneDetectorPluginInput): Promise<PluginDecision> {
        const ok = !!input?.calibrationOutcome && Array.isArray(input?.pruningDecisions);
        return { shouldRun: ok, reason: ok ? "valid false prune input" : "missing calibrationOutcome or pruningDecisions", priority: 88, estimatedCost: { latencyMs: 1, dbReads: 0, vectorQueries: 0, agentCalls: 0 } };
    },

    async execute(input: FalsePruneDetectorPluginInput, ctx: PluginContext): Promise<PluginResult<CalibrationSignal[]>> {
        const startedAt = new Date().toISOString();
        const signals: CalibrationSignal[] = [];

        if (!input.calibrationOutcome.falsePrune) {
            return successResult(manifest, [], 1.0, ctx, startedAt, "false_prune_detection");
        }

        const matchedBranchId = input.calibrationOutcome.outcomeMatchId;
        const prunedDecision = input.pruningDecisions.find(d =>
            d.branchId === input.calibrationOutcome.outcomeMatchId ||
            input.branches.some(b => b.id === d.branchId && b.id === input.calibrationOutcome.outcomeMatchId)
        );

        const pluginName = prunedDecision?.pluginName ?? "unknown-pruning-plugin";
        const confidence = clamp(input.calibrationOutcome.confidenceAtPrediction * 0.8);

        // Signal 1: preserve this branch predicate more often
        signals.push({
            id: randomUUID(),
            contextId: input.calibrationOutcome.contextId,
            targetType: "pruning_rule",
            targetName: pluginName,
            signalType: "preserve_branch_more_often",
            amount: clamp(1 - (prunedDecision?.scoreBefore ?? 0.1)),
            confidence,
            reason: `False prune detected: branch '${prunedDecision?.branchId ?? matchedBranchId}' was pruned by '${pluginName}' but matched the observed outcome. Score at prune: ${(prunedDecision?.scoreBefore ?? 0).toFixed(3)}`,
            evidenceIds: [input.calibrationOutcome.outcomeId],
            createdAt: ctx.now,
        });

        // Signal 2: decrease confidence in the pruning plugin
        signals.push({
            id: randomUUID(),
            contextId: input.calibrationOutcome.contextId,
            targetType: "plugin",
            targetName: pluginName,
            signalType: "decrease_confidence",
            amount: 0.05,
            confidence,
            reason: `False prune by '${pluginName}' requires confidence reduction`,
            evidenceIds: [input.calibrationOutcome.outcomeId],
            createdAt: ctx.now,
        });

        return successResult(manifest, signals, confidence, ctx, startedAt, "false_prune_detection",
            [input.calibrationOutcome.outcomeId]);
    },

    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
