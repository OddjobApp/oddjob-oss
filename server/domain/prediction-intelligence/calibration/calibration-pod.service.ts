import { randomUUID } from "crypto";
import { db } from "@server/database_service.js";
import { createLogger } from "@server/utils/logger.js";
import { eq, and, desc, gte, lte, count, avg } from "drizzle-orm";
import {
    observedOutcomes as outcomesTable,
    outcomeMatches as matchesTable,
    calibrationOutcomes as calOutcomesTable,
    calibrationSignals as signalsTable,
} from "@shared/schema/prediction/calibration.js";
import { createPluginContext } from "../plugin-runtime/plugin-runtime.js";
import type { DomainContext } from "../quant/types.js";
import type {
    CalibrationPort,
    ObservedOutcome,
    OutcomeMatch,
    CalibrationOutcome,
    CalibrationErrorAnalysis,
    CalibrationSignal,
    CalibrationReport,
    CalibrationReplayResult,
    OutcomeIntakeInput,
    OutcomeMatchingInput,
    PredictionCalibrationInput,
    CalibrationErrorAnalysisInput,
    CalibrationSignalInput,
    CalibrationReplayInput,
    CalibrationReportInput,
    CalibrationErrorType,
} from "./types.js";
import { outcomeIntakePlugin } from "./plugins/outcome-intake.plugin.js";
import { outcomeMatchingPlugin } from "./plugins/outcome-matching.plugin.js";
import { predictionAccuracyPlugin } from "./plugins/prediction-accuracy.plugin.js";
import { falsePruneDetectorPlugin } from "./plugins/false-prune-detector.plugin.js";
import { confidenceCalibrationPlugin } from "./plugins/confidence-calibration.plugin.js";
import { clamp } from "./plugins/plugin-helpers.js";

const logger = createLogger("CalibrationPod");

function makeCtx(domainCtx: DomainContext, contextId: string) {
    return createPluginContext({
        contextId, mode: domainCtx.mode,
        requestId: domainCtx.requestId, correlationId: domainCtx.correlationId,
        permissions: { canWriteInferences: true, canWritePredictions: false, canCallAgents: false, canReadSensitiveData: false, canUseGeographicData: false, canUseSpatialData: false },
    });
}

async function persistSignals(signals: CalibrationSignal[]): Promise<void> {
    if (!signals.length) return;
    try {
        await db.insert(signalsTable).values(
            signals.map(s => ({
                id: s.id,
                contextId: s.contextId ?? null,
                targetType: s.targetType,
                targetId: s.targetId ?? null,
                targetName: s.targetName ?? null,
                signalType: s.signalType,
                amount: s.amount,
                confidence: s.confidence,
                reason: s.reason,
                evidenceIds: s.evidenceIds as unknown as string[],
                applied: false,
                appliedAt: null,
                createdAt: new Date(s.createdAt),
                payload: {},
            }))
        ).onConflictDoNothing();
    } catch (err) {
        logger.warn("calibration signal persistence failed", { err: String(err) });
    }
}

class CalibrationPod implements CalibrationPort {

    async recordOutcome(input: OutcomeIntakeInput, ctx: DomainContext): Promise<ObservedOutcome> {
        const pluginCtx = makeCtx(ctx, input.contextId);
        const result = await outcomeIntakePlugin.execute(input, pluginCtx);
        const outcome = result.output!;

        await db.insert(outcomesTable).values({
            id: outcome.id,
            contextId: outcome.contextId as unknown as string,
            outcomeType: outcome.outcomeType,
            label: outcome.label,
            occurredAt: new Date(outcome.occurredAt),
            observedAt: new Date(outcome.observedAt),
            source: outcome.source,
            sourceTrust: outcome.sourceTrust,
            confidence: outcome.confidence,
            relatedEventIds: outcome.relatedEventIds as unknown as string[],
            relatedQuantIds: outcome.relatedQuantIds as unknown as string[],
            relatedPredictionIds: outcome.relatedPredictionIds as unknown as string[],
            payload: (outcome.payload ?? {}) as any,
            provenance: (outcome.provenance ?? {}) as any,
            createdAt: new Date(ctx.now),
        }).onConflictDoNothing();

        return outcome;
    }

