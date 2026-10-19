
import { db } from "@server/database_service.js";
import { missionRuns, pipelineExecutions, mcpServers, missions } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { missionRunService } from "../core/mission-run.service.js";

const logger = createLogger("RescueStrategyFactory");

/** Strategies that are tracked for KB question engine rescue pattern detection. */
const TRACKED_STRATEGIES = new Set(["retry", "relax", "skip", "replan"]);

export interface RescueDecision {
    strategy: string;
    customInstructions?: string;
    userId?: string;
    proposedAction?: any;
}

export class RescueStrategyFactory {
    static async apply(missionRunId: number, decision: RescueDecision): Promise<void> {
        const { strategy, customInstructions, userId, proposedAction } = decision;
        logger.info(`[RescueStrategyFactory] Executing strategy: ${strategy} for MissionRun ${missionRunId}`);

        const mission = await missionRunService.getByIdOrThrow(missionRunId);
        const missionId = mission.missionId;
        if (missionId === null) {
            throw new Error(`MissionRun ${missionRunId} is not associated with a Mission.`);
        }
        const changedBy = userId || "system-recovery";

        switch (strategy) {
            case "accept_proposal":
                await this.handleAcceptProposal(missionRunId, missionId, customInstructions, changedBy, proposedAction);
                break;
            case "retry":
                await this.handleRetry(missionRunId, missionId, customInstructions, changedBy);
                break;
            case "replan":
                await this.handleReplan(missionRunId, missionId, customInstructions, changedBy);
                break;
            case "approve_tool":
                await this.handleApproveTool(missionRunId, missionId, customInstructions, changedBy, proposedAction);
                break;
            case "reject_tool":
                await this.handleRejectTool(missionRunId, missionId, customInstructions, changedBy, proposedAction);
                break;
            case "skip":
                await this.handleSkip(missionRunId, missionId, customInstructions, changedBy, proposedAction);
                break;
            case "relax":
                await this.handleRelax(missionRunId, missionId, customInstructions, changedBy, proposedAction);
                break;
            case "reset":
                await this.handleReset(missionRunId, missionId, changedBy);
                break;
            case "safe_state":
                await this.handleSafeState(missionRunId, missionId, changedBy);
                break;
            default:
                throw new Error(`Unknown recovery strategy: ${strategy}`);
        }

        // Fire-and-forget: record rescue event for KB question engine pattern detection
        if (TRACKED_STRATEGIES.has(strategy) && mission.organizationId) {
            this.recordRescueEvent(mission, missionRunId, strategy).catch(() => {});
        }
    }

    /**
     * Non-blocking rescue event recording for KB question engine pattern detection.
     * Derives repositoryId from the parent mission and jobType from missionContext.
     */
    private static async recordRescueEvent(
        missionRun: { missionId: number | null; organizationId: number | null; missionContext: unknown },
        missionRunId: number,
        strategy: string
    ): Promise<void> {
        try {
            const { rescueStrategyTrackerService } = await import("@domain/agents/core/kb-extensions/index.js");

            // Derive repositoryId from parent mission (workspacePath or vcsConfig.remote)
            let repositoryId = "default-repo";
            if (missionRun.missionId) {
                const [parentMission] = await db
                    .select({ workspacePath: missions.workspacePath, vcsConfig: missions.vcsConfig })
                    .from(missions)
                    .where(eq(missions.id, missionRun.missionId))
                    .limit(1);
                if (parentMission) {
                    const vcs = parentMission.vcsConfig as any;
                    if (vcs?.remote) {
                        repositoryId = vcs.remote;
                    } else if (parentMission.workspacePath) {
                        repositoryId = parentMission.workspacePath;
                    }
                }
            }

            // Derive jobType from missionContext (best-effort)
            const ctx = missionRun.missionContext as Record<string, any> | null;
            const jobType = ctx?.jobType || ctx?.currentJobType || strategy;

            rescueStrategyTrackerService.recordAndCheck(
                missionRun.organizationId!,
                repositoryId,
                {
                    strategy,
                    jobType,
                    missionRunId,
                    timestamp: Date.now(),
                }
            ).catch(() => {});
        } catch {
            // Swallow all errors — this is fire-and-forget
        }
    }

    private static async handleApproveTool(missionRunId: number, missionId: number, instructions: string | undefined, userId: string, params: any) {
        const toolName = params?.toolName;
        if (!toolName) throw new Error("Tool name is required for approval.");

        logger.info(`[RescueStrategyFactory] Approving tool activation for: ${toolName}`);

        const mission = await missionRunService.getByIdOrThrow(missionRunId);

        // 1. Activate the MCP Server globally (or per-org if scoped)
        await db.update(mcpServers)
            .set({ status: "active", updatedAt: new Date() })
            .where(eq(mcpServers.name, toolName));

        // 2. Update context and resume
        const note = `Administrator APPROVED activation of "${toolName}". Capability is now ENROLLED. ${instructions || ""}`;
        const context = await this.getMergedContext(missionRunId, { lastUserGuidance: note });

        await missionRunService.update(missionRunId, { status: "active", missionContext: context });
        await this.checkpoint(missionRunId, missionId, context, `capability_enrolled:${toolName}`, userId);
        await this.resumePipeline(missionRunId);
    }

