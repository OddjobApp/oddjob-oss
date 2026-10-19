
import { z } from "zod";

/**
 * The lifecycle state of a Supervisor Agent
 */
export enum SupervisorState {
    PLANNING = "planning",
    DELEGATING = "delegating",
    WAITING = "waiting",
    REVIEWING = "reviewing",
    REPLANNING = "replanning",
    TRIAGING = "triaging",
    COMPLETED = "completed",
    FAILED = "failed"
}

/**
 * A single task within a Supervisor's plan
 */
export const SupervisorTaskSchema = z.object({
    id: z.string(),
    type: z.enum(["pipeline", "tool", "agent", "delegate"]).default("pipeline"),
    name: z.string(),
    description: z.string(),
    status: z.enum(["pending", "in_progress", "completed", "failed", "skipped", "rejected", "waiting_external_input"]),

    // Pipeline specific
    assignedAgent: z.string().nullish(),
    assignedAgentFeedback: z.string().nullish(),
    pipelineId: z.number().nullish(),
    childExecutionId: z.number().nullish(),

    // Tool specific
    toolName: z.string().nullish(),
    arguments: z.record(z.any()).nullish(),

    dependencies: z.array(z.string()).default([]),
    output: z.any().optional(),
    allottedTools: z.array(z.string()).nullish(), // Tools provisioned by the Supervisor
    estimatedCostUSD: z.number().default(0),
    retryCount: z.number().default(0),
    isCritical: z.boolean().default(true),
    lastTriageResult: z.object({
        recommendation: z.string(),
        action: z.enum(["relax", "replan", "skip", "retry"]),
        timestamp: z.string()
    }).nullish(),
});

export type SupervisorTask = z.infer<typeof SupervisorTaskSchema>;

/**
 * The High-Level Plan managed by the Supervisor
 */
export const SupervisorPlanSchema = z.object({
    intent: z.string(),
    tasks: z.array(SupervisorTaskSchema),
    currentContext: z.string().nullish(), // Summary of current progress
    replanCount: z.number().default(0),    // Number of times the supervisor has re-planned
    autoRescueEnabled: z.boolean().default(true),
    history: z.array(z.object({
        type: z.enum(["replan", "critique", "handoff", "thought"]),
        observation: z.string(),
        thought: z.string().nullish(),
        timestamp: z.string()
    })).default([]),
    statusUpdate: z.string().nullish(), // Communication for the user
    createdAt: z.string().datetime().default(() => new Date().toISOString()),
    updatedAt: z.string().datetime().default(() => new Date().toISOString()),
    estimatedCostUSD: z.number().default(0),
    version: z.number().default(1),
});

export type SupervisorPlan = z.infer<typeof SupervisorPlanSchema>;

/**
 * Standardized Context Handshake for Agent-to-Agent communication
 */
export const AgentContextSchema = z.object({
    goal: z.string(),
    constraints: z.array(z.string()).default([]),
    memoryRef: z.string().optional(), // Redis key for shared memory
    artifacts: z.array(z.object({
        name: z.string(),
        type: z.string(),
        path: z.string()
    })).default([]),
    parentExecutionId: z.number().nullish()
});

export type AgentContext = z.infer<typeof AgentContextSchema>;

/**
 * Strict Protocol for Worker-to-Supervisor communication
 */
export const SupervisorWorkerOutputSchema = z.object({
    status: z.enum(["completed", "failed", "rejected", "waiting_external_input"]).default("completed"),
    result: z.any().nullish(),
    feedback: z.string().nullish(), // Used for 'rejected' or 'critique'
    action: z.enum(["none", "handoff", "critique", "retry"]).default("none"),
    to: z.string().nullish(),       // Used for 'handoff'
    reason: z.string().nullish(),   // Used for 'handoff' or 'critique'
    parseError: z.boolean().nullish(),
    suspensionMetadata: z.any().nullish()
});

export type SupervisorWorkerOutput = z.infer<typeof SupervisorWorkerOutputSchema>;



