import { randomUUID } from "crypto";
import { db } from "@server/database_service.js";
import { createLogger } from "@server/utils/logger.js";
import { eq, desc } from "drizzle-orm";
import {
    hiddenStateEstimates as estimatesTable,
    hiddenStateCandidates as candidatesTable,
    hiddenStateTransitions as transitionsTable,
    hiddenStateSplits as splitsTable,
    hiddenStateInfluences as influencesTable,
} from "@shared/schema/prediction/hidden-state.js";
import { createPluginContext } from "../plugin-runtime/plugin-runtime.js";
import type { DomainContext } from "../quant/types.js";
import type {
    HiddenStatePort,
    HiddenStateEstimate,
    HiddenStateEstimateInput,
    HiddenStateCandidate,
    HiddenStateCandidateInput,
    HiddenStateScoringInput,
    HiddenStateTransition,
    HiddenStateTransitionInput,
    HiddenStateSplit,
    HiddenStateSplitInput,
    HiddenStateCollapseSignal,
    HiddenStateCollapseInput,
    HiddenStateInfluence,
    HiddenStateInfluenceInput,
    PredictionMode,
} from "./types.js";
import { CANDIDATE_LIMITS, COLLAPSE_CONFIDENCE_THRESHOLD, SPLIT_TENSION_THRESHOLD } from "./types.js";
import { hiddenStateCandidatePlugin } from "./plugins/hidden-state-candidate.plugin.js";
import { hiddenStateScorerPlugin } from "./plugins/hidden-state-scorer.plugin.js";
import { hiddenStateEntropyPlugin } from "./plugins/hidden-state-entropy.plugin.js";
import { hiddenStatePersistencePlugin } from "./plugins/hidden-state-persistence.plugin.js";
import { hiddenStateInfluencePlugin } from "./plugins/hidden-state-influence.plugin.js";
import { clamp, shannonEntropy } from "./plugins/plugin-helpers.js";

const logger = createLogger("HiddenStatePod");
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function isUuid(value: string | undefined): value is string {
    return typeof value === "string" && UUID_PATTERN.test(value);
}

function domainCtxToPluginCtx(domainCtx: DomainContext, contextId: string) {
    return createPluginContext({
        contextId,
        mode: domainCtx.mode,
        requestId: domainCtx.requestId,
        correlationId: domainCtx.correlationId,
        permissions: {
            canWriteInferences: true,
            canWritePredictions: false,
            canCallAgents: false,
            canReadSensitiveData: false,
            canUseGeographicData: false,
            canUseSpatialData: false,
        },
    });
}

async function persistEstimate(estimate: HiddenStateEstimate): Promise<void> {
    if (process.env.NODE_ENV === "test") return;
    if (!isUuid(estimate.contextId)) return;
    try {
        const now = new Date(estimate.createdAt);

        await db.insert(estimatesTable).values({
            id: estimate.id,
            contextId: estimate.contextId,
            windowId: isUuid(estimate.windowId) ? estimate.windowId : null,
            topCandidateId: estimate.topCandidateId ?? null,
            topLabel: estimate.topLabel ?? null,
            confidence: estimate.confidence,
            entropy: estimate.entropy,
            splitDetected: estimate.splitDetected,
            collapseDetected: estimate.collapseDetected,
            dominantAttractorId: isUuid(estimate.dominantAttractorId) ? estimate.dominantAttractorId : null,
            fieldSummaryId: isUuid(estimate.fieldSummaryId) ? estimate.fieldSummaryId : null,
            realmAgreementId: isUuid(estimate.realmAgreementId) ? estimate.realmAgreementId : null,
            createdAt: now,
            updatedAt: now,
            payload: {},
        }).onConflictDoNothing();

        if (estimate.candidates.length > 0) {
            await db.insert(candidatesTable).values(
                estimate.candidates.map(c => ({
                    id: c.id,
                    estimateId: estimate.id,
                    contextId: c.contextId,
                    label: c.label,
                    type: c.type,
                    confidence: c.confidence,
                    probability: c.probability,
                    activation: c.activation,
                    persistence: c.persistence,
                    entropy: c.entropy,
                    supportingQuantIds: c.supportingQuantIds.filter(isUuid) as unknown as string[],
                    opposingQuantIds: c.opposingQuantIds.filter(isUuid) as unknown as string[],
                    supportingEventIds: c.supportingEventIds.filter(isUuid) as unknown as string[],
                    opposingEventIds: c.opposingEventIds.filter(isUuid) as unknown as string[],
                    realmContributionIds: c.realmContributionIds.filter(isUuid) as unknown as string[],
                    memoryIds: c.memoryIds.filter(isUuid) as unknown as string[],
                    attractorIds: c.attractorIds.filter(isUuid) as unknown as string[],
                    explanation: c.explanation ?? null,
                    createdAt: new Date(c.createdAt),
                    updatedAt: new Date(c.updatedAt),
                    payload: {},
                }))
            ).onConflictDoNothing();
        }
    } catch (err) {
        logger.warn("hidden state estimate persistence failed", { err });
    }
}

// ============================================================================
// HiddenStatePod implementation
// ============================================================================

