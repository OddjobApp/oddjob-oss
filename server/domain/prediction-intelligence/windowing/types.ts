// ============================================================================
// PREDICTION INTELLIGENCE DOMAIN — TEMPORAL / WINDOWING POD
// Full type definitions per spec §7-§37 (replaces stub)
// ============================================================================

import type { DomainContext } from "../quant/types.js";

export type PredictionMode = "realtime" | "interactive" | "analysis" | "batch";

// ---------------------------------------------------------------------------
// Window Type (spec §7)
// ---------------------------------------------------------------------------

export type WindowType =
    | "micro"
    | "short"
    | "medium"
    | "long"
    | "lifetime"
    | "rolling"
    | "fixed"
    | "session"
    | "episode"
    | "baseline"
    | "geographic"
    | "spatiotemporal";

export type DensityMode = "low" | "normal" | "high" | "burst" | "silent";

// ---------------------------------------------------------------------------
// Temporal Relation (spec §10)
// ---------------------------------------------------------------------------

export type TemporalRelation =
    | "before"
    | "after"
    | "meets"
    | "overlaps"
    | "starts"
    | "during"
    | "finishes"
    | "equals"
    | "contains"
    | "persists_through"
    | "emerges_after"
    | "expires_before"
    | "recurs_within"
    | "missing_after"
    | "bursts_within"
    | "silent_during";

// ---------------------------------------------------------------------------
// Window Summary — full spec version (spec §8)
// ---------------------------------------------------------------------------

export interface WindowSummary {
    id: string;
    contextId: string;
    type: WindowType;
    startTime: string;
    endTime: string;
    durationMs: number;
    eventCount: number;
    quantCount?: number;
    episodeCount?: number;
    eventDensity: number;
    quantDensity?: number;
    densityMode: DensityMode;
    topActions: string[];
    topConcepts: string[];
    topThemes: string[];
    entropy?: number;
    burstScore?: number;
    silenceScore?: number;
    persistenceScore?: number;
    regionId?: string;
    areaM2?: number;
    geoDensity?: number;
    spacetimeDensity?: number;
    createdAt: string;
}

// ---------------------------------------------------------------------------
// Temporal Features (spec §9)
// ---------------------------------------------------------------------------

export interface TemporalFeatures {
    eventId?: string;
    quantId?: string;
    contextId: string;
    observedAt: string;
    durationMs?: number;
    windowIds: string[];
    sequenceIndex?: number;
    priorEventId?: string;
    prePriorEventIds: string[];
    recency: number;
    frequency: number;
    persistence: number;
    burstScore: number;
    silenceScore: number;
    expectedGapMs?: number;
    actualGapMs?: number;
    gapRatio?: number;
    densityMode: DensityMode;
    temporalValidity: number;
    createdAt: string;
}

// ---------------------------------------------------------------------------
// Active Window Set (spec §34)
// ---------------------------------------------------------------------------

export interface ActiveWindowSet {
    contextId: string;
    eventId?: string;
    quantId?: string;
    windows: WindowSummary[];
    primaryWindowId: string;
    createdAt: string;
}

// ---------------------------------------------------------------------------
// Burst / Silence Detection Results (spec §35-§36)
// ---------------------------------------------------------------------------

export interface BurstDetectionResult {
    contextId: string;
    windowId: string;
    burstDetected: boolean;
    burstScore: number;
    eventTypes: string[];
    evidenceEventIds: string[];
    recommendedAction?: "none" | "compress_episode" | "recompute_prediction";
}

export interface SilenceDetectionResult {
    contextId: string;
    expectedEventType: string;
    silenceDetected: boolean;
    silenceScore: number;
    expectedGapMs: number;
    actualGapMs: number;
    createAbsenceEvent: boolean;
    evidenceEventIds: string[];
}

// ---------------------------------------------------------------------------
// Temporal Validity Result (spec §37)
// ---------------------------------------------------------------------------

export interface TemporalValidityResult {
    valid: boolean;
    confidence: number;
    violations: {
        type: string;
        explanation: string;
        evidenceIds: string[];
    }[];
}

// ---------------------------------------------------------------------------
// Port input/output types
// ---------------------------------------------------------------------------

export interface TimestampNormalizationInput {
    raw: string;
    sourceTimezone?: string;
    repairPolicy?: "best_effort" | "reject";
    ingestedAt?: string;
}

export interface TimestampNormalizationResult {
    normalizedAt: string;
    ingestedAt: string;
    durationMs?: number;
    wasRepaired: boolean;
    timezoneMetadata?: { original?: string; offsetMinutes?: number };
}

export interface EventSequencingInput {
    event: { id: string; occurredAt: string; action: string; contextId: string };
    recentEvents: { id: string; occurredAt: string; sequenceIndex?: number }[];
}

export interface EventSequenceResult {
    sequenceIndex: number;
    priorEventId?: string;
    prePriorEventIds: string[];
    orderingConfidence: number;
}

