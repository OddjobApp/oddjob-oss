import { z } from "zod";

export const trustLevelSchema = z.enum(["system", "developer", "trusted", "user", "tool", "retrieved", "untrusted"]);
export type TrustLevel = z.infer<typeof trustLevelSchema>;

export const evidenceRefSchema = z.object({
    id: z.string(),
    type: z.enum(["trace", "tool_result", "retrieval", "memory", "artifact", "approval", "eval"]),
    uri: z.string().optional(),
    label: z.string().optional(),
    confidence: z.number().min(0).max(1).optional(),
});
export type EvidenceRef = z.infer<typeof evidenceRefSchema>;

export const uncertaintySchema = z.object({
    confidence: z.number().min(0).max(1),
    rationale: z.string().optional(),
    evidence: z.array(evidenceRefSchema).default([]),
    risks: z.array(z.string()).default([]),
});
export type Uncertainty = z.infer<typeof uncertaintySchema>;

export const contextItemSchema = z.object({
    id: z.string(),
    role: z.enum(["instruction", "goal", "memory", "retrieval", "tool_result", "trace", "artifact", "user_input"]),
    content: z.string(),
    trustLevel: trustLevelSchema,
    source: z.string().optional(),
    tokenEstimate: z.number().int().nonnegative().optional(),
    priority: z.number().min(0).max(1).default(0.5),
    createdAt: z.string().optional(),
    expiresAt: z.string().optional(),
    evidence: z.array(evidenceRefSchema).default([]),
    tainted: z.boolean().default(false),
});
export type ContextItem = z.infer<typeof contextItemSchema>;

export const contextPacketSchema = z.object({
    id: z.string(),
    budgetTokens: z.number().int().positive(),
    usedTokens: z.number().int().nonnegative(),
    items: z.array(contextItemSchema),
    dropped: z.array(contextItemSchema),
    warnings: z.array(z.string()).default([]),
});
export type ContextPacket = z.infer<typeof contextPacketSchema>;

export const agentStateSchema = z.object({
    id: z.string(),
    goal: z.string(),
    status: z.enum(["planning", "running", "waiting", "completed", "failed", "cancelled"]).default("planning"),
    plan: z.unknown().optional(),
    workingMemory: z.array(contextItemSchema).default([]),
    retrievedContext: z.array(contextItemSchema).default([]),
    toolState: z.record(z.unknown()).default({}),
    approvals: z.array(evidenceRefSchema).default([]),
    artifacts: z.array(evidenceRefSchema).default([]),
    uncertainty: uncertaintySchema.optional(),
    traceId: z.string().optional(),
    spanId: z.string().optional(),
    organizationId: z.number().int().optional(),
    missionId: z.number().int().optional(),
    missionRunId: z.number().int().optional(),
    updatedAt: z.string(),
});
export type AgentState = z.infer<typeof agentStateSchema>;

export const toolContractSchema = z.object({
    name: z.string(),
    description: z.string(),
    riskLevel: z.enum(["low", "medium", "high"]).default("medium"),
    idempotency: z.enum(["none", "read-safe", "idempotent"]).default("none"),
    sideEffects: z.array(z.string()).default([]),
    requiresApproval: z.boolean().default(false),
    supportsDryRun: z.boolean().default(false),
    hasRollback: z.boolean().default(false),
    timeoutMs: z.number().int().positive().optional(),
});
export type ToolContract = z.infer<typeof toolContractSchema>;

export const toolCallEnvelopeSchema = z.object({
    id: z.string(),
    toolName: z.string(),
    params: z.unknown(),
    contract: toolContractSchema,
    dryRun: z.boolean().default(false),
    traceId: z.string().optional(),
    spanId: z.string().optional(),
});
export type ToolCallEnvelope = z.infer<typeof toolCallEnvelopeSchema>;

export const toolResultEnvelopeSchema = z.object({
    callId: z.string(),
    toolName: z.string(),
    status: z.enum(["success", "failure", "timeout", "cancelled"]),
    output: z.unknown().optional(),
    error: z.string().optional(),
    startedAt: z.string(),
    completedAt: z.string(),
    evidence: z.array(evidenceRefSchema).default([]),
});
export type ToolResultEnvelope = z.infer<typeof toolResultEnvelopeSchema>;

export const runtimeEvalGateSchema = z.object({
    id: z.string(),
    subject: z.object({
        type: z.enum(["agent", "mission", "app", "tool", "prompt", "model"]),
        id: z.string(),
        version: z.string().optional(),
    }),
    threshold: z.number().min(0).max(1),
    score: z.number().min(0).max(1),
    passed: z.boolean(),
    results: z.array(evidenceRefSchema).default([]),
    blockers: z.array(z.string()).default([]),
});
export type RuntimeEvalGate = z.infer<typeof runtimeEvalGateSchema>;

export const canonicalTraceEventSchema = z.object({
    id: z.string(),
    traceId: z.string(),
    spanId: z.string(),
    parentSpanId: z.string().optional(),
    type: z.enum(["llm_call", "tool_call", "tool_result", "retrieval", "approval", "eval", "artifact", "state", "error"]),
    status: z.enum(["started", "success", "failure", "skipped", "waiting"]),
    timestamp: z.string(),
    actor: z.string().optional(),
    summary: z.string(),
    payload: z.unknown().optional(),
    evidence: z.array(evidenceRefSchema).default([]),
});
export type CanonicalTraceEvent = z.infer<typeof canonicalTraceEventSchema>;