class HiddenStatePod implements HiddenStatePort {

    // ── Full estimation pipeline (spec §27) ───────────────────────────────
    async estimate(input: HiddenStateEstimateInput, ctx: DomainContext): Promise<HiddenStateEstimate> {
        const contextId = input.context.id;
        const pluginCtx = domainCtxToPluginCtx(ctx, contextId);

        // 1. Generate candidates
        const candidateResult = await hiddenStateCandidatePlugin.execute({
            contextId,
            activeQuants: input.activeQuants,
            quantField: input.quantField,
            realmContributions: input.realmResults.contributions,
            memoryResults: input.memoryResults,
            mode: input.mode,
        }, pluginCtx);
        let candidates: HiddenStateCandidate[] = candidateResult.output ?? [];

        // 2. Score candidates
        const scoredResult = await hiddenStateScorerPlugin.execute({
            contextId,
            candidates,
            activeQuants: input.activeQuants,
            realmContributions: input.realmResults.contributions,
            quantField: input.quantField,
            previousEstimate: input.previousEstimate,
            mode: input.mode,
        }, pluginCtx);
        candidates = scoredResult.output ?? candidates;

        // 3. Compute entropy
        const entropyResult = await hiddenStateEntropyPlugin.execute({ candidates }, pluginCtx);
        const globalEntropy = entropyResult.output?.globalEntropy ?? shannonEntropy(candidates.map(c => c.probability));

        // 4. Compute persistence
        const persistResult = await hiddenStatePersistencePlugin.execute({
            contextId,
            candidates,
            activeQuants: input.activeQuants,
            previousEstimate: input.previousEstimate,
        }, pluginCtx);
        const persistMap = new Map(
            (persistResult.output?.persistenceByCandidate ?? []).map(p => [p.candidateId, p])
        );

        // Apply persistence and per-candidate entropy
        const entropyByCandidate = new Map(
            (entropyResult.output?.candidateEntropies ?? []).map(e => [e.candidateId, e.entropy])
        );
        candidates = candidates.map(c => ({
            ...c,
            persistence: clamp(persistMap.get(c.id)?.persistence ?? c.persistence),
            entropy: clamp(entropyByCandidate.get(c.id) ?? 0),
        }));

        // 5. Detect split (simple: high entropy + two candidates with similar probability)
        const topTwo = candidates.slice(0, 2);
        const splitDetected = topTwo.length === 2
            && Math.abs(topTwo[0].probability - topTwo[1].probability) < SPLIT_TENSION_THRESHOLD
            && globalEntropy > 0.5;

        // 6. Detect collapse (high confidence top candidate, low entropy)
        const top = candidates[0];
        const collapseDetected = !!top
            && top.confidence >= COLLAPSE_CONFIDENCE_THRESHOLD
            && globalEntropy < 0.3;

        // 7. Build estimate
        const estimateId = randomUUID();
        const now = ctx.now;
        const estimate: HiddenStateEstimate = {
            id: estimateId,
            contextId,
            windowId: input.context.sessionId,
            candidates,
            topCandidateId: top?.id,
            topLabel: top?.label,
            confidence: clamp(top?.confidence ?? 0),
            entropy: clamp(globalEntropy),
            splitDetected,
            collapseDetected,
            fieldSummaryId: input.quantField.id,
            realmAgreementId: input.realmResults.agreement?.id,
            createdAt: now,
            updatedAt: now,
        };

        // 8. Emit influences (fire-and-forget)
        hiddenStateInfluencePlugin.execute({
            contextId,
            estimate,
            mode: input.mode,
        }, pluginCtx)
            .then(r => {
                if (r.output && r.output.length > 0) {
                    this._persistInfluences(r.output).catch(() => {});
                }
            })
            .catch(() => {});

        // 9. Persist
        persistEstimate(estimate).catch(() => {});

        return estimate;
    }

    private async _persistInfluences(influences: HiddenStateInfluence[]): Promise<void> {
        const persistable = influences.filter(inf => isUuid(inf.hiddenStateId));
        if (persistable.length === 0) return;
        await db.insert(influencesTable).values(
            persistable.map(inf => ({
                id: inf.id,
                hiddenStateId: inf.hiddenStateId,
                targetType: inf.targetType,
                targetId: isUuid(inf.targetId) ? inf.targetId : null,
                effect: inf.effect,
                amount: inf.amount,
                confidence: inf.confidence,
                explanation: inf.explanation ?? null,
                evidenceIds: inf.evidenceIds.filter(isUuid) as unknown as string[],
                createdAt: new Date(inf.createdAt),
                payload: {},
            }))
        ).onConflictDoNothing();
    }

    // ── Port methods ───────────────────────────────────────────────────────

    async generateCandidates(input: HiddenStateCandidateInput, ctx: DomainContext): Promise<HiddenStateCandidate[]> {
        const pluginCtx = domainCtxToPluginCtx(ctx, input.context.id);
        const result = await hiddenStateCandidatePlugin.execute({
            contextId: input.context.id,
            activeQuants: input.activeQuants,
            quantField: input.quantField,
            realmContributions: input.realmContributions,
            memoryResults: input.memoryResults,
            mode: input.mode,
        }, pluginCtx);
        return result.output ?? [];
    }

