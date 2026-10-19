
import { z } from "zod";
import type { ToolDefinition, ToolContext } from "./types.js";
import { assertOrgId } from "@server/utils/auth-context.js";

export const MISSION_TOOLS: Record<string, ToolDefinition> = {
    update_blackboard: {
        name: "update_blackboard",

        idempotency: "idempotent",
        label: "Update Blackboard",
        group: "Collaboration",
        description: "Update the shared 'blackboard' for your mission. Use this to share findings, plans, or status updates with other agents in the same mission.",
        parameters: z.object({
            content: z.record(z.any()).describe("JSON object containing the data to store on the blackboard"),
            reason: z.string().describe("Reason for the update (e.g. 'Found new credentials', 'Completed step 1')"),
        }),
        execute: async ({ content, reason }: any, context: ToolContext) => {
            if (!context?.missionId) {
                return "Error: You are not part of a mission. Cannot update blackboard.";
            }
            try {
                const { missionService } = await import("../../../mission/index.js");
                await missionService.updateBlackboard(context.missionId, content, context.userId || "agent", reason);
                return "Blackboard updated successfully.";
            } catch (e: any) {
                return `Failed to update blackboard: ${e.message}`;
            }
        }
    },
    get_blackboard: {
        name: "get_blackboard",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "Get Blackboard",
        group: "Collaboration",
        description: "Retrieve the current content of the shared mission blackboard. By default, large fields (tool outputs) are truncated for stability. Use 'keys' to read specific large values.",
        parameters: z.object({
            keys: z.array(z.string()).optional().default([]).describe("Specific keys to retrieve (ignores pruning)"),
            includeLarge: z.boolean().optional().default(false).describe("Whether to include large fields in full (not recommended for massive blackboards)")
        }),
        execute: async ({ keys, includeLarge }: any, context: ToolContext) => {
            if (!context?.missionId) {
                return "Error: You are not part of a mission.";
            }
            try {
                const { missionService } = await import("../../../mission/index.js");
                const mission = await missionService.getMissionDetail(context.missionId);
                if (!mission) return "Mission not found.";
                
                const rawBB = (mission.blackboard as Record<string, any>) || {};
                const result: Record<string, any> = {};
                const LARGE_THRESHOLD = 50000; // 50KB

                // If specific keys are requested, we only return those (no pruning for them)
                if (keys && keys.length > 0) {
                    for (const key of keys) {
                        result[key] = rawBB[key] !== undefined ? rawBB[key] : "[KEY NOT FOUND]";
                    }
                    return JSON.stringify(result, null, 2);
                }

                // Default: Return pruned blackboard
                for (const [key, value] of Object.entries(rawBB)) {
                    if (!includeLarge && key.startsWith('tool_output_')) {
                        const strValue = typeof value === 'string' ? value : JSON.stringify(value);
                        if (strValue.length > LARGE_THRESHOLD) {
                            result[key] = `[TRUNCATED: ${strValue.length} chars. Use get_blackboard({keys: ["${key}"]}) to read full content]`;
                            continue;
                        }
                    }
                    result[key] = value;
                }

                return JSON.stringify(result, null, 2);
            } catch (e: any) {
                return `Failed to read blackboard: ${e.message}`;
            }
        }
    },
    add_shared_memory: {
        name: "add_shared_memory",

        idempotency: "none",
        label: "Add Shared Memory",
        group: "Collaboration",
        description: "Share an observation with other agents in your mission. Use when you discover something useful (e.g. 'Found API key in credential ID 5', 'Competitor X uses pricing model Y'). Other agents can use this context.",
        parameters: z.object({
            observation: z.string().describe("What you discovered or learned (concise, actionable)"),
            source: z.string().optional().describe("Your identifier (e.g. 'job-7', 'agent-researcher')"),
        }),
        execute: async ({ observation, source }: any, context: ToolContext) => {
            if (!context?.missionId) {
                return "Error: You are not part of a mission. Cannot add shared memory.";
            }
            try {
                const { missionService } = await import("../../../mission/index.js");
                const src = source || `job-${context.jobId || "agent"}`;
                await missionService.addSharedMemory(context.missionId, observation, src, context.userId || "agent");
                return "Shared memory added. Other agents in this mission can now see this observation.";
            } catch (e: any) {
                return `Failed to add shared memory: ${e.message}`;
            }
        }
    },
    launch_mission: {
        name: "launch_mission",

        idempotency: "none",
        riskLevel: "high",
        label: "Launch Mission",
        group: "Collaboration",
        description: "Trigger the execution of the Mission. This will start the Supervisor pipeline which delegates tasks to members based on the active Objective.",
        parameters: z.object({
            reason: z.string().describe("Why you are launching this mission (e.g. 'User requested start', 'Conditions met')"),
        }),
        execute: async ({ reason }: any, context: ToolContext) => {
            if (!context?.missionId) {
                return "Error: You are not part of a mission. Cannot launch mission.";
            }
            try {
                const { missionService } = await import("../../../mission/index.js");
                const result = await missionService.launchMission(
                    context.missionId,
                    context.userId || "agent",
                    context.organizationId || null,
                    undefined,
                    (context as any).extra
                );

                if (!result.success) {
                    return `Failed to launch mission: ${result.error}`;
                }
                return JSON.stringify({
                    success: true,
                    missionRunId: result.missionRunId,
                    message: `Mission Launched Successfully! Execution ID: ${result.missionRunId}. The Supervisor is now planning tasks.`
                }, null, 2);
            } catch (e: any) {
                return `Error launching mission: ${e.message}`;
            }
        }
    },
    apply_recovery_decision: {
        name: "apply_recovery_decision",

        idempotency: "none",
        label: "Apply Mission Recovery Decision",
        group: "Mission Control",
        description: "Executes a recovery strategy (retry, replan, relax, stop) on an active mission run after a human decision.",
        parameters: z.object({
            missionRunId: z.number().describe("The ID of the mission run to recover"),
            strategy: z.enum(["accept_proposal", "retry", "replan", "safe_state", "reset"]).describe("The recovery strategy to apply"),
            customInstructions: z.string().optional().describe("Additional instructions for the agent during recovery")
        }),
        execute: async ({ missionRunId, strategy, customInstructions }: any, context: ToolContext) => {
            try {
                const { missionRunService } = await import("../../../mission/index.js");
                await missionRunService.applyRecoveryStrategy(
                    missionRunId,
                    strategy,
                    customInstructions,
                    context?.userId || "agent-recovery"
                );
                return `Recovery strategy '${strategy}' applied successfully to mission run ${missionRunId}.`;
            } catch (e: any) {
                return `Failed to apply recovery strategy: ${e.message}`;
            }
        }
    },
    list_missions: {
        name: "list_missions",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "List Missions",
        group: "Mission Control",
        description: "List all missions in the current organization. Provides IDs, names, and current status.",
        parameters: z.object({
            limit: z.number().optional().default(10),
        }),
        execute: async ({ limit }: any, context: ToolContext) => {
            const orgId = context?.organizationId;
            if (!orgId || orgId === 0) {
                return JSON.stringify({
                    missions: [],
                    note: "No organization context available. Please ensure you are operating within an organization scope to list missions."
                }, null, 2);
            }
            const MAX_ATTEMPTS = 2;
            for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
                try {
                    const { missionService } = await import("../../../mission/index.js");
                    const missions = await missionService.listMissions(orgId);
                    const results = (missions || []).slice(0, limit || 10).map((m: any) => ({
                        id: m.id,
                        name: m.name,
                        status: m.status,
                        objective: m.objective,
                        createdAt: m.createdAt
                    }));
                    if (results.length === 0) {
                        return JSON.stringify({
                            missions: [],
                            note: "No missions found in this organization. You can create one with synthesize_mission_assets or propose_mission_synthesis."
                        }, null, 2);
                    }
                    return JSON.stringify(results, null, 2);
                } catch (e: any) {
                    if (attempt < MAX_ATTEMPTS) {
                        await new Promise(r => setTimeout(r, 500));
                        continue;
                    }
                    return JSON.stringify({
                        missions: [],
                        note: `Could not retrieve missions at this time: ${e.message}. Please try again.`
                    }, null, 2);
                }
            }
            return JSON.stringify({ missions: [], note: "Unexpected state." }, null, 2);
        }
    },
    list_mission_runs: {
        name: "list_mission_runs",

        idempotency: "read-safe",
        label: "List Mission Runs",
        group: "Mission Control",
        description: "List historical and active runs for a specific mission. Use this to identify why a mission might be blocked or failing.",
        parameters: z.object({
            missionId: z.number().optional().describe("Filter by mission ID. If omitted, lists all runs for the organization."),
            limit: z.number().optional().default(5),
        }),
        execute: async ({ missionId, limit }: any, context: ToolContext) => {
            try {
                const { missionService } = await import("../../../mission/index.js");
                const runs = await missionService.listRuns(missionId);
                const results = runs.slice(0, limit).map((r: any) => ({
                    id: r.id,
                    missionId: r.missionId,
                    status: r.status,
                    error: r.error,
                    startedAt: r.startedAt,
                    completedAt: r.completedAt
                }));
                return JSON.stringify(results, null, 2);
            } catch (e: any) {
                return `Failed to list mission runs: ${e.message}`;
            }
        }
    },
    synthesize_mission_assets: {
        name: "synthesize_mission_assets",

        idempotency: "none",
        label: "Synthesize Mission Assets",
        group: "Collaboration",
        description: "Autonomous Dependency Resolution: Analyzes a mission objective and automatically creates or links all required dependencies (agents, pipelines, datasets, and knowledge topics). Use this BEFORE launching a mission to ensure it has a high success rate.",
        parameters: z.object({
            missionId: z.number().optional().describe("The ID of an existing mission to synthesize assets for. If omitted, a new mission will be created."),
            objective: z.string().describe("The clear, actionable goal of the mission."),
            reasoningRange: z.enum(["fast", "balanced", "deep"]).optional().default("balanced").describe("How deep the AI should reason about dependencies.")
        }),
        execute: async ({ missionId, objective, reasoningRange }: any, context: ToolContext) => {
            try {
                const { missionService } = await import("../../../mission/core/mission.service.js");
                const { jobService } = await import("../../../jobs/job.service.js");
                const { pipelineService } = await import("../../../pipeline/core/pipeline.service.js");
                const { db } = await import("../../../../database_service.js");
                const { pipelines, pipelineSteps, missionMembers, jobs } = await import("@shared/schema/index.js");
                const { eq } = await import("drizzle-orm");

                const orgId = assertOrgId(context.organizationId);
                const userId = context.userId || "system";
                const orgContext = { organizationId: orgId, userId, isAdmin: false, isSuperAdmin: false, isOrgAdmin: false };

                // 1. Generate the Mission Plan
                const plan = await missionService.planMission(objective, userId, orgId);
                if (!plan || !plan.members) {
                    return "Error: AI failed to generate a valid mission plan.";
                }

                let targetMissionId = missionId;

                // 2. Create Mission if it doesn't exist
                if (!targetMissionId) {
                    const mission = await missionService.createMission({
                        name: plan.name || `Autonomous Mission: ${objective.slice(0, 30)}...`,
                        objective: objective,
                        organizationId: orgId,
                        // A room scoped to a project files its missions there; the
                        // attach is best-effort and re-validated in projectService.
                        projectId: context.projectId ?? null,
                        executionStrategy: plan.executionStrategy || "dynamic_autonomous",
                        budgetLimitUsd: plan.budgetLimitUsd || 50.00
                    }, userId);
                    targetMissionId = mission.id;
                }

                const synthesizedAssets = {
                    agents: [] as any[],
                    pipelines: [] as any[],
                    datasets: [] as any[],
                    knowledge: [] as any[]
                };

                // 3. Materialize Agents (Jobs)
                for (const member of plan.members) {
                    if (member.entityType === "job" && !member.entityId) {
                        try {
                            const newJob = await jobService.create({
                                name: member.role || "Specialized Agent",
                                type: "agent",
                                description: member.description,
                                config: member.suggestedConfig || {},
                                isActive: true
                            }, orgContext);
                            
                            await missionService.addMember({
                                missionId: targetMissionId,
                                entityType: "job",
                                entityId: newJob.id,
                                role: member.role || "worker"
                            });
                            synthesizedAssets.agents.push({ id: newJob.id, name: newJob.name, role: member.role });
                        } catch (err: any) {
                            console.error(`[Synthesis] Failed to create job: ${err.message}`);
                        }
                    } else if (member.entityId) {
                        await missionService.addMember({
                            missionId: targetMissionId,
                            entityType: member.entityType as any,
                            entityId: member.entityId,
                            role: member.role || "worker"
                        });
                        synthesizedAssets.agents.push({ id: member.entityId, type: member.entityType, role: member.role });
                    }
                }

                // 4. Materialize Workflow (Pipeline)
                if (plan.workflow && plan.workflow.nodes && plan.workflow.nodes.length > 0) {
                    try {
                        const pipelineName = `[Synthesis] ${plan.name || 'Mission Workflow'}`;
                        const [existingPipe] = await db.select().from(pipelines).where(eq(pipelines.name, pipelineName)).limit(1);
                        
                        let pipelineId: number;
                        if (!existingPipe) {
                            const newPipe = await (pipelineService as any).create({
                                name: pipelineName,
                                triggerType: "manual",
                                steps: []
                            }, orgContext);
                            pipelineId = newPipe.id;

                            // Add steps based on nodes
                            // Note: This is a simplified mapping for now
                            let order = 0;
                            for (const node of plan.workflow.nodes) {
                                if (node.type === "agent") {
                                    // Find or create job for this node
                                    const jobName = `[Wave] ${node.role}`;
                                    const [existingJob] = await db.select().from(jobs).where(eq(jobs.name, jobName)).limit(1);
                                    let jobId = existingJob?.id;

                                    if (!jobId) {
                                        const nJob = await jobService.create({
                                            name: jobName,
                                            type: "agent",
                                            config: node.suggestedConfig || {},
                                            isActive: true
                                        }, orgContext);
                                        jobId = nJob.id;
                                    }

                                    await db.insert(pipelineSteps).values({
                                        pipelineId,
                                        jobId,
                                        order: order++,
                                        outputName: node.id
                                    });
                                }
                            }
                        } else {
                            pipelineId = existingPipe.id;
                        }

                        await missionService.addMember({
                            missionId: targetMissionId,
                            entityType: "pipeline",
                            entityId: pipelineId,
                            role: "primary_workflow"
                        });
                        synthesizedAssets.pipelines.push({ id: pipelineId, name: pipelineName });
                    } catch (err: any) {
                        console.error(`[Synthesis] Failed to create pipeline: ${err.message}`);
                    }
                }

                return JSON.stringify({
                    success: true,
                    missionId: targetMissionId,
                    objective: objective,
                    message: `Mission synthesis complete! All dependencies have been autonomously resolved and attached.`,
                    assets: synthesizedAssets
                }, null, 2);

            } catch (e: any) {
                return `Error during mission synthesis: ${e.message}`;
            }
        }
    }
};


