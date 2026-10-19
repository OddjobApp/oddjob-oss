import type { PredictionPlugin, PluginContext, PluginDecision, PluginResult, PluginHealth } from "../../plugin-runtime/types.js";
import type { ConfidenceGatingPluginInput, ActionAuthorityLevel, RiskClass } from "../types.js";
import { CONFIDENCE_GATE, MAX_AUTHORITY_BY_RISK, RISK_CLASS_RANK } from "../types.js";
import { makeGovManifest, successResult, minAuthority } from "./plugin-helpers.js";

interface ConfidenceGatingOutput { gatedActionLevel: ActionAuthorityLevel; reason: string }

const manifest = makeGovManifest({
    name: "confidence-gating",
    subPod: "confidence-gating",
    capability: "governance.confidence_gating",
    description: "Determines max action authority from confidence, entropy, and risk class (spec §25).",
    inputTypes: ["ConfidenceGatingPluginInput"],
    outputTypes: ["ConfidenceGatingOutput"],
    timeoutMs: 5,
});

function confidenceToMaxLevel(confidence: number, entropy: number): ActionAuthorityLevel {
    // High entropy lowers the confidence cap
    const effectiveConf = confidence * (1 - entropy * 0.3);
    if (effectiveConf < CONFIDENCE_GATE.explain) return "observe";
    if (effectiveConf < CONFIDENCE_GATE.suggest) return "explain";
    if (effectiveConf < CONFIDENCE_GATE.notify) return "suggest";
    if (effectiveConf < CONFIDENCE_GATE.ask_confirmation) return "notify";
    if (effectiveConf < CONFIDENCE_GATE.automate_low_risk) return "ask_confirmation";
    if (effectiveConf < CONFIDENCE_GATE.automate_high_risk) return "automate_low_risk";
    return "automate_high_risk";
}

export const confidenceGatingPlugin: PredictionPlugin<ConfidenceGatingPluginInput, ConfidenceGatingOutput> = {
    manifest,

    async canHandle(): Promise<PluginDecision> {
        return { shouldRun: true, reason: "always gate on confidence", priority: 90, estimatedCost: { latencyMs: 0, dbReads: 0, vectorQueries: 0, agentCalls: 0 } };
    },

    async execute(input: ConfidenceGatingPluginInput, ctx: PluginContext): Promise<PluginResult<ConfidenceGatingOutput>> {
        const startedAt = new Date().toISOString();

        // Max from confidence + entropy
        const confLevel = confidenceToMaxLevel(input.confidence, input.entropy);

        // Max from risk class
        const riskLevel = MAX_AUTHORITY_BY_RISK[input.riskClass];

        // Unknown-unknown epistemic → cap at observe
        const epistemicLevel: ActionAuthorityLevel = input.epistemicStatus === "unknown_unknown"
            ? "observe"
            : "automate_high_risk";

        // Take most restrictive
        const gatedActionLevel = minAuthority(minAuthority(confLevel, riskLevel), epistemicLevel);

        const reasons: string[] = [
            `confidence ${input.confidence.toFixed(3)} (entropy ${input.entropy.toFixed(3)}) → max ${confLevel}`,
            `risk ${input.riskClass} → max ${riskLevel}`,
        ];
        if (input.epistemicStatus === "unknown_unknown") reasons.push("unknown-unknown epistemic → observe only");

        return successResult(manifest, {
            gatedActionLevel,
            reason: reasons.join("; "),
        }, 1.0, ctx, startedAt, "confidence_gating");
    },

    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