    async scoreCandidates(input: HiddenStateScoringInput, ctx: DomainContext): Promise<HiddenStateCandidate[]> {
        const pluginCtx = domainCtxToPluginCtx(ctx, input.contextId);
        const result = await hiddenStateScorerPlugin.execute(input, pluginCtx);
        return result.output ?? input.candidates;
    }

    async detectTransitions(input: HiddenStateTransitionInput, ctx: DomainContext): Promise<HiddenStateTransition[]> {
        const transitions: HiddenStateTransition[] = [];
        const prevTop = input.previousEstimate.candidates[0];
        const currTop = input.currentEstimate.candidates[0];

        if (!prevTop || !currTop) return transitions;

        const now = ctx.now;
        const contextId = input.contextId;

        if (prevTop.label !== currTop.label) {
            const transType = currTop.confidence > prevTop.confidence ? "strengthened" : "weakened";
            const t: HiddenStateTransition = {
                id: randomUUID(),
                contextId,
                fromStateId: prevTop.id,
                toStateId: currTop.id,
                transitionType: transType === "strengthened" ? "emerged" : "weakened",
                probability: clamp(currTop.probability),
                confidence: clamp(currTop.confidence),
                evidenceIds: currTop.supportingQuantIds.slice(0, 6),
                explanation: `State shifted from '${prevTop.label}' (${prevTop.confidence.toFixed(3)}) to '${currTop.label}' (${currTop.confidence.toFixed(3)})`,
                createdAt: now,
            };
            transitions.push(t);

            // Persist async
            db.insert(transitionsTable).values({
                id: t.id,
                contextId,
                fromStateId: prevTop.id,
                toStateId: currTop.id,
                transitionType: t.transitionType,
                probability: t.probability,
                confidence: t.confidence,
                evidenceIds: t.evidenceIds as unknown as string[],
                explanation: t.explanation ?? null,
                createdAt: new Date(now),
                payload: {},
            }).catch(err => logger.warn("transition persist failed", { err }));
        }

        return transitions;
    }

    async detectSplit(input: HiddenStateSplitInput, ctx: DomainContext): Promise<HiddenStateSplit | null> {
        if (input.candidates.length < 2) return null;

        const top = input.candidates.slice(0, 3);
        const probDiff = Math.abs(top[0].probability - top[1].probability);
        const fieldEntropy = input.quantField.fieldEntropy;

        const tensionScore = clamp((1 - probDiff) * fieldEntropy);
        if (tensionScore < SPLIT_TENSION_THRESHOLD) return null;

        const split: HiddenStateSplit = {
            id: randomUUID(),
            contextId: input.contextId,
            candidateStateIds: top.map(c => c.id),
            tensionScore,
            entropyDelta: clamp(fieldEntropy - 0.4),
            possibleExplanations: top.map(c => `'${c.label}' at ${(c.probability * 100).toFixed(1)}%`),
            evidenceIds: top.flatMap(c => c.supportingQuantIds.slice(0, 2)),
            createdAt: ctx.now,
        };

        // Persist async
        db.insert(splitsTable).values({
            id: split.id,
            contextId: split.contextId,
            candidateStateIds: split.candidateStateIds as unknown as string[],
            tensionScore: split.tensionScore,
            entropyDelta: split.entropyDelta,
            possibleExplanations: split.possibleExplanations as unknown as string[],
            evidenceIds: split.evidenceIds as unknown as string[],
            createdAt: new Date(split.createdAt),
            payload: {},
        }).catch(err => logger.warn("split persist failed", { err }));

        return split;
    }

    async detectCollapse(input: HiddenStateCollapseInput, ctx: DomainContext): Promise<HiddenStateCollapseSignal | null> {
        const top = input.candidates[0];
        if (!top) return null;

        const lowEntropy = input.quantField.fieldEntropy < 0.3;
        const highAgreement = (input.realmResults.agreement?.score ?? 0) > 0.65;
        const highCoherence = input.quantField.fieldCoherence > 0.65;

        if (top.confidence < COLLAPSE_CONFIDENCE_THRESHOLD || !lowEntropy) return null;

        return {
            id: randomUUID(),
            contextId: input.contextId,
            hiddenStateId: top.id,
            collapseConfidence: clamp(top.confidence),
            supportingQuantIds: top.supportingQuantIds,
            opposingQuantIds: top.opposingQuantIds,
            entropy: input.quantField.fieldEntropy,
            createdAt: ctx.now,
        };
    }

    async emitInfluences(input: HiddenStateInfluenceInput, ctx: DomainContext): Promise<HiddenStateInfluence[]> {
        const pluginCtx = domainCtxToPluginCtx(ctx, input.contextId);
        const result = await hiddenStateInfluencePlugin.execute(input, pluginCtx);
        const influences = result.output ?? [];
        if (influences.length > 0) {
            this._persistInfluences(influences).catch(() => {});
        }
        return influences;
    }
}

export const hiddenStatePod = new HiddenStatePod();
export type { HiddenStatePod };
