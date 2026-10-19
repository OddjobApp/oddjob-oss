import { db, pool } from "@server/database_service.js";
import { 
    missions, 
    missionRuns, 
    pipelines, 
    pipelineSteps, 
    jobs, 
    pipelineInputParams,
    missionMembers,
    agentDeployments,
    schedules,
    ragAssets,
    missionRagAssets,
    orgs,
    hilForms,
    documentTemplates,
    credentials,
    missionTemplates,
    appDeployments,
    missionAgentAssignments
} from "@shared/schema/index.js";
import { executionStrategies, isExecutionStrategy } from "@shared/schema/missions/core.js";
import { eq, and, isNull, sql, inArray, asc, or } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { getSystemOrgContext } from "@server/utils/auth-context.js";
import { NotFoundError } from "@server/utils/errors.js";
import crypto from "node:crypto";
import { SkillManager } from "../../agents/core/skill-manager.js";
import { systemAiService } from "../../ai/core/system-ai.service.js";
import { AIClientFactory } from "@domain/ai/core/ai-client.service.js";
import { MISSION_ARCHITECT_PROMPT } from "./prompts.js";
import { DEFAULT_BUDGET_LIMIT } from "../utils/mission-types.js";
import { eventStream } from "../../core/infrastructure/event-stream.service.js";
import { POD_EVENTS } from "../../core/infrastructure/pod-events.contract.js";
import { topicService } from "@domain/knowledge/core/topic-service.js";
import { buildCycleInputBriefing } from "@shared/cycle-inputs.js";

const logger = createLogger("MissionExecutionService");

