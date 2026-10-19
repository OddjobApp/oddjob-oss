import { randomUUID } from "crypto";
import { db } from "@server/database_service.js";
import { createLogger } from "@server/utils/logger.js";
import { observabilityPod } from "../observability/observability-pod.service.js";
import { quantIntegration } from "../integrations/quant-integration.js";
import { causalChainIntegration } from "../integrations/causal-chain-integration.js";
import {
    predictions as predictionsTable,
    predictionBranches as predictionBranchesTable,
    predictionContracts as predictionContractsTable,
} from "@shared/schema/prediction/predictions.js";
import { pluginExecutor } from "../plugin-runtime/plugin-executor.js";
import { createPluginContext } from "../plugin-runtime/plugin-runtime.js";
import type { DomainContext, Provenance, Quant } from "../quant/types.js";
import type {
    BicameralInput,
    BicameralResult,
    BranchGenerationInput,
    ForwardChamberInput,
    ForwardChamberResult,
    Prediction,
    PredictionBranch,
    PredictionContract,
    PredictionContractInput,
    PredictionInput,
    PredictionModePlan,
    PredictionModePlanInput,
    PredictionPort,
    PredictionResult,
    ReverseChamberInput,
    ReverseChamberResult,
} from "./types.js";
import { normalizePredictionMode } from "./types.js";
import { predictionModePlannerPlugin } from "./plugins/prediction-mode-planner.plugin.js";
import { predicateGeneratorPlugin } from "./plugins/predicate-generator.plugin.js";
import { branchGeneratorPlugin } from "./plugins/branch-generator.plugin.js";
import { forwardChamberPlugin } from "./plugins/forward-chamber.plugin.js";
import { predictionEntropyPlugin } from "./plugins/prediction-entropy.plugin.js";
import { predictionConfidencePlugin } from "./plugins/prediction-confidence.plugin.js";
import { predictionContractPlugin } from "./plugins/prediction-contract.plugin.js";
import { clamp } from "./plugins/plugin-helpers.js";

const logger = createLogger("PredictionPod");

function domainCtxToPluginCtx(domainCtx: DomainContext, contextId: string, context?: PredictionInput["context"]) {
    const permissions = (context as any)?.permissions ?? {};
    return createPluginContext({
        contextId,
        mode: domainCtx.mode,
        requestId: domainCtx.requestId,
        correlationId: domainCtx.correlationId,
        permissions: {
            canWriteInferences: true,
            canWritePredictions: permissions.allowPrediction ?? true,
            canCallAgents: permissions.allowAgentAssist ?? false,
            canReadSensitiveData: permissions.allowSensitiveData ?? false,
            canUseGeographicData: permissions.allowGeographicProcessing ?? false,
            canUseSpatialData: permissions.allowSpatialProcessing ?? false,
        },
    });
}

function unique(values: string[]): string[] {
    return Array.from(new Set(values.filter(Boolean)));
}

function branchRank(a: PredictionBranch, b: PredictionBranch): number {
    return b.branchScore - a.branchScore || b.confidence - a.confidence || b.probability - a.probability;
}

function makeProvenance(domainCtx: DomainContext, evidenceIds: string[]): Provenance {
    return {
        sourceSystem: "prediction-pod",
        sourceId: domainCtx.requestId,
        ingestedAt: domainCtx.now,
        createdBy: "prediction-pod",
    };
}

function shouldRunGraphIntegrations(domainCtx: DomainContext): boolean {
    return process.env.NODE_ENV !== "test" && typeof domainCtx.organizationId === "number";
}

function hiddenStateForGraph(input: PredictionInput["hiddenState"]): { topLabel: string; entropy: number } | null {
    if (!input?.topLabel) return null;
    return { topLabel: input.topLabel, entropy: input.entropy };
}

function enrichBranchEvidence(branches: PredictionBranch[], activeQuants: Quant[]): PredictionBranch[] {
    const quantsById = new Map(activeQuants.map(q => [q.id, q]));
    return branches.map(branch => {
        const supportingQuants = branch.supportingQuantIds.map(id => quantsById.get(id)).filter(Boolean) as Quant[];
        const interferingQuants = branch.interferingQuantIds.map(id => quantsById.get(id)).filter(Boolean) as Quant[];
        return {
            ...branch,
            supportingEventIds: unique([...branch.supportingEventIds, ...supportingQuants.flatMap(q => q.sourceEventIds)]),
            opposingEventIds: unique([...branch.opposingEventIds, ...interferingQuants.flatMap(q => q.sourceEventIds)]),
        };
    });
}

