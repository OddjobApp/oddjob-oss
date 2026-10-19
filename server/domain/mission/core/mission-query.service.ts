
import { db } from "@server/database_service.js";
import {
  missions,
  missionRuns,
  missionBlackboardHistory,
  missionStepAssignments,
  missionDeliverables,
  missionRagAssets,
  missionDocumentTemplates,
  missionFileAttachments,
  missionTemplates,
  pipelineExecutions,
  pipelineSteps,
  pipelineStepExecutions,
  jobs,
  missionMembers,
  pipelines,
  agentRunSteps,
  approvalRequests,
} from "@shared/schema/index.js";
import { eq, and, desc, isNull, inArray, sql } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { missionTimelineService, TimelineItem } from "./mission-timeline.service.js";
import { IN_FLIGHT_RUN_STATUSES, toInFlightRun, type InFlightRun } from "./in-flight-runs.js";

const logger = createLogger("MissionQueryService");

export class MissionQueryService {
    async getById(missionRunId: number, organizationId?: number): Promise<any | null> {
        const conditions = [eq(missionRuns.id, missionRunId), isNull(missionRuns.deletedAt)];
        if (organizationId != null) {
            conditions.push(eq(missionRuns.organizationId, organizationId));
        }

        const [row] = await db
            .select({
                mission: missionRuns,
                etc: pipelineExecutions.estimatedTimeRemainingMs
            })
            .from(missionRuns)
            .leftJoin(pipelineExecutions, eq(missionRuns.pipelineExecutionId, pipelineExecutions.id))
            .where(and(...conditions))
            .limit(1);

        if (!row) return null;

        const phase = await this.synthesizePhase(row.mission);
        return {
            ...row.mission,
            phase,
            estimatedTimeRemainingMs: row.etc
        };
    }

    async getMissions(organizationId: number, limit = 100, offset = 0) {
        const conditions = [isNull(missions.deletedAt)];
        if (organizationId !== 0) {
            conditions.push(eq(missions.organizationId, organizationId));
        }
        return await db.select({
            id: missions.id,
            name: missions.name,
            objective: missions.objective,
            status: missions.status,
            type: missions.type,
            executionStrategy: missions.executionStrategy,
            organizationId: missions.organizationId,
            createdBy: missions.createdBy,
            createdAt: missions.createdAt,
            updatedAt: missions.updatedAt,
        })
        .from(missions)
        .where(and(...conditions))
        .orderBy(desc(missions.updatedAt))
        .limit(Math.min(limit, 200))
        .offset(offset);
    }

    /**
     * Runs that are executing or waiting, for one organization. Always org-scoped:
     * there is deliberately no "all orgs" form, because this feeds a per-tenant view.
     * Shadow runs are excluded — they are evaluations, not work in flight.
     */
    async listInFlightRuns(organizationId: number, limit = 50): Promise<InFlightRun[]> {
        const rows = await db
            .select({
                id: missionRuns.id,
                missionId: missionRuns.missionId,
                name: missionRuns.name,
                status: missionRuns.status,
                costUsd: missionRuns.costUsd,
                budgetLimitUsd: missions.budgetLimitUsd,
                lastTraceEntry: sql<unknown>`${missionRuns.dynamicTrace} -> -1`,
                lastCheckpointAt: missionRuns.lastCheckpointAt,
                updatedAt: missionRuns.updatedAt,
            })
            .from(missionRuns)
            .leftJoin(missions, eq(missionRuns.missionId, missions.id))
            .where(and(
                eq(missionRuns.organizationId, organizationId),
                inArray(missionRuns.status, [...IN_FLIGHT_RUN_STATUSES]),
                eq(missionRuns.isShadow, false),
                isNull(missionRuns.deletedAt),
            ))
            .orderBy(desc(missionRuns.updatedAt))
            .limit(Math.min(limit, 200));

        const now = Date.now();
        return rows
            .map((row) => toInFlightRun(row, now))
            .filter((run): run is InFlightRun => run !== null);
    }

    async getMissionDetail(missionId: number) {
        const [mission] = await db.select().from(missions).where(eq(missions.id, missionId)).limit(1);
        if (!mission) return null;
        
        const members = await db.select().from(missionMembers).where(eq(missionMembers.missionId, missionId));
        const runs = await this.listRuns(missionId);
        
        return { ...mission, members, runs };
    }

    async calculateTotalSpend(missionId: number) {
        const result = await db.select({ total: sql<string>`sum(cost_usd)` })
            .from(missionRuns)
            .where(and(eq(missionRuns.missionId, missionId), isNull(missionRuns.deletedAt)));
        return parseFloat(result[0]?.total || '0');
    }