export class MissionExecutionService {
    /**
     * Launch a mission with full orchestration (proxies, billing, analytics, etc).
     */
    async launchMission(missionId: number, userId: string, orgId: number | null, existingRunId?: number, parentId?: number, metadata?: any): Promise<{ success: boolean; executionId?: number; missionRunId?: number; missionId?: number; error?: string }> {
        console.log(`>>> MissionExecutionService.launchMission called for mission ${missionId}, user ${userId}, org ${orgId} <<<`);
        const { missionQueryService } = await import("./mission-query.service.js");
        const mission = await missionQueryService.getMissionDetail(missionId);
        if (!mission) {
            return { success: false, error: "Mission not found" };
        }

        // The mission is loaded by id alone, and `orgId` was only ever used to
        // scope the work that follows — nothing compared the two. So a caller
        // that could name a mission id could launch another tenant's mission,
        // with this service's own org argument deciding where the resulting
        // agents, spend and artifacts landed. Reached in practice through the
        // SaaS event workflow: POST /event-workflows accepted any numeric
        // workflow id and the orchestrator launched it as `system`.
        //
        // Only a definite mismatch is refused. missions.organization_id is
        // nullable and several callers pass null deliberately — a scheduled or
        // platform-level mission has no tenant to compare against — so
        // requiring equality outright would break those rather than secure
        // them. A mission that belongs to one organization being launched in
        // the name of another is the case that cannot be legitimate.
        const missionOrgId = (mission as any).organizationId as number | null | undefined;
        if (missionOrgId != null && orgId != null && missionOrgId !== orgId) {
            logger.error(
                `[MissionExecution] Refused to launch mission ${missionId}: it belongs to organization ` +
                `${missionOrgId} but was launched in the context of organization ${orgId}.`,
            );
            return { success: false, error: "Mission not found" };
        }

        // Ticket identity belongs to this launch, not the reusable template.
        const jiraKey = metadata?.jiraKey || metadata?.context?.jiraKey;

        const objective = mission.objective;
        if (!objective || String(objective).trim() === "" || String(objective) === "undefined") {
            return {
                success: false,
                error: "Mission has no objective. Edit the mission and set a clear mission objective before launching."
            };
        }

        const blackboard = (mission.blackboard as any) || {};
        const lastGuidance = blackboard.lastUserGuidance;
        const inputBriefing = buildCycleInputBriefing((blackboard.ground_truth as Record<string, any>) || {});
        const wavePlan = blackboard.wavePlan || blackboard.ground_truth?.wavePlan || metadata?.wavePlan;
        const waveBriefing = Array.isArray(wavePlan?.acceptanceCriteria) && wavePlan.acceptanceCriteria.length > 0
            ? `\nWave Acceptance Criteria:\n${wavePlan.acceptanceCriteria.map((c: string) => `- ${c}`).join("\n")}`
            : "";
        const intent = String(objective).trim()
            + (lastGuidance?.content ? ` User directive: ${lastGuidance.content}` : "")
            + inputBriefing
            + waveBriefing;
        
        const baseContext = {
            ...blackboard,
            intent,
            userId,
            ...metadata,
            externalTicketId: typeof jiraKey === "string" ? jiraKey : (mission as any).externalTicketId,
        };

        // --- EXECUTION STRATEGY VALIDATION ---
        // Each strategy below dispatches from its own `if` and returns, so an
        // unrecognized value would fall past all of them into the pre-planned
        // path — running a mission under a strategy nobody chose, and reporting
        // success. Fail loudly instead; the column is untyped text, so this is
        // the only place the value is checked.
        if (!isExecutionStrategy(mission.executionStrategy)) {
            const message =
                `Unknown execution strategy "${mission.executionStrategy}" on mission ${missionId}. ` +
                `Expected one of: ${executionStrategies.join(", ")}.`;
            logger.error(`[MissionExecution] ${message}`);
            return { success: false, error: message };
        }

        // --- LLM COMPILER ROUTING ---
        if (mission.executionStrategy === "llm_compiler") {
            try {
                const { LLMCompilerOrchestratorService } = await import("./orchestration/llm-compiler-orchestrator.service.js");
                const { AgentDeploymentService } = await import("../../agents/agent-deployment.service.js");
                // The compiler plans against this organization's agent roster.
                // `orgId || 1` planned a mission that had no organization using
                // organization 1's deployments — another tenant's agents, chosen
                // silently. listDeployments takes a required number and filters
                // with eq(), so there is no correct null behaviour to fall back
                // on; refuse the strategy the way an unknown strategy is refused
                // above.
                if (orgId == null) {
                    const message =
                        `Mission ${missionId} has no organization, so the llm_compiler strategy ` +
                        `cannot resolve an agent roster. No agents were selected.`;
                    logger.error(`[MissionExecution] ${message}`);
                    return { success: false, error: message };
                }
                const availableAgents = await AgentDeploymentService.listDeployments(orgId);

                const executeStepFn = async (step: any) => {
                    logger.info(`[MissionExecution] Executing step ${step.id} via agent ${step.agentId}`);
                };

                await LLMCompilerOrchestratorService.executePlan(
                    missionId,
                    objective,
                    availableAgents.map(a => ({ id: String(a.id), name: a.name })),
                    executeStepFn
                );
                return { success: true, missionId };
            } catch (err: any) {
                logger.error(`Failed to launch LLM Compiler orchestrator: ${err.message}`);
                return { success: false, error: err.message };
            }
        }

        // --- DYNAMIC ORCHESTRATOR ROUTING ---
        if (mission.executionStrategy === "dynamic_autonomous") {
            try {
                const { dynamicOrchestratorService } = await import("./dynamic-orchestrator.service.js");
                // Integrate tool discovery for dynamic missions
                const { toolCapabilityIndex } = await import("../../agents/core/tool-discovery/index.js");
                const matches = await toolCapabilityIndex.findTools({ 
                    description: intent,
                    requiredCapabilities: []
                });
                const discoveredTools = matches.map(m => m.tool.name);
                const missionContext = { ...baseContext, discoveredTools };

                return await dynamicOrchestratorService.launchDynamicMission(missionId, userId, orgId, missionContext, parentId);
            } catch (err: any) {
                logger.error(`Failed to launch dynamic orchestrator: ${err.message}`);
                return { success: false, error: err.message };
            }
        }

        // --- ROLLING WAVE (VIBECODING) ROUTING ---
        if (mission.executionStrategy === "rolling_wave") {
            try {
                const { rollingWaveOrchestratorService } = await import("./rolling-wave-orchestrator.service.js");
                return await rollingWaveOrchestratorService.launchMission(missionId, userId, orgId);
            } catch (err: any) {
                logger.error(`Failed to launch rolling wave orchestrator: ${err.message}`);
                return { success: false, error: err.message };
            }
        }

        // --- HUMAN-DRIVEN ROUTING ---
        if (mission.executionStrategy === "human_driven") {
            try {
                const { humanDrivenOrchestratorService } = await import("./human-driven-orchestrator.service.js");
                return await humanDrivenOrchestratorService.launchMission(missionId, userId, orgId);
            } catch (err: any) {
                logger.error(`Failed to launch human-driven orchestrator: ${err.message}`);
                return { success: false, error: err.message };
            }
        }

        // --- PARALLEL FAN-OUT ROUTING ---
        if (mission.executionStrategy === "parallel_fan_out") {
            try {
                const { parallelFanOutOrchestratorService } = await import("./parallel-fan-out-orchestrator.service.js");
                return await parallelFanOutOrchestratorService.launchMission(missionId, userId, orgId, parentId);
            } catch (err: any) {
                logger.error(`Failed to launch parallel fan-out orchestrator: ${err.message}`);
                return { success: false, error: err.message };
            }
        }

        // --- REACTIVE (EVENT-DRIVEN) ROUTING ---
        if (mission.executionStrategy === "reactive") {
            try {
                const { reactiveOrchestratorService } = await import("./reactive-orchestrator.service.js");
                return await reactiveOrchestratorService.launchMission(missionId, userId, orgId);
            } catch (err: any) {
                logger.error(`Failed to launch reactive orchestrator: ${err.message}`);
                return { success: false, error: err.message };
            }
        }

        // --- RESOLVE MISSION MEMBERS (Pipelines & Jobs) ---
        const memberEntities = (mission.members || []) as any[];
        const resolvedPipelineIds: number[] = [];
        const agents: { id: number; name: string; role: string; type: string }[] = [];

        // Batch-load all pipelines and jobs referenced by members in two queries
        const memberPipelineIds = memberEntities.filter(m => m.entityType === "pipeline").map(m => m.entityId);
        const memberJobIds = memberEntities.filter(m => m.entityType === "job").map(m => m.entityId);

        const [batchPipelines, batchJobs] = await Promise.all([
            memberPipelineIds.length > 0
                ? db.select({ id: pipelines.id, name: pipelines.name }).from(pipelines).where(inArray(pipelines.id, memberPipelineIds))
                : Promise.resolve([]),
            memberJobIds.length > 0
                ? db.select().from(jobs).where(inArray(jobs.id, memberJobIds))
                : Promise.resolve([]),
        ]);

        const pipelineMap = new Map(batchPipelines.map(p => [p.id, p]));
        const jobMap = new Map(batchJobs.map(j => [j.id, j]));

        for (const m of memberEntities) {
            if (m.entityType === "pipeline") {
                resolvedPipelineIds.push(m.entityId);
                const p = pipelineMap.get(m.entityId);
                agents.push({ id: m.entityId, name: p?.name || `Pipeline ${m.entityId}`, role: m.role, type: "pipeline" });
            } else if (m.entityType === "job") {
                const job = jobMap.get(m.entityId);
                if (job) {
                    const proxyName = `[Agent Proxy] ${job.name}`;
                    let [proxy] = await db.select().from(pipelines).where(and(eq(pipelines.name, proxyName), orgId ? eq(pipelines.organizationId, orgId) : isNull(pipelines.organizationId))).limit(1);

                    if (!proxy) {
                        const [newProxy] = await db.insert(pipelines).values({
                            name: proxyName,
                            description: `Automatically created proxy for agent: ${job.name}`,
                            triggerType: "manual",
                            organizationId: orgId,
                            createdBy: userId,
                            labels: { isProxy: true, jobId: job.id }
                        }).returning();

                        if (newProxy) {
                            await db.insert(pipelineSteps).values({
                                pipelineId: newProxy.id,
                                jobId: job.id,
                                order: 0,
                                outputName: "final_product"
                            });
                            proxy = newProxy;
                        }
                    }

                    if (proxy) {
                        resolvedPipelineIds.push(proxy.id);
                        agents.push({ id: proxy.id, name: job.name, role: m.role, type: "agent" });
                    }
                }
            }
        }

        const pipelineIds = [...new Set(resolvedPipelineIds)];

        // --- WORKFLOW BLUEPRINT RESOLUTION ---
        // For pre_planned missions provisioned from a cycle YAML, the workflowBlueprint
        // contains the backing pipeline ID. Use it directly as the execution pipeline
        // when no members supply explicit pipeline IDs.
        const workflowBlueprint = (mission as any).workflowBlueprint as { pipelineId?: number } | null;
        if (mission.executionStrategy === "pre_planned" && workflowBlueprint?.pipelineId && pipelineIds.length === 0) {
            pipelineIds.push(workflowBlueprint.pipelineId);
            logger.info(`[MissionExecution] Using workflowBlueprint pipeline ${workflowBlueprint.pipelineId} for pre_planned mission ${missionId}`);
        }

        const [supervisorStep] = await db
            .select({ pipelineId: pipelines.id, jobId: pipelineSteps.jobId })
            .from(pipelineSteps)
            .innerJoin(pipelines, eq(pipelineSteps.pipelineId, pipelines.id))
            .innerJoin(jobs, eq(pipelineSteps.jobId, jobs.id))
            .where(and(
                eq(jobs.type, "supervisor"),
                orgId != null ? or(eq(pipelines.organizationId, orgId), isNull(pipelines.organizationId)) : isNull(pipelines.organizationId)
            ))
            .orderBy(asc(pipelines.id))
            .limit(1);

        let supervisorPipelineId: number | null = supervisorStep?.pipelineId ?? null;

        if (mission.executionStrategy === "pre_planned" && pipelineIds.length > 0) {
            supervisorPipelineId = pipelineIds[0];
        }

        if (!supervisorPipelineId) {
            // Attempt auto-creation of supervisor pipeline
            logger.info(`[MissionExecution] No supervisor pipeline found for org ${orgId}, attempting auto-creation...`);
            supervisorPipelineId = await this.ensureSupervisorPipelineForOrg(orgId, userId);
            
            if (!supervisorPipelineId) {
                return {
                    success: false,
                    error: "No supervisor pipeline found and auto-creation failed. Please ensure AI credentials are configured."
                };
            }
            
            logger.info(`[MissionExecution] Auto-created supervisor pipeline ${supervisorPipelineId}`);
        }

        const { missionRunService } = await import("./mission-run.service.js");
        const { pipelineExecutor } = await import("@server/core/pipeline-executor.js");

        const initialSequence = (mission.executionStrategy === "pre_planned" && pipelineIds.length > 0) 
            ? pipelineIds 
            : [supervisorPipelineId];

        // Initialize mission context with blackboard for pre-planned execution
        const missionContext = {
            ...blackboard, // Merge mission blackboard for shared state
            intent,
            executionStrategy: 'pre_planned',
            allowedPipelineIds: pipelineIds,
            agents,
            ...metadata,
            externalTicketId: typeof jiraKey === "string" ? jiraKey : (mission as any).externalTicketId,
        };

        const run = await missionRunService.create({
            missionId,
            organizationId: orgId ?? undefined,
            name: mission.name,
            pipelineSequence: initialSequence,
            createdBy: userId,
            currentPipelineId: supervisorPipelineId,
            isShadow: (mission as any).isShadowMode || false,
            parentId: parentId,
            missionContext
        });

        // ── Mission Agent Assignment ─────────────────────────────────────────
        // Record which agent deployments are participating in this run
        try {
            const primaryJobIds = memberEntities
                .filter(m => m.entityType === "job" && m.role === "primary")
                .map(m => m.entityId);

            // If no explicit primary, fall back to first job member
            if (primaryJobIds.length === 0) {
                const firstJobMember = memberEntities.find(m => m.entityType === "job");
                if (firstJobMember) primaryJobIds.push(firstJobMember.entityId);
            }

            if (primaryJobIds.length > 0) {
                const deployments = await db.select()
                    .from(agentDeployments)
                    .where(inArray(agentDeployments.jobId, primaryJobIds));

                for (const deployment of deployments) {
                    const legendHash = deployment.legend
                        ? crypto.createHash("sha256").update(deployment.legend).digest("hex").slice(0, 16)
                        : null;

                    const configSnapshot = {
                        oceanTraits: deployment.oceanTraits || { o: 0.5, c: 0.5, e: 0.5, a: 0.5, n: 0.5 },
                        legendHash,
                        soulArchetype: deployment.soulArchetype || "Lead Directive",
                    };

                    await db.insert(missionAgentAssignments)
                        .values({
                            missionRunId: run.id,
                            agentDeploymentId: deployment.id,
                            role: "primary",
                            configSnapshot,
                        })
                        .onConflictDoUpdate({
                            target: [missionAgentAssignments.missionRunId, missionAgentAssignments.agentDeploymentId],
                            set: { configSnapshot },
                        });

                    logger.info(`[MissionExecution] Assigned agent deployment ${deployment.id} (${deployment.slug}) to run ${run.id}`);
                }

                if (deployments.length === 0) {
                    logger.warn(`[MissionExecution] No agent deployments found for primary job IDs [${primaryJobIds.join(", ")}] — skipping assignment`);
                }
            }
        } catch (assignErr: any) {
            logger.warn(`[MissionExecution] Failed to record agent assignment (non-fatal): ${assignErr.message}`);
        }

        // ── Workspace Provisioning (for coding missions) ─────────────────────
        // Runs after run creation so we have a real run.id to pass.
        try {
            const { workspaceProvisioningService } = await import("./workspace-provisioning.service.js");
            const templateConfig = (mission as any).workflowBlueprint || {};
            if (workspaceProvisioningService.needsWorkspace(templateConfig) ||
                (mission.executionStrategy === "pre_planned" && mission.workspacePath == null)) {
                const provisionResult = await workspaceProvisioningService.provision(missionId, run.id, orgId);
                if (!provisionResult.success) {
                    logger.warn(`[MissionExecution] Workspace provisioning failed: ${provisionResult.error}. Continuing without workspace.`);
                } else {
                    logger.info(`[MissionExecution] Workspace provisioned at ${provisionResult.workspacePath} (branch: ${provisionResult.branch})`);
                }
            }
        } catch (wpErr: any) {
            logger.warn(`[MissionExecution] Workspace provisioning error (non-fatal): ${wpErr.message}`);
        }

        const groundTruth = (blackboard.ground_truth as Record<string, any>) || {};
        const input = {
            intent,
            ground_truth: groundTruth,
            inputContract: groundTruth.inputContract,
            data: {
                intent,
                externalTicketId: missionContext.externalTicketId,
                ground_truth: groundTruth,
                inputContract: groundTruth.inputContract,
                allowedPipelineIds: pipelineIds,
                agents,
                userId,
                missionId,
                missionRunId: run.id,
            },
        };
        console.log(`[MissionExecution] Launching pipeline ${supervisorPipelineId} for run ${run.id}...`);
        pipelineExecutor.executePipeline(
            supervisorPipelineId,
            userId,
            undefined,
            null,
            input,
            undefined,
            undefined,
            missionId,
            run.id
        ).catch((err: any) => logger.error(`[MissionExecution] Pipeline ${supervisorPipelineId} for run ${run.id} failed: ${err.message}`));

        return { success: true, missionRunId: run.id };
    }

