// ============================================================================
// PREDICTION INTELLIGENCE DOMAIN — QUANT DECAY TEST
// Verifies the exponential decay logic in the Quant Pod
// ============================================================================

import { describe, it, expect } from "vitest";
import { quantDecayPlugin } from "../quant/plugins/quant-decay.plugin.js";
import { createPluginContext } from "../plugin-runtime/plugin-runtime.js";
import { randomUUID } from "crypto";

describe("Quant Decay Plugin", () => {
    const ctx = createPluginContext({
        contextId: "test-context",
        mode: "realtime",
        requestId: `test-${randomUUID()}`,
        correlationId: `test-correlation`,
        permissions: { canWriteInferences: true, canWritePredictions: false, canCallAgents: false, canReadSensitiveData: false, canUseGeographicData: false, canUseSpatialData: false }
    });

    it("should apply exponential decay to quant magnitude", async () => {
        const now = new Date();
        const createdAt = new Date(now.getTime() - 10000); // 10 seconds ago

        const mockQuant = {
            id: "quant-1",
            contextId: "test-context",
            type: "event_density" as const,
            magnitude: 10.0,
            createdAt: createdAt.toISOString(),
            sourceEventIds: [],
            lifecycle: {
                status: "active" as const,
                decayRate: 0.1, // 10% per second
                resilience: 0.5,
                resonance: 0.1
            }
        };

        const result = await quantDecayPlugin.execute({
            quant: mockQuant as any,
            nowMs: now.getTime()
        }, ctx);

        expect(result.status).toBe("success");
        expect(result.output).toBeDefined();
        
        const { magnitude, lifecycle } = result.output!;
        
        // Expected magnitude: 10 * exp(-0.1 * 10) = 10 * exp(-1) ≈ 3.6788
        expect(magnitude).toBeCloseTo(3.6788, 4);
        
        // Status should transition to "decaying" since it fell below 50%
        expect(lifecycle.status).toBe("decaying");
    });

    it("should archive quant if magnitude falls below threshold", async () => {
        const now = new Date();
        const createdAt = new Date(now.getTime() - 60000); // 60 seconds ago

        const mockQuant = {
            id: "quant-2",
            contextId: "test-context",
            type: "event_density" as const,
            magnitude: 10.0,
            createdAt: createdAt.toISOString(),
            sourceEventIds: [],
            lifecycle: {
                status: "decaying" as const,
                decayRate: 0.1,
                resilience: 0.5,
                resonance: 0.1
            }
        };

        const result = await quantDecayPlugin.execute({
            quant: mockQuant as any,
            nowMs: now.getTime()
        }, ctx);

        expect(result.status).toBe("success");
        
        const { magnitude, lifecycle } = result.output!;
        
        // Expected magnitude: 10 * exp(-0.1 * 60) = 10 * exp(-6) ≈ 0.0248
        expect(magnitude).toBeCloseTo(0.0248, 4);
        
        // Status should transition to "archived" since magnitude < 0.05
        expect(lifecycle.status).toBe("archived");
    });
});