    async listRuns(missionId?: number) {
        const conditions = [isNull(missionRuns.deletedAt)];
        if (missionId != null) {
            conditions.push(eq(missionRuns.missionId, missionId));
        }
        return await db.select().from(missionRuns).where(and(...conditions)).orderBy(desc(missionRuns.createdAt)).limit(100);
    }

    async getActivity(missionId: number) {
        logger.info(`[getActivity] Fetching activity for mission ${missionId}`);

        // 1. Get mission runs with pipeline info
        const runs = await db
            .select({
                run: missionRuns,
                pipeline: pipelines,
            })
            .from(missionRuns)
            .leftJoin(pipelines, eq(missionRuns.currentPipelineId, pipelines.id))
            .where(and(
                eq(missionRuns.missionId, missionId),
                isNull(missionRuns.deletedAt)
            ))
            .orderBy(desc(missionRuns.createdAt))
            .limit(20);

        // 2. Get granular agent run steps (telemetry) with job and mission info
        const steps = await db
            .select({
                step: agentRunSteps,
                mission: missions,
                job: jobs,
            })
            .from(agentRunSteps)
            .leftJoin(missions, eq(agentRunSteps.missionId, missions.id))
            .leftJoin(jobs, eq(agentRunSteps.jobId, jobs.id))
            .where(eq(agentRunSteps.missionId, missionId))
            .orderBy(desc(agentRunSteps.createdAt))
            .limit(50);

        // 3. Extract events from dynamic_trace (Rolling Wave pulses)
        const traceEvents: any[] = [];
        for (const { run, pipeline } of runs) {
            if (run.dynamicTrace && Array.isArray(run.dynamicTrace)) {
                for (const trace of (run.dynamicTrace as any[])) {
                    traceEvents.push(this.mapTraceToActivityEvent(trace, run, pipeline));
                }
            }
        }

        // 4. Transform and combine
        const runEvents = runs.map(({ run, pipeline }) => this.mapRunToActivityEvent(run, pipeline));
        const stepEvents = steps.map(({ step, mission, job }) => this.mapStepToActivityEvent(step, mission, job));

        const activity = [...runEvents, ...stepEvents, ...traceEvents]
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
            .slice(0, 50);

        logger.info(`[getActivity] Returning ${activity.length} activity items`);
        return activity;
    }

    async listGlobalActivity(orgId: number, timeRange: string = "24h") {
        const rangeMs: Record<string, number> = { "1h": 3_600_000, "24h": 86_400_000, "7d": 604_800_000 };
        const since = new Date(Date.now() - (rangeMs[timeRange] ?? rangeMs["24h"]));

        const conditions = [isNull(missionRuns.deletedAt), sql`${missionRuns.createdAt} >= ${since}`];
        if (orgId !== 0) {
            conditions.push(eq(missionRuns.organizationId, orgId));
        }

        // 1. Get recent mission runs across org within the requested time window
        const runs = await db
            .select({
                run: missionRuns,
                pipeline: pipelines,
            })
            .from(missionRuns)
            .leftJoin(pipelines, eq(missionRuns.currentPipelineId, pipelines.id))
            .where(and(...conditions))
            .orderBy(desc(missionRuns.createdAt))
            .limit(50);

        // 2. Get recent agent run steps (telemetry)
        const stepConditions = [];
        if (orgId !== 0) {
            stepConditions.push(eq(agentRunSteps.organizationId, orgId));
        }
        
        const steps = await db
            .select({
                step: agentRunSteps,
                mission: missions,
                job: jobs,
            })
            .from(agentRunSteps)
            .leftJoin(missions, eq(agentRunSteps.missionId, missions.id))
            .leftJoin(jobs, eq(agentRunSteps.jobId, jobs.id))
            .where(and(...stepConditions))
            .orderBy(desc(agentRunSteps.createdAt))
            .limit(100);

        // 3. Transform and combine
        const runEvents = runs.map(({ run, pipeline }) => this.mapRunToActivityEvent(run, pipeline));
        const stepEvents = steps.map(({ step, mission, job }) => this.mapStepToActivityEvent(step, mission, job));

        return [...runEvents, ...stepEvents]
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
            .slice(0, 100);
    }

