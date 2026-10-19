import { describe, it, expect } from "vitest";
import { SwarmCommunicationService } from "../../server/domain/agents/core/swarm-communication.service.js";
import { ScopedTopicIndexer } from "../../server/domain/ai/core/scoped-topic-indexer.js";

describe("Swarm Multi-Agent Governed Communication & Subgraph Intersections", () => {
    it("should project Graph_A ∩ Graph_B intersection nodes during governed swarm messaging", async () => {
        const swarmService = new SwarmCommunicationService();

        // Index mock topic clusters
        ScopedTopicIndexer.indexGraphTopics({
            scopeAppId: "swarm_test_app",
            fingerprint: "fp_swarm_123",
            nodes: [
                { id: "node_dispatch", label: "Emergency Dispatch", type: "api_endpoint" },
                { id: "node_eval", label: "QA Planner", type: "ai_agent" }
            ],
            edges: [],
            stats: { totalNodes: 2, totalRelationships: 0, endpointsCount: 1, agentsCount: 1 }
        });

        const viewA = ScopedTopicIndexer.getAgentSubgraphView("agent_a", "topic::dispatch_and_routing");
        const viewB = ScopedTopicIndexer.getAgentSubgraphView("agent_b", "topic::dispatch_and_routing");

        const overlap = ScopedTopicIndexer.intersectAgentGraphs(viewA, viewB);
        expect(overlap).toContain("node_dispatch");

        const msg = await swarmService.sendGovernedSwarmMessage(
            "swarm_dispatch_alpha",
            "agent_a",
            "agent_b",
            "topic::dispatch_and_routing",
            "topic::dispatch_and_routing",
            { action: "Handshake mission contract" }
        );

        expect(msg.id).toBeDefined();
        expect(msg.type).toBe("directed");
        expect(msg.payload.subgraphProjection.sharedIntersectionNodes).toContain("node_dispatch");
    });
});
