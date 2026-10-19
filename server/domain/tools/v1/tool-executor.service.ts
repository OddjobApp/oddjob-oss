import { getAgentTools, normalizeToolName, normalizeToolArguments } from "./tool-registry.service.js";
import { AgentContext, SupervisionLevel } from "../../agents/core/types.js";
import { TraceContext } from "@domain/core/infrastructure/tracing/trace-context.service.js";
import { logForensicEvent, getMonotonicTimeNs } from "@domain/core/infrastructure/tracing/trace-logger.service.js";
import { TaskManifest } from "@domain/ai/core/autonomous-lifecycle.service.js";

const SIDE_EFFECT_TOOLS = new Set([
    "file_write", "file_delete", "file_move", "create_job", "update_job", "delete_job",
    "run_pipeline", "slack_post_message", "email_send", "sql_query", "external_sql_query"
]);

export class ToolExecutor {
    static async execute(
        toolName: string,
        toolParams: any,
        context: AgentContext,
        tools: any[], // Resolved tool definitions
        dryRun: boolean,
        supervisionLevel: SupervisionLevel,
        traceContext?: TraceContext
    ): Promise<string> {
        const canonicalName = normalizeToolName(toolName);
        const agentTools = getAgentTools();
        const toolDef = agentTools[canonicalName];

        const registryHit = !!toolDef;
        const allotmentHit = registryHit && !!tools.find(t => t.name === toolDef.name);

        if (!registryHit || !allotmentHit) {
            // Record the gap before returning. This guard sits above `startTime`
            // and the analytics/forensic imports below, so until now a capability
            // an agent could not use reached no table and no trace — and §6 of the
            // improvement spec has no input without it.
            //
            // Two distinct facts reach this branch and the message conflates them:
            // the tool does not exist (`missing`), or it exists but is outside
            // this run's allotment (`unavailable`). The booleans above preserve
            // the difference; the returned string is left byte-identical so no
            // caller or prompt that matches on it changes behaviour.
            //
            // Deliberately not awaited: a capability gap must never become an
            // execution failure. `recordCapabilityGap` swallows its own errors.
            void import("@domain/capabilities/core/capability-gap-event.service.js")
                .then(({ recordCapabilityGap }) => recordCapabilityGap({
                    organizationId: context.organizationId,
                    missionId: context.missionId ?? null,
                    executionId: context.executionId ?? null,
                    traceId: traceContext?.traceId ?? null,
                    userId: context.userId ?? null,
                    requestedToolName: toolName,
                    canonicalToolName: toolDef ? toolDef.name : null,
                    registryHit,
                    allotmentHit,
                }))
                .catch(() => { /* telemetry only — never surfaces to the agent */ });

            const canonicalHint = toolDef ? ` (canonical: ${toolDef.name})` : "";
            return `Error: Tool '${toolName}' not found or not allowed.${canonicalHint}. Check mission allotment or recruitment.`;
        }

        // Resolve the organization ONCE, and fail closed when it is absent.
        //
        // AgentContext.organizationId is typed `number`, but callers reach this
        // path through non-null assertions on OrgContext.organizationId (which is
        // `number | null`), so a null genuinely arrives at runtime. Every site
        // below previously coerced with `Number(context.organizationId) || 1`, which
        // silently rewrote a missing org to org 1 — for the tool's own context,
        // for governance enforcement, for guardrail validation, and for the
        // forensic/analytics records. Tools then read that 1 back as if it were
        // authentic tenancy.
        const resolvedOrgId = Number(context.organizationId);
        if (!Number.isInteger(resolvedOrgId) || resolvedOrgId <= 0) {
            return `Error: Tool '${toolName}' requires an organization context, but none was resolved for this agent run. Refusing to execute against a default organization.`;
        }

        // Studio Marketplace entitlement gate: gated CREW studio mounts require the
        // organization to have the add-on enabled. Other tools pass through.
        const { getGatedStudioKindForTool, studioEntitlementService } = await import("@server/domain/studio-marketplace/core/studio-entitlement.service.js");
        const { STUDIOS } = await import("@shared/studio-registry.js");
        const gatedStudioKind = getGatedStudioKindForTool(toolName);
        if (gatedStudioKind) {
            const enabled = await studioEntitlementService.isEnabled(resolvedOrgId, gatedStudioKind);
            if (!enabled) {
                const displayName = STUDIOS[gatedStudioKind]?.name ?? gatedStudioKind;
                return `Error: ${displayName} is not enabled for this organization. Install it from the Studio Marketplace.`;
            }
        }

        const { sidecarSyncService } = await import("@domain/knowledge/core/sidecar-sync-service.js");
        const { toolAnalyticsService } = await import("@domain/agents/core/tool-analytics.service.js");

        const startTime = Date.now();
        const startTimeInNs = getMonotonicTimeNs();
        let toolStatus: "success" | "failure" | "timeout" | "cancelled" = "success";
        let errorType: string | undefined;
        let errorMessage: string | undefined;
        let toolOutput = "";

        // Apply parameter normalization (handles filename -> path, etc.)
        const normalizedParams = normalizeToolArguments(toolName, toolParams);

        try {
            // Forensic start event
            if (traceContext) {
                logForensicEvent(traceContext, {
                    organizationId: resolvedOrgId,
                    missionId: (context as any).missionId,
                    jobId: Number(context.jobId) || undefined,
                    jobType: `tool:${toolName}`,
                    status: 'success', // 'pending' status would be better if schema supported it
                    startTimeNs: startTimeInNs,
                    attributes: {
                        params: normalizedParams,
                        supervisionLevel
                    }
                });
            }

            // Simulation Mode check
            const isSideEffect = SIDE_EFFECT_TOOLS.has(toolName) ||
                (toolName === 'http_request' && normalizedParams.method !== 'GET') ||
                (toolName === 'external_sql_query' && !/^\s*(select|with|explain|show)/i.test(normalizedParams.query || ''));

            if (dryRun && isSideEffect) {
                return `[Simulation Mode] Action verified. Tool '${toolName}' was NOT executed. Mock success.`;
            }

            const agentGovernance = await import("@domain/governance/core/agent-governance-enforcement.js");
            const agentDecision = await agentGovernance.enforceAgentGovernanceForTool({
                toolName,
                args: normalizedParams,
                intent: `Execute tool '${toolName}' for agent task.`,
                context: {
                    organizationId: resolvedOrgId,
                    userId: context.userId,
                    agentId: (context as any).agentId ?? context.jobId,
                    runId: context.executionId,
                    missionId: (context as any).missionId,
                    jobId: Number(context.jobId) || undefined,
                },
            });

            if (!agentDecision.allowed) {
                return `Error: Agent governance ${agentDecision.decision === "require_approval" ? "requires approval" : "denied"} for tool '${toolName}'. ${agentDecision.reason}`;
            }

            // Circuit Breaker Wrap
            const { withCircuitBreaker, createCircuitBreaker, getCircuitState } = await import("@domain/core/infrastructure/circuit-breaker.service.js");
            const circuitName = `tool:${toolName}`;
            const circuitData: any = getCircuitState(circuitName);

            if (!circuitData && (toolDef as any).circuitConfig) {
                createCircuitBreaker({
                    name: circuitName,
                    failureThreshold: (toolDef as any).circuitConfig.failureThreshold,
                    resetTimeoutMs: (toolDef as any).circuitConfig.resetTimeoutMs,
                    halfOpenMaxAttempts: 3
                });
            }

            let parsedParams = normalizedParams;
            if ((toolDef as any).parameters) {
                const parseResult = (toolDef as any).parameters.safeParse(normalizedParams);
                if (!parseResult.success) {
                    const errorMsg = parseResult.error.errors.map((e: any) => `${e.path.join('.')}: ${e.message}`).join(', ');
                    return `Error: Invalid parameters for tool '${toolName}'. ${errorMsg}. Please correct the parameters and try again.`;
                }
                parsedParams = parseResult.data;
            }

            // Resolve and enforce capability policies (NemoClaw parity)
            let rules: any[] = [];
            if ((context as any).governorConfig?.rules) {
                rules = (context as any).governorConfig.rules;
            } else if (context.jobId || context.missionId) {
                try {
                    const { governorResolver } = await import("@domain/governor/core/governor-resolver.js");
                    const resolved = await governorResolver.resolveGovernance({
                        jobId: context.jobId,
                    });
                    if (resolved && resolved.enabled) {
                        rules = resolved.rules;
                    }
                } catch {
                    // Fall back to no rules
                }
            }

            try {
                const { governorService } = await import("@domain/governor/core/governor-service.js");
                
                // 1. File Path restriction check
                const filePath = parsedParams.TargetFile || parsedParams.AbsolutePath || parsedParams.filePath || parsedParams.path || parsedParams.file;
                if (filePath && typeof filePath === 'string') {
                    governorService.validateFilePath(filePath, rules);
                }

                // 2. Network destination check
                const url = parsedParams.url || parsedParams.Url || parsedParams.endpoint;
                if (url && typeof url === 'string') {
                    governorService.validateNetworkDestination(url, rules);
                }
            } catch (govError: any) {
                return `Error: ${govError.message}`;
            }

            // 5-Stage Swiss Cheese Multi-Layered Guardrail Validation
            try {
                const { swissCheeseGuardrailService } = await import("@domain/governor/core/swiss-cheese-guardrail.service.js");
                const guardrailResult = await swissCheeseGuardrailService.validateFullPipeline(
                    normalizedParams,
                    toolName,
                    {
                        organizationId: resolvedOrgId,
                        userId: context.userId,
                        agentId: (context as any).agentId ?? context.jobId,
                        missionId: (context as any).missionId,
                        jobId: Number(context.jobId) || undefined
                    },
                    {
                        circuitOpen: circuitData?.state === "open"
                    }
                );

                if (!guardrailResult.allowed) {
                    return `Error: Swiss Cheese Guardrail blocked tool '${toolName}' at Layer ${guardrailResult.blockedAtLayer} (${guardrailResult.blockedLayerName}). ${guardrailResult.forensicAuditLog.summary}`;
                }
            } catch (scError: any) {
                // If guardrail throws, treat as policy error
                return `Error: Swiss Cheese Guardrail check failed: ${scError.message}`;
            }

            toolOutput = await withCircuitBreaker(circuitName, async () => {
                const fullContext = {
                    named: {},
                    positional: {},
                    ...context,
                    ...traceContext,
                    missionId: (context as any).missionId,
                    organizationId: resolvedOrgId
                };
                const result = await (toolDef as any).execute(parsedParams, fullContext);
                
                // If result is an error string, throw it to trigger circuit breaker failure
                if (typeof result === 'string') {
                    const lower = result.toLowerCase().trim();
                    if (lower.startsWith('error') || lower.startsWith('request failed') ||
                        lower.startsWith('search failed') || lower.startsWith('access denied')) {
                        throw new Error(result);
                    }
                }

                // Layer 4 Output Validation & PII Redaction
                try {
                    const { swissCheeseGuardrailService } = await import("@domain/governor/core/swiss-cheese-guardrail.service.js");
                    const sanitized = swissCheeseGuardrailService.evaluateLayer4_Output(result);
                    return sanitized.sanitizedData;
                } catch {
                    return result;
                }
            });

        } catch (execError: any) {
            toolStatus = "failure";
            errorType = execError.name || execError.constructor.name;
            errorMessage = execError.message;

            if (execError.name === "CircuitOpenError") {
                let fallbackMsg = "";
                if ((toolDef as any).fallbackTool) {
                    fallbackMsg = ` Suggested fallback: Try using '${(toolDef as any).fallbackTool}' instead.`;
                }
                toolOutput = `Error: Tool '${toolName}' is temporarily unavailable due to high failure rate (Circuit Open).${fallbackMsg}`;
            } else {
                toolOutput = `Error executing tool '${toolName}': ${errorMessage}`;
            }
        } finally {
            const executionTimeMs = Date.now() - startTime;
            const endTimeInNs = getMonotonicTimeNs();

            if (traceContext) {
                logForensicEvent(traceContext, {
                    organizationId: resolvedOrgId,
                    missionId: (context as any).missionId,
                    jobId: Number(context.jobId) || undefined,
                    jobType: `tool:${toolName}`,
                    status: toolStatus,
                    startTimeNs: startTimeInNs,
                    endTimeNs: endTimeInNs,
                    errorMessage,
                    attributes: {
                        executionTimeMs,
                        supervisionLevel
                    }
                });
            }

            sidecarSyncService.logObservation(`tool:${toolName}:latency`, executionTimeMs, {
                jobId: context.jobId,
                status: toolStatus,
            }).catch(() => { });

            toolAnalyticsService.logToolUsage({
                executionId: context.executionId,
                toolName,
                taskType: toolAnalyticsService.inferTaskType(""), // Goal should be passed if possible
                taskDescription: "",
                status: toolStatus === "success" ? "success" : "error",
                executionTimeMs,
                errorType,
                errorMessage,
                inputParams: toolParams,
                outputData: toolStatus === "success" ? { preview: toolOutput.slice(0, 500) } : undefined,
                organizationId: resolvedOrgId,
            }).catch((err: any) => console.error("Failed to log tool analytics:", err));
        }

        return toolOutput;
    }
}


