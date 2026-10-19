/**
 * Cycle Trajectory Service
 *
 * Exports the agent conversations from every mission in a cycle as a JSONL
 * file in the requested fine-tuning format (OpenAI / Anthropic / Gemini).
 *
 * "Trajectory" here = one multi-turn conversation per mission, ordered by
 * (createdAt, id). Roles map: 'user' -> user, 'agent' -> assistant (or
 * 'model' for Gemini). One JSONL line per mission.
 *
 * Different from fineTuningService.exportExamples — that exports curated
 * input/output pairs from fine_tuning_examples; this exports RAW chat logs
 * for use as training data (Hermes-style trajectory export).
 *
 * Designed to stream: callers should prefer exportCycleAsJsonlStream() for
 * large cycles. The eager exportCycleAsJsonl() wrapper is kept for tests
 * and small cycles; it materializes the full string in memory.
 */

import { db } from "@server/database_service.js";
import {
    operationalCycles,
    missionRuns,
    missions,
    agentChatMessages,
} from "@shared/schema/index.js";
import { eq, and, inArray, asc, isNotNull } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("CycleTrajectory");

export type TrajectoryFormat = 'openai' | 'anthropic' | 'gemini';

export interface TrajectoryTurn { role: 'user' | 'assistant'; content: string }

export interface ExportOptions {
    systemPrompt?: string;
    includeEmptyMissions?: boolean; // default false
    /** Drop messages shorter than this many chars (skips empty/control msgs). Default 1. */
    minMessageChars?: number;
}

// Bounds that protect both memory and downstream training pipelines.
// Per-mission message cap keeps any single trajectory line under a few MB.
const MAX_MESSAGES_PER_MISSION = 500;
// Per-message content cap (chars). Most training pipelines reject > 64 KB per
// turn; we truncate rather than drop to preserve trajectory structure.
const MAX_CONTENT_CHARS = 32_000;
// Cap the systemPrompt size so a malicious caller can't multiply a huge
// prompt across N trajectories.
export const MAX_SYSTEM_PROMPT_CHARS = 2_000;

export interface ExportStats {
    trajectories: number;
    missions: number;
    turns: number;
    format: TrajectoryFormat;
}

export const cycleTrajectoryService = {
    /**
     * Streaming variant — yields one JSONL line per mission. Use this for
     * HTTP responses on real cycles. Each yield is already
     * newline-terminated EXCEPT the first (caller responsible for joining).
     *
     * The third yielded tuple element is the running stats so the caller can
     * surface counts via headers after the body is fully sent.
     */
    async *exportCycleAsJsonlStream(
        cycleId: number,
        organizationId: number | null | undefined,
        isSuperAdmin: boolean,
        format: TrajectoryFormat,
        opts: ExportOptions = {},
    ): AsyncGenerator<string, ExportStats, void> {
        const cycle = await loadCycle(cycleId);
        if (!cycle) throw new Error("CYCLE_NOT_FOUND");
        if (!isSuperAdmin && cycle.organizationId !== organizationId) {
            throw new Error("FORBIDDEN");
        }

        // All distinct missions that have at least one run in this cycle.
        const runRows = await db.select({
            missionId: missionRuns.missionId,
        }).from(missionRuns)
            .where(and(eq(missionRuns.cycleId, cycleId), isNotNull(missionRuns.missionId)));

        const missionIds = Array.from(new Set(
            runRows.map(r => r.missionId).filter((v): v is number => v != null),
        ));
        if (missionIds.length === 0) {
            return { trajectories: 0, missions: 0, turns: 0, format };
        }

        // Belt-and-suspenders org filter: cycle is org-validated above, but
        // mission_runs.cycleId has no FK (schema flags it "Late-bound"), so
        // a stale row could otherwise drag in foreign-org missions.
        const cycleOrgId = cycle.organizationId;
        if (cycleOrgId == null) {
            // A cycle without an org should never produce a trajectory; reject
            // rather than silently exporting potentially cross-tenant data.
            throw new Error("CYCLE_HAS_NO_ORG");
        }
        const missionRows = await db.select({
            id: missions.id,
            name: missions.name,
            objective: missions.objective,
        }).from(missions).where(and(
            inArray(missions.id, missionIds),
            eq(missions.organizationId, cycleOrgId),
        ));

        if (missionRows.length === 0) {
            return { trajectories: 0, missions: 0, turns: 0, format };
        }
        const verifiedMissionIds = missionRows.map(m => m.id);

        // Load messages, also filtered by org. (createdAt, id) ordering
        // makes the output deterministic even when timestamps tie.
        const messageRows = await db.select({
            id: agentChatMessages.id,
            missionId: agentChatMessages.missionId,
            role: agentChatMessages.role,
            content: agentChatMessages.content,
            createdAt: agentChatMessages.createdAt,
        }).from(agentChatMessages)
            .where(and(
                inArray(agentChatMessages.missionId, verifiedMissionIds),
                eq(agentChatMessages.organizationId, cycleOrgId),
            ))
            .orderBy(asc(agentChatMessages.createdAt), asc(agentChatMessages.id));

        // Bucket messages by mission, capping per-mission count to the most
        // recent MAX_MESSAGES_PER_MISSION turns. Truncate over-long content.
        const buckets = new Map<number, TrajectoryTurn[]>();
        const minChars = opts.minMessageChars ?? 1;
        for (const m of messageRows) {
            if (!m.missionId || !m.content || m.content.length < minChars) continue;
            const role: 'user' | 'assistant' = m.role === 'user' ? 'user' : 'assistant';
            const content = m.content.length > MAX_CONTENT_CHARS
                ? m.content.slice(0, MAX_CONTENT_CHARS) + "\n…[truncated]"
                : m.content;
            const arr = buckets.get(m.missionId) ?? [];
            arr.push({ role, content });
            buckets.set(m.missionId, arr);
        }
        // Tail-truncate buckets that exceeded the per-mission cap (keep most recent).
        for (const [missionId, turns] of buckets) {
            if (turns.length > MAX_MESSAGES_PER_MISSION) {
                buckets.set(missionId, turns.slice(-MAX_MESSAGES_PER_MISSION));
            }
        }

        const rawSystemPrompt = opts.systemPrompt ?? "You are a helpful AI assistant.";
        const systemPrompt = clipSystemPrompt(rawSystemPrompt);

        let trajectoryCount = 0;
        let totalTurns = 0;
        for (const mission of missionRows) {
            const raw = buckets.get(mission.id) ?? [];
            const normalized = normalizeAlternation(raw);
            if (normalized.length === 0 && !opts.includeEmptyMissions) continue;

            totalTurns += normalized.length;
            const mergedSystem = mission.objective
                ? `${systemPrompt}\n\nMission objective: ${mission.objective}`
                : systemPrompt;
            const obj = formatTrajectory(format, mergedSystem, normalized);
            // Newline-terminated so consumers can concatenate without thinking.
            yield JSON.stringify(obj) + "\n";
            trajectoryCount++;
        }

        const stats: ExportStats = {
            trajectories: trajectoryCount,
            missions: missionRows.length,
            turns: totalTurns,
            format,
        };
        logger.info(`[CycleTrajectory] Exported cycle=${cycleId} missions=${missionRows.length} trajectories=${trajectoryCount} turns=${totalTurns} format=${format}`);
        return stats;
    },

    /**
     * Eager wrapper around the stream — collects all trajectories into a
     * single JSONL string. Use for tests and small cycles; prefer the
     * streaming variant for HTTP responses.
     */
    async exportCycleAsJsonl(
        cycleId: number,
        organizationId: number | null | undefined,
        isSuperAdmin: boolean,
        format: TrajectoryFormat,
        opts: ExportOptions = {},
    ): Promise<{ data: string; trajectories: number; missions: number; turns: number }> {
        const chunks: string[] = [];
        const gen = this.exportCycleAsJsonlStream(cycleId, organizationId, isSuperAdmin, format, opts);
        let stats: ExportStats = { trajectories: 0, missions: 0, turns: 0, format };
        while (true) {
            const { value, done } = await gen.next();
            if (done) {
                if (value) stats = value;
                break;
            }
            chunks.push(value);
        }
        return {
            data: chunks.join(""),
            trajectories: stats.trajectories,
            missions: stats.missions,
            turns: stats.turns,
        };
    },
};

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

