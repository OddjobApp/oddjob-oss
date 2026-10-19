import { randomUUID } from "crypto";
import { db } from "@server/database_service.js";
import { realmContributions, realmAgreements } from "@shared/schema/prediction/realm-mesh.js";
import { createLogger } from "@server/utils/logger.js";
import { pluginExecutor } from "../plugin-runtime/plugin-executor.js";
import { createPluginContext } from "../plugin-runtime/plugin-runtime.js";
import type { DomainContext } from "../quant/types.js";
import type {
    RealmMeshPort, RealmQuantProcessingInput, RealmEventProcessingInput,
    RealmBranchContributionInput, RealmBranchContributionResult,
    RealmHiddenStateContributionInput, RealmHiddenStateContributionResult,
    RealmAgreementInput, RealmAgreementScore, RealmConflictInput, RealmConflictReport,
    RealmProcessingResult, QuantRealmInput, QuantRealmOutput, RealmExecutionPlan,
    RealmExecutionTrace, WindowSummary,
} from "./types.js";
import type { RealmContribution, RealmName } from "../quant/types.js";

// Import plugins (lazy to allow tree-shaking; executor handles timeouts)
import { realmExecutionPlannerPlugin } from "./plugins/realm-execution-planner.plugin.js";
import { temporalRealmPlugin } from "./plugins/temporal-realm.plugin.js";
import { semanticRealmPlugin } from "./plugins/semantic-realm.plugin.js";
import { epistemicRealmPlugin } from "./plugins/epistemic-realm.plugin.js";
import { attentionRealmPlugin } from "./plugins/attention-realm.plugin.js";
import { realmAggregatorPlugin } from "./plugins/realm-aggregator.plugin.js";
import { realmAgreementPlugin } from "./plugins/realm-agreement.plugin.js";
import type { RealmAggregatorInput } from "./plugins/realm-aggregator.plugin.js";

const logger = createLogger("RealmMesh");

// Realm name → plugin map (extensible for future realms)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const REALM_PLUGIN_MAP: Partial<Record<RealmName, import("../plugin-runtime/types.js").PredictionPlugin<any, any>>> = {
    temporal: temporalRealmPlugin,
    semantic: semanticRealmPlugin,
    epistemic: epistemicRealmPlugin,
    attention: attentionRealmPlugin,
};

function domainCtxToPluginCtx(domainCtx: DomainContext, contextId: string) {
    return createPluginContext({
        contextId, mode: domainCtx.mode,
        requestId: domainCtx.requestId, correlationId: domainCtx.correlationId,
        permissions: { canWriteInferences: true, canWritePredictions: false, canCallAgents: false, canReadSensitiveData: false, canUseGeographicData: false, canUseSpatialData: false },
    });
}

function emptyTrace(contextId: string, startedAt: string): RealmExecutionTrace {
    return { id: randomUUID(), contextId, startedAt, completedAt: startedAt, durationMs: 0, realmRuns: [] };
}

// ============================================================================
// REALM MESH SERVICE (spec §32)
// ============================================================================

