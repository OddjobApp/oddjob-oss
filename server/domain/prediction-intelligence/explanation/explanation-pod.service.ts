// ============================================================================
// PREDICTION INTELLIGENCE DOMAIN — EXPLANATION POD SERVICE
// MVP implementation per spec §55
// ============================================================================

import { randomUUID } from "crypto";
import { db } from "@server/database_service.js";
import { createLogger } from "@server/utils/logger.js";
import {
    predictionExplanations as explTable,
    explanationAuditLogs as auditTable,
} from "@shared/schema/prediction/explanation.js";
import type { DomainContext } from "../quant/types.js";
import type {
    ExplanationPort,
    PredictionExplanation,
    PredictionExplanationInput,
    BranchNarrative,
    BranchExplanationInput,
    HiddenStateNarrative,
    HiddenStateExplanationInput,
    CounterfactualExplanation,
    CounterfactualInput,
    PredictionDiffExplanation,
    PredictionDiffInput,
    RenderedExplanation,
    ExplanationRenderInput,
    ExplanationEvidence,
    ExplanationRealmContribution,
    ConfidenceNarrative,
    EntropyNarrative,
    GovernanceNarrative,
    EpistemicNarrative,
} from "./types.js";

const logger = createLogger("ExplanationPod");

function clamp(v: number, min = 0, max = 1): number {
    return !Number.isFinite(v) ? min : Math.max(min, Math.min(max, v));
}

class ExplanationPod implements ExplanationPort {

