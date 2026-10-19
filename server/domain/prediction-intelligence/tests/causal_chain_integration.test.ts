// ============================================================================
// PREDICTION INTELLIGENCE DOMAIN — CAUSAL CHAIN INTEGRATION TEST
// Verifies that CausalChainIntegration calls graphService correctly.
// ============================================================================

import { describe, it, expect, vi } from "vitest";
import { causalChainIntegration } from "../integrations/causal-chain-integration.js";
import { graphService } from "@domain/knowledge/core/graph/graph-service.js";

// Mock graphService
vi.mock("@domain/knowledge/core/graph/graph-service.js", () => ({
    graphService: {
        resolveEntitiesToNodeIds: vi.fn().mockResolvedValue([]),
        createNode: vi.fn().mockImplementation((input) => Promise.resolve({ id: Math.random() })),
        searchNodes: vi.fn().mockResolvedValue({ nodes: [] }),
        createEdge: vi.fn().mockResolvedValue({ id: 100 })
    }
}));

describe("Causal Chain Integration", () => {
    it("should map full chain as edges", async () => {
        const state = { topLabel: "high_churn", entropy: 0.2 };
        const prediction = { id: "pred-1", topPredicate: "user_will_click", confidence: 0.8 };
        const missionId = "mission-123";

        const result = await causalChainIntegration.mapCausalChain(state, prediction, missionId, { organizationId: 1 } as any);

        expect(result).toBe(true);
        expect(graphService.createNode).toHaveBeenCalledTimes(3); // State, Prediction, Mission shell
        expect(graphService.createEdge).toHaveBeenCalledTimes(2); // State->Pred, Pred->Mission
    });
});
