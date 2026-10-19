import { AIClient } from "@domain/ai/core/ai-client.service.js";
import { AIApiCallConfig } from "@shared/schema/index.js";
import { AGENT_TOOLS, normalizeToolName } from "../tools/v1/tool-registry.service.js";
import { TraceContext } from "@domain/core/infrastructure/tracing/trace-context.service.js";
import { AgentOrchestrator } from "./core/agent-orchestrator.js";
import { AgentContext, SupervisionLevel, GovernanceResolved, AgentLoopResult } from "./core/types.js";
import { SkillManager } from "./core/skill-manager.js";

export async function runAgentLoop(
    client: AIClient,
    initialConfig: AIApiCallConfig,
    goal: string,
    allowedTools: string[],
    maxIterations: number,
    apiKey: string,
    initialContext: any = {},
    traceContext?: TraceContext,
    dryRun: boolean = false,
    governorConfig?: GovernanceResolved,
    supervisionLevel: SupervisionLevel = "full"
): Promise<AgentLoopResult> {

    // Resolve tool definitions from names, handling aliases
    const allTools = allowedTools
        .map(name => AGENT_TOOLS[normalizeToolName(name)])
        .filter(Boolean);

    // Apply Skills Pattern: Prune tools based on the goal to optimize system prompt
    const tools = SkillManager.pruneTools(goal, initialContext.previousHistory || [], allTools);
    
    // try {
    //     const fs = await import('fs');
    //     const logMsg = `[Agent Runner] Goal: "${goal}", Pruning: ${tools.length}/${allTools.length} kept. Dataset present: ${tools.some(t => t.name.includes('dataset'))}\n`;
    //     fs.appendFileSync('agent_debug_service.log', logMsg);
    // } catch (e) { }

    console.log(`[Agent Runner] Goal: "${goal}"`);
    console.log(`[Agent Runner] Pruning Result: ${tools.length} tools kept out of ${allTools.length}`);

    // Prepare Agent Context
    const context: AgentContext = {
        sessionId: initialContext.sessionId,
        organizationId: Number(initialContext.organizationId) || 1,
        jobId: initialContext.jobId,
        missionId: initialContext.missionId,
        userId: initialContext.userId || "system",
        // Thread the session-derived admin flags through to tool execution.
        // Without these, admin-gated MCP tools (update_job, create_job, …) that
        // the agent was allowed to select are then denied at requireAdmin time.
        isAdmin: initialContext.isAdmin,
        isOrgAdmin: initialContext.isOrgAdmin,
        isSuperAdmin: initialContext.isSuperAdmin,
        executionId: initialContext.executionId,
        previousHistory: initialContext.previousHistory,
        appDeploymentId: initialContext.appDeploymentId,
        appMemoryEnabled: initialContext.appMemoryEnabled,
        pipelineExecution: initialContext.pipelineExecution,
        remainingBudgetUsd: initialContext.remainingBudgetUsd,
        stepBudgetLimitUsd: initialContext.stepBudgetLimitUsd,
        // Execution strategy context for stall detection and checkpointing
        executionStrategy: initialContext.executionStrategy ?? null,
        maxConsecutiveFailures: initialContext.maxConsecutiveFailures ?? null,
        checkpointInterval: initialContext.checkpointInterval ?? null,
        // Optional streaming progress sink (SSE). Threaded straight to the
        // orchestrator; undefined for non-streaming callers.
        onStatus: initialContext.onStatus,
    };

    const orchestrator = new AgentOrchestrator(client, apiKey, context);

    return await orchestrator.run(
        goal,
        initialConfig,
        tools,
        maxIterations,
        supervisionLevel,
        governorConfig,
        traceContext,
        dryRun
    );
}


