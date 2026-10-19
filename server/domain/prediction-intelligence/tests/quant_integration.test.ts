// ============================================================================
// PREDICTION INTELLIGENCE DOMAIN — QUANT INTEGRATION TEST
// Verifies that QuantIntegration calls graphService correctly.
// ============================================================================

import { describe, it, expect, vi } from "vitest";
import { quantIntegration } from "../integrations/quant-integration.js";
import { graphService } from "@domain/knowledge/core/graph/graph-service.js";

// Mock graphService
vi.mock("@domain/knowledge/core/graph/graph-service.js", () => ({
    graphService: {
        resolveEntitiesToNodeIds: vi.fn().mockResolvedValue([]),
        createNode: vi.fn().mockImplementation((input) => Promise.resolve({ id: Math.random() })),
        createEdge: vi.fn().mockResolvedValue({ id: 100 })
    }
}));

describe("Quant Integration", () => {
    it("should map quants as edges", async () => {
        const result = await quantIntegration.mapQuants(
            "pred-1",
            "user_will_click",
            [
                { id: "q-1", label: "click_velocity", value: 0.8 },
                { id: "q-2", label: "session_depth", value: 0.5 }
            ],
            { organizationId: 1 } as any
        );

        expect(result).toBe(true);
        expect(graphService.createNode).toHaveBeenCalledTimes(3); // Prediction, Quant1, Quant2
        expect(graphService.createEdge).toHaveBeenCalledTimes(2); // Pred->Quant1, Pred->Quant2
    });
});