function applyForwardScores(branches: PredictionBranch[], forward?: ForwardChamberResult): PredictionBranch[] {
    if (!forward) return branches;
    return branches.map(branch => {
        const score = forward.branchScores.find(s => s.branchId === branch.id);
        if (!score) return branch;
        return {
            ...branch,
            forwardScore: score.score,
            confidence: clamp((branch.confidence + score.confidence) / 2),
            branchScore: clamp(branch.branchScore * 0.7 + score.score * 0.3),
            updatedAt: new Date().toISOString(),
        };
    });
}

function predictionToRow(prediction: Prediction, organizationId?: number): typeof predictionsTable.$inferInsert {
    return {
        id: prediction.id,
        contextId: prediction.contextId,
        organizationId,
        mode: prediction.mode,
        topPredicate: prediction.topPredicate,
        confidence: prediction.confidence,
        entropy: prediction.entropy,
        collapseDetected: prediction.collapseDetected,
        quantFieldSummaryId: prediction.quantFieldSummaryId,
        hiddenStateEstimateId: prediction.hiddenStateEstimateId,
        realmAgreementId: prediction.realmAgreementId,
        forwardChamber: prediction.forwardChamber as any,
        reverseChamber: prediction.reverseChamber as any,
        bicameral: prediction.bicameral as any,
        provenance: prediction.provenance as any,
        payload: {
            activeBranchIds: prediction.activeBranchIds,
            reservedBranchIds: prediction.reservedBranchIds,
            collapsedBranchId: prediction.collapsedBranchId,
        } as any,
        createdAt: new Date(prediction.createdAt),
    };
}

function branchToRow(branch: PredictionBranch, organizationId?: number): typeof predictionBranchesTable.$inferInsert {
    return {
        id: branch.id,
        predictionId: branch.predictionId,
        contextId: branch.contextId,
        organizationId,
        parentBranchId: branch.parentBranchId,
        generation: branch.generation,
        predicate: branch.predicate,
        postPredicates: branch.postPredicates,
        probability: branch.probability,
        confidence: branch.confidence,
        branchScore: branch.branchScore,
        entropy: branch.entropy,
        expectedValue: branch.expectedValue,
        status: branch.status,
        supportingQuantIds: branch.supportingQuantIds,
        interferingQuantIds: branch.interferingQuantIds,
        supportingEventIds: branch.supportingEventIds,
        opposingEventIds: branch.opposingEventIds,
        forwardScore: branch.forwardScore,
        reverseScore: branch.reverseScore,
        bicameralAgreement: branch.bicameralAgreement,
        collapseSignalId: branch.collapseSignalId,
        prunedReason: branch.prunedReason,
        explanation: branch.explanation,
        payload: {
            realmContributions: branch.realmContributions,
            branchInfluences: branch.branchInfluences,
            constraints: branch.constraints,
            createdFrom: branch.createdFrom,
        } as any,
        createdAt: new Date(branch.createdAt),
        updatedAt: new Date(branch.updatedAt),
    };
}

