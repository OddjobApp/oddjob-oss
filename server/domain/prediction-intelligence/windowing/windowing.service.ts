// ============================================================================
// PREDICTION INTELLIGENCE DOMAIN — TEMPORAL / WINDOWING POD
// Full service implementation per spec §33 (replaces stub)
// ============================================================================

import { randomUUID } from "crypto";
import { db } from "@server/database_service.js";
import { createLogger } from "@server/utils/logger.js";
import {
    windowSummaries as windowSummariesTable,
    temporalFeatures as temporalFeaturesTable,
} from "@shared/schema/prediction/windowing.js";
import { createPluginContext } from "../plugin-runtime/plugin-runtime.js";
import type { DomainContext } from "../quant/types.js";
import type {
    TemporalWindowingPort,
    WindowingPort,
    Window,
    WindowConfig,
    WindowSummary,
    TemporalFeatures,
    ActiveWindowSet,
    BurstDetectionResult,
    SilenceDetectionResult,
    TemporalValidityResult,
    TimestampNormalizationInput,
    TimestampNormalizationResult,
    EventSequencingInput,
    EventSequenceResult,
    WindowAssignmentInput,
    WindowSummaryInput,
    TemporalFeatureInput,
    BurstDetectionInput,
    SilenceDetectionInput,
    TemporalValidityInput,
    DensityMode,
    PredictionMode,
} from "./types.js";
import { ROLLING_WINDOW_DURATIONS, DEFAULT_RECENCY_LAMBDA, TEMPORAL_EPSILON } from "./types.js";
import { timestampNormalizerPlugin } from "./plugins/timestamp-normalizer.plugin.js";
import { eventSequencerPlugin } from "./plugins/event-sequencer.plugin.js";
import { rollingWindowPlugin } from "./plugins/rolling-window.plugin.js";
import { recencyScoringPlugin } from "./plugins/recency-scoring.plugin.js";
import { frequencyScoringPlugin } from "./plugins/frequency-scoring.plugin.js";
import { burstDetectionPlugin } from "./plugins/burst-detection.plugin.js";
import { silenceDetectionPlugin } from "./plugins/silence-detection.plugin.js";
import { clamp, frequencyScore, recencyDecay } from "./plugins/plugin-helpers.js";

const logger = createLogger("TemporalWindowingService");

function makeCtx(domainCtx: DomainContext, contextId: string) {
    return createPluginContext({
        contextId, mode: domainCtx.mode,
        requestId: domainCtx.requestId, correlationId: domainCtx.correlationId,
        permissions: { canWriteInferences: true, canWritePredictions: false, canCallAgents: false, canReadSensitiveData: false, canUseGeographicData: false, canUseSpatialData: false },
    });
}

async function persistWindowSummaries(summaries: WindowSummary[]): Promise<void> {
    if (!summaries.length) return;
    try {
        await db.insert(windowSummariesTable).values(
            summaries.map(w => ({
                id: w.id,
                contextId: w.contextId,
                type: w.type,
                startTime: new Date(w.startTime),
                endTime: new Date(w.endTime),
                durationMs: w.durationMs,
                eventCount: w.eventCount,
                quantCount: w.quantCount ?? null,
                episodeCount: w.episodeCount ?? null,
                eventDensity: w.eventDensity,
                quantDensity: w.quantDensity ?? null,
                densityMode: w.densityMode,
                topActions: w.topActions as unknown as string[],
                topConcepts: w.topConcepts as unknown as string[],
                topThemes: w.topThemes as unknown as string[],
                entropy: w.entropy ?? null,
                burstScore: w.burstScore ?? null,
                silenceScore: w.silenceScore ?? null,
                persistenceScore: w.persistenceScore ?? null,
                regionId: w.regionId ?? null,
                areaM2: w.areaM2 ?? null,
                geoDensity: w.geoDensity ?? null,
                spacetimeDensity: w.spacetimeDensity ?? null,
                createdAt: new Date(w.createdAt),
                payload: {},
            }))
        ).onConflictDoNothing();
    } catch (err) {
        logger.warn("window summary persistence failed", err as any);
    }
}

async function persistTemporalFeatures(features: TemporalFeatures): Promise<void> {
    try {
        await db.insert(temporalFeaturesTable).values({
            id: randomUUID(),
            contextId: features.contextId,
            eventId: features.eventId ?? null,
            quantId: features.quantId ?? null,
            observedAt: new Date(features.observedAt),
            durationMs: features.durationMs ?? null,
            windowIds: features.windowIds as unknown as string[],
            sequenceIndex: features.sequenceIndex ?? null,
            priorEventId: features.priorEventId ?? null,
            prePriorEventIds: features.prePriorEventIds as unknown as string[],
            recency: features.recency,
            frequency: features.frequency,
            persistence: features.persistence,
            burstScore: features.burstScore,
            silenceScore: features.silenceScore,
            expectedGapMs: features.expectedGapMs ?? null,
            actualGapMs: features.actualGapMs ?? null,
            gapRatio: features.gapRatio ?? null,
            densityMode: features.densityMode,
            temporalValidity: features.temporalValidity,
            createdAt: new Date(features.createdAt),
            payload: {},
        }).onConflictDoNothing();
    } catch (err) {
        logger.warn("temporal features persistence failed", err as any);
    }
}

