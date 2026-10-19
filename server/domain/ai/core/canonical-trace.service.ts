import {
    type CanonicalTraceEvent,
    type EvidenceRef,
    canonicalTraceEventSchema,
} from "@shared/contracts/index.js";
import type { TraceContext } from "@domain/core/infrastructure/tracing/trace-context.service.js";
import { createChildSpan, createRootTrace } from "@domain/core/infrastructure/tracing/trace-context.service.js";
import { randomUUID } from "node:crypto";

export interface TraceEventInput {
    traceContext?: TraceContext;
    type: CanonicalTraceEvent["type"];
    status: CanonicalTraceEvent["status"];
    summary: string;
    actor?: string;
    payload?: unknown;
    evidence?: EvidenceRef[];
}

export class CanonicalTraceService {
    event(input: TraceEventInput): { traceContext: TraceContext; event: CanonicalTraceEvent } {
        const traceContext = input.traceContext
            ? createChildSpan(input.traceContext)
            : createRootTrace();

        const event = canonicalTraceEventSchema.parse({
            id: `trace_evt_${randomUUID()}`,
            traceId: traceContext.traceId,
            spanId: traceContext.spanId,
            parentSpanId: traceContext.parentSpanId,
            type: input.type,
            status: input.status,
            timestamp: new Date().toISOString(),
            actor: input.actor,
            summary: input.summary,
            payload: input.payload,
            evidence: input.evidence ?? [],
        });

        return { traceContext, event };
    }
}

export const canonicalTraceService = new CanonicalTraceService();

