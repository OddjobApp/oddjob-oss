// ============================================================================
// PREDICTION INTELLIGENCE DOMAIN — CANONICAL EVENT POD
// Bridge to connect MissionEventBus to CanonicalEventService
// ============================================================================

import { randomUUID } from "crypto";
import { missionEventBus, MissionEvent } from "../../mission/core/mission-event-bus.js";
import { canonicalEventService } from "./canonical-event.service.js";
import { quantPod } from "../quant/quant-pod.service.js";
import { observabilityPod } from "../observability/observability-pod.service.js";
import { createLogger } from "@server/utils/logger.js";
import type { DomainContext, PredictionContext, CanonicalEvent as QuantCanonicalEvent } from "../quant/types.js";
import type { CanonicalEvent as CanonicalEventFull } from "./types.js";
import { resolveContextId } from "../context/context.service.js";

// Map from canonical-event pod shape to quant pod shape
function toQuantEvent(e: CanonicalEventFull): QuantCanonicalEvent {
    return {
        id: e.id,
        contextId: e.contextId,
        source: e.source,
        actorId: e.actorId,
        objectId: e.objectId,
        action: e.action,
        eventKind: (e.eventKind as QuantCanonicalEvent["eventKind"]) ?? "fact",
        occurredAt: e.occurredAt,
        ingestedAt: e.ingestedAt,
        confidence: e.confidence,
        rawPayload: e.rawPayload ?? {},
        canonical: e.canonicalPayload ?? {},
        provenance: {
            sourceSystem: e.source,
            sourceId: e.id,
            ingestedAt: e.ingestedAt,
        },
    };
}

const logger = createLogger("MissionEventBridge");

function buildDomainCtx(correlationId: string, organizationId?: number): DomainContext {
    return {
        requestId: `bridge-${randomUUID()}`,
        correlationId,
        now: new Date().toISOString(),
        mode: "realtime",
        organizationId,
    };
}

function buildPredictionCtx(correlationId: string): PredictionContext {
    return {
        id: correlationId,
        mode: "realtime",
        createdAt: new Date().toISOString(),
    };
}

async function resolveMissionRunOrganizationId(missionRunId: number | string): Promise<number | undefined> {
    const parsed = Number(missionRunId);
    if (!Number.isFinite(parsed)) return undefined;

    try {
        const { missionRunService } = await import("@domain/mission/core/mission-run.service.js");
        const run = await missionRunService.getById(parsed);
        return run?.organizationId ?? undefined;
    } catch (err: any) {
        logger.warn(`[MissionEventBridge] organization lookup failed for missionRunId ${missionRunId}`, err);
        return undefined;
    }
}

async function processCanonicalEvent(
    source: string,
    action: string,
    payload: Record<string, unknown>,
    missionRunId: number | string,
) {
    const rawCorrelationId = `mission-${missionRunId}`;
    const correlationId = resolveContextId(rawCorrelationId);
    const organizationId = await resolveMissionRunOrganizationId(missionRunId);
    const domainCtx = buildDomainCtx(correlationId, organizationId);
    const predCtx = buildPredictionCtx(correlationId);

    const result = await canonicalEventService.canonicalize(
        {
            source,
            action,
            payload: { ...payload, organizationId },
            contextHint: rawCorrelationId,
            tenantId: organizationId ? String(organizationId) : undefined,
            objectId: String(missionRunId),
        },
        domainCtx
    );

    if (!result.accepted || !result.event) return;

    // Fire-and-forget: create quants from the canonical event
    quantPod.createFromEvent(toQuantEvent(result.event), predCtx, domainCtx)
        .then(quants => {
            observabilityPod.emit({
                type: "quant_created",
                contextId: correlationId,
                severity: "info",
                source: "mission_event_bridge",
                payload: { missionRunId, organizationId, action, quantCount: quants.length },
            }, domainCtx).catch(() => {});
        })
        .catch(err => logger.warn(`[MissionEventBridge] quant creation failed - missionRunId: ${missionRunId}, action: ${action}`, err));

    // Emit bridge-level telemetry for the canonical event itself
    observabilityPod.emit({
        type: "canonical_event_accepted",
        contextId: correlationId,
        severity: "info",
        source: "mission_event_bridge",
        payload: { missionRunId, organizationId, action, eventId: result.event.id },
    }, domainCtx).catch(() => {});
}

export class MissionEventBridge {
    private static instance: MissionEventBridge;
    private initialized = false;

    private constructor() {}

    public static getInstance(): MissionEventBridge {
        if (!MissionEventBridge.instance) {
            MissionEventBridge.instance = new MissionEventBridge();
        }
        return MissionEventBridge.instance;
    }

    public initialize(): void {
        if (this.initialized) return;

        logger.info("[MissionEventBridge] Initializing bridge to CanonicalEventService");

        // Listen to Phase Transitions
        missionEventBus.on(MissionEvent.PHASE_TRANSITION, async (payload) => {
            try {
                await processCanonicalEvent(
                    "mission_event_bus",
                    "phase_transition",
                    { missionRunId: payload.missionRunId, phase: payload.phase },
                    payload.missionRunId,
                );

                // Predict HIL requirement if in PLANNING or DEBATING phase
                if (payload.phase === "PLANNING" || payload.phase === "DEBATING") {
                    const { missionRunService } = await import("@domain/mission/core/mission-run.service.js");
                    const { hilPredictor } = await import("../prediction/hil-predictor.js");

                    const run = await missionRunService.getById(payload.missionRunId);
                    const plan = (run?.missionContext as any)?.plan || { steps: [] };

                    const prediction = await hilPredictor.predictHilRequirement(payload.missionRunId, plan, {
                        mode: "realtime",
                        now: new Date().toISOString(),
                        requestId: `bridge-${randomUUID()}`,
                        correlationId: `mission-${payload.missionRunId}`
                    });

                    if (prediction.requiresHil) {
                        logger.warn(`[MissionEventBridge] Predicted HIL requirement for mission ${payload.missionRunId}: ${prediction.reason}`);
                        await processCanonicalEvent(
                            "hil_predictor",
                            "hil_prediction",
                            { ...prediction } as unknown as Record<string, unknown>,
                            payload.missionRunId,
                        );
                    }
                }
            } catch (err: any) {
                logger.error(`[MissionEventBridge] Failed to process phase_transition: ${err.message}`);
            }
        });

        // Listen to Completed
        missionEventBus.on(MissionEvent.COMPLETED, async (payload) => {
            try {
                await processCanonicalEvent(
                    "mission_event_bus",
                    "mission_completed",
                    { missionRunId: payload.missionRunId, status: payload.status },
                    payload.missionRunId,
                );
            } catch (err: any) {
                logger.error(`[MissionEventBridge] Failed to forward mission_completed: ${err.message}`);
            }
        });

        // Listen to Failed
        missionEventBus.on(MissionEvent.FAILED, async (payload) => {
            try {
                await processCanonicalEvent(
                    "mission_event_bus",
                    "mission_failed",
                    { missionRunId: payload.missionRunId, status: payload.status, error: payload.error },
                    payload.missionRunId,
                );
            } catch (err: any) {
                logger.error(`[MissionEventBridge] Failed to forward mission_failed: ${err.message}`);
            }
        });

        this.initialized = true;
        logger.info("[MissionEventBridge] Bridge initialized successfully");
    }
}

export const missionEventBridge = MissionEventBridge.getInstance();
