import { randomUUID } from "crypto";
import type {
    Quant, QuantType, EpistemicState, EpistemicStatus, QuantFieldSummary, BranchInfluence,
    QuantRelationship, QuantRelationshipType, CanonicalEvent, Episode, PredictionContext, DomainContext,
    UpdateQuantInput, RelateQuantsInput, QuantFieldInput, QuantBranchInfluenceInput,
    QuantHiddenStateInfluenceInput, QuantCollapseInput, PredictionCollapseSignal, HiddenStateInfluence,
    RealmContribution, QuantTrajectoryInput, QuantResonanceInput, QuantInterferenceInput,
    QuantFieldSummaryInput, QuantSingleBranchInfluenceInput, QuantSingleHiddenStateInput,
    QuantDecayInput, QuantRelationshipInput,
} from "./types.js";
import { EPISTEMIC_THRESHOLD, EPSILON } from "./types.js";
import { db } from "@server/database_service.js";
import {
    quants as quantsTable,
    quantRelationships as quantRelationshipsTable,
    quantFieldSummaries as quantFieldSummariesTable,
    quantBranchInfluences as quantBranchInfluencesTable,
} from "@shared/schema/prediction/quants.js";
import { eq, and, desc } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { pluginExecutor } from "../plugin-runtime/plugin-executor.js";
import { createPluginContext } from "../plugin-runtime/plugin-runtime.js";
import { computeField } from "./plugins/quant-field-summary.plugin.js";

const logger = createLogger("QuantPod");

// ============================================================================
// Shared helpers
// ============================================================================

function computeEpistemicStatus(evidenceStrength: number, recognitionLevel: number): EpistemicStatus {
    const worldKnown = evidenceStrength >= EPISTEMIC_THRESHOLD;
    const systemKnown = recognitionLevel >= EPISTEMIC_THRESHOLD;
    if (worldKnown && systemKnown) return "known_known";
    if (!worldKnown && systemKnown) return "known_unknown";
    if (worldKnown && !systemKnown) return "unknown_known";
    return "unknown_unknown";
}

function buildEpistemicState(evidenceStrength: number, recognitionLevel: number, resolutionLevel = 0.1): EpistemicState {
    return {
        status: computeEpistemicStatus(evidenceStrength, recognitionLevel),
        worldKnownness: evidenceStrength,
        systemKnownness: recognitionLevel,
        evidenceStrength,
        recognitionLevel,
        resolutionLevel,
    };
}

function quantToRow(q: Quant): typeof quantsTable.$inferInsert {
    return {
        id: q.id, contextId: q.contextId, type: q.type, label: q.label,
        status: q.epistemic.status,
        worldKnownness: q.epistemic.worldKnownness, systemKnownness: q.epistemic.systemKnownness,
        evidenceStrength: q.epistemic.evidenceStrength, recognitionLevel: q.epistemic.recognitionLevel,
        resolutionLevel: q.epistemic.resolutionLevel,
        magnitude: q.magnitude, confidence: q.confidence, uncertainty: q.uncertainty,
        entropyContribution: q.entropyContribution,
        sourceEventIds: q.sourceEventIds, sourceEpisodeIds: q.sourceEpisodeIds,
        sourcePredictionIds: q.sourcePredictionIds, sourceQuantIds: q.sourceQuantIds,
        lifecycleStatus: q.lifecycle.status, decayRate: q.lifecycle.decayRate,
        ttlSeconds: q.lifecycle.ttlSeconds,
        payload: { position: q.position, trajectory: q.trajectory, provenance: q.provenance, realmContributions: q.realmContributions } as any,
        createdAt: new Date(q.createdAt), updatedAt: new Date(q.updatedAt),
    };
}

