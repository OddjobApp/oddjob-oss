
import { SupervisorWorkerOutput, SupervisorWorkerOutputSchema } from "@shared/schema/supervisor.js";
import { AGENT_TOOLS } from "@domain/tools/v1/tool-registry.service.js";
import { mcpClientService } from "@domain/integrations/core/mcp-client.service.js";
import { createLogger } from "@server/utils/logger.js";
import { governorService } from "@domain/governor/core/governor-service.js";
import { TraceContext } from "@domain/core/infrastructure/tracing/trace-context.service.js";
import { logForensicEvent, getMonotonicTimeNs } from "@domain/core/infrastructure/tracing/trace-logger.service.js";
import { db } from "@server/database_service.js";
import { jobs, pipelines, Pipeline, PipelineStep } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { executePipelineStep } from "@server/core/pipeline-step-runner.js";

const logger = createLogger("ToolWorkerAdapter");

export interface WorkerContext {
    userId: string;
    organizationId: number;
    missionId?: number;
    executionId?: number;
    jobId?: number;
    governorConfig?: any;
    traceContext?: TraceContext;
    isAdmin?: boolean;
    isOrgAdmin?: boolean;
    isSuperAdmin?: boolean;
}

export class ToolWorkerAdapter {

    /**
     * Executes a tool (explicit or implicit) and returns a standardized SupervisorWorkerOutput.
     * Handles all error catching, governance checks, and output parsing.
     */
    static async execute(
        taskName: string,
        toolName: string | undefined,
        assignedAgent: string | undefined,
        args: any,
        context: WorkerContext
    ): Promise<SupervisorWorkerOutput> {

        let tool: any;
        const startTimeNs = getMonotonicTimeNs();

        // 1. Resolve Tool
        // ... (existing tool resolution logic)
        if (toolName) {
            const allTools = [
                ...Object.values(AGENT_TOOLS),
                ...await mcpClientService.getAllTools()
            ];
            tool = allTools.find((t: any) => t.name === toolName);
        } else {
            const allTools = [
                ...Object.values(AGENT_TOOLS),
                ...await mcpClientService.getAllTools()
            ];
            tool = allTools.find((t: any) => t.name === assignedAgent || t.name === taskName);
        }

        if (!tool) {
            // FALLBACK: Check if this name refers to an atomic Job (e.g., an AI Agent)
            logger.info(`[ToolWorkerAdapter] No static tool found for ${assignedAgent || toolName}. Searching database jobs...`);
            const targetName = assignedAgent || toolName;

            if (targetName) {
                const [job] = await db.select()
                    .from(jobs)
                    .where(eq(jobs.name, targetName))
                    .limit(1);

                if (job) {
                    logger.info(`[ToolWorkerAdapter] Found Job ${job.id} matching ${targetName}. Executing via Pipeline Runner...`);

                    try {
                        // Create a mock pipeline context for single-step execution
                        const mockPipeline: Partial<Pipeline> = {
                            id: 0,
                            name: `Virtual Pipeline for ${job.name}`,
                            organizationId: context.organizationId,
                            createdBy: context.userId
                        };

                        const mockStep: Partial<PipelineStep> = {
                            id: 0,
                            pipelineId: 0,
                            jobId: job.id,
                            moduleType: "job",
                            order: 1,
                            toolArguments: job.config as any
                        };

                        // Use executePipelineStep to profit from standard job execution (AI Agents, Transformers, etc)
                        const stepContext = {
                            ...args,
                            data: {
                                ...(args || {}),
                                missionId: (args as any)?.missionId || context.missionId,
                                executionId: (args as any)?.pipelineExecutionId || context.executionId,
                                userId: context.userId,
                                organizationId: context.organizationId
                            },
                            traceContext: context.traceContext
                        };

                        const res = await executePipelineStep(
                            mockStep as PipelineStep,
                            mockPipeline as Pipeline,
                            stepContext as any,
                            true, // isFirstStep
                            undefined, // pipelineExecutionId
                            undefined // stepExecutionId
                        );

                        return {
                            status: res.success ? "completed" : "failed",
                            action: "none",
                            result: res.output,
                            reason: res.error,
                        };
                    } catch (err: any) {
                        logger.error(`[ToolWorkerAdapter] Atomic job execution failed: ${err.message}`);
                        return { status: "failed", action: "retry", error: `Job execution failed: ${err.message}` } as any;
                    }
                }
            }

            const err = `No matching tool or job found for ${toolName || assignedAgent}`;
            if (context.traceContext) {
                logForensicEvent(context.traceContext, {
                    organizationId: context.organizationId,
                    userId: context.userId,
                    jobType: 'tool_execution_failed',
                    status: 'failure',
                    errorMessage: err,
                    attributes: { toolName: toolName || assignedAgent }
                });
            }
            return { status: "failed", action: "retry", error: err } as any;
        }

        // 2. Governance Check
        if (context.governorConfig?.enabled && context.governorConfig.rules) {
            try {
                governorService.validateToolAccess(tool.name, context.governorConfig.rules);
            } catch (e: any) {
                logger.warn(`[ToolWorkerAdapter] Governance blocked tool ${tool.name}: ${e.message}`);
                const err = `Governance Policy Violation: ${e.message}`;
                if (context.traceContext) {
                    logForensicEvent(context.traceContext, {
                        organizationId: context.organizationId,
                        userId: context.userId,
                        jobType: 'tool_governance_block',
                        status: 'failure',
                        errorMessage: err,
                        attributes: { toolName: tool.name }
                    });
                }
                return { status: "failed", action: "none", error: err } as any;
            }
        }

        // 3. Execution
        try {
            const toolContext = {
                organizationId: context.organizationId,
                userId: context.userId,
                missionId: (args as any)?.missionId || context.missionId,
                executionId: (args as any)?.pipelineExecutionId || context.executionId,
                isAdmin: context.isAdmin || false,
                isOrgAdmin: context.isOrgAdmin || false,
                isSuperAdmin: context.isSuperAdmin || false
            };

            let finalArgs = args || {};
            if ((tool.name.includes("search") || tool.name.includes("knowledge")) && !finalArgs.query) {
                finalArgs = { ...finalArgs, query: taskName };
            }

            logger.info(`[ToolWorkerAdapter] Executing ${tool.name}`, { args: finalArgs });
            if (context.traceContext) {
                logForensicEvent(context.traceContext, {
                    organizationId: context.organizationId,
                    userId: context.userId,
                    jobType: 'tool_start',
                    status: 'success',
                    startTimeNs,
                    attributes: { toolName: tool.name, args: finalArgs }
                });
            }

            if (tool.parameters) {
                const parseResult = tool.parameters.safeParse(finalArgs);
                if (!parseResult.success) {
                    const errorMsg = parseResult.error.errors.map((e: any) => `${e.path.join('.')}: ${e.message}`).join(', ');

                    // Leniency here is deliberate — the LLM often omits fields the task
                    // already carries — but it used to apply even when a REQUIRED field
                    // was absent entirely, and running anyway cannot help in that case:
                    // finalArgs IS the original args, so a "Required" error means the
                    // value is genuinely missing.
                    //
                    // request_human_input was invoked ~500 times without `name`/`fields`
                    // and executed regardless, handing `fields: undefined` to
                    // FormPublishingService.publish, which died on `fields.map(...)`
                    // ~700 times. Refusing here turns that into one actionable error the
                    // agent can retry against, instead of two silent failures downstream.
                    const missingRequired = parseResult.error.errors.filter(
                        (e: any) => e.code === "invalid_type" && e.received === "undefined"
                    );

                    if (missingRequired.length > 0) {
                        const missing = missingRequired.map((e: any) => e.path.join(".")).join(", ");
                        logger.warn(`[ToolWorkerAdapter] Refusing to execute '${tool.name}': required parameter(s) missing: ${missing}.`);
                        return {
                            status: "failed",
                            action: "retry",
                            error: `Tool '${tool.name}' was called without required parameter(s): ${missing}. Supply them and call it again.`,
                        } as any;
                    }

                    logger.warn(`[ToolWorkerAdapter] Parameter validation for '${tool.name}' failed: ${errorMsg}. Attempting execution with original args.`);
                } else {
                    finalArgs = { ...(args || {}), ...parseResult.data };
                }
            }

            const rawOutput = await tool.execute(finalArgs, toolContext);

            // 4. Output Parsing
            let parsed: any;
            if (typeof rawOutput === 'string') {
                try {
                    parsed = JSON.parse(rawOutput);
                } catch (e) {
                    parsed = { result: rawOutput };
                }
            } else {
                parsed = rawOutput;
            }

            let structured: any;
            const hilRequest = parsed.result?.type ? parsed.result : parsed;
            const isHil = hilRequest?.type === 'input_request' || hilRequest?.type === 'mode_switch_request';

            if (isHil) {
                const actualRequest = hilRequest.result?.type ? hilRequest.result : hilRequest;
                logger.info(`[ToolWorkerAdapter] Tool '${tool.name}' requested HIL: ${actualRequest.type}`);
                structured = {
                    status: "waiting_external_input",
                    action: "none",
                    ...parsed,
                    suspensionMetadata: {
                        waitReason: "external_interaction",
                        ...actualRequest
                    }
                };
            } else if (parsed.result || parsed.error || parsed.status || parsed.success === false) {
                // Determine status - unified check for both MCP (success: false) and internal/supervisor (status: failed)
                const isFailed =
                    parsed.status === "failed" ||
                    parsed.success === false ||
                    !!parsed.error ||
                    (typeof parsed.result === 'string' && parsed.result.startsWith('Error:'));

                structured = {
                    status: isFailed ? "failed" : "completed",
                    action: parsed.action || "none",
                    ...parsed
                };
            } else {
                structured = {
                    status: "completed",
                    action: "none",
                    result: parsed
                };
            }

            const finalOutput = SupervisorWorkerOutputSchema.parse(structured);
            if (context.traceContext) {
                logForensicEvent(context.traceContext, {
                    organizationId: context.organizationId,
                    userId: context.userId,
                    jobType: 'tool_complete',
                    status: finalOutput.status === 'failed' ? 'failure' : 'success',
                    startTimeNs,
                    endTimeNs: getMonotonicTimeNs(),
                    attributes: { toolName: tool.name, status: finalOutput.status }
                });
            }

            return finalOutput;

        } catch (e: any) {
            const errMsg = e.message || String(e);
            logger.error(`[ToolWorkerAdapter] Execution failed for ${tool.name}`, e);
            if (context.traceContext) {
                logForensicEvent(context.traceContext, {
                    organizationId: context.organizationId,
                    userId: context.userId,
                    jobType: 'tool_error',
                    status: 'failure',
                    errorMessage: errMsg,
                    startTimeNs,
                    endTimeNs: getMonotonicTimeNs(),
                    attributes: { toolName: tool.name }
                });
            }
            return { status: "failed", action: "retry", reason: errMsg } as any;
        }
    }
}


