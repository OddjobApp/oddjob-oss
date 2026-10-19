import { randomUUID } from "crypto";
import { db } from "@server/database_service.js";
import { createLogger } from "@server/utils/logger.js";
import { observabilityPod } from "../observability/observability-pod.service.js";
import {
    pruningDecisions as pruningDecisionsTable,
    branchGenealogyEvents as branchGenealogyEventsTable,
    branchScoreBreakdowns as branchScoreBreakdownsTable,
} from "@shared/schema/prediction/pruning.js";
import { createPluginContext } from "../plugin-runtime/plugin-runtime.js";
import type { DomainContext } from "../quant/types.js";
import type {
    PruningInput,
    PruningResult,
    PruningDecision,
    BranchScoreBreakdown,
    BranchMergeDecision,
    BranchGenealogyEvent,
    BranchMergeInput,
    BranchScoringInput,
    AnomalyReserveInput,
    PruningPort,
    PredictionBranch,
    BranchStatus,
} from "./types.js";
import { BRANCH_LIMITS } from "./types.js";
import { branchScoringPlugin } from "./plugins/branch-scoring.plugin.js";
import { hardPrunePlugin } from "./plugins/hard-prune.plugin.js";
import { softSuppressionPlugin } from "./plugins/soft-suppression.plugin.js";
import { anomalyReservePlugin } from "./plugins/anomaly-reserve.plugin.js";
import { entropyPruningPlugin } from "./plugins/entropy-pruning.plugin.js";
import { branchGenealogyPlugin } from "./plugins/branch-genealogy.plugin.js";

const logger = createLogger("PruningPod");

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

function applyDecisions(
    branches: PredictionBranch[],
    decisions: PruningDecision[],
): PredictionBranch[] {
    const decisionMap = new Map<string, BranchStatus>();
    for (const d of decisions) {
        decisionMap.set(d.branchId, d.newStatus);
    }
    return branches.map(b => {
        const newStatus = decisionMap.get(b.id);
        if (!newStatus || newStatus === b.status) return b;
        return { ...b, status: newStatus as PredictionBranch["status"], updatedAt: new Date().toISOString() };
    });
}

async function persistAsync(
    predictionId: string,
    contextId: string,
    decisions: PruningDecision[],
    breakdowns: BranchScoreBreakdown[],
    genealogyEvents: BranchGenealogyEvent[],
): Promise<void> {
    try {
        await Promise.all([
            decisions.length > 0 ? db.insert(pruningDecisionsTable).values(
                decisions.map(d => ({
                    id: d.id,
                    predictionId,
                    contextId,
                    branchId: d.branchId,
                    previousStatus: d.previousStatus,
                    newStatus: d.newStatus,
                    decisionType: d.decisionType,
                    reason: d.reason,
                    confidence: d.confidence,
                    scoreBefore: d.scoreBefore,
                    scoreAfter: d.scoreAfter,
                    evidenceIds: d.evidenceIds as unknown as string[],
                    pluginName: d.pluginName,
                    pluginVersion: d.pluginVersion,
                    createdAt: new Date(d.createdAt),
                    payload: {},
                }))
            ).onConflictDoNothing() : Promise.resolve(),

            breakdowns.length > 0 ? db.insert(branchScoreBreakdownsTable).values(
                breakdowns.map(b => ({
                    id: randomUUID(),
                    predictionId,
                    contextId,
                    branchId: b.branchId,
                    probability: b.probability,
                    confidence: b.confidence,
                    quantSupport: b.quantSupport,
                    realmAgreement: b.realmAgreement,
                    hiddenStateAlignment: b.hiddenStateAlignment,
                    bicameralAgreement: b.bicameralAgreement,
                    expectedValue: b.expectedValue,
                    consequenceWeight: b.consequenceWeight,
                    entropyPenalty: b.entropyPenalty,
                    finalScore: b.finalScore,
                    explanation: b.explanation,
                    payload: {},
                }))
            ).onConflictDoNothing() : Promise.resolve(),

            genealogyEvents.length > 0 ? db.insert(branchGenealogyEventsTable).values(
                genealogyEvents.map(e => ({
                    id: e.id,
                    predictionId: e.predictionId,
                    contextId: e.contextId,
                    branchId: e.branchId,
                    parentBranchId: e.parentBranchId ?? null,
                    eventType: e.eventType,
                    reason: e.reason,
                    evidenceIds: e.evidenceIds as unknown as string[],
                    sourcePlugin: e.sourcePlugin,
                    createdAt: new Date(e.createdAt),
                    payload: {},
                }))
            ).onConflictDoNothing() : Promise.resolve(),
        ]);
    } catch (err) {
        logger.error(`pruning persistence failed - predictionId: ${predictionId}`, { err: String(err) });
    }
}

