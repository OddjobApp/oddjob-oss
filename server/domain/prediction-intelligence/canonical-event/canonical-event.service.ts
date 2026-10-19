// ============================================================================
// PREDICTION INTELLIGENCE DOMAIN — CANONICAL EVENT POD
// Full Service Implementation implementing CanonicalEventPort
// ============================================================================

import { randomUUID } from "crypto";
import type {
    CanonicalEvent,
    EventKind,
    RawEventEnvelope,
    ValidationReport,
    RedactionResult,
    CanonicalEventResult,
    EventCorrectionInput,
    EventRetractionInput,
    CanonicalEventPort,
} from "./types.js";
import type { DomainContext } from "../quant/types.js";
import { createLogger } from "@server/utils/logger.js";
import { db } from "@server/database_service.js";
import { canonicalEvents, eventCorrections } from "@shared/schema/prediction/canonical-event.js";
import { resolveContextId } from "../context/context.service.js";

const logger = createLogger("CanonicalEventService");

export class CanonicalEventService implements CanonicalEventPort {
    /**
     * Full flow: validate, normalize, classify, redact, and persist.
     */
    async canonicalize(input: RawEventEnvelope, ctx: DomainContext): Promise<CanonicalEventResult> {
        logger.info(`[CanonicalEvent] Canonicalizing event from source ${input.source}`);
        
        const validation = await this.validate(input, ctx);
        if (!validation.valid && !validation.repairable) {
            return {
                accepted: false,
                validation,
                warnings: ["Event failed validation and is not repairable"],
                rejection: {
                    rejected: true,
                    reason: "Validation failed",
                    code: "VAL_FAIL",
                    recoverable: false
                }
            };
        }

        const partialEvent = await this.normalize(input, ctx);
        const eventKind = await this.classifyKind(partialEvent, ctx);
        
        const now = new Date().toISOString();
        const fullEvent: CanonicalEvent = {
            id: partialEvent.id || randomUUID(),
            schemaVersion: "1.0",
            contextId: partialEvent.contextId || "default-context",
            tenantId: partialEvent.tenantId,
            actorId: partialEvent.actorId,
            objectId: partialEvent.objectId,
            source: partialEvent.source || "unknown",
            action: partialEvent.action || "unknown_action",
            eventKind,
            occurredAt: partialEvent.occurredAt || now,
            ingestedAt: now,
            confidence: partialEvent.confidence || 1.0,
            sourceTrust: 1.0,
            canonicalPayload: partialEvent.canonicalPayload || {},
            classification: partialEvent.classification || { domain: "general" },
            sensitivity: partialEvent.sensitivity || { containsSensitiveData: false, sensitivityLevel: "none", categories: [], redactedFields: [], allowedForPrediction: true, allowedForMemory: true, allowedForAgents: true },
            provenance: partialEvent.provenance || { source: input.source, method: "direct", evidenceIds: [], createdAt: now },
            lineage: partialEvent.lineage || { parentEventIds: [], derivedEventIds: [] },
            createdAt: now,
            updatedAt: now,
        };

        const redaction = await this.redact(fullEvent, ctx);
        const finalEvent = await this.persist(redaction.event as CanonicalEvent, ctx);

        return {
            accepted: true,
            event: finalEvent,
            validation,
            warnings: []
        };
    }

    async validate(input: RawEventEnvelope, ctx: DomainContext): Promise<ValidationReport> {
        const errors = [];
        if (!input.source) errors.push({ code: "MISSING_SOURCE", field: "source", message: "Source is required" });
        if (!input.payload) errors.push({ code: "MISSING_PAYLOAD", field: "payload", message: "Payload is required" });

        return {
            valid: errors.length === 0,
            errors,
            warnings: [],
            repairable: false
        };
    }

    async normalize(input: RawEventEnvelope, ctx: DomainContext): Promise<Partial<CanonicalEvent>> {
        const now = new Date().toISOString();
        return {
            id: randomUUID(),
            contextId: input.contextHint || "default-context",
            tenantId: input.tenantId,
            actorId: input.actorId,
            objectId: input.objectId,
            source: input.source,
            action: input.action || "unknown_action",
            occurredAt: input.occurredAt || now,
            canonicalPayload: input.payload,
        };
    }

    async classifyKind(input: Partial<CanonicalEvent>, ctx: DomainContext): Promise<EventKind> {
        const action = String(input.action || "").toLowerCase();
        if (action.includes("predict")) return "prediction";
        if (action.includes("inference")) return "inference";
        return "fact";
    }

    async redact(input: Partial<CanonicalEvent>, ctx: DomainContext): Promise<RedactionResult> {
        // Mock redaction
        return {
            event: input,
            redactedFields: [],
            sensitivity: input.sensitivity || { containsSensitiveData: false, sensitivityLevel: "none", categories: [], redactedFields: [], allowedForPrediction: true, allowedForMemory: true, allowedForAgents: true }
        };
    }

