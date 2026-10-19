// ============================================================================
// PREDICTION INTELLIGENCE DOMAIN — WINDOWING CHAIN TEST
// Verifies the full pipeline of the Windowing Pod
// ============================================================================

import { describe, it, expect } from "vitest";
import { canonicalEventService } from "../canonical-event/canonical-event.service.js";
import { windowingService } from "../windowing/windowing.service.js";
import { randomUUID } from "crypto";

describe("Windowing Chain Flow", () => {
    const ctx = {
        mode: "realtime" as const,
        now: new Date().toISOString(),
        requestId: `test-${randomUUID()}`,
        correlationId: `test-correlation`
    };

    it("should execute the full windowing chain", async () => {
        // 1. Ingest Event
        const rawEvent = {
            source: "mission_tracker",
            action: "phase_transition",
            payload: { phase: "PLANNING" },
            contextHint: "mission-123"
        };

        const canonicalResult = await canonicalEventService.canonicalize(rawEvent, ctx);
        expect(canonicalResult.event).toBeDefined();
        const event = canonicalResult.event!;

        // 2. Sequence Event
        const sequenceResult = await windowingService.sequenceEvent({
            event: {
                id: event.id,
                contextId: event.contextId,
                occurredAt: event.occurredAt,
                action: event.action
            },
            recentEvents: []
        }, ctx);

        expect(sequenceResult.sequenceIndex).toBeDefined();

        // 3. Assign Windows
        const windowSet = await windowingService.assignWindows({
            contextId: event.contextId,
            eventId: event.id,
            timestamp: event.occurredAt,
            recentEventCount: 5,
            recentEventActions: ["phase_transition", "step_executed"],
            mode: ctx.mode
        }, ctx);

        expect(windowSet.windows.length).toBeGreaterThan(0);
        expect(windowSet.primaryWindowId).toBeDefined();

        // 4. Compute Temporal Features
        const features = await windowingService.computeTemporalFeatures({
            event: {
                id: event.id,
                occurredAt: event.occurredAt,
                action: event.action
            },
            contextId: event.contextId,
            activeWindows: windowSet.windows,
            sequenceIndex: sequenceResult.sequenceIndex,
            prePriorEventIds: sequenceResult.prePriorEventIds,
            mode: ctx.mode
        }, ctx);

        expect(features.recency).toBeGreaterThan(0);
        expect(features.frequency).toBeDefined();
        expect(features.persistence).toBeDefined();

        // 5. Detect Burst
        const burstResult = await windowingService.detectBurst({
            contextId: event.contextId,
            windowId: windowSet.primaryWindowId,
            currentDensity: 1.0,
            baselineDensity: 0.2,
            eventTypes: [event.action],
            evidenceEventIds: [event.id],
            mode: ctx.mode
        }, ctx);

        expect(burstResult.burstDetected).toBeDefined();
    });
});