// ============================================================================
// Service class — implements both legacy WindowingPort and new TemporalWindowingPort
// ============================================================================

export class WindowingService implements WindowingPort, TemporalWindowingPort {
    // Legacy in-memory store for backward-compat WindowingPort
    private legacyWindows = new Map<string, Window>();

    // ── TemporalWindowingPort ─────────────────────────────────────────────

    async normalizeTimestamp(input: TimestampNormalizationInput, ctx: DomainContext): Promise<TimestampNormalizationResult> {
        const pluginCtx = makeCtx(ctx, input.raw.slice(0, 36));
        const result = await timestampNormalizerPlugin.execute(input, pluginCtx);
        return result.output ?? { normalizedAt: ctx.now, ingestedAt: ctx.now, wasRepaired: true };
    }

    async sequenceEvent(input: EventSequencingInput, ctx: DomainContext): Promise<EventSequenceResult> {
        const pluginCtx = makeCtx(ctx, input.event.contextId);
        const result = await eventSequencerPlugin.execute(input, pluginCtx);
        return result.output ?? { sequenceIndex: 0, prePriorEventIds: [], orderingConfidence: 0.5 };
    }

    async assignWindows(input: WindowAssignmentInput, ctx: DomainContext): Promise<ActiveWindowSet> {
        const pluginCtx = makeCtx(ctx, input.contextId);
        const summaries: WindowSummary[] = [];
        const eventCount = input.recentEventCount ?? 1;
        const quantCount = input.recentQuantCount ?? 0;
        const topActions = input.recentEventActions?.slice(0, 5) ?? [];

        // Create a summary per rolling resolution (micro → long)
        for (const [label, durationMs] of Object.entries(ROLLING_WINDOW_DURATIONS)) {
            const result = await rollingWindowPlugin.execute({
                contextId: input.contextId,
                eventId: input.eventId,
                quantId: input.quantId,
                timestamp: input.timestamp,
                eventCount,
                quantCount,
                topActions,
                durationLabel: label,
                durationMs,
                baselineDensity: input.baselineDensity,
            }, pluginCtx);
            if (result.output) summaries.push(result.output);
        }

        const primaryWindowId = summaries.find(w => w.type === "rolling")?.id ?? summaries[0]?.id ?? randomUUID();
        persistWindowSummaries(summaries).catch(() => {});

        return { contextId: input.contextId, eventId: input.eventId, quantId: input.quantId, windows: summaries, primaryWindowId, createdAt: ctx.now };
    }

    async summarizeWindows(input: WindowSummaryInput, ctx: DomainContext): Promise<WindowSummary[]> {
        return input.existingWindows ?? [];
    }

    async computeTemporalFeatures(input: TemporalFeatureInput, ctx: DomainContext): Promise<TemporalFeatures> {
        const pluginCtx = makeCtx(ctx, input.contextId);
        const now = ctx.now;

        // Recency
        const recencyResult = await recencyScoringPlugin.execute({ occurredAt: input.event.occurredAt, now, decayLambda: DEFAULT_RECENCY_LAMBDA }, pluginCtx);
        const recency = recencyResult.output ?? recencyDecay(input.event.occurredAt, now, DEFAULT_RECENCY_LAMBDA);

        // Frequency from primary window
        const primary = input.activeWindows[1] ?? input.activeWindows[0];
        const freqResult = await frequencyScoringPlugin.execute({ countInWindow: primary?.eventCount ?? 1, windowDurationMs: primary?.durationMs ?? 60_000, baselineCount: undefined }, pluginCtx);
        const frequency = freqResult.output ?? frequencyScore(primary?.eventCount ?? 1);

        // Persistence: fraction of windows where density is above baseline
        const windowsAboveBaseline = input.activeWindows.filter(w => w.densityMode === "high" || w.densityMode === "burst").length;
        const persistence = clamp(windowsAboveBaseline / Math.max(input.activeWindows.length, 1));

        // Burst/Silence from primary window
        const burstScore = primary?.burstScore ?? 0;
        const silenceScore = primary?.silenceScore ?? 0;
        const densityMode: DensityMode = primary?.densityMode ?? "normal";

        // Gap analysis
        let actualGapMs: number | undefined;
        let gapRatio: number | undefined;
        if (input.lastEventOccurredAt) {
            actualGapMs = Date.parse(input.event.occurredAt) - Date.parse(input.lastEventOccurredAt);
            if (input.expectedGapMs && input.expectedGapMs > 0) {
                gapRatio = actualGapMs / input.expectedGapMs;
            }
        }

        // Temporal validity: 1.0 unless future event or negative duration
        const eventMs = Date.parse(input.event.occurredAt);
        const nowMs = Date.parse(now);
        const temporalValidity = eventMs > nowMs ? clamp(1 - (eventMs - nowMs) / 86_400_000) : 1.0;

        const features: TemporalFeatures = {
            eventId: input.event.id,
            contextId: input.contextId,
            observedAt: input.event.occurredAt,
            windowIds: input.activeWindows.map(w => w.id),
            sequenceIndex: input.sequenceIndex,
            priorEventId: input.priorEventId,
            prePriorEventIds: input.prePriorEventIds ?? [],
            recency,
            frequency,
            persistence,
            burstScore,
            silenceScore,
            expectedGapMs: input.expectedGapMs,
            actualGapMs,
            gapRatio,
            densityMode,
            temporalValidity,
            createdAt: now,
        };

        persistTemporalFeatures(features).catch(() => {});
        return features;
    }

