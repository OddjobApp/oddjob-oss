// ============================================================================
// PREDICTION INTELLIGENCE DOMAIN - DIFF POD
// Core TypeScript type definitions (spec §7-§32)
// ============================================================================

import type { DomainContext, QuantFieldSummary, Quant, RealmName } from "../quant/types.js";
import type { HiddenStateEstimate } from "../hidden-state/types.js";
import type { GraphNode, GraphEdge } from "../graph/types.js";

export type PredictionMode = "realtime" | "interactive" | "analysis" | "batch";

// ---------------------------------------------------------------------------
// Diff Type (spec §8)
// ---------------------------------------------------------------------------

export type DiffType =
    | "event_diff"
    | "quant_diff"
    | "quant_field_diff"
    | "hidden_state_diff"
    | "branch_diff"
    | "prediction_diff"
    | "realm_diff"
    | "semantic_diff"
    | "geographic_diff"
    | "spatial_diff"
    | "graph_diff"
    | "epistemic_diff"
    | "memory_diff"
    | "trajectory_diff"
    | "shape_diff"
    | "collapse_diff"
    | "drift_diff";

// ---------------------------------------------------------------------------
// Diff Record (spec §7)
// ---------------------------------------------------------------------------

export interface DiffRecord {
    id: string;
    contextId: string;
    type: DiffType;
    realm?: RealmName;
    sourceRefId?: string;
    targetRefId?: string;
    before?: unknown;
    after?: unknown;
    magnitude: number;
    velocity?: number;
    acceleration?: number;
    entropyDelta?: number;
    significance: number;
    direction?: string;
    driftDetected?: boolean;
    anomalyDetected?: boolean;
    evidenceIds: string[];
    explanation?: string;
    createdAt: string;
}

// ---------------------------------------------------------------------------
// Diff Trigger (spec §32)
// ---------------------------------------------------------------------------

export type DiffTriggerType =
    | "prediction_recompute"
    | "branch_recompute"
    | "hidden_state_recompute"
    | "collapse_recheck"
    | "anomaly_alert"
    | "memory_refresh"
    | "investigation_branch";

export interface DiffTrigger {
    id: string;
    type: DiffTriggerType;
    significance: number;
    reason: string;
    evidenceIds: string[];
    createdAt: string;
}

// ---------------------------------------------------------------------------
// Diff Result (spec §31)
// ---------------------------------------------------------------------------

export interface DiffResult {
    contextId: string;
    diffs: DiffRecord[];
    summary: {
        significantDiffs: number;
        driftDetected: boolean;
        anomalyDetected: boolean;
        predictionImpactDetected: boolean;
    };
    triggers: DiffTrigger[];
    createdAt: string;
}

// ---------------------------------------------------------------------------
// Drift types
// ---------------------------------------------------------------------------

export interface DriftResult {
    contextId: string;
    driftDetected: boolean;
    driftType?: string;
    direction?: string;
    magnitude: number;
    confidence: number;
    evidenceIds: string[];
    explanation?: string;
    createdAt: string;
}

export interface SignificanceResult {
    contextId: string;
    overallSignificance: number;
    diffs: DiffRecord[];
    topDiffs: DiffRecord[];
    createdAt: string;
}

// ---------------------------------------------------------------------------
// Port input types (spec §29-§30)
// ---------------------------------------------------------------------------

export interface DiffInput {
    contextId: string;
    previousState?: unknown;
    currentState: unknown;
    realm?: RealmName;
    type: DiffType;
    mode: PredictionMode;
}

export interface QuantFieldDiffInput {
    contextId: string;
    previousField: QuantFieldSummary;
    currentField: QuantFieldSummary;
    mode: PredictionMode;
}

export interface HiddenStateDiffInput {
    contextId: string;
    previousEstimate: HiddenStateEstimate;
    currentEstimate: HiddenStateEstimate;
    mode: PredictionMode;
}

export interface GraphDiffForDiffPodInput {
    contextId: string;
    previousSnapshotId?: string;
    currentNodes: GraphNode[];
    currentEdges: GraphEdge[];
    mode: PredictionMode;
}

export interface DriftInput {
    contextId: string;
    diffRecords: DiffRecord[];
    windowMs?: number;
    mode: PredictionMode;
}

export interface SignificanceInput {
    contextId: string;
    diffs: DiffRecord[];
    baselineDeviation?: number;
    realmAgreementScore?: number;
    mode: PredictionMode;
}

// ---------------------------------------------------------------------------
// Plugin-specific input types
// ---------------------------------------------------------------------------

export interface EventSummary {
    id: string;
    action: string;
    eventKind: string;
    occurredAt: string;
    confidence: number;
}

export interface EventDiffPluginInput {
    contextId: string;
    currentEvents: EventSummary[];
    previousEvents: EventSummary[];
    windowDurationMs: number;
    mode: PredictionMode;
}

export interface QuantDiffPluginInput {
    contextId: string;
    currentQuants: Quant[];
    previousQuants: Quant[];
    mode: PredictionMode;
}

export interface QuantFieldDiffPluginInput {
    contextId: string;
    previousField: QuantFieldSummary;
    currentField: QuantFieldSummary;
    mode: PredictionMode;
}

export interface HiddenStateDiffPluginInput {
    contextId: string;
    previousEstimate: HiddenStateEstimate;
    currentEstimate: HiddenStateEstimate;
    mode: PredictionMode;
}

export interface VelocityPluginInput {
    diffs: DiffRecord[];
    deltaMs: number;
    previousVelocities?: Map<string, number>;
}

export interface SignificanceScoringPluginInput {
    contextId: string;
    diffs: DiffRecord[];
    baselineDeviation?: number;
    realmAgreementScore?: number;
    mode: PredictionMode;
}

export interface DiffTriggerPluginInput {
    contextId: string;
    diffs: DiffRecord[];
    significanceThreshold?: number;
    mode: PredictionMode;
}

// ---------------------------------------------------------------------------
// Diff Port (spec §29)
// ---------------------------------------------------------------------------

export interface DiffPort {
    diff(input: DiffInput, ctx: DomainContext): Promise<DiffResult>;
    diffQuantFields(input: QuantFieldDiffInput, ctx: DomainContext): Promise<DiffRecord[]>;
    diffHiddenStates(input: HiddenStateDiffInput, ctx: DomainContext): Promise<DiffRecord[]>;
    diffGraphs(input: GraphDiffForDiffPodInput, ctx: DomainContext): Promise<DiffRecord[]>;
    detectDrift(input: DriftInput, ctx: DomainContext): Promise<DriftResult>;
    scoreSignificance(input: SignificanceInput, ctx: DomainContext): Promise<SignificanceResult>;
}

// ---------------------------------------------------------------------------
// Prediction impact weight by diff type
// ---------------------------------------------------------------------------

export const PREDICTION_IMPACT_WEIGHT: Record<DiffType, number> = {
    hidden_state_diff:  0.90,
    prediction_diff:    0.90,
    branch_diff:        0.85,
    quant_field_diff:   0.85,
    collapse_diff:      0.85,
    quant_diff:         0.80,
    realm_diff:         0.70,
    event_diff:         0.75,
    epistemic_diff:     0.75,
    semantic_diff:      0.70,
    graph_diff:         0.65,
    memory_diff:        0.60,
    geographic_diff:    0.65,
    spatial_diff:       0.65,
    trajectory_diff:    0.60,
    shape_diff:         0.55,
    drift_diff:         0.70,
};

export const SIGNIFICANCE_THRESHOLD = 0.65;
export const DRIFT_WINDOW_MS = 60_000;
export const DIFF_EPSILON = 1e-6;