function rowToQuant(row: typeof quantsTable.$inferSelect): Quant {
    const payload = (row.payload as any) ?? {};
    return {
        id: row.id, contextId: row.contextId, type: row.type as any, label: row.label ?? undefined,
        sourceEventIds: (row.sourceEventIds as string[]) ?? [], sourceEpisodeIds: (row.sourceEpisodeIds as string[]) ?? [],
        sourcePredictionIds: (row.sourcePredictionIds as string[]) ?? [], sourceQuantIds: (row.sourceQuantIds as string[]) ?? [],
        magnitude: row.magnitude, confidence: row.confidence, uncertainty: row.uncertainty,
        entropyContribution: row.entropyContribution,
        epistemic: {
            status: row.status as any, worldKnownness: row.worldKnownness, systemKnownness: row.systemKnownness,
            evidenceStrength: row.evidenceStrength, recognitionLevel: row.recognitionLevel, resolutionLevel: row.resolutionLevel,
        },
        position: payload.position ?? { epistemic: [] },
        trajectory: payload.trajectory ?? { velocity: [], acceleration: [], direction: [] },
        lifecycle: { status: row.lifecycleStatus as any, decayRate: row.decayRate, ttlSeconds: row.ttlSeconds ?? undefined },
        realmContributions: payload.realmContributions ?? [],
        branchInfluences: [], hiddenStateInfluences: [], relationships: [],
        provenance: payload.provenance ?? { sourceSystem: "unknown", ingestedAt: row.createdAt.toISOString() },
        createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    };
}

function domainCtxToPluginCtx(domainCtx: DomainContext, contextId: string) {
    return createPluginContext({
        contextId,
        mode: domainCtx.mode,
        requestId: domainCtx.requestId,
        correlationId: domainCtx.correlationId,
        permissions: { canWriteInferences: true, canWritePredictions: false, canCallAgents: false, canReadSensitiveData: false, canUseGeographicData: false, canUseSpatialData: false },
    });
}

// ============================================================================
// QuantPort Implementation (spec §25)
// All plugin invocations go through pluginExecutor.executeSingle().
// DB persistence is owned by the service, not the plugins.
// ============================================================================

