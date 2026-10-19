/**
 * Autonomous Mission Tools
 * 
 * Tools enabling Copilot and CREW agents to dispatch long-horizon tasks
 * to the background execution mesh, inspect progress, and resume paused runs.
 */

import { z } from "zod";
import type { ToolDefinition } from "./types.js";
import { dispatchAutonomousMission } from "@domain/ai/infrastructure/autonomous-mission.queue.js";
import { missionBudgetGovernor } from "@domain/ai/core/mission-budget-governor.service.js";
import { missionCheckpointService } from "@domain/ai/core/mission-checkpoint.service.js";
import { requireToolOrgId } from "./org-context.js";

export const AUTONOMOUS_MISSION_TOOLS: Record<string, ToolDefinition> = {
    dispatch_autonomous_mission: {
        name: "dispatch_autonomous_mission",
        idempotency: "none",
        label: "Dispatch Autonomous Mission",
        group: "Mission",
        description: "Dispatches a multi-step TaskManifest DAG to the background worker mesh with checkpoint recovery and budget governance.",
        parameters: z.object({
            manifest: z.any().describe("The TaskManifest DAG with goal, steps, completionCriteria, and dependencies"),
            tokenBudget: z.number().optional().default(100000).describe("Token ceiling allocated for this mission"),
            missionId: z.string().optional().describe("Unique identifier for this mission"),
        }),
        execute: async (params: any, context?: any) => {
            try {
                const orgId = requireToolOrgId(context);
                const sessionId = String(context?.sessionId || context?.sessionKey || `session-${Date.now()}`);
                const agentId = context?.agentId || 1;
                const missionId = params.missionId || `mission-${Date.now()}`;

                const job = await dispatchAutonomousMission({
                    missionId,
                    sessionId,
                    agentId,
                    organizationId: orgId,
                    manifest: params.manifest,
                    tokenBudget: params.tokenBudget,
                    resumeFromCheckpoint: false,
                });

                return JSON.stringify({
                    success: true,
                    jobId: job.id,
                    missionId,
                    sessionId,
                    tokenBudget: params.tokenBudget,
                    message: `Autonomous mission ${missionId} dispatched to background queue.`,
                });
            } catch (err: any) {
                return `Error dispatching autonomous mission: ${err.message}`;
            }
        },
    },

    get_autonomous_mission_status: {
        name: "get_autonomous_mission_status",
        idempotency: "read-safe",
        label: "Get Autonomous Mission Status",
        group: "Mission",
        description: "Checks real-time progress, latest verified checkpoint, and token burn rate for an autonomous mission.",
        parameters: z.object({
            sessionId: z.string().describe("The session identifier"),
            missionId: z.string().describe("The mission identifier"),
        }),
        execute: async (params: any) => {
            try {
                const latestCheckpoint = await missionCheckpointService.getLatestCheckpoint(params.sessionId);
                const budget = await missionBudgetGovernor.getMissionBudget(params.sessionId, params.missionId);

                return JSON.stringify({
                    success: true,
                    sessionId: params.sessionId,
                    missionId: params.missionId,
                    status: latestCheckpoint ? latestCheckpoint.status : "pending",
                    currentStepId: latestCheckpoint?.stepId,
                    completedSteps: latestCheckpoint?.completedStepIds || [],
                    consecutiveFailures: latestCheckpoint?.consecutiveFailures || 0,
                    budget: budget
                        ? {
                              tokensUsed: budget.tokensUsed,
                              tokenBudget: budget.tokenBudget,
                              costUsedUsd: budget.costUsedUsd,
                              status: budget.status,
                          }
                        : null,
                });
            } catch (err: any) {
                return `Error fetching mission status: ${err.message}`;
            }
        },
    },

    resume_autonomous_mission: {
        name: "resume_autonomous_mission",
        idempotency: "none",
        label: "Resume Autonomous Mission",
        group: "Mission",
        description: "Resumes a paused, crashed, or budget-paused mission from its latest verified checkpoint.",
        parameters: z.object({
            missionId: z.string().describe("The mission identifier to resume"),
            sessionId: z.string().describe("The session identifier"),
            manifest: z.any().describe("The original or updated TaskManifest DAG"),
            additionalTokenBudget: z.number().optional().describe("Additional tokens to allocate if resuming from budget pause"),
        }),
        execute: async (params: any, context?: any) => {
            try {
                const orgId = requireToolOrgId(context);
                const agentId = context?.agentId || 1;

                if (params.additionalTokenBudget) {
                    await missionBudgetGovernor.increaseBudget(
                        params.sessionId,
                        params.missionId,
                        params.additionalTokenBudget
                    );
                }

                const job = await dispatchAutonomousMission({
                    missionId: params.missionId,
                    sessionId: params.sessionId,
                    agentId,
                    organizationId: orgId,
                    manifest: params.manifest,
                    resumeFromCheckpoint: true,
                });

                return JSON.stringify({
                    success: true,
                    jobId: job.id,
                    missionId: params.missionId,
                    sessionId: params.sessionId,
                    resumedFromCheckpoint: true,
                    message: `Autonomous mission ${params.missionId} resumed from latest checkpoint.`,
                });
            } catch (err: any) {
                return `Error resuming autonomous mission: ${err.message}`;
            }
        },
    },
};
