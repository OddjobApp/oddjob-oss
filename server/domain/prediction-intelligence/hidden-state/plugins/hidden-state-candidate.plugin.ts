import { randomUUID } from "crypto";
import type { PredictionPlugin, PluginContext, PluginDecision, PluginResult, PluginHealth } from "../../plugin-runtime/types.js";
import type { HiddenStateCandidatePluginInput, HiddenStateCandidate, HiddenStateType } from "../types.js";
import {
    QUANT_TYPE_TO_STATE,
    EVENT_LABEL_KEYWORDS,
    CANDIDATE_LIMITS,
    HS_EPSILON,
} from "../types.js";
import { clamp, makeHiddenStateManifest, successResult, normaliseProbabilities } from "./plugin-helpers.js";
import type { Quant } from "../../quant/types.js";
import type { RealmContribution } from "../../quant/types.js";

const manifest = makeHiddenStateManifest({
    name: "hidden-state-candidate",
    subPod: "hidden-state-candidate",
    capability: "hidden_state.generate_candidates",
    description: "Generates hidden-state candidates from active quants, realm contributions, and memory (spec §11).",
    inputTypes: ["HiddenStateCandidatePluginInput"],
    outputTypes: ["HiddenStateCandidate[]"],
    timeoutMs: 15,
});

interface CandidateAccumulator {
    label: string;
    type: HiddenStateType;
    rawScore: number;
    supportingQuantIds: string[];
    opposingQuantIds: string[];
    realmContributionIds: string[];
    memoryIds: string[];
    count: number;
}

function labelFromEventQuant(quant: Quant): { label: string; type: HiddenStateType } {
    const lbl = (quant.label ?? "").toLowerCase();
    for (const { keywords, label, type } of EVENT_LABEL_KEYWORDS) {
        if (keywords.some(k => lbl.includes(k))) return { label, type };
    }
    return { label: "workflow_activity", type: "workflow_state" };
}

function candidateFromQuant(quant: Quant): { label: string; type: HiddenStateType } | null {
    const mapping = QUANT_TYPE_TO_STATE[quant.type];
    if (mapping) {
        // For hidden_state_signal, prefer the quant's own label if meaningful
        if (quant.type === "hidden_state_signal" && quant.label) {
            return { label: quant.label, type: mapping.type };
        }
        return mapping;
    }
    if (quant.type === "event_signal") {
        return labelFromEventQuant(quant);
    }
    return null;
}

function candidatesFromRealmContributions(contributions: RealmContribution[]): CandidateAccumulator[] {
    const acc: CandidateAccumulator[] = [];
    for (const c of contributions) {
        if (c.effect !== "boost" && c.effect !== "preserve") continue;
        if (!c.explanation) continue;

        // Map semantic realm themes to state labels
        const theme = c.explanation.toLowerCase();
        let label: string | null = null;
        let type: HiddenStateType = "semantic_state";

        if (theme.includes("workflow_instab") || theme.includes("instabilit")) {
            label = "workflow_instability"; type = "workflow_state";
        } else if (theme.includes("fraud")) {
            label = "fraud_risk"; type = "risk_state";
        } else if (theme.includes("escalat")) {
            label = "escalation_risk"; type = "risk_state";
        } else if (theme.includes("churn")) {
            label = "churn_risk"; type = "risk_state";
        } else if (theme.includes("agent_confusion") || theme.includes("confusion")) {
            label = "agent_confusion"; type = "agent_state";
        } else if (theme.includes("frustrat")) {
            label = "user_frustration"; type = "user_state";
        } else if (theme.includes("resolut")) {
            label = "resolution_emerging"; type = "resolution_state";
        } else if (theme.includes("degradat")) {
            label = "system_degradation"; type = "system_state";
        } else if (theme.includes("unknown_unknown")) {
            label = "observability_loss"; type = "epistemic_state";
        }

        if (label) {
            acc.push({
                label, type,
                rawScore: c.amount * c.confidence,
                supportingQuantIds: c.quantId ? [c.quantId] : [],
                opposingQuantIds: [],
                realmContributionIds: [c.id],
                memoryIds: [],
                count: 1,
            });
        }
    }
    return acc;
}

function mergeAccumulators(all: CandidateAccumulator[]): CandidateAccumulator[] {
    const byLabel = new Map<string, CandidateAccumulator>();
    for (const acc of all) {
        const existing = byLabel.get(acc.label);
        if (existing) {
            existing.rawScore += acc.rawScore;
            existing.supportingQuantIds.push(...acc.supportingQuantIds);
            existing.opposingQuantIds.push(...acc.opposingQuantIds);
            existing.realmContributionIds.push(...acc.realmContributionIds);
            existing.memoryIds.push(...acc.memoryIds);
            existing.count += acc.count;
        } else {
            byLabel.set(acc.label, { ...acc });
        }
    }
    return [...byLabel.values()];
}

