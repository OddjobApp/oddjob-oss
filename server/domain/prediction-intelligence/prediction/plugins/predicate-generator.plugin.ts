import { randomUUID } from "crypto";
import type { PredictionPlugin, PluginContext, PluginDecision, PluginResult, PluginHealth } from "../../plugin-runtime/types.js";
import type { PredicateCandidate, PredicateGenerationInput } from "../types.js";
import type { Quant } from "../../quant/types.js";
import { clamp, makePredictionManifest, successResult } from "./plugin-helpers.js";

const manifest = makePredictionManifest({
    name: "predicate-generator",
    subPod: "predicate-generator",
    capability: "prediction.generate_predicates",
    description: "Generates predicate candidates from quants, realm contributions, hidden state, and memory matches.",
    inputTypes: ["PredicateGenerationInput"],
    outputTypes: ["PredicateCandidate[]"],
    timeoutMs: 20,
});

function normalizeLabel(label: string): string {
    return label
        .toLowerCase()
        .replace(/_signal$/u, "")
        .replace(/[^a-z0-9]+/gu, "_")
        .replace(/^_+|_+$/gu, "") || "context_change";
}

function labelForQuant(q: Quant): string {
    if (q.label) return normalizeLabel(q.label);
    return normalizeLabel(q.type);
}

function riskFor(label: string, quantTypes: string[]): PredicateCandidate["riskClass"] {
    if (quantTypes.includes("contradiction_signal") || label.includes("security") || label.includes("failure")) return "high";
    if (quantTypes.includes("anomaly_signal") || label.includes("risk") || label.includes("error")) return "medium";
    return "low";
}

export const predicateGeneratorPlugin: PredictionPlugin<PredicateGenerationInput, PredicateCandidate[]> = {
    manifest,
    async canHandle(input: PredicateGenerationInput): Promise<PluginDecision> {
        const ok = !!input?.context?.id && Array.isArray(input?.activeQuants);
        return {
            shouldRun: ok,
            reason: ok ? "valid predicate input" : "missing context or quants",
            priority: 95,
            estimatedCost: { latencyMs: 3, dbReads: 0, vectorQueries: 0, agentCalls: 0 },
        };
    },
    async execute(input: PredicateGenerationInput, ctx: PluginContext): Promise<PluginResult<PredicateCandidate[]>> {
        const startedAt = new Date().toISOString();
        const candidates = new Map<string, PredicateCandidate>();

        for (const quant of input.activeQuants) {
            if (quant.lifecycle.status !== "active" && quant.lifecycle.status !== "decaying") continue;
            const label = labelForQuant(quant);
            const existing = candidates.get(label);
            const signalStrength = clamp(quant.magnitude * quant.confidence * (1 - quant.uncertainty * 0.35));
            const expectedValue = quant.type === "anomaly_signal" || quant.type === "contradiction_signal" ? -0.35 : 0.25;

            if (existing) {
                existing.confidence = clamp(existing.confidence + signalStrength * 0.25);
                existing.expectedValue = clamp((existing.expectedValue + expectedValue) / 2, -1, 1);
                existing.supportingQuantIds = Array.from(new Set([...existing.supportingQuantIds, quant.id]));
                existing.riskClass = riskFor(existing.label, input.activeQuants.filter(q => existing.supportingQuantIds.includes(q.id)).map(q => q.type));
            } else {
                candidates.set(label, {
                    id: randomUUID(),
                    label,
                    source: "quant",
                    confidence: clamp(signalStrength),
                    supportingQuantIds: [quant.id],
                    supportingRealmContributionIds: [],
                    expectedValue,
                    riskClass: riskFor(label, [quant.type]),
                    createdAt: ctx.now,
                });
            }
        }

        for (const contribution of input.realmResults.contributions) {
            const concept = typeof contribution.metadata?.concept === "string" ? contribution.metadata.concept : contribution.targetId;
            if (!concept) continue;
            const label = normalizeLabel(String(concept));
            const existing = candidates.get(label);
            const delta = contribution.effect === "suppress" || contribution.effect === "increase_entropy" ? -0.1 : 0.12;
            if (existing) {
                existing.confidence = clamp(existing.confidence + contribution.amount * contribution.confidence * 0.2);
                existing.expectedValue = clamp(existing.expectedValue + delta, -1, 1);
                existing.supportingRealmContributionIds = Array.from(new Set([...existing.supportingRealmContributionIds, contribution.id]));
            }
        }

        if (input.hiddenState) {
            const label = normalizeLabel(input.hiddenState.topLabel || "unknown_state");
            candidates.set(label, {
                id: randomUUID(),
                label,
                source: "hidden_state",
                confidence: clamp(input.hiddenState.confidence),
                supportingQuantIds: input.hiddenState.candidates?.[0]?.supportingQuantIds || [],
                supportingRealmContributionIds: [],
                expectedValue: 0.15,
                riskClass: "medium",
                createdAt: ctx.now,
            });
        }

        if (input.modePlan.includePatternMemory) {
            for (const match of input.memoryMatches ?? []) {
                const label = normalizeLabel(match.label);
                candidates.set(label, {
                    id: randomUUID(),
                    label,
                    source: "pattern",
                    confidence: clamp(match.similarity ?? match.confidence),
                    supportingQuantIds: match.supportingQuantIds ?? [],
                    supportingRealmContributionIds: [],
                    expectedValue: clamp(match.expectedValue ?? 0.2, -1, 1),
                    riskClass: "medium",
                    createdAt: ctx.now,
                });
            }
        }

        if (input.quantField.fieldEntropy > 0.55 || candidates.size === 0) {
            candidates.set("request_more_evidence", {
                id: randomUUID(),
                label: "request_more_evidence",
                source: "baseline",
                confidence: clamp(input.quantField.fieldEntropy),
                supportingQuantIds: [],
                supportingRealmContributionIds: [],
                expectedValue: 0.05,
                riskClass: "medium",
                createdAt: ctx.now,
            });
        }

        const sorted = Array.from(candidates.values())
            .sort((a, b) => b.confidence - a.confidence)
            .slice(0, input.modePlan.maxBranches);

        return successResult(manifest, sorted, sorted.length > 0 ? 1 : 0, ctx, startedAt, "quant_realm_predicate_generation", sorted.flatMap(c => c.supportingQuantIds));
    },
    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
