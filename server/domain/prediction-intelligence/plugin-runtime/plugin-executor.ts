import { randomUUID } from "crypto";
import { createLogger } from "@server/utils/logger.js";
import type {
    PredictionPlugin,
    PluginContext,
    PluginResult,
    PluginExecutionRequest,
    PluginExecutionResponse,
    PluginMetrics,
    PluginWarning,
    PluginError,
    PluginStatus,
    TraceContext,
    Provenance,
} from "./types.js";
import { pluginRegistry } from "./plugin-registry.js";
import { pluginPolicyGuard } from "./plugin-policy-guard.js";
import { pluginRunRecorder } from "./plugin-run-recorder.js";

const logger = createLogger("PluginExecutor");

// ============================================================================
// HELPERS
// ============================================================================

function childSpan(parent: TraceContext, pluginName: string): TraceContext {
    return {
        traceId: parent.traceId,
        spanId: randomUUID(),
        parentSpanId: parent.spanId,
        startedAt: new Date().toISOString(),
        attributes: { ...parent.attributes, "plugin.name": pluginName },
    };
}

function nowIso(): string { return new Date().toISOString(); }

function emptyMetrics(startedAt: string): PluginMetrics {
    const completedAt = nowIso();
    return {
        startedAt,
        completedAt,
        durationMs: Date.parse(completedAt) - Date.parse(startedAt),
        dbReads: 0, dbWrites: 0, vectorQueries: 0, cacheReads: 0, cacheWrites: 0, agentCalls: 0, outputSizeBytes: 0,
    };
}

function emptyProvenance(pluginName: string, pluginVersion: string, ctx: PluginContext): Provenance {
    return {
        source: "plugin-executor",
        method: "execution",
        pluginName,
        pluginVersion,
        evidenceIds: [],
        createdAt: ctx.now,
    };
}

function failedResult(
    pluginName: string,
    pluginVersion: string,
    status: PluginStatus,
    reason: string,
    ctx: PluginContext,
    startedAt: string
): PluginResult<never> {
    return {
        pluginName,
        pluginVersion,
        status,
        confidence: 0,
        evidenceIds: [],
        warnings: [],
        errors: [{ code: status.toUpperCase(), message: reason }],
        metrics: emptyMetrics(startedAt),
        provenance: emptyProvenance(pluginName, pluginVersion, ctx),
    };
}

// ---------------------------------------------------------------------------
// Timeout wrapper — resolves with sentinel on expiry, never rejects.
// ---------------------------------------------------------------------------

function withTimeout<T>(
    promise: Promise<T>,
    ms: number,
    pluginName: string
): Promise<{ value: T; timedOut: false } | { value: null; timedOut: true }> {
    return new Promise(resolve => {
        const t = setTimeout(() => {
            logger.warn(`[Executor] '${pluginName}' timed out after ${ms}ms`);
            resolve({ value: null, timedOut: true });
        }, ms);

        promise
            .then(v => { clearTimeout(t); resolve({ value: v, timedOut: false }); })
            .catch(err => {
                clearTimeout(t);
                logger.error(`[Executor] '${pluginName}' threw: ${err?.message ?? err}`);
                resolve({ value: null as any, timedOut: false });
            });
    });
}

// ============================================================================
// PLUGIN EXECUTOR — Spec §18 (full execution lifecycle)
// ============================================================================

