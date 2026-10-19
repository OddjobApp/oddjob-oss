import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("TimestampValidator");

/**
 * Maximum future clock skew allowed for client timestamps (60 seconds).
 * Prevents visitor clock drift or manipulation from inflating contribution weights.
 */
export const MAX_FUTURE_SKEW_MS = 60 * 1000;

/**
 * Earliest acceptable timestamp (Year 2000).
 * Rejects negative timestamps, Epoch 0 (1970), or absurd historical dates.
 */
export const MIN_VALID_TIMESTAMP_MS = new Date("2000-01-01T00:00:00.000Z").getTime();

/**
 * Defensively parses and validates a client event timestamp.
 *
 * Supports ISO strings, Date objects, and epoch timestamps in milliseconds or seconds.
 * Falls back to `now` if input is missing, invalid, non-finite, in the far past, or
 * ahead of the server time (clamped to `now`).
 */
export function parseAndValidateEventTimestamp(input: unknown, now: Date = new Date()): Date {
    if (input == null || input === "") {
        return now;
    }

    let parsedMs: number | undefined;

    if (input instanceof Date) {
        parsedMs = input.getTime();
    } else if (typeof input === "number") {
        if (Number.isFinite(input)) {
            // Handle epoch seconds (e.g. 1700000000) vs milliseconds (e.g. 1700000000000)
            parsedMs = input > 0 && input < 1e11 ? input * 1000 : input;
        }
    } else if (typeof input === "string") {
        const trimmed = input.trim();
        if (/^\d+(\.\d+)?$/.test(trimmed)) {
            const num = Number(trimmed);
            if (Number.isFinite(num)) {
                parsedMs = num > 0 && num < 1e11 ? num * 1000 : num;
            }
        } else {
            const d = new Date(trimmed);
            parsedMs = d.getTime();
        }
    }

    if (parsedMs == null || !Number.isFinite(parsedMs) || isNaN(parsedMs)) {
        return now;
    }

    // Reject absurdly old dates (e.g., negative, epoch 0, or before year 2000)
    if (parsedMs < MIN_VALID_TIMESTAMP_MS) {
        return now;
    }

    const nowMs = now.getTime();
    // Future date beyond tolerance -> fallback to `now`
    if (parsedMs > nowMs + MAX_FUTURE_SKEW_MS) {
        logger.warn(`Client timestamp is too far in the future (${new Date(parsedMs).toISOString()} vs now ${now.toISOString()}); falling back to server time`);
        return now;
    }

    // Slightly in the future within tolerance -> clamp to `now`
    if (parsedMs > nowMs) {
        return now;
    }

    return new Date(parsedMs);
}
