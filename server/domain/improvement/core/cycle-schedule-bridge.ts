/**
 * Bridges the platform's cycle schedule model onto the cron-based impact
 * analyzer.
 *
 * The impact analyzer speaks cron. Cycles do not: `metadata.scheduling.mode` is
 * one of `once | hourly | daily | weekly | monthly | yearly | on_complete`,
 * anchored to a timestamp, with the `recurrence` and `timezone` columns as a
 * fallback. There is no cron column anywhere on `operational_cycles`.
 *
 * Rather than teach the analyzer a second scheduling language, a mode plus its
 * anchor translates exactly into cron — the anchor supplies the minute, hour,
 * weekday and day-of-month that the mode leaves unspecified. That keeps one
 * tested implementation of run-count, cost, overlap and DST analysis.
 *
 * Two modes have no cron form, and saying so is better than inventing one:
 *
 *  - `once` does not recur. A forecast of "how many runs in 30 days" is not a
 *    question it can answer.
 *  - `on_complete` is triggered by the previous run finishing, so its cadence
 *    is a function of run duration, not of the clock. Presenting it as a fixed
 *    interval would be a fabrication — and precisely the kind this loop exists
 *    to prevent.
 */

import type { CycleScheduleConfig, CycleScheduleMode } from "@shared/cycle-scheduling.js";

export type CronTranslation =
    | { kind: "cron"; cron: string; timezone: string }
    | { kind: "not_recurring"; mode: CycleScheduleMode; reason: string }
    | { kind: "duration_driven"; mode: CycleScheduleMode; reason: string };

/** Fields of the anchor instant, read in the schedule's own timezone. */
function anchorParts(anchorAt: Date, timeZone: string) {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hour12: false,
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", weekday: "short",
    }).formatToParts(anchorAt);

    const get = (type: string) => parts.find(p => p.type === type)?.value ?? "";
    const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

    return {
        minute: Number(get("minute")),
        hour: Number(get("hour")) % 24,
        dayOfMonth: Number(get("day")),
        month: Number(get("month")),
        weekday: weekdays[get("weekday")] ?? 0,
    };
}

/**
 * Translate a cycle schedule into cron, or explain why it has no cron form.
 *
 * The anchor defaults to the epoch only so the translation is total; callers
 * should pass the real `anchorAt` or `nextRunAt`, because the anchor is what
 * decides the time of day a daily cycle actually runs.
 */
export function cycleScheduleToCron(
    config: Pick<CycleScheduleConfig, "mode" | "timezone" | "anchorAt">,
    fallbackAnchor?: Date | null,
): CronTranslation {
    const timezone = config.timezone || "UTC";

    if (config.mode === "once") {
        return {
            kind: "not_recurring",
            mode: config.mode,
            reason: "A 'once' schedule does not recur, so run-count and overlap forecasts do not apply to it.",
        };
    }
    if (config.mode === "on_complete") {
        return {
            kind: "duration_driven",
            mode: config.mode,
            reason:
                "An 'on_complete' schedule is triggered by the previous run finishing, so its cadence follows run duration rather than the clock. Presenting it as a fixed interval would be a fabrication.",
        };
    }

    const anchorSource = config.anchorAt ? new Date(config.anchorAt) : fallbackAnchor ?? null;
    const anchor =
        anchorSource && !Number.isNaN(anchorSource.getTime()) ? anchorSource : new Date(0);
    const { minute, hour, dayOfMonth, month, weekday } = anchorParts(anchor, timezone);

    switch (config.mode) {
        case "hourly":
            return { kind: "cron", cron: `${minute} * * * *`, timezone };
        case "daily":
            return { kind: "cron", cron: `${minute} ${hour} * * *`, timezone };
        case "weekly":
            return { kind: "cron", cron: `${minute} ${hour} * * ${weekday}`, timezone };
        case "monthly":
            return { kind: "cron", cron: `${minute} ${hour} ${dayOfMonth} * *`, timezone };
        case "yearly":
            return { kind: "cron", cron: `${minute} ${hour} ${dayOfMonth} ${month} *`, timezone };
        default: {
            // Exhaustiveness: a new mode must be handled deliberately rather
            // than silently forecast as something it is not.
            const exhaustive: never = config.mode;
            return {
                kind: "duration_driven",
                mode: exhaustive,
                reason: `Unrecognised schedule mode '${String(exhaustive)}'; refusing to guess a cadence for it.`,
            };
        }
    }
}

/** True when both schedules can be compared as cron. */
export function bothTranslatable(
    a: CronTranslation,
    b: CronTranslation,
): a is Extract<CronTranslation, { kind: "cron" }> {
    return a.kind === "cron" && b.kind === "cron";
}
