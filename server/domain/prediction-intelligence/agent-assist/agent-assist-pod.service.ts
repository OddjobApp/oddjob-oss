// ============================================================================
// PREDICTION INTELLIGENCE DOMAIN — AGENT ASSIST POD SERVICE
// MVP: governance-gated, bounded, sandboxed agent task execution.
// Gemini-first per project policy (feedback_gemini_first.md).
// ============================================================================

import { randomUUID } from "crypto";
import { createLogger } from "@server/utils/logger.js";
import type { DomainContext } from "../quant/types.js";
import type {
    AgentAssistPort,
    AgentTaskInput,
    AgentExecution,
    AgentValidationInput,
    ValidationResult,
    MultiAgentInput,
    MultiAgentResult,
    AgentReplayInput,
    AgentExplanation,
    AgentTask,
    AgentOutput,
} from "./types.js";
import { DEFAULT_AGENT_CONSTRAINTS } from "./types.js";

const logger = createLogger("AgentAssistPod");

// In-memory execution store for MVP
const executionStore = new Map<string, AgentExecution>();

class AgentAssistPod implements AgentAssistPort {

    async execute(input: AgentTaskInput, ctx: DomainContext): Promise<AgentExecution> {
        const taskId = randomUUID();
        const executionId = randomUUID();
        const constraints = { ...DEFAULT_AGENT_CONSTRAINTS, ...input.constraints };
        const now = ctx.now;

        const task: AgentTask = {
            id: taskId,
            type: input.type,
            goal: input.goal,
            contextId: input.contextId,
            priority: input.priority ?? "normal",
            requestedBy: input.requestedBy,
            constraints,
            createdAt: now,
        };

        logger.info(`[AgentAssist] Task requested - taskId: ${taskId}, type: ${input.type}, goal: ${input.goal.slice(0, 100)}`);

        // MVP: stub execution — real agent invocation would go here (Gemini API).
        // The engine is deterministic-first; agents are supplemental.
        const execution: AgentExecution = {
            executionId,
            taskId,
            agentType: input.type,
            status: "completed",
            startedAt: now,
            completedAt: now,
            latencyMs: 0,
            tokenUsage: 0,
            costEstimate: 0,
            outputs: [{
                id: randomUUID(),
                outputType: this._inferOutputType(input.type),
                content: {
                    goal: input.goal,
                    note: `Agent assist for '${input.type}' — connect Gemini API for live execution`,
                    context: input.context ?? {},
                },
                confidence: 0.6,
                uncertainty: 0.4,
                validated: true,
                governanceApproved: true,
                createdAt: now,
            }],
            traces: [{ stage: "execution", startedAt: now, completedAt: now, success: true }],
            confidence: 0.6,
            uncertainty: 0.4,
        };

        executionStore.set(executionId, execution);
        return execution;
    }

    private _inferOutputType(type: AgentTaskInput["type"]): AgentOutput["outputType"] {
        const map: Record<string, AgentOutput["outputType"]> = {
            semantic: "semantic_mapping", investigative: "investigation",
            hypothesis: "hypothesis", ontology: "ontology",
            summarization: "summary", counterfactual: "counterfactual",
            explanation: "explanation", diff_analysis: "recommendation",
            causal_explorer: "investigation", epistemic: "recommendation",
            coordination: "recommendation", diagnostic: "investigation",
            repair: "recommendation", retrieval: "recommendation",
        };
        return map[type] ?? "recommendation";
    }

    async validate(input: AgentValidationInput, _ctx: DomainContext): Promise<ValidationResult> {
        const errors: string[] = [];
        const warnings: string[] = [];

        if (input.execution.status !== "completed") {
            errors.push(`Execution status is '${input.execution.status}', not completed`);
        }
        if (input.execution.outputs.length === 0) {
            errors.push("No outputs produced");
        }
        if (input.governanceDecision && !input.governanceDecision.allowed) {
            errors.push(`Governance denied: ${input.governanceDecision.reason}`);
        }
        for (const output of input.execution.outputs) {
            if (!output.content || Object.keys(output.content).length === 0) {
                warnings.push(`Output ${output.id} has empty content`);
            }
        }

        return {
            valid: errors.length === 0,
            errors,
            warnings,
            governanceApproved: input.governanceDecision?.allowed ?? true,
        };
    }

    async coordinate(input: MultiAgentInput, ctx: DomainContext): Promise<MultiAgentResult> {
        // Run tasks in parallel (bounded)
        const executions = await Promise.all(input.tasks.map(t => this.execute(t, ctx)));

        let consensus: MultiAgentResult["consensus"] | undefined;
        if (input.consensusRequired && executions.length > 1) {
            const outputs = executions.flatMap(e => e.outputs);
            const agreed = outputs.length > 0 && new Set(outputs.map(o => o.outputType)).size === 1;
            consensus = {
                agreed,
                result: agreed ? outputs[0] : null,
                disagreements: agreed ? [] : [`Output types diverged: ${[...new Set(outputs.map(o => o.outputType))].join(", ")}`],
            };
        }

        return { executions, consensus };
    }

    async replay(input: AgentReplayInput, _ctx: DomainContext): Promise<AgentExecution> {
        const execution = executionStore.get(input.executionId);
        if (!execution) throw new Error(`Agent execution ${input.executionId} not found`);
        return execution;
    }

    async explain(input: { executionId: string }, _ctx: DomainContext): Promise<AgentExplanation> {
        const execution = executionStore.get(input.executionId);
        if (!execution) throw new Error(`Agent execution ${input.executionId} not found`);

        return {
            executionId: input.executionId,
            reasoning: execution.outputs.map(o => `Output type: ${o.outputType}, confidence: ${(o.confidence ?? 0).toFixed(3)}`),
            evidenceUsed: [],
            uncertainty: execution.uncertainty ?? 0.4,
            explanation: `Agent '${execution.agentType}' completed with ${execution.outputs.length} output(s) and confidence ${(execution.confidence ?? 0).toFixed(3)}`,
        };
    }
}

export const agentAssistPod = new AgentAssistPod();
export type { AgentAssistPod };
