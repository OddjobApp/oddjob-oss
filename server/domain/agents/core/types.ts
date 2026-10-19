import { AIApiCallConfig } from "@shared/schema/index.js";
import { TraceContext } from "@domain/core/infrastructure/tracing/trace-context.service.js";

/**
 * Why a run stopped. Recorded once per run on the terminal `run_outcome` step,
 * so endurance — how long an agent works before it breaks — is a query over
 * `agent_run_steps` rather than something that has to be reconstructed.
 */
export type AgentTerminalReason =
    /** The agent produced a final answer. */
    | "converged"
    /** A rich response was handed to the user mid-run; the loop yielded to them. */
    | "interrupted"
    /** The iteration budget ran out with no final answer. */
    | "iteration_limit"
    /** Input guardrail refused the goal before planning. */
    | "blocked_by_guardrail"
    /** The plan failed pre-flight validation, so nothing executed. */
    | "plan_rejected";

export interface AgentStep {
    type: "user" | "thought" | "action" | "observation" | "system" | "run_outcome";
    content: string;
    confidence?: number;
    toolCalls?: any[];
    /** Structured detail persisted to `agent_run_steps.metadata`. */
    metadata?: Record<string, unknown>;
}

export interface TokenUsage {
    totalTokens: number;
    promptTokens?: number;
    completionTokens?: number;
    costEstimateUsd?: number;
}

export interface AgentLoopResult {
    output: string;
    usage: TokenUsage;
    history: AgentStep[];
    executionId?: number;
}

export type SupervisionLevel = "none" | "advisory" | "full";

export interface AgentContext {
    sessionId?: string;
    organizationId: number;
    agentId?: string;
    jobId?: number;
    missionId?: number;
    userId: string;
    // Session-derived permission flags. Tools with requireAdmin/requireOrgAdmin/
    // requireSuperAdmin gates (e.g. update_job, create_job, credentials) read
    // these off the ToolContext. They originate server-side from userContext and
    // must be threaded through to tool execution — without them an admin user's
    // Copilot can select admin tools but every admin write is denied.
    isAdmin?: boolean;
    isOrgAdmin?: boolean;
    isSuperAdmin?: boolean;
    executionId?: number;
    previousHistory?: any[];
    appDeploymentId?: number;
    appMemoryEnabled?: boolean;
    pipelineExecution?: {
        nonce: string;
        inputData: Record<string, any>;
    };
    remainingBudgetUsd?: number;
    stepBudgetLimitUsd?: number;
    reasoningProtocol?: "json_manifest" | "hermes_xml";
    allowedToolNames?: string[];
    isSubAgent?: boolean;
    parentId?: number;
    supervisionLevel?: SupervisionLevel;
    isShadow?: boolean;
    // Execution Strategy (from cycle YAML agent configuration)
    executionStrategy?: {
        pre_execution?: Array<{ action: string; on_failure?: string; output?: string }>;
        iteration_strategy?: "plan_then_execute" | "execute_and_verify" | "iterative";
        max_consecutive_failures?: number;
        checkpoint_every_n_iterations?: number;
    } | null;
    maxConsecutiveFailures?: number | null;
    checkpointInterval?: number | null;
    // VariableContext compliance
    named?: Record<string, string>;
    positional?: Record<number, string>;
    extra?: Record<string, any>;
    // Optional progress sink for streaming (SSE). When present, the orchestrator
    // emits coarse status updates (e.g. "Using search_knowledge_graph…") so a
    // streaming client can show live progress during the multi-iteration loop.
    // Best-effort and side-effect-free — never throws into the loop.
    onStatus?: (status: AgentStatusEvent) => void;
}

/** A coarse progress update surfaced to a streaming client during the agent loop. */
export interface AgentStatusEvent {
    phase: "planning" | "thinking" | "tool" | "synthesizing";
    /** Human-readable, already user-safe label (no scaffolding/secrets). */
    label: string;
    /** Present when phase === "tool": the tool being invoked. */
    tool?: string;
    iteration?: number;
}

export interface GovernanceResolved {
    enabled: boolean;
    rules: any[];
}