    async matchOutcome(input: OutcomeMatchingInput, ctx: DomainContext): Promise<OutcomeMatch[]> {
        const pluginCtx = makeCtx(ctx, input.outcome.contextId);
        const result = await outcomeMatchingPlugin.execute(input, pluginCtx);
        const matches = result.output ?? [];

        if (matches.length > 0) {
            await db.insert(matchesTable).values(
                matches.map(m => ({
                    id: m.id,
                    contextId: m.contextId as unknown as string,
                    outcomeId: m.outcomeId as unknown as string,
                    predictionId: m.predictionId as unknown as string,
                    matchedBranchId: m.matchedBranchId ?? null,
                    matchedPredicate: m.matchedPredicate ?? null,
                    matchType: m.matchType,
                    matchScore: m.matchScore,
                    confidence: m.confidence,
                    explanation: m.explanation ?? null,
                    evidenceIds: m.evidenceIds as unknown as string[],
                    createdAt: new Date(m.createdAt),
                    payload: {},
                }))
            ).onConflictDoNothing();
        }

        return matches;
    }

    async calibratePrediction(input: PredictionCalibrationInput, ctx: DomainContext): Promise<CalibrationOutcome> {
        const pluginCtx = makeCtx(ctx, input.contextId);

        // Find best match
        const bestMatch = input.outcomeMatches.reduce((best, m) =>
            (m.matchScore > (best?.matchScore ?? -1)) ? m : best,
            input.outcomeMatches[0]
        );

        if (!bestMatch) throw new Error("No outcome matches provided");

        // Compute calibration outcome
        const accResult = await predictionAccuracyPlugin.execute({
            contextId: input.contextId,
            predictionId: input.predictionId,
            topPredicate: input.topPredicate,
            confidence: input.confidence,
            entropy: input.entropy,
            branches: input.branches,
            pruningDecisions: input.pruningDecisions ?? [],
            outcome: input.outcome,
            bestMatch,
        }, pluginCtx);
        const calOutcome = accResult.output!;

        // Persist
        await db.insert(calOutcomesTable).values({
            id: calOutcome.id,
            contextId: calOutcome.contextId as unknown as string,
            predictionId: calOutcome.predictionId as unknown as string,
            outcomeId: calOutcome.outcomeId as unknown as string,
            outcomeMatchId: calOutcome.outcomeMatchId as unknown as string,
            topPredictionCorrect: calOutcome.topPredictionCorrect,
            trueBranchPresent: calOutcome.trueBranchPresent,
            trueBranchStatus: calOutcome.trueBranchStatus ?? null,
            confidenceAtPrediction: calOutcome.confidenceAtPrediction,
            entropyAtPrediction: calOutcome.entropyAtPrediction,
            calibratedConfidence: calOutcome.calibratedConfidence ?? null,
            predictionError: calOutcome.predictionError,
            calibrationError: calOutcome.calibrationError,
            brierScore: calOutcome.brierScore ?? null,
            logLoss: calOutcome.logLoss ?? null,
            falsePositive: calOutcome.falsePositive,
            falseNegative: calOutcome.falseNegative,
            falsePrune: calOutcome.falsePrune,
            luckyCorrect: calOutcome.luckyCorrect,
            overconfident: calOutcome.overconfident,
            underconfident: calOutcome.underconfident,
            explanation: calOutcome.explanation ?? null,
            createdAt: new Date(calOutcome.createdAt),
            payload: {},
        }).onConflictDoNothing();

        // Emit signals async
        this.emitSignals({
            calibrationOutcome: calOutcome,
            branches: input.branches,
            pruningDecisions: input.pruningDecisions,
            mode: input.mode,
        }, ctx).catch(() => {});

        return calOutcome;
    }

    async analyzeErrors(input: CalibrationErrorAnalysisInput, ctx: DomainContext): Promise<CalibrationErrorAnalysis> {
        const co = input.calibrationOutcome;
        const errorTypes: CalibrationErrorType[] = [];
        const suspectedCauses: CalibrationErrorAnalysis["suspectedCauses"] = [];

        if (co.falsePositive) { errorTypes.push("false_positive"); suspectedCauses.push({ cause: "overconfident_branch", confidence: 0.7, evidenceIds: [co.outcomeId], explanation: "Branch was overconfident and did not occur" }); }
        if (co.falseNegative) { errorTypes.push("false_negative"); suspectedCauses.push({ cause: "missing_branch_generation", confidence: 0.65, evidenceIds: [co.outcomeId], explanation: "True branch was never generated" }); }
        if (co.falsePrune) { errorTypes.push("false_prune"); suspectedCauses.push({ cause: "aggressive_pruning", confidence: 0.85, evidenceIds: [co.outcomeId], explanation: "True branch was incorrectly pruned" }); }
        if (co.overconfident) errorTypes.push("overconfidence");
        if (co.underconfident) errorTypes.push("underconfidence");
        if (co.luckyCorrect) errorTypes.push("lucky_correct");

        const signals = await this.emitSignals({ calibrationOutcome: co, branches: input.branches, pruningDecisions: input.pruningDecisions, mode: "analysis" }, ctx);

        return {
            id: randomUUID(),
            contextId: co.contextId,
            predictionId: co.predictionId,
            errorTypes,
            primaryErrorType: errorTypes[0],
            suspectedCauses,
            recommendedSignals: signals,
            explanation: errorTypes.length === 0 ? "No calibration errors detected" : `${errorTypes.length} error type(s): ${errorTypes.join(", ")}`,
            createdAt: ctx.now,
        };
    }

