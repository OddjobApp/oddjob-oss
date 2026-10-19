import { z } from "zod";
import { McpPermission } from "@shared/schema/index.js";

export interface ToolContext {
    organizationId?: number | null;
    userId?: string;
    isAdmin?: boolean;
    isSuperAdmin?: boolean;
    isOrgAdmin?: boolean;
    allowedTopicIds?: number[] | null;
    allowedDatasetIds?: number[] | null;
    allowedPipelineIds?: (string | number)[] | null;
    missionId?: number | null;
    missionRunId?: number | null;
    traceId?: string;
    spanId?: string;
    traceparent?: string;
    permissions?: McpPermission[];
    resourceScoping?: Record<string, string[]>;
    named?: Record<string, string>;
    positional?: Record<number, string>;
    [key: string]: any;
}

/** How a tool behaves under duplicate invocation. */
export type ToolIdempotency =
    | "none"         // Not safe to retry — has irreversible side effects
    | "read-safe"    // Read-only; always safe to call multiple times
    | "idempotent";  // Produces the same result on retry (e.g., upsert)

/** Side-effect categories a tool may produce. */
export type ToolSideEffect =
    | "database"
    | "external-api"
    | "file-system"
    | "email"
    | "webhook"
    | "container"
    | "queue-message";

export interface RetryPolicy {
    maxAttempts: number;
    backoffMs: number;
    /** Error message substrings that should trigger a retry (all others fail immediately). */
    retryOn?: string[];
}

export interface ApprovalPolicy {
    /** Whether this tool always requires human approval regardless of risk score. */
    requiresApproval?: boolean;
    /** Human-readable reason shown in the approval inbox. */
    rationale?: string;
}

/** Describes a compensating action that can undo this tool's side effects. */
export interface CompensationSpec {
    /** Name of the tool to invoke for rollback. */
    toolName: string;
    /**
     * Maps compensation-tool parameter names to values from the original call.
     * e.g. { "entityId": "id" } means pass original call's `id` as `entityId`.
     */
    paramsMap?: Record<string, string>;
}

export interface ToolDefinition<P extends z.ZodTypeAny = z.ZodTypeAny> {
    name: string;
    description: string;
    parameters: P;
    execute: (params: z.infer<P>, context: ToolContext) => Promise<any>;
    label?: string;
    group?: string;
    adminOnly?: boolean;
    /** Restricts this tool to super admins; enforced by each tool's own execute() via ToolContext.isSuperAdmin. */
    superAdminOnly?: boolean;
    circuitConfig?: {
        failureThreshold: number;
        resetTimeoutMs: number;
    };
    fallbackTool?: string;

    // ── Governance ────────────────────────────────────────────────────────────
    riskLevel?: "high" | "medium" | "low";
    approvalPolicy?: ApprovalPolicy;
    /**
     * Execution constraints a reader must know about, rendered as the
     * "Security Guardrails" block of the tool's generated capability page.
     *
     * Declared here because the page is compiled from this definition: a tool
     * whose guardrails live only in its description or its implementation
     * publishes a doc that says "No explicit guardrails declared", which reads
     * as "unconstrained" for the tools where it matters most.
     */
    guardrails?: string[];

    // ── Reliability ───────────────────────────────────────────────────────────
    idempotency?: ToolIdempotency;
    retryPolicy?: RetryPolicy;
    timeoutMs?: number;

    // ── Compensation/Rollback ─────────────────────────────────────────────────
    compensation?: CompensationSpec;

    // ── Observability ─────────────────────────────────────────────────────────
    sideEffects?: ToolSideEffect[];
    outputSchema?: z.ZodTypeAny;
}

/**
 * Declare one tool so that execute() gets its own parameter type.
 *
 * `Record<string, ToolDefinition>` — how all 73 capability files declare their
 * groups — erases the generic: P falls back to z.ZodTypeAny, `z.infer<P>`
 * collapses to `any`, and every execute() takes untyped params despite the zod
 * schema sitting three lines above it. The schema still validates at runtime;
 * it just tells the compiler nothing, so a typo in a param name is a runtime
 * undefined rather than a compile error.
 *
 *     seedance_estimate_cost: defineTool({
 *         parameters: z.object({ durationSeconds: z.number() }),
 *         execute: async (params) => params.durationSeconds * 2,  // number, not any
 *     }),
 *
 * Per-tool, not per-group. A group helper cannot work: TypeScript will not infer
 * each entry's P through a mapped type, and a typed ToolDefinition<ZodObject<…>>
 * is not assignable to ToolDefinition<ZodTypeAny> anyway, because execute() is
 * contravariant in its params. Both were tried and measured before writing this.
 *
 * Rolling this out means the collection points that hold mixed tools
 * (registerStaticTools, toolRegistry) need ToolDefinition<any> rather than
 * ToolDefinition, for that same variance reason.
 *
 * Note z.infer is z.output: a schema with .default() gives execute() the
 * post-parse type, which is what execute() actually receives.
 */
export function defineTool<P extends z.ZodTypeAny>(def: ToolDefinition<P>): ToolDefinition<P> {
    return def;
}
