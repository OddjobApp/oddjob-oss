/**
 * Mission Blackboard Schema
 *
 * Defines the contract for well-known blackboard keys read/written by the
 * orchestrator, action handlers, and synthesis layer. Unknown keys are allowed
 * (the blackboard is open-ended) but these are validated on read.
 *
 * Usage:
 *   import { BlackboardSchema, parseBlackboard } from "./mission-blackboard.schema.js";
 *   const bb = parseBlackboard(rawBlackboard);   // throws on type violations
 *   const bb = safeParseBlackboard(rawBlackboard); // returns { success, data, error }
 */

import { z } from "zod";

export const BlackboardSchema = z.object({
    // ── Mission intent & result ───────────────────────────────────────────────
    intent: z.string().optional(),
    objective: z.string().optional(),
    result: z.string().optional(),
    output: z.string().optional(),

    // ── Tool execution state ──────────────────────────────────────────────────
    last_tool_run: z.string().optional(),
    last_tool_status: z.enum(["success", "failed"]).optional(),
    last_tool_error: z.string().optional(),

    // ── Circuit breaker (per-tool failure counters — keyed dynamically) ───────
    // These are validated via the record catch-all below; typed here for docs.
    // Key pattern: tool_fail_count_<toolName>

    // ── Deliverables ──────────────────────────────────────────────────────────
    expected_deliverables: z.array(z.string()).optional(),

    // ── Sub-mission / delegation tracking ────────────────────────────────────
    parentMissionRunId: z.number().optional(),
    parentMissionId: z.number().optional(),
    allowedTools: z.array(z.string()).optional(),
    isSubTask: z.boolean().optional(),

    // ── Allow any additional keys the AI may write ────────────────────────────
}).catchall(z.unknown());

export type MissionBlackboard = z.infer<typeof BlackboardSchema>;

/** Parses and validates the blackboard, throwing on type violations of known fields. */
export function parseBlackboard(raw: unknown): MissionBlackboard {
    return BlackboardSchema.parse(raw ?? {});
}

/** Parses without throwing — use where the blackboard is untrusted but errors are non-fatal. */
export function safeParseBlackboard(raw: unknown) {
    return BlackboardSchema.safeParse(raw ?? {});
}

/** Returns a typed view of a specific well-known key, or `undefined` if absent/wrong type. */
export function getBlackboardField<K extends keyof MissionBlackboard>(
    raw: unknown,
    key: K
): MissionBlackboard[K] | undefined {
    const result = BlackboardSchema.safeParse(raw ?? {});
    return result.success ? result.data[key] : undefined;
}