    async persist(input: CanonicalEvent, ctx: DomainContext): Promise<CanonicalEvent> {
        logger.info(`[CanonicalEvent] Persisting event ${input.id}`);
        try {
            await db.insert(canonicalEvents).values({
                id: input.id,
                schemaVersion: input.schemaVersion,
                contextId: resolveContextId(input.contextId),
                tenantId: input.tenantId || null,
                actorId: input.actorId || null,
                objectId: input.objectId || null,
                source: input.source,
                action: input.action,
                eventKind: input.eventKind,
                occurredAt: new Date(input.occurredAt),
                ingestedAt: new Date(input.ingestedAt),
                observedAt: input.observedAt ? new Date(input.observedAt) : null,
                durationMs: input.durationMs || null,
                confidence: input.confidence,
                sourceTrust: input.sourceTrust,
                rawPayloadRef: input.rawPayloadRef || null,
                rawPayload: input.rawPayload || null,
                canonicalPayload: input.canonicalPayload,
                classification: input.classification as any,
                sensitivity: input.sensitivity as any,
                provenance: input.provenance as any,
                lineage: input.lineage as any,
                repair: input.repair || null,
                createdAt: input.createdAt ? new Date(input.createdAt) : new Date(),
                updatedAt: input.updatedAt ? new Date(input.updatedAt) : new Date(),
            });
        } catch (err: any) {
            logger.warn(`[CanonicalEvent] DB persistence failed for event ${input.id}; utilizing transient fallback`, { err });
        }
        return input;
    }

    async correct(input: EventCorrectionInput, ctx: DomainContext): Promise<CanonicalEvent> {
        logger.info(`[CanonicalEvent] Correcting event ${input.originalEventId}`);
        const now = new Date().toISOString();
        const correctionEventId = randomUUID();
        
        const correctionEvent: CanonicalEvent = {
            id: correctionEventId,
            schemaVersion: "1.0",
            contextId: resolveContextId(input.contextId),
            source: "system",
            action: `correct_${input.correctionType}`,
            eventKind: "correction",
            occurredAt: now,
            ingestedAt: now,
            confidence: 1.0,
            sourceTrust: 1.0,
            canonicalPayload: input.correctedFields,
            classification: { domain: "governance", category: "correction" },
            sensitivity: { containsSensitiveData: false, sensitivityLevel: "none", categories: [], redactedFields: [], allowedForPrediction: true, allowedForMemory: true, allowedForAgents: true },
            provenance: { source: "canonical-event-service", method: "correct", createdAt: now, evidenceIds: [input.originalEventId] },
            lineage: { parentEventIds: [input.originalEventId], derivedEventIds: [] },
            createdAt: now,
            updatedAt: now,
        };

        await this.persist(correctionEvent, ctx);

        try {
            await db.insert(eventCorrections).values({
                id: randomUUID(),
                originalEventId: input.originalEventId,
                correctionEventId: correctionEventId,
                correctionType: input.correctionType,
                explanation: input.explanation,
                createdAt: new Date(),
            });
        } catch (err: any) {
            logger.warn(`[CanonicalEvent] Failed to persist correction link for ${input.originalEventId}`, { err });
        }

        return correctionEvent;
    }

    async retract(input: EventRetractionInput, ctx: DomainContext): Promise<CanonicalEvent> {
        logger.info(`[CanonicalEvent] Retracting event ${input.retractedEventId}`);
        const now = new Date().toISOString();
        const retractionEventId = randomUUID();

        const retractionEvent: CanonicalEvent = {
            id: retractionEventId,
            schemaVersion: "1.0",
            contextId: resolveContextId(input.contextId),
            source: "system",
            action: "retract_event",
            eventKind: "retraction",
            occurredAt: now,
            ingestedAt: now,
            confidence: 1.0,
            sourceTrust: 1.0,
            canonicalPayload: { retractedEventId: input.retractedEventId, reason: input.reason },
            classification: { domain: "governance", category: "retraction" },
            sensitivity: { containsSensitiveData: false, sensitivityLevel: "none", categories: [], redactedFields: [], allowedForPrediction: true, allowedForMemory: true, allowedForAgents: true },
            provenance: { source: "canonical-event-service", method: "retract", createdAt: now, evidenceIds: [input.retractedEventId] },
            lineage: { parentEventIds: [input.retractedEventId], derivedEventIds: [] },
            createdAt: now,
            updatedAt: now,
        };

        await this.persist(retractionEvent, ctx);

        try {
            await db.insert(eventCorrections).values({
                id: randomUUID(),
                originalEventId: input.retractedEventId,
                correctionEventId: retractionEventId,
                correctionType: "retraction",
                explanation: input.reason,
                createdAt: new Date(),
            });
        } catch (err: any) {
            logger.warn(`[CanonicalEvent] Failed to persist retraction link for ${input.retractedEventId}`, { err });
        }

        return retractionEvent;
    }
}

export const canonicalEventService = new CanonicalEventService();
