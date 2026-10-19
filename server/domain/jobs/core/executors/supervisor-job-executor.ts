
import { Job, Pipeline, SupervisorJobConfig, pipelineExecutions, pipelineStepExecutions, approvalRequests, users } from "@shared/schema/index.js";
import { VariableContext } from "../../../../core/variable-resolver.js";
import { StepExecutionResult } from "../../../../core/pipeline-step-runner.js";
import { JobExecutor } from "./index.js";
import { TraceContext } from "@domain/core/infrastructure/tracing/trace-context.service.js";
import { supervisorService, type AiCallUsage } from "@domain/integrations/core/supervisor.service.js";
import * as path from 'path';
import { db } from "../../../../database_service.js";
import { eq } from "drizzle-orm";
import { createLogger } from "../../../../utils/logger.js";
import { CapabilityDiscoveryService } from "@domain/core/infrastructure/capability-discovery.service.js";
import { saveJobOutput } from "./executor-utils.js";
import { generateExternalToken } from "@domain/core/auth/jwt.service.js";
import { governorResolver } from "@domain/governor/index.js";
import type { GovernanceResolved } from "@domain/governor/index.js";

const logger = createLogger("SupervisorJobExecutor");

export class SupervisorJobExecutor implements JobExecutor {
    canExecute(jobType: string): boolean {
        return jobType === "supervisor";
    }

    async execute(
        job: Job,
        resolvedConfig: any,
        pipeline: Pipeline,
        context: VariableContext & { data?: Record<string, any>; traceContext?: TraceContext; executionId?: number },
        executeJob?: any,
        stepExecutionId?: number,
        pipelineExecutionId?: number
    ): Promise<StepExecutionResult> {
        // Collect every LLM call this step makes so the result can carry them out to
        // AIAnalyticsHook, which is the only place that knows the step execution id.
        const aiUsage: AiCallUsage[] = [];
        const result = await this.executeInternal(
            job, resolvedConfig, pipeline, context, executeJob, stepExecutionId, pipelineExecutionId,
            (usage) => aiUsage.push(usage),
        );
        return attachAiUsage(result, aiUsage);
    }

