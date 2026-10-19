import { randomUUID } from "crypto";
import { describe, it, expect } from "vitest";
import { contextService } from "./context.service.js";
import type { ContextCreationInput, ContextResolutionInput } from "./types.js";
import type { DomainContext } from "../quant/types.js";

describe("ContextService", () => {
    const mockCtx: DomainContext = {
        mode: "realtime",
        requestId: "test-request",
        correlationId: "test-correlation",
        now: new Date().toISOString()
    };

    it("should create a new context", async () => {
        const input: ContextCreationInput = {
            type: "session",
            mode: "realtime",
            sessionId: "session-123"
        };

        const context = await contextService.createContext(input, mockCtx);
        
        expect(context).toBeDefined();
        expect(context.id).toBeDefined();
        expect(context.type).toBe("session");
        expect(context.sessionId).toBe("session-123");
        expect(context.status).toBe("active");
    });

    it("should resolve context using hint", async () => {
        // Create one first
        const created = await contextService.createContext({
            type: "session",
            mode: "realtime"
        }, mockCtx);

        const input: ContextResolutionInput = {
            mode: "realtime",
            contextHint: created.id
        };

        const result = await contextService.resolve(input, mockCtx);
        
        expect(result.context).toBeDefined();
        expect(result.context.id).toBe(created.id);
        expect(result.createdNew).toBe(false);
    });

    it("should fallback to new context if hint not found", async () => {
        // The hint has to be unique per run. resolveContextId hashes a
        // non-UUID hint into a deterministic id, so "non-existent-id" was only
        // absent the first time this suite ever ran — every run after it
        // resolved the context its predecessor had created and reported
        // createdNew: false.
        const input: ContextResolutionInput = {
            mode: "realtime",
            contextHint: `non-existent-${randomUUID()}`
        };

        const result = await contextService.resolve(input, mockCtx);

        expect(result.context).toBeDefined();
        expect(result.context.id).not.toBe(input.contextHint);
        expect(result.createdNew).toBe(true);
    });

    it("should update lifecycle status", async () => {
        const created = await contextService.createContext({
            type: "session",
            mode: "realtime"
        }, mockCtx);

        const updated = await contextService.updateLifecycle({
            contextId: created.id,
            status: "closed"
        }, mockCtx);
        
        expect(updated.status).toBe("closed");
        expect(updated.closedAt).toBeDefined();
    });
});
