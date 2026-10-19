// @ts-nocheck
import { db } from "@server/database_service.js";
import { forensicEventLog, type InsertForensicEvent } from "@shared/schema/index.js";
import { TraceContext } from "@domain/core/infrastructure/tracing/trace-context.service.js";
import { trace as otelTrace, context as otelContext, TraceFlags } from "@opentelemetry/api";

export interface ForensicEventData {
    // Identity
    organizationId?: number;
    userId?: string;
    jobType: string;
    jobId?: number;
    missionId?: number;
    missionRunId?: number;
    pipelineId?: number;
    stepExecutionId?: number;

    // Execution Details
    status: 'success' | 'failure' | 'timeout' | 'cancelled';
    errorMessage?: string;
    errorStack?: string;

    // Context
    ragTopicId?: number;
    knowledgeNodeRefs?: string[];
    spatialLocation?: { h3Index?: string; lat?: number; lng?: number; accuracy?: number };
    attributes?: Record<string, any>;

    // Timing override (optional)
    startTimeNs?: bigint;
    endTimeNs?: bigint;
}

/**
 * Log a forensic event for distributed tracing and observability.
 * This function should be non-blocking (fire and forget) to avoid impacting critical path performance.
 */
export async function logForensicEvent(traceContext: TraceContext, data: ForensicEventData) {
    // Do not await this, let it run in background
    setTimeout(async () => {
        try {
            const nowNs = BigInt(Date.now()) * BigInt(1000000); // Approximation of nanoseconds

            const event: InsertForensicEvent = {
                // Trace Context
                traceId: traceContext.traceId,
                spanId: traceContext.spanId,
                parentSpanId: traceContext.parentSpanId,

                // Identity
                missionRunId: data.missionRunId,
                organizationId: data.organizationId,
                userId: data.userId,
                jobType: data.jobType,
                jobId: data.jobId,
                pipelineId: data.pipelineId,
                stepExecutionId: data.stepExecutionId,

                // Telemetry
                startTimeNs: data.startTimeNs || nowNs, 
                endTimeNs: data.endTimeNs || nowNs,

                status: data.status,
                errorMessage: data.errorMessage,
                errorStack: data.errorStack,

                // Context
                ragTopicId: data.ragTopicId,
                knowledgeNodeRefs: data.knowledgeNodeRefs,
                attributes: {
                    ...(data.attributes || {}),
                    missionId: data.missionId,
                    ...(data.spatialLocation ? {
                        "geo.h3_index": data.spatialLocation.h3Index,
                        "geo.lat": data.spatialLocation.lat,
                        "geo.lng": data.spatialLocation.lng,
                        "geo.accuracy": data.spatialLocation.accuracy,
                    } : {})
                },
            };

            // @ts-ignore - jobType exists in schema but resolution is failing
            await db.insert(forensicEventLog).values(event as any);

            // Export to OpenTelemetry
            try {
                const tracer = otelTrace.getTracer("hermes-forensic-tracing");
                const spanContext = {
                    traceId: traceContext.traceId,
                    spanId: traceContext.spanId,
                    traceFlags: traceContext.traceFlags === "01" ? TraceFlags.SAMPLED : TraceFlags.NONE,
                };
                
                // Set the span context in the parent context
                const parentContext = otelTrace.setSpanContext(otelContext.active(), spanContext);
                
                const startTimeMs = data.startTimeNs 
                    ? Number(data.startTimeNs / BigInt(1000000)) 
                    : Date.now();
                
                const span = tracer.startSpan(data.jobType, {
                    startTime: startTimeMs,
                    attributes: {
                        "job.type": data.jobType,
                        "job.id": data.jobId,
                        "mission.run.id": data.missionRunId,
                        "organization.id": data.organizationId,
                        "user.id": data.userId,
                        "pipeline.id": data.pipelineId,
                        "step.execution.id": data.stepExecutionId,
                        "rag.topic.id": data.ragTopicId,
                        ...(data.attributes || {})
                    }
                }, parentContext);
                
                if (data.status === "failure") {
                    span.setStatus({
                        code: 2, // SpanStatusCode.ERROR
                        message: data.errorMessage || "Unknown error"
                    });
                    if (data.errorMessage) {
                        span.recordException(new Error(data.errorMessage));
                    }
                } else {
                    span.setStatus({
                        code: 1 // SpanStatusCode.OK
                    });
                }
                
                const endTimeMs = data.endTimeNs 
                    ? Number(data.endTimeNs / BigInt(1000000)) 
                    : Date.now();
                span.end(endTimeMs);
            } catch (otelErr) {
                console.error("[ForensicLogger] OpenTelemetry export failed:", otelErr);
            }

        } catch (error) {
            console.error("[ForensicLogger] Failed to log event:", error);
            // Fail silently to not disrupt the application
        }
    }, 0);
}

/**
 * Helper to record start time in nanoseconds (Process HR Time)
 */
export function getMonotonicTimeNs(): bigint {
    return process.hrtime.bigint();
}




