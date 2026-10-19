import { describe, it, expect } from "vitest";
import { canonicalEventService } from "./canonical-event.service.js";
import type { RawEventEnvelope } from "./types.js";
import type { DomainContext } from "../quant/types.js";

describe("CanonicalEventService", () => {
    const mockCtx: DomainContext = {
        mode: "realtime",
        requestId: "test-request",
        correlationId: "test-correlation",
        now: new Date().toISOString()
    };

    it("should canonicalize a valid raw event", async () => {
        const rawEvent: RawEventEnvelope = {
            source: "test-source",
            payload: {
                action: "user_login",
                userId: "user-123"
            }
        };

        const result = await canonicalEventService.canonicalize(rawEvent, mockCtx);
        
        expect(result.accepted).toBe(true);
        expect(result.event).toBeDefined();
        expect(result.event?.source).toBe("test-source");
        expect(result.event?.canonicalPayload).toEqual(rawEvent.payload);
    });

    it("should fail validation if source is missing", async () => {
        const rawEvent: RawEventEnvelope = {
            source: "",
            payload: { action: "test" }
        };

        const result = await canonicalEventService.canonicalize(rawEvent, mockCtx);
        
        expect(result.accepted).toBe(false);
        expect(result.validation.valid).toBe(false);
        expect(result.validation.errors.length).toBeGreaterThan(0);
    });

    it("should classify event kind based on action", async () => {
        const rawEvent: RawEventEnvelope = {
            source: "test",
            action: "predict_outcome",
            payload: {}
        };

        const result = await canonicalEventService.canonicalize(rawEvent, mockCtx);
        
        expect(result.accepted).toBe(true);
        expect(result.event?.eventKind).toBe("prediction");
    });
});
