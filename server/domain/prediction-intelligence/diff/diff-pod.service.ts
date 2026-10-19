import { randomUUID } from "crypto";
import { db } from "@server/database_service.js";
import { createLogger } from "@server/utils/logger.js";
import { eq, desc } from "drizzle-orm";
import {
    diffRecords as diffRecordsTable,
    driftRecords as driftRecordsTable,
    diffTriggers as diffTriggersTable,
} from "@shared/schema/prediction/diff.js";
import { createPluginContext } from "../plugin-runtime/plugin-runtime.js";
import type { DomainContext } from "../quant/types.js";
import type {
    DiffPort,
    DiffInput,
    DiffResult,
    DiffRecord,
    DiffTrigger,
    QuantFieldDiffInput,
    HiddenStateDiffInput,
    GraphDiffForDiffPodInput,
    DriftInput,
    DriftResult,
    SignificanceInput,
    SignificanceResult,
    PredictionMode,
} from "./types.js";
import { SIGNIFICANCE_THRESHOLD, DRIFT_WINDOW_MS } from "./types.js";
import { eventDiffPlugin } from "./plugins/event-diff.plugin.js";
import { quantDiffPlugin } from "./plugins/quant-diff.plugin.js";
import { hiddenStateDiffPlugin } from "./plugins/hidden-state-diff.plugin.js";
import { velocityPlugin } from "./plugins/velocity.plugin.js";
import { significanceScoringPlugin } from "./plugins/significance-scoring.plugin.js";
import { diffTriggerPlugin } from "./plugins/diff-trigger.plugin.js";
import { clamp, buildDiff } from "./plugins/plugin-helpers.js";
import type { QuantFieldSummary, Quant } from "../quant/types.js";
import type { HiddenStateEstimate } from "../hidden-state/types.js";

const logger = createLogger("DiffPod");

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

async function persistDiffs(contextId: string, diffs: DiffRecord[]): Promise<void> {
    if (diffs.length === 0) return;
    try {
        await db.insert(diffRecordsTable).values(
            diffs.map(d => ({
                id: d.id,
                contextId,
                type: d.type,
                realm: d.realm ?? null,
                sourceRefId: d.sourceRefId ?? null,
                targetRefId: d.targetRefId ?? null,
                beforeState: (d.before ?? null) as any,
                afterState: (d.after ?? null) as any,
                magnitude: d.magnitude,
                velocity: d.velocity ?? null,
                acceleration: d.acceleration ?? null,
                entropyDelta: d.entropyDelta ?? null,
                significance: d.significance,
                direction: d.direction ?? null,
                driftDetected: d.driftDetected ?? false,
                anomalyDetected: d.anomalyDetected ?? false,
                evidenceIds: d.evidenceIds as unknown as string[],
                explanation: d.explanation ?? null,
                createdAt: new Date(d.createdAt),
                payload: {},
            }))
        ).onConflictDoNothing();
    } catch (err) {
        logger.warn("diff record persistence failed", { err: String(err) });
    }
}

async function persistTriggers(contextId: string, triggers: DiffTrigger[]): Promise<void> {
    if (triggers.length === 0) return;
    try {
        await db.insert(diffTriggersTable).values(
            triggers.map(t => ({
                id: t.id,
                contextId,
                triggerType: t.type,
                significance: t.significance,
                reason: t.reason ?? null,
                evidenceIds: t.evidenceIds as unknown as string[],
                createdAt: new Date(t.createdAt),
                payload: {},
            }))
        ).onConflictDoNothing();
    } catch (err) {
        logger.warn("diff trigger persistence failed", { err: String(err) });
    }
}

// ============================================================================
// DiffPod implementation
// ============================================================================

class DiffPod implements DiffPort {

    async diff(input: DiffInput, ctx: DomainContext): Promise<DiffResult> {
        const pluginCtx = domainCtxToPluginCtx(ctx, input.contextId);
        let rawDiffs: DiffRecord[] = [];

        // Route to appropriate plugin based on type
        if (input.type === "event_diff" && Array.isArray((input.currentState as any)?.events)) {
            const cs = input.currentState as any;
            const ps = (input.previousState ?? { events: [] }) as any;
            const r = await eventDiffPlugin.execute({
                contextId: input.contextId,
                currentEvents: cs.events ?? [],
                previousEvents: ps.events ?? [],
                windowDurationMs: cs.windowDurationMs ?? 60_000,
                mode: input.mode,
            }, pluginCtx);
            rawDiffs = r.output ?? [];
        } else if (input.type === "quant_diff") {
            const r = await quantDiffPlugin.execute({
                contextId: input.contextId,
                currentQuants: (input.currentState as Quant[]) ?? [],
                previousQuants: (input.previousState as Quant[]) ?? [],
                mode: input.mode,
            }, pluginCtx);
            rawDiffs = r.output ?? [];
        } else if (input.type === "hidden_state_diff") {
            const curr = input.currentState as HiddenStateEstimate;
            const prev = input.previousState as HiddenStateEstimate | undefined;
            if (prev && curr) {
                const r = await hiddenStateDiffPlugin.execute({
                    contextId: input.contextId,
                    previousEstimate: prev,
                    currentEstimate: curr,
                    mode: input.mode,
                }, pluginCtx);
                rawDiffs = r.output ?? [];
            }
        } else if (input.type === "quant_field_diff") {
            const curr = input.currentState as QuantFieldSummary;
            const prev = input.previousState as QuantFieldSummary | undefined;
            if (prev && curr) {
                rawDiffs = this._diffQuantFieldsInline(input.contextId, prev, curr, ctx.now);
            }
        }

        return this._buildResult(input.contextId, rawDiffs, input.mode, ctx, pluginCtx, Date.now());
    }