export const hiddenStateCandidatePlugin: PredictionPlugin<HiddenStateCandidatePluginInput, HiddenStateCandidate[]> = {
    manifest,

    async canHandle(input: HiddenStateCandidatePluginInput): Promise<PluginDecision> {
        const ok = !!input?.contextId;
        return {
            shouldRun: ok,
            reason: ok ? "valid candidate input" : "missing contextId",
            priority: 100,
            estimatedCost: { latencyMs: 4, dbReads: 0, vectorQueries: 0, agentCalls: 0 },
        };
    },

    async execute(input: HiddenStateCandidatePluginInput, ctx: PluginContext): Promise<PluginResult<HiddenStateCandidate[]>> {
        const startedAt = new Date().toISOString();
        const limit = CANDIDATE_LIMITS[input.mode];

        // Accumulate candidates from quants
        const quantAccumulators: CandidateAccumulator[] = [];
        const topQuants = [...input.activeQuants]
            .sort((a, b) => b.magnitude * b.confidence - a.magnitude * a.confidence)
            .slice(0, 20);

        for (const q of topQuants) {
            if (q.lifecycle.status === "archived" || q.lifecycle.status === "collapsed") continue;
            const mapping = candidateFromQuant(q);
            if (!mapping) continue;

            quantAccumulators.push({
                label: mapping.label,
                type: mapping.type,
                rawScore: q.magnitude * q.confidence,
                supportingQuantIds: [q.id],
                opposingQuantIds: [],
                realmContributionIds: [],
                memoryIds: [],
                count: 1,
            });
        }

        // Accumulate from realm contributions
        const realmAccumulators = candidatesFromRealmContributions(input.realmContributions);

        // Accumulate from memory pattern matches
        const memoryAccumulators: CandidateAccumulator[] = [];
        for (const mem of input.memoryResults ?? []) {
            if (mem.memoryType !== "pattern" && mem.memoryType !== "short_term") continue;
            const item = mem.item as Record<string, unknown>;
            if (typeof item?.label === "string" && typeof item?.type === "string") {
                memoryAccumulators.push({
                    label: item.label,
                    type: item.type as HiddenStateType,
                    rawScore: mem.relevance * mem.confidence * 0.5,
                    supportingQuantIds: [],
                    opposingQuantIds: [],
                    realmContributionIds: [],
                    memoryIds: [mem.id],
                    count: 1,
                });
            }
        }

        const merged = mergeAccumulators([...quantAccumulators, ...realmAccumulators, ...memoryAccumulators]);

        // Always include background "normal_operation" state
        if (!merged.some(m => m.label === "normal_operation")) {
            merged.push({
                label: "normal_operation",
                type: "workflow_state",
                rawScore: 0.3,
                supportingQuantIds: [],
                opposingQuantIds: [],
                realmContributionIds: [],
                memoryIds: [],
                count: 1,
            });
        }

        // Normalise to get probabilities
        const scores = merged.map(m => Math.max(m.rawScore, HS_EPSILON));
        const probs = normaliseProbabilities(scores);

        // Build candidates
        const candidates: HiddenStateCandidate[] = merged
            .map((acc, i) => ({
                id: randomUUID(),
                contextId: input.contextId,
                label: acc.label,
                type: acc.type,
                confidence: clamp(probs[i] * (1 + acc.count * 0.05)),
                probability: clamp(probs[i]),
                activation: clamp(scores[i] / Math.max(...scores)),
                persistence: 0.2,
                entropy: 0,
                supportingQuantIds: [...new Set(acc.supportingQuantIds)],
                opposingQuantIds: [...new Set(acc.opposingQuantIds)],
                supportingEventIds: [],
                opposingEventIds: [],
                realmContributionIds: [...new Set(acc.realmContributionIds)],
                memoryIds: [...new Set(acc.memoryIds)],
                attractorIds: [],
                explanation: `Generated from ${acc.count} signal(s) with raw score ${scores[i].toFixed(3)}`,
                createdAt: ctx.now,
                updatedAt: ctx.now,
            } satisfies HiddenStateCandidate))
            .sort((a, b) => b.probability - a.probability)
            .slice(0, limit);

        return successResult(manifest, candidates, candidates.length > 0 ? 0.8 : 0, ctx, startedAt, "candidate_generation",
            candidates.flatMap(c => c.supportingQuantIds));
    },

    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