export const quantPod = {

    // -------------------------------------------------------------------------
    // 26.1 Event to Quant flow
    // -------------------------------------------------------------------------

    async createFromEvent(event: CanonicalEvent, context: PredictionContext, domainCtx: DomainContext): Promise<Quant[]> {
        const pluginCtx = domainCtxToPluginCtx(domainCtx, event.contextId);

        // Step 1: Quant Generator Plugin
        const genPlugin = (await import("./plugins/quant-generator.plugin.js")).quantGeneratorPlugin;
        const genResult = await pluginExecutor.executeSingle(genPlugin, event, pluginCtx, false);

        if (genResult.status !== "success" || !genResult.output) {
            logger.warn(`[QuantPod] Generator failed for event ${event.id}: ${genResult.errors[0]?.message}`);
            return [];
        }

        const quants: Quant[] = genResult.output;

        // Persist and return
        for (const q of quants) {
            await db.insert(quantsTable).values(quantToRow(q));
        }

        logger.info(`[QuantPod] Created ${quants.length} quant(s) from event ${event.id}`);
        return quants;
    },

    // -------------------------------------------------------------------------
    // createFromEpisode — spec §25
    // -------------------------------------------------------------------------

    async createFromEpisode(episode: Episode, context: PredictionContext, domainCtx: DomainContext): Promise<Quant[]> {
        const now = domainCtx.now;
        const confidence = Math.max(0, Math.min(1, episode.confidence));
        const uncertainty = 1 - confidence;
        const epistemic = buildEpistemicState(confidence, 0.30, 0.05);

        const quant: Quant = {
            id: randomUUID(), contextId: episode.contextId, type: "event_signal" as QuantType,
            label: `${episode.action}_episode_signal`,
            sourceEventIds: episode.eventIds, sourceEpisodeIds: [episode.id],
            sourcePredictionIds: [], sourceQuantIds: [],
            magnitude: 0.6, confidence, uncertainty, entropyContribution: uncertainty * 0.6,
            epistemic,
            position: { epistemic: [epistemic.worldKnownness, epistemic.systemKnownness, epistemic.resolutionLevel] },
            trajectory: { velocity: [0, 0, 0], acceleration: [0, 0, 0], direction: [0, 0, 0] },
            realmContributions: [], branchInfluences: [], hiddenStateInfluences: [], relationships: [],
            lifecycle: { status: "active", decayRate: 0.008 },
            provenance: { sourceSystem: episode.source, sourceId: episode.id, ingestedAt: now, createdBy: "quant-pod-episode" },
            createdAt: now, updatedAt: now,
        };

        await db.insert(quantsTable).values(quantToRow(quant));
        logger.info(`[QuantPod] Created quant from episode ${episode.id}`);
        return [quant];
    },

    // -------------------------------------------------------------------------
    // updateQuant
    // -------------------------------------------------------------------------

    async updateQuant(input: UpdateQuantInput, domainCtx: DomainContext): Promise<Quant> {
        const [row] = await db.select().from(quantsTable).where(eq(quantsTable.id, input.quantId)).limit(1);
        if (!row) throw new Error(`Quant ${input.quantId} not found`);
        const current = rowToQuant(row);

        const newEvidenceStrength = input.epistemic?.evidenceStrength ?? current.epistemic.evidenceStrength;
        const newRecognitionLevel = input.epistemic?.recognitionLevel ?? current.epistemic.recognitionLevel;
        const newResolutionLevel = input.epistemic?.resolutionLevel ?? current.epistemic.resolutionLevel;
        const newEpistemic = buildEpistemicState(newEvidenceStrength, newRecognitionLevel, newResolutionLevel);

        const updated: Quant = {
            ...current,
            magnitude: input.magnitude ?? current.magnitude,
            confidence: input.confidence ?? current.confidence,
            uncertainty: input.uncertainty ?? current.uncertainty,
            epistemic: newEpistemic,
            lifecycle: { ...current.lifecycle, ...(input.lifecycle ?? {}) },
            realmContributions: input.realmContributions ?? current.realmContributions,
            updatedAt: new Date().toISOString(),
        };

        await db.update(quantsTable).set(quantToRow(updated)).where(eq(quantsTable.id, input.quantId));
        return updated;
    },

    // -------------------------------------------------------------------------
    // relateQuants — via Relationship Plugin
    // -------------------------------------------------------------------------

    async relateQuants(input: RelateQuantsInput, domainCtx: DomainContext): Promise<QuantRelationship[]> {
        const [srcRow] = await db.select().from(quantsTable).where(eq(quantsTable.id, input.sourceQuantId)).limit(1);
        if (!srcRow) throw new Error(`Source quant ${input.sourceQuantId} not found`);
        const src = rowToQuant(srcRow);

        const pluginCtx = domainCtxToPluginCtx(domainCtx, src.contextId);
        const relPlugin = (await import("./plugins/quant-relationship.plugin.js")).quantRelationshipPlugin;
        const relInput: QuantRelationshipInput = { ...input, contextId: src.contextId };
        const result = await pluginExecutor.executeSingle(relPlugin, relInput, pluginCtx, false);

        const relationships = result.output ?? [];
        if (relationships.length > 0) {
            await db.insert(quantRelationshipsTable).values(
                relationships.map(r => ({
                    id: r.id, contextId: src.contextId,
                    sourceQuantId: r.sourceQuantId, targetQuantId: r.targetQuantId,
                    relationshipType: r.type, strength: r.strength, confidence: r.confidence,
                    evidenceIds: r.evidenceIds,
                }))
            );
        }
        return relationships;
    },

    // -------------------------------------------------------------------------
    // summarizeField — via Field Summary Plugin
    // -------------------------------------------------------------------------

    async summarizeField(input: QuantFieldInput, domainCtx: DomainContext): Promise<QuantFieldSummary> {
        const rows = await db.select().from(quantsTable)
            .where(and(eq(quantsTable.contextId, input.contextId), eq(quantsTable.lifecycleStatus, "active")))
            .orderBy(desc(quantsTable.updatedAt)).limit(input.limit ?? 200);

        const activeQuants = rows.map(rowToQuant);
        const pluginCtx = domainCtxToPluginCtx(domainCtx, input.contextId);
        const fsPlugin = (await import("./plugins/quant-field-summary.plugin.js")).quantFieldSummaryPlugin;
        const fsInput: QuantFieldSummaryInput = { quants: activeQuants, contextId: input.contextId, windowId: input.windowId };
        const result = await pluginExecutor.executeSingle(fsPlugin, fsInput, pluginCtx, false);
        const summary = result.output ?? computeField(activeQuants, input.contextId, input.windowId, domainCtx.now);

        await db.insert(quantFieldSummariesTable).values({
            id: summary.id, contextId: summary.contextId, windowId: summary.windowId,
            quantCount: summary.quantCount, fieldDensity: summary.fieldDensity,
            fieldEntropy: summary.fieldEntropy, fieldAlignment: summary.fieldAlignment,
            fieldDivergence: summary.fieldDivergence, fieldCoherence: summary.fieldCoherence,
            collapseProbability: summary.collapseProbability, dominantStatus: summary.dominantStatus,
            topAttractors: summary.topAttractors,
            summary: { fieldMomentum: summary.fieldMomentum, epistemicCenterOfMass: summary.epistemicCenterOfMass } as any,
        });
        return summary;
    },

    // -------------------------------------------------------------------------
    // influenceBranches — via Branch Influence Plugin
    // -------------------------------------------------------------------------

    async influenceBranches(input: QuantBranchInfluenceInput, domainCtx: DomainContext): Promise<BranchInfluence[]> {
        const all: BranchInfluence[] = [];
        const biPlugin = (await import("./plugins/quant-branch-influence.plugin.js")).quantBranchInfluencePlugin;

        for (const q of input.quants) {
            const pluginCtx = domainCtxToPluginCtx(domainCtx, q.contextId);
            const biInput: QuantSingleBranchInfluenceInput = { quant: q, branchIds: input.branchIds, realmContributions: input.realmContributions };
            const result = await pluginExecutor.executeSingle(biPlugin, biInput, pluginCtx, false);
            if (result.output) all.push(...result.output);
        }

        if (all.length > 0) {
            await db.insert(quantBranchInfluencesTable).values(
                all.map(inf => ({ id: inf.id, quantId: inf.quantId, branchId: inf.branchId, effect: inf.effect, amount: inf.amount, confidence: inf.confidence, explanation: inf.explanation }))
            );
        }
        return all;
    },

    // -------------------------------------------------------------------------
    // influenceHiddenStates — via Hidden State Influence Plugin
    // -------------------------------------------------------------------------

    async influenceHiddenStates(input: QuantHiddenStateInfluenceInput, domainCtx: DomainContext): Promise<HiddenStateInfluence[]> {
        const all: HiddenStateInfluence[] = [];
        const hsPlugin = (await import("./plugins/quant-hidden-state-influence.plugin.js")).quantHiddenStateInfluencePlugin;

        for (const q of input.quants) {
            const pluginCtx = domainCtxToPluginCtx(domainCtx, q.contextId);
            const hsInput: QuantSingleHiddenStateInput = { quant: q, hiddenStateIds: input.hiddenStateIds };
            const result = await pluginExecutor.executeSingle(hsPlugin, hsInput, pluginCtx, false);
            if (result.output) all.push(...result.output);
        }
        return all;
    },

    // -------------------------------------------------------------------------
    // detectCollapse — via Collapse Detector Plugin
    // -------------------------------------------------------------------------

    async detectCollapse(input: QuantCollapseInput, domainCtx: DomainContext): Promise<PredictionCollapseSignal> {
        const pluginCtx = domainCtxToPluginCtx(domainCtx, input.contextId);
        const cdPlugin = (await import("./plugins/quant-collapse-detector.plugin.js")).quantCollapseDetectorPlugin;
        const result = await pluginExecutor.executeSingle(cdPlugin, input, pluginCtx, false);
        if (result.output) return result.output;
        // Fallback
        return { id: randomUUID(), contextId: input.contextId, collapseDetected: false, targetType: "branch", confidence: 0, supportingQuantIds: [], interferingQuantIds: [], fieldEntropy: input.field.fieldEntropy, fieldCoherence: input.field.fieldCoherence, createdAt: domainCtx.now };
    },

    // -------------------------------------------------------------------------
    // detectResonanceAndInterference — via Resonance + Interference plugins
    // -------------------------------------------------------------------------

    async detectResonanceAndInterference(quant: Quant, contextId: string, domainCtx: DomainContext): Promise<QuantRelationship[]> {
        const rows = await db.select().from(quantsTable)
            .where(and(eq(quantsTable.contextId, contextId), eq(quantsTable.lifecycleStatus, "active")))
            .limit(100);
        const candidates = rows.map(rowToQuant);
        const pluginCtx = domainCtxToPluginCtx(domainCtx, contextId);

        const resPlugin = (await import("./plugins/quant-resonance.plugin.js")).quantResonancePlugin;
        const intPlugin = (await import("./plugins/quant-interference.plugin.js")).quantInterferencePlugin;
        const [resResult, intResult] = await Promise.all([
            pluginExecutor.executeSingle(resPlugin, { quant, candidates } as QuantResonanceInput, pluginCtx, false),
            pluginExecutor.executeSingle(intPlugin, { quant, candidates } as QuantInterferenceInput, pluginCtx, false),
        ]);

        const all = [...(resResult.output ?? []), ...(intResult.output ?? [])];
        if (all.length > 0) {
            await db.insert(quantRelationshipsTable).values(
                all.map(r => ({
                    id: r.id, contextId,
                    sourceQuantId: r.sourceQuantId, targetQuantId: r.targetQuantId,
                    relationshipType: r.type, strength: r.strength, confidence: r.confidence,
                    evidenceIds: r.evidenceIds,
                }))
            );
        }
        return all;
    },

    // -------------------------------------------------------------------------
    // applyDecayBatch — via Decay Plugin (background cron)
    // -------------------------------------------------------------------------

    async applyDecayBatch(contextId: string, domainCtx: DomainContext): Promise<{ processed: number }> {
        const rows = await db.select().from(quantsTable)
            .where(and(eq(quantsTable.contextId, contextId), eq(quantsTable.lifecycleStatus, "active")))
            .limit(500);

        const nowMs = Date.now();
        const pluginCtx = domainCtxToPluginCtx(domainCtx, contextId);
        const decayPlugin = (await import("./plugins/quant-decay.plugin.js")).quantDecayPlugin;
        let processed = 0;

        for (const row of rows) {
            const q = rowToQuant(row);
            if (q.lifecycle.decayRate <= 0) continue;

            const decayInput: QuantDecayInput = { quant: q, nowMs };
            const result = await pluginExecutor.executeSingle(decayPlugin, decayInput, pluginCtx, false);
            if (result.status === "success" && result.output) {
                await db.update(quantsTable).set({
                    magnitude: result.output.magnitude,
                    lifecycleStatus: result.output.lifecycle.status,
                    updatedAt: new Date(nowMs),
                }).where(eq(quantsTable.id, q.id));
                processed++;
            }
        }

        logger.info(`[QuantPod] Decay batch: processed ${processed} quants in context ${contextId}`);
        return { processed };
    },
};

export type QuantPod = typeof quantPod;