async function loadCycle(cycleId: number) {
    const [row] = await db.select({
        id: operationalCycles.id,
        organizationId: operationalCycles.organizationId,
    }).from(operationalCycles).where(eq(operationalCycles.id, cycleId)).limit(1);
    return row ?? null;
}

function clipSystemPrompt(prompt: string): string {
    if (prompt.length <= MAX_SYSTEM_PROMPT_CHARS) return prompt;
    return prompt.slice(0, MAX_SYSTEM_PROMPT_CHARS) + "\n…[truncated]";
}

/**
 * Anthropic and Gemini both require strict role alternation starting with
 * 'user' AND ending with 'assistant' (the model output being trained).
 *   - Drop leading non-user turns
 *   - Merge consecutive same-role turns
 *   - Drop trailing non-assistant turns
 * Returns [] if the result would have fewer than one user/assistant pair.
 */
export function normalizeAlternation(turns: TrajectoryTurn[]): TrajectoryTurn[] {
    // 1. Drop leading non-user turns
    let lead = 0;
    while (lead < turns.length && turns[lead].role !== 'user') lead++;
    const trimmedLead = turns.slice(lead);
    if (trimmedLead.length === 0) return [];

    // 2. Merge consecutive same-role turns
    const merged: TrajectoryTurn[] = [];
    for (const t of trimmedLead) {
        const last = merged[merged.length - 1];
        if (last && last.role === t.role) {
            last.content = `${last.content}\n${t.content}`;
        } else {
            merged.push({ ...t });
        }
    }

    // 3. Drop trailing non-assistant turns (unanswered user message would
    //    make Anthropic/Gemini training reject the line)
    while (merged.length > 0 && merged[merged.length - 1].role !== 'assistant') {
        merged.pop();
    }

    // 4. Need at least one user+assistant pair to be useful.
    if (merged.length < 2) return [];
    return merged;
}

export function formatTrajectory(format: TrajectoryFormat, systemPrompt: string, turns: TrajectoryTurn[]): Record<string, unknown> {
    switch (format) {
        case 'anthropic':
            return {
                system: systemPrompt,
                messages: turns.map(t => ({ role: t.role, content: t.content })),
            };
        case 'gemini':
            return {
                systemInstruction: { parts: [{ text: systemPrompt }] },
                contents: turns.map(t => ({
                    role: t.role === 'assistant' ? 'model' : 'user',
                    parts: [{ text: t.content }],
                })),
            };
        case 'openai':
        default:
            return {
                messages: [
                    { role: 'system', content: systemPrompt },
                    ...turns.map(t => ({ role: t.role, content: t.content })),
                ],
            };
    }
}
