import { ActionHandler, ActionContext, CallToolDecision, PausedResult } from "./action-handler.js";
import { db } from "@server/database_service.js";
import { missions } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { normalizeToolName, AGENT_TOOLS } from "../../../tools/v1/tool-registry.service.js";
import { handleToolCall } from "@server/mcp/handlers.js";
import { missionRunService } from "../mission-run.service.js";
import { missionService } from "../mission.service.js";
import { queueMissionCycle } from "../../infrastructure/dynamic-mission-queue.js";
import { getSystemOrgContext } from "@server/utils/auth-context.js";
import type { RetryPolicy } from "../../../tools/v1/capabilities/types.js";

const logger = createLogger("CallToolHandler");

export class CallToolHandler implements ActionHandler {
    async execute(ctx: ActionContext, decision: CallToolDecision): Promise<PausedResult | void> {
        const { missionRunId, missionId, missionContext, userId, orgId, currentCycle, appendTrace, trackAsset, effectiveUserEmail } = ctx;

        const rawToolName = decision.action_details?.tool_name;
        if (!rawToolName) {
            throw new Error("Tool action is missing action_details.tool_name");
        }
        const toolName = normalizeToolName(rawToolName) || rawToolName;
        const toolArgs = decision.action_details?.arguments || {};
        
        // --- DEBUG MODE: Check for pause before tool execution ---
        const { missionDebugService } = await import("../mission-debug.service.js");
        const pauseCheck = missionDebugService.shouldPause(missionRunId, {
            phase: (missionContext as any)?.phase,
            toolName,
            cycleCount: currentCycle,
            blackboard: (missionContext as any) || {}
        });
        
        if (pauseCheck.shouldPause) {
            const pauseReason = pauseCheck.reason ?? "debug pause requested";
            logger.info(`[CallToolHandler] Run ${missionRunId} debug pause before tool: ${toolName}`);
            await appendTrace(missionRunId, {
                type: "system",
                event: "debug_pause",
                note: `Paused before tool: ${toolName}, reason: ${pauseReason}`,
                timestamp: new Date().toISOString()
            });
            return { status: "paused", reason: pauseReason, debug: true };
        }

        // --- REPLAY: check stopBeforeTools from _replayInfo ---
        const replayInfo = (missionContext as any)?._replayInfo;
        const stopBeforeTools: string[] = replayInfo?.stopBeforeTools ?? [];
        if (stopBeforeTools.length > 0 && stopBeforeTools.some(t => t.toLowerCase() === toolName.toLowerCase())) {
            const pauseReason = `Replay stopped before tool: ${toolName}`;
            logger.info(`[CallToolHandler] Run ${missionRunId} replay pause at tool: ${toolName}`);
            await appendTrace(missionRunId, {
                type: "system",
                event: "replay_pause",
                note: pauseReason,
                timestamp: new Date().toISOString()
            });
            return { status: "paused", reason: pauseReason, debug: false };
        }
        
        // --- CONTRACT: check tool-level approval policy before execution ---
        const toolDef = (AGENT_TOOLS as any)[toolName.toLowerCase()];
        const { SAFE_TOOLS } = await import("../orchestration/governance.service.js");
        if (!SAFE_TOOLS.has(toolName.toLowerCase()) && toolDef?.approvalPolicy?.requiresApproval) {
            const { orchestrationGovernanceService } = await import("../orchestration/governance.service.js");
            const fakeThought = { action: toolName, reasoning: toolDef.approvalPolicy.rationale || `Tool '${toolName}' requires approval`, params: toolArgs };
            const govResult = await orchestrationGovernanceService.requestApproval(ctx, fakeThought as any);
            if (!govResult.approved) {
                logger.warn(`[CallToolHandler] Approval denied for tool ${toolName}: ${govResult.reason}`);
                await appendTrace(missionRunId, { type: "system", event: "tool_approval_denied", note: govResult.reason, timestamp: new Date().toISOString() });
                await missionService.updateBlackboard(missionId, { last_tool_status: "denied", last_tool_run: toolName }, "agent:orchestrator", "tool_denied");
                await queueMissionCycle({ missionRunId, userId, orgId }, 1000);
                return;
            }
        }

        logger.info(`[CallToolHandler] Run ${missionRunId} executing tool: ${toolName} (raw: ${rawToolName})`);

        await appendTrace(missionRunId, {
            type: "system",
            event: "executing_tool", 
            note: `Invoking tool: ${toolName} with args: ${JSON.stringify(toolArgs)}`, 
            timestamp: new Date().toISOString() 
        });

        // --- AUTO-CHECKPOINT: Save state before tool execution for recovery ---
        try {
            const checkpointContext = {
                ...(missionContext as any || {}),
                lastToolCall: { toolName, toolArgs, timestamp: new Date().toISOString() },
                checkpointReason: `pre_tool:${toolName}`
            };
            await missionRunService.checkpoint({
                missionRunId,
                missionId: missionId,
                missionContext: checkpointContext,
                reason: `checkpoint:pre_tool_${toolName}`,
                changedBy: "agent:orchestrator"
            });
            logger.debug(`[CallToolHandler] Auto-checkpoint saved before tool ${toolName}`);
        } catch (checkpointErr) {
            logger.warn(`[CallToolHandler] Failed to save pre-tool checkpoint: ${checkpointErr}`);
            // Non-blocking: continue with tool execution even if checkpoint fails
        }

        // --- CONTRACT: resolve retry policy from tool definition ---
        const retryPolicy: RetryPolicy = toolDef?.retryPolicy ?? { maxAttempts: 1, backoffMs: 0 };
        const isDryRun = (missionContext as any)?._replayInfo?.dryRun === true;

        async function invokeToolWithRetry(): Promise<unknown> {
            let lastErr: unknown;
            for (let attempt = 1; attempt <= retryPolicy.maxAttempts; attempt++) {
                try {
                    if (isDryRun) {
                        logger.info(`[CallToolHandler] DRY RUN — skipping actual execution of ${toolName}`);
                        return { dryRun: true, toolName, toolArgs, skipped: true };
                    }
                    const result = await handleToolCall(toolName, toolArgs, {
                        ...getSystemOrgContext(orgId),
                        missionId,
                        missionRunId,
                        named: {},
                        positional: {},
                    });
                    if (result && (result as any).isError) {
                        throw new Error((result as any).content?.[0]?.text || "Unknown tool error");
                    }
                    return result;
                } catch (err: any) {
                    lastErr = err;
                    const shouldRetry = retryPolicy.retryOn
                        ? retryPolicy.retryOn.some(pat => err.message?.includes(pat))
                        : true;
                    if (attempt < retryPolicy.maxAttempts && shouldRetry) {
                        logger.warn(`[CallToolHandler] Tool ${toolName} attempt ${attempt} failed, retrying in ${retryPolicy.backoffMs}ms: ${err.message}`);
                        await new Promise(r => setTimeout(r, retryPolicy.backoffMs * attempt));
                    } else {
                        throw err;
                    }
                }
            }
            throw lastErr;
        }

        try {
            const toolResult = await invokeToolWithRetry();

            logger.info(`[CallToolHandler] Run ${missionRunId} tool ${toolName} success.`);

            // Record prediction outcome for calibration
            try {
                const predictedTool = (missionContext as any)?._predictedTool as string | undefined;
                if (predictedTool !== undefined || toolName) {
                    const { predictionOutcomes } = await import("@shared/schema/prediction/prediction-outcomes.js");
                    await db.insert(predictionOutcomes).values({
                        missionRunId,
                        cycle: currentCycle,
                        predictedTool: predictedTool ?? null,
                        actualTool: toolName,
                        wasCorrect: predictedTool === toolName,
                        confidence: (missionContext as any)?._predictedToolConfidence as number | undefined ?? null,
                        organizationId: orgId,
                    });
                }
            } catch (outcomeErr: any) {
                logger.warn(`[CallToolHandler] Failed to record prediction outcome: ${outcomeErr.message}`);
            }

            // Save result to blackboard for next cycle visibility
            const resultKey = `tool_output_${toolName}_${Date.now()}`;
            const blackboardUpdate = { 
                [resultKey]: toolResult,
                last_tool_run: toolName,
                last_tool_status: "success"
            };

            await missionService.updateBlackboard(missionId, blackboardUpdate, "agent:orchestrator", `tool_result:${toolName}`);

            // --- BLACKBOARD GC: Prune stale tool outputs to prevent unbounded growth ---
            try {
                const MAX_TOOL_OUTPUTS = 20;
                const [freshMission] = await db.select().from(missions).where(eq(missions.id, missionId)).limit(1);
                const bb = (freshMission?.blackboard as Record<string, any>) || {};
                const toolOutputKeys = Object.keys(bb).filter(k => k.startsWith('tool_output_')).sort();
                if (toolOutputKeys.length > MAX_TOOL_OUTPUTS) {
                    const keysToRemove = toolOutputKeys.slice(0, toolOutputKeys.length - MAX_TOOL_OUTPUTS);
                    const pruned: Record<string, null> = {};
                    for (const k of keysToRemove) pruned[k] = null;
                    await missionService.updateBlackboard(missionId, pruned, "agent:orchestrator", "blackboard_gc");
                    logger.debug(`[CallToolHandler] Blackboard GC: pruned ${keysToRemove.length} stale tool outputs`);
                }
            } catch (gcErr) {
                logger.warn(`[CallToolHandler] Blackboard GC failed: ${gcErr}`);
            }

            // --- ASSET TRACKING ---
            try {
                const assetInfo: any = { type: 'tool', name: toolName };
                // Try to extract IDs from common tool result patterns
                if (toolResult && typeof toolResult === 'object') {
                    const tr = toolResult as any;
                    if (tr.id) assetInfo.id = tr.id;
                    if (tr.datasetId) { assetInfo.id = tr.datasetId; assetInfo.type = 'dataset'; }
                    if (tr.pipelineId) { assetInfo.id = tr.pipelineId; assetInfo.type = 'pipeline'; }
                    if (tr.jobId) { assetInfo.id = tr.jobId; assetInfo.type = 'job'; }
                }
                await trackAsset(missionRunId, assetInfo);
            } catch (trackErr) {
                logger.warn(`Failed to track asset for tool ${toolName}: ${trackErr}`);
            }

            await appendTrace(missionRunId, { 
                type: "system", 
                event: "tool_success", 
                note: `Tool ${toolName} executed successfully. Result saved to blackboard.`, 
                timestamp: new Date().toISOString() 
            });

            // --- DELIVERABLE AUTO-SYNC (For File Exports) ---
            if (toolName === 'file_write' || toolName === 'write_file') {
                const fileName = (toolArgs as any).fileName || (toolArgs as any).path;
                if (fileName) {
                    try {
                        const [m] = await db.select().from(missions).where(eq(missions.id, missionId)).limit(1);
                        const eb = (m?.blackboard as any)?.expected_deliverables;
                        if (Array.isArray(eb)) {
                            for (const d of eb) {
                                const item = String(d);
                                const slug = item.toLowerCase().replace(/\s+/g, '_');
                                // If filename matches deliverable item (fuzzy match)
                                if (fileName.toLowerCase().includes(slug.replace(/_/g, ''))) {
                                    await missionService.updateBlackboard(missionId, { [slug]: `File generated: ${fileName}` }, "agent:orchestrator", "file_sync");
                                    logger.info(`[CallToolHandler] Auto-synced deliverable ${slug} from file ${fileName}`);
                                }
                            }
                        }
                    } catch (e) {
                        logger.warn(`Failed to auto-sync deliverable for file ${fileName}: ${e}`);
                    }
                }
            }

        } catch (toolErr: any) {
            const errorMessage = toolErr?.message || String(toolErr);
            logger.error(`[CallToolHandler] Tool execution failed for run ${missionRunId}: ${errorMessage}`);
            await appendTrace(missionRunId, {
                type: "error",
                event: "tool_failed",
                error: errorMessage,
                timestamp: new Date().toISOString()
            });

            // --- CIRCUIT BREAKER: escalate to HIL after 3 consecutive failures for the same tool ---
            const failCountKey = `tool_fail_count_${toolName}`;
            try {
                const [freshMission] = await db.select({ blackboard: missions.blackboard })
                    .from(missions).where(eq(missions.id, missionId)).limit(1);
                const bb = (freshMission?.blackboard as Record<string, unknown>) || {};
                const prevCount = typeof bb[failCountKey] === 'number' ? (bb[failCountKey] as number) : 0;
                const newCount = prevCount + 1;

                await missionService.updateBlackboard(missionId, {
                    last_tool_error: errorMessage,
                    last_tool_status: "failed",
                    last_tool_run: toolName,
                    [failCountKey]: newCount,
                }, "agent:orchestrator", "tool_error");

                if (newCount >= 3) {
                    const { SAFE_TOOLS } = await import("../orchestration/governance.service.js");
                    const isBypassed = SAFE_TOOLS.has(toolName.toLowerCase());
                    if (isBypassed) {
                        logger.warn(`[CallToolHandler] Circuit breaker: tool ${toolName} failed ${newCount} times. Bypassing HIL.`);
                        await appendTrace(missionRunId, {
                            type: "system",
                            event: "circuit_breaker_bypassed",
                            note: `Tool '${toolName}' failed ${newCount} consecutive times. HIL request bypassed.`,
                            timestamp: new Date().toISOString(),
                        });
                        // Reset counter and continue cycling (non-blocking)
                        await missionService.updateBlackboard(missionId, { [failCountKey]: 0 }, "agent:orchestrator", "circuit_breaker_reset");
                    } else {
                        logger.warn(`[CallToolHandler] Circuit breaker: tool ${toolName} failed ${newCount} times. Requesting HIL.`);
                        const { approvalService } = await import("../../../integrations/core/approval.service.js");
                        await approvalService.createApprovalRequest({
                            executionId: String(missionRunId),
                            approverType: "user",
                            approverId: userId || "admin",
                            approverEmail: effectiveUserEmail || "system",
                            status: "pending",
                            organizationId: orgId || undefined,
                            context: {
                                circuitBreaker: true,
                                toolName,
                                failCount: newCount,
                                lastError: errorMessage,
                                compensation: toolDef?.compensation
                                    ? { rollbackTool: toolDef.compensation.toolName, paramsMap: toolDef.compensation.paramsMap }
                                    : undefined,
                            },
                        });
                        await appendTrace(missionRunId, {
                            type: "system",
                            event: "circuit_breaker_triggered",
                            note: `Tool '${toolName}' failed ${newCount} consecutive times. Human review requested.`,
                            timestamp: new Date().toISOString(),
                        });
                        // Reset counter after escalation so human can retry cleanly
                        await missionService.updateBlackboard(missionId, { [failCountKey]: 0 }, "agent:orchestrator", "circuit_breaker_reset");
                        return; // Stop cycling — mission stays active for human to resume
                    }
                }
            } catch (cbErr: any) {
                logger.warn(`[CallToolHandler] Circuit breaker update failed: ${cbErr.message}`);
                // Fallback: ensure at least the basic error fields are written
                await missionService.updateBlackboard(missionId, {
                    last_tool_error: errorMessage,
                    last_tool_status: "failed",
                    last_tool_run: toolName,
                }, "agent:orchestrator", "tool_error").catch(() => {});
            }
        }

        // Enqueue next cycle via distributed queue
        await queueMissionCycle({ missionRunId, userId, orgId }, 3000);
    }
}
