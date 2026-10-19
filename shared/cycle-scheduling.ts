export const CYCLE_SCHEDULE_MODES = ["once", "yearly", "monthly", "weekly", "daily", "hourly", "on_complete"] as const;
export type CycleScheduleMode = typeof CYCLE_SCHEDULE_MODES[number];

export const CYCLE_OVERLAP_POLICIES = ["skip", "buffer_one", "allow_all"] as const;
export type CycleOverlapPolicy = typeof CYCLE_OVERLAP_POLICIES[number];

export interface CycleScheduleConfig {
    mode: CycleScheduleMode;
    enabled: boolean;
    timezone: string;
    anchorAt?: string | null;
    overlapPolicy: CycleOverlapPolicy;
    pauseOnFailure: boolean;
    catchupWindowSeconds: number;
    cooldownMinutes: number;
    maxConsecutiveRuns: number;
}

const MODE_ALIASES: Record<string, CycleScheduleMode> = {
    continuous: "on_complete",
    interval: "hourly",
    custom: "daily",
};

export function normalizeCycleSchedule(metadata: any, recurrence?: string | null, timezone?: string | null): CycleScheduleConfig {
    const raw = metadata?.scheduling ?? {};
    const rawMode = String(raw.mode ?? raw.type ?? recurrence ?? "once").toLowerCase();
    const mode = CYCLE_SCHEDULE_MODES.includes(rawMode as CycleScheduleMode)
        ? rawMode as CycleScheduleMode
        : MODE_ALIASES[rawMode] ?? "once";

    return {
        mode,
        enabled: raw.enabled ?? mode !== "once",
        timezone: raw.timezone ?? timezone ?? "UTC",
        anchorAt: raw.anchorAt ?? raw.nextRunAt ?? null,
        overlapPolicy: CYCLE_OVERLAP_POLICIES.includes(raw.overlapPolicy)
            ? raw.overlapPolicy
            : "skip",
        pauseOnFailure: raw.pauseOnFailure ?? true,
        catchupWindowSeconds: Number(raw.catchupWindowSeconds ?? 86400),
        cooldownMinutes: Math.max(0, Number(raw.cooldownMinutes ?? 1)),
        maxConsecutiveRuns: Math.max(1, Number(raw.maxConsecutiveRuns ?? 25)),
    };
}

function addMonthsClamped(date: Date, months: number) {
    const result = new Date(date);
    const day = result.getDate();
    result.setDate(1);
    result.setMonth(result.getMonth() + months);
    const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
    result.setDate(Math.min(day, lastDay));
    return result;
}

function addInterval(date: Date, mode: CycleScheduleMode) {
    const next = new Date(date);
    switch (mode) {
        case "hourly":
            next.setHours(next.getHours() + 1);
            return next;
        case "daily":
            next.setDate(next.getDate() + 1);
            return next;
        case "weekly":
            next.setDate(next.getDate() + 7);
            return next;
        case "monthly":
            return addMonthsClamped(next, 1);
        case "yearly":
            return addMonthsClamped(next, 12);
        default:
            return null;
    }
}

export function computeNextCycleRun(from: Date, schedule: CycleScheduleConfig): Date | null {
    if (!schedule.enabled || schedule.mode === "once" || schedule.mode === "on_complete") return null;

    const anchor = schedule.anchorAt ? new Date(schedule.anchorAt) : new Date(from);
    if (Number.isNaN(anchor.getTime())) return null;
    if (anchor.getTime() > from.getTime()) return anchor;

    let cursor = new Date(anchor);
    for (let i = 0; i < schedule.maxConsecutiveRuns; i++) {
        const next = addInterval(cursor, schedule.mode);
        if (!next) return null;
        cursor = next;
        if (cursor.getTime() > from.getTime()) return cursor;
    }
    return cursor;
}

export function previewCycleRuns(from: Date, schedule: CycleScheduleConfig, count = 5): Date[] {
    const runs: Date[] = [];
    let cursor = new Date(from);
    for (let i = 0; i < count; i++) {
        const next = computeNextCycleRun(cursor, schedule);
        if (!next) break;
        runs.push(next);
        cursor = next;
    }
    return runs;
}
