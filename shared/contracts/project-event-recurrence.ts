/**
 * Expanding a recurring project event into the occurrences inside a window.
 *
 * Occurrences are derived, never stored. A weekly review for a year is one row
 * and fifty-two dates; materialising them would mean a row explosion, an
 * arbitrary horizon to pick, and a backfill every time somebody edits the rule.
 * The scheduler already treats cycles this way, so this follows it rather than
 * inventing a second model.
 *
 * Pure and shared: the same expansion runs on the server for the API and the
 * primer, and in the browser for the calendar, so a date can never appear in one
 * and not the other.
 */

import { CronExpressionParser } from 'cron-parser';

export interface RecurringEventInput {
    id: number;
    startsAt: string | Date;
    endsAt?: string | Date | null;
    /** Standard 5-field cron, or null for a one-off. */
    recurrence?: string | null;
    recurrenceTimezone?: string | null;
    recurrenceUntil?: string | Date | null;
}

export interface EventOccurrence {
    /** The row this came from. */
    eventId: number;
    /**
     * Stable identity for one occurrence: `<eventId>@<iso>`.
     *
     * Derived rather than persisted, so it can be cited in a room or passed to
     * an agent and still resolve after a restart — but it is deliberately
     * distinguishable from a real row id, because deleting "the 3rd of March"
     * of a weekly series is a different operation from deleting the series.
     */
    occurrenceId: string;
    startsAt: Date;
    endsAt: Date | null;
    /** False for the stored row's own date, true for a generated repeat. */
    isRecurrence: boolean;
}

/** Guards a pathological rule (`* * * * *` over a year) from hanging the process. */
const MAX_OCCURRENCES = 500;

/**
 * Whether a cron expression is one this system will accept.
 *
 * Used by the API so a bad rule is rejected at write time with a useful message,
 * rather than silently producing an event that never appears on any calendar.
 */
export function isValidRecurrence(expression: string, timezone = 'UTC'): boolean {
    // cron-parser tolerates an empty expression; an empty recurrence means "not
    // recurring" and must never be stored as a rule.
    if (!expression || !expression.trim()) return false;
    try {
        CronExpressionParser.parse(expression, { tz: timezone });
        return true;
    } catch {
        return false;
    }
}

/**
 * Occurrences of `event` that start within [windowStart, windowEnd].
 *
 * A non-recurring event yields at most its own date. A recurring one yields its
 * generated dates; the stored `startsAt` acts as the series anchor and is
 * included only when the rule actually lands on it, so an anchor of Wednesday
 * with a "every Monday" rule does not produce a stray Wednesday.
 */
export function expandOccurrences(
    event: RecurringEventInput,
    windowStart: Date,
    windowEnd: Date,
): EventOccurrence[] {
    const anchor = new Date(event.startsAt);
    const duration = event.endsAt ? new Date(event.endsAt).getTime() - anchor.getTime() : null;

    const withEnd = (start: Date): Date | null =>
        duration === null ? null : new Date(start.getTime() + duration);

    if (!event.recurrence) {
        if (anchor < windowStart || anchor > windowEnd) return [];
        return [{
            eventId: event.id,
            occurrenceId: `${event.id}@${anchor.toISOString()}`,
            startsAt: anchor,
            endsAt: withEnd(anchor),
            isRecurrence: false,
        }];
    }

    // A series never starts before its anchor: "every Monday from March" must not
    // backfill February just because the window reaches back that far.
    const from = anchor > windowStart ? anchor : windowStart;
    const until = event.recurrenceUntil ? new Date(event.recurrenceUntil) : null;
    const to = until && until < windowEnd ? until : windowEnd;
    if (from > to) return [];

    // Parsing is fenced separately from iterating. cron-parser signals "no more
    // occurrences" by throwing, so a single try around both would treat the
    // natural end of a series as a broken rule and fall back to the anchor —
    // silently collapsing every recurrence to one date.
    let interval;
    try {
        interval = CronExpressionParser.parse(event.recurrence, {
            currentDate: new Date(from.getTime() - 1),
            endDate: to,
            tz: event.recurrenceTimezone || 'UTC',
        });
    } catch {
        // A rule that no longer parses must not blank the timeline. Degrade to
        // the anchor, which is the one date we know was intended.
        return anchor >= windowStart && anchor <= windowEnd
            ? [{
                eventId: event.id,
                occurrenceId: `${event.id}@${anchor.toISOString()}`,
                startsAt: anchor,
                endsAt: withEnd(anchor),
                isRecurrence: false,
            }]
            : [];
    }

    const occurrences: EventOccurrence[] = [];
    while (occurrences.length < MAX_OCCURRENCES && interval.hasNext()) {
        const startsAt = interval.next().toDate();
        if (startsAt > to) break;

        occurrences.push({
            eventId: event.id,
            occurrenceId: `${event.id}@${startsAt.toISOString()}`,
            startsAt,
            endsAt: withEnd(startsAt),
            // The anchor's own date is not a repeat, even when the rule lands on it.
            isRecurrence: startsAt.getTime() !== anchor.getTime(),
        });
    }
    return occurrences;
}

/**
 * The next occurrence at or after `from`, or null if the series has ended.
 *
 * Used by the primer, which cares only about what is coming next — expanding a
 * whole window to take the first element would be wasteful and, for an
 * open-ended rule, unbounded.
 */
export function nextOccurrence(event: RecurringEventInput, from: Date = new Date()): Date | null {
    const anchor = new Date(event.startsAt);

    if (!event.recurrence) return anchor >= from ? anchor : null;

    const until = event.recurrenceUntil ? new Date(event.recurrenceUntil) : null;
    if (until && until < from) return null;

    const start = anchor > from ? anchor : from;
    try {
        const interval = CronExpressionParser.parse(event.recurrence, {
            currentDate: new Date(start.getTime() - 1),
            tz: event.recurrenceTimezone || 'UTC',
        });
        const next = interval.next().toDate();
        if (until && next > until) return null;
        return next;
    } catch {
        return anchor >= from ? anchor : null;
    }
}
