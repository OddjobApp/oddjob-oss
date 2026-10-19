// ============================================================================
// PREDICTION INTELLIGENCE DOMAIN — CANONICAL EVENT POD
// Full type definitions per spec §5-§33 (replaces stub)
// ============================================================================

import type { DomainContext } from "../quant/types.js";

// ---------------------------------------------------------------------------
// Event Kind (spec §5)
// ---------------------------------------------------------------------------

export type EventKind =
    | "fact"
    | "inference"
    | "prediction"
    | "absence"
    | "synthetic"
    | "correction"
    | "retraction";

// ---------------------------------------------------------------------------
// Event Classification (spec §7)
// ---------------------------------------------------------------------------

export interface EventClassification {
    domain?: string;
    category?: string;
    subcategory?: string;
    severity?: "low" | "medium" | "high" | "critical";
    reliability?: "low" | "medium" | "high";
    expected?: boolean;
    userVisible?: boolean;
    machineGenerated?: boolean;
    requiresGovernance?: boolean;
}

// ---------------------------------------------------------------------------
// Sensitivity Profile (spec §8)
// ---------------------------------------------------------------------------

export type SensitivityLevel = "none" | "low" | "medium" | "high" | "restricted";
export type SensitivityCategory =
    | "precise_location"
    | "personal_identifier"
    | "credential"
    | "financial_data"
    | "health_data"
    | "private_content"
    | "security_sensitive"
    | "restricted_business_data";

export interface SensitivityProfile {
    containsSensitiveData: boolean;
    sensitivityLevel: SensitivityLevel;
    categories: SensitivityCategory[];
    redactedFields: string[];
    allowedForPrediction: boolean;
    allowedForMemory: boolean;
    allowedForAgents: boolean;
}

// ---------------------------------------------------------------------------
// Event Lineage (spec §9)
// ---------------------------------------------------------------------------

export interface EventLineage {
    parentEventIds: string[];
    derivedEventIds: string[];
    sourceSystemEventId?: string;
    externalTraceId?: string;
    correlationId?: string;
    causallyRelatedEventIds?: string[];
    supersedesEventId?: string;
    retractedEventId?: string;
}

// ---------------------------------------------------------------------------
// Provenance (spec §10)
// ---------------------------------------------------------------------------

export interface CanonicalEventProvenance {
    source: string;
    method: string;
    pluginName?: string;
    pluginVersion?: string;
    modelVersion?: string;
    evidenceIds: string[];
    createdAt: string;
}

// ---------------------------------------------------------------------------
// Event Repair Info (spec §11)
// ---------------------------------------------------------------------------

export type EventRepairType =
    | "timestamp_repair"
    | "schema_repair"
    | "missing_context_repair"
    | "payload_type_repair"
    | "source_mapping_repair";

export interface EventRepairInfo {
    repaired: boolean;
    repairType: EventRepairType;
    confidence: number;
    explanation: string;
}

// ---------------------------------------------------------------------------
// Event Rejection Info (spec §12)
// ---------------------------------------------------------------------------

export interface EventRejectionInfo {
    rejected: boolean;
    reason: string;
    code: string;
    recoverable: boolean;
    rawPayloadRef?: string;
}

// ---------------------------------------------------------------------------
// Canonical Event (spec §6) — full version superseding quant/types BaseCanonicalEvent
// ---------------------------------------------------------------------------

export interface CanonicalEvent {
    id: string;
    schemaVersion: string;
    contextId: string;
    tenantId?: string;
    actorId?: string;
    objectId?: string;
    source: string;
    action: string;
    eventKind: EventKind;
    occurredAt: string;
    ingestedAt: string;
    observedAt?: string;
    durationMs?: number;
    confidence: number;
    sourceTrust: number;
    rawPayloadRef?: string;
    rawPayload?: Record<string, unknown>;
    canonicalPayload: Record<string, unknown>;
    classification: EventClassification;
    sensitivity: SensitivityProfile;
    provenance: CanonicalEventProvenance;
    lineage: EventLineage;
    repair?: EventRepairInfo;
    rejection?: EventRejectionInfo;
    createdAt: string;
    updatedAt: string;
}

// ---------------------------------------------------------------------------
// Raw Event Envelope (spec §14)
// ---------------------------------------------------------------------------

