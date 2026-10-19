import { db } from "@server/database_service.js";
import { expectedEventGaps } from "@shared/schema/prediction/windowing.js";
import { eq, and, sql } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("EventGapAnomalyService");

export interface DeafeningSilenceAlert {
    gapId: string;
    contextId: string;
    eventType: string;
    expectedWindowMs: number;
    elapsedSinceLastEventMs: number;
    severity: "warning" | "critical";
    alertMessage: string;
}

/**
 * Deafening Silence Anomaly Detection Service:
 * Detects missing heartbeat pulse/telemetry signals from expected_event_gaps table
 * when expected system or telemetry events fail to arrive within their probability window.
 */
export class EventGapAnomalyService {
    public static async detectCadenceBreaches(contextId: string): Promise<DeafeningSilenceAlert[]> {
        const breaches: DeafeningSilenceAlert[] = [];

        try {
            const records = await db.select()
                .from(expectedEventGaps)
                .where(eq(expectedEventGaps.contextId, contextId))
                .limit(50);

            const now = Date.now();

            for (const record of records) {
                // expected_event_gaps has no lastObservedAt column; updatedAt is
                // when the cadence record was last touched, which is the
                // observation this measures silence from.
                const lastSeenMs = record.updatedAt ? record.updatedAt.getTime() : now - record.expectedGapMs * 2;
                const elapsedMs = now - lastSeenMs;

                if (elapsedMs > record.expectedGapMs * 1.5) {
                    const isCritical = elapsedMs > record.expectedGapMs * 3.0;
                    const severity = isCritical ? "critical" : "warning";
                    const alertMessage = `⚠️ Deafening Silence Anomaly: Expected '${record.eventType}' event gap (${record.expectedGapMs}ms) breached. Elapsed: ${elapsedMs}ms.`;

                    breaches.push({
                        gapId: String(record.id),
                        contextId: record.contextId,
                        eventType: record.eventType,
                        expectedWindowMs: record.expectedGapMs,
                        elapsedSinceLastEventMs: elapsedMs,
                        severity,
                        alertMessage
                    });

                    logger.warn(`[EventGapAnomalyService] Cadence breach detected for event '${record.eventType}' in context '${contextId}'.`);
                }
            }
        } catch (err: any) {
            logger.error(`[EventGapAnomalyService] Error querying expected event gaps: ${err.message}`);
        }

        return breaches;
    }
}