    private _diffQuantFieldsInline(contextId: string, prev: QuantFieldSummary, curr: QuantFieldSummary, now: string): DiffRecord[] {
        const diffs: DiffRecord[] = [];
        const entropyDelta = curr.fieldEntropy - prev.fieldEntropy;
        if (Math.abs(entropyDelta) > 0.05) {
            diffs.push(buildDiff({
                contextId, type: "quant_field_diff",
                before: prev.fieldEntropy, after: curr.fieldEntropy,
                magnitude: Math.abs(entropyDelta), entropyDelta,
                direction: entropyDelta > 0 ? "entropy_increasing" : "entropy_decreasing",
                anomalyDetected: Math.abs(entropyDelta) > 0.3,
                explanation: `Field entropy ${prev.fieldEntropy.toFixed(3)} → ${curr.fieldEntropy.toFixed(3)}`,
                now,
            }));
        }
        const cohDelta = curr.fieldCoherence - prev.fieldCoherence;
        if (Math.abs(cohDelta) > 0.1) {
            diffs.push(buildDiff({
                contextId, type: "quant_field_diff",
                before: prev.fieldCoherence, after: curr.fieldCoherence,
                magnitude: Math.abs(cohDelta),
                direction: cohDelta > 0 ? "coherence_increasing" : "coherence_decreasing",
                explanation: `Field coherence ${prev.fieldCoherence.toFixed(3)} → ${curr.fieldCoherence.toFixed(3)}`,
                now,
            }));
        }
        return diffs;
    }

    private async _buildResult(
        contextId: string,
        rawDiffs: DiffRecord[],
        mode: PredictionMode,
        ctx: DomainContext,
        pluginCtx: ReturnType<typeof createPluginContext>,
        startedAt: number,
    ): Promise<DiffResult> {
        const deltaMs = Date.now() - startedAt;

        // Enrich with velocity
        const velocityResult = await velocityPlugin.execute({
            diffs: rawDiffs, deltaMs: Math.max(deltaMs, 100),
        }, pluginCtx);
        let diffs = velocityResult.output ?? rawDiffs;

        // Score significance
        const scoredResult = await significanceScoringPlugin.execute({
            contextId, diffs, mode,
        }, pluginCtx);
        diffs = scoredResult.output ?? diffs;

        // Emit triggers
        const triggerResult = await diffTriggerPlugin.execute({
            contextId, diffs, mode,
        }, pluginCtx);
        const triggers = triggerResult.output ?? [];

        const significantDiffs = diffs.filter(d => d.significance >= SIGNIFICANCE_THRESHOLD);
        const driftDetected = diffs.some(d => d.driftDetected);
        const anomalyDetected = diffs.some(d => d.anomalyDetected);
        const predictionImpactDetected = significantDiffs.some(d =>
            d.type === "hidden_state_diff" || d.type === "branch_diff" ||
            d.type === "quant_field_diff" || d.type === "collapse_diff"
        );

        // Persist async
        persistDiffs(contextId, diffs).catch(() => {});
        persistTriggers(contextId, triggers).catch(() => {});

        return {
            contextId,
            diffs,
            summary: {
                significantDiffs: significantDiffs.length,
                driftDetected,
                anomalyDetected,
                predictionImpactDetected,
            },
            triggers,
            createdAt: ctx.now,
        };
    }

    async diffQuantFields(input: QuantFieldDiffInput, ctx: DomainContext): Promise<DiffRecord[]> {
        const pluginCtx = domainCtxToPluginCtx(ctx, input.contextId);
        const rawDiffs = this._diffQuantFieldsInline(input.contextId, input.previousField, input.currentField, ctx.now);
        const scored = await significanceScoringPlugin.execute({ contextId: input.contextId, diffs: rawDiffs, mode: input.mode }, pluginCtx);
        const diffs = scored.output ?? rawDiffs;
        persistDiffs(input.contextId, diffs).catch(() => {});
        return diffs;
    }