export interface RawEventEnvelope {
    source: string;
    sourceEventId?: string;
    tenantId?: string;
    contextHint?: string;
    actorId?: string;
    objectId?: string;
    action?: string;
    eventKindHint?: EventKind;
    occurredAt?: string;
    observedAt?: string;
    durationMs?: number;
    payload: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    traceId?: string;
    correlationId?: string;
}

// ---------------------------------------------------------------------------
// Validation types (spec §32)
// ---------------------------------------------------------------------------

export interface ValidationError { code: string; field?: string; message: string }
export interface ValidationWarning { code: string; field?: string; message: string }

export interface ValidationReport {
    valid: boolean;
    errors: ValidationError[];
    warnings: ValidationWarning[];
    repairable: boolean;
}

// ---------------------------------------------------------------------------
// Redaction Result (spec §33)
// ---------------------------------------------------------------------------

export interface RedactionResult {
    event: Partial<CanonicalEvent>;
    redactedFields: string[];
    sensitivity: SensitivityProfile;
}

// ---------------------------------------------------------------------------
// Canonical Event Result (spec §31)
// ---------------------------------------------------------------------------

export interface CanonicalEventResult {
    accepted: boolean;
    event?: CanonicalEvent;
    rejection?: EventRejectionInfo;
    validation: ValidationReport;
    warnings: string[];
}

// ---------------------------------------------------------------------------
// Port input types
// ---------------------------------------------------------------------------

export interface EventCorrectionInput {
    originalEventId: string;
    correctionType: EventRepairType;
    correctedFields: Record<string, unknown>;
    explanation: string;
    contextId: string;
}

export interface EventRetractionInput {
    retractedEventId: string;
    reason: string;
    contextId: string;
}

export interface DeduplicationCandidate {
    keyType: string;
    keyValue: string;
    existingEventId?: string;
    isDuplicate: boolean;
}

// ---------------------------------------------------------------------------
// Canonical Event Port (spec §30)
// ---------------------------------------------------------------------------

export interface CanonicalEventPort {
    canonicalize(input: RawEventEnvelope, ctx: DomainContext): Promise<CanonicalEventResult>;
    validate(input: RawEventEnvelope, ctx: DomainContext): Promise<ValidationReport>;
    normalize(input: RawEventEnvelope, ctx: DomainContext): Promise<Partial<CanonicalEvent>>;
    classifyKind(input: Partial<CanonicalEvent>, ctx: DomainContext): Promise<EventKind>;
    redact(input: Partial<CanonicalEvent>, ctx: DomainContext): Promise<RedactionResult>;
    persist(input: CanonicalEvent, ctx: DomainContext): Promise<CanonicalEvent>;
    correct(input: EventCorrectionInput, ctx: DomainContext): Promise<CanonicalEvent>;
    retract(input: EventRetractionInput, ctx: DomainContext): Promise<CanonicalEvent>;
}

// ---------------------------------------------------------------------------
// Event Normalization Rule (kept from old types for backward compat)
// ---------------------------------------------------------------------------

export interface EventNormalizationRule {
    id: string;
    sourceType: string;
    eventType: string;
    transform: (raw: unknown) => Partial<CanonicalEvent>;
}

// ---------------------------------------------------------------------------
// Source action normalization map
// ---------------------------------------------------------------------------

export const SOURCE_ACTION_MAP: Record<string, Record<string, string>> = {
    stripe: {
        "payment_intent.failed": "payment_failed",
        "payment_intent.succeeded": "payment_succeeded",
        "charge.refunded": "refund_issued",
    },
    github: {
        "pull_request.opened": "pull_request_opened",
        "pull_request.closed": "pull_request_closed",
        "push": "code_pushed",
    },
    agent: {
        "tool.error": "agent_tool_failed",
        "tool.call": "agent_tool_called",
        "tool.result": "agent_tool_completed",
    },
    workflow_engine: {
        "step.failed": "workflow_step_failed",
        "step.completed": "workflow_step_completed",
        "task.failed": "task_failed",
    },
};

export const SENSITIVE_FIELD_PATTERNS: RegExp[] = [
    /password/i, /secret/i, /token/i, /api_key/i, /apikey/i,
    /credit_card/i, /ssn/i, /dob/i, /date_of_birth/i,
    /home_address/i, /precise_location/i, /lat.*lon/i,
    /private_key/i, /auth_token/i,
];

export const MAX_PAYLOAD_SIZE_BYTES = 512_000;
export const SCHEMA_VERSION = "1.0";