    async explainPrediction(input: PredictionExplanationInput, ctx: DomainContext): Promise<PredictionExplanation> {
        const now = ctx.now;
        const id = randomUUID();

        // Supporting evidence from branches
        const supporting: ExplanationEvidence[] = input.branches
            .filter(b => b.status === "active" || b.status === "candidate")
            .slice(0, 5)
            .map(b => ({
                id: b.id,
                evidenceType: "quant" as const,
                label: b.predicate,
                contribution: clamp(b.branchScore),
                confidence: clamp(b.confidence),
                polarity: "supporting" as const,
                explanation: `Branch '${b.predicate}' (p=${b.probability.toFixed(3)}, score=${b.branchScore.toFixed(3)})`,
                references: b.supportingQuantIds.slice(0, 3),
            }));

        const contradicting: ExplanationEvidence[] = input.branches
            .filter(b => b.status === "pruned" || b.status === "suppressed")
            .slice(0, 3)
            .map(b => ({
                id: b.id,
                evidenceType: "quant" as const,
                label: b.predicate,
                contribution: clamp(1 - b.branchScore),
                confidence: clamp(b.confidence),
                polarity: "contradicting" as const,
                explanation: `Branch '${b.predicate}' was ${b.status} (score=${b.branchScore.toFixed(3)})`,
                references: b.interferingQuantIds.slice(0, 2),
            }));

        // Realm narratives
        const topRealms: ExplanationRealmContribution[] = Object.entries(
            (input.realmResults?.contributions ?? []).reduce<Record<string, number>>((acc, c) => {
                acc[c.realm] = (acc[c.realm] ?? 0) + c.amount * c.confidence;
                return acc;
            }, {})
        )
            .sort(([, a], [, b]) => b - a)
            .slice(0, 5)
            .map(([realm, total]) => ({
                realm,
                contribution: clamp(total),
                confidence: clamp(input.realmResults?.agreement?.score ?? 0.7),
                agreementScore: clamp(input.realmResults?.agreement?.score ?? 0.7),
                explanation: `Realm '${realm}' contributed ${total.toFixed(3)}`,
            }));

        // Branch narratives
        const branchNarratives = input.branches.slice(0, 8).map(b => ({
            branchId: b.id,
            predicate: b.predicate,
            status: b.status as BranchNarrative["status"],
            probability: b.probability,
            contribution: clamp(b.branchScore),
            explanation: `'${b.predicate}' has probability ${b.probability.toFixed(3)} and score ${b.branchScore.toFixed(3)}`,
            pruneReason: b.prunedReason ?? undefined,
        }));

        // Hidden state narratives
        const hiddenStateNarratives: HiddenStateNarrative[] = [];
        for (const hs of input.hiddenStates ?? []) {
            const top = hs.candidates[0];
            if (top) {
                hiddenStateNarratives.push({
                    hiddenStateId: hs.id,
                    label: top.label,
                    probability: top.probability,
                    confidence: top.confidence,
                    evidenceIds: top.supportingQuantIds.slice(0, 4),
                    explanation: `Hidden state '${top.label}' at confidence ${top.confidence.toFixed(3)}${hs.collapseDetected ? " (collapsed)" : ""}${hs.splitDetected ? " (split detected)" : ""}`,
                });
            }
        }

        // Confidence narrative
        const confidenceNarrative: ConfidenceNarrative = {
            confidence: clamp(input.confidence),
            calibrationAdjusted: false,
            supportingWeight: clamp(supporting.reduce((s, e) => s + e.contribution, 0) / Math.max(supporting.length, 1)),
            contradictoryWeight: clamp(contradicting.reduce((s, e) => s + e.contribution, 0) / Math.max(contradicting.length, 1)),
            explanation: `Confidence ${(input.confidence * 100).toFixed(1)}% from ${supporting.length} supporting and ${contradicting.length} contradicting signals`,
        };

        // Entropy narrative
        const entropyNarrative: EntropyNarrative = {
            entropy: clamp(input.entropy),
            disagreementLevel: clamp(input.entropy),
            branchDiversity: clamp(input.branches.length / 10),
            explanation: `Entropy ${input.entropy.toFixed(3)} with ${input.branches.length} active branches`,
        };

        // Governance narrative
        let governanceNarrative: GovernanceNarrative | undefined;
        if (input.governanceDecision) {
            const g = input.governanceDecision;
            governanceNarrative = {
                decision: g.decision,
                riskClass: g.riskClass,
                actionAuthority: g.maxActionLevel,
                constraints: g.constraints.map(c => c.reason),
                redactions: g.redactions.map(r => r.field),
                explanation: `Governance: ${g.decision} (risk=${g.riskClass}, max_action=${g.maxActionLevel}). ${g.reason}`,
            };
        }

        // Epistemic narrative
        let epistemicNarrative: EpistemicNarrative | undefined;
        if (input.hiddenStates && input.hiddenStates.length > 0) {
            const topHS = input.hiddenStates[0];
            const unknownUnknownPressure = clamp(topHS.entropy);
            epistemicNarrative = {
                knownKnowns: topHS.candidates.filter(c => c.type !== "epistemic_state").map(c => c.label).slice(0, 3),
                knownUnknowns: topHS.candidates.filter(c => c.type === "epistemic_state").map(c => c.label).slice(0, 2),
                unknownKnownSignals: [],
                unknownUnknownPressure,
                uncertaintySummary: `Entropy ${topHS.entropy.toFixed(3)}, ${topHS.candidates.length} candidate states`,
                explanation: `Hidden-state uncertainty: ${topHS.splitDetected ? "split detected — multiple plausible states" : topHS.collapseDetected ? "collapsed to dominant state" : "moderate uncertainty"}`,
            };
        }

        // Generate summary
        const topBranch = input.branches.find(b => b.status === "active") ?? input.branches[0];
        const topRealm = topRealms[0];
        const summaryParts: string[] = [];
        if (topBranch) summaryParts.push(`The engine predicts '${topBranch.predicate}' with ${(input.confidence * 100).toFixed(0)}% confidence`);
        if (topRealm) summaryParts.push(`driven primarily by the ${topRealm.realm} realm (contribution=${topRealm.contribution.toFixed(3)})`);
        if (hiddenStateNarratives[0]) summaryParts.push(`with hidden state '${hiddenStateNarratives[0].label}' at ${(hiddenStateNarratives[0].probability * 100).toFixed(0)}%`);
        if (input.entropy > 0.6) summaryParts.push(`Note: high uncertainty (entropy=${input.entropy.toFixed(3)}) — multiple futures remain plausible`);
        const summary = summaryParts.join(". ") || "Prediction summary unavailable.";

        const explanation: PredictionExplanation = {
            id,
            predictionId: input.predictionId,
            contextId: input.contextId,
            explanationType: input.explanationType,
            summary,
            supportingEvidence: supporting,
            contradictoryEvidence: contradicting,
            topQuants: [],
            topRealms,
            hiddenStateNarratives,
            branchNarratives,
            causalNarratives: [],
            epistemicNarrative,
            governanceNarrative,
            confidenceNarrative,
            entropyNarrative,
            explanationScore: clamp(0.6 + input.confidence * 0.3 + (topRealms.length > 0 ? 0.1 : 0)),
            audience: input.audience,
            redactions: input.governanceDecision?.redactions.map(r => ({ field: r.field, action: "mask" as const, reason: r.reason })) ?? [],
            createdAt: now,
        };

        // Persist async
        db.insert(explTable).values({
            id,
            predictionId: input.predictionId as unknown as string,
            contextId: input.contextId as unknown as string,
            explanationType: input.explanationType,
            audience: input.audience,
            summary,
            explanationScore: explanation.explanationScore,
            payload: { topRealms, branchNarratives, confidenceNarrative } as any,
            createdAt: new Date(now),
        }).onConflictDoNothing().then(() =>
            db.insert(auditTable).values({
                id: randomUUID(),
                explanationId: id as unknown as string,
                audience: input.audience,
                governanceVersion: null,
                redactions: explanation.redactions as any,
                pluginsUsed: ["prediction-explanation-service"] as unknown as string[],
                createdAt: new Date(now),
                payload: {},
            }).onConflictDoNothing()
        ).catch(err => logger.warn("explanation persistence failed", { err: String(err) }));

        return explanation;
    }

