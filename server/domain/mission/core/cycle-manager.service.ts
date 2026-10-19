import { db } from "@server/database_service.js";
import { operationalCycles, missionRuns, missions, cycleBlueprints, cycleStrategicAudits, saasConnectors, missionTemplates, appDeployments, jobs, pipelines } from "@shared/schema/index.js";
import { eq, and, or, sql, desc, inArray, isNull } from "drizzle-orm";
import { StrategicSentinelService } from "./strategic-sentinel.service.js";
import { systemAiService } from "@domain/ai/core/system-ai.service.js";
import { createLogger } from "@server/utils/logger.js";
import { rollingWaveOrchestratorService } from "./rolling-wave-orchestrator.service.js";
import { MissionStrategicPlannerService } from "./mission-strategic-planner.service.js";
import { notificationService } from "@server/domain/pipeline/core/notification.service.js";
import { eventStream } from "@domain/core/infrastructure/event-stream.service.js";
import { cycleDependencyGatewayService } from "./cycle-dependency-gateway.service.js";
import { cycleDagService } from "./cycle-dag.service.js";
import { cycleDataflowService } from "./cycle-dataflow.service.js";
import { cycleHILCoordinatorService } from "./cycle-hil-coordinator.service.js";
import { POD_EVENTS } from "@domain/core/infrastructure/pod-events.contract.js";
import { buildCycleMissionInputContext, normalizeCycleInputRequirements } from "@shared/cycle-inputs.js";
import { EventEmitter } from "events";

/**
 * Module-level emitter used for milestone wait/resume.
 * resumeMilestone() emits `cycle.milestone_resumed:<cycleId>` with the new status.
 */
export const cycleManagerEmitter = new EventEmitter();
cycleManagerEmitter.setMaxListeners(200);

const logger = createLogger("CycleManager");

export function emitCycleEvent(eventType: string, cycleId: number, orgId: number | null, payload: Record<string, unknown> = {}) {
    const fullPayload = { cycleId, ...payload };
    eventStream.publish(eventType, fullPayload, {
        organizationId: orgId ?? undefined,
        subject: `cycle:${cycleId}`,
    }, 'cycle-manager').catch(() => {});

    // Deliver to external webhook subscribers
    import("./cycle-webhook.service.js").then(({ CycleWebhookService }) =>
        CycleWebhookService.deliver(orgId, eventType, fullPayload)
    ).catch(() => {});
}

const TIMELINE_UNIT_MS: Record<string, number> = {
    ms: 1,
    milliseconds: 1,
    s: 1000,
    seconds: 1000,
    m: 60_000,
    minutes: 60_000,
    h: 3_600_000,
    hours: 3_600_000,
    d: 86_400_000,
    days: 86_400_000,
    w: 604_800_000,
    weeks: 604_800_000,
    M: 2_629_746_000,
    months: 2_629_746_000,
};

function blueprintDurationMs(bp: any): number {
    const unit = bp?.timeUnit ?? bp?.metadata?.timeUnit ?? "d";
    const unitMs = TIMELINE_UNIT_MS[unit] ?? TIMELINE_UNIT_MS.d;
    const duration = Number(bp?.estimatedDuration);
    if (duration > 0) return duration * unitMs;
    const avgRuntime = Number(bp?.avgRuntime);
    if (avgRuntime > 0) return avgRuntime;
    const days = Number(bp?.estimatedDays);
    return (days > 0 ? days : 1) * TIMELINE_UNIT_MS.d;
}

function blueprintEstimatedDays(bp: any): number {
    return Math.max(1, Math.ceil(blueprintDurationMs(bp) / TIMELINE_UNIT_MS.d));
}

/**
 * Validates the structure of phase_artifacts at cycle install time.
 * Each phase entry may have `input_contract` and/or `output_contract`.
 * If `output_contract` contains a `json_schema`, it must be a valid JSON Schema object
 * (must be a non-null object with a `type` or `properties` key).
 *
 * Throws an Error if validation fails.
 */
function validatePhaseArtifactsStructure(phaseArtifacts: Record<string, any>): void {
    for (const [phaseName, contracts] of Object.entries(phaseArtifacts)) {
        if (!contracts || typeof contracts !== 'object') {
            throw new Error(
                `[Cycle] Invalid phase_artifacts: phase "${phaseName}" must be an object with input_contract/output_contract`
            );
        }

        // Validate output_contract JSON Schema structure if present
        if (contracts.output_contract) {
            const outputContract = contracts.output_contract;
            if (typeof outputContract !== 'object' || outputContract === null) {
                throw new Error(
                    `[Cycle] Invalid phase_artifacts: phase "${phaseName}" output_contract must be an object`
                );
            }
            if (outputContract.json_schema) {
                const schema = outputContract.json_schema;
                if (typeof schema !== 'object' || schema === null) {
                    throw new Error(
                        `[Cycle] Invalid phase_artifacts: phase "${phaseName}" output_contract.json_schema must be a valid JSON Schema object`
                    );
                }
                // A valid JSON Schema must have at minimum one of: type, properties, $ref, anyOf, oneOf, allOf, enum
                const hasSchemaKey = schema.type || schema.properties || schema.$ref ||
                    schema.anyOf || schema.oneOf || schema.allOf || schema.enum;
                if (!hasSchemaKey) {
                    throw new Error(
                        `[Cycle] Invalid phase_artifacts: phase "${phaseName}" output_contract.json_schema must contain at least one of: type, properties, $ref, anyOf, oneOf, allOf, enum`
                    );
                }
            }
        }

        // Validate input_contract structure if present
        if (contracts.input_contract) {
            const inputContract = contracts.input_contract;
            if (typeof inputContract !== 'object' || inputContract === null) {
                throw new Error(
                    `[Cycle] Invalid phase_artifacts: phase "${phaseName}" input_contract must be an object`
                );
            }
        }
    }
}

export class CycleManagerService {
    /**
     * Launches a new operational cycle and spawns its initial missions.
     */
    /**
     * Called by the cycle-resume API route after the operator manually resumes a
     * paused cycle. Wakes up any milestone waits in-flight for this cycle.
     */
    static resumeMilestone(cycleId: number, newStatus: string = 'active'): void {
        cycleManagerEmitter.emit(`cycle.milestone_resumed:${cycleId}`, newStatus);
    }

    static resolveAppStep(cycleId: number, blueprintName: string, status: 'completed' | 'failed' | 'skipped', output?: unknown): boolean {
        return cycleManagerEmitter.emit(`cycle.app_step_resolved:${cycleId}:${blueprintName}`, { status, output });
    }

    private static async readAppStepResult(cycleId: number, blueprintName: string): Promise<{ status: 'completed' | 'failed' | 'skipped'; output?: unknown } | null> {
        const [blueprint] = await db.select({ metadata: cycleBlueprints.metadata }).from(cycleBlueprints).where(and(
            eq(cycleBlueprints.cycleId, cycleId),
            eq(cycleBlueprints.name, blueprintName)
        )).limit(1);
        const runtime = ((blueprint?.metadata as Record<string, any>) ?? {}).runtime ?? {};
        return ['completed', 'failed', 'skipped'].includes(runtime.status)
            ? { status: runtime.status, output: runtime.output }
            : null;
    }