    private static async handleRejectTool(missionRunId: number, missionId: number, instructions: string | undefined, userId: string, params: any) {
        const toolName = params?.toolName;
        logger.warn(`[RescueStrategyFactory] Rejecting tool activation for: ${toolName}`);

        const note = `Administrator REJECTED activation of "${toolName}". You must find an alternative way to complete the objective. ${instructions || ""}`;
        const context = await this.getMergedContext(missionRunId, { lastUserGuidance: note });

        await missionRunService.update(missionRunId, { status: "active", missionContext: context });
        await this.checkpoint(missionRunId, missionId, context, `capability_denied:${toolName}`, userId);
        await this.resumePipeline(missionRunId);
    }

    private static async handleAcceptProposal(missionRunId: number, missionId: number, instructions: string | undefined, userId: string, proposedAction: any) {
        let note = "User accepted the Mission Commander's recommendation.";
        if (instructions) note += ` Additional guidance: ${instructions}`;

        const context = await this.getMergedContext(missionRunId, {
            lastUserGuidance: note,
            lastProposedAction: proposedAction
        });

        await missionRunService.update(missionRunId, { status: "active", missionContext: context });
        await this.checkpoint(missionRunId, missionId, context, `recovery_applied:accept_proposal`, userId);
        await this.resumePipeline(missionRunId);
    }

    private static async handleRetry(missionRunId: number, missionId: number, instructions: string | undefined, userId: string) {
        const mission = await missionRunService.getByIdOrThrow(missionRunId);
        if (mission.pipelineExecutionId) {
            const [exec] = await db.select().from(pipelineExecutions).where(eq(pipelineExecutions.id, mission.pipelineExecutionId)).limit(1);
            if (exec?.contextSnapshot) {
                const plan = exec.contextSnapshot as any;
                if (plan.tasks) {
                    plan.tasks.forEach((t: any) => { if (t.status === "failed") t.status = "pending"; });
                }
                await db.update(pipelineExecutions).set({ contextSnapshot: plan, status: "running" }).where(eq(pipelineExecutions.id, mission.pipelineExecutionId));
            }
        }
        await missionRunService.update(missionRunId, { status: "active" });
        await this.checkpoint(missionRunId, missionId, mission.missionContext as any, `recovery_applied:retry`, userId);
        await this.resumePipeline(missionRunId);
    }

    private static async handleReplan(missionRunId: number, missionId: number, instructions: string | undefined, userId: string) {
        const mission = await missionRunService.getByIdOrThrow(missionRunId);
        if (mission.pipelineExecutionId) {
            const [exec] = await db.select().from(pipelineExecutions).where(eq(pipelineExecutions.id, mission.pipelineExecutionId)).limit(1);
            if (exec?.contextSnapshot) {
                const plan = exec.contextSnapshot as any;
                plan.replanCount = (plan.replanCount || 0) + 1;
                plan.currentContext = (plan.currentContext || "") + `\nMANUAL REPLAN TRIGGERED: ${instructions || "No specific instructions"}`;
                await db.update(pipelineExecutions).set({ contextSnapshot: plan, status: "running" }).where(eq(pipelineExecutions.id, mission.pipelineExecutionId));
            }
        }
        await missionRunService.update(missionRunId, { status: "active" });
        await this.checkpoint(missionRunId, missionId, mission.missionContext as any, `recovery_applied:replan`, userId);
        await this.resumePipeline(missionRunId);
    }

    private static async handleRelax(missionRunId: number, missionId: number, instructions: string | undefined, userId: string, action: any) {
        const guidance = `RELAXING CONSTRAINT: ${action?.constraint || "Generic Constraint"}. ${instructions || ""}`;
        const context = await this.getMergedContext(missionRunId, { lastUserGuidance: guidance });
        await missionRunService.update(missionRunId, { status: "active", missionContext: context });
        await this.checkpoint(missionRunId, missionId, context, `recovery_applied:relax_constraint`, userId);
        await this.resumePipeline(missionRunId);
    }

    private static async handleSkip(missionRunId: number, missionId: number, instructions: string | undefined, userId: string, action: any) {
        const guidance = `SKIPPING BLOCKED TASK: ${action?.taskId || "Unknown"}. ${instructions || ""}`;
        const context = await this.getMergedContext(missionRunId, { lastUserGuidance: guidance });
        await missionRunService.update(missionRunId, { status: "active", missionContext: context });
        await this.checkpoint(missionRunId, missionId, context, `recovery_applied:skip_task`, userId);
        await this.resumePipeline(missionRunId);
    }

    private static async handleSafeState(missionRunId: number, missionId: number, userId: string) {
        await missionRunService.update(missionRunId, { status: "paused" });
        await this.checkpoint(missionRunId, missionId, {}, `recovery_applied:safe_state`, userId);
    }

    private static async handleReset(missionRunId: number, missionId: number, userId: string) {
        await missionRunService.update(missionRunId, { status: "failed" });
        await this.checkpoint(missionRunId, missionId, {}, `recovery_applied:abort`, userId);
    }

    private static async getMergedContext(missionRunId: number, extra: Record<string, any>) {
        const mission = await missionRunService.getByIdOrThrow(missionRunId);
        return { ...(mission.missionContext as Record<string, any>), ...extra };
    }

    private static async checkpoint(missionRunId: number, missionId: number, context: any, reason: string, userId: string) {
        await missionRunService.checkpoint({ missionRunId, missionId, missionContext: context, reason, changedBy: userId });
    }

    private static async resumePipeline(missionRunId: number) {
        const mission = await missionRunService.getByIdOrThrow(missionRunId);
        if (mission.pipelineExecutionId) {
            const { pipelineExecutor } = await import("../../../core/pipeline-executor.js");
            await pipelineExecutor.resumePipelineExecution(mission.pipelineExecutionId);
        }
    }
}