    async explainBranch(input: BranchExplanationInput, ctx: DomainContext): Promise<BranchNarrative> {
        const b = input.branch;
        return {
            branchId: b.id,
            predicate: b.predicate,
            status: b.status as BranchNarrative["status"],
            probability: b.probability,
            contribution: clamp(b.branchScore),
            explanation: `Branch '${b.predicate}' with probability ${b.probability.toFixed(3)}, supported by ${b.supportingQuantIds.length} quants${input.pruneReason ? ` — pruned: ${input.pruneReason}` : ""}`,
            pruneReason: input.pruneReason,
        };
    }

    async explainHiddenState(input: HiddenStateExplanationInput, ctx: DomainContext): Promise<HiddenStateNarrative> {
        const top = input.hiddenState.candidates[0];
        return {
            hiddenStateId: input.hiddenState.id,
            label: top?.label ?? "unknown",
            probability: top?.probability ?? 0,
            confidence: top?.confidence ?? 0,
            evidenceIds: top?.supportingQuantIds.slice(0, 4) ?? [],
            explanation: `Hidden state '${top?.label ?? "unknown"}' inferred from ${top?.supportingQuantIds.length ?? 0} supporting signals`,
        };
    }

    async explainCounterfactual(input: CounterfactualInput, ctx: DomainContext): Promise<CounterfactualExplanation[]> {
        // MVP: generate simple counterfactuals from suppressed branches
        return input.branches
            .filter(b => b.status === "suppressed" && b.probability > 0.05)
            .slice(0, 3)
            .map(b => ({
                id: randomUUID(),
                changedCondition: `If supporting evidence for '${b.predicate}' had been stronger`,
                changedPrediction: b.predicate,
                probabilityShift: clamp(b.probability * 0.4),
                explanation: `Suppressed branch '${b.predicate}' (p=${b.probability.toFixed(3)}) would have become dominant if its score had been ${(b.branchScore * 1.5).toFixed(3)} instead of ${b.branchScore.toFixed(3)}`,
            }));
    }

    async explainDiff(input: PredictionDiffInput, ctx: DomainContext): Promise<PredictionDiffExplanation> {
        const confShift = (input.currentConfidence - (input.previousConfidence ?? input.currentConfidence));
        const entropyShift = (input.currentEntropy - (input.previousEntropy ?? input.currentEntropy));
        const changes: string[] = [];
        if (Math.abs(confShift) > 0.05) changes.push(`Confidence ${confShift > 0 ? "increased" : "decreased"} by ${Math.abs(confShift * 100).toFixed(1)}%`);
        if (Math.abs(entropyShift) > 0.05) changes.push(`Entropy ${entropyShift > 0 ? "increased" : "decreased"} by ${Math.abs(entropyShift).toFixed(3)}`);
        changes.push(...(input.branchChanges ?? []));

        return {
            id: randomUUID(),
            predictionId: input.predictionId,
            contextId: input.contextId,
            changes,
            confidenceShift: clamp(Math.abs(confShift)),
            entropyShift: clamp(Math.abs(entropyShift)),
            branchChanges: input.branchChanges ?? [],
            explanation: changes.length > 0 ? changes.join(". ") : "No significant changes detected",
            createdAt: ctx.now,
        };
    }

    async render(input: ExplanationRenderInput, ctx: DomainContext): Promise<RenderedExplanation> {
        const { explanation, audience, format = "text" } = input;
        let content: string;

        if (format === "json") {
            content = JSON.stringify({ summary: explanation.summary, topRealms: explanation.topRealms, confidence: explanation.confidenceNarrative, entropy: explanation.entropyNarrative }, null, 2);
        } else if (format === "markdown") {
            content = `## Prediction Explanation\n\n**Summary:** ${explanation.summary}\n\n**Confidence:** ${explanation.confidenceNarrative?.confidence.toFixed(3)}\n\n**Top Realms:**\n${explanation.topRealms.map(r => `- ${r.realm}: ${r.contribution.toFixed(3)}`).join("\n")}`;
        } else {
            // Plain text, audience-appropriate
            const isOperator = audience === "operator" || audience === "user";
            content = isOperator
                ? explanation.summary
                : `${explanation.summary}\n\nTop realms: ${explanation.topRealms.slice(0, 3).map(r => `${r.realm}(${r.contribution.toFixed(3)})`).join(", ")}\n\nBranches: ${explanation.branchNarratives.slice(0, 3).map(b => `${b.predicate}(p=${b.probability.toFixed(3)})`).join(", ")}`;
        }

        // Apply redactions
        for (const r of input.governanceDecision?.redactions ?? []) {
            content = content.replace(new RegExp(r.field, "gi"), "[REDACTED]");
        }

        return {
            id: randomUUID(),
            explanationId: explanation.id,
            audience,
            format,
            content,
            createdAt: ctx.now,
        };
    }
}

export const explanationPod = new ExplanationPod();
export type { ExplanationPod };