    private static async waitForAppStep(cycleId: number, blueprintName: string, timeoutMs: number): Promise<{ status: 'completed' | 'failed' | 'skipped'; output?: unknown }> {
        const existing = await this.readAppStepResult(cycleId, blueprintName);
        if (existing) return existing;
        const eventKey = `cycle.app_step_resolved:${cycleId}:${blueprintName}`;
        return new Promise((resolve, reject) => {
            let settled = false;
            const finish = (result: { status: 'completed' | 'failed' | 'skipped'; output?: unknown }) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                clearInterval(poller);
                cycleManagerEmitter.off(eventKey, handler);
                resolve(result);
            };
            const timer = setTimeout(() => {
                settled = true;
                clearInterval(poller);
                cycleManagerEmitter.off(eventKey, handler);
                reject(new Error(`Workbench app step "${blueprintName}" timed out`));
            }, timeoutMs);
            const handler = (result: { status: 'completed' | 'failed' | 'skipped'; output?: unknown }) => {
                finish(result);
            };
            cycleManagerEmitter.once(eventKey, handler);
            const poller = setInterval(() => {
                this.readAppStepResult(cycleId, blueprintName)
                    .then(result => result && finish(result))
                    .catch(err => logger.warn(`[Cycle] App-step persistence check failed for ${cycleId}/${blueprintName}: ${err.message}`));
            }, 5_000);
        });
    }

    private static async cycleStatus(cycleId: number): Promise<string | null> {
        const [row] = await db.select({ status: operationalCycles.status })
            .from(operationalCycles).where(eq(operationalCycles.id, cycleId)).limit(1);
        return row?.status ?? null;
    }

    /** Only an active cycle may take on optional new work such as self-healing. */
    static async isCycleRunnable(cycleId: number): Promise<boolean> {
        return (await this.cycleStatus(cycleId)) === 'active';
    }

    /** A cancelled, closed or deleted cycle must not start anything. */
    static async isCycleTerminated(cycleId: number): Promise<boolean> {
        const status = await this.cycleStatus(cycleId);
        return status === null || status === 'cancelled' || status === 'closed';
    }

    static async recoverWaitingAppSteps(): Promise<number> {
        const rows = await db.select({
            cycleId: cycleBlueprints.cycleId,
            metadata: cycleBlueprints.metadata,
        }).from(cycleBlueprints);
        const cycleIds = [...new Set(rows
            .filter(row => ((row.metadata as Record<string, any>)?.runtime?.status === 'waiting_on_app'))
            // cycle_blueprints.cycle_id is nullable; an orphaned blueprint has
            // no cycle to resume.
            .map(row => row.cycleId)
            .filter((id): id is number => id != null))];
        let resumed = 0;
        for (const cycleId of cycleIds) {
            const [cycle] = await db.select().from(operationalCycles).where(eq(operationalCycles.id, cycleId)).limit(1);
            const blueprints = (cycle?.metadata as Record<string, any>)?.blueprints;
            if (!cycle || cycle.status !== 'active' || !Array.isArray(blueprints)) continue;
            void this.spawnBlueprintsWithDeps(cycle.id, blueprints, cycle.createdBy, cycle.organizationId, cycle.priority ?? 5)
                .catch(err => logger.error(`[Cycle] App-step recovery failed for cycle ${cycle.id}: ${err.message}`));
            resumed++;
        }
        return resumed;
    }

    static async launchCycle(data: any, userId: string, orgId: number | null) {
        logger.info(`[Cycle] Launching cycle: ${data.name}`);
        
        const status = (data.requiresApproval === 1 || data.requiresApproval === true) ? 'pending_approval' : 'active';

        // If pipeline_mode is present, ensure it's surfaced in the cycle metadata
        const pipelineMetadata = data.pipeline_mode
            ? { pipeline_mode: data.pipeline_mode }
            : {};

        // Validate phase_artifacts contracts at install time (if provided)
        const phaseArtifacts: Record<string, any> | undefined = data.phase_artifacts;
        if (phaseArtifacts) {
            validatePhaseArtifactsStructure(phaseArtifacts);
        }

        // 1. Create the Cycle
        const [cycle] = await db.insert(operationalCycles).values({
            ...data,
            organizationId: orgId,
            createdBy: userId,
            status,
            blueprintCount: data.blueprints?.length || 0,
            metadata: {
                ...(data.metadata || {}),
                ...pipelineMetadata,
                ...(data.blueprints ? { blueprints: data.blueprints } : {})
            }
        }).returning();

        // 2. Persist Relational Blueprints
        if (data.blueprints && Array.isArray(data.blueprints)) {
            const blueprintValues = data.blueprints.map((bp: any) => ({
                cycleId: cycle.id,
                name: bp.name,
                objective: bp.objective,
                type: bp.type || 'mission',
                dependencies: bp.dependencies || (bp.dependsOn ? bp.dependsOn.map((d: string) => ({ blueprintName: d, type: 'finish_to_start' })) : []),
                estimatedDays: blueprintEstimatedDays(bp),
                config: bp.config || {},
                metadata: bp.metadata || {},
                // Extract artifact contracts from phase_artifacts section if present
                artifactContracts: phaseArtifacts && phaseArtifacts[bp.name]
                    ? phaseArtifacts[bp.name]
                    : null,
            }));

            if (blueprintValues.length > 0) {
                await db.insert(cycleBlueprints).values(blueprintValues);
                logger.info(`[Cycle] Persisted ${blueprintValues.length} relational blueprints for cycle ${cycle.id}`);
            }
        }

        emitCycleEvent('cycle.created', cycle.id, orgId, { status, name: cycle.name });

        if (status === 'active' && data.blueprints && Array.isArray(data.blueprints)) {
            await this.spawnBlueprintsWithDeps(cycle.id, data.blueprints, userId, orgId, cycle.priority ?? 5).catch(err => {
                logger.error(`[Cycle] Spawn failed for cycle ${cycle.id}: ${err.message}`);
            });
        }

        return cycle;
    }

    /**
     * Spawns blueprints in dependency order, respecting advanced Gantt relationships and Lead/Lag offsets.
     */
    static async spawnBlueprintsWithDeps(
        cycleId: number,
        blueprints: any[],
        userId: string,
        orgId: number | null,
        priority: number
    ) {
        const spawned = new Map<string, Promise<void>>();
        const blueprintMap = new Map(blueprints.map(b => [b.name, b])); // O(1) lookups instead of .find() O(n)
        const [cycle] = await db.select().from(operationalCycles).where(eq(operationalCycles.id, cycleId)).limit(1);
        if (!cycle) return;

        // A cycle must execute under its OWN organization, not the approving
        // user's. The approver may be a super-admin or a member of a different
        // org (e.g. org 1), but every mission, agent, workspace, credential and
        // integration check downstream resolves against `orgId` — so if that's
        // the approver's org instead of the cycle's, blueprints silently run
        // under the wrong org (wrong workspace/integrations, agents defaulting to
        // org 1). Pin orgId to the cycle owner.
        if (cycle.organizationId != null && cycle.organizationId !== orgId) {
            logger.info(`[Cycle] Executing cycle ${cycleId} under its owner org ${cycle.organizationId} (approver org was ${orgId ?? "none"}).`);
            orgId = cycle.organizationId;
        }

        // ─── Validate + plan the dependency DAG before spawning (Phase 1 + 2) ─────
        // Validates the DAG, defensively breaks cycles (so gates don't deadlock),
        // computes topological waves + critical path, persists the plan, and returns
        // the concurrency policy used by the dispatcher below.
        const { policy: executionPolicy } = await this.prepareExecutionPlan(cycleId, blueprints, cycle, orgId, blueprintMap);

        const spawnOne = (bp: any): Promise<void> => {
            if (spawned.has(bp.name)) return spawned.get(bp.name)!;

            const p = (async () => {
                try {
                    // 1. Resolve Dependencies (Support legacy 'dependsOn' and new 'dependencies' array)
                    const deps = bp.dependencies || (bp.dependsOn ? bp.dependsOn.map((d: string) => ({ blueprintName: d, type: 'finish_to_start' })) : []);
                    
                    if (deps.length > 0) {
                        logger.info(`[Cycle] Resolving dependencies for ${bp.name}: ${deps.map((d: any) => `${d.blueprintName} (${d.type})`).join(', ')}`);

                        await Promise.all(deps.map(async (dep: any) => {
                            const depBp = blueprintMap.get(dep.blueprintName);
                            if (!depBp) return;

                            // Ensure the dependency blueprint orchestration is at least initiated
                            await spawnOne(depBp);

                            // Compute lead/lag offset in ms
                            let offsetMs = 0;
                            let offsetDirection = 'plus';
                            if (dep.offset) {
                                const { value, unit, direction } = dep.offset;
                                const unitMsMap: any = { days: 86400000, weeks: 604800000, months: 2592000000, years: 31536000000 };
                                offsetMs = value * (unitMsMap[unit] || 86400000);
                                offsetDirection = direction;
                            }

                            // Wait via gateway (EventEmitter + DB-persisted gate, replaces polling loop)
                            await cycleDependencyGatewayService.waitForDependency(
                                cycleId,
                                dep.blueprintName,
                                bp.name,
                                dep.type || 'finish_to_start',
                                offsetMs,
                                offsetDirection,
                                {
                                    timeoutMs: Number(dep.timeoutMinutes) > 0 ? Number(dep.timeoutMinutes) * 60000 : undefined,
                                    onTimeout: dep.onTimeout === 'continue' ? 'continue' : undefined,
                                    organizationId: orgId,
                                    escalateTo: dep.escalateTo,
                                }
                            );

                            logger.info(`[Cycle] Dependency met: ${dep.blueprintName} → ${bp.name}`);
                        }));
                    }

                    // Wait for webhook trigger if configured
                    const triggerConfig = bp.config?.trigger ?? bp.trigger;
                    if (triggerConfig && triggerConfig.type === 'webhook') {
                        const source = triggerConfig.source;
                        const condition = triggerConfig.condition;
                        const triggerPayload = await cycleDependencyGatewayService.waitForWebhookTrigger(cycleId, bp.name, source, condition, {
                            timeoutMs: Number(triggerConfig.timeoutMinutes) > 0 ? Number(triggerConfig.timeoutMinutes) * 60000 : undefined,
                            onTimeout: triggerConfig.onTimeout === 'continue' ? 'continue' : undefined,
                            organizationId: orgId,
                        });
                        if (triggerPayload != null) {
                            const payloadInputs: Record<string, any> = {
                                triggerPayload,
                                webhookPayload: triggerPayload,
                                [`${source}_payload`]: triggerPayload,
                            };
                            if (source === 'jira') {
                                payloadInputs.jira_ticket = triggerPayload.issue ?? triggerPayload.ticket ?? triggerPayload;
                                const featureRequirements = triggerPayload.requirements
                                    ?? triggerPayload.requirement
                                    ?? triggerPayload.issue?.description
                                    ?? triggerPayload.description;
                                if (featureRequirements != null) {
                                    payloadInputs.feature_requirements = featureRequirements;
                                }
                            }
                            bp.resolvedDataFlows = {
                                ...(bp.resolvedDataFlows || {}),
                                ...payloadInputs,
                            };
                        }
                    }

                    // 4. Milestone Intervention Logic
                    if (bp.type === 'milestone') {
                        logger.info(`[Cycle] Milestone reached: ${bp.name}`);
                        if (bp.pauseAtMilestone) {
                            logger.info(`[Cycle] Pausing at milestone: ${bp.name} for approval`);
                            await db.update(operationalCycles)
                                .set({ status: 'paused', metadata: { ...(cycle.metadata as any), currentMilestone: bp.name } })
                                .where(eq(operationalCycles.id, cycleId));
                            
                            emitCycleEvent('cycle.milestone_reached', cycleId, orgId, { milestone: bp.name });
                            
                            // Wait for manual resume (polling for status change)
                            logger.info(`[Cycle] Strategic Milestone reached: ${bp.name}. Pausing for manual intervention.`);
                            
                            // Check if we need to request fresh resources (Pre-flight Refresh)
                            if (normalizeCycleInputRequirements(bp).length > 0) {
                                 await this.requestPreFlightRefresh(cycleId, bp, userId, orgId);
                            }

                            // Event-driven wait — no polling loop, no DB connection held.
                            // CycleManagerService.resumeMilestone() (called by the resume API)
                            // emits `cycle.milestone_resumed:<cycleId>` to unblock this await.
                            const MILESTONE_TIMEOUT_MS = parseInt(process.env.CYCLE_MILESTONE_TIMEOUT_MS || String(10 * 60 * 1000), 10);
                            const milestoneEventKey = `cycle.milestone_resumed:${cycleId}`;
                            await new Promise<void>((resolve, reject) => {
                                // cycleManagerEmitter is the module-level singleton
                                const timer = setTimeout(() => {
                                    cycleManagerEmitter.off(milestoneEventKey, handler);
                                    logger.warn(`[Cycle] ${cycleId} timed out waiting at milestone ${bp.name} after ${MILESTONE_TIMEOUT_MS / 60000}m`);
                                    resolve(); // treat timeout as implicit continue (operator can cancel the cycle directly)
                                }, MILESTONE_TIMEOUT_MS);
                                const handler = (status: string) => {
                                    clearTimeout(timer);
                                    cycleManagerEmitter.off(milestoneEventKey, handler);
                                    if (status === 'cancelled' || status === 'failed') {
                                        logger.warn(`[Cycle] ${cycleId} terminated while waiting at milestone ${bp.name}`);
                                        reject(new Error(`Cycle ${cycleId} ${status} at milestone ${bp.name}`));
                                    } else {
                                        resolve();
                                    }
                                };
                                cycleManagerEmitter.once(milestoneEventKey, handler);
                            }).catch((err: Error) => {
                                logger.warn(`[Cycle] Milestone wait aborted: ${err.message}`);
                                return; // handled below — the return after this block exits spawnOne
                            });
                        }
                        return; 
                    }

                    // 4.5 Data Flow Resolution
                    const dataFlowInputs: Record<string, any> = { ...(bp.resolvedDataFlows || {}) };
                    if (bp.dataFlows && bp.dataFlows.length > 0) {
                        logger.info(`[Cycle] Resolving dataFlows for ${bp.name}`);
                        for (const flow of bp.dataFlows) {
                            const [sourceRun] = await db.select({ id: missionRuns.id, missionContext: missionRuns.missionContext })
                                .from(missionRuns)
                                .innerJoin(missions, eq(missionRuns.missionId, missions.id))
                                .where(and(eq(missionRuns.cycleId, cycleId), eq(missions.name, flow.sourceBlueprint)))
                                .orderBy(desc(missionRuns.createdAt))
                                .limit(1);

                            if (sourceRun) {
                                const sourceContext = (sourceRun.missionContext as any) || {};
                                // Try to get from explicit output key or blackboard
                                let outputValue = sourceContext[flow.sourceOutputKey] ?? sourceContext.blackboard?.[flow.sourceOutputKey];

                                if (outputValue == null) {
                                    // Try to get from deliverable table
                                    const { missionDeliverables } = await import("@shared/schema/index.js");
                                    const [deliverable] = await db.select()
                                        .from(missionDeliverables)
                                        .where(eq(missionDeliverables.missionRunId, sourceRun.id))
                                        .orderBy(desc(missionDeliverables.createdAt))
                                        .limit(1);
                                    if (deliverable) outputValue = deliverable.content;
                                }

                                // Contract enforcement (#4): when the source blueprint declares this
                                // output, validate the resolved value instead of silently defaulting.
                                const sourceBp = blueprintMap.get(flow.sourceBlueprint);
                                const decl = cycleDataflowService.getOutputDecls(sourceBp)[flow.sourceOutputKey];

                                if (decl) {
                                    const check = cycleDataflowService.validateOutputValue(outputValue, decl);
                                    if (!check.valid) {
                                        logger.error(`[Cycle] DataFlow contract violation: ${flow.sourceBlueprint}.${flow.sourceOutputKey} → ${bp.name}.${flow.targetInputKey}: ${check.errors.join('; ')}`);
                                        emitCycleEvent('cycle.dataflow_violation', cycleId, orgId, {
                                            sourceBlueprint: flow.sourceBlueprint,
                                            sourceOutputKey: flow.sourceOutputKey,
                                            targetBlueprint: bp.name,
                                            targetInputKey: flow.targetInputKey,
                                            errors: check.errors,
                                        });
                                        await this.recordDataflowViolation(cycleId, flow, bp.name, check.errors);
                                        // Do NOT substitute a bogus default — leave the input unset so the
                                        // downstream mission sees the real absence (no silent "completed").
                                        continue;
                                    }
                                    dataFlowInputs[flow.targetInputKey] = outputValue;
                                    logger.info(`[Cycle] Resolved dataFlow (contract ok): ${flow.sourceBlueprint}.${flow.sourceOutputKey} -> ${bp.name}.${flow.targetInputKey}`);
                                } else {
                                    // Legacy / untyped flow — preserve best-effort fallback behavior.
                                    if (outputValue == null) {
                                        outputValue = sourceContext.status || sourceContext.phase || sourceContext.result || "completed";
                                    }
                                    if (outputValue != null) {
                                        dataFlowInputs[flow.targetInputKey] = outputValue;
                                        logger.info(`[Cycle] Resolved dataFlow: ${flow.sourceBlueprint}.${flow.sourceOutputKey} -> ${bp.name}.${flow.targetInputKey}`);
                                    }
                                }
                            }
                        }
                    }
                    bp.resolvedDataFlows = dataFlowInputs;

                    // 4.75 Governed Workbench app step. App steps are bound to a
                    // published deployment by the Cycle Builder and pause the DAG
                    // until the app reports completion through the Cycle API.
                    const appStep = bp.config?.appStep;
                    if (appStep) {
                        if (!appStep.deploymentId || appStep.isPublished !== true) {
                            throw new Error(`Workbench app step "${bp.name}" is not bound to a published deployment`);
                        }
                        const { appDeployments } = await import("@shared/schema/index.js");
                        const [deployment] = await db.select().from(appDeployments).where(and(
                            eq(appDeployments.id, Number(appStep.deploymentId)),
                            eq(appDeployments.organizationId, orgId ?? -1),
                            eq(appDeployments.isPublished, true)
                        )).limit(1);
                        if (!deployment) throw new Error(`Published Workbench deployment ${appStep.deploymentId} is unavailable`);

                        const [storedBlueprint] = await db.select().from(cycleBlueprints).where(and(
                            eq(cycleBlueprints.cycleId, cycleId),
                            eq(cycleBlueprints.name, bp.name)
                        )).limit(1);
                        const existingRuntime = ((storedBlueprint?.metadata as Record<string, any>) ?? {}).runtime ?? {};
                        if (['completed', 'skipped'].includes(existingRuntime.status)) {
                            bp.resolvedDataFlows = {
                                ...bp.resolvedDataFlows,
                                ...(appStep.outputPortKey ? { [appStep.outputPortKey]: existingRuntime.output } : {}),
                            };
                            await cycleDependencyGatewayService.onMissionStatusChange(cycleId, bp.name, 'completed');
                            return;
                        }
                        if (existingRuntime.status === 'failed') {
                            await cycleDependencyGatewayService.onMissionStatusChange(cycleId, bp.name, 'failed');
                            throw new Error(`Workbench app step "${bp.name}" previously failed`);
                        }
                        if (storedBlueprint) {
                            const metadata = (storedBlueprint.metadata as Record<string, any>) ?? {};
                            await db.update(cycleBlueprints).set({
                                metadata: {
                                    ...metadata,
                                    runtime: {
                                        ...(metadata.runtime ?? {}),
                                        status: "waiting_on_app",
                                        appStep: { ...appStep, startedAt: existingRuntime.appStep?.startedAt ?? new Date().toISOString() },
                                    },
                                },
                                updatedAt: new Date(),
                            }).where(eq(cycleBlueprints.id, storedBlueprint.id));
                        }

                        emitCycleEvent('cycle.step_started', cycleId, orgId, { appName: bp.name, stepType: 'workbench_app', appStep });
                        emitCycleEvent('app.status_changed', cycleId, orgId, { appName: bp.name, status: 'waiting_on_app', appStep });
                        const timeoutMs = Math.max(60_000, Number(bp.config?.appStepTimeoutMs || process.env.CYCLE_APP_STEP_TIMEOUT_MS || 86_400_000));
                        const result = await this.waitForAppStep(cycleId, bp.name, timeoutMs);
                        if (result.status === 'failed') throw new Error(`Workbench app step "${bp.name}" failed`);
                        bp.resolvedDataFlows = { ...bp.resolvedDataFlows, ...(appStep.outputPortKey ? { [appStep.outputPortKey]: result.output } : {}) };
                        await cycleDependencyGatewayService.onMissionStatusChange(cycleId, bp.name, 'completed');
                        emitCycleEvent('cycle.step_completed', cycleId, orgId, { appName: bp.name, stepType: 'workbench_app', status: result.status, output: result.output });
                        emitCycleEvent('app.status_changed', cycleId, orgId, { appName: bp.name, status: result.status === 'skipped' ? 'skipped' : 'completed' });
                        return;
                    }

                    // 5. Execution Launch — not into a terminated cycle. Abort only
                    // changes the row; this chain lives in memory and kept spawning.
                    // `paused` is deliberately not checked here: a milestone pauses the
                    // cycle while it waits, and a parallel branch skipped then would
                    // never be launched after the resume.
                    if (await this.isCycleTerminated(cycleId)) {
                        logger.info(`[Cycle] ${cycleId} was terminated; not launching ${bp.name}.`);
                        return;
                    }
                    const [existingRun] = await db.select({ id: missionRuns.id, status: missionRuns.status })
                        .from(missionRuns)
                        .innerJoin(missions, eq(missionRuns.missionId, missions.id))
                        .where(and(eq(missionRuns.cycleId, cycleId), eq(missions.name, bp.name)))
                        .orderBy(desc(missionRuns.createdAt))
                        .limit(1);
                    if (existingRun?.status === 'completed') {
                        await cycleDependencyGatewayService.onMissionStatusChange(cycleId, bp.name, 'completed');
                        return;
                    }
                    if (existingRun && ['pending', 'running', 'active', 'paused'].includes(existingRun.status ?? '')) {
                        await this.waitForMissionRunCompletion(existingRun.id);
                        const [finished] = await db.select({ status: missionRuns.status }).from(missionRuns)
                            .where(eq(missionRuns.id, existingRun.id)).limit(1);
                        await cycleDependencyGatewayService.onMissionStatusChange(
                            cycleId,
                            bp.name,
                            finished?.status === 'completed' ? 'completed' : 'failed'
                        );
                        return;
                    }
                    const runResult = await this.spawnMissionForCycle(cycleId, bp, userId, orgId, priority);

                    // 6. Wait for execution completion
                    if (!runResult?.missionRunId) {
                        logger.warn(`[Cycle] No missionRunId for blueprint ${bp.name}, skipping branch logic.`);
                        await cycleDependencyGatewayService.onMissionStatusChange(cycleId, bp.name, 'failed');
                        return;
                    }

                    logger.info(`[Cycle] Waiting for mission run ${runResult.missionRunId} to complete...`);
                    await this.waitForMissionRunCompletion(runResult.missionRunId);
                    logger.info(`[Cycle] Mission run ${runResult.missionRunId} completed or terminated.`);

                    const [finalRun] = await db.select({ status: missionRuns.status, dynamicTrace: missionRuns.dynamicTrace, missionContext: missionRuns.missionContext })
                        .from(missionRuns)
                        .where(eq(missionRuns.id, runResult.missionRunId))
                        .limit(1);
                    
                    if (finalRun) {
                        // Notify the dependency gateway so downstream blueprints waiting on
                        // this mission's 'completed' status can proceed.
                        if (finalRun.status === 'completed') {
                            await cycleDependencyGatewayService.onMissionStatusChange(cycleId, bp.name, 'completed');
                        } else if (finalRun.status === 'failed' || finalRun.status === 'cancelled') {
                            await cycleDependencyGatewayService.onMissionStatusChange(cycleId, bp.name, finalRun.status);
                        }

                        emitCycleEvent('app.status_changed', cycleId, orgId, { appName: bp.name, status: finalRun.status });

                        const outcome = finalRun.status === 'completed' ? 'success' : 'failure';
                        const branch = bp.branches?.find((b: any) => b.onOutcome === outcome);

                        if (branch) {
                            logger.info(`[Cycle] Branching triggered for ${bp.name} outcome ${outcome} → ${branch.targetBlueprint}`);
                            const nextBp = blueprintMap.get(branch.targetBlueprint);
                            if (nextBp) {
                                await spawnOne(nextBp);
                            }
                        } else if (outcome === 'failure') {
                            // An operator's stop is not a failure to repair: a terminated run
                            // came back as a new "Remediation: ..." mission every time.
                            if (finalRun.status === 'cancelled' || !(await this.isCycleRunnable(cycleId))) {
                                logger.info(`[Cycle] ${bp.name} was stopped or its cycle is no longer active. Skipping self-healing.`);
                                return;
                            }
                            if ((finalRun.missionContext as any)?.escalationState?.criticalTriggered) {
                                logger.info(`[Cycle] Mission ${bp.name} failed due to critical escalation SLA breach. Bypassing self-healing.`);
                                return;
                            }
                            // Self-healing: dynamically synthesize a remedial blueprint
                            logger.info(`[Cycle] Mission ${bp.name} failed with no predefined branch. Engaging self-healing synthesis.`);
                            try {
                                const errorTrace = finalRun.dynamicTrace ? JSON.stringify(finalRun.dynamicTrace) : 'Unknown failure trace';
                                const remedialBlueprint = await CycleManagerService.synthesizeRemedialBlueprint(bp, errorTrace);
                                if (remedialBlueprint) {
                                    blueprints.push(remedialBlueprint);
                                    await spawnOne(remedialBlueprint);
                                }
                            } catch (e) {
                                logger.error(`[Cycle] Self-healing failed for ${bp.name}: ${e}`);
                            }
                        }
                    }
                } catch (err: any) {
                    logger.error(`[Cycle] Blueprint ${bp.name} execution failed: ${err.message}`);
                    await cycleDependencyGatewayService.onMissionStatusChange(cycleId, bp.name, 'failed');
                    throw err;
                }
            })();

            spawned.set(bp.name, p);
            return p;
        };

        await this.dispatchWithConcurrency(cycleId, blueprints, spawnOne, executionPolicy, orgId);

        // Recurring completion behavior is handled by CycleSynthesisService after
        // the cycle outcome is known, matching Temporal's "last completion result"
        // model instead of rescheduling from the spawn dispatcher.
    }

    /**
     * Validate the dependency DAG, break any cycles (deadlock guard), compute
     * topological waves + critical path (CPM), and persist the resulting execution
     * plan to the cycle. Returns the concurrency policy for the dispatcher.
     *
     * Pure-computation + persistence only — does not spawn anything. Safe to fail:
     * on error the cycle still launches with an empty policy (current behavior).
     */
    public static async prepareExecutionPlan(
        cycleId: number,
        blueprints: any[],
        cycle: any,
        orgId: number | null,
        blueprintMap?: Map<string, any>,
    ): Promise<{ policy: any }> {
        // Create map if not provided (for backward compatibility when called directly)
        const bpMap = blueprintMap || new Map(blueprints.map(b => [b.name, b]));
        const readPolicy = () => {
            const fromCol = cycle?.executionPolicy && Object.keys(cycle.executionPolicy).length ? cycle.executionPolicy : null;
            return fromCol || (cycle?.metadata as any)?.execution_policy || {};
        };
        try {
            const toDag = () => cycleDagService.buildDag(
                blueprints.map(bp => ({ name: bp.name, dependencies: cycleDagService.normalizeRuntimeBlueprint(bp) }))
            );

            // 1. Validate + surface issues
            const report = cycleDagService.validateDag(
                blueprints.map(bp => ({ name: bp.name, dependencies: cycleDagService.normalizeRuntimeBlueprint(bp) }))
            );
            for (const w of report.warnings) logger.warn(`[Cycle ${cycleId}] DAG warning: ${w}`);

            // 2. Break cycles so dependency gates don't deadlock (mutates only invalid configs)
            if (!report.valid) {
                for (const e of report.errors) logger.error(`[Cycle ${cycleId}] DAG error: ${e}`);
                emitCycleEvent('cycle.dependency_invalid', cycleId, orgId, { errors: report.errors, cycles: report.cycles });
                if (report.cycles.length > 0) {
                    const { removed } = cycleDagService.breakCycles(
                        blueprints.map(bp => ({ name: bp.name, dependencies: cycleDagService.normalizeRuntimeBlueprint(bp) }))
                    );
                    for (const r of removed) {
                        logger.warn(`[Cycle ${cycleId}] Breaking dependency cycle edge to avoid deadlock: ${r.from} → ${r.to}`);
                        const node = bpMap.get(r.to);
                        if (node && Array.isArray(node.dependencies)) {
                            node.dependencies = node.dependencies.filter((d: any) => (d.blueprintName ?? d.upstream) !== r.from);
                        }
                    }
                }
            }

            // 3. Compute waves + critical path over the (now acyclic) DAG
            const dag = toDag();
            const waves = cycleDagService.computeWaves(dag);
            const waveIndexByName = new Map<string, number>();
            waves.forEach((w, i) => w.forEach(n => waveIndexByName.set(n, i)));

            // Duration source: blueprint estimatedDays → ms (historical avg is a future enhancement)
            const durationOf = (name: string) => {
                const bp = bpMap.get(name);
                return blueprintDurationMs(bp);
            };
            const cpm = cycleDagService.computeCriticalPath(dag, durationOf);

            const plan = {
                waves,
                criticalPath: cpm?.criticalPath ?? [],
                projectDurationMs: cpm?.projectDurationMs ?? 0,
                computedAt: new Date().toISOString(),
                nodes: cpm ? Object.fromEntries([...cpm.nodes.entries()].map(([k, v]) => [k, {
                    waveIndex: waveIndexByName.get(k) ?? null,
                    earliestStart: v.earliestStart,
                    earliestFinish: v.earliestFinish,
                    latestStart: v.latestStart,
                    float: v.float,
                    onCriticalPath: v.onCriticalPath,
                    durationMs: v.durationMs,
                }])) : {},
            };

            await db.update(operationalCycles).set({ executionPlan: plan }).where(eq(operationalCycles.id, cycleId));

            // 4. Denormalize queryable per-blueprint fields (wave + critical-path flag)
            // Batch all updates into a single query using raw SQL instead of N individual queries
            const bpsWithUpdates = blueprints
                .map(bp => ({
                    name: bp.name,
                    waveIndex: waveIndexByName.get(bp.name) ?? null,
                    onCriticalPath: cpm?.nodes.get(bp.name)?.onCriticalPath ?? false
                }))
                .filter(bp => bp.waveIndex != null || bp.onCriticalPath);

            if (bpsWithUpdates.length > 0) {
                // Denormalize per-blueprint. NOTE: the previous batched raw-SQL CASE
                // update rendered the SET targets as `"cycle_blueprints"."wave_index"`
                // (a table-qualified SET column), which Postgres rejects — so this
                // whole step silently failed (caught below) and the Gantt/critical-path
                // flags were never persisted. A blueprint count per cycle is small
                // (≤ a couple dozen), so a typed per-row update is correct and cheap.
                for (const bp of bpsWithUpdates) {
                    await db.update(cycleBlueprints)
                        .set({ waveIndex: bp.waveIndex, onCriticalPath: bp.onCriticalPath })
                        .where(and(
                            eq(cycleBlueprints.cycleId, cycleId),
                            eq(cycleBlueprints.name, bp.name)
                        ));
                }
            }

            emitCycleEvent('cycle.dag_validated', cycleId, orgId, {
                valid: report.valid,
                waveCount: waves.length,
                criticalPathLength: plan.criticalPath.length,
                projectDurationMs: plan.projectDurationMs,
            });

            // 5. Static data-flow contract validation (#4): catch dataFlows that pull
            //    an output the source blueprint never declares — before any run.
            const contract = cycleDataflowService.validateDataFlowContracts(blueprints);
            for (const w of contract.warnings) logger.warn(`[Cycle ${cycleId}] DataFlow warning: ${w}`);
            if (contract.errors.length > 0) {
                for (const e of contract.errors) logger.error(`[Cycle ${cycleId}] DataFlow contract error: ${e}`);
                emitCycleEvent('cycle.dataflow_contract_invalid', cycleId, orgId, { errors: contract.errors });
            }

            return { policy: readPolicy() };
        } catch (err: any) {
            // Don't let plan generation fail silently — a swallowed error here means
            // the cycle launches WITHOUT wave ordering / critical-path data and nobody
            // knows. Surface it as a cycle event so it's visible in monitoring, while
            // still failing open (the cycle can run without the CPM optimization).
            logger.error(`[Cycle ${cycleId}] prepareExecutionPlan failed: ${err.message}`);
            emitCycleEvent('cycle.plan_generation_failed', cycleId, orgId, { error: err.message });
            return { policy: readPolicy() };
        }
    }

    /**
     * Record a data-flow contract violation to the cycle's strategic-audit log so
     * operators can see which mission failed to produce its declared output.
     */
    private static async recordDataflowViolation(
        cycleId: number,
        flow: any,
        targetName: string,
        errors: string[],
    ): Promise<void> {
        try {
            await db.insert(cycleStrategicAudits).values({
                cycleId,
                alignmentScore: 100,
                analysis: `Data-flow contract violation: "${targetName}" expected "${flow.sourceOutputKey}" from "${flow.sourceBlueprint}" — ${errors.join('; ')}`,
                suggestedAction: 'REVIEW',
                isCriticalDrift: false,
                metadata: {
                    type: 'dataflow_violation',
                    sourceBlueprint: flow.sourceBlueprint,
                    sourceOutputKey: flow.sourceOutputKey,
                    targetBlueprint: targetName,
                    targetInputKey: flow.targetInputKey,
                    errors,
                },
            });
        } catch (e: any) {
            logger.warn(`[Cycle ${cycleId}] Failed to record dataflow violation: ${e.message}`);
        }
    }

    /**
     * Completion-driven, concurrency-capped dispatcher (Phase 2 #1 + #6).
     *
     * Replaces the flat `Promise.all(blueprints.map(spawnOne))`: a blueprint is only
     * handed to spawnOne once all its structural upstreams have completed, so at most
     * one async context exists per ready/running blueprint (not per blueprint). A
     * global `maxParallelMissions` cap and per-`resourcePool` capacities throttle how
     * many missions run at once, preventing resource starvation when many tickets flow
     * through the cycle. spawnOne still gates on the dependency gateway internally, so
     * each blueprint starts the moment ITS deps are met (no whole-wave latency stall).
     *
     * Caps are per-cycle (in-process). Cross-cycle/global pools would require a Redis
     * counter — noted as a follow-up.
     *
     * Set WAVE_SCHEDULER=off to fall back to the legacy all-at-once spawn.
     */
    private static dispatchWithConcurrency(
        cycleId: number,
        blueprints: any[],
        spawnOne: (bp: any) => Promise<void>,
        policy: any,
        orgId: number | null,
    ): Promise<void> {
        if (process.env.WAVE_SCHEDULER === 'off') {
            return Promise.all(blueprints.map(bp => spawnOne(bp))).then(() => {});
        }

        const byName = new Map<string, any>(blueprints.map(b => [b.name, b]));
        const indegree = new Map<string, number>();
        const dependents = new Map<string, string[]>();
        for (const b of blueprints) { indegree.set(b.name, 0); dependents.set(b.name, []); }

        // Structural edges only (event_trigger / webhook deps are gated, not scheduled)
        for (const b of blueprints) {
            const ups = cycleDagService.normalizeRuntimeBlueprint(b)
                .filter(d => d.type !== 'event_trigger' && !d.external && byName.has(d.upstream))
                .map(d => d.upstream);
            const unique = [...new Set(ups)].filter(u => u !== b.name);
            indegree.set(b.name, unique.length);
            for (const u of unique) dependents.get(u)!.push(b.name);
        }

        // Concurrency limits
        const maxParallel = Number(policy?.maxParallelMissions) > 0 ? Number(policy.maxParallelMissions) : Infinity;
        const pools = Array.isArray(policy?.resourcePools) ? policy.resourcePools : [];
        const poolOf = new Map<string, { name: string; capacity: number }>();
        for (const p of pools) {
            const capacity = Number(p?.capacity) > 0 ? Number(p.capacity) : 1;
            for (const m of (Array.isArray(p?.missions) ? p.missions : [])) poolOf.set(m, { name: p.name, capacity });
        }
        const poolRunning = new Map<string, number>();

        const ready: string[] = [...byName.keys()].filter(n => (indegree.get(n) ?? 0) === 0);
        const readySet = new Set<string>(ready); // O(1) membership — avoids O(n²) ready.includes()
        const done = new Set<string>();
        let running = 0;

        return new Promise<void>((resolve) => {
            const canStart = (name: string): boolean => {
                const pool = poolOf.get(name);
                if (!pool) return true;
                return (poolRunning.get(pool.name) ?? 0) < pool.capacity;
            };

            const pump = () => {
                if (done.size >= byName.size) { resolve(); return; }

                let startedThisPass = 0;
                for (let i = 0; i < ready.length && running < maxParallel; ) {
                    const name = ready[i];
                    if (!canStart(name)) { i++; continue; } // pool-blocked — try next, revisit on completion
                    ready.splice(i, 1);
                    readySet.delete(name);
                    const bp = byName.get(name);
                    const pool = poolOf.get(name);
                    running++;
                    if (pool) poolRunning.set(pool.name, (poolRunning.get(pool.name) ?? 0) + 1);
                    startedThisPass++;

                    Promise.resolve(spawnOne(bp)).catch(() => {}).finally(() => {
                        running--;
                        if (pool) poolRunning.set(pool.name, Math.max(0, (poolRunning.get(pool.name) ?? 1) - 1));
                        done.add(name);
                        for (const dep of dependents.get(name) ?? []) {
                            const d = (indegree.get(dep) ?? 0) - 1;
                            indegree.set(dep, d);
                            if (d <= 0 && !done.has(dep) && !readySet.has(dep)) {
                                ready.push(dep);
                                readySet.add(dep);
                            }
                        }
                        pump();
                    });
                }

                // Deadlock guard: nothing running and nothing started but work remains
                // (e.g. every ready node is pool-blocked by a misconfigured 0-capacity pool).
                if (running === 0 && startedThisPass === 0 && ready.length > 0) {
                    const name = ready.shift()!;
                    readySet.delete(name);
                    logger.warn(`[Cycle ${cycleId}] Concurrency deadlock guard force-starting "${name}"`);
                    const bp = byName.get(name);
                    running++;
                    Promise.resolve(spawnOne(bp)).catch(() => {}).finally(() => {
                        running--; done.add(name);
                        for (const dep of dependents.get(name) ?? []) {
                            const d = (indegree.get(dep) ?? 0) - 1;
                            indegree.set(dep, d);
                            if (d <= 0 && !done.has(dep) && !readySet.has(dep)) {
                                ready.push(dep);
                                readySet.add(dep);
                            }
                        }
                        pump();
                    });
                }
            };

            if (byName.size === 0) { resolve(); return; }
            pump();
        });
    }

    /**
     * Spawns a mission run associated with a cycle.
     */
    static async spawnMissionForCycle(
        cycleId: number,
        missionBlueprint: any,
        userId: string,
        orgId: number | null,
        priorityOverride?: number
    ): Promise<{ success: boolean; missionRunId?: number }> {
        // 0. Fetch Cycle for Priority and Metadata (Resource Answers)
        const [cycle] = await db.select().from(operationalCycles).where(eq(operationalCycles.id, cycleId)).limit(1);
        if (!cycle) throw new Error("Cycle not found");
        
        const priority = priorityOverride ?? cycle.priority ?? 5;
        const cycleMetadata = (cycle.metadata as any) || {};
        
        // --- WEEKEND EXCLUSION GUARD ---
        if (cycleMetadata.exclude_weekends || cycleMetadata.excludeWeekends) {
            const today = new Date();
            const dayOfWeek = today.getDay(); // 0 = Sunday, 6 = Saturday
            if (dayOfWeek === 0 || dayOfWeek === 6) {
                const monday = new Date(today);
                monday.setDate(today.getDate() + (dayOfWeek === 0 ? 1 : 2));
                monday.setHours(9, 0, 0, 0);
                const delayMs = monday.getTime() - today.getTime();
                
                logger.info(`[Cycle ${cycleId}] Weekend detected for mission "${missionBlueprint.name}". Delaying spawn by ${Math.ceil(delayMs / 3600000)} hours until Monday 09:00 AM.`);
                await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
                logger.info(`[Cycle ${cycleId}] Weekend delay expired. Resuming spawn for mission "${missionBlueprint.name}".`);
            }
        }

        const metadataBlueprint = Array.isArray(cycleMetadata.blueprints)
            ? cycleMetadata.blueprints.find((bp: any) =>
                bp?.name === missionBlueprint.name ||
                bp?.id === missionBlueprint.id ||
                bp?.missionId === missionBlueprint.missionId ||
                bp?.mission_id === missionBlueprint.missionId
            )
            : null;
        const contextBlueprint = {
            ...(metadataBlueprint || {}),
            ...missionBlueprint,
            config: {
                ...((metadataBlueprint as any)?.config || {}),
                ...(missionBlueprint.config || {}),
            },
        };

        const combinedGroundTruth = buildCycleMissionInputContext({
            cycle,
            blueprint: contextBlueprint,
            resolvedDataFlows: missionBlueprint.resolvedDataFlows || {},
        });

        // JIRA JQL as Mission Briefing: Inject JQL query results as ground_truth
        if (contextBlueprint.config?.jiraJqlQuery) {
            try {
                const { sdlcToolStubs } = await import("@domain/tools/v1/capabilities/sdlc-tools.js");
                const jqlResult = await sdlcToolStubs.jiraJqlSearch({
                    jql: contextBlueprint.config.jiraJqlQuery,
                    orgId: orgId ?? undefined,
                    limit: 50
                });
                
                if (jqlResult.success) {
                    combinedGroundTruth.jiraQueryResults = {
                        jql: contextBlueprint.config.jiraJqlQuery,
                        issues: jqlResult.issues,
                        total: jqlResult.total
                    };
                    logger.info(`[Cycle] Injected JQL query results into ground_truth for ${missionBlueprint.name}: ${jqlResult.total} issues`);
                } else {
                    const errorMsg = (jqlResult as any).error || "Unknown JQL search error";
                    logger.warn(`[Cycle] JQL query failed for ${missionBlueprint.name}: ${errorMsg}`);
                    combinedGroundTruth.jiraQueryError = errorMsg;
                }
            } catch (err: any) {
                logger.error(`[Cycle] JQL query error for ${missionBlueprint.name}: ${err.message}`);
                combinedGroundTruth.jiraQueryError = err.message;
            }
        }

        if (contextBlueprint.config?.waveId || contextBlueprint.config?.acceptanceCriteria || contextBlueprint.config?.assignee) {
            combinedGroundTruth.wavePlan = {
                waveId: contextBlueprint.config.waveId,
                waveNumber: contextBlueprint.config.waveNumber,
                acceptanceCriteria: contextBlueprint.config.acceptanceCriteria,
                assignee: contextBlueprint.config.assignee,
                primaryAgent: contextBlueprint.primaryAgent,
            };
        }

        // 1. Create/Find the Mission Template
        let missionId = missionBlueprint.missionId ?? missionBlueprint.config?.missionId;
        let strategy = "rolling_wave";

        if (!missionId) {
            const [template] = await db.select()
                .from(missionTemplates)
                .where(and(
                    eq(missionTemplates.name, missionBlueprint.name),
                    orgId ? eq(missionTemplates.organizationId, orgId) : isNull(missionTemplates.organizationId)
                ))
                .limit(1);

            if (template) {
                strategy = (template.config as any)?.executionStrategy || 
                           ((template.config as any)?.sequence?.length ? "pre_planned" : "rolling_wave");
            }

            const [newMission] = await db.insert(missions).values({
                name: missionBlueprint.name,
                objective: missionBlueprint.objective,
                organizationId: orgId,
                createdBy: userId,
                status: 'active',
                executionStrategy: strategy,
                blackboard: {
                    ground_truth: combinedGroundTruth,
                    projectId: cycle.projectId ?? null,
                    wavePlan: combinedGroundTruth.wavePlan,
                },
                // Set externalTicketId from Jira webhook trigger payload
                externalTicketId: (missionBlueprint.resolvedDataFlows?.jira_ticket?.key as string)
                    || (combinedGroundTruth.jiraQueryResults?.issues?.[0]?.key as string)
                    || null,
            }).returning();
            missionId = newMission.id;
        } else {
            // Update existing mission blackboard with fresh ground truth for this cycle
            await db.update(missions).set({ 
                blackboard: {
                    ground_truth: combinedGroundTruth,
                    projectId: cycle.projectId ?? null,
                    wavePlan: combinedGroundTruth.wavePlan,
                } 
            }).where(eq(missions.id, missionId));
        }

        // 2. Launch the Mission via missionExecutionService to dynamically choose strategy
        const { missionExecutionService } = await import("./mission-execution.service.js");
        const launchMetadata = {
            priority,
            projectId: cycle.projectId ?? undefined,
            waveId: contextBlueprint.config?.waveId,
            waveNumber: contextBlueprint.config?.waveNumber,
            assignee: contextBlueprint.config?.assignee,
            primaryAgent: contextBlueprint.primaryAgent,
        };
        const result = await missionExecutionService.launchMission(missionId, userId, orgId, undefined, undefined, launchMetadata);
        
        // 3. Link Run to Cycle
        if (result.success && result.missionRunId) {
            await db.update(missionRuns).set({ cycleId }).where(eq(missionRuns.id, result.missionRunId));
            logger.info(`[Cycle] Mission ${missionId} linked to Cycle ${cycleId}`);

            // Notify dependency gateway so any downstream blueprints waiting on this
            // mission's 'active' status can be unblocked immediately.
            cycleDependencyGatewayService.onMissionStatusChange(
                cycleId, missionBlueprint.name, 'active'
            ).catch(() => {});

            emitCycleEvent('app.status_changed', cycleId, orgId, { appName: missionBlueprint.name, status: 'active' });

            return { success: true, missionRunId: result.missionRunId };
        }
        return { success: false };
    }

    /**
     * Performs a synthesis of all missions within a cycle.
     * Delegates to CycleSynthesisService for separation of concerns.
     */
    static async synthesizeCycle(cycleId: number, orgId: number | null) {
        const { CycleSynthesisService } = await import("./cycle-synthesis.service.js");
        return CycleSynthesisService.synthesize(cycleId, orgId, this.notifyFleetEvent.bind(this));
    }

    /** Delegates to CycleSynthesisService */
    static async calculateCycleSpend(cycleId: number): Promise<number> {
        const { CycleSynthesisService } = await import("./cycle-synthesis.service.js");
        return CycleSynthesisService.calculateCycleSpend(cycleId);
    }

    /** Delegates to CycleSynthesisService */
    static async calculateCycleTokens(cycleId: number): Promise<number> {
        const { CycleSynthesisService } = await import("./cycle-synthesis.service.js");
        return CycleSynthesisService.calculateCycleTokens(cycleId);
    }

    /**
     * Evaluates if a cycle's success criteria have been met based on a mission's finding.
     */
    static async evaluateSuccessCriteria(cycleId: number, signal: { type: string, confidence: number, data: any }) {
        const [cycle] = await db.select().from(operationalCycles).where(eq(operationalCycles.id, cycleId)).limit(1);
        if (!cycle || cycle.status !== 'active') return;

        const criteria = (cycle.successCriteria as any) || {};
        if (Object.keys(criteria).length === 0) return;

        logger.info(`[Cycle] Evaluating success criteria for Cycle ${cycleId} against signal: ${signal.type}`);

        let shouldTerminate = false;

        // Example: stop_on logic
        if (criteria.stop_on && criteria.stop_on === signal.type) {
            if (criteria.min_confidence && signal.confidence >= criteria.min_confidence) {
                shouldTerminate = true;
            } else if (!criteria.min_confidence) {
                shouldTerminate = true;
            }
        }

        if (shouldTerminate) {
            logger.info(`[Cycle] SUCCESS CRITERIA MET for Cycle ${cycleId}. Initiating fleet termination.`);
            await this.terminateFleet(cycleId, "Success criteria met: " + signal.type);
            await this.synthesizeCycle(cycleId, cycle.organizationId);
        }
    }

    /**
     * Gracefully terminates all missions in a cycle fleet.
     */
    static async terminateFleet(cycleId: number, reason: string) {
        const activeRuns = await db.select().from(missionRuns).where(and(eq(missionRuns.cycleId, cycleId), eq(missionRuns.status, 'active')));
        
        if (activeRuns.length === 0) return;
        const activeRunIds = activeRuns.map(r => r.id);
        logger.info(`[Cycle] Bulk-terminating ${activeRunIds.length} mission runs for cycle ${cycleId}.`);
        await db.update(missionRuns).set({
            status: 'cancelled' as any,
            updatedAt: new Date(),
            missionContext: sql`${missionRuns.missionContext} || jsonb_build_object('termination_reason', ${reason}::text)`
        }).where(inArray(missionRuns.id, activeRunIds));
    }

    /**
     * Simulates a cycle execution to provide cost and scope estimates.
     */
    static async simulateCycle(data: any) {
        logger.info(`[Cycle] Simulating cycle: ${data.name}`);
        
        const blueprints = data.blueprints || [];
        const missionCount = blueprints.length || 1;
        
        // Grounded token and cost modeling per blueprint
        let p50Tokens = 0;
        let p95Tokens = 0;
        
        for (const bp of blueprints) {
            const objectiveLen = bp.objective ? String(bp.objective).length : 200;
            const promptTokens = Math.min(2_000, 400 + Math.round(objectiveLen / 3));
            const toolTokens = Array.isArray(bp.allowedTools) ? bp.allowedTools.length * 350 : 0;
            const resourceTokens = Array.isArray(bp.requiredResources) ? bp.requiredResources.length * 250 : 0;
            const baseTokens = (bp.type === "milestone" ? 0 : 15_000) + promptTokens + toolTokens + resourceTokens;
            p50Tokens += baseTokens;
            p95Tokens += Math.round(baseTokens * 1.6);
        }
        
        if (p50Tokens === 0) {
            p50Tokens = missionCount * 18_000;
            p95Tokens = Math.round(p50Tokens * 1.6);
        }

        const blendedRate = 0.003; // $0.003 per 1k tokens
        const totalEstimatedTokens = p50Tokens;
        const totalEstimatedCost = Number(((totalEstimatedTokens / 1_000) * blendedRate).toFixed(2));
        const p95Cost = Number(((p95Tokens / 1_000) * blendedRate).toFixed(2));

        // Blueprint dependency checking
        const names = new Set(blueprints.map((b: any) => b.name).filter(Boolean));
        const danglingDeps: string[] = [];
        for (const bp of blueprints) {
            const deps = Array.isArray(bp.dependsOn) ? bp.dependsOn : Array.isArray(bp.dependencies) ? bp.dependencies.map((d: any) => d.blueprintName || d) : [];
            for (const dep of deps) {
                if (dep && !names.has(dep)) {
                    danglingDeps.push(`Blueprint '${bp.name}' depends on unknown blueprint '${dep}'.`);
                }
            }
        }

        const readinessScore = Math.max(0, 100 - (danglingDeps.length * 20));

        return {
            missionCount,
            totalEstimatedCost,
            totalEstimatedTokens,
            costBounds: {
                p50: totalEstimatedCost,
                p95: p95Cost,
            },
            tokenBounds: {
                p50: p50Tokens,
                p95: p95Tokens,
            },
            readinessScore,
            verification: {
                status: danglingDeps.length === 0 ? "VERIFIED" : "ACTION_REQUIRED",
                danglingDependencies: danglingDeps,
            },
            recommendedPriority: data.priority || 5,
            stratagem: missionCount > 3 ? "Rolling Wave Multi-Agent Orchestration with RAG Synthesis" : "Direct Sequential Execution with Telemetry"
        };
    }

    /**
     * Deep verifies all participating studio resources (Workbench Apps, Form Agents, Data Pipelines)
     * referenced in a cycle builder draft definition against the database.
     */
    static async verifyStudioResources(organizationId: number, definition: any): Promise<string[]> {
        const errors: string[] = [];

        // 1. Workbench App Deployment Probes
        for (const phase of (definition.phases || [])) {
            const appStep = phase.appStep;
            if (!appStep) continue;
            if (!appStep.deploymentId || appStep.isPublished !== true || !appStep.releaseRef || !appStep.launchHref) {
                errors.push(`${phase.name}: Workbench app binding is incomplete or unpublished.`);
                continue;
            }
            const [deployment] = await db.select({
                id: appDeployments.id,
                appId: appDeployments.appId,
                isPublished: appDeployments.isPublished,
                status: appDeployments.status,
            }).from(appDeployments).where(and(
                eq(appDeployments.id, appStep.deploymentId),
                eq(appDeployments.organizationId, organizationId)
            )).limit(1);

            if (!deployment) errors.push(`${phase.name}: Workbench deployment ${appStep.deploymentId} is unavailable.`);
            else if (!deployment.isPublished) errors.push(`${phase.name}: Workbench deployment ${appStep.deploymentId} is no longer published.`);
            else if (!["installed", "active"].includes(deployment.status)) errors.push(`${phase.name}: Workbench deployment is ${deployment.status}.`);
            else if (typeof appStep.appId === "number" && deployment.appId !== appStep.appId) errors.push(`${phase.name}: Workbench app and deployment no longer match.`);
        }

        // 2. Form Studio Probes
        const formAgentResources = (definition.resources || []).filter((r: any) => r.type === "form_agent");
        for (const res of formAgentResources) {
            const formJobId = Number(res.binding?.referenceId);
            if (Number.isInteger(formJobId) && formJobId > 0) {
                const [job] = await db.select({
                    id: jobs.id,
                    name: jobs.name,
                    isActive: jobs.isActive,
                    lifecycleStatus: jobs.lifecycleStatus,
                }).from(jobs).where(and(
                    eq(jobs.id, formJobId),
                    eq(jobs.type, "form_agent"),
                    or(eq(jobs.organizationId, organizationId), isNull(jobs.organizationId))
                )).limit(1);

                if (!job) {
                    errors.push(`Form Agent '${res.label || res.key}' (ID: ${formJobId}) does not exist in this organization.`);
                } else if (!job.isActive || job.lifecycleStatus === "archived") {
                    errors.push(`Form Agent '${res.label || res.key}' (ID: ${formJobId}) is archived or inactive.`);
                }
            }
        }

        // 3. Signal Studio & Pipeline Output Probes
        const pipelineResources = (definition.resources || []).filter((r: any) => r.type === "pipeline_output");
        for (const res of pipelineResources) {
            const ref = String(res.binding?.referenceId || "");
            const match = ref.match(/^pipeline-(\d+)-output-(\d+)$/) || ref.match(/^(\d+):(.*)$/) || ref.match(/^(\d+)$/);
            if (match) {
                const pipelineId = Number(match[1]);
                const [pipeline] = await db.select({
                    id: pipelines.id,
                    name: pipelines.name,
                    isActive: pipelines.isActive,
                    lifecycleStatus: pipelines.lifecycleStatus,
                }).from(pipelines).where(and(
                    eq(pipelines.id, pipelineId),
                    eq(pipelines.organizationId, organizationId)
                )).limit(1);

                if (!pipeline) {
                    errors.push(`Data Pipeline '${res.label || res.key}' (ID: ${pipelineId}) is unavailable or does not belong to this organization.`);
                } else if (!pipeline.isActive || pipeline.lifecycleStatus === "archived") {
                    errors.push(`Data Pipeline '${res.label || res.key}' (ID: ${pipelineId}) is archived or inactive.`);
                }
            }
        }

        return errors;
    }

    /**
     * Generates a set of discovery questions for a specific cycle template.
     */
    static async generateConfigQuestions(template: any) {
        const { LocalSLMService } = await import("../../ai/core/local-slm.service.js");
        
        const prompt = `
            Template: ${template.name}
            Objective: ${template.objective}
            Description: ${template.description}

            Task: Generate 3-5 high-impact discovery questions to help a user refine this cycle for their specific business context.
            Respond with a JSON array of strings. Example: ["What is the target industry?", "Which region?"]
        `;

        try {
            const parsed = await systemAiService.generateJson(prompt, 'concierge');
            if (!parsed || !Array.isArray(parsed)) {
                throw new Error("AI response is not an array");
            }
            return parsed;
        } catch (err: any) {
            logger.warn(`[Cycle] Failed to generate config questions: ${err.message}`);
            return ["What is the primary target of this operation?", "Are there any specific constraints?", "Which tools should be prioritized?"];
        }
    }

    /**
     * Refines cycle blueprints based on user answers to discovery questions.
     */
    static async refineBlueprints(template: any, answers: Record<string, string>) {
        const { LocalSLMService } = await import("../../ai/core/local-slm.service.js");
        
        const prompt = `
            Original Template: ${template.name}
            Strategic Objective: ${template.objective}
            
            User Context (Answers to Discovery):
            ${Object.entries(answers).map(([q, a]) => `Q: ${q}\nA: ${a}`).join('\n')}

            Original Blueprints:
            ${template.blueprints.map((b: any) => `- ${b.name}: ${b.objective}`).join('\n')}

            Task: Refine the mission objectives and names in the blueprints based on the user context provided. 
            Refine the mission names to describe the specific function or task they perform (e.g. 'PR Security Analyzer' or 'Slack Alert Dispatcher' rather than generic role/mission titles), and make the objectives specific and tactical.
            Respond with a JSON array of objects with 'name' and 'objective' fields.
        `;

        try {
            const parsed = await systemAiService.generateJson(prompt, 'architect');
            if (!parsed || !Array.isArray(parsed)) {
                throw new Error("AI response is not an array");
            }
            return parsed;
        } catch (err: any) {
            logger.warn(`[Cycle] Failed to refine blueprints: ${err.message}`);
            return template.blueprints;
        }
    }

    /**
     * Synthesizes a new set of blueprints and resource requirements from a raw objective.
     */
    static async synthesizeBlueprints(objective: string) {
        const { LocalSLMService } = await import("../../ai/core/local-slm.service.js");

        const safeObjective = (objective || "").replace(/[\x00-\x1F\x7F]/g, " ").slice(0, 1000);

        const prompt = `
            You are a Strategic Mission Architect.
            The user wants to achieve the following objective: "${safeObjective}"

            Task: Design a sequence of 2-4 tactical mission blueprints to achieve this goal.
            For each mission, identify:
            1. A clear 'name' that describes the specific function or task the mission performs (e.g. 'PR Security Analyzer' or 'Slack Alert Dispatcher' rather than generic titles like 'Mission 1', 'Stage 2', 'Security Specialist', or 'Developer') and a tactical 'objective'.
            2. 'type': 'mission' or 'milestone'.
            3. 'dependencies': An array of objects:
               { 
                 blueprintName: string, 
                 type: 'finish_to_start' | 'start_to_start' | 'finish_to_finish' | 'start_to_finish',
                 offset: { value: number, unit: 'days'|'weeks'|'months'|'years', direction: 'plus'|'minus' } 
               }
            4. 'branches': Array of { onOutcome: 'success'|'failure', targetBlueprint: string }. Use this for self-healing (e.g. if a scan fails, launch a diagnostic mission).
            5. 'pauseAtMilestone': Boolean. Set to true for milestones that require human 'Go/No-Go' approval.
            6. 'inputs' and 'outputs': Arrays of string keys.
            5. 'dataFlows': Array of { sourceBlueprint: string, sourceOutputKey: string, targetInputKey: string }
            6. 'resources': A list of required inputs the human needs to provide to make the mission operational.
            
            Resource types must be one of: 'url_list', 'dataset', 'credential', 'text', 'number'.

            Respond ONLY with a JSON array of blueprints. 
            Example structure:
            [
              {
                "name": "Market Sweep",
                "objective": "Identify competitors...",
                "type": "mission",
                "outputs": ["competitor_list"],
                "resources": [
                  { "id": "sector", "label": "Sector", "type": "text", "description": "...", "required": true }
                ]
              },
              {
                "name": "Analysis",
                "objective": "Analyze the identified competitors...",
                "type": "mission",
                "dependencies": [{ "blueprintName": "Market Sweep", "type": "finish_to_start" }],
                "inputs": ["target_list"],
                "dataFlows": [{ "sourceBlueprint": "Market Sweep", "sourceOutputKey": "competitor_list", "targetInputKey": "target_list" }]
              }
            ]
        `;

        try {
            logger.info(`[Cycle] Synthesizing blueprints for objective: ${objective.substring(0, 100)}...`);
            const parsed = await systemAiService.generateJson(prompt, 'architect');
            
            if (!parsed) {
                logger.error("[Cycle] AI Architect returned null/empty response");
                throw new Error("AI Architect failed to generate a plan. This usually means the model was unable to follow the strategic constraints or the API key is invalid.");
            }

            // Optimization: Log structure instead of stringifying large response objects
            logger.debug(`[Cycle] AI synthesis response: type=${Array.isArray(parsed) ? 'array' : typeof parsed}, keys=${Array.isArray(parsed) ? `length=${parsed.length}` : Object.keys(parsed || {}).join(',')}`);

            if (!Array.isArray(parsed)) {
                 logger.info("[Cycle] Response is not an array, attempting to extract blueprints/tasks key...");
                 // Try to extract array if wrapped (some models wrap in a 'blueprints' or 'tasks' key)
                 if (parsed.blueprints && Array.isArray(parsed.blueprints)) {
                     logger.info(`[Cycle] Successfully extracted ${parsed.blueprints.length} blueprints from 'blueprints' key.`);
                     return parsed.blueprints;
                 }
                 if (parsed.tasks && Array.isArray(parsed.tasks)) {
                     logger.info(`[Cycle] Successfully extracted ${parsed.tasks.length} blueprints from 'tasks' key.`);
                     return parsed.tasks;
                 }
                 
                 logger.error(`[Cycle] Malformed synthesis response structure: ${JSON.stringify(parsed)}`);
                 throw new Error("AI returned malformed strategic data. Expected a blueprint array but received a complex object. Try refining the objective.");
            }

            logger.info(`[Cycle] Successfully synthesized ${parsed.length} mission blueprints.`);
            return parsed;
        } catch (err: any) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            logger.error(`[Cycle] Synthesis failure: ${errorMsg}`);
            throw new Error(errorMsg); // Ensure we throw a proper Error with a string message
        }
    }

    /**
     * Sends a rich notification to the fleet's Slack channel.
     */
    static async notifyFleetEvent(orgId: number | null, title: string, message: string, severity: 'info' | 'warn' | 'error' = 'info') {
        if (!orgId) return;

        try {
            // Find Slack Connector
            const [connector] = await db.select().from(saasConnectors).where(and(eq(saasConnectors.orgId, orgId), eq(saasConnectors.platform, 'slack'))).limit(1);
            if (!connector) {
                logger.warn(`[Cycle] No Slack connector found for Org ${orgId}. Notification skipped.`);
                return;
            }

            const webhookUrl = (connector.config as any)?.webhookUrl;
            if (!webhookUrl) return;

            const icon = severity === 'error' ? '🚨' : severity === 'warn' ? '⚠️' : '🚀';
            const color = severity === 'error' ? '#ef4444' : severity === 'warn' ? '#f59e0b' : '#3b82f6';

            await notificationService.send({
                channel: 'slack',
                target: webhookUrl,
                body: `${icon} *${title}*\n${message}`
            });
        } catch (err: any) {
            logger.error(`[Cycle] Fleet notification failed: ${err.message}`);
        }
    }

    /**
     * Pauses the cycle at a milestone and creates a HIL form in the Decision Inbox
     * for the operator to provide fresh resources before execution resumes.
     */
    static async requestPreFlightRefresh(cycleId: number, bp: any, userId: string, orgId: number | null) {
        logger.info(`[Cycle] Requesting Pre-flight Refresh for ${bp.name} (Cycle ${cycleId})`);

        // Pause cycle (already done by caller, but ensure)
        await db.update(operationalCycles).set({ status: 'paused' }).where(eq(operationalCycles.id, cycleId));

        // Create HIL form in Decision Inbox
        const formId = await cycleHILCoordinatorService.createHILRequest(
            cycleId,
            bp.name,
            normalizeCycleInputRequirements(bp),
            userId,
            orgId
        );

        // Secondary Slack notification with link to the form
        const [cycle] = await db.select({ name: operationalCycles.name }).from(operationalCycles).where(eq(operationalCycles.id, cycleId)).limit(1);
        await this.notifyFleetEvent(
            orgId,
            "Pre-flight Refresh Required",
            `Cycle *${cycle?.name}* is paused at milestone "${bp.name}". A Decision Inbox request (Form #${formId}) has been created for the required resources.`,
            'warn'
        );
    }

    /**
     * Synthesizes a strategic post-mortem at the end of a cycle.
     */
    static async generatePostMortem(cycleId: number) {
        const [cycle] = await db.select().from(operationalCycles).where(eq(operationalCycles.id, cycleId)).limit(1);
        if (!cycle) return;

        const runs = await db.select().from(missionRuns).where(eq(missionRuns.cycleId, cycleId));
        
        const prompt = `
            Synthesize a strategic post-mortem for the following cycle:
            Name: ${cycle.name}
            Objective: ${cycle.objective}
            
            Mission Outcomes:
            ${runs.map(r => {
                // Optimization: Avoid JSON.stringify on large objects, just extract key info
                const traceKeys = r.dynamicTrace && typeof r.dynamicTrace === 'object' ? Object.keys(r.dynamicTrace).slice(0, 3).join(',') : 'none';
                return `- ${r.status === 'completed' ? '✅' : '❌'} ${r.status.toUpperCase()}: trace=[${traceKeys}]`;
            }).join('\n')}
            
            Provide:
            1. Executive Summary of ROI/Outcomes.
            2. Strategic Pivot recommendations.
            3. Blueprint optimization suggestions.
        `;

        try {
            const postMortem = await systemAiService.generateText(prompt, { serviceKey: 'business_analyst' });
            await db.update(operationalCycles).set({ 
                outcomeMetrics: sql`${operationalCycles.outcomeMetrics} || jsonb_build_object('postMortem', ${postMortem}::text)`
            }).where(eq(operationalCycles.id, cycleId));
            
            logger.info(`[Cycle] Post-mortem synthesized for Cycle ${cycleId}`);
        } catch (err: any) {
            logger.error(`[Cycle] Post-mortem synthesis failed: ${err.message}`);
        }
    }

    /**
     * Dynamically synthesizes a remedial blueprint when a mission fails.
     */
    static async synthesizeRemedialBlueprint(failedBlueprint: any, errorTrace: string) {
        logger.info(`[Cycle] Synthesizing remedial blueprint for failed mission: ${failedBlueprint.name}`);
        
        const prompt = `
            You are a Strategic Mission Architect. A mission has just failed.
            
            Failed Mission: ${failedBlueprint.name}
            Objective: ${failedBlueprint.objective}
            Error Trace: ${errorTrace.substring(0, 500)}

            Task: Design a single remedial mission blueprint to recover from this failure and achieve the original objective or a safe fallback.
            The blueprint MUST follow this JSON format:
            {
                "name": "Remediation: <name>",
                "objective": "<tactical recovery objective>",
                "type": "mission",
                "dependencies": [],
                "inputs": [],
                "outputs": []
            }
            Ensure the '<name>' part of the blueprint name describes the specific recovery or remedial function performed (e.g., 'Fix DB Lockout' or 'Retry API Ingestion' rather than generic recovery terms).
            Respond ONLY with the JSON object.
        `;

        try {
            const parsed = await systemAiService.generateJson(prompt, 'architect');
            if (parsed && !Array.isArray(parsed) && parsed.name) {
                logger.info(`[Cycle] Successfully generated remedial blueprint: ${parsed.name}`);
                return parsed;
            }
            return null;
        } catch (err: any) {
            logger.error(`[Cycle] Remedial synthesis failure: ${err.message}`);
            return null;
        }
    }

    /**
     * Evaluates if the current fleet reasoning is drifting away from the cycle objective.
     */
    static async detectStrategicDrift(cycleId: number) {
        return await StrategicSentinelService.auditCycleAlignment(cycleId);
    }

    /**
     * Waits for an asynchronous mission run to finish (completed, failed, or cancelled).
     */
    static async waitForMissionRunCompletion(missionRunId: number, maxWaitMs?: number): Promise<string> {
        // Event-driven primary path (POD_EVENTS), with a low-frequency heartbeat
        // reconciler to catch missed events, and a hard max-wait so a hung mission
        // (event never fires AND status never goes terminal) cannot block forever.
        const HEARTBEAT_MS = 60_000; // was 5s — event is primary, so 60s is ample (≈12× less DB load)
        const MAX_WAIT_MS = maxWaitMs && maxWaitMs > 0
            ? maxWaitMs
            : (Number(process.env.CYCLE_MISSION_MAX_WAIT_MINUTES) > 0
                ? Number(process.env.CYCLE_MISSION_MAX_WAIT_MINUTES)
                : 2880) * 60_000; // default 48h

        return new Promise<string>((resolve) => {
            const onCompleted = (event: any) => {
                if (event.payload?.missionRunId === missionRunId) { cleanup(); resolve('completed'); }
            };
            const onFailed = (event: any) => {
                if (event.payload?.missionRunId === missionRunId) { cleanup(); resolve('failed'); }
            };

            // Heartbeat reconciler (fallback for missed events)
            const interval = setInterval(async () => {
                try {
                    const [run] = await db.select({ status: missionRuns.status })
                        .from(missionRuns)
                        .where(eq(missionRuns.id, missionRunId))
                        .limit(1);
                    if (run && (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled')) {
                        cleanup();
                        resolve(run.status);
                    }
                } catch (e) {
                    // Ignore database errors during reconcile
                }
            }, HEARTBEAT_MS);

            // Hard ceiling — resolve as 'timeout' (treated as non-completed by callers)
            const maxTimer = setTimeout(() => {
                cleanup();
                logger.warn(`[Cycle] Mission run ${missionRunId} exceeded max wait of ${Math.round(MAX_WAIT_MS / 60000)}m — treating as timeout`);
                resolve('timeout');
            }, MAX_WAIT_MS);

            const cleanup = () => {
                clearInterval(interval);
                clearTimeout(maxTimer);
                eventStream.off(POD_EVENTS.MISSION.RUN_COMPLETED, onCompleted);
                eventStream.off(POD_EVENTS.MISSION.RUN_FAILED, onFailed);
            };

            eventStream.on(POD_EVENTS.MISSION.RUN_COMPLETED, onCompleted);
            eventStream.on(POD_EVENTS.MISSION.RUN_FAILED, onFailed);
        });
    }
}