export interface WindowAssignmentInput {
    contextId: string;
    eventId?: string;
    quantId?: string;
    timestamp: string;
    recentEventActions?: string[];
    recentEventCount?: number;
    recentQuantCount?: number;
    baselineDensity?: number;
    mode: PredictionMode;
}

export interface WindowSummaryInput {
    contextId: string;
    windowType?: WindowType;
    existingWindows?: WindowSummary[];
    mode: PredictionMode;
}

export interface TemporalFeatureInput {
    contextId: string;
    event: { id: string; action: string; occurredAt: string };
    sequenceIndex?: number;
    priorEventId?: string;
    prePriorEventIds?: string[];
    activeWindows: WindowSummary[];
    baselineDensity?: number;
    expectedGapMs?: number;
    lastEventOccurredAt?: string;
    mode: PredictionMode;
}

export interface BurstDetectionInput {
    contextId: string;
    windowId: string;
    currentDensity: number;
    baselineDensity: number;
    eventTypes: string[];
    evidenceEventIds: string[];
    mode: PredictionMode;
}

export interface SilenceDetectionInput {
    contextId: string;
    expectedEventType: string;
    expectedGapMs: number;
    actualGapMs: number;
    lastEventId?: string;
    evidenceEventIds?: string[];
}

export interface TemporalValidityInput {
    contextId: string;
    startTime: string;
    endTime?: string;
    causeTime?: string;
    effectTime?: string;
    deadlineTime?: string;
    now: string;
}

// ---------------------------------------------------------------------------
// Plugin-specific input types
// ---------------------------------------------------------------------------

export interface TimestampNormalizerPluginInput extends TimestampNormalizationInput {}

export interface EventSequencerPluginInput extends EventSequencingInput {}

export interface RollingWindowPluginInput {
    contextId: string;
    eventId?: string;
    quantId?: string;
    timestamp: string;
    eventCount: number;
    quantCount: number;
    topActions: string[];
    durationLabel: string;
    durationMs: number;
    baselineDensity?: number;
}

export interface DensityModePluginInput {
    currentDensity: number;
    baselineDensity: number;
    shortWindowDensity?: number;
}

export interface RecencyScoringPluginInput {
    occurredAt: string;
    now: string;
    decayLambda?: number;
}

export interface FrequencyScoringPluginInput {
    countInWindow: number;
    windowDurationMs: number;
    baselineCount?: number;
}

// ---------------------------------------------------------------------------
// Legacy types kept for backward compat
// ---------------------------------------------------------------------------

/** Basic window object (legacy - use WindowSummary for new code). */
export interface Window {
    id: string;
    contextId: string;
    type: "rolling" | "session" | "episode";
    startTime: string;
    endTime?: string;
    eventIds: string[];
    quantIds: string[];
    metadata?: Record<string, unknown>;
}

export interface WindowConfig {
    type: "rolling" | "session" | "episode";
    durationMs?: number;
    idleTimeoutMs?: number;
    maxEvents?: number;
}

/** Legacy windowing port (kept for backward compat). */
export interface WindowingPort {
    createWindow(contextId: string, config: WindowConfig): Promise<Window>;
    getActiveWindows(contextId: string): Promise<Window[]>;
    addEvent(eventId: string, contextId: string, timestamp: string): Promise<string[]>;
    addQuant(quantId: string, contextId: string, timestamp: string): Promise<string[]>;
    closeWindow(id: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Full Temporal Windowing Port (spec §33)
// ---------------------------------------------------------------------------

export interface TemporalWindowingPort {
    normalizeTimestamp(input: TimestampNormalizationInput, ctx: DomainContext): Promise<TimestampNormalizationResult>;
    sequenceEvent(input: EventSequencingInput, ctx: DomainContext): Promise<EventSequenceResult>;
    assignWindows(input: WindowAssignmentInput, ctx: DomainContext): Promise<ActiveWindowSet>;
    summarizeWindows(input: WindowSummaryInput, ctx: DomainContext): Promise<WindowSummary[]>;
    computeTemporalFeatures(input: TemporalFeatureInput, ctx: DomainContext): Promise<TemporalFeatures>;
    detectBurst(input: BurstDetectionInput, ctx: DomainContext): Promise<BurstDetectionResult>;
    detectSilence(input: SilenceDetectionInput, ctx: DomainContext): Promise<SilenceDetectionResult>;
    evaluateTemporalValidity(input: TemporalValidityInput, ctx: DomainContext): Promise<TemporalValidityResult>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Rolling window resolution durations in milliseconds. */
export const ROLLING_WINDOW_DURATIONS: Record<string, number> = {
    micro:  5_000,
    short:  60_000,
    medium: 300_000,
    long:   1_800_000,
};

export const DEFAULT_RECENCY_LAMBDA = 0.1;    // per second
export const BURST_RATIO_THRESHOLD  = 2.5;    // density multiplier
export const SILENCE_RATIO_THRESHOLD = 2.0;   // gap multiplier
export const MIN_BURST_DENSITY = 0.05;        // events/sec floor
export const TEMPORAL_EPSILON = 1e-9;
