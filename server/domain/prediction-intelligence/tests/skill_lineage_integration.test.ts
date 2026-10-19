// ============================================================================
// PREDICTION INTELLIGENCE DOMAIN — SKILL LINEAGE INTEGRATION TEST
// Verifies that SkillLineageIntegration calls graphService correctly.
// ============================================================================

import { describe, it, expect, vi } from "vitest";
import { skillLineageIntegration } from "../integrations/skill-lineage-integration.js";
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

describe("Skill Lineage Integration", () => {
    it("should map skill evolution as edges", async () => {
        const result = await skillLineageIntegration.mapSkillLineage(
            "old_search",
            "new_search",
            "Missing pagination support",
            "mission-123",
            { organizationId: 1 } as any
        );

        expect(result).toBe(true);
        expect(graphService.createNode).toHaveBeenCalledTimes(3); // Old, New, Mission
        expect(graphService.createEdge).toHaveBeenCalledTimes(2); // Old->New, Mission->New
    });
});