export const realmMesh: RealmMeshPort = {

    // -------------------------------------------------------------------------
    // processQuants — core flow (spec §37.1)
    // -------------------------------------------------------------------------

    async processQuants(input: RealmQuantProcessingInput, domainCtx: DomainContext): Promise<RealmProcessingResult> {
        const startedAt = new Date().toISOString();
        const contextId = input.context.id;
        const pluginCtx = domainCtxToPluginCtx(domainCtx, contextId);

        // Step 1: Plan
        const planResult = await pluginExecutor.executeSingle(realmExecutionPlannerPlugin, input, pluginCtx, false);
        const plan: RealmExecutionPlan = planResult.output ?? {
            id: randomUUID(), mode: input.mode, orderedRealms: ["temporal", "epistemic", "attention"],
            skippedRealms: [], parallelGroups: [], timeoutMs: 100, createdAt: pluginCtx.now,
        };

        const allContributions: RealmContribution[] = [];
        const traceRuns: RealmExecutionTrace["realmRuns"] = [];

        // Step 2: Execute each realm plugin per quant
        for (const quant of input.quants) {
            const realmInput: QuantRealmInput = {
                quant, context: input.context,
                activeWindows: input.activeWindows,
                fieldSummary: input.fieldSummary,
            };

            // Run each ordered realm
            for (const realmName of plan.orderedRealms) {
                const realmPlugin = REALM_PLUGIN_MAP[realmName];
                if (!realmPlugin) {
                    plan.skippedRealms.push({ realm: realmName, reason: "plugin not registered" });
                    continue;
                }

                const realmStart = Date.now();
                const result = await pluginExecutor.executeSingle<QuantRealmInput, QuantRealmOutput>(
                    realmPlugin, realmInput, pluginCtx, false,
                    plan.timeoutMs
                );
                const realmDuration = Date.now() - realmStart;
                const realmOutput = result.output;

                traceRuns.push({
                    realm: realmName, pluginName: realmPlugin.manifest.name,
                    status: result.status as any,
                    durationMs: realmDuration,
                    contributionCount: realmOutput?.contributions.length ?? 0,
                    warningCount: realmOutput?.warnings.length ?? 0,
                });

                if (realmOutput?.contributions) allContributions.push(...realmOutput.contributions);
            }

            // Step 3: Aggregate contributions per quant
            const aggInput: RealmAggregatorInput = {
                contextId, quantId: quant.id,
                realmOutputs: plan.orderedRealms.map(r => ({
                    quantId: quant.id, realm: r,
                    contributions: allContributions.filter(c => c.realm === r && c.quantId === quant.id),
                    branchInfluences: [], hiddenStateInfluences: [], relationships: [], warnings: [],
                })),
            };
            await pluginExecutor.executeSingle(realmAggregatorPlugin, aggInput, pluginCtx, false);
        }

        // Step 4: Score agreement
        const agreementInput: RealmAgreementInput = { contextId, contributions: allContributions };
        const agrResult = await pluginExecutor.executeSingle(realmAgreementPlugin, agreementInput, pluginCtx, false);
        const agreement = agrResult.output;

        // Step 5: Persist contributions + agreement (fire and forget)
        this._persistContributions(allContributions, contextId).catch((e: unknown) =>
            logger.warn(`[RealmMesh] Persist failed: ${(e as Error)?.message}`)
        );
        if (agreement) {
            this._persistAgreement(agreement).catch((e: unknown) =>
                logger.warn(`[RealmMesh] Agreement persist failed: ${(e as Error)?.message}`)
            );
        }

        const completedAt = new Date().toISOString();
        const trace: RealmExecutionTrace = {
            id: randomUUID(), contextId, startedAt, completedAt,
            durationMs: Date.parse(completedAt) - Date.parse(startedAt),
            realmRuns: traceRuns,
        };

        logger.info(`[RealmMesh] processQuants: ${input.quants.length} quants × ${plan.orderedRealms.length} realms → ${allContributions.length} contributions, agreement=${agreement?.score.toFixed(3)}`);

        return {
            contextId, executionPlan: plan, contributions: allContributions,
            branchInfluences: [], hiddenStateInfluences: [], quantRelationships: [],
            agreement, conflicts: [], warnings: [], trace,
        };
    },

    // -------------------------------------------------------------------------
    // processEvent — event → realm analysis
    // -------------------------------------------------------------------------

    async processEvent(input: RealmEventProcessingInput, domainCtx: DomainContext): Promise<RealmProcessingResult> {
        // For MVP: treat the event as generating a synthetic quant for realm analysis
        const { event, context, activeWindows, mode } = input;
        const contextId = context.id;

        const startedAt = new Date().toISOString();
        const pluginCtx = domainCtxToPluginCtx(domainCtx, contextId);
        const planResult = await pluginExecutor.executeSingle(realmExecutionPlannerPlugin, { context, quants: [], activeWindows, mode } as RealmQuantProcessingInput, pluginCtx, false);
        const plan = planResult.output ?? { id: randomUUID(), mode, orderedRealms: ["temporal", "epistemic", "attention"] as RealmName[], skippedRealms: [], parallelGroups: [], timeoutMs: 100, createdAt: pluginCtx.now };

        logger.info(`[RealmMesh] processEvent: event=${event.id} mode=${mode}`);
        const completedAt = new Date().toISOString();
        return {
            contextId, executionPlan: plan, contributions: [], branchInfluences: [], hiddenStateInfluences: [], quantRelationships: [], conflicts: [], warnings: [],
            trace: { id: randomUUID(), contextId, startedAt, completedAt, durationMs: Date.parse(completedAt) - Date.parse(startedAt), realmRuns: [] },
        };
    },

    // -------------------------------------------------------------------------
    // contributeToBranches (spec §37.2)
    // -------------------------------------------------------------------------

    async contributeToBranches(input: RealmBranchContributionInput, domainCtx: DomainContext): Promise<RealmBranchContributionResult> {
        const contextId = input.context.id;
        logger.info(`[RealmMesh] contributeToBranches: ${input.branches.length} branches`);
        return { contextId, contributions: [], constraints: [], warnings: [] };
    },

    // -------------------------------------------------------------------------
    // contributeToHiddenStates (spec §37.3)
    // -------------------------------------------------------------------------

    async contributeToHiddenStates(input: RealmHiddenStateContributionInput, domainCtx: DomainContext): Promise<RealmHiddenStateContributionResult> {
        const contextId = input.context.id;
        logger.info(`[RealmMesh] contributeToHiddenStates: ${input.hiddenStates.length} states`);
        return { contextId, contributions: [], warnings: [] };
    },

    // -------------------------------------------------------------------------
    // scoreAgreement (spec §29)
    // -------------------------------------------------------------------------

    async scoreAgreement(input: RealmAgreementInput, domainCtx: DomainContext): Promise<RealmAgreementScore> {
        const pluginCtx = domainCtxToPluginCtx(domainCtx, input.contextId);
        const result = await pluginExecutor.executeSingle(realmAgreementPlugin, input, pluginCtx, false);
        if (result.output) return result.output;
        return { id: randomUUID(), contextId: input.contextId, score: 0, agreeingRealms: [], disagreeingRealms: [], neutralRealms: [], explanation: "no contributions", createdAt: domainCtx.now };
    },

    // -------------------------------------------------------------------------
    // detectConflicts (spec §30) — MVP: basic effect polarity conflict check
    // -------------------------------------------------------------------------

    async detectConflicts(input: RealmConflictInput, domainCtx: DomainContext): Promise<RealmConflictReport[]> {
        const { contextId, contributions } = input;
        const byRealm = new Map<RealmName, RealmContribution[]>();
        for (const c of contributions) {
            const list = byRealm.get(c.realm) ?? [];
            list.push(c);
            byRealm.set(c.realm, list);
        }
        // Detect temporal-semantic conflict: temporal suppresses, semantic boosts
        const temporal = byRealm.get("temporal")?.find(c => c.effect === "suppress");
        const semantic = byRealm.get("semantic")?.find(c => c.effect === "boost");
        const reports: RealmConflictReport[] = [];

        if (temporal && semantic) {
            reports.push({
                id: randomUUID(), contextId,
                conflictType: "temporal_semantic_conflict",
                realms: ["temporal", "semantic"],
                severity: "medium", entropyDelta: 0.08,
                suggestedAction: "increase_uncertainty",
                explanation: "Temporal realm suppresses (stale) but semantic realm boosts (meaningful) — conflicting signals",
                evidenceIds: [...temporal.evidenceIds, ...semantic.evidenceIds],
                createdAt: domainCtx.now,
            });
        }
        return reports;
    },

    // -------------------------------------------------------------------------
    // Private persistence helpers
    // -------------------------------------------------------------------------

    async _persistContributions(contributions: RealmContribution[], contextId: string): Promise<void> {
        if (contributions.length === 0) return;
        await db.insert(realmContributions).values(
            contributions.map(c => ({
                id: c.id, contextId: c.contextId, quantId: c.quantId,
                eventId: c.eventId, episodeId: c.episodeId, branchId: c.branchId,
                hiddenStateId: c.hiddenStateId,
                realm: c.realm, pluginName: c.pluginName, pluginVersion: c.pluginVersion,
                effect: c.effect, targetType: c.targetType, targetId: c.targetId,
                amount: c.amount, confidence: c.confidence,
                uncertaintyDelta: c.uncertaintyDelta, entropyDelta: c.entropyDelta,
                evidenceIds: c.evidenceIds as any,
                explanation: c.explanation, metadata: c.metadata as any,
                provenance: c.provenance as any,
            }))
        );
    },

    async _persistAgreement(score: RealmAgreementScore): Promise<void> {
        await db.insert(realmAgreements).values({
            id: score.id, contextId: score.contextId, branchId: score.branchId,
            quantId: score.quantId, score: score.score,
            agreeingRealms: score.agreeingRealms as any,
            disagreeingRealms: score.disagreeingRealms as any,
            neutralRealms: score.neutralRealms as any,
            explanation: score.explanation,
        });
    },
} as RealmMeshPort & { _persistContributions: any; _persistAgreement: any };

export type RealmMesh = typeof realmMesh;