    private mapRunToActivityEvent(run: any, pipeline: any) {
        let failureReason = run.failureReason;
        
        // If failureReason is null but status is failed, try to find it in the trace
        if (!failureReason && run.status === 'failed' && Array.isArray(run.dynamicTrace)) {
            const failureEvent = (run.dynamicTrace as any[]).find(t => t.status === 'failure' || t.event === 'error');
            if (failureEvent) {
                failureReason = failureEvent.error || failureEvent.note || 
                               (failureEvent.stepName ? `Failed at step: ${failureEvent.stepName}` : 'Unknown orchestration failure');
            } else {
                failureReason = 'Operational timeout or unhandled exception';
            }
        }

        let type = 'mission_started';
        const runName = pipeline?.name || run.name || 'Mission Run';
        let message = `${runName} initiated`;

        if (run.status === 'failed') {
            type = 'error';
            message = failureReason ? `Run Failed: ${failureReason}` : `Run Failed`;
        } else if (run.status === 'completed' || (run.status === 'completed' && run.isSuccess)) {
            type = 'mission_completed';
            message = `${runName} completed successfully`;
        } else if (run.status === 'active') {
            type = 'agent_action';
            message = `${runName} is actively executing`;
        } else if (run.status === 'waiting_on_human') {
            type = 'decision';
            message = `${runName} is awaiting human approval`;
        } else {
            type = 'agent_action';
            message = `${runName} status changed to ${run.status}`;
        }

        return {
            id: run.id,
            type: type,
            message: message,
            missionId: run.missionId,
            missionName: runName,
            timestamp: run.createdAt?.toISOString() ?? new Date().toISOString(),
            status: run.status, // Add status to top level for frontend compatibility
            details: {
                pipelineId: run.currentPipelineId,
                pipelineName: runName,
                runUuid: run.id.toString(),
                content: failureReason
            },
            metadata: {
                status: run.status
            }
        };
    }

    private mapTraceToActivityEvent(trace: any, run: any, pipeline?: any) {
        const runName = pipeline?.name || run.name || 'Mission Run';
        let type = 'agent_action';
        let message = trace.note || trace.event || 'System trace recorded';

        if (trace.type === 'decision') {
            type = 'decision';
            message = `AI decided to run action "${trace.action}"`;
        } else if (trace.type === 'execution') {
            type = trace.success ? 'agent_action' : 'error';
            message = `Action "${trace.action}" executed ${trace.success ? 'successfully' : 'with error: ' + (trace.error || 'unknown error')}`;
        } else {
            switch (trace.type) {
                case 'error': type = 'error'; break;
                case 'critic': type = 'decision'; break;
                case 'strategist': type = 'agent_action'; break;
                case 'system': type = 'knowledge'; break;
                default: type = 'agent_action'; break;
            }
        }

        return {
            id: `trace-${run.id}-${Date.now()}-${Math.random()}`,
            type: type,
            message: message,
            missionId: run.missionId,
            missionName: runName,
            timestamp: trace.timestamp || new Date().toISOString(),
            status: run.status,
            details: {
                stepType: trace.type?.toUpperCase() || 'PULSE',
                tool: trace.tool || trace.action,
                score: trace.score || trace.confidence,
                content: trace.note || trace.event || trace.thought || (trace.params ? JSON.stringify(trace.params) : undefined)
            }
        };
    }

    private mapStepToActivityEvent(step: any, mission: any, job?: any) {
        let type: any = 'agent_action';
        let stepType = step.type?.toUpperCase() || 'STEP';

        // Extract tool name if it's an action
        if (step.type === 'action' && step.content) {
            try {
                const content = typeof step.content === 'string' ? JSON.parse(step.content) : step.content;
                if (content.tool) stepType = content.tool.toUpperCase();
            } catch (e) {
                // Not JSON, fallback to generic ACTION
                stepType = 'ACTION';
            }
        }

        // Map backend step types to UI activity types
        switch (step.type) {
            case 'observation': type = 'knowledge'; break;
            case 'user': type = 'decision'; break;
            case 'final_result': type = 'task_completed'; break;
            case 'thought': type = 'agent_action'; stepType = 'REASONING'; break;
            case 'action': type = 'agent_action'; break;
            default: type = 'agent_action'; break;
        }

        let rawContent = step.content || '';
        let message = rawContent.trim() || 'Executing autonomous step...';
        
        const trimmedMessage = message.trim();
        if (trimmedMessage.startsWith('{') && trimmedMessage.endsWith('}')) {
            try {
                const parsed = JSON.parse(trimmedMessage);
                if (parsed && typeof parsed === 'object') {
                    // Priority fallback for common JSON fields
                    const extracted = (parsed.thought || parsed.action || parsed.observation || parsed.message || parsed.content || '').trim();
                    
                    if (extracted) {
                        message = extracted;
                    } else if (parsed.tool || parsed.tool_call || step.toolName) {
                        const toolName = parsed.tool || parsed.tool_call || step.toolName;
                        message = `Executing tool: ${toolName}`;
                    }
                }
                // Otherwise keep the original JSON string as fallback
            } catch (e) { /* ignore */ }
        }
        
        // Final safety check to ensure it's not blank after all transformations
        if (!message || message.trim().length === 0) {
            message = step.type === 'action' ? 'Autonomous action executed' : 'Autonomous system event';
        }

        if (message.length > 200) {
            message = message.substring(0, 197) + '...';
        }

        const jobName = job?.name || 'Autonomous Step';

        return {
            id: `step-${step.id}`,
            type: 'agent_step', // Force 'agent_step' for MissionActivity.tsx compatibility
            uiType: type,       // Keep the granular type for ActivityCenter.tsx
            message,
            missionId: step.missionId,
            missionName: mission?.name || 'Autonomous Operation',
            agentName: jobName,
            timestamp: step.createdAt?.toISOString() ?? new Date().toISOString(),
            status: 'running', // Steps are usually snapshots of activity
            details: {
                jobId: step.jobId,
                jobName: jobName,
                // Prefer the mission-run FK so run summaries and granular steps
                // share one stable identity in the operations timeline.
                runUuid: step.missionRunId?.toString() || step.runId,
                content: message,
                stepType: stepType
            },
            metadata: {
                toolName: step.toolName,
                confidence: step.confidence,
                stepIndex: step.stepIndex,
                granularType: type
            }
        };
    }

