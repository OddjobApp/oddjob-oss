import { createHash } from "node:crypto";
import type { ActionContext, ActionHandler, BaseDecision, PausedResult } from "./action-handler.js";

export type MissionActionStatus = "planned" | "validating" | "executing" | "succeeded" | "failed" | "paused";

export interface MissionRuntimeSnapshot {
    status?: string;
    capturedAt: string;
    blackboard: Record<string, unknown>;
    missionContext: Record<string, unknown>;
    blackboardHash: string;
    missionContextHash: string;
}

export interface MissionRuntimeDiff {
    blackboard: {
        added: string[];
        changed: string[];
        removed: string[];
    };
    missionContext: {
        added: string[];
        changed: string[];
        removed: string[];
    };
}

export interface MissionActionExecutionRecord extends Record<string, unknown> {
    type: "action_execution";
    event: `action_${MissionActionStatus}`;
    actionId: string;
    missionRunId: number;
    missionId: number;
    cycle: number;
    traceCycleId?: string;
    action: string;
    toolName?: string;
    status: MissionActionStatus;
    startedAt: string;
    completedAt?: string;
    latencyMs?: number;
    thought?: string;
    params?: Record<string, unknown>;
    error?: string;
    pauseReason?: string;
    snapshotBefore?: MissionRuntimeSnapshot;
    snapshotAfter?: MissionRuntimeSnapshot;
    diff?: MissionRuntimeDiff;
}

export type LoadRuntimeSnapshot = () => Promise<MissionRuntimeSnapshot>;

export function createRuntimeSnapshot(input: {
    status?: string;
    blackboard?: unknown;
    missionContext?: unknown;
    capturedAt?: string;
}): MissionRuntimeSnapshot {
    const blackboard = compactRecord(input.blackboard);
    const missionContext = compactRecord(input.missionContext);

    return {
        status: input.status,
        capturedAt: input.capturedAt ?? new Date().toISOString(),
        blackboard,
        missionContext,
        blackboardHash: hashJson(blackboard),
        missionContextHash: hashJson(missionContext),
    };
}

export function diffRuntimeSnapshots(before: MissionRuntimeSnapshot, after: MissionRuntimeSnapshot): MissionRuntimeDiff {
    return {
        blackboard: diffRecords(before.blackboard, after.blackboard),
        missionContext: diffRecords(before.missionContext, after.missionContext),
    };
}

export async function runActionWithRuntimeKernel(options: {
    ctx: ActionContext;
    decision: BaseDecision;
    handler: ActionHandler;
    traceCycleId?: string;
    loadSnapshot: LoadRuntimeSnapshot;
}): Promise<PausedResult | void> {
    const { ctx, decision, handler, traceCycleId, loadSnapshot } = options;
    const action = String(decision.action || "UNKNOWN").toUpperCase();
    const startedAt = new Date().toISOString();
    const actionId = `${ctx.missionRunId}:${ctx.currentCycle}:${action}:${Date.now()}`;
    const params = normalizeParams(decision.action_details ?? decision.params);
    const toolName = action === "CALL_TOOL" ? String(params.tool_name || "") || undefined : undefined;

    const snapshotBefore = await loadSnapshot();
    await ctx.appendTrace(ctx.missionRunId, buildRecord({
        ctx,
        actionId,
        action,
        toolName,
        status: "validating",
        startedAt,
        traceCycleId,
        decision,
        params,
        snapshotBefore,
    }));

    await ctx.appendTrace(ctx.missionRunId, buildRecord({
        ctx,
        actionId,
        action,
        toolName,
        status: "executing",
        startedAt,
        traceCycleId,
        decision,
        params,
    }));

    const startedMs = Date.now();
    try {
        const result = await handler.execute(ctx, decision);
        const completedAt = new Date().toISOString();
        const snapshotAfter = await loadSnapshot();
        const status: MissionActionStatus = result?.status === "paused" ? "paused" : "succeeded";

        await ctx.appendTrace(ctx.missionRunId, buildRecord({
            ctx,
            actionId,
            action,
            toolName,
            status,
            startedAt,
            completedAt,
            latencyMs: Date.now() - startedMs,
            traceCycleId,
            decision,
            params,
            pauseReason: result?.status === "paused" ? result.reason : undefined,
            snapshotBefore,
            snapshotAfter,
            diff: diffRuntimeSnapshots(snapshotBefore, snapshotAfter),
        }));

        return result;
    } catch (error) {
        const completedAt = new Date().toISOString();
        const snapshotAfter = await loadSnapshot().catch(() => snapshotBefore);
        await ctx.appendTrace(ctx.missionRunId, buildRecord({
            ctx,
            actionId,
            action,
            toolName,
            status: "failed",
            startedAt,
            completedAt,
            latencyMs: Date.now() - startedMs,
            traceCycleId,
            decision,
            params,
            error: error instanceof Error ? error.message : String(error),
            snapshotBefore,
            snapshotAfter,
            diff: diffRuntimeSnapshots(snapshotBefore, snapshotAfter),
        }));
        throw error;
    }
}