    async detectBurst(input: BurstDetectionInput, ctx: DomainContext): Promise<BurstDetectionResult> {
        const pluginCtx = makeCtx(ctx, input.contextId);
        const result = await burstDetectionPlugin.execute(input, pluginCtx);
        return result.output ?? { contextId: input.contextId, windowId: input.windowId, burstDetected: false, burstScore: 0, eventTypes: [], evidenceEventIds: [] };
    }

    async detectSilence(input: SilenceDetectionInput, ctx: DomainContext): Promise<SilenceDetectionResult> {
        const pluginCtx = makeCtx(ctx, input.contextId);
        const result = await silenceDetectionPlugin.execute(input, pluginCtx);
        return result.output ?? { contextId: input.contextId, expectedEventType: input.expectedEventType, silenceDetected: false, silenceScore: 0, expectedGapMs: input.expectedGapMs, actualGapMs: input.actualGapMs, createAbsenceEvent: false, evidenceEventIds: [] };
    }

    async evaluateTemporalValidity(input: TemporalValidityInput, ctx: DomainContext): Promise<TemporalValidityResult> {
        const violations: TemporalValidityResult["violations"] = [];
        const nowMs = Date.parse(input.now);

        if (input.effectTime && input.causeTime) {
            if (Date.parse(input.effectTime) < Date.parse(input.causeTime)) {
                violations.push({ type: "effect_before_cause", explanation: `Effect at ${input.effectTime} precedes cause at ${input.causeTime}`, evidenceIds: [] });
            }
        }
        if (input.deadlineTime && Date.parse(input.deadlineTime) < nowMs) {
            violations.push({ type: "deadline_passed", explanation: `Deadline ${input.deadlineTime} has already passed`, evidenceIds: [] });
        }
        if (input.endTime && input.startTime && Date.parse(input.endTime) < Date.parse(input.startTime)) {
            violations.push({ type: "invalid_interval", explanation: "End time precedes start time", evidenceIds: [] });
        }

        const confidence = violations.length === 0 ? 1.0 : clamp(1 - violations.length * 0.35);
        return { valid: violations.length === 0, confidence, violations };
    }

    // ── Legacy WindowingPort (backward compat) ────────────────────────────

    async createWindow(contextId: string, config: WindowConfig): Promise<Window> {
        const id = randomUUID();
        const now = new Date().toISOString();
        const window: Window = { id, contextId, type: config.type, startTime: now, eventIds: [], quantIds: [], metadata: { config } };
        this.legacyWindows.set(id, window);
        return window;
    }

    async getActiveWindows(contextId: string): Promise<Window[]> {
        return Array.from(this.legacyWindows.values()).filter(w => w.contextId === contextId && !w.endTime);
    }

    async addEvent(eventId: string, contextId: string, _timestamp: string): Promise<string[]> {
        const active = await this.getActiveWindows(contextId);
        const addedTo: string[] = [];
        for (const w of active) {
            w.eventIds.push(eventId);
            addedTo.push(w.id);
            const config = w.metadata?.config as WindowConfig;
            if (config?.maxEvents && w.eventIds.length >= config.maxEvents) await this.closeWindow(w.id);
        }
        return addedTo;
    }

    async addQuant(quantId: string, contextId: string, _timestamp: string): Promise<string[]> {
        const active = await this.getActiveWindows(contextId);
        const addedTo: string[] = [];
        for (const w of active) { w.quantIds.push(quantId); addedTo.push(w.id); }
        return addedTo;
    }

    async closeWindow(id: string): Promise<void> {
        const w = this.legacyWindows.get(id);
        if (w) w.endTime = new Date().toISOString();
    }
}

export const windowingService = new WindowingService();