    /**
     * Advance a mission run to the next pipeline in its sequence.
     */
    async advanceSequence(missionRunId: number): Promise<void> {
        const { missionRunService } = await import("./mission-run.service.js");
        const { pipelineExecutor } = await import("@server/core/pipeline-executor.js");

        const run = await missionRunService.getById(missionRunId);
        if (!run || run.status !== "active") return;

        const sequence = (run.pipelineSequence as number[]) || [];
        const nextIndex = (run.currentStepIndex ?? 0) + 1;

        if (nextIndex >= sequence.length) {
            await missionRunService.update(missionRunId, { status: "completed" });
            
            // Notify other pods that the run is complete
            eventStream.publish(POD_EVENTS.MISSION.RUN_COMPLETED, {
                missionRunId,
                missionId: run.missionId,
                organizationId: run.organizationId,
                isShadow: run.isShadow,
                // If it was launched via an app, we need the appSlug
                // For now, checking if there's an appSlug in the missionContext
                appSlug: (run.missionContext as any)?.appSlug || null
            }, {
                organizationId: run.organizationId,
                subject: `mission_run:${missionRunId}`
            }, "mission_execution");
            
            return;
        }

        const nextPipelineId = sequence[nextIndex];

        // Budget re-check before advancing to next pipeline
        if (run.missionId) {
            try {
                const { missionQueryService } = await import("./mission-query.service.js");
                const [missionData] = await db.select().from(missions).where(eq(missions.id, run.missionId)).limit(1);
                const currentSpend = await missionQueryService.calculateTotalSpend(run.missionId);
                const budgetLimit = missionData?.budgetLimitUsd ? parseFloat(String(missionData.budgetLimitUsd)) : DEFAULT_BUDGET_LIMIT;
                if (currentSpend > budgetLimit) {
                    logger.warn(`[MissionExecution] Budget exceeded before advancing sequence: $${currentSpend.toFixed(2)} > $${budgetLimit.toFixed(2)}`);
                    await missionRunService.update(missionRunId, { status: "failed" });
                    return;
                }
            } catch (budgetErr: any) {
                logger.warn(`[MissionExecution] Budget check failed during advance: ${budgetErr.message}`);
            }
        }

        await missionRunService.update(missionRunId, {
            currentStepIndex: nextIndex,
            currentPipelineId: nextPipelineId
        });

        pipelineExecutor.executePipeline(
            nextPipelineId,
            run.createdBy || "system",
            undefined,
            null,
            { data: run.missionContext || {} },
            undefined,
            undefined,
            run.missionId || undefined,
            run.id
        ).catch((err: any) => logger.error(`[MissionExecution] advanceSequence pipeline ${nextPipelineId} for run ${run.id} failed: ${err.message}`));
    }

