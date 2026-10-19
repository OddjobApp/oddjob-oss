/**
 * In-flight mission runs — what the Copilot "Live Mission Flight Deck" shows.
 *
 * The deck used to list rows from `missions`, which are mission *definitions*.
 * `missions.status` defaults to "active", so every saved definition rendered as
 * "In Flight", and because that query returned no spend, budget or step, the
 * card filled the gaps with constants ($0.42 / $5.00 and a canned thought line).
 * Forty identical "running" missions were forty saved templates.
 *
 * A run is the thing that executes, so the deck now reads `mission_runs`, and
 * every number on a card is a column or is absent. A run whose status says
 * "active" but which has not checkpointed or updated recently is reported as
 * stale rather than in flight: status alone is a claim, activity is evidence.
 */

export const IN_FLIGHT_RUN_STATUSES = ["active", "paused", "waiting_on_human", "waiting_on_file"] as const;
export type InFlightRunStatus = (typeof IN_FLIGHT_RUN_STATUSES)[number];

/** An active run with no update or checkpoint for this long is reported stale. */
export const STALE_AFTER_MS = 15 * 60 * 1000;

export interface InFlightRunRow {
    id: number;
    missionId: number | null;
    name: string;
    status: string;
    costUsd: string | number | null;
    budgetLimitUsd: string | number | null;
    /** Last element of mission_runs.dynamic_trace, or null. */
    lastTraceEntry: unknown;
    lastCheckpointAt: Date | string | null;
    updatedAt: Date | string;
}

export interface InFlightRun {
    runId: number;
    missionId: number | null;
    name: string;
    status: InFlightRunStatus;
    /** Recorded spend, or null when the run has none recorded. */
    costUsd: number | null;
    /** The parent mission's budget limit, or null when there is none. */
    budgetLimitUsd: number | null;
    /** A label built only from fields of the last trace entry, or null. */
    lastEvent: string | null;
    lastActivityAt: string;
    /** Active by status but no recent activity — probably not executing. */
    stale: boolean;
}

function toNumberOrNull(value: string | number | null | undefined): number | null {
    if (value === null || value === undefined || value === "") return null;
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? n : null;
}

function toTime(value: Date | string | null | undefined): number | null {
    if (!value) return null;
    const t = value instanceof Date ? value.getTime() : Date.parse(value);
    return Number.isFinite(t) ? t : null;
}

/**
 * Labels a trace entry from its own fields (`event`, `tool`, `type`). Returns
 * null rather than inventing a description when the entry carries none.
 */
export function describeTraceEntry(entry: unknown): string | null {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const rec = entry as Record<string, unknown>;
    const pick = (key: string) => (typeof rec[key] === "string" && (rec[key] as string).trim() ? (rec[key] as string).trim() : null);
    const event = pick("event") ?? pick("type");
    const tool = pick("tool");
    if (event && tool) return `${event.replace(/_/g, " ")} · ${tool}`;
    if (event) return event.replace(/_/g, " ");
    if (tool) return tool;
    return null;
}

export function isInFlightStatus(status: string): status is InFlightRunStatus {
    return (IN_FLIGHT_RUN_STATUSES as readonly string[]).includes(status);
}

export function toInFlightRun(row: InFlightRunRow, now: number = Date.now()): InFlightRun | null {
    if (!isInFlightStatus(row.status)) return null;

    const updated = toTime(row.updatedAt);
    const checkpoint = toTime(row.lastCheckpointAt);
    const lastActivity = Math.max(updated ?? 0, checkpoint ?? 0);

    return {
        runId: row.id,
        missionId: row.missionId,
        name: row.name,
        status: row.status,
        costUsd: toNumberOrNull(row.costUsd),
        budgetLimitUsd: toNumberOrNull(row.budgetLimitUsd),
        lastEvent: describeTraceEntry(row.lastTraceEntry),
        lastActivityAt: new Date(lastActivity).toISOString(),
        // Only an active run can be stale; a paused or waiting run is idle by design.
        stale: row.status === "active" && now - lastActivity > STALE_AFTER_MS,
    };
}
