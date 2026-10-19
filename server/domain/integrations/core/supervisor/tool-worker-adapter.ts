
import { SupervisorWorkerOutput, SupervisorWorkerOutputSchema } from "@shared/schema/supervisor.js";
import { AGENT_TOOLS } from "../../../tools/v1/capabilities/index.js";
import { mcpClientService } from "../mcp-client.service.js";
import { createLogger } from "../../../../utils/logger.js";
import { governorService } from "@domain/governor/core/governor-service.js";
import { TraceContext } from "../../../../domain/core/infrastructure/trace-context.service.js";
import { logForensicEvent, getMonotonicTimeNs } from "../../../../domain/core/infrastructure/trace-logger.service.js";
import { db } from "../../../../database_service.js";
import { jobs, pipelines, Pipeline, PipelineStep } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { executePipelineStep } from "../../../../core/pipeline-step-runner.js";

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
            tool = allTools.find(t => t.name === toolName);
        } else {
            const allTools = [
                ...Object.values(AGENT_TOOLS),
                ...await mcpClientService.getAllTools()
            ];
            tool = allTools.find(t => t.name === assignedAgent || t.name === taskName);
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
            logForensicEvent(context.traceContext, {
                organizationId: context.organizationId,
                userId: context.userId,
                jobType: 'tool_execution_failed',
                status: 'failure',
                errorMessage: err,
                attributes: { toolName: toolName || assignedAgent }
            });
            return { status: "failed", action: "retry", error: err } as any;
        }

        // 2. Governance Check
        if (context.governorConfig?.enabled && context.governorConfig.rules) {
            try {
                // Internal Tool Check
                governorService.validateToolAccess(tool.name, context.governorConfig.rules);

                // MCP Specific Check
                if ((tool as any).isMcp || (tool as any).serverName) {
                    const serverName = (tool as any).serverName || "unknown";
                    governorService.validateMcpPermission(serverName, tool.name, context.governorConfig.rules);
                }
            } catch (e: any) {
                logger.warn(`[ToolWorkerAdapter] Governance blocked tool ${tool.name}: ${e.message}`);
                const err = `Governance Policy Violation: ${e.message}`;
                logForensicEvent(context.traceContext, {
                    organizationId: context.organizationId,
                    userId: context.userId,
                    jobType: 'tool_governance_block',
                    status: 'failure',
                    errorMessage: err,
                    attributes: { toolName: tool.name }
                });
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
            logForensicEvent(context.traceContext, {
                organizationId: context.organizationId,
                userId: context.userId,
                jobType: 'tool_start',
                status: 'success',
                startTimeNs,
                attributes: { toolName: tool.name, args: finalArgs }
            });

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

            // Outbound send gate — the same review/hold/block rules crew rooms
            // get, applied to mission-executed agents. The deployment's
            // approval_boundary resolves via context.jobId; a held send becomes
            // a pending approval_request (no room attached) rather than a send.
            try {
                const { maybeGateOutboundSend } = await import("../../../crew/core/outbound-send-gate.js");
                const gated = await maybeGateOutboundSend(
                    tool.name,
                    finalArgs as Record<string, any>,
                    { ...toolContext, jobId: context.jobId },
                    Date.now(),
                );
                if (gated) {
                    const isBlocked = gated.record.ok === false;
                    logger.warn(`[ToolWorkerAdapter] Send '${tool.name}' ${isBlocked ? "blocked" : "held for review"} by outbound gate.`);
                    logForensicEvent(context.traceContext, {
                        organizationId: context.organizationId,
                        userId: context.userId,
                        jobType: isBlocked ? "tool_boundary_block" : "tool_review_hold",
                        status: isBlocked ? "failure" : "success",
                        attributes: { toolName: tool.name },
                    });
                    return {
                        status: isBlocked ? "failed" : "completed",
                        action: "none",
                        ...(isBlocked ? { error: gated.output } : { result: gated.output }),
                    } as any;
                }
            } catch (gateErr: any) {
                // The gate must fail closed for its own errors on sends — an
                // unreachable boundary lookup must not become a free pass.
                logger.error(`[ToolWorkerAdapter] Outbound gate error for ${tool.name}: ${gateErr.message}`);
                const { GATED_SEND_TOOLS } = await import("../../../crew/core/outbound-send-gate.js")
                    .catch(() => ({ GATED_SEND_TOOLS: new Set(["send_email", "send_agentmail", "gmail_send", "reply_agentmail", "slack_post_message"]) }));
                if (GATED_SEND_TOOLS.has(tool.name)) {
                    return {
                        status: "failed",
                        action: "none",
                        error: `The message was NOT sent: the outbound review gate failed (${gateErr.message}).`,
                    } as any;
                }
            }

            let rawOutput = await tool.execute(finalArgs, toolContext);

            // Research resilience: if a web-search tool errored or returned nothing usable
            // (the headless browser is blocked in some environments), enrich/replace the
            // result with real papers from arXiv and OpenReview over plain HTTPS — so research
            // missions get genuine sources instead of an error string.
            if (/google_search|web_search|browse_web/i.test(tool.name)) {
                const out = typeof rawOutput === "string" ? rawOutput : JSON.stringify(rawOutput ?? "");
                // Treat as unusable when: short, an explicit error, a search-engine block /
                // error page (DDG/Google return apologetic stubs with no links), or simply
                // contains no URLs (real results always do). Any of these → use arXiv/OpenReview.
                const looksEmpty = !out || out.length < 200 ||
                    /Error searching|fetch fallback also failed|No results|captcha|unusual traffic|please email us|support email|anonymized error|If this persists|enable javascript/i.test(out) ||
                    !/https?:\/\//i.test(out);
                if (looksEmpty) {
                    try {
                        const { fetchScholarly } = await import("../../../tools/v1/capabilities/web.js");
                        let q = (finalArgs?.query ?? finalArgs?.q ?? "").toString();
                        // If no real topic was seeded, the agent searches a placeholder like
                        // "...target topic...". Derive the actual topic from the user's seeded
                        // sources (Ingestion Hub) so the paper search returns relevant — not generic — papers.
                        if (/target[_ ]?topic|the topic|<topic>|\{\{/i.test(q) || q.trim().length < 12) {
                            const { deriveResearchTopicFromSources } = await import("@domain/integrations/core/local-artifact.service.js");
                            const derived = await deriveResearchTopicFromSources(context.organizationId);
                            if (derived) {
                                logger.info(`[ToolWorkerAdapter] Generic query "${q.slice(0, 40)}"; using topic derived from seeded sources for paper search.`);
                                q = derived;
                            }
                        }
                        const papers = q ? await fetchScholarly(q) : null;
                        if (papers) {
                            logger.info(`[ToolWorkerAdapter] '${tool.name}' returned no usable web results; enriched with arXiv/OpenReview papers.`);
                            rawOutput = papers;
                        }
                    } catch (e: any) {
                        logger.warn(`[ToolWorkerAdapter] Scholarly enrichment failed: ${e.message}`);
                    }
                }
            }

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
                const requestType = actualRequest.type;
                logger.info(`[ToolWorkerAdapter] Tool '${tool.name}' requested HIL: ${requestType}`);

                // --- PERMISSION TIERS (HIL 2.0) BYPASS ---
                if (context.governorConfig?.rules) {
                    const autoApproval = governorService.validateAutoApproval(
                        tool.name, 
                        requestType, 
                        0.05, // Estimated standard cost for HIL bypass check
                        context.governorConfig.rules
                    );

                    if (autoApproval.allowed) {
                        logger.info(`[ToolWorkerAdapter] AUTO-APPROVING HIL request: ${autoApproval.reasoning}`);
                        
                        // For mode_switch_request, we just act as if it's approved
                        if (requestType === 'mode_switch_request') {
                            // We need to re-execute or just return a mock success
                            // In this case, we'll return a simulated success so the supervisor continues
                            structured = {
                                status: "completed",
                                action: "none",
                                result: { success: true, note: autoApproval.reasoning }
                            };
                        } else if (requestType === 'input_request') {
                            // For input_request, if we don't have a default, we might still need to wait
                            // UNLESS the tool provided a default.
                            const defaultValue = actualRequest.defaultValue || actualRequest.default;
                            if (defaultValue !== undefined) {
                                structured = {
                                    status: "completed",
                                    action: "none",
                                    result: { value: defaultValue, note: `Auto-filled: ${autoApproval.reasoning}` }
                                };
                            } else {
                                logger.warn(`[ToolWorkerAdapter] Auto-approval allowed for input_request, but no default value provided. Falling back to manual HIL.`);
                                structured = {
                                    status: "waiting_external_input",
                                    action: "none",
                                    ...parsed,
                                    suspensionMetadata: {
                                        waitReason: "external_interaction",
                                        ...actualRequest
                                    }
                                };
                            }
                        }
                    } else {
                        structured = {
                            status: "waiting_external_input",
                            action: "none",
                            ...parsed,
                            suspensionMetadata: {
                                waitReason: "external_interaction",
                                ...actualRequest
                            }
                        };
                    }
                } else {
                    structured = {
                        status: "waiting_external_input",
                        action: "none",
                        ...parsed,
                        suspensionMetadata: {
                            waitReason: "external_interaction",
                            ...actualRequest
                        }
                    };
                }
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
            
            // SECURITY HARDENING: Capture reasoning from tool output if available
            const toolThoughts = parsed.thoughts || parsed.reasoning || (parsed.result as any)?.thoughts;

            logForensicEvent(context.traceContext, {
                organizationId: context.organizationId,
                userId: context.userId,
                jobType: 'tool_complete',
                status: finalOutput.status === 'failed' ? 'failure' : 'success',
                startTimeNs,
                endTimeNs: getMonotonicTimeNs(),
                thoughts: toolThoughts,
                attributes: { toolName: tool.name, status: finalOutput.status }
            });

            return finalOutput;

        } catch (e: any) {
            const errMsg = e.message || String(e);
            logger.error(`[ToolWorkerAdapter] Execution failed for ${tool.name}`, e);
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
            return { status: "failed", action: "retry", reason: errMsg } as any;
        }
    }
}


