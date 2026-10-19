import { datasetService } from "@domain/knowledge/index.js";
import { getSystemOrgContext } from "@server/utils/auth-context.js";
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { AIClientFactory } from "@domain/ai/core/ai-client.service.js";
import { ragAssets, apiSpecs, credentials, orgSpecAccess, hilForms } from "@shared/schema/index.js";
import type {
    AIProviderMetadata, AIApiCallConfig, ApiConfig, CurlConfig, JiraMetadata,
    RagAsset, PipelineStep, Pipeline, RepeaterConfig, TransformerConfig,
    OpenAPIJobConfig, AirflowDagRunConfig, AirflowMetadata, HumanApprovalConfig,
    SlackPostConfig, EmailSendConfig, SqlQueryConfig, DatabaseMetadata, SmtpMetadata, AIAgentConfig,
    DecisionConfig, IteratorConfig, Job, JobConfig, ShellConfig, JobDiffConfig,
    FolderImportConfig, FileExportConfig, PythonConfig, SeleniumConfig, RetryConfig
} from "@shared/schema/index.js";
import {
    resolveJobConfig,
    type VariableContext,
    VariableResolverError
} from "./variable-resolver.js";
import { createChildSpan, type TraceContext } from "@domain/core/infrastructure/tracing/trace-context.service.js";
import { logForensicEvent, getMonotonicTimeNs } from "@domain/core/infrastructure/tracing/trace-logger.service.js";
import { checkDoomsdayProtocol } from "@domain/core/infrastructure/doomsday-clock.service.js";
import { db } from "@server/database_service.js";
import { eq, and, desc } from "drizzle-orm";
import { computeDiff, type DiffResult } from "@domain/core/infrastructure/diff-service.js";
import { emitDiffEvent } from "@domain/core/infrastructure/event-bus.service.js";
import { snapshots, pipelineStepExecutions } from "@shared/schema/index.js";
import { flattenForDataset, type SchemaMapping } from "@domain/knowledge/core/flattening-service.js";
import {
    JobNotFoundError,
    ConfigurationError,
    AppError
} from "../utils/errors.js";
import { jobExecutorRegistry } from "@domain/jobs/core/executors/index.js";

export interface StepExecutionResult {
    success: boolean;
    output: string;
    status: string;
    error?: string;
    externalId?: string;
    diff?: DiffResult; // Reactive Intelligence: Diff from previous run
    // Distributed Tracing
    spanId?: string;
    traceId?: string;
    telemetry?: Record<string, any>; // Forensic attributes
}



const tracer = trace.getTracer('pipeline-executor');

async function publishCycleStepTransition(
    eventType: "cycle.step_started" | "cycle.step_completed" | "cycle.step_failed",
    payload: {
        cycleId: number;
        stepId?: number;
        stepCode: string;
        stepOrder?: number;
        jobId?: number | null;
        agentId?: string | null;
        status?: string;
        error?: string;
        durationMs?: number;
        organizationId?: number | null;
    }
) {
    try {
        const { eventStream } = await import("@domain/core/infrastructure/event-stream.service.js");
        await eventStream.publish(
            eventType,
            {
                cycleId: payload.cycleId,
                stepId: payload.stepId,
                stepCode: payload.stepCode,
                stepOrder: payload.stepOrder,
                jobId: payload.jobId,
                agentId: payload.agentId,
                status: payload.status,
                error: payload.error,
                durationMs: payload.durationMs,
            },
            {
                organizationId: payload.organizationId ?? undefined,
                subject: `cycle:${payload.cycleId}`,
            },
            "cycle-runner"
        );
    } catch (e) {
        console.error("[EventLogging] Failed to publish cycle step transition:", e);
    }
}

export async function executePipelineStep(
    step: PipelineStep,
    pipeline: Pipeline,
    context: VariableContext & { data?: Record<string, any>; traceContext?: TraceContext },
    isFirstStep: boolean,
    pipelineExecutionId?: number,
    stepExecutionId?: number,
    jobMap?: Map<number, Job>
): Promise<StepExecutionResult> {
    return tracer.startActiveSpan('step.execute', {
        attributes: {
            'step.id': step.id,
            'job.id': step.jobId || undefined,
            'pipeline.id': pipeline.id,
        },
    }, async (span) => {
        const startTime = Date.now();
        try {
            const result = await executePipelineStepInternal(step, pipeline, context, isFirstStep, pipelineExecutionId, stepExecutionId, jobMap);
            span.setAttribute('execution_time_ms', Date.now() - startTime);
            span.setAttribute('success', result.success);
            span.setStatus({ code: SpanStatusCode.OK });
            return result;
        } catch (error: any) {
            span.setAttribute('execution_time_ms', Date.now() - startTime);
            span.setAttribute('success', false);
            span.recordException(error);
            span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
            throw error;
        } finally {
            span.end();
        }
    });
}