    private async executeInternal(
        job: Job,
        resolvedConfig: any,
        pipeline: Pipeline,
        context: VariableContext & { data?: Record<string, any>; traceContext?: TraceContext; executionId?: number },
        executeJob: any,
        stepExecutionId: number | undefined,
        pipelineExecutionId: number | undefined,
        recordAiUsage: (usage: AiCallUsage) => void,
    ): Promise<StepExecutionResult> {
        const config = resolvedConfig as SupervisorJobConfig;
        const targetExecutionId = pipelineExecutionId || context.executionId;

        if (!targetExecutionId) {
            throw new Error("Supervisor job requires an active pipeline execution ID");
        }

        try {
            // 1. Initialization & Workgroup Resolution
            const userId = context.data?.userId || "supervisor-executor";
            const orgId = job.organizationId;

            // Critical: Resolve Mission ID upfront to prevent drift
            let missionId = context.data?.missionId;

            if (!missionId) {
                const [currentExec] = await db.select({ missionId: pipelineExecutions.missionId })
                    .from(pipelineExecutions)
                    .where(eq(pipelineExecutions.id, targetExecutionId))
                    .limit(1);

                missionId = currentExec?.missionId;
            }

            if (!missionId) {
                const intent = config.intent || "General Supervisor Task";
                logger.info(`[Supervisor] No mission anchored for execution ${targetExecutionId}. Resolving for intent: ${intent}`);

                const { missionService } = await import("@domain/mission/core/mission.service.js");
                const mission = await missionService.ensureSupervisorMission({
                    supervisorJobId: job.id,
                    intent: intent,
                    orgId: orgId ?? undefined,
                    userId: userId
                });

                missionId = mission.id;
                await db.update(pipelineExecutions)
                    .set({ missionId: mission.id })
                    .where(eq(pipelineExecutions.id, targetExecutionId));

                logger.info(`[Supervisor] Execution ${targetExecutionId} anchored to Mission ${missionId}`);
            }

            // --- RESOLVE ALLOWED TEAM (Pipelines & Jobs) ---
            const pipelineIds = new Set<number>(config.allowedPipelines || []);
            const jobIds = new Set<number>();

            if (missionId) {
                const { missionMembers } = await import("@shared/schema/index.js");
                const members = await db.select().from(missionMembers).where(eq(missionMembers.missionId, missionId));
                members.forEach(m => {
                    if (m.entityType === 'pipeline') pipelineIds.add(m.entityId);
                    if (m.entityType === 'job') jobIds.add(m.entityId);
                });
            }

            const resolvedPipelineIds = Array.from(pipelineIds);
            const resolvedJobIds = Array.from(jobIds);
            logger.info(`[Supervisor] Resolved Team: ${resolvedPipelineIds.length} pipelines, ${resolvedJobIds.length} jobs`);

            // 1.5 Planning Phase
            const governorConfig = await governorResolver.resolveGovernance({
                jobId: job.id,
                pipelineId: undefined,
                jobConfig: config
            });

            let plan;
            if (context.data?._type === "supervisor_triage_approval" && context.data?.approved === true) {
                logger.info(`[Supervisor] Triage recovery approved by user — re-planning with updated intent`);
                // Fall through to fresh planning below so the supervisor replans with triage context injected
            } else if (context.data?.plan && (context.data?.approved === true || context.data?.approved === "true" || context.data?._type === "supervisor_plan_approval")) {
                logger.info(`[Supervisor] Using approved plan from HIL response`);
                plan = context.data.plan;
            } else {
                if (stepExecutionId) {
                    const [stepExec] = await db.select().from(pipelineStepExecutions).where(eq(pipelineStepExecutions.id, stepExecutionId)).limit(1);
                    if (stepExec && stepExec.output) {
                        try {
                            const prev = JSON.parse(stepExec.output);
                            if (prev && prev.tasks) {
                                logger.info(`[Supervisor] Resuming from existing plan in step execution output`);
                                plan = prev;
                            }
                        } catch (e) { }
                    }
                }

                if (!plan) {
                    logger.info(`[Supervisor] Planning for intent: ${config.intent}`);

                    let capabilityCatalog = "";
                    let knowledgeContext = "";

                    let allCapabilities: any[] = [];
                    if (resolvedPipelineIds.length > 0) {
                        logger.info(`[Supervisor] Discovering capabilities for ${resolvedPipelineIds.length} pipelines`);
                        const capabilities = await CapabilityDiscoveryService.discoverCapabilities(resolvedPipelineIds, orgId || 0);
                        allCapabilities = [...allCapabilities, ...capabilities];
                    }

                    if (resolvedJobIds.length > 0) {
                        logger.info(`[Supervisor] Discovering capabilities for ${resolvedJobIds.length} recruited jobs`);
                        const capabilities = await CapabilityDiscoveryService.discoverJobCapabilities(resolvedJobIds, orgId || 0);
                        allCapabilities = [...allCapabilities, ...capabilities];
                    }

                    if (allCapabilities.length > 0) {
                        capabilityCatalog = CapabilityDiscoveryService.formatCapabilityCatalog(allCapabilities);

                        // Extract unique topics and datasets for high-level context
                        const topics = new Set<string>();
                        const datasets = new Set<string>();
                        allCapabilities.forEach(c => {
                            c.knowledgeTopics?.forEach((t: string) => topics.add(t));
                            c.datasets?.forEach((d: string) => datasets.add(d));
                        });

                        if (topics.size > 0 || datasets.size > 0) {
                            knowledgeContext = "The following knowledge bases are reachable by your team:\n";
                            if (topics.size > 0) knowledgeContext += `- Topics: ${Array.from(topics).join(", ")}\n`;
                            if (datasets.size > 0) knowledgeContext += `- Datasets: ${Array.from(datasets).join(", ")}\n`;
                        }
                    }


                    // --- INJECT MCP TOOLS ---
                    const mcpTools = await import("@domain/integrations/core/mcp-client.service.js").then(m => m.mcpClientService.getAllTools());
                    if (mcpTools.length > 0) {
                        logger.info(`[Supervisor] Injecting ${mcpTools.length} MCP tools into catalog`);
                        capabilityCatalog += "\n\n### EXTERNAL TOOLS\n";
                        capabilityCatalog += "You can also directly execute the following external tools. To use them, create a task with a description that explicitly asks to use the tool and its arguments.\n\n";

                        mcpTools.forEach(t => {
                            capabilityCatalog += `- **${t.name}**: ${t.description}\n`;
                            // Minimal parameter hint (since we don't have full schema text easily available yet)
                            capabilityCatalog += `  (Use this tool by name: "${t.name}")\n`;
                        });
                        capabilityCatalog += "\n---\n";
                    }

                    // --- SOUL PERSONALITY INJECTION ---
                    let soulPrompt: string | undefined;
                    try {
                        const { SoulService } = await import("@domain/agents/core/soul.service.js");
                        const { agentDeployments } = await import("@shared/schema/index.js");
                        const [agentDep] = await db.select().from(agentDeployments).where(eq(agentDeployments.jobId, job.id)).limit(1);
                        if (agentDep && agentDep.oceanTraits) {
                            soulPrompt = SoulService.generateSoulPrompt(agentDep.oceanTraits as any, agentDep.soulArchetype || "Lead Directive");
                        }
                    } catch (err) {
                        logger.warn("[SupervisorJobExecutor] Failed to resolve soul personality:", err as any);
                    }

                    plan = await supervisorService.plan(
                        config.intent,
                        config.model,
                        config.credentialId,
                        capabilityCatalog,
                        knowledgeContext,
                        undefined, // previousPlan
                        undefined, // history
                        orgId ?? undefined,
                        soulPrompt,
                        missionId ?? undefined,
                        recordAiUsage
                    );


                    if (config.requirePlanApproval && !context.data?._planApproved) {
                        logger.info(`[Supervisor] Plan approval required. Pausing.`);

                        // Generate a token and create an approval request so it shows up in the UI
                        const token = generateExternalToken({
                            executionId: String(stepExecutionId || 0),
                            formId: 0, // Virtual form ID (numeric 0 for typesafety)
                            email: "system@supervisor", // Placeholder
                            role: "internal"
                        });

                        let approverEmail = "system@oddjob.ai";
                        let approverId: string | null = null;

                        // Try to find the user from context
                        if (userId && userId !== "supervisor-executor") {
                            const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
                            if (user) {
                                approverEmail = user.email || approverEmail;
                                approverId = user.id;
                            }
                        }

                        await db.insert(approvalRequests).values({
                            executionId: String(stepExecutionId || 0),
                            jobId: job.id,
                            approverType: "internal",
                            approverId: approverId,
                            approverEmail: approverEmail,
                            status: "pending",
                            token: token,
                            missionId: missionId ?? null,
                            // The approvals API maps modifiedOutput → contextSnapshot for the
                            // REVIEW CONTEXT tab. Persist the plan/intent here (not just in the
                            // step return output) so the reviewer actually sees what they're approving.
                            modifiedOutput: {
                                _type: "supervisor_plan_approval",
                                plan,
                                intent: config.intent,
                                description: "Review required for supervisor plan",
                                message: "Review required for supervisor plan",
                            },
                        });

                        return {
                            success: true,
                            status: "waiting_external_input",
                            output: JSON.stringify({
                                _type: "supervisor_plan_approval",
                                plan,
                                intent: config.intent,
                                message: "Review required for supervisor plan"
                            })
                        };
                    }
                }
            }

            // Store initial plan in context if needed (not strictly required for execution)
            
            // Step 1.1.3: Define Supervisor Channel ID
            const supervisorChannelId = `supervisor-channel-${targetExecutionId}`;
            if (context.data) {
                context.data.supervisorChannelId = supervisorChannelId;
            } else {
                context.data = { supervisorChannelId };
            }

            // 2. Execution Loop
            logger.info(`[Supervisor] Starting execution loop for plan with ${plan.tasks.length} tasks`);
            let state: any;
            let iterations = 0;
            // Allow mission context (context.data.maxSteps) to override job config
            const ctxMax = context.data?.maxSteps != null ? Number(context.data.maxSteps) : undefined;
            const maxIterations = Math.max(ctxMax ?? config.maxSteps ?? 100, 100);

            while (iterations < maxIterations) {
                const tickResult = await supervisorService.executePlan(
                    plan,
                    targetExecutionId,
                    userId,
                    orgId || undefined,
                    resolvedPipelineIds,
                    job.id,
                    context.data || {}
                );

                plan = tickResult.plan;
                state = tickResult.state;

                logger.info(`[Supervisor] Tick ${iterations}: State=${state}`);

                // --- Echo Status Update to Mission Chat ---
                if (plan.statusUpdate && missionId) {
                    try {
                        const { missionService } = await import("@domain/mission/core/mission.service.js");
                        const workgroup = await missionService.getMissionDetail(missionId);
                        if (workgroup) {
                            const currentBlackboard = (workgroup.blackboard as any) || {};
                            const messages = currentBlackboard.messages || [];

                            // Avoid duplicate updates if the status hasn't changed meaningfully
                            const lastAssistantMsg = [...messages].reverse().find(m => m.role === 'assistant');
                            if (!lastAssistantMsg || lastAssistantMsg.content !== plan.statusUpdate) {
                                const newMessage = {
                                    id: `cmd-${Date.now()}`,
                                    role: "assistant",
                                    content: plan.statusUpdate,
                                    sender: "Mission Command",
                                    timestamp: new Date().toISOString()
                                };

                                const updatedBlackboard = {
                                    ...currentBlackboard,
                                    messages: [...messages, newMessage]
                                };

                                await missionService.updateBlackboard(
                                    missionId,
                                    updatedBlackboard,
                                    "Mission Command",
                                    `Strategic Update`
                                );
                            }
                        }
                    } catch (err) {
                        logger.error(`[Supervisor] Failed to echo status update to chat: ${err}`);
                    }
                }

                // --- Advanced Orchestration: Re-planning & Self-Correction ---
                const maxReplans = 3;
                if ((state === "replanning" || state === "failed") && (plan.replanCount || 0) < maxReplans) {
                    logger.warn(`[Supervisor] ${state.toUpperCase()} detected. Initiating Self-Correction cycle #${(plan.replanCount || 0) + 1}`);

                    const historyContext = plan.history.map((h: any) => `[${h.timestamp}] ${h.type.toUpperCase()}: ${h.observation}`).join("\n");
                    const failedTasks = plan.tasks.filter((t: any) => t.status === "failed" || t.status === "rejected");
                    const failureInfo = failedTasks.map((t: any) => `Task ${t.id} (${t.name}) failed/rejected: ${JSON.stringify(t.output?.error || t.assignedAgentFeedback || "Unknown error")}`).join("\n");

                    const fullHistory = `${historyContext}\n\nRecent Failures:\n${failureInfo}`;

                    // Re-discover capabilities (including recruited mission members)
                    const pipelineIds = new Set<number>(config.allowedPipelines || []);
                    const jobIds = new Set<number>();

                    const [executionMeta] = await db.select({ missionId: pipelineExecutions.missionId })
                        .from(pipelineExecutions)
                        .where(eq(pipelineExecutions.id, targetExecutionId))
                        .limit(1);

                    const missionId = executionMeta?.missionId;

                    if (missionId) {
                        const { missionMembers } = await import("@shared/schema/index.js");
                        const members = await db.select().from(missionMembers).where(eq(missionMembers.missionId, missionId));
                        members.forEach(m => {
                            if (m.entityType === 'pipeline') pipelineIds.add(m.entityId);
                            if (m.entityType === 'job') jobIds.add(m.entityId);
                        });
                    }

                    const pipeIds = Array.from(pipelineIds);
                    const jIds = Array.from(jobIds);

                    let allCapabilities: any[] = [];
                    if (pipeIds.length > 0) {
                        const capabilities = await CapabilityDiscoveryService.discoverCapabilities(pipeIds, orgId || 0);
                        allCapabilities = [...allCapabilities, ...capabilities];
                    }
                    if (jIds.length > 0) {
                        const capabilities = await CapabilityDiscoveryService.discoverJobCapabilities(jIds, orgId || 0);
                        allCapabilities = [...allCapabilities, ...capabilities];
                    }

                    const capabilityCatalog = CapabilityDiscoveryService.formatCapabilityCatalog(allCapabilities);

                    try {
                        const newPlan = await supervisorService.plan(
                            config.intent,
                            config.model,
                            config.credentialId,
                            capabilityCatalog,
                            "", // Knowledge context handled in initial discovery
                            plan,
                            fullHistory,
                            orgId ?? undefined,
                            undefined, // soulPrompt
                            missionId ?? undefined,
                            recordAiUsage
                        );


                        plan = newPlan;
                        state = "planning"; // Reset to planning state for the next tick
                        logger.info(`[Supervisor] Re-plan successful. New tasks: ${plan.tasks.length}`);

                        // In some cases we might want to pause for approval again?
                        if (config.requirePlanApproval) {
                            return {
                                success: true,
                                status: "waiting_external_input",
                                output: JSON.stringify({
                                    _type: "supervisor_plan_approval",
                                    plan,
                                    intent: config.intent,
                                    message: `Supervisor re-planned due to ${state}. Please review the updated plan.`
                                })
                            };
                        }

                        // Continue the loop with the new plan
                        iterations++;
                        continue;
                    } catch (e) {
                        logger.error(`[Supervisor] Re-planning failed`, e);
                        // If re-planning fails, we gracefully degrade to the original failure
                    }
                }

                if (state === "completed" || state === "failed") {
                    break;
                }

                // If waiting for sub-tasks, use event-based triggers instead of polling when configured
                if (state === "waiting") {
                    logger.info(`[Supervisor] Waiting for sub-tasks. Suspension triggered.`);
                    
                    try {
                        const { SUPERVISOR_CONFIG } = await import("../../../../config/jobs/supervisor.config.js");
                        
                        if (SUPERVISOR_CONFIG.useEventDriven) {
                            const { streamingLogsService } = await import("@domain/jobs/core/streaming-logs.service.js");
                            
                            logger.info(`[Supervisor] Blocking execution, awaiting events on ${supervisorChannelId}...`);
                            
                            await new Promise<void>(async (resolve) => {
                                let isResolved = false;
                                let unsubscribe: () => void = () => {};
                                
                                const timeout = setTimeout(() => {
                                    if (!isResolved) {
                                        isResolved = true;
                                        logger.warn('[Supervisor] Event-driven execution timeout, falling back to polling cycle');
                                        unsubscribe();
                                        resolve();
                                    }
                                }, SUPERVISOR_CONFIG.eventTimeoutMs || 30000);
                                
                                unsubscribe = await streamingLogsService.subscribeToEvents(
                                    supervisorChannelId,
                                    ['task_completed', 'task_failed'],
                                    (event: any) => {
                                        if (!isResolved) {
                                            isResolved = true;
                                            clearTimeout(timeout);
                                            logger.info(`[Supervisor] Received sub-task completion event: ${event.eventType} for step ${event.stepId}`);
                                            unsubscribe();
                                            resolve();
                                        }
                                    }
                                );
                            });
                            
                            // Re-evaluate the plan in the next iteration
                            iterations++;
                            continue;
                        }
                    } catch (err) {
                        logger.error("[Supervisor] Failed to load supervisor config or use event-driven polling", err);
                    }

                    // Fallback to suspension
                    return {
                        success: true,
                        status: "waiting_async",
                        output: JSON.stringify(plan),
                        externalId: `supervisor-wait-${targetExecutionId}-${iterations}`
                    };
                }

                iterations++;
            }

            if (state === "failed" || iterations >= maxIterations) {
                const errorTask = plan.tasks.find((t: any) => t.status === "failed");
                const historyStr = plan.history.map((h: any) => `[${h.timestamp}] ${h.type.toUpperCase()}: ${h.observation}`).join("\n");

                try {
                    logger.info(`[Supervisor] Terminal failure detected. Initiating Triage...`);
                    const triage = await supervisorService.triage(config.intent, historyStr, orgId || undefined, missionId || undefined, recordAiUsage);

                    const failureInfo = `Terminal failure at iterations ${iterations}. Last error: ${errorTask?.output?.error || "Timeout"}`;

                    if (missionId) {
                        const { missionService } = await import("@domain/mission/core/mission.service.js");
                        const current = await missionService.getMissionDetail(missionId);
                        const blackboard = (current?.blackboard as any) || {};

                        await missionService.updateBlackboard(
                            missionId,
                            {
                                ...blackboard,
                                rescue_recommendation: triage.recommendation,
                                recovery_action: triage.action,
                                recovery_metadata: triage.metadata,
                                failure_info: failureInfo
                            },
                            "Mission Commander",
                            `Terminal Failure Triage: ${triage.action}`
                        );

                        logger.info(`[Supervisor] Rescue recommendation for Mission ${missionId}: ${triage.action} — ${triage.recommendation}`);
                    }

                    // Raise HIL for replan — user must approve the proposed strategy pivot
                    // before the mission re-executes. Auto-retry/skip/relax don't need a gate.
                    if (triage.action === "replan") {
                        logger.warn(`[Supervisor] Triage requires replan — raising HIL for user approval`);

                        let approverId: string | null = null;
                        let approverEmail = "system@oddjob.ai";
                        if (userId && userId !== "supervisor-executor") {
                            const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
                            if (user) {
                                approverId = user.id;
                                approverEmail = user.email || approverEmail;
                            }
                        }

                        const token = generateExternalToken({
                            executionId: String(stepExecutionId || 0),
                            formId: 0,
                            email: approverEmail,
                            role: "internal"
                        });

                        await db.insert(approvalRequests).values({
                            executionId: String(stepExecutionId || 0),
                            jobId: job.id,
                            approverType: "internal",
                            approverId,
                            approverEmail,
                            status: "pending",
                            token,
                            missionId: missionId ?? null,
                            // Persist the triage context so the REVIEW CONTEXT tab shows the
                            // proposed strategy pivot (modifiedOutput → contextSnapshot).
                            modifiedOutput: {
                                _type: "supervisor_triage_approval",
                                recommendation: triage.recommendation,
                                action: triage.action,
                                metadata: triage.metadata,
                                failureInfo,
                                intent: config.intent,
                                description: `Mission self-healing requires your approval: ${triage.recommendation}`,
                                message: `Mission self-healing requires your approval: ${triage.recommendation}`,
                            },
                        });

                        return {
                            success: true,
                            status: "waiting_external_input",
                            output: JSON.stringify({
                                _type: "supervisor_triage_approval",
                                recommendation: triage.recommendation,
                                action: triage.action,
                                metadata: triage.metadata,
                                failureInfo,
                                intent: config.intent,
                                message: `Mission self-healing requires your approval: ${triage.recommendation}`
                            })
                        };
                    }
                } catch (triageErr) {
                    logger.error(`[Supervisor] Triage failed: ${triageErr}`);
                }

                return {
                    success: false,
                    status: "failure",
                    error: `Supervisor plan failed: ${errorTask?.output?.error || "Timeout"}`,
                    output: JSON.stringify(plan, null, 2)
                };
            }

            if (config.saveOutputToFile) {
                try {
                    const { fileStorageSuccess } = await import("@domain/knowledge/index.js");
                    const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 12); // YYYYMMDDHHMM
                    const jobNameSafe = job.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
                    const folderName = `${jobNameSafe}_${timestamp}`;

                    const baseDir = config.screenshotDirectory || 'extractions';
                    const orgId = job.organizationId || null;

                    const fileName = `output.json`;
                    const filePath = path.join(baseDir, folderName, fileName);
                    const content = JSON.stringify(plan, null, 2);
                    await fileStorageSuccess.saveFile(orgId, filePath, content);

                    console.log(`[SupervisorJobExecutor] Saved output to ${path.join(baseDir, folderName)}`);
                } catch (err: any) {
                    logger.error(`[Supervisor] Failed to save output to file: ${err.message}`);
                }
            }

            return {
                success: true,
                status: "success",
                output: JSON.stringify(plan, null, 2),
                telemetry: {
                    iterations,
                    task_count: plan.tasks.length,
                    intent: config.intent
                }
            };

        } catch (error: any) {
            logger.error(`[Supervisor] Critical Error: ${error.message}`, error);
            return {
                success: false,
                status: "failure",
                error: `Supervisor Execution Error: ${error.message}`,
                output: ""
            };
        }
    }
}

/**
 * Folds the step's LLM calls into the `__aiUsageMetadata` that AIAnalyticsHook reads.
 *
 * Calls are grouped by provider+model rather than summed into one bucket: a step that
 * plans on one model and triages on another would otherwise have all of its tokens
 * priced at whichever model happened to be named, which is how a cost panel ends up
 * confidently wrong. No calls means no property at all — an empty usage row is worse
 * than none, because it reads as "this step cost $0".
 */
export function attachAiUsage(result: StepExecutionResult, usage: AiCallUsage[]): StepExecutionResult {
    if (!result || usage.length === 0) return result;

    const grouped = new Map<string, AiCallUsage>();
    for (const call of usage) {
        const key = `${call.provider}::${call.model}`;
        const existing = grouped.get(key);
        if (existing) {
            existing.promptTokens += call.promptTokens;
            existing.completionTokens += call.completionTokens;
        } else {
            grouped.set(key, { ...call });
        }
    }

    (result as any).__aiUsageMetadata = [...grouped.values()];
    return result;
}
