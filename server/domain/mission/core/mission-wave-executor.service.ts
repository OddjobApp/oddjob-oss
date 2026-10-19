
import { db } from "@server/database_service.js";
import { missionRuns, missionStepAssignments, missions, users } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { getSystemOrgContext } from "@server/utils/auth-context.js";
import { createRootTrace, createChildSpan, generateTraceparent } from "@domain/core/infrastructure/tracing/trace-context.service.js";
import { READ_ONLY_TOOLS, RESERVED_STEP_TOOLS } from "@server/config/tools.js";
import { DEFAULT_BUDGET_LIMIT } from "../utils/mission-types.js";
import { lnnCoreService } from "../../agents/core/liquid-nn/index.js";
import { executionFlowService } from "../../agents/core/execution-visualizer/execution-flow.service.js";


const logger = createLogger("MissionWaveExecutor");

export interface ExecutionResult {
    success: boolean;
    error?: string;
    /**
     * Concatenated summary of this wave's tool outputs. Fed into the blackboard as
     * `latest_wave_output` so the vibe critic has the actual produced work to audit
     * (without it, the critic always sees "No output captured yet." and never converges).
     */
    output?: string;
}

export class MissionWaveExecutorService {
    /**
     * Executes a wave blueprint by dispatching tool calls in parallel and sequential batches.
     */
    static async execute(missionRunId: number, blueprint: any, userId: string, orgId: number | null, appendTrace: (id: number, entry: any) => void): Promise<ExecutionResult> {
        const [run] = await db.select().from(missionRuns).where(eq(missionRuns.id, missionRunId)).limit(1);
        if (!run) return { success: false, error: "Run not found" };

        // Accumulates each tool's output so the wave can report what it actually produced
        // (surfaced to the blackboard as latest_wave_output for the vibe critic to audit).
        const waveOutputs: string[] = [];

        // --- HARD BUDGET ENFORCEMENT ---
        if (run.missionId) {
            try {
                const { missionQueryService } = await import("./mission-query.service.js");
                const { approvalService } = await import("../../integrations/core/approval.service.js");
                
                const [missionData] = await db.select().from(missions).where(eq(missions.id, run.missionId)).limit(1);
                const currentSpend = await missionQueryService.calculateTotalSpend(run.missionId);
                const budgetLimit = missionData?.budgetLimitUsd ? parseFloat(String(missionData.budgetLimitUsd)) : DEFAULT_BUDGET_LIMIT;

                if (currentSpend > budgetLimit) {
                    logger.warn(`[Executor] Budget exceeded for Run ${missionRunId}: $${currentSpend.toFixed(2)} > $${budgetLimit.toFixed(2)}`);
                    
                    appendTrace(missionRunId, { 
                        type: "system", 
                        event: "budget_exceeded", 
                        note: `Budget exceeded: $${currentSpend.toFixed(2)} > $${budgetLimit.toFixed(2)}. Pausing cycle for approval.` 
                    });

                    // Create HIL Approval Request
                    const [userData] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
                    const approverEmail = userData?.email || "unknown@example.com";

                    const approvalRequest = await approvalService.createApprovalRequest({
                        executionId: String(missionRunId),
                        jobId: 1, // Default supervisor job ID
                        approverType: "user",
                        approverEmail,
                        approverId: userId,
                        status: "pending",
                        organizationId: orgId || undefined,
                        context: {
                            reason: "Budget Exceeded",
                            currentSpend,
                            budgetLimit,
                            message: `Cycle has consumed $${currentSpend.toFixed(2)}, exceeding the limit of $${budgetLimit.toFixed(2)}.`
                        }
                    });

                    // Pause the mission run
                    await db.update(missionRuns)
                        .set({ 
                            status: "waiting_on_human",
                            resumeCondition: {
                                type: "human_approval",
                                approvalRequestIds: [approvalRequest.id]
                            }
                        })
                        .where(eq(missionRuns.id, missionRunId));

                    return { success: false, error: "Budget exceeded. Paused for approval." };
                }
            } catch (budgetErr: any) {
                logger.warn(`[Executor] Budget check failed: ${budgetErr.message}`);
                // Continue execution if check fails (don't block mission on telemetry failure)
            }
        }

        const { handleToolCall } = await import("@server/mcp/handlers.js");
        const workflow = blueprint.workflow || {};
        const steps = (workflow.steps || []).filter((step: any) => {
            const tool = step.tool?.toLowerCase();
            return !RESERVED_STEP_TOOLS.some(reserved => tool.includes(reserved));
        });

        // Start Execution Flow Tracing (opt-in via ENABLE_EXECUTION_FLOW_TRACING=true)
        const sessionId = `cycle-${run.missionId}`;
        let previousNodeId: string | null = null;
        const flowTracingEnabled = process.env.ENABLE_EXECUTION_FLOW_TRACING === "true";
        if (orgId && flowTracingEnabled) {
            try {
                executionFlowService.startFlow(sessionId, "wave-executor", orgId, { layout: "vertical" });
                const startNode = executionFlowService.addNode(sessionId, {
                    type: "action",
                    label: "Start Execution",
                    description: `Objective: ${blueprint.objective || "Execute mission wave"}`,
                    status: "completed",
                    metadata: {},
                });
                previousNodeId = startNode.id;
            } catch (flowErr: any) {
                logger.warn(`[Executor] Execution flow init failed: ${flowErr.message}`);
            }
        }


        // 1. Setup Step Assignment for UI tracking
        const [assignment] = await db.insert(missionStepAssignments).values({
            missionRunId,
            pipelineExecutionId: 0,
            pipelineStepId: 0,
            jobType: "rolling_wave_step",
            status: "active",
            jobConfig: { objective: blueprint.objective, steps: steps.length },
            organizationId: orgId,
        }).returning({ id: missionStepAssignments.id });

        // 2. Separate into batches
        const parallelBatch = steps.filter((s: any) => READ_ONLY_TOOLS.some(t => s.tool?.toLowerCase().includes(t)));
        const sequentialBatch = steps.filter((s: any) => !READ_ONLY_TOOLS.some(t => s.tool?.toLowerCase().includes(t)));

        // --- LNN MONITORING ---
        const agentName = `MissionRun-${missionRunId}`;
        let lnnAgent = lnnCoreService.getAllAgents().find(a => a.name === agentName);
        if (!lnnAgent) {
            try {
                lnnAgent = await lnnCoreService.createAgent(agentName, 'monitoring', { 
                    numNeurons: 16,
                    inputDim: 3,
                    outputDim: 1
                });
            } catch (e: any) {
                logger.warn(`[Executor] Failed to create LNN agent: ${e.message}`);
            }
        }

        if (lnnAgent) {
            try {
                const totalSteps = Math.max(parallelBatch.length + sequentialBatch.length, 1);
                const input = [
                    parallelBatch.length / totalSteps,  // parallel ratio
                    sequentialBatch.length / totalSteps, // sequential ratio
                    Math.min(totalSteps / 20, 1),        // step-load pressure (0–1, saturates at 20 steps)
                ];
                const lnnResult = await lnnCoreService.forward(lnnAgent.id, input);
                logger.info(`[Executor] LNN Monitoring output: ${lnnResult.output.map(o => o.toFixed(2)).join(', ')}`);
                appendTrace(missionRunId, { 
                    type: "system", 
                    event: "lnn_monitoring", 
                    note: `LNN State Coherence: ${lnnResult.activations.reduce((a: any, b: any) => a + b, 0).toFixed(2)}` 
                });
            } catch (e: any) {
                logger.warn(`[Executor] LNN forward failed: ${e.message}`);
            }
        }

        try {
            // 3. EXECUTE PARALLEL BATCH
            if (parallelBatch.length > 0) {
                logger.info(`[Executor] Running ${parallelBatch.length} parallel read tools for Run ${missionRunId}`);
                
                let parallelNodeId: string | null = null;
                if (previousNodeId) {
                    try {
                        const parallelNode = executionFlowService.addNode(sessionId, {
                            type: "action",
                            label: "Parallel Batch",
                            description: `Executing ${parallelBatch.length} parallel read tools`,
                            status: "completed",
                            metadata: {},
                        });
                        parallelNodeId = parallelNode.id;
                        executionFlowService.addEdge(sessionId, { source: previousNodeId, target: parallelNodeId, type: "default" });
                        previousNodeId = parallelNodeId;
                    } catch (flowErr: any) {
                        logger.warn(`[Executor] Flow parallel-batch node failed: ${flowErr.message}`);
                    }
                }

                await Promise.all(parallelBatch.map(async (step: any) => {
                    if (parallelNodeId) {
                        try {
                            const stepNode = executionFlowService.addNode(sessionId, {
                                type: "tool_call",
                                label: step.tool,
                                description: `Arguments: ${JSON.stringify(step.arguments)}`,
                                status: "completed",
                                metadata: { toolName: step.tool },
                            });
                            executionFlowService.addEdge(sessionId, { source: parallelNodeId!, target: stepNode.id, type: "default" });
                        } catch { /* non-fatal */ }
                    }
                    appendTrace(missionRunId, { type: "system", event: "executing_tool_parallel", note: `Invoking ${step.tool} (Parallel)` });
                    try {
                        const trace = createRootTrace();
                        const toolResult = await handleToolCall(step.tool, step.arguments, {
                            ...getSystemOrgContext(orgId),
                            userId,
                            missionId: run.missionId!,
                            missionRunId: run.id,
                            traceId: trace.traceId,
                            spanId: trace.spanId,
                            traceparent: generateTraceparent(trace),
                            named: {}, positional: {}
                        });
                        const out = this.appendToolResult(missionRunId, toolResult, step.tool, appendTrace);
                        if (out) waveOutputs.push(`[${step.tool}]\n${out}`);
                    } catch (err: any) {
                        appendTrace(missionRunId, { type: "error", event: "tool_failed", error: err.message, tool: step.tool });
                    }
                }));
            }

            // 4. EXECUTE SEQUENTIAL BATCH
            for (const step of sequentialBatch) {
                appendTrace(missionRunId, { type: "system", event: "executing_tool", note: `Invoking ${step.tool} (Sequential)` });

                if (previousNodeId) {
                    try {
                        const stepNode = executionFlowService.addNode(sessionId, {
                            type: "tool_call",
                            label: step.tool,
                            description: `Arguments: ${JSON.stringify(step.arguments)}`,
                            status: "completed",
                            metadata: { toolName: step.tool },
                        });
                        executionFlowService.addEdge(sessionId, { source: previousNodeId, target: stepNode.id, type: "default" });
                        previousNodeId = stepNode.id;
                    } catch { /* non-fatal */ }
                }

                try {
                    const trace = createRootTrace();
                    const toolResult = await handleToolCall(step.tool, step.arguments, {
                        ...getSystemOrgContext(orgId),
                        userId,
                        missionId: run.missionId!,
                        missionRunId: run.id,
                        traceId: trace.traceId,
                        spanId: trace.spanId,
                        traceparent: generateTraceparent(trace),
                        named: {}, positional: {}
                    });
                    const out = this.appendToolResult(missionRunId, toolResult, step.tool, appendTrace);
                    if (out) waveOutputs.push(`[${step.tool}]\n${out}`);
                } catch (err: any) {
                    appendTrace(missionRunId, { type: "error", event: "tool_failed", error: err.message, tool: step.tool });
                }
            }

            // 5. Cleanup
            if (assignment) {
                await db.update(missionStepAssignments).set({ status: "completed", updatedAt: new Date() }).where(eq(missionStepAssignments.id, assignment.id));
            }

            if (previousNodeId) {
                try {
                    const endNode = executionFlowService.addNode(sessionId, {
                        type: "action",
                        label: "Success",
                        description: "Mission wave completed successfully",
                        status: "completed",
                        metadata: {},
                    });
                    executionFlowService.addEdge(sessionId, { source: previousNodeId, target: endNode.id, type: "success" });
                } catch { /* non-fatal */ }
            }

            // Cap the summary so a huge wave doesn't blow up the blackboard / audit prompt.
            const MAX_WAVE_OUTPUT = 8000;
            let output = waveOutputs.join("\n\n");
            if (output.length > MAX_WAVE_OUTPUT) output = output.slice(0, MAX_WAVE_OUTPUT) + `\n…(truncated, ${output.length} chars total)`;
            return { success: true, output };
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    }

    private static formatOutput(result: any): string {
        return result?.stdout || result?.stderr || (typeof result === 'string' ? result : JSON.stringify(result));
    }

    private static appendToolResult(missionRunId: number, toolResult: any, tool: string, appendTrace: (id: number, entry: any) => void): string {
        const output = this.formatOutput(toolResult);
        try {
            const parsed = JSON.parse(output);
            if (parsed.dynamicTrace && Array.isArray(parsed.dynamicTrace)) {
                parsed.dynamicTrace.forEach((t: any) => {
                    appendTrace(missionRunId, { 
                        type: "system", 
                        event: "tool_trace", 
                        note: t.message || (typeof t === 'string' ? t : JSON.stringify(t)), 
                        tool 
                    });
                });
                // Still add a success summary
                appendTrace(missionRunId, { type: "system", event: "tool_success", note: parsed.message || `Executed ${tool}`, tool });
            } else {
                appendTrace(missionRunId, { type: "system", event: "tool_success", note: output, tool });
            }
        } catch (e) {
            // Not JSON or failed to parse, fall back to default
            appendTrace(missionRunId, { type: "system", event: "tool_success", note: output, tool });
        }
        return output;
    }
}