    /**
     * Re-enter a pre-planned mission run at its CURRENT sequence step.
     *
     * advanceSequence() moves to the next pipeline; resuming is different — the
     * current step stalled and needs running again, so the index is left alone.
     *
     * Exists because resumeMissionRun only had restart branches for rolling_wave,
     * dynamic_autonomous and parallel_fan_out. pre_planned (the overwhelming
     * majority of missions) fell through them all, so a resume flipped the status
     * back to "active", bumped updated_at and queued nothing. The watchdog then
     * re-detected the same run as stale and repeated that forever — 37 times over
     * 9 hours on mission 500 — until it was triaged as failed.
     */
    async resumeSequence(missionRunId: number): Promise<void> {
        const { missionRunService } = await import("./mission-run.service.js");
        const { pipelineExecutor } = await import("@server/core/pipeline-executor.js");

        const run = await missionRunService.getById(missionRunId);
        if (!run || run.status !== "active") return;

        const sequence = (run.pipelineSequence as number[]) || [];
        const currentIndex = run.currentStepIndex ?? 0;
        const currentPipelineId = sequence[currentIndex];

        if (currentPipelineId == null) {
            logger.warn(
                `[MissionExecution] Cannot resume run ${missionRunId}: no pipeline at sequence index ${currentIndex} (sequence length ${sequence.length}).`
            );
            return;
        }

        // Same budget gate advanceSequence applies, so a resume cannot push an
        // already-overspent mission further.
        if (run.missionId) {
            try {
                const { missionQueryService } = await import("./mission-query.service.js");
                const [missionData] = await db.select().from(missions).where(eq(missions.id, run.missionId)).limit(1);
                const currentSpend = await missionQueryService.calculateTotalSpend(run.missionId);
                const budgetLimit = missionData?.budgetLimitUsd ? parseFloat(String(missionData.budgetLimitUsd)) : DEFAULT_BUDGET_LIMIT;
                if (currentSpend > budgetLimit) {
                    logger.warn(`[MissionExecution] Budget exceeded before resuming sequence: $${currentSpend.toFixed(2)} > $${budgetLimit.toFixed(2)}`);
                    await missionRunService.update(missionRunId, { status: "failed" });
                    return;
                }
            } catch (budgetErr: any) {
                logger.warn(`[MissionExecution] Budget check failed during resume: ${budgetErr.message}`);
            }
        }

        await missionRunService.update(missionRunId, { currentPipelineId });

        logger.info(
            `[MissionExecution] Resuming run ${missionRunId} at sequence step ${currentIndex} (pipeline ${currentPipelineId}).`
        );

        pipelineExecutor.executePipeline(
            currentPipelineId,
            run.createdBy || "system",
            undefined,
            null,
            { data: run.missionContext || {} },
            undefined,
            undefined,
            run.missionId || undefined,
            run.id
        ).catch((err: any) => logger.error(`[MissionExecution] resumeSequence pipeline ${currentPipelineId} for run ${run.id} failed: ${err.message}`));
    }

