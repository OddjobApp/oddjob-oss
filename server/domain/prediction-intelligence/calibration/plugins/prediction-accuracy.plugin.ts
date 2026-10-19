import { randomUUID } from "crypto";
import type { PredictionPlugin, PluginContext, PluginDecision, PluginResult, PluginHealth } from "../../plugin-runtime/types.js";
import type { PredictionAccuracyPluginInput, CalibrationOutcome, TrueBranchStatus } from "../types.js";
import {
    OVERCONFIDENCE_THRESHOLD, UNDERCONFIDENCE_THRESHOLD, LUCKY_CORRECT_THRESHOLD,
    MIN_MATCH_SCORE_FOR_CORRECTNESS,
} from "../types.js";
import { clamp, makeCalibrationManifest, successResult, brierScore, logLoss } from "./plugin-helpers.js";

const manifest = makeCalibrationManifest({
    name: "prediction-accuracy",
    subPod: "prediction-accuracy",
    capability: "calibration.prediction_accuracy",
    description: "Scores prediction accuracy against observed outcome and computes Brier score, log loss, and error flags (spec §14-§16).",
    inputTypes: ["PredictionAccuracyPluginInput"],
    outputTypes: ["CalibrationOutcome"],
    timeoutMs: 10,
});

export const predictionAccuracyPlugin: PredictionPlugin<PredictionAccuracyPluginInput, CalibrationOutcome> = {
    manifest,

    async canHandle(input: PredictionAccuracyPluginInput): Promise<PluginDecision> {
        const ok = !!input?.contextId && !!input?.bestMatch;
        return { shouldRun: ok, reason: ok ? "valid accuracy input" : "missing contextId or bestMatch", priority: 90, estimatedCost: { latencyMs: 1, dbReads: 0, vectorQueries: 0, agentCalls: 0 } };
    },

    async execute(input: PredictionAccuracyPluginInput, ctx: PluginContext): Promise<PluginResult<CalibrationOutcome>> {
        const startedAt = new Date().toISOString();
        const { bestMatch, confidence, entropy, pruningDecisions } = input;

        const topPredictionCorrect = bestMatch.matchType !== "missed" && bestMatch.matchScore >= MIN_MATCH_SCORE_FOR_CORRECTNESS;
        const matchedBranch = bestMatch.matchedBranchId
            ? input.branches.find(b => b.id === bestMatch.matchedBranchId)
            : null;

        const trueBranchPresent = !!matchedBranch;
        let trueBranchStatus: TrueBranchStatus | undefined;

        if (matchedBranch) {
            const rawStatus = matchedBranch.status as string;
            trueBranchStatus = rawStatus as TrueBranchStatus;
        } else if (!topPredictionCorrect) {
            trueBranchStatus = "missing";
        }

        // Check if matched branch was pruned
        const wasPruned = pruningDecisions?.some(d => d.branchId === bestMatch.matchedBranchId && d.newStatus === "pruned") ?? false;
        const falsePrune = wasPruned && topPredictionCorrect;
        if (falsePrune) trueBranchStatus = "pruned";

        const bs = brierScore(confidence, topPredictionCorrect);
        const ll = logLoss(confidence, topPredictionCorrect);
        const predictionError = clamp(Math.abs(confidence - (topPredictionCorrect ? 1 : 0)));
        const calibrationError = predictionError;
        const calibratedConfidence = clamp(topPredictionCorrect ? confidence * 1.05 : confidence * 0.9);

        const overconfident = !topPredictionCorrect && confidence >= OVERCONFIDENCE_THRESHOLD;
        const underconfident = topPredictionCorrect && confidence <= UNDERCONFIDENCE_THRESHOLD;
        const luckyCorrect = topPredictionCorrect && confidence <= LUCKY_CORRECT_THRESHOLD;
        const falsePositive = !topPredictionCorrect && confidence >= OVERCONFIDENCE_THRESHOLD;
        const falseNegative = !topPredictionCorrect && trueBranchStatus === "missing";

        const parts: string[] = [];
        if (topPredictionCorrect) parts.push(`correctly predicted '${bestMatch.matchedPredicate}' as ${bestMatch.matchType} match (score=${bestMatch.matchScore.toFixed(3)})`);
        else parts.push(`missed prediction — best match '${bestMatch.matchedPredicate ?? "none"}' had score ${bestMatch.matchScore.toFixed(3)}`);
        if (overconfident) parts.push("overconfident");
        if (underconfident) parts.push("underconfident");
        if (falsePrune) parts.push("FALSE PRUNE: true branch was pruned");
        if (luckyCorrect) parts.push("lucky correct");

        const calibOutcome: CalibrationOutcome = {
            id: randomUUID(),
            contextId: input.contextId,
            predictionId: input.predictionId,
            outcomeId: input.outcome.id,
            outcomeMatchId: bestMatch.id,
            topPredictionCorrect,
            trueBranchPresent,
            trueBranchStatus,
            confidenceAtPrediction: clamp(confidence),
            entropyAtPrediction: clamp(entropy),
            calibratedConfidence,
            predictionError,
            calibrationError,
            brierScore: bs,
            logLoss: ll,
            falsePositive,
            falseNegative,
            falsePrune,
            luckyCorrect,
            overconfident,
            underconfident,
            explanation: parts.join("; "),
            createdAt: ctx.now,
        };

        return successResult(manifest, calibOutcome, topPredictionCorrect ? 0.9 : 0.6, ctx, startedAt, "prediction_accuracy");
    },

    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
