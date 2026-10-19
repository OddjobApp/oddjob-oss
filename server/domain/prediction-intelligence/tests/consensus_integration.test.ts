// ============================================================================
// PREDICTION INTELLIGENCE DOMAIN — CONSENSUS INTEGRATION TEST
// Verifies that ConsensusIntegration calls graphService correctly.
// ============================================================================

import { describe, it, expect, vi } from "vitest";
import { consensusIntegration } from "../integrations/consensus-integration.js";
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

describe("Consensus Integration", () => {
    it("should map proposal and votes as edges", async () => {
        const result = await consensusIntegration.mapConsensus(
            "prop-1",
            "Upgrade model to GPT-4o",
            [
                { agentId: "agent-1", vote: "yes" },
                { agentId: "agent-2", vote: "no" }
            ],
            "mission-123",
            { organizationId: 1 } as any
        );

        expect(result).toBe(true);
        expect(graphService.createNode).toHaveBeenCalledTimes(4); // Proposal, Mission, Agent1, Agent2
        expect(graphService.createEdge).toHaveBeenCalledTimes(3); // Prop->Mission, Agent1->Prop, Agent2->Prop
    });
});