    /**
     * AI-based mission planning.
     */
    async planMission(prompt: string, userId: string, orgId: number, history: any[] = []) {
        const { governorService } = await import("../../governor/core/governor-service.js");
        const recommendation = await governorService.recommendExecutionStrategy({ objective: prompt, organizationId: orgId });
        logger.info(`[MissionPlanning] Governor recommends strategy: ${recommendation.strategy} (${recommendation.reason})`);

        const availableResources = await Promise.all([
            db.select().from(jobs).where(and(eq(jobs.organizationId, orgId), eq(jobs.isActive, true))),
            import("../../tools/v1/tool-registry.service.js").then(m => m.AGENT_TOOLS),
            topicService.listTopics(getSystemOrgContext(orgId)),
            topicService.listDatasets(getSystemOrgContext(orgId)),
            db.select().from(hilForms).where(and(eq(hilForms.organizationId, orgId), eq(hilForms.kind, "template"), eq(hilForms.isArchived, false))),
            db.select().from(documentTemplates).where(eq(documentTemplates.organizationId, orgId)),
            db.select().from(credentials).where(or(eq(credentials.organizationId, orgId), isNull(credentials.organizationId)))
        ]);

        const [jobsRaw, toolsRaw, knowledge, data, forms, docs, creds] = availableResources;
        const historyContext = history.map(h => ({ content: h.prompt + " " + JSON.stringify(h.response) }));
        const prunedJobs = SkillManager.pruneJobs(prompt, historyContext, jobsRaw as any[]);
        
        const aiConfig = await systemAiService.getAiConfig('copilot', orgId);
        if (!aiConfig?.apiKey) throw new Error("AI provider not configured");

        const aiClient = AIClientFactory.getClient({ provider: aiConfig.provider, baseUrl: aiConfig.baseUrl } as any);
        const systemPrompt = MISSION_ARCHITECT_PROMPT
            .replace("{{jobs}}", prunedJobs.map((j: any) => `- [${j.id}] ${j.name}: ${j.description}`).join('\n'))
            .replace("{{tools}}", Object.values(toolsRaw).map((t: any) => `- ${t.name}: ${t.description}`).join('\n'))
            .replace("{{knowledge}}", knowledge.map((k: any) => `- [ID: ${k.id}] ${k.name}`).join('\n'))
            .replace("{{datasets}}", data.map((d: any) => `- [ID: ${d.id}] ${d.name}`).join('\n'))
            .replace("{{forms}}", forms.map((f: any) => `- [ID: ${f.id}] ${f.name}`).join('\n'))
            .replace("{{documents}}", docs.map((d: any) => `- [ID: ${d.id}] ${d.name}`).join('\n'))
            + `\n\nGOVERNANCE ADVISORY: The Governor subsystem recommends the '${recommendation.strategy}' execution strategy for this mission. Reason: ${recommendation.reason}`;

        let attempt = 0;
        const maxAttempts = 3;
        // Local models (Ollama) are significantly slower than cloud — allow up to 10 minutes.
        const PLAN_TIMEOUT_MS = parseInt(process.env.PLAN_TIMEOUT_MS || "600000", 10);
        let lastError = "";
        let plan: any = {};
        let userPrompt = prompt;

        while (attempt < maxAttempts) {
            attempt++;
            try {
                const response = await Promise.race([
                    aiClient.execute({
                        userPrompt,
                        systemPrompt,
                        model: aiConfig.model,
                        requestType: "json",
                        temperature: 0.7,
                        useCache: false,
                        saveOutputToFile: false
                    }, userPrompt, aiConfig.apiKey),
                    new Promise<any>((_, reject) =>
                        setTimeout(() => reject(new Error(`Mission planning timed out after ${PLAN_TIMEOUT_MS / 1000}s`)), PLAN_TIMEOUT_MS)
                    )
                ]);

                if (!response.success || !response.output) {
                    throw new Error(response.error || "AI Planning failed");
                }

                logger.info(`[MissionPlanning] Received planning response (Attempt ${attempt}). Raw Output Length: ${response.output.length}`);
                logger.debug(`[MissionPlanning] Raw Planning Output: ${response.output}`);

                const raw = (response.output || "{}").replace(/```json|```/g, "").trim();
                plan = JSON.parse(raw);

                // Basic validation: must have name, objective, and members
                if (!plan.name || !plan.objective || !plan.members) {
                    throw new Error("Plan is missing required fields (name, objective, or members)");
                }

                break; // Success!
            } catch (e: any) {
                lastError = e.message;
                logger.warn(`[MissionPlanning] Planning failed (Attempt ${attempt}/${maxAttempts}): ${lastError}`);
                
                if (attempt < maxAttempts) {
                    // Refine prompt for retry
                    userPrompt = `${prompt}\n\nWARNING: Your previous attempt failed validation or parsing: ${lastError}. Please ensure you return a valid JSON mission plan that includes 'name', 'objective', and 'members'.`;
                } else {
                    logger.error("[MissionPlanning] All planning attempts failed.");
                    plan = {}; // Final fallback
                }
            }
        }

        // Force governor's strategy if AI didn't provide one or as a safety fallback
        if (!plan.executionStrategy) {
            plan.executionStrategy = recommendation.strategy;
        }
        return plan;
    }

