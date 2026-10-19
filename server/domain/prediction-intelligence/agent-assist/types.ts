// ============================================================================
// PREDICTION INTELLIGENCE DOMAIN - AGENT ASSIST POD
// Core type definitions (spec §5-§40)
// ============================================================================

import type { DomainContext } from "../quant/types.js";

export type AgentType = "semantic" | "investigative" | "hypothesis" | "ontology" | "summarization" | "counterfactual" | "explanation" | "diff_analysis" | "causal_explorer" | "epistemic" | "coordination" | "diagnostic" | "repair" | "retrieval";
export type AgentPriority = "low" | "normal" | "high" | "critical";
export type AgentExecutionStatus = "queued" | "running" | "completed" | "failed" | "cancelled" | "timed_out";
export type AgentGovernanceLevel = "strict" | "moderate" | "relaxed";
export type AgentOutputType = "hypothesis" | "semantic_mapping" | "summary" | "counterfactual" | "ontology" | "investigation" | "recommendation" | "explanation";

export interface AgentConstraints {
    maxTokens?: number;
    maxDurationMs?: number;
    maxToolCalls?: number;
    allowExternalTools?: boolean;
    allowMemoryRecall?: boolean;
    allowCrossContextReasoning?: boolean;
    maxRecursionDepth?: number;
    sandboxed: boolean;
    governanceLevel: AgentGovernanceLevel;
}

export interface AgentTask {
    id: string;
    type: AgentType;
    goal: string;
    contextId?: string;
    priority: AgentPriority;
    requestedBy: "prediction" | "governance" | "calibration" | "operator" | "system";
    constraints: AgentConstraints;
    createdAt: string;
}

export interface AgentTrace {
    stage: string;
    startedAt: string;
    completedAt?: string;
    success: boolean;
    details?: Record<string, unknown>;
}

export interface AgentOutput {
    id: string;
    outputType: AgentOutputType;
    content: Record<string, unknown>;
    confidence?: number;
    uncertainty?: number;
    validated: boolean;
    governanceApproved: boolean;
    createdAt: string;
}

export interface AgentExecution {
    executionId: string;
    taskId: string;
    agentType: AgentType;
    status: AgentExecutionStatus;
    startedAt?: string;
    completedAt?: string;
    latencyMs?: number;
    tokenUsage?: number;
    costEstimate?: number;
    outputs: AgentOutput[];
    traces: AgentTrace[];
    confidence?: number;
    uncertainty?: number;
}

export interface AgentExplanation {
    executionId: string;
    reasoning: string[];
    evidenceUsed: string[];
    uncertainty: number;
    explanation: string;
}

// Input types
export interface AgentTaskInput {
    type: AgentType;
    goal: string;
    contextId?: string;
    priority?: AgentPriority;
    requestedBy: AgentTask["requestedBy"];
    constraints?: Partial<AgentConstraints>;
    context?: Record<string, unknown>;
    mode: "interactive" | "analysis" | "batch";
}

export interface AgentValidationInput {
    execution: AgentExecution;
    expectedOutputType?: AgentOutputType;
    governanceDecision?: { allowed: boolean; reason: string };
}

export interface ValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
    governanceApproved: boolean;
}

export interface MultiAgentInput {
    tasks: AgentTaskInput[];
    consensusRequired: boolean;
    mode: "analysis" | "batch";
}

export interface MultiAgentResult {
    executions: AgentExecution[];
    consensus?: { agreed: boolean; result: AgentOutput | null; disagreements: string[] };
}

export interface AgentReplayInput {
    executionId: string;
}

// Port (spec §40)
export interface AgentAssistPort {
    execute(input: AgentTaskInput, ctx: DomainContext): Promise<AgentExecution>;
    validate(input: AgentValidationInput, ctx: DomainContext): Promise<ValidationResult>;
    coordinate(input: MultiAgentInput, ctx: DomainContext): Promise<MultiAgentResult>;
    replay(input: AgentReplayInput, ctx: DomainContext): Promise<AgentExecution>;
    explain(input: { executionId: string }, ctx: DomainContext): Promise<AgentExplanation>;
}

export const DEFAULT_AGENT_CONSTRAINTS: AgentConstraints = {
    maxTokens: 4_000,
    maxDurationMs: 15_000,
    maxToolCalls: 5,
    allowExternalTools: false,
    allowMemoryRecall: true,
    allowCrossContextReasoning: false,
    maxRecursionDepth: 2,
    sandboxed: true,
    governanceLevel: "strict",
};