class PruningPod implements PruningPort {
    async prune(input: PruningInput, ctx: DomainContext): Promise<PruningResult> {
        const pluginCtx = domainCtxToPluginCtx(ctx, input.contextId);

        // ── 1. Score all branches ──────────────────────────────────────────
        const scoringInput: BranchScoringInput = {
            predictionId: input.predictionId,
            contextId: input.contextId,
            branches: input.branches,
            quantField: input.quantField,
            activeQuants: input.activeQuants,
            realmContributions: input.realmContributions,
            hiddenState: input.hiddenState,
            mode: input.mode,
        };
        const scoringResult = await branchScoringPlugin.execute(scoringInput, pluginCtx);
        const scoreBreakdowns: BranchScoreBreakdown[] = scoringResult.output ?? [];

        // Apply refined scores back to branches
        const scoreMap = new Map(scoreBreakdowns.map(s => [s.branchId, s]));
        let branches = input.branches.map(b => {
            const refined = scoreMap.get(b.id);
            return refined ? { ...b, branchScore: refined.finalScore } : b;
        });

        const allDecisions: PruningDecision[] = [];

        // ── 2. Hard prune ─────────────────────────────────────────────────
        const hardResult = await hardPrunePlugin.execute({
            predictionId: input.predictionId,
            contextId: input.contextId,
            branches,
            scoreBreakdowns,
            quantField: input.quantField,
            mode: input.mode,
        }, pluginCtx);
        allDecisions.push(...(hardResult.output ?? []));
        branches = applyDecisions(branches, hardResult.output ?? []);

        // ── 3. Anomaly reserve (before soft suppression, to protect consequences) ─
        const reserveResult = await anomalyReservePlugin.execute({
            predictionId: input.predictionId,
            contextId: input.contextId,
            branches,
            activeQuants: input.activeQuants,
            scoreBreakdowns,
            mode: input.mode,
        }, pluginCtx);
        allDecisions.push(...(reserveResult.output ?? []));
        branches = applyDecisions(branches, reserveResult.output ?? []);

        // ── 4. Soft suppression ───────────────────────────────────────────
        const suppressResult = await softSuppressionPlugin.execute({
            predictionId: input.predictionId,
            contextId: input.contextId,
            branches,
            scoreBreakdowns,
            realmContributions: input.realmContributions,
            realmConflicts: input.realmConflicts,
            activeQuants: input.activeQuants,
            mode: input.mode,
        }, pluginCtx);
        allDecisions.push(...(suppressResult.output ?? []));
        branches = applyDecisions(branches, suppressResult.output ?? []);

        // ── 5. Entropy pruning / branch limit enforcement ─────────────────
        const entropyResult = await entropyPruningPlugin.execute({
            predictionId: input.predictionId,
            contextId: input.contextId,
            branches,
            scoreBreakdowns,
            quantField: input.quantField,
            modePlan: input.modePlan,
            mode: input.mode,
        }, pluginCtx);
        allDecisions.push(...(entropyResult.output ?? []));
        branches = applyDecisions(branches, entropyResult.output ?? []);

        // ── 6. Genealogy ──────────────────────────────────────────────────
        const genealogyResult = await branchGenealogyPlugin.execute({
            predictionId: input.predictionId,
            contextId: input.contextId,
            decisions: allDecisions,
            branches,
        }, pluginCtx);
        const genealogyEvents: BranchGenealogyEvent[] = genealogyResult.output ?? [];

        // ── 7. Partition branches by final status ─────────────────────────
        const activeBranches = branches.filter(b => b.status === "active" || b.status === "candidate");
        const suppressedBranches = branches.filter(b => b.status === "suppressed");
        const prunedBranches = branches.filter(b => b.status === "pruned");
        const reservedBranches = branches.filter(b => b.status === "reserved");
        const mergedBranches = branches.filter(b => (b.status as string) === "merged");

        const limits = BRANCH_LIMITS[input.mode];
        const reservedCapped = reservedBranches.slice(0, limits.reserved);

        // ── 8. Persist asynchronously ─────────────────────────────────────
        persistAsync(
            input.predictionId,
            input.contextId,
            allDecisions,
            scoreBreakdowns,
            genealogyEvents,
        ).catch(() => { /* logged inside persistAsync */ });

        // ── 9. Emit observability telemetry ───────────────────────────────
        observabilityPod.emit({
            type: "pruning_completed",
            contextId: input.contextId,
            predictionId: input.predictionId,
            severity: "info",
            source: "pruning_pod",
            payload: {
                inputBranchCount: input.branches.length,
                activeBranches: activeBranches.length,
                prunedCount: prunedBranches.length,
                suppressedCount: suppressedBranches.length,
            },
        }, ctx).catch(() => {});

        return {
            predictionId: input.predictionId,
            contextId: input.contextId,
            activeBranches,
            suppressedBranches,
            prunedBranches,
            reservedBranches: reservedCapped,
            mergedBranches,
            decisions: allDecisions,
            scoreBreakdowns,
            mergeDecisions: [],
            genealogyEvents,
            summary: {
                inputBranchCount: input.branches.length,
                outputActiveCount: activeBranches.length,
                prunedCount: prunedBranches.length,
                suppressedCount: suppressedBranches.length,
                reservedCount: reservedCapped.length,
                mergedCount: mergedBranches.length,
                collapseDetected: input.collapseSignal?.collapseDetected ?? false,
            },
        };
    }

    async scoreBranches(input: BranchScoringInput, ctx: DomainContext): Promise<BranchScoreBreakdown[]> {
        const pluginCtx = domainCtxToPluginCtx(ctx, input.contextId);
        const result = await branchScoringPlugin.execute(input, pluginCtx);
        return result.output ?? [];
    }

    async mergeBranches(input: BranchMergeInput, _ctx: DomainContext): Promise<BranchMergeDecision[]> {
        // Semantic/geographic/spatial merge deferred to post-MVP (spec §32)
        logger.debug(`merge branches called — deferred in MVP - predictionId: ${input.predictionId}, mergeType: ${input.mergeType}`);
        return [];
    }

    async reserveAnomalies(input: AnomalyReserveInput, ctx: DomainContext): Promise<PruningDecision[]> {
        const pluginCtx = domainCtxToPluginCtx(ctx, input.contextId);
        const result = await anomalyReservePlugin.execute(input, pluginCtx);
        return result.output ?? [];
    }
}

export const pruningPod = new PruningPod();
export type { PruningPod };
