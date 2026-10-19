// ============================================================================
// PREDICTION INTELLIGENCE DOMAIN - OBSERVABILITY POD
// Core type definitions (spec §7, §36)
// ============================================================================

import type { DomainContext } from "../quant/types.js";

export type TelemetrySeverity = "debug" | "info" | "warning" | "error" | "critical";
export type TelemetrySource = "runtime" | "prediction" | "governance" | "calibration" | "plugin" | "agent"
    | "prediction_pod" | "pruning_pod" | "governance_pod" | "mission_event_bridge"
    | "quant_pod" | "hidden_state_pod" | "memory_pod" | "graph_pod" | "context_pod"
    | "canonical_event_pod" | "observability_pod" | (string & {});
export type TraceStatus = "running" | "completed" | "failed" | "cancelled";
export type TraceStageType = "event_ingestion" | "quant_generation" | "realm_processing" | "hidden_state_inference" | "branch_generation" | "branch_scoring" | "governance" | "explanation" | "storage" | "calibration";

export interface TelemetryEvent {
    id: string;
    type: string;
    timestamp: string;
    contextId?: string;
    predictionId?: string;
    branchId?: string;
    severity: TelemetrySeverity;
    source: TelemetrySource;
    payload: Record<string, unknown>;
}

export interface TraceStage {
    stage: TraceStageType;
    startedAt: string;
    completedAt?: string;
    latencyMs?: number;
    success: boolean;
    metadata: Record<string, unknown>;
}

export interface PredictionTrace {
    traceId: string;
    predictionId: string;
    startedAt: string;
    completedAt?: string;
    stages: TraceStage[];
    status: TraceStatus;
    latencyMs?: number;
}

export interface BranchLifecycleEvent {
    id: string;
    branchId: string;
    eventType: "created" | "scored" | "reserved" | "suppressed" | "pruned" | "collapsed" | "revived";
    probability?: number;
    explanation?: string;
    timestamp: string;
}

export interface MetricsResult {
    period: { from: string; to: string };
    predictionLatencyP50Ms?: number;
    predictionLatencyP95Ms?: number;
    predictionCount: number;
    falsePositiveRate?: number;
    falseNegativeRate?: number;
    falsePruneRate?: number;
    governanceDenyRate?: number;
    pluginErrorRate?: number;
    activeContextCount: number;
    createdAt: string;
}

export interface ObservabilityQueryResult {
    traces?: PredictionTrace[];
    events?: TelemetryEvent[];
    metrics?: MetricsResult;
    createdAt: string;
}

export interface StateReconstructionResult {
    contextId: string;
    asOf: string;
    topPrediction?: string;
    confidence?: number;
    activeBranchCount: number;
    prunedBranchCount: number;
    hiddenStateLabel?: string;
    explanation: string;
}

// Input types
export interface TelemetryInput {
    type: string;
    severity: TelemetrySeverity;
    source: TelemetrySource;
    contextId?: string;
    predictionId?: string;
    branchId?: string;
    payload: Record<string, unknown>;
}

export interface TraceInput {
    predictionId: string;
    contextId?: string;
    stages?: TraceStage[];
}

export interface ObservabilityQueryInput {
    contextId?: string;
    predictionId?: string;
    from?: string;
    to?: string;
    type?: string;
    mode?: "realtime" | "interactive" | "analysis" | "batch";
    limit?: number;
}

export interface StateReconstructionInput {
    contextId: string;
    asOf: string;
}

export interface AlertInput {
    type: string;
    severity: TelemetrySeverity;
    reason: string;
    contextId?: string;
    payload?: Record<string, unknown>;
}

export interface MetricsInput {
    contextId?: string;
    from?: string;
    to?: string;
}

// Port (spec §36)
export interface ObservabilityPort {
    emit(input: TelemetryInput, ctx: DomainContext): Promise<void>;
    trace(input: TraceInput, ctx: DomainContext): Promise<PredictionTrace>;
    query(input: ObservabilityQueryInput, ctx: DomainContext): Promise<ObservabilityQueryResult>;
    reconstructState(input: StateReconstructionInput, ctx: DomainContext): Promise<StateReconstructionResult>;
    alert(input: AlertInput, ctx: DomainContext): Promise<void>;
    metrics(input: MetricsInput, ctx: DomainContext): Promise<MetricsResult>;
}
