import { describe, it, expect } from "vitest";
import { GovernedAgentRuntime } from "../../server/domain/agents/core/governed-agent-runtime.service.js";

describe("Governed Agent Runtime Integration", () => {
    it("should execute low-risk governed runtime steps seamlessly", () => {
        const runtime = new GovernedAgentRuntime("Observe");
        const result = runtime.executeStep({
            agentId: "emergency_dispatch_coordinator",
            assignedTopicKey: "topic::dispatch_and_routing",
            stage: "Diagnose",
            targetFileOrNode: "server/routes/dispatch.ts",
            proposedAction: "Analyze diagnostic logs",
            confidenceScore: 0.95
        });

        expect(result.executionPermitted).toBe(true);
        expect(result.subgraphView.agentId).toBe("emergency_dispatch_coordinator");
        expect(result.trajectoryResult.safeTransitionScore).toBeGreaterThan(0.85);
    });

    it("should block high-risk actions and emit GQE FormAgent payload", () => {
        const runtime = new GovernedAgentRuntime("Diagnose");
        const result = runtime.executeStep({
            agentId: "emergency_dispatch_coordinator",
            assignedTopicKey: "topic::dispatch_and_routing",
            stage: "Deploy",
            targetFileOrNode: "prod/database/schema.ts",
            proposedAction: "Deploy schema mutation to production"
        });

        expect(result.executionPermitted).toBe(false);
        expect(result.gqeQuestion).toBeDefined();
        expect(result.gqeQuestion?.formAgentPayload.type).toBe("FormAgent");
    });
});
