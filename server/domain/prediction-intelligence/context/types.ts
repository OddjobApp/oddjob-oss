// ============================================================================
// PREDICTION INTELLIGENCE DOMAIN — CONTEXT POD
// Full type definitions per spec §6-§34 (replaces stub)
// ============================================================================

import type { DomainContext } from "../quant/types.js";
import type { CanonicalEvent } from "../canonical-event/types.js";

// ---------------------------------------------------------------------------
// Context Type (spec §6)
// ---------------------------------------------------------------------------

export type ContextType =
    | "tenant"
    | "application"
    | "workflow"
    | "session"
    | "actor"
    | "task"
    | "agent"
    | "conversation"
    | "document"
    | "device"
    | "region"
    | "incident"
    | "security"
    | "spatial_scene"
    | "epistemic_investigation"
    | "custom";

export type ContextStatus = "active" | "idle" | "closed" | "merged" | "split" | "archived";
export type ContextRelationType = "parent_of" | "child_of" | "related_to" | "merged_into" | "split_from" | "supersedes";

// ---------------------------------------------------------------------------
// Context Permissions (spec §8)
// ---------------------------------------------------------------------------

export interface ContextPermissions {
    allowPrediction: boolean;
    allowMemoryRecall: boolean;
    allowMemoryWrite: boolean;
    allowAgentAssist: boolean;
    allowGeographicProcessing: boolean;
    allowSpatialProcessing: boolean;
    allowSensitiveData: boolean;
    maxActionLevel: "observe" | "suggest" | "notify" | "automate" | "block";
}

// ---------------------------------------------------------------------------
// Context Provenance
// ---------------------------------------------------------------------------

export interface ContextProvenance {
    source: string;
    method: string;
    resolvedBy: string;
    evidenceIds: string[];
    createdAt: string;
}

// ---------------------------------------------------------------------------
// Full Prediction Context (spec §7) — supersedes quant/types minimal version
// ---------------------------------------------------------------------------

export interface PredictionContext {
    id: string;
    type: ContextType;
    label?: string;

    tenantId?: string;
    applicationId?: string;
    actorId?: string;
    workflowId?: string;
    sessionId?: string;
    taskId?: string;
    agentId?: string;
    regionId?: string;

    parentContextIds: string[];
    childContextIds: string[];
    relatedContextIds: string[];

    status: ContextStatus;
    confidence: number;
    resolutionMethod: string;
    evidenceEventIds: string[];
    evidenceQuantIds: string[];

    permissions: ContextPermissions;
    baselineRefs: string[];

    startedAt: string;
    lastSeenAt: string;
    closedAt?: string;

    provenance: ContextProvenance;
    metadata: Record<string, unknown>;

    // Kept for backward compat with quant/types BasePredictionContext
    mode: "realtime" | "interactive" | "analysis" | "batch";
    createdAt: string;
}

// ---------------------------------------------------------------------------
// Context Candidate (spec §10)
// ---------------------------------------------------------------------------

export interface ContextCandidate {
    contextId?: string;
    type: ContextType;
    label?: string;
    score: number;
    confidence: number;
    evidenceIds: string[];
    reason: string;
}

// ---------------------------------------------------------------------------
// Context Resolution Result (spec §9)
// ---------------------------------------------------------------------------

export interface ContextResolutionResult {
    context: PredictionContext;
    confidence: number;
    candidates: ContextCandidate[];
    createdNew: boolean;
    mergedContextIds: string[];
    splitFromContextId?: string;
    warnings: string[];
}

// ---------------------------------------------------------------------------
// Port input types (spec §33)
// ---------------------------------------------------------------------------

export interface ContextResolutionInput {
    event?: CanonicalEvent;
    contextHint?: string;
    tenantId?: string;
    actorId?: string;
    workflowId?: string;
    sessionId?: string;
    taskId?: string;
    agentId?: string;
    regionId?: string;
    correlationId?: string;
    mode: "realtime" | "interactive" | "analysis" | "batch";
}

export interface ContextCreationInput {
    type: ContextType;
    label?: string;
    tenantId?: string;
    applicationId?: string;
    actorId?: string;
    workflowId?: string;
    sessionId?: string;
    taskId?: string;
    agentId?: string;
    regionId?: string;
    parentContextIds?: string[];
    mode: "realtime" | "interactive" | "analysis" | "batch";
    confidence?: number;
    resolutionMethod?: string;
    evidenceEventIds?: string[];
    metadata?: Record<string, unknown>;
}

export interface ContextLifecycleInput {
    contextId: string;
    status: ContextStatus;
    reason?: string;
    closedAt?: string;
}

export interface ContextMergeInput {
    primaryContextId: string;
    secondaryContextIds: string[];
    reason: string;
    confidence: number;
    evidenceIds?: string[];
}

export interface ContextSplitInput {
    sourceContextId: string;
    splitTypes: ContextType[];
    reason: string;
    confidence: number;
    evidenceIds?: string[];
}

// ---------------------------------------------------------------------------
// Legacy types kept for backward compat
// ---------------------------------------------------------------------------

export interface ContextScope {
    id: string;
    contextId: string;
    name: string;
    type: "tenant" | "user" | "workflow" | "session" | "global";
    value: string;
}

/** Legacy minimal port (kept for backward compat). New code should use ContextPort. */
export interface LegacyContextPort {
    createContext(data: Omit<PredictionContext, "id" | "createdAt">): Promise<PredictionContext>;
    getContext(id: string): Promise<PredictionContext | null>;
    updateContext(id: string, data: Partial<PredictionContext>): Promise<PredictionContext>;
    ensureContext(scope: Partial<ContextScope>, mode: PredictionContext["mode"]): Promise<PredictionContext>;
    closeContext(id: string, reason: "completed" | "expired" | "aborted"): Promise<void>;
}

// ---------------------------------------------------------------------------
// Full Context Port (spec §32)
// ---------------------------------------------------------------------------

export interface ContextPort {
    resolve(input: ContextResolutionInput, ctx: DomainContext): Promise<ContextResolutionResult>;
    getContext(contextId: string, ctx: DomainContext): Promise<PredictionContext | null>;
    createContext(input: ContextCreationInput, ctx: DomainContext): Promise<PredictionContext>;
    updateLifecycle(input: ContextLifecycleInput, ctx: DomainContext): Promise<PredictionContext>;
    mergeContexts(input: ContextMergeInput, ctx: DomainContext): Promise<PredictionContext>;
    splitContext(input: ContextSplitInput, ctx: DomainContext): Promise<PredictionContext[]>;
    getBaselines(contextId: string, ctx: DomainContext): Promise<string[]>;
}

// ---------------------------------------------------------------------------
// Scoring factor constants
// ---------------------------------------------------------------------------

export const DEFAULT_CONTEXT_PERMISSIONS: ContextPermissions = {
    allowPrediction: true,
    allowMemoryRecall: true,
    allowMemoryWrite: true,
    allowAgentAssist: false,
    allowGeographicProcessing: false,
    allowSpatialProcessing: false,
    allowSensitiveData: false,
    maxActionLevel: "suggest",
};

export const CONTEXT_IDLE_TIMEOUT_MS = 300_000;    // 5 min
export const CONTEXT_CLOSE_TIMEOUT_MS = 1_800_000; // 30 min
export const CANDIDATE_SCORE_THRESHOLD = 0.5;
export const MAX_CANDIDATES_REALTIME = 5;
export const MAX_CANDIDATES_INTERACTIVE = 15;