    async emitSignals(input: CalibrationSignalInput, ctx: DomainContext): Promise<CalibrationSignal[]> {
        const pluginCtx = makeCtx(ctx, input.calibrationOutcome.contextId);
        const signals: CalibrationSignal[] = [];

        const [falsePruneResult, confResult] = await Promise.all([
            falsePruneDetectorPlugin.execute({
                calibrationOutcome: input.calibrationOutcome,
                branches: input.branches ?? [],
                pruningDecisions: input.pruningDecisions ?? [],
            }, pluginCtx),
            confidenceCalibrationPlugin.execute({ calibrationOutcome: input.calibrationOutcome }, pluginCtx),
        ]);

        signals.push(...(falsePruneResult.output ?? []), ...(confResult.output ?? []));
        persistSignals(signals).catch(() => {});
        return signals;
    }

    async replay(_input: CalibrationReplayInput, ctx: DomainContext): Promise<CalibrationReplayResult> {
        // Deferred per MVP scope (spec §50)
        return {
            contextId: _input.contextId,
            period: { from: _input.from, to: _input.to },
            totalReplayed: 0,
            outcomes: [],
            report: await this.report({ contextId: _input.contextId, from: _input.from, to: _input.to, mode: _input.mode }, ctx),
        };
    }

    async report(input: CalibrationReportInput, ctx: DomainContext): Promise<CalibrationReport> {
        const rows = await db.select().from(calOutcomesTable)
            .where(input.contextId ? eq(calOutcomesTable.contextId, input.contextId as unknown as string) : undefined)
            .limit(1000);

        const n = rows.length;
        if (n === 0) return {
            id: randomUUID(), contextId: input.contextId, period: { from: input.from ?? ctx.now, to: input.to ?? ctx.now },
            accuracy: 0, precision: 0, recall: 0, falsePositiveRate: 0, falseNegativeRate: 0,
            falsePruneRate: 0, branchSurvivalRate: 0, expectedCalibrationError: 0, brierScore: 0,
            overconfidenceRate: 0, underconfidenceRate: 0, sampleSize: 0, createdAt: ctx.now,
        };

        const correct = rows.filter(r => r.topPredictionCorrect).length;
        const fp = rows.filter(r => r.falsePositive).length;
        const fn = rows.filter(r => r.falseNegative).length;
        const falsePrune = rows.filter(r => r.falsePrune).length;
        const trueBranch = rows.filter(r => r.trueBranchPresent).length;
        const overconf = rows.filter(r => r.overconfident).length;
        const underconf = rows.filter(r => r.underconfident).length;
        const avgBrier = rows.reduce((s, r) => s + (r.brierScore ?? 0.25), 0) / n;
        const avgCalibErr = rows.reduce((s, r) => s + r.calibrationError, 0) / n;

        return {
            id: randomUUID(), contextId: input.contextId,
            period: { from: input.from ?? rows[rows.length - 1]?.createdAt?.toISOString() ?? ctx.now, to: input.to ?? ctx.now },
            accuracy: clamp(correct / n),
            precision: clamp(correct / Math.max(correct + fp, 1)),
            recall: clamp(correct / Math.max(correct + fn, 1)),
            falsePositiveRate: clamp(fp / n),
            falseNegativeRate: clamp(fn / n),
            falsePruneRate: clamp(falsePrune / n),
            branchSurvivalRate: clamp(trueBranch / n),
            expectedCalibrationError: clamp(avgCalibErr),
            brierScore: clamp(avgBrier),
            overconfidenceRate: clamp(overconf / n),
            underconfidenceRate: clamp(underconf / n),
            sampleSize: n,
            createdAt: ctx.now,
        };
    }
}

export const calibrationPod = new CalibrationPod();
export type { CalibrationPod };