export const predictionPod: PredictionPort = {
    async generatePredictions(input: PredictionInput, domainCtx: DomainContext): Promise<PredictionResult> {
        const contextId = input.context.id;
        const mode = normalizePredictionMode(input.mode);
        const normalizedDomainCtx: DomainContext = {
            ...domainCtx,
            mode: normalizePredictionMode(domainCtx.mode, mode),
        };
        const predictionId = randomUUID();
        const pluginCtx = domainCtxToPluginCtx(normalizedDomainCtx, contextId, input.context);
        const riskLevel = input.activeQuants.some(q => q.type === "contradiction_signal" || q.type === "anomaly_signal") ? "high" : "low";

        const modePlanInput: PredictionModePlanInput = {
            mode,
            context: input.context,
            quantField: input.quantField,
            riskLevel,
        };
        const modePlanResult = await pluginExecutor.executeSingle(predictionModePlannerPlugin, modePlanInput, pluginCtx, false);
        const modePlan: PredictionModePlan = modePlanResult.output ?? {
            mode,
            maxBranches: 8,
            maxDepth: 1,
            runForwardChamber: true,
            runReverseChamber: false,
            runBicameral: false,
            includeAlternatives: true,
            includePatternMemory: false,
            timeoutMs: 100,
        };

        const predicateResult = await pluginExecutor.executeSingle(predicateGeneratorPlugin, {
            context: input.context,
            activeQuants: input.activeQuants,
            quantField: input.quantField,
            realmResults: input.realmResults,
            hiddenState: input.hiddenState,
            memoryMatches: input.memoryMatches,
            modePlan,
            now: normalizedDomainCtx.now,
        }, pluginCtx, false, modePlan.timeoutMs);
        const predicates = predicateResult.output ?? [];

        let branches = await this.generateBranches({
            predictionId,
            context: input.context,
            predicates,
            quantField: input.quantField,
            hiddenState: input.hiddenState,
            realmContributions: input.realmResults.contributions,
            memoryMatches: input.memoryMatches,
            modePlan,
            now: normalizedDomainCtx.now,
        }, normalizedDomainCtx);
        branches = enrichBranchEvidence(branches, input.activeQuants);

        const forwardChamber = modePlan.runForwardChamber
            ? await this.runForwardChamber({
                context: input.context,
                branches,
                activeQuants: input.activeQuants,
                quantField: input.quantField,
                realmResults: input.realmResults,
                hiddenState: input.hiddenState,
                memoryMatches: input.memoryMatches,
                now: normalizedDomainCtx.now,
            }, normalizedDomainCtx)
            : undefined;
        branches = applyForwardScores(branches, forwardChamber);

        const reverseChamber = modePlan.runReverseChamber
            ? await this.runReverseChamber({
                context: input.context,
                branches,
                activeQuants: input.activeQuants,
                quantField: input.quantField,
                realmResults: input.realmResults,
                hiddenState: input.hiddenState,
                now: normalizedDomainCtx.now,
            }, normalizedDomainCtx)
            : undefined;
        const bicameral = modePlan.runBicameral && forwardChamber && reverseChamber
            ? await this.reconcileBicameral({ contextId, branches, forward: forwardChamber, reverse: reverseChamber, now: normalizedDomainCtx.now }, normalizedDomainCtx)
            : undefined;

        const entropyResult = await pluginExecutor.executeSingle(predictionEntropyPlugin, {
            branches,
            quantField: input.quantField,
            realmConflicts: input.realmResults.conflicts,
        }, pluginCtx, false);
        const entropy = entropyResult.output?.predictionEntropy ?? input.quantField.fieldEntropy;
        branches = branches.map(branch => ({
            ...branch,
            entropy: entropyResult.output?.branchEntropies.find(e => e.branchId === branch.id)?.entropy ?? branch.entropy,
            updatedAt: new Date().toISOString(),
        }));

        const confidenceResult = await pluginExecutor.executeSingle(predictionConfidencePlugin, {
            branches,
            activeQuants: input.activeQuants,
            quantField: input.quantField,
            realmAgreement: input.realmResults.agreement,
            hiddenState: input.hiddenState,
            forwardChamber,
        }, pluginCtx, false);
        branches = branches.map(branch => {
            const update = confidenceResult.output?.branchConfidences.find(c => c.branchId === branch.id);
            return update ? { ...branch, confidence: update.confidence, branchScore: update.branchScore, updatedAt: new Date().toISOString() } : branch;
        }).sort(branchRank);

        const collapseDetected = entropy < 0.2 && input.quantField.collapseProbability > 0.6 && branches[0]?.branchScore > 0.65;
        if (collapseDetected && branches[0]) {
            branches[0] = { ...branches[0], status: "collapsed", updatedAt: new Date().toISOString() };
        }

        const activeBranches = branches.filter(branch => branch.status === "active" || branch.status === "candidate" || branch.status === "collapsed");
        const reservedBranches = branches.filter(branch => branch.status === "reserved");
        const topBranch = [...activeBranches, ...reservedBranches].sort(branchRank)[0];

        const provenance = makeProvenance(normalizedDomainCtx, input.activeQuants.flatMap(q => q.sourceEventIds));
        const prediction: Prediction = {
            id: predictionId,
            contextId,
            createdAt: normalizedDomainCtx.now,
            mode,
            topPredicate: topBranch?.predicate,
            confidence: confidenceResult.output?.predictionConfidence ?? topBranch?.confidence ?? 0,
            entropy,
            collapseDetected,
            branches,
            activeBranchIds: activeBranches.map(branch => branch.id),
            reservedBranchIds: reservedBranches.map(branch => branch.id),
            collapsedBranchId: collapseDetected ? topBranch?.id : undefined,
            quantFieldSummaryId: input.quantField.id,
            hiddenStateEstimateId: input.hiddenState?.id,
            realmAgreementId: input.realmResults.agreement?.id,
            forwardChamber,
            reverseChamber,
            bicameral,
            provenance,
        };

        const contract = await this.contract({
            prediction,
            activeBranches,
            reservedBranches,
            quantField: input.quantField,
            hiddenState: input.hiddenState,
            realmAgreement: input.realmResults.agreement,
        }, normalizedDomainCtx);

        if (typeof normalizedDomainCtx.organizationId === "number") {
            try {
                await db.insert(predictionsTable).values(predictionToRow(prediction, normalizedDomainCtx.organizationId));
                if (branches.length > 0) {
                    await db.insert(predictionBranchesTable).values(branches.map(branch => branchToRow(branch, normalizedDomainCtx.organizationId)));
                }
                await db.insert(predictionContractsTable).values({
                    predictionId: prediction.id,
                    contextId,
                    organizationId: normalizedDomainCtx.organizationId,
                    contract: contract as any,
                });
            } catch (e: any) {
                logger.error(`[PredictionPod] Failed to persist prediction to DB: ${e.message}`);
                throw new Error(`Prediction persistence failed: ${e.message}`);
            }
        } else {
            logger.debug(`[PredictionPod] Generated transient prediction ${prediction.id}; persistence skipped because organization scope is absent`);
        }

        // --- Latent Features Integrations ---
        if (shouldRunGraphIntegrations(normalizedDomainCtx)) {
            const orgContext = { organizationId: normalizedDomainCtx.organizationId, userId: normalizedDomainCtx.userId } as any;
            const quantsToMap = input.activeQuants.filter(q => branches.some(b => b.supportingQuantIds.includes(q.id)));
            if (quantsToMap.length > 0) {
                quantIntegration.mapQuants(
                    prediction.id,
                    prediction.topPredicate ?? "unknown",
                    quantsToMap.map(q => ({ id: q.id, label: q.label ?? q.type, value: q.magnitude })),
                    orgContext
                ).catch(err => logger.warn(`[PredictionPod] Quant graph integration failed: ${err?.message ?? err}`));
            }

            const graphState = hiddenStateForGraph(input.hiddenState);
            if (graphState) {
                causalChainIntegration.mapCausalChain(
                    graphState,
                    { id: prediction.id, topPredicate: prediction.topPredicate ?? "unknown", confidence: prediction.confidence },
                    "unlinked-mission",
                    orgContext
                ).catch(err => logger.warn(`[PredictionPod] Causal graph integration failed: ${err?.message ?? err}`));
            }
        }
        // ------------------------------------

        logger.info(`[PredictionPod] Generated prediction ${prediction.id} with ${branches.length} branch(es), top=${prediction.topPredicate ?? "none"}`);
        observabilityPod.emit({
            type: "prediction_created",
            contextId: input.context.id,
            predictionId: prediction.id,
            severity: "info",
            source: "prediction_pod",
            payload: { organizationId: normalizedDomainCtx.organizationId, branchCount: branches.length, topPredicate: prediction.topPredicate, confidence: prediction.confidence },
        }, domainCtx).catch(() => {});
        return { prediction, branches, contract, modePlan };
    },

    async generateBranches(input: BranchGenerationInput, domainCtx: DomainContext): Promise<PredictionBranch[]> {
        const pluginCtx = domainCtxToPluginCtx(domainCtx, input.context.id, input.context);
        const result = await pluginExecutor.executeSingle(branchGeneratorPlugin, input, pluginCtx, false, input.modePlan.timeoutMs);
        return result.output ?? [];
    },

    async runForwardChamber(input: ForwardChamberInput, domainCtx: DomainContext): Promise<ForwardChamberResult> {
        const pluginCtx = domainCtxToPluginCtx(domainCtx, input.context.id, input.context);
        const result = await pluginExecutor.executeSingle(forwardChamberPlugin, input, pluginCtx, false);
        if (result.output) return result.output;
        return {
            id: randomUUID(),
            contextId: input.context.id,
            branchScores: input.branches.map(branch => ({ branchId: branch.id, score: branch.branchScore, confidence: branch.confidence, explanation: "fallback branch score" })),
            dominantBranchId: [...input.branches].sort(branchRank)[0]?.id,
            entropy: input.quantField.fieldEntropy,
            createdAt: domainCtx.now,
        };
    },

    async runReverseChamber(input: ReverseChamberInput, domainCtx: DomainContext): Promise<ReverseChamberResult> {
        const anomalyQuants = input.activeQuants.filter(q => q.type === "anomaly_signal" || q.type === "contradiction_signal");
        return {
            id: randomUUID(),
            contextId: input.context.id,
            inferredCauses: anomalyQuants.slice(0, 5).map(q => ({
                label: q.label ?? q.type,
                confidence: q.confidence,
                supportingQuantIds: [q.id],
                supportingEventIds: q.sourceEventIds,
                explanation: `${q.type} suggests unresolved prior evidence`,
            })),
            branchSupport: input.branches.map(branch => ({
                branchId: branch.id,
                reverseSupport: branch.supportingQuantIds.some(id => anomalyQuants.some(q => q.id === id)) ? 0.7 : 0.45,
                explanation: "MVP reverse chamber uses anomaly/contradiction support",
            })),
            missingEvidenceHypotheses: input.quantField.fieldEntropy > 0.6 ? ["field_entropy_high"] : [],
            anomalyScore: clamp(anomalyQuants.length / Math.max(1, input.activeQuants.length)),
            entropy: input.quantField.fieldEntropy,
            createdAt: domainCtx.now,
        };
    },

    async reconcileBicameral(input: BicameralInput, domainCtx: DomainContext): Promise<BicameralResult> {
        const branchAgreements = input.branches.map(branch => {
            const forwardScore = input.forward.branchScores.find(s => s.branchId === branch.id)?.score ?? 0;
            const reverseScore = input.reverse.branchSupport.find(s => s.branchId === branch.id)?.reverseSupport ?? 0;
            const agreement = clamp(1 - Math.abs(forwardScore - reverseScore));
            return {
                branchId: branch.id,
                forwardScore,
                reverseScore,
                agreement,
                adjustment: (agreement - 0.5) * 0.1,
            };
        });
        const agreementScore = branchAgreements.length > 0
            ? branchAgreements.reduce((sum, item) => sum + item.agreement, 0) / branchAgreements.length
            : 0;
        return {
            id: randomUUID(),
            contextId: input.contextId,
            agreementScore,
            branchAgreements,
            disagreementType: agreementScore < 0.45 ? "missing_evidence" : "none",
            entropyDelta: agreementScore < 0.45 ? 0.08 : -0.04,
            explanation: `forward/reverse agreement=${agreementScore.toFixed(3)}`,
            createdAt: domainCtx.now,
        };
    },

    async contract(input: PredictionContractInput, domainCtx: DomainContext): Promise<PredictionContract> {
        const pluginCtx = domainCtxToPluginCtx(domainCtx, input.prediction.contextId);
        const result = await pluginExecutor.executeSingle(predictionContractPlugin, input, pluginCtx, false);
        if (result.output) return result.output;
        return {
            predictionId: input.prediction.id,
            contextId: input.prediction.contextId,
            createdAt: domainCtx.now,
            entropy: input.prediction.entropy,
            collapseDetected: input.prediction.collapseDetected,
            topAlternatives: [],
            supportingEvidence: [],
            opposingEvidence: [],
            activeBranches: input.activeBranches,
            reservedBranches: input.reservedBranches,
            provenance: input.prediction.provenance,
        };
    },
};

export type PredictionPod = typeof predictionPod;
