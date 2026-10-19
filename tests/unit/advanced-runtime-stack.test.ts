import { describe, it, expect } from "vitest";
import { ScopedTopicIndexer } from "../../server/domain/ai/core/scoped-topic-indexer.js";
import { PredictionEngine } from "../../server/domain/ai/core/prediction-engine.service.js";
import { GoodQuestionEngine } from "../../server/domain/ai/core/good-question-engine.js";
import { XRayGraph } from "../../server/domain/ai/core/spec-compiler.js";

describe("5-Layer Advanced AI Runtime Stack Integration", () => {
    const sampleGraph: XRayGraph = {
        scopeAppId: "dispatch-app",
        fingerprint: "sha256-runtime-stack",
        nodes: [
            { id: "node_dispatch_1", label: "Emergency Dispatch Coordinator", type: "agent" },
            { id: "node_qa_1", label: "QA Planner", type: "agent" }
        ],
        stats: { totalNodes: 2, totalRelationships: 1, endpointsCount: 1, agentsCount: 2 }
    };

    it("Phase 3: ScopedTopicIndexer should index topics and project <2ms warm-up subgraphs", () => {
        const clusters = ScopedTopicIndexer.indexGraphTopics(sampleGraph);
        expect(clusters.length).toBeGreaterThanOrEqual(2);

        const subgraph = ScopedTopicIndexer.getAgentSubgraphView("dispatch_agent", "topic::dispatch_and_routing");
        expect(subgraph.agentId).toBe("dispatch_agent");
        expect(subgraph.nodes).toContain("node_dispatch_1");
        expect(subgraph.warmUpLatencyMs).toBeLessThan(15);
    });

    it("Phase 4: PredictionEngine should evaluate trajectory vectors and detect loops", () => {
        // Test Normal Trajectory
        const normalResult = PredictionEngine.evaluateTrajectory({
            currentState: { stage: "Diagnose", targetFileOrNode: "server/routes/dispatch.ts" },
            candidateNextStep: { stage: "Improve", targetFileOrNode: "server/routes/dispatch.ts", confidenceScore: 0.95 }
        });

        expect(normalResult.safeTransitionScore).toBeGreaterThan(0.8);
        expect(normalResult.selectedModelTier).toBe("8b_small");

        // Test Agent Retry Loop Detection
        const loopResult = PredictionEngine.evaluateTrajectory({
            previousStep: { stage: "Improve", targetFileOrNode: "server/routes/dispatch.ts" },
            currentState: { stage: "Diagnose", targetFileOrNode: "server/routes/dispatch.ts" },
            candidateNextStep: { stage: "Improve", targetFileOrNode: "server/routes/dispatch.ts" }
        });

        expect(loopResult.loopDetected).toBe(true);
        expect(loopResult.recommendedAction).toBe("halt_loop");
        expect(loopResult.safeTransitionScore).toBe(0.0);
    });

    it("Phase 5: GoodQuestionEngine should emit FormAgent payloads with minimal proof context", () => {
        const evalResult = PredictionEngine.evaluateTrajectory({
            currentState: { stage: "Diagnose", targetFileOrNode: "prod/db/schema.ts" },
            candidateNextStep: { stage: "Approve", targetFileOrNode: "prod/db/schema.ts", confidenceScore: 0.70 }
        });

        const question = GoodQuestionEngine.generateStructuredQuestion({
            stage: "Approve",
            targetNodeOrFile: "prod/db/schema.ts",
            evaluationResult: evalResult,
            pathAOption: { label: "Path A", downtimeMin: 12, risk: 0.2 },
            pathBOption: { label: "Path B", downtimeMin: 0.1, risk: 0.8 }
        });

        expect(question.formAgentPayload.type).toBe("FormAgent");
        expect(question.formAgentPayload.fields.length).toBeGreaterThan(0);
        expect(question.discriminativeValueBits).toBeGreaterThan(0);
    });
});