    async diffHiddenStates(input: HiddenStateDiffInput, ctx: DomainContext): Promise<DiffRecord[]> {
        const pluginCtx = domainCtxToPluginCtx(ctx, input.contextId);
        const r = await hiddenStateDiffPlugin.execute(input, pluginCtx);
        const rawDiffs = r.output ?? [];
        const scored = await significanceScoringPlugin.execute({ contextId: input.contextId, diffs: rawDiffs, mode: input.mode }, pluginCtx);
        const diffs = scored.output ?? rawDiffs;
        persistDiffs(input.contextId, diffs).catch(() => {});
        return diffs;
    }

    async diffGraphs(input: GraphDiffForDiffPodInput, ctx: DomainContext): Promise<DiffRecord[]> {
        // Converts graph topology changes to DiffRecords
        const diffs: DiffRecord[] = [
            ...input.currentNodes.map(node => ({
                id: randomUUID(),
                contextId: input.contextId,
                type: "graph_diff" as const,
                sourceRefId: node.id,
                before: null,
                after: { type: node.type, label: node.label },
                magnitude: 0.5,
                significance: 0.5 * (0.65),
                driftDetected: false,
                anomalyDetected: false,
                evidenceIds: [node.id],
                explanation: `Graph node '${node.label ?? node.type}' added`,
                createdAt: ctx.now,
            })),
            ...input.currentEdges.map(edge => ({
                id: randomUUID(),
                contextId: input.contextId,
                type: "graph_diff" as const,
                sourceRefId: edge.sourceNodeId,
                targetRefId: edge.targetNodeId,
                before: null,
                after: { type: edge.type, weight: edge.weight },
                magnitude: clamp(edge.weight),
                significance: clamp(edge.weight * 0.65),
                driftDetected: false,
                anomalyDetected: false,
                evidenceIds: edge.evidenceIds?.slice(0, 4) ?? [],
                explanation: `Graph edge '${edge.type}' (weight=${edge.weight.toFixed(3)}) added`,
                createdAt: ctx.now,
            })),
        ];
        persistDiffs(input.contextId, diffs).catch(() => {});
        return diffs;
    }

    async detectDrift(input: DriftInput, ctx: DomainContext): Promise<DriftResult> {
        const windowMs = input.windowMs ?? DRIFT_WINDOW_MS;
        const cutoff = new Date(Date.parse(ctx.now) - windowMs).toISOString();
        const recent = input.diffRecords.filter(d => d.createdAt >= cutoff);

        if (recent.length < 3) {
            return { contextId: input.contextId, driftDetected: false, magnitude: 0, confidence: 0, evidenceIds: [], createdAt: ctx.now };
        }

        // Check for directional consistency
        const increasing = recent.filter(d => d.direction?.includes("increasing") || d.direction === "emerged").length;
        const decreasing = recent.filter(d => d.direction?.includes("decreasing") || d.direction === "collapsed").length;
        const dominantRatio = Math.max(increasing, decreasing) / recent.length;
        const driftDetected = dominantRatio > 0.65 && recent.length >= 3;
        const direction = increasing > decreasing ? "increasing" : "decreasing";
        const avgMagnitude = recent.reduce((s, d) => s + d.magnitude, 0) / recent.length;
        const confidence = clamp(dominantRatio * avgMagnitude * 1.5);

        const result: DriftResult = {
            contextId: input.contextId,
            driftDetected,
            driftType: driftDetected ? (recent[0]?.type ?? "unknown") : undefined,
            direction: driftDetected ? direction : undefined,
            magnitude: clamp(avgMagnitude),
            confidence,
            evidenceIds: recent.flatMap(d => d.evidenceIds).slice(0, 8),
            explanation: driftDetected
                ? `Drift detected: ${Math.round(dominantRatio * 100)}% of recent diffs are ${direction} over ${(windowMs / 1000).toFixed(0)}s window`
                : undefined,
            createdAt: ctx.now,
        };

        if (driftDetected) {
            db.insert(driftRecordsTable).values({
                id: randomUUID(),
                contextId: input.contextId,
                driftType: result.driftType!,
                direction: result.direction ?? null,
                magnitude: result.magnitude,
                confidence: result.confidence,
                evidenceIds: result.evidenceIds as unknown as string[],
                explanation: result.explanation ?? null,
                createdAt: new Date(ctx.now),
                payload: {},
            }).catch(err => logger.warn("drift record persist failed", err));
        }

        return result;
    }

    async scoreSignificance(input: SignificanceInput, ctx: DomainContext): Promise<SignificanceResult> {
        const pluginCtx = domainCtxToPluginCtx(ctx, input.contextId);
        const scored = await significanceScoringPlugin.execute(input, pluginCtx);
        const diffs = scored.output ?? input.diffs;
        const topDiffs = diffs.filter(d => d.significance >= SIGNIFICANCE_THRESHOLD);
        const overallSignificance = diffs.length > 0
            ? clamp(Math.max(...diffs.map(d => d.significance)))
            : 0;
        return { contextId: input.contextId, overallSignificance, diffs, topDiffs, createdAt: ctx.now };
    }
}

export const diffPod = new DiffPod();
export type { DiffPod };
