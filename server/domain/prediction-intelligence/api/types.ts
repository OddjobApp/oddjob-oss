// ============================================================================
// PREDICTION INTELLIGENCE DOMAIN - API POD
// Core type definitions (spec §8-§40)
// ============================================================================

import type { DomainContext } from "../quant/types.js";
import type { GovernanceDecision } from "../governance/types.js";

export type ApiRequestMode = "realtime" | "interactive" | "analysis" | "batch";
export type ApiStatus = "success" | "partial" | "failed";
export type ApiErrorCategory = "validation" | "authentication" | "authorization" | "governance" | "not_found" | "conflict" | "rate_limit" | "timeout" | "internal" | "unavailable";

export interface ApiRequestOptions {
    includeExplanation?: boolean;
    includeBranches?: boolean;
    includeQuants?: boolean;
    includeHiddenState?: boolean;
    includeGovernance?: boolean;
    includeTrace?: boolean;
    includeDebug?: boolean;
    stream?: boolean;
    dryRun?: boolean;
    maxResults?: number;
    timeoutMs?: number;
}

export interface ApiRequestEnvelope<T = unknown> {
    requestId?: string;
    idempotencyKey?: string;
    tenantId?: string;
    actorId?: string;
    contextId?: string;
    mode?: ApiRequestMode;
    trace?: { correlationId?: string; parentTraceId?: string };
    options?: ApiRequestOptions;
    data: T;
}

export interface ApiError {
    code: string;
    message: string;
    category: ApiErrorCategory;
    recoverable: boolean;
    details?: Record<string, unknown>;
}

export interface ApiWarning {
    code: string;
    message: string;
    details?: Record<string, unknown>;
}

export interface PaginationInfo {
    limit: number;
    hasMore: boolean;
    nextCursor?: string;
    totalCount?: number;
}

export interface ApiTraceSummary {
    traceId: string;
    latencyMs?: number;
    stagesCompleted: number;
}

export interface ApiResponseEnvelope<T = unknown> {
    requestId: string;
    correlationId: string;
    status: ApiStatus;
    data?: T;
    errors: ApiError[];
    warnings: ApiWarning[];
    governance?: GovernanceDecision;
    trace?: ApiTraceSummary;
    pagination?: PaginationInfo;
    createdAt: string;
}

export interface HealthResponse {
    status: "healthy" | "degraded" | "unhealthy";
    pods: Record<string, "healthy" | "degraded" | "unhealthy">;
    dependencies: Record<string, "healthy" | "degraded" | "unhealthy">;
    timestamp: string;
}

// Event API
export interface CreateEventRequest {
    source: string;
    sourceEventId?: string;
    actorId?: string;
    objectId?: string;
    action?: string;
    occurredAt?: string;
    payload: Record<string, unknown>;
    metadata?: Record<string, unknown>;
}

export interface CreateEventResponse {
    accepted: boolean;
    eventId?: string;
    contextId?: string;
    predictionId?: string;
    warnings: string[];
}

// Prediction API
export interface CreatePredictionRequest {
    contextId?: string;
    eventId?: string;
    mode: ApiRequestMode;
    horizon?: { maxDepth?: number; maxDurationMs?: number };
    options?: ApiRequestOptions;
}

// Calibration API
export interface OutcomeIntakeApiRequest {
    contextId: string;
    predictionId?: string;
    label: string;
    outcomeType: string;
    occurredAt: string;
    confidence?: number;
    payload?: Record<string, unknown>;
}

// HTTP abstractions
export interface HttpRequest {
    method: string;
    path: string;
    headers: Record<string, string>;
    query: Record<string, string>;
    body?: unknown;
    requestId: string;
}

export interface HttpResponse {
    statusCode: number;
    headers: Record<string, string>;
    body: unknown;
}

export interface StreamRequest extends HttpRequest {
    onChunk: (chunk: unknown) => void;
    onClose: () => void;
}

export interface StreamHandle {
    streamId: string;
    close(): void;
}

export interface ApiRuntimeContext extends DomainContext {
    tenantId?: string;
    actorId?: string;
    apiVersion: string;
}

// API Port (spec §40)
export interface ApiPodPort {
    handleHttpRequest(input: HttpRequest, ctx: ApiRuntimeContext): Promise<HttpResponse>;
    handleStreamRequest(input: StreamRequest, ctx: ApiRuntimeContext): Promise<StreamHandle>;
    validateRequest<T>(input: unknown, schemaName: string): Promise<T>;
    renderResponse<T>(input: ApiResponseEnvelope<T>, ctx: ApiRuntimeContext): Promise<HttpResponse>;
    generateOpenApiSpec(): Promise<Record<string, unknown>>;
}

export const CURRENT_API_VERSION = "v1";
