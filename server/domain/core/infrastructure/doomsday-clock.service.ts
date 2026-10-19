import { db } from "@server/database_service.js";
import { forensicEventLog } from "@shared/schema/index.js";
import { eq, count } from "drizzle-orm";
import { TraceContext } from "./trace-context.service.js";

export const MAX_SPANS_PER_TRACE = 1000;
export const MAX_DEPTH = 50;

/**
 * Validates execution against safety protocols (The "Doomsday Clock").
 * Checks for infinite recursion (depth) and runaway execution (total span count).
 */
export async function checkDoomsdayProtocol(
    traceContext: TraceContext
): Promise<{ safe: boolean; reason?: string }> {

    // 1. Trace Depth Check (Fast, In-Memory)
    // This relies on the propagation of depth in the TraceContext (tracestate).
    if (traceContext.depth > MAX_DEPTH) {
        return {
            safe: false,
            reason: `Recursion depth limit exceeded (${traceContext.depth} > ${MAX_DEPTH})`
        };
    }

    // 2. Total Trace Span Count (Database)
    // Prevents "wide" runaway processes that don't go deep but spawn thousands of siblings.
    try {
        const [{ count: spanCount }] = await db
            .select({ count: count() })
            .from(forensicEventLog)
            .where(eq(forensicEventLog.traceId, traceContext.traceId));

        // Use a buffer since this check happens *before* the current span is logged in some cases,
        // or concurrent spans might not be counted yet.
        if (spanCount > MAX_SPANS_PER_TRACE) {
            return {
                safe: false,
                reason: `Total trace span limit exceeded (${spanCount} > ${MAX_SPANS_PER_TRACE})`
            };
        }

    } catch (error) {
        console.warn("Doomsday DB Check Failed:", error);
        // We fail safe (allow execution) if DB is unreachable to prevent unrelated outages,
        // unless we are in a strict mode.
        return { safe: true };
    }

    return { safe: true };
}




