// ============================================================================
// PREDICTION INTELLIGENCE DOMAIN — OBSERVABILITY POD SERVICE
// MVP: async telemetry emission + trace construction + basic metrics.
// Designed to be non-blocking — never throws on the hot path.
// ============================================================================

import { randomUUID } from "crypto";
import { createLogger } from "@server/utils/logger.js";
import type { DomainContext } from "../quant/types.js";
import type {
    ObservabilityPort,
    TelemetryEvent,
    TelemetryInput,
    PredictionTrace,
    TraceInput,
    ObservabilityQueryInput,
    ObservabilityQueryResult,
    StateReconstructionInput,
    StateReconstructionResult,
    AlertInput,
    MetricsInput,
    MetricsResult,
    TraceStage,
} from "./types.js";

const logger = createLogger("ObservabilityPod");

// In-memory ring buffers for MVP — swap with OpenTelemetry/Prometheus in production
const MAX_EVENTS = 10_000;
const eventBuffer: TelemetryEvent[] = [];
const traceStore = new Map<string, PredictionTrace>();

class ObservabilityPod implements ObservabilityPort {

    async emit(input: TelemetryInput, ctx: DomainContext): Promise<void> {
        const event: TelemetryEvent = {
            id: randomUUID(),
            type: input.type,
            timestamp: ctx.now,
            contextId: input.contextId,
            predictionId: input.predictionId,
            branchId: input.branchId,
            severity: input.severity,
            source: input.source,
            payload: input.payload,
        };

        // Ring buffer (in-memory for query; swap for OTEL exporter in production)
        if (eventBuffer.length >= MAX_EVENTS) eventBuffer.shift();
        eventBuffer.push(event);

        // Emit every event through structured pino log at the appropriate level
        const logCtx = { type: event.type, source: event.source, contextId: event.contextId, predictionId: event.predictionId, payload: event.payload };
        switch (input.severity) {
            case "critical":
            case "error":
                logger.error(`[PI] ${event.type}`, undefined, logCtx); break;
            case "warning":
                logger.warn(`[PI] ${event.type}`, logCtx); break;
            case "info":
                logger.info(`[PI] ${event.type}`, logCtx); break;
            default:
                logger.debug(`[PI] ${event.type}`, logCtx);
        }
    }

    async trace(input: TraceInput, ctx: DomainContext): Promise<PredictionTrace> {
        const existing = traceStore.get(input.predictionId);
        if (existing) return existing;

        const trace: PredictionTrace = {
            traceId: randomUUID(),
            predictionId: input.predictionId,
            startedAt: ctx.now,
            stages: input.stages ?? [],
            status: "running",
        };
        traceStore.set(input.predictionId, trace);
        return trace;
    }

    async query(input: ObservabilityQueryInput, ctx: DomainContext): Promise<ObservabilityQueryResult> {
        const filtered = eventBuffer.filter(e => {
            if (input.contextId && e.contextId !== input.contextId) return false;
            if (input.predictionId && e.predictionId !== input.predictionId) return false;
            if (input.type && e.type !== input.type) return false;
            if (input.from && e.timestamp < input.from) return false;
            if (input.to && e.timestamp > input.to) return false;
            return true;
        }).slice(-100);

        const traces = input.predictionId
            ? [traceStore.get(input.predictionId)].filter(Boolean) as PredictionTrace[]
            : [];

        return { events: filtered, traces, createdAt: ctx.now };
    }

    async reconstructState(input: StateReconstructionInput, ctx: DomainContext): Promise<StateReconstructionResult> {
        // MVP: reconstruct from buffered telemetry events
        const events = eventBuffer.filter(e => e.contextId === input.contextId && e.timestamp <= input.asOf);
        const branchEvents = events.filter(e => e.type.startsWith("branch_"));
        const predictionEvents = events.filter(e => e.type === "prediction_created" || e.type === "prediction_updated");
        const latestPrediction = predictionEvents[predictionEvents.length - 1];

        return {
            contextId: input.contextId,
            asOf: input.asOf,
            topPrediction: latestPrediction?.payload?.topPredicate as string | undefined,
            confidence: latestPrediction?.payload?.confidence as number | undefined,
            activeBranchCount: branchEvents.filter(e => e.payload?.status === "active").length,
            prunedBranchCount: branchEvents.filter(e => e.payload?.eventType === "pruned").length,
            explanation: `Reconstructed state at ${input.asOf}: ${events.length} events observed`,
        };
    }

    async alert(input: AlertInput, ctx: DomainContext): Promise<void> {
        logger.warn(`[ALERT] ${input.type}: ${input.reason}`, { type: input.type, severity: input.severity, contextId: input.contextId, reason: input.reason });
        await this.emit({
            type: `alert.${input.type}`,
            severity: input.severity,
            source: "runtime",
            contextId: input.contextId,
            payload: { reason: input.reason, ...input.payload },
        }, ctx);
    }

    async metrics(input: MetricsInput, ctx: DomainContext): Promise<MetricsResult> {
        const from = input.from ?? new Date(Date.parse(ctx.now) - 3_600_000).toISOString();
        const to = input.to ?? ctx.now;
        const relevant = eventBuffer.filter(e => e.timestamp >= from && e.timestamp <= to);
        const predEvents = relevant.filter(e => e.type === "prediction_created");
        const denyEvents = relevant.filter(e => e.type === "governance_denied");

        return {
            period: { from, to },
            predictionCount: predEvents.length,
            governanceDenyRate: predEvents.length > 0 ? denyEvents.length / predEvents.length : 0,
            activeContextCount: new Set(relevant.filter(e => e.contextId).map(e => e.contextId!)).size,
            createdAt: ctx.now,
        };
    }
}

export const observabilityPod = new ObservabilityPod();
export type { ObservabilityPod };