function buildRecord(input: {
    ctx: ActionContext;
    actionId: string;
    action: string;
    toolName?: string;
    status: MissionActionStatus;
    startedAt: string;
    completedAt?: string;
    latencyMs?: number;
    traceCycleId?: string;
    decision: BaseDecision;
    params?: Record<string, unknown>;
    error?: string;
    pauseReason?: string;
    snapshotBefore?: MissionRuntimeSnapshot;
    snapshotAfter?: MissionRuntimeSnapshot;
    diff?: MissionRuntimeDiff;
}): MissionActionExecutionRecord {
    return {
        type: "action_execution",
        event: `action_${input.status}`,
        actionId: input.actionId,
        missionRunId: input.ctx.missionRunId,
        missionId: input.ctx.missionId,
        cycle: input.ctx.currentCycle,
        traceCycleId: input.traceCycleId,
        action: input.action,
        toolName: input.toolName,
        status: input.status,
        startedAt: input.startedAt,
        completedAt: input.completedAt,
        latencyMs: input.latencyMs,
        thought: input.decision.thought_process,
        params: input.params,
        error: input.error,
        pauseReason: input.pauseReason,
        snapshotBefore: input.snapshotBefore,
        snapshotAfter: input.snapshotAfter,
        diff: input.diff,
    };
}

function normalizeParams(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {};
    }
    return value as Record<string, unknown>;
}

function compactRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {};
    }

    return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, compactValue(entry)])
    );
}

function compactValue(value: unknown): unknown {
    if (typeof value === "string") {
        return value.length > 1_000 ? `${value.slice(0, 1_000)}...` : value;
    }
    if (Array.isArray(value)) {
        return value.slice(0, 25).map(compactValue);
    }
    if (value && typeof value === "object") {
        const entries = Object.entries(value as Record<string, unknown>).slice(0, 25);
        return Object.fromEntries(entries.map(([key, entry]) => [key, compactValue(entry)]));
    }
    return value;
}

function diffRecords(before: Record<string, unknown>, after: Record<string, unknown>) {
    const beforeKeys = new Set(Object.keys(before));
    const afterKeys = new Set(Object.keys(after));
    const added = [...afterKeys].filter(key => !beforeKeys.has(key)).sort();
    const removed = [...beforeKeys].filter(key => !afterKeys.has(key)).sort();
    const changed = [...afterKeys]
        .filter(key => beforeKeys.has(key) && stableJson(before[key]) !== stableJson(after[key]))
        .sort();

    return { added, changed, removed };
}

function hashJson(value: unknown): string {
    return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value: unknown): string {
    return JSON.stringify(sortObject(value));
}

function sortObject(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(sortObject);
    }
    if (value && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, entry]) => [key, sortObject(entry)])
        );
    }
    return value;
}