export async function executePipelineStepInternal(
    step: PipelineStep,
    pipeline: Pipeline,
    context: VariableContext & { data?: Record<string, any>; traceContext?: TraceContext },
    isFirstStep: boolean,
    pipelineExecutionId?: number,
    stepExecutionId?: number,
    jobMap?: Map<number, Job>
): Promise<StepExecutionResult> {
    // --- Event Logging: STEP_STARTED ---
    if (pipelineExecutionId) {
        try {
            const { cycleRunEvents } = await import("@shared/schema/cycle-run-events.js");
            const stepCode = step.outputName || `Step ${step.order}`;
            await db.insert(cycleRunEvents).values({
                runId: pipelineExecutionId,
                stepCode,
                eventType: "STEP_STARTED",
                inputs: context.data,
                jobId: step.jobId,
            });
            await publishCycleStepTransition("cycle.step_started", {
                cycleId: pipelineExecutionId,
                stepId: step.id,
                stepCode,
                stepOrder: step.order,
                jobId: step.jobId,
                status: "started",
                organizationId: pipeline.organizationId,
            });
        } catch (e) {
            console.error("[EventLogging] Failed to log STEP_STARTED event:", e);
        }
    }

    console.log(`[StepRunner] Starting step ${step.id} (Order: ${step.order}, Job: ${step.jobId})`);
    const orgContext = getSystemOrgContext(pipeline.organizationId);
    // Check condition before executing
    // Priority: conditionExpression > runOnCondition
    if (step.conditionExpression && step.conditionExpression.trim()) {
        // Use custom expression evaluator
        try {
            const { evaluateCondition } = await import("./expression-evaluator.js");
            const shouldRun = evaluateCondition(step.conditionExpression, context);
            if (!shouldRun) {
                return { success: false, output: "", status: "skipped", error: `Condition expression evaluated to false: ${step.conditionExpression}` };
            }
        } catch (error) {
            return {
                success: false,
                output: "",
                status: "skipped",
                error: `Condition expression evaluation failed: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }

    // Wait if waitDurationSeconds is set
    const waitSeconds = step.waitDurationSeconds;
    if (waitSeconds !== null && waitSeconds !== undefined && waitSeconds > 0) {
        await new Promise(resolve => setTimeout(resolve, waitSeconds * 1000));
    }


    // CHECK FOR DIRECT TOOL EXECUTION (Durable Execution)
    if (step.moduleType === "tool" && step.toolName) {
        console.log(`[PipelineStepRunner] Executing Tool Step: ${step.toolName}`);
        try {
            // Lazy load tools to avoid circular deps
            const { AGENT_TOOLS } = await import("@domain/tools/v1/tool-registry.service.js");
            const { mcpClientService } = await import("@domain/integrations/core/mcp-client.service.js");

            const allTools = [
                ...Object.values(AGENT_TOOLS),
                ...mcpClientService.getAllTools()
            ];

            let tool: any = allTools.find(t => t.name === step.toolName);
            if (!tool) {
                const executor = jobExecutorRegistry.getExecutor(step.toolName);
                if (executor) {
                    tool = {
                        name: step.toolName,
                        execute: async (args: any, context: any) => {
                            const mockJob = {
                                id: 0,
                                type: step.toolName,
                                config: args,
                                organizationId: pipeline.organizationId,
                                name: step.toolName
                            };
                            const executorResult = await executor.execute(
                                mockJob as any,
                                args,
                                pipeline,
                                context
                            );
                            if (executorResult.success) {
                                return executorResult.output;
                            } else {
                                throw new Error(executorResult.error || "Executor failed");
                            }
                        }
                    };
                }
            }
            if (!tool) throw new Error(`Tool '${step.toolName}' not found.`);

            // Resolve {{variable}} references in all string leaves of toolArguments
            const { resolveVariables } = await import("./variable-resolver.js");
            const deepResolveArgs = (obj: any): any => {
                if (typeof obj === "string") {
                    try { return resolveVariables(obj, context); } catch { return obj; }
                }
                if (Array.isArray(obj)) return obj.map(deepResolveArgs);
                if (obj !== null && typeof obj === "object") {
                    return Object.fromEntries(
                        Object.entries(obj).map(([k, v]) => [k, deepResolveArgs(v)])
                    );
                }
                return obj;
            };
            let args = deepResolveArgs(step.toolArguments || {});
            if (step.toolName === "amortize_sim") {
                args = {
                    ...args,
                    ...(context.data?.context || {}),
                    ...(context.data || {})
                };
            }

            const output = await tool.execute(args, context);

            // Check for Sleep/Suspension special return
            if (output && typeof output === 'object' && (output as any)._status === 'waiting_async') {
                return {
                    success: true,
                    output: JSON.stringify(output), // Store full state
                    status: "waiting_async",
                    sleepUntil: (output as any).sleepUntil,
                    suspensionMetadata: (output as any).suspensionMetadata
                } as any;
            }

            // NEW: Check for input_request or mode_switch_request in tool output (handles both JSON strings and objects)
            let hilRequest: any = null;
            if (typeof output === 'string') {
                try {
                    hilRequest = JSON.parse(output);
                } catch { /* ignored */ }
            } else if (output && typeof output === 'object') {
                hilRequest = output;
            }

            if (hilRequest && (hilRequest.type === 'input_request' || hilRequest.type === 'mode_switch_request' || hilRequest.result?.type === 'mode_switch_request')) {
                const actualRequest = hilRequest.result?.type ? hilRequest.result : hilRequest;
                console.log(`[PipelineStepRunner] Tool '${step.toolName}' requested HIL: ${actualRequest.type}`);
                return {
                    success: true,
                    output: typeof output === 'string' ? output : JSON.stringify(output),
                    status: "waiting_external_input",
                    suspensionMetadata: {
                        waitReason: "external_interaction",
                        ...actualRequest
                    }
                } as any;
            }

            return {
                success: true,
                output: typeof output === 'string' ? output : JSON.stringify(output),
                status: "success"
            };

        } catch (toolError) {
            return {
                success: false,
                output: "",
                status: "failure",
                error: toolError instanceof Error ? toolError.message : String(toolError)
            };
        }
    }

    // CHECK FOR FORGE STEP (JIT Infrastructure)
    if (step.moduleType === "forge") {
        console.log(`[PipelineStepRunner] Executing FORGE Step for blueprint: ${(step as any).blueprint || "chat-assistant"}`);
        try {
            const { appBuilderService } = await import("../domain/apps/app-builder.service.js");
            
            // Resolve variables in forge config
            const { resolveVariables } = await import("./variable-resolver.js");
            const resolveField = (val: string | undefined) => val ? resolveVariables(val, context) : "";

            const forgeConfig = (step as any).forgeConfig || {};
            const name = resolveField(forgeConfig.name || "JIT Asset");
            const slug = resolveField(forgeConfig.slug || `jit-${Date.now()}`);
            const description = resolveField(forgeConfig.description || "Forged via Pipeline");
            const blueprint = resolveField(forgeConfig.blueprint || "chat-assistant");

            const forgeResult = await appBuilderService.initiateBackgroundForge({
                slug,
                name,
                description,
                blueprint,
                organizationId: pipeline.organizationId ?? undefined,
                missionRunId: (context as any).missionRunId
            });

            if (forgeResult.success) {
                return {
                    success: true,
                    output: JSON.stringify({
                        message: "Forge initiated successfully.",
                        jobId: forgeResult.jobId,
                        slug: slug
                    }),
                    status: "success"
                };
            } else {
                throw new Error("Forge initiation failed.");
            }

        } catch (err: any) {
            return {
                success: false,
                output: "",
                status: "failure",
                error: `Forge failed: ${err.message}`
            };
        }
    }

    try {
        // Get job for this step
        if (!step.jobId) {
            throw new ConfigurationError(`Step ${step.id} (order ${step.order}) has no associated Job ID`);
        }
        // Efficiently resolve the job from jobMap or fetch if missing (Execution Offloading)
        let job: Job | undefined;
        if (jobMap && step.jobId) {
            job = jobMap.get(step.jobId);
        }

        if (!job && step.jobId) {
            console.log(`[StepRunner] Fetching job ${step.jobId}...`);
            const { jobService } = await import("@domain/jobs/job.service.js");
            job = await jobService.getById(step.jobId, orgContext);
            console.log(`[StepRunner] Job fetched: ${job?.type}`);
        }

        if (!job) {
            throw new Error(`Job ${step.jobId} not found for step ${step.id}`);
        }

        // Optimized Path: In-Memory Transformation (Execution Offloading)
        // Bypasses registry and avoids one async hop for high-volume efficiency
        const transformerRules = (step as any).transformerConfig?.rules || (job.config as any)?.rules;
        if (job.type === "transformer" && transformerRules) {
            try {
                const { TransformationEngine } = await import("@domain/pipeline/core/transformation-engine.service.js");
                const engine = new TransformationEngine();
                const config = (step as any).transformerConfig || job.config;
                const inputData = context.data?.input || (context.currentStepOrder !== undefined ? context.positional[context.currentStepOrder - 1] : undefined);
                
                console.log(`[Step Runner] Running optimized transformer for step ${step.id}. Rules: ${transformerRules.length}, Input: ${typeof inputData}`);
                const res = await engine.executeTransformations(inputData, config, context as any);

                return {
                    success: true,
                    output: typeof res === 'string' ? res : JSON.stringify(res, null, 2),
                    status: "completed"
                };
            } catch (err: any) {
                console.error("[Offloading] Transformer in-process execution failed:", err);
                // Fallback to standard execution if direct path fails
            }
        }

        // Create Child Span for this step
        let stepTraceContext: TraceContext | undefined;
        if (context.traceContext) {
            stepTraceContext = createChildSpan(context.traceContext);

            // Doomsday Safety Check
            const safety = await checkDoomsdayProtocol(stepTraceContext);
            if (!safety.safe) {
                // Determine if we should fail or just log? 
                // The protocol implies we should Stop.
                // We fake a result here to return failure.
                // But we must also log the forensic event for the blockage.
                const endTimeNs = getMonotonicTimeNs();
                logForensicEvent(stepTraceContext, {
                    organizationId: pipeline.organizationId ?? undefined,
                    jobType: job.type,
                    jobId: job.id,
                    pipelineId: pipeline.id,
                    status: 'cancelled',
                    startTimeNs: getMonotonicTimeNs(),
                    endTimeNs,
                    errorMessage: `Doomsday Protocol Triggered: ${safety.reason}`,
                    attributes: {
                        blockage_reason: safety.reason
                    }
                });

                return {
                    success: false,
                    output: "",
                    status: "cancelled",
                    error: `Doomsday Protocol Blockage: ${safety.reason}`
                };
            }
        }
        const startTimeNs = getMonotonicTimeNs();
        let result: StepExecutionResult = { success: false, output: "", status: "failure", error: "Not Executed" };
        let attempts = 0;

        {
            // Profiling Setup (Sample 10% of jobs)
            const shouldProfile = Math.random() < 0.1;
            let profilingService: any = null;
            if (shouldProfile) {
                try {
                    const mod = await import("@domain/jobs/core/profiling.service.js");
                    profilingService = new mod.ProfilingService();
                } catch (err) {
                    console.warn("[PipelineStepRunner] Failed to load profiling service", err);
                }
            }

            // Retry Logic Setup
            const retryConfig = (step.retryConfig || {}) as RetryConfig;
            const enableRetries = !!step.retryConfig;
            const maxRetries = enableRetries ? (retryConfig.maxRetries ?? 3) : 0;
            const allowedAttempts = 1 + maxRetries;

            if (shouldProfile && profilingService) {
                await profilingService.startProfiling(job.id);
            }

            try {
                while (attempts < allowedAttempts) {
                    attempts++;
                    const stepContext = { ...context, traceContext: stepTraceContext };
                    try {
                        result = await resolveAndExecuteJob(job, pipeline, stepContext, step.order, pipelineExecutionId, stepExecutionId, jobMap);
                    } catch (err: any) {
                        result = {
                            success: false,
                            output: "",
                            status: "failure",
                            error: err instanceof Error ? err.message : String(err)
                        };
                    }
                    if (result.success) break;
                    if (attempts < allowedAttempts) {
                        if (result.status === 'cancelled') break;
                        const baseMs = retryConfig.backoffMs ?? 5000;
                        const multiplier = retryConfig.backoffMultiplier ?? 2;
                        const backoffMs = Math.min(baseMs * Math.pow(multiplier, attempts - 1), 300000);
                        console.log(`[PipelineStepRunner] Step ${step.id} (Job ${job.id}) failed. Retrying in ${backoffMs}ms (Attempt ${attempts}/${allowedAttempts}). Error: ${result.error}`);
                        await new Promise(resolve => setTimeout(resolve, backoffMs));
                    }
                }
            } finally {
                // --- Profiling Cleanup ---
                if (shouldProfile && profilingService) {
                    try {
                        const profile = await profilingService.stopProfiling(job.id);
                        console.log(`[PipelineStepRunner] Profile for Job ${job.id}:`, profile.aggregates);
                    } catch (err) {
                        console.warn(`[PipelineStepRunner] Failed to stop profiling for Job ${job.id}`, err);
                    }
                }
                // --- Event Logging: STEP_COMPLETED / STEP_FAILED ---
                if (pipelineExecutionId) {
                    try {
                        let agentId: string | null = null;
                        if (job && job.type === 'ai_agent' && job.config) {
                            agentId = (job.config as AIAgentConfig).persona;
                        }
                        const { cycleRunEvents } = await import("@shared/schema/cycle-run-events.js");
                        const stepCode = step.outputName || `Step ${step.order}`;
                        const durationMs = Number(getMonotonicTimeNs() - startTimeNs) / 1e6;
                        const roundedDurationMs = Math.round(durationMs);
                        await db.insert(cycleRunEvents).values({
                            runId: pipelineExecutionId,
                            stepCode,
                            eventType: result.success ? "STEP_COMPLETED" : "STEP_FAILED",
                            jobId: job?.id,
                            agentId: agentId,
                            outputs: result.output,
                            error: result.error,
                            durationMs: roundedDurationMs,
                        });
                        await publishCycleStepTransition(result.success ? "cycle.step_completed" : "cycle.step_failed", {
                            cycleId: pipelineExecutionId,
                            stepId: step.id,
                            stepCode,
                            stepOrder: step.order,
                            jobId: job?.id,
                            agentId,
                            status: result.status,
                            error: result.error,
                            durationMs,
                            organizationId: pipeline.organizationId,
                        });
                    } catch (e) {
                        console.error("[EventLogging] Failed to log final event:", e);
                    }
                }
            }
        }

        if (stepTraceContext) {
            result.traceId = stepTraceContext.traceId;
            result.spanId = stepTraceContext.spanId;
        }

        // Trace End of Execution
        const endTimeNs = getMonotonicTimeNs();
        if (stepTraceContext) {
            logForensicEvent(stepTraceContext, {
                organizationId: pipeline.organizationId ?? undefined,
                jobType: job.type,
                jobId: job.id,
                pipelineId: pipeline.id,
                status: result.success ? 'success' : 'failure',
                startTimeNs,
                endTimeNs,
                errorMessage: result.error,
                attributes: {
                    user_id: pipeline.createdBy,
                    step_order: step.order,
                    job_name: job.name,
                    retry_count: attempts - 1,
                    total_attempts: attempts,
                    ...(result.telemetry || {}) // Merge job-specific telemetry
                }
            });
        }

        // Reactive Intelligence: Compute diff if job execution succeeded
        if (result.success && result.output) {
            try {
                const diffResult = await computeStepDiff(job, result.output);
                if (diffResult && diffResult.hasChanges) {
                    result.diff = diffResult;

                    // Emit change event if significant changes detected
                    await emitDiffEvent('job', job.id, diffResult, {
                        organizationId: pipeline.organizationId ?? undefined,
                        jobName: job.name,
                    });
                }
            } catch (diffError) {
                console.warn('[PipelineStepRunner] Diff computation failed:', diffError);
                // Don't fail the step execution if diff fails
            }
        }

        // Step 1.1.2: Event Emission for Supervisor
        if ((context as any).supervisorChannelId) {
            try {
                const { streamingLogsService } = await import("@domain/jobs/core/streaming-logs.service.js");
                await streamingLogsService.emitEvent(
                    (context as any).supervisorChannelId,
                    result.success ? 'task_completed' : 'task_failed',
                    { 
                        stepId: step.id, 
                        status: result.status, 
                        output: result.output,
                        error: result.error,
                        timestamp: new Date().toISOString() 
                    }
                );
            } catch (err) {
                console.error("[PipelineStepRunner] Failed to emit supervisor event:", err);
            }
        }

        return result;

    } catch (error) {
        return {
            success: false,
            output: "",
            status: "failure",
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

/**
 * Compute diff between current output and previous run or snapshot
 */
async function computeStepDiff(job: Job, currentOutput: string): Promise<DiffResult | null> {
    try {
        const diffConfig = (job.diffConfig || {}) as JobDiffConfig;

        // Check if diffing is enabled
        if (!diffConfig?.enabled) {
            return null;
        }

        let baseline: any = null;
        let baselineSource = 'none';

        if (diffConfig.mode === 'baseline') {
            // Mode: Baseline Snapshot
            const conditions = [eq(snapshots.entityType, 'job_output')];

            if (diffConfig.baselineSnapshotId) {
                // Specific snapshot
                conditions.push(eq(snapshots.id, diffConfig.baselineSnapshotId));
            } else {
                // Default to primary
                conditions.push(eq(snapshots.jobId, job.id));
                conditions.push(eq(snapshots.isPrimary, true));
            }

            const snapshot = await db.select().from(snapshots).where(and(...conditions)).limit(1);
            if (snapshot.length > 0) {
                baseline = snapshot[0].data;
                baselineSource = `snapshot:${snapshot[0].id}`;
                console.log(`[Diff] Using snapshot ${snapshot[0].id} as baseline for job ${job.id}`);
            }
        } else {
            // Mode: Latest Run (default)
            // Fall back to the last successful run of this job
            const lastRun = await db
                .select()
                .from(pipelineStepExecutions)
                .where(
                    and(
                        eq(pipelineStepExecutions.jobId, job.id),
                        eq(pipelineStepExecutions.status, 'success')
                    )
                )
                .orderBy(desc(pipelineStepExecutions.completedAt))
                .limit(2); // Get 2 to exclude current if it's already there

            // Skip if no previous runs
            if (lastRun.length > 0) {
                // Try to parse the previous output
                try {
                    baseline = JSON.parse(lastRun[0].output || '{}');
                } catch {
                    // If not JSON, use as string
                    baseline = lastRun[0].output;
                }
                baselineSource = 'latest_run';
            }
        }

        if (!baseline) {
            return null; // No baseline to compare against
        }

        // Parse current output
        let current: any;
        try {
            current = JSON.parse(currentOutput);
        } catch {
            current = currentOutput;
        }

        // Compute the diff
        const ignorePaths = [
            'timestamp', 'createdAt', 'updatedAt', '_generatedAt',
            ...(diffConfig.ignorePaths || [])
        ];

        return computeDiff(baseline, current, {
            ignorePaths,
        });

    } catch (error) {
        console.error('[Diff] Failed to compute diff:', error);
        return null;
    }
}


/**
 * Core Job Resolver & Executer
 * Handles Variable Resolution + Execution
 */
export async function resolveAndExecuteJob(
    job: Job,
    pipeline: Pipeline,
    context: VariableContext & { data?: Record<string, any>; traceContext?: TraceContext },
    stepOrder: number,
    pipelineExecutionId?: number,
    stepExecutionId?: number,
    jobMap?: Map<number, Job>
): Promise<StepExecutionResult> {
    let resolvedConfig;
    try {
        // Resolve variables in job configuration
        resolvedConfig = resolveJobConfig(
            job.type,
            structuredClone(job.config || {}), // Deep clone to avoid mutating original job config
            { ...context, currentStepOrder: stepOrder }
        );
    } catch (error) {
        if (error instanceof VariableResolverError) {
            throw new Error(`Variable resolution failed for Job ${job.id}: ${error.message}`);
        }
        throw error;
    }

    // Execute
    try {
        return await executeJobCoreV2(job, resolvedConfig, pipeline, context, pipelineExecutionId, stepExecutionId, jobMap);
    } catch (error) {
        throw error;
    }
}

/**
 * The Meat: Logic for each specific Job Type
 */
async function executeJobCoreV2(
    job: Job,
    resolvedConfig: any, // Resolved Type
    pipeline: Pipeline,
    context: VariableContext & { data?: Record<string, any>; traceContext?: TraceContext },
    pipelineExecutionId?: number,
    stepExecutionId?: number,
    jobMap?: Map<number, Job>
): Promise<StepExecutionResult> {
    let output: string;
    let status: string = "pending";
    let externalId: string | undefined;
    let telemetry: Record<string, any> = {};

    console.log(`[Pipeline Executor] Executing Job ${job.id} (Type: '${job.type}') for Step ${stepExecutionId}`);

    const executor = jobExecutorRegistry.getExecutor(job.type);
    if (executor) {
        return await executor.execute(job, resolvedConfig, pipeline, context, resolveAndExecuteJob, stepExecutionId, pipelineExecutionId);
    }



    throw new ConfigurationError(`Unknown or unsupported job type: ${job.type}`);
}



