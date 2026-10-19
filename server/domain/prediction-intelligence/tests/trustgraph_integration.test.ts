// ============================================================================
// PREDICTION INTELLIGENCE DOMAIN — TRUSTGRAPH INTEGRATION TEST
// Verifies that TrustGraphIntegration calls graphService correctly.
// ============================================================================

import { describe, it, expect, vi } from "vitest";
import { trustGraphIntegration } from "../integrations/trustgraph-integration.js";
import { graphService } from "@domain/knowledge/core/graph/graph-service.js";

// Mock graphService to avoid DB dependencies
vi.mock("@domain/knowledge/core/graph/graph-service.js", () => ({
    graphService: {
        resolveEntitiesToNodeIds: vi.fn().mockResolvedValue([]),
        createNode: vi.fn().mockImplementation((input) => Promise.resolve({ id: input.name === "user" ? 1 : 2 })),
        createEdge: vi.fn().mockResolvedValue({ id: 100 })
    }
}));

describe("TrustGraph Integration", () => {
    it("should export prediction as edge", async () => {
        const prediction = {
            id: "pred-1",
            topPredicate: "user_will_click",
            confidence: 0.8,
            entropy: 0.2
        };

        const result = await trustGraphIntegration.exportPrediction(prediction as any, { organizationId: 1 } as any);

        expect(result).toBe(true);
        expect(graphService.createNode).toHaveBeenCalledTimes(2);
        expect(graphService.createEdge).toHaveBeenCalledWith(
            expect.objectContaining({
                sourceNodeId: 1,
                targetNodeId: 2,
                relation: "PREDICTS_WILL",
                weight: 8
            }),
            expect.any(Object)
        );
    });
});
