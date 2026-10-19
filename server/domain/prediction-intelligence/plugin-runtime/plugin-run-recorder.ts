import { randomUUID } from "crypto";
import { db } from "@server/database_service.js";
import { pluginRuns } from "@shared/schema/prediction/plugin-runtime.js";
import { createLogger } from "@server/utils/logger.js";
import type { PluginResult, PluginMetrics, PluginContext } from "./types.js";

const logger = createLogger("PluginRunRecorder");
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

// ============================================================================
// PLUGIN RUN RECORDER
// Persists every plugin execution to plugin_runs table (spec §23).
// Designed to be non-blocking — failures here never kill the pipeline.
// ============================================================================

export interface PluginRunRecord {
    id: string;
    requestId: string;
    correlationId: string;
    contextId?: string;
    pluginName: string;
    pluginVersion: string;
    pod: string;
    subPod: string;
    capability: string;
    mode: string;
    status: string;
    confidence?: number;
    startedAt: Date;
    completedAt?: Date;
    durationMs?: number;
    metrics: PluginMetrics;
    inputSummary: Record<string, unknown>;
    outputSummary: Record<string, unknown>;
    warnings: unknown[];
    errors: unknown[];
    shadowMode: boolean;
}

function safeInputSummary(input: unknown): Record<string, unknown> {
    try {
        if (!input || typeof input !== "object") return { type: typeof input };
        const obj = input as Record<string, unknown>;
        // Strip large payloads; keep ID and type fields for traceability
        return {
            id: obj.id ?? obj.contextId ?? undefined,
            type: obj.type ?? undefined,
            action: obj.action ?? undefined,
        };
    } catch {
        return {};
    }
}

function safeOutputSummary(output: unknown): Record<string, unknown> {
    try {
        if (!output) return {};
        if (Array.isArray(output)) return { count: output.length };
        const obj = output as Record<string, unknown>;
        return {
            id: obj.id ?? undefined,
            status: obj.status ?? undefined,
            confidence: obj.confidence ?? undefined,
        };
    } catch {
        return {};
    }
}

function uuidForStorage(value: string | undefined): string {
    return value && UUID_PATTERN.test(value) ? value : randomUUID();
}

function optionalUuidForStorage(value: string | undefined): string | undefined {
    return value && UUID_PATTERN.test(value) ? value : undefined;
}

export const pluginRunRecorder = {
    /**
     * Record a completed plugin result. Fire-and-forget — does not await.
     */
    record<TOutput>(
        result: PluginResult<TOutput>,
        ctx: PluginContext,
        pod: string,
        subPod: string,
        capability: string,
        input: unknown,
        shadowMode: boolean
    ): void {
        const run: PluginRunRecord = {
            id: randomUUID(),
            requestId: uuidForStorage(ctx.requestId),
            correlationId: uuidForStorage(ctx.correlationId),
            contextId: optionalUuidForStorage(ctx.contextId),
            pluginName: result.pluginName,
            pluginVersion: result.pluginVersion,
            pod,
            subPod,
            capability,
            mode: ctx.mode,
            status: result.status,
            confidence: result.confidence,
            startedAt: new Date(result.metrics.startedAt),
            completedAt: new Date(result.metrics.completedAt),
            durationMs: Math.round(result.metrics.durationMs),
            metrics: result.metrics,
            inputSummary: safeInputSummary(input),
            outputSummary: safeOutputSummary(result.output),
            warnings: result.warnings,
            errors: result.errors,
            shadowMode,
        };

        if (process.env.NODE_ENV === "test") return;

        // Fire-and-forget — we don't want persistence latency on the hot path
        db.insert(pluginRuns).values({
            id: run.id,
            requestId: run.requestId,
            correlationId: run.correlationId,
            contextId: run.contextId,
            pluginName: run.pluginName,
            pluginVersion: run.pluginVersion,
            pod: run.pod,
            subPod: run.subPod,
            capability: run.capability,
            mode: run.mode,
            status: run.status,
            confidence: run.confidence,
            startedAt: run.startedAt,
            completedAt: run.completedAt,
            durationMs: run.durationMs,
            metrics: run.metrics as any,
            inputSummary: run.inputSummary as any,
            outputSummary: run.outputSummary as any,
            warnings: run.warnings as any,
            errors: run.errors as any,
            shadowMode: run.shadowMode,
        }).catch(err => {
            logger.warn(`[RunRecorder] Failed to persist plugin run: ${err?.message}`);
        });
    },
};