    /**
     * Ensures a supervisor pipeline exists for the organization.
     */
    async ensureSupervisorPipelineForOrg(orgId: number | null, userId: string, tx?: any): Promise<number | null> {
        const dbClient = tx || db;
        // 1. Already-wired supervisor pipeline?
        const [existing] = await dbClient
            .select({ pipelineId: pipelines.id })
            .from(pipelineSteps)
            .innerJoin(pipelines, eq(pipelineSteps.pipelineId, pipelines.id))
            .innerJoin(jobs, eq(pipelineSteps.jobId, jobs.id))
            .where(and(
                eq(jobs.type, "supervisor"),
                orgId != null ? or(eq(pipelines.organizationId, orgId), isNull(pipelines.organizationId)) : isNull(pipelines.organizationId)
            ))
            .orderBy(asc(pipelines.id))
            .limit(1);
        if (existing) return existing.pipelineId;

        const [cred] = await dbClient.select().from(credentials).where(eq(credentials.type, "ai_provider")).limit(1);
        if (!cred) return null;

        // 2. Reuse an orphaned supervisor job if one exists for this org (jobs_org_name_unique
        //    blocks a fresh insert when a prior run left "Mission Launcher" behind without a pipeline).
        const [orphanJob] = await dbClient.select({ id: jobs.id })
            .from(jobs)
            .where(and(
                eq(jobs.name, "Mission Launcher"),
                eq(jobs.type, "supervisor"),
                orgId != null ? eq(jobs.organizationId, orgId) : isNull(jobs.organizationId)
            ))
            .limit(1);

        let supervisorJobId: number;
        if (orphanJob) {
            supervisorJobId = orphanJob.id;
        } else {
            const [supervisorJob] = await dbClient.insert(jobs).values({
                name: "Mission Launcher",
                type: "supervisor",
                organizationId: orgId,
                createdBy: userId,
                config: { intent: "{{data.intent}}", credentialId: cred.id, model: process.env.MISSION_LAUNCHER_MODEL ?? "gemini-2.0-flash", maxSteps: 20 }
            }).returning();
            supervisorJobId = supervisorJob.id;
        }

        // 3. Reuse an orphaned pipeline shell if present, otherwise create it.
        const [orphanPipeline] = await dbClient.select({ id: pipelines.id })
            .from(pipelines)
            .where(and(
                eq(pipelines.name, "Mission Launcher"),
                orgId != null ? eq(pipelines.organizationId, orgId) : isNull(pipelines.organizationId)
            ))
            .limit(1);

        let pipelineId: number;
        if (orphanPipeline) {
            pipelineId = orphanPipeline.id;
        } else {
            const [launcherPipeline] = await dbClient.insert(pipelines).values({
                name: "Mission Launcher",
                triggerType: "manual",
                organizationId: orgId,
                createdBy: userId
            }).returning();
            pipelineId = launcherPipeline.id;
        }

        await dbClient.insert(pipelineSteps).values({ pipelineId, jobId: supervisorJobId, order: 0, outputName: "mission_summary" });
        return pipelineId;
    }

    /**
     * Trigger a webhook for an app-linked mission completion.
     * @deprecated Use POD_EVENTS.MISSION.RUN_COMPLETED event instead. 
     * The apps pod now handles this via its own listener.
     */
    async triggerAppWebhook(missionRunId: number, appSlug: string, organizationId: number) {
        logger.info(`[MissionPod] Publishing app webhook trigger event for ${appSlug}`);
        eventStream.publish(POD_EVENTS.MISSION.RUN_COMPLETED, {
            missionRunId,
            appSlug,
            organizationId
        }, {
            organizationId,
            subject: `mission_run:${missionRunId}`
        }, "mission_execution");
    }
}

export const missionExecutionService = new MissionExecutionService();


