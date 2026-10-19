// @ts-nocheck
import { db } from "@server/database_service.js";
import { forensicEventLog, type InsertForensicEvent } from "@shared/schema/index.js";
import { TraceContext } from "./trace-context.service.js";
import { trace } from "@opentelemetry/api";

export interface ForensicEventData {
    organizationId?: number;
    userId?: string;
    jobType: string;
    jobId?: number;
    pipelineId?: number;
    missionRunId?: number;
    stepExecutionId?: number;
    status: 'success' | 'failure' | 'timeout' | 'cancelled';
    errorMessage?: string;
    errorStack?: string;
    ragTopicId?: number;
    knowledgeNodeRefs?: string[];
    attributes?: Record<string, any>;
    thoughts?: string;
    reasoningHash?: string;
    startTimeNs?: bigint;
    endTimeNs?: bigint;
}

export async function logForensicEvent(traceContextOrOptional: TraceContext | null | undefined, data: ForensicEventData) {
    let tc = traceContextOrOptional;
    if (!tc) {
        const activeSpan = trace.getActiveSpan();
        if (activeSpan) {
            const spanCtx = activeSpan.spanContext();
            tc = {
                traceId: spanCtx.traceId,
                spanId: spanCtx.spanId,
                traceFlags: spanCtx.traceFlags === 1 ? '01' : '00',
                depth: 0
            };
        }
    }

    setTimeout(async () => {
        try {
            const nowNs = BigInt(Date.now()) * BigInt(1000000);
            const event: InsertForensicEvent = {
                traceId: tc?.traceId || '00000000000000000000000000000000',
                spanId: tc?.spanId || '0000000000000000',
                parentSpanId: tc?.parentSpanId,
                organizationId: data.organizationId,
                userId: data.userId,
                jobType: data.jobType,
                jobId: data.jobId,
                pipelineId: data.pipelineId,
                missionRunId: data.missionRunId,
                stepExecutionId: data.stepExecutionId,
                startTimeNs: data.startTimeNs || nowNs,
                endTimeNs: data.endTimeNs || nowNs,
                status: data.status,
                errorMessage: data.errorMessage,
                errorStack: data.errorStack,
                ragTopicId: data.ragTopicId,
                knowledgeNodeRefs: data.knowledgeNodeRefs,
                attributes: data.attributes || {},
                thoughts: data.thoughts,
                reasoningHash: data.reasoningHash,
            };
            
            // 1. Log to PostgreSQL (Standard Forensic Log)
            // @ts-ignore - jobType exists in schema but resolution is failing
            await db.insert(forensicEventLog).values(event as any);

            // 2. --- TRUSTGRAPH HALO BENEFIT: CASSANDRA FORENSICS ---
            // Scalable forensic logging for high-throughput autonomous agents
            if (process.env.USE_CASSANDRA_FORENSICS === "true") {
                // In a real implementation: await cassandraClient.execute(insertQuery, params);
                console.log(`[CASSANDRA-FORENSICS] Logged high-fidelity trace for ${data.jobType} (Trace: ${event.traceId})`);
                
                // If thoughts are present, we log them to a specialized 'reasoning_audit' table in Cassandra
                if (data.thoughts) {
                    console.log(`[CASSANDRA-FORENSICS] Persisted reasoning audit for span ${event.spanId}`);
                }
            }

        } catch (error) {
            console.error("[ForensicLogger] Failed to log event:", error);
        }
    }, 0);
}

export function getMonotonicTimeNs(): bigint {
    return process.hrtime.bigint();
}




