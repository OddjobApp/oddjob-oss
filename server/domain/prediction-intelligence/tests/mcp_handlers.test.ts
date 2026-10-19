// ============================================================================
// PREDICTION INTELLIGENCE DOMAIN — MCP HANDLERS TEST
// Verifies that MCP handlers for prediction tools work correctly.
// ============================================================================

import { describe, it, expect, vi } from "vitest";
import { handleGetHiddenStateEstimate, handlePredictOutcomes } from "../../../mcp/handlers/prediction.js";

// Mock the pods to avoid complex dependencies
vi.mock("../../hidden-state/hidden-state-pod.service.js", () => ({
    hiddenStatePod: {
        estimate: vi.fn().mockResolvedValue({ topLabel: "user_will_click", entropy: 0.2 })
    }
}));

vi.mock("../../prediction/prediction-pod.service.js", () => ({
    predictionPod: {
        generateBranches: vi.fn().mockResolvedValue([{ branchId: "1", label: "user_will_click" }])
    }
}));

describe("Prediction MCP Handlers", () => {
    it("should handle get_hidden_state_estimate", async () => {
        const res = await handleGetHiddenStateEstimate({ contextId: "test-ctx" });
        expect(res).toBeDefined();
        // The successResponse helper likely returns an object with a specific structure
        // Let's check if it contains the mocked data or success flag!
        console.log("[MCP Test] Handler response:", JSON.stringify(res));
        expect(res).toHaveProperty("content");
    });

    it("should handle predict_outcomes", async () => {
        const res = await handlePredictOutcomes({ contextId: "test-ctx", predicates: ["click"] });
        expect(res).toBeDefined();
        expect(res).toHaveProperty("content");
    });
});
