import type { PredictionPlugin, PluginContext, PluginDecision, PluginResult, PluginHealth } from "../../plugin-runtime/types.js";
import type { RiskClassificationInput, RiskClassificationResult, RiskClass, ActionAuthorityLevel } from "../types.js";
import { RISK_CLASS_RANK, ACTION_AUTHORITY_RANK } from "../types.js";
import { clamp, makeGovManifest, successResult } from "./plugin-helpers.js";

const manifest = makeGovManifest({
    name: "risk-classification",
    subPod: "risk-classification",
    capability: "governance.risk_classification",
    description: "Classifies risk of a prediction or action using impact, probability, irreversibility, sensitivity, and uncertainty (spec §23).",
    inputTypes: ["RiskClassificationInput"],
    outputTypes: ["RiskClassificationResult"],
    timeoutMs: 8,
});

const AUTHORITY_IMPACT: Record<ActionAuthorityLevel, number> = {
    observe: 0.05, explain: 0.1, suggest: 0.2, notify: 0.35,
    ask_confirmation: 0.5, automate_low_risk: 0.7, automate_high_risk: 0.95, block: 0,
};

function scoreToRiskClass(score: number): RiskClass {
    if (score >= 0.90) return "catastrophic";
    if (score >= 0.70) return "critical";
    if (score >= 0.50) return "high";
    if (score >= 0.30) return "medium";
    if (score >= 0.10) return "low";
    return "none";
}

export const riskClassificationPlugin: PredictionPlugin<RiskClassificationInput, RiskClassificationResult> = {
    manifest,

    async canHandle(): Promise<PluginDecision> {
        return { shouldRun: true, reason: "always classify risk", priority: 95, estimatedCost: { latencyMs: 1, dbReads: 0, vectorQueries: 0, agentCalls: 0 } };
    },

    async execute(input: RiskClassificationInput, ctx: PluginContext): Promise<PluginResult<RiskClassificationResult>> {
        const startedAt = new Date().toISOString();
        const factors: RiskClassificationResult["factors"] = [];

        // Impact severity: from requested action level
        const impactSeverity = AUTHORITY_IMPACT[input.requestedActionLevel] ?? 0.3;
        factors.push({ name: "impact_severity", value: impactSeverity, explanation: `action level '${input.requestedActionLevel}' implies impact ${impactSeverity.toFixed(2)}` });

        // Probability: from confidence
        const probability = clamp(input.confidence);
        factors.push({ name: "probability", value: probability, explanation: `prediction confidence ${probability.toFixed(3)}` });

        // Irreversibility
        const irreversibility = input.irreversible ? 0.9 : 0.4;
        factors.push({ name: "irreversibility", value: irreversibility, explanation: input.irreversible ? "action is irreversible" : "action is reversible" });

        // Sensitivity weight
        let sensitivityWeight = 1.0;
        if (input.sensitivity?.sensitivityLevel === "restricted") sensitivityWeight = 1.8;
        else if (input.sensitivity?.sensitivityLevel === "high") sensitivityWeight = 1.4;
        else if (input.sensitivity?.sensitivityLevel === "medium") sensitivityWeight = 1.2;
        factors.push({ name: "sensitivity_weight", value: sensitivityWeight, explanation: `sensitivity level: ${input.sensitivity?.sensitivityLevel ?? "none"}` });

        // Uncertainty weight: from entropy
        const entropy = clamp(input.entropy ?? 0.5);
        const uncertaintyWeight = clamp(1 + entropy * 0.5, 1, 1.5);
        factors.push({ name: "uncertainty_weight", value: uncertaintyWeight, explanation: `entropy ${entropy.toFixed(3)} → uncertainty factor ${uncertaintyWeight.toFixed(3)}` });

        // Cascade potential: high if hidden-state split or critical branches
        const splitDetected = input.hiddenState?.splitDetected ?? false;
        const criticalBranch = input.branches?.some(b => b.postPredicates.some(p => p.toLowerCase().includes("escalat") || p.toLowerCase().includes("fail"))) ?? false;
        const cascadePotential = (splitDetected || criticalBranch) ? 1.25 : 1.0;
        factors.push({ name: "cascade_potential", value: cascadePotential, explanation: splitDetected ? "hidden-state split detected" : criticalBranch ? "critical branch present" : "no cascade signal" });

        // Risk score formula (spec §23)
        const rawScore = impactSeverity * probability * irreversibility * sensitivityWeight * cascadePotential * uncertaintyWeight;
        const score = clamp(rawScore / 2);  // normalise: divide by 2 since max theoretical ~2.0
        const riskClass = scoreToRiskClass(score);

        return successResult(manifest, {
            riskClass,
            score,
            factors,
            explanation: `Risk score ${score.toFixed(3)} → ${riskClass} (impact=${impactSeverity.toFixed(2)}, p=${probability.toFixed(2)}, irrev=${irreversibility.toFixed(2)}, sens=${sensitivityWeight.toFixed(2)}, cascade=${cascadePotential.toFixed(2)}, unc=${uncertaintyWeight.toFixed(2)})`,
        }, 0.9, ctx, startedAt, "risk_classification");
    },

    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