    async getHealth(missionId: number) {
        const runs = await this.listRuns(missionId);
        const successCount = runs.filter(r => r.isSuccess).length;
        const totalCount = runs.length;
        return { successRate: totalCount > 0 ? successCount / totalCount : 1, totalRuns: totalCount };
    }

    async getMissionForEntity(options: { entityType: "job" | "pipeline"; entityId: number }) {
        const [member] = await db.select().from(missionMembers).where(and(eq(missionMembers.entityType, options.entityType), eq(missionMembers.entityId, options.entityId))).limit(1);
        if (!member) return null;
        return await this.getMissionDetail(member.missionId!);
    }

    async listRagAssets(missionId: number) {
        return await db.select().from(missionRagAssets).where(eq(missionRagAssets.missionId, missionId)).limit(500);
    }

    async getAvailableRagAssets(orgId: number | null) {
        // Placeholder: return all for now or filter by org
        return await db.select().from(missionRagAssets);
    }

    async listDocumentTemplates(missionId: number) {
        return await db.select().from(missionDocumentTemplates).where(eq(missionDocumentTemplates.missionId, missionId)).limit(200);
    }

    async listFileAttachments(missionId: number) {
        return await db.select().from(missionFileAttachments).where(eq(missionFileAttachments.missionId, missionId));
    }

    async getMissionRagContext(missionId: number) {
        const assets = await this.listRagAssets(missionId);
        return { assets };
    }

    async getDeleteDiagnostic(missionId: number) {
        const runs = await this.listRuns(missionId);
        return { runCount: runs.length };
    }

    async listTemplates(orgId: number) {
        return await db.select().from(missionTemplates);
    }

    async getBlackboardHistory(missionId: number, limit: number = 20) {
        return await db.select().from(missionBlackboardHistory).where(eq(missionBlackboardHistory.missionId, missionId)).orderBy(desc(missionBlackboardHistory.createdAt)).limit(limit);
    }

    async checkBudget(missionId: number) {
        const totalSpend = await this.calculateTotalSpend(missionId);
        return { totalSpend, overBudget: false }; // Mock budget check
    }

    /**
     * Live workstream telemetry, derived from mission runs — workstreams have no
     * stored entity of their own. `projectId` scopes the feed to missions filed
     * under that project through `project_resources`; the org condition still
     * applies, so a foreign project id yields an empty feed rather than a leak.
     */
    async getWorkstreams(orgId: number, projectId?: number) {
        const conditions = [eq(missionRuns.organizationId, orgId), isNull(missionRuns.deletedAt)];
        if (projectId != null) {
            const { projectResources } = await import("@shared/schema/projects.js");
            conditions.push(inArray(
                missionRuns.missionId,
                db.select({ id: projectResources.resourceId })
                    .from(projectResources)
                    .where(and(
                        eq(projectResources.projectId, projectId),
                        eq(projectResources.resourceType, "mission"),
                    ))
            ));
        }
        const runs = await db.select().from(missionRuns).where(and(...conditions)).orderBy(desc(missionRuns.updatedAt)).limit(10);
        
        return runs.map(run => ({
            id: run.id.toString(),
            name: run.name,
            type: 'mission' as const,
            status: run.status as any,
            lastActivity: (run.updatedAt || run.createdAt || new Date()).toISOString(),
            nodes: (Array.isArray(run.dynamicTrace) ? run.dynamicTrace : []).slice(0, 5).map((t: any, i: number) => ({
                id: `node-${run.id}-${i}`,
                type: t.type || 'activity',
                label: t.stepName || t.event || 'Activity',
                sourceType: t.sourceType || 'system',
                createdAt: t.timestamp || run.updatedAt?.toISOString() || new Date().toISOString()
            }))
        }));
    }