export const pluginExecutor = {

    // -------------------------------------------------------------------------
    // Single plugin execution
    // -------------------------------------------------------------------------

    async executeSingle<TInput, TOutput>(
        plugin: PredictionPlugin<TInput, TOutput>,
        input: TInput,
        ctx: PluginContext,
        shadowMode: boolean,
        timeoutOverrideMs?: number
    ): Promise<PluginResult<TOutput>> {
        const manifest = plugin.manifest;
        const startedAt = nowIso();
        const childCtx: PluginContext = { ...ctx, trace: childSpan(ctx.trace, manifest.name) };
        const timeoutMs = timeoutOverrideMs ?? manifest.execution.timeoutMs;

        // Step 7: Policy guard check
        const policy = pluginPolicyGuard.evaluate(manifest, ctx);
        if (!policy.allowed) {
            const r = failedResult(manifest.name, manifest.version, "policy_denied", policy.reason, ctx, startedAt);
            pluginRunRecorder.record(r, ctx, manifest.pod, manifest.subPod, manifest.capability, input, shadowMode);
            pluginRegistry.recordError(manifest.name, `policy_denied: ${policy.reason}`, Date.parse(nowIso()) - Date.parse(startedAt));
            logger.warn(`[Executor] '${manifest.name}' policy denied: ${policy.reason}`);
            return r;
        }

        // Step 8: canHandle
        let decision;
        try {
            decision = await plugin.canHandle(input, childCtx);
        } catch (err: any) {
            decision = { shouldRun: false, reason: err?.message ?? "canHandle threw", priority: 0, estimatedCost: { latencyMs: 0, dbReads: 0, vectorQueries: 0, agentCalls: 0 } };
        }

        if (!decision.shouldRun) {
            logger.debug(`[Executor] '${manifest.name}' skipped: ${decision.reason}`);
            const r: PluginResult<TOutput> = {
                pluginName: manifest.name, pluginVersion: manifest.version,
                status: "skipped", confidence: 0, evidenceIds: [],
                warnings: [], errors: [],
                metrics: emptyMetrics(startedAt),
                provenance: emptyProvenance(manifest.name, manifest.version, ctx),
                shadowMode,
            };
            pluginRunRecorder.record(r, ctx, manifest.pod, manifest.subPod, manifest.capability, input, shadowMode);
            return r;
        }

        // Step 10: Execute with timeout + retry
        const maxAttempts = manifest.execution.retryable ? manifest.execution.maxRetries + 1 : 1;
        let lastResult: PluginResult<TOutput> | null = null;
        let timedOut = false;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            const wrapped = await withTimeout(plugin.execute(input, childCtx), timeoutMs, manifest.name);

            if (wrapped.timedOut) { timedOut = true; break; }
            lastResult = wrapped.value;
            if (lastResult && lastResult.status !== "failed") break;

            if (attempt < maxAttempts) {
                logger.warn(`[Executor] '${manifest.name}' attempt ${attempt} failed — retrying in ${50 * attempt}ms`);
                await new Promise(r => setTimeout(r, 50 * attempt));
            }
        }

        const durationMs = Date.parse(nowIso()) - Date.parse(startedAt);

        // Step 10: Timeout case
        if (timedOut || !lastResult) {
            pluginRegistry.recordError(manifest.name, "timeout", durationMs, true);
            const r = failedResult(manifest.name, manifest.version, "timeout", `Exceeded ${timeoutMs}ms`, ctx, startedAt);
            pluginRunRecorder.record(r, ctx, manifest.pod, manifest.subPod, manifest.capability, input, shadowMode);
            return r;
        }

        // Step 11: Basic output validation — warn if declared output type not present
        const warnings: PluginWarning[] = [...lastResult.warnings];
        if (lastResult.status === "success" && lastResult.output === undefined) {
            warnings.push({ code: "EMPTY_OUTPUT", message: "Plugin returned success with no output", severity: "warn" });
        }
        if (manifest.rollout.status === "deprecated") {
            warnings.push({ code: "DEPRECATED_PLUGIN", message: `Plugin '${manifest.name}' is deprecated`, severity: "warn" });
        }

        // Shadow mode: mark result
        const finalResult: PluginResult<TOutput> = {
            ...lastResult,
            warnings,
            shadowMode: shadowMode || manifest.rollout.shadowMode === true,
            metrics: { ...lastResult.metrics, durationMs },
        };

        // Step 12: Telemetry
        if (finalResult.status === "failed") {
            pluginRegistry.recordError(manifest.name, finalResult.errors[0]?.message ?? "unknown", durationMs);
        } else {
            pluginRegistry.recordSuccess(manifest.name, durationMs);
        }

        // Step 13: Persist run record
        pluginRunRecorder.record(finalResult, ctx, manifest.pod, manifest.subPod, manifest.capability, input, shadowMode);

        logger.debug(`[Executor] '${manifest.name}' → ${finalResult.status} in ${durationMs.toFixed(1)}ms`);
        return finalResult;
    },

    // -------------------------------------------------------------------------
    // Capability-routing execute (spec §20-§21)
    // Resolves eligible plugins, runs them, returns PluginExecutionResponse.
    // -------------------------------------------------------------------------

    async execute<TInput, TOutput>(
        request: PluginExecutionRequest<TInput>,
        ctx: PluginContext
    ): Promise<PluginExecutionResponse<TOutput>> {
        const startMs = performance.now();
        const requestId = ctx.requestId;

        // Step 2-3: Resolve eligible plugins for this request
        const candidates = pluginRegistry.list({
            pod: request.pod,
            subPod: request.subPod,
            capability: request.capability,
            enabled: true,
        });

        const results: PluginResult<TOutput>[] = [];
        const skipped: { pluginName: string; reason: string }[] = [];
        const failed: { pluginName: string; reason: string }[] = [];

        // Step 5: Filter for input type + mode eligibility (spec §19)
        const eligible = candidates.filter(entry => {
            const check = pluginPolicyGuard.isEligible(entry.manifest, request.inputType, request.mode);
            if (!check.eligible) skipped.push({ pluginName: entry.manifest.name, reason: check.reason });
            return check.eligible;
        });

        // Step 9: Sort by priority (active first, then by traffic %)
        const sorted = eligible.sort((a, b) => {
            if (a.manifest.rollout.status !== b.manifest.rollout.status) {
                const order = ["active", "canary", "development", "deprecated"];
                return order.indexOf(a.manifest.rollout.status) - order.indexOf(b.manifest.rollout.status);
            }
            return b.manifest.rollout.trafficPercent - a.manifest.rollout.trafficPercent;
        });

        const toRun = request.maxPlugins ? sorted.slice(0, request.maxPlugins) : sorted;
        const shadowMode = request.shadowMode ?? false;

        let totalDbReads = 0;
        let totalVectorQueries = 0;
        let totalAgentCalls = 0;

        for (const entry of toRun) {
            const result = await this.executeSingle<TInput, TOutput>(
                entry.plugin as PredictionPlugin<TInput, TOutput>,
                request.input,
                { ...ctx, mode: request.mode },
                shadowMode,
                request.timeoutOverrideMs
            );

            if (result.status === "failed" || result.status === "timeout" || result.status === "policy_denied") {
                failed.push({ pluginName: entry.manifest.name, reason: result.errors[0]?.message ?? result.status });
                if (request.required) {
                    // Required plugin failed — break pipeline
                    logger.error(`[Executor] Required plugin '${entry.manifest.name}' failed`);
                    break;
                }
            } else {
                results.push(result);
            }

            totalDbReads += result.metrics.dbReads;
            totalVectorQueries += result.metrics.vectorQueries;
            totalAgentCalls += result.metrics.agentCalls;
        }

        const totalDurationMs = performance.now() - startMs;

        return {
            requestId,
            selectedPlugins: toRun.map(e => e.manifest.name),
            results,
            skipped,
            failed,
            metrics: {
                totalDurationMs,
                totalDbReads,
                totalVectorQueries,
                totalAgentCalls,
            },
        };
    },

    // -------------------------------------------------------------------------
    // Sequential pipeline (named plugins in order)
    // -------------------------------------------------------------------------

    async pipeline<TInput, TOutput>(
        pluginNames: string[],
        input: TInput,
        ctx: PluginContext,
        options?: { continueOnFailure?: boolean; shadowMode?: boolean; timeoutMs?: number }
    ): Promise<PluginResult<TOutput>[]> {
        const results: PluginResult<TOutput>[] = [];

        for (const name of pluginNames) {
            const entry = pluginRegistry.get(name);
            if (!entry) {
                results.push(failedResult(name, "unknown", "failed", `Plugin '${name}' not found`, ctx, nowIso()));
                if (!options?.continueOnFailure) break;
                continue;
            }

            const res = await this.executeSingle<TInput, TOutput>(
                entry.plugin as PredictionPlugin<TInput, TOutput>,
                input,
                ctx,
                options?.shadowMode ?? false,
                options?.timeoutMs
            );
            results.push(res);

            if (res.status === "failed" && !options?.continueOnFailure) {
                logger.warn(`[Executor] Pipeline stopped at '${name}'`);
                break;
            }
        }

        return results;
    },

    // -------------------------------------------------------------------------
    // Concurrent fan-out (all plugins in parallel)
    // -------------------------------------------------------------------------

    async fanOut<TInput, TOutput>(
        pluginNames: string[],
        input: TInput,
        ctx: PluginContext,
        options?: { shadowMode?: boolean; timeoutMs?: number }
    ): Promise<PluginResult<TOutput>[]> {
        return Promise.all(
            pluginNames.map(name => {
                const entry = pluginRegistry.get(name);
                if (!entry) {
                    return Promise.resolve(failedResult(name, "unknown", "failed", `Plugin '${name}' not found`, ctx, nowIso()) as PluginResult<TOutput>);
                }
                return this.executeSingle<TInput, TOutput>(
                    entry.plugin as PredictionPlugin<TInput, TOutput>,
                    input,
                    ctx,
                    options?.shadowMode ?? false,
                    options?.timeoutMs
                );
            })
        );
    },
};