    async getTimeline(missionRunId: number, limit: number = 50, missionId: number): Promise<TimelineItem[]> {
        return missionTimelineService.getTimeline(missionRunId, limit, { missionId });
    }
    
    async getReasoningFeed(missionRunId: number, missionId: number, dynamicTrace: any[], limit = 100) {
        return missionTimelineService.getReasoningFeed(missionRunId, missionId, dynamicTrace, limit);
    }

    async synthesizePhase(mission: any, executions?: any[]): Promise<string> {
        let phase = 'Initializing';
        if (mission.status === 'completed') phase = 'Completed';
        else if (mission.status === 'failed') phase = 'Failed';
        else if (mission.status === 'active' && mission.pipelineExecutionId) {
            try {
                const runExecutions = executions || await db.select().from(pipelineExecutions).where(eq(pipelineExecutions.missionRunId, mission.id));
                const currentExecution = runExecutions.find(e => e.id === mission.pipelineExecutionId);
                
                if (currentExecution) {
                    const activeSteps = await db.select().from(pipelineStepExecutions)
                        .where(and(
                            eq(pipelineStepExecutions.pipelineExecutionId, currentExecution.id),
                            inArray(pipelineStepExecutions.status, ['running', 'pending', 'waiting_async', 'waiting_external_input'])
                        ))
                        .orderBy(pipelineStepExecutions.stepOrder)
                        .limit(1);
                    
                    if (activeSteps.length > 0) {
                        const step = activeSteps[0];
                        const [stepDef] = await db.select().from(pipelineSteps).where(eq(pipelineSteps.id, step.pipelineStepId)).limit(1);
                        
                        let stepName = stepDef?.outputName || `Step ${step.stepOrder}`;
                        if (step.jobId) {
                            const [job] = await db.select().from(jobs).where(eq(jobs.id, step.jobId)).limit(1);
                            if (job) stepName = job.name || job.type || stepName;
                        }
                        phase = stepName;
                    } else if (currentExecution.status === 'success') {
                        phase = 'Finalizing';
                    }
                }
            } catch (err) {
                logger.warn(`Failed to calculate phase for run ${mission.id}: ${err}`);
            }
        }

        if (phase === 'Initializing' && Array.isArray(mission.dynamicTrace) && (mission.dynamicTrace as any[]).length > 0) {
            const relevantTrace = [...(mission.dynamicTrace as any[])].reverse().find(t => 
                !['tool_success', 'tool_output', 'executing_tool', 'system'].includes(t.event) || 
                (t.event === 'mission_launched')
            );
            
            if (relevantTrace) {
                let tracePhase = relevantTrace.stepName || relevantTrace.phase || relevantTrace.step || relevantTrace.event || relevantTrace.type || phase;
                phase = tracePhase.charAt(0).toUpperCase() + tracePhase.slice(1).replace(/_/g, ' ');
            }
        }

        if (mission.missionContext && (mission.missionContext as any).phase) {
            phase = (mission.missionContext as any).phase;
        }

        return phase;
    }

    async getMissionById(missionId: number, organizationId?: number): Promise<{ id: number; organizationId?: number | null } | null> {
        const conditions = [eq(missions.id, missionId), isNull(missions.deletedAt)];
        if (organizationId != null && organizationId !== 0) {
            conditions.push(eq(missions.organizationId, organizationId));
        }
        const [row] = await db
            .select({ id: missions.id, organizationId: missions.organizationId })
            .from(missions)
            .where(and(...conditions))
            .limit(1);
        return row ?? null;
    }

    /**
     * Pending HIL approval requests for a mission.
     *
     * Org-scoped on purpose: the route previously filtered on missionId alone, so
     * any authenticated user could read another tenant's approval queue by id.
     */
    async listPendingApprovals(missionId: number, organizationId: number) {
        return await db
            .select()
            .from(approvalRequests)
            .where(and(
                eq(approvalRequests.missionId, missionId),
                eq(approvalRequests.status, "pending"),
                eq(approvalRequests.organizationId, organizationId),
            ))
            .orderBy(approvalRequests.createdAt);
    }
}

export const missionQueryService = new MissionQueryService();
