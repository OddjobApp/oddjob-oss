import { describe, it, expect } from "vitest";
import { onArchitectureReindexed, getCachedCompiledPrompt } from "../../server/domain/ai/core/prompt-event-bus.js";
import { copilotPromptManager } from "../../server/domain/ai/core/copilot-prompt-manager.service.js";
import { ScopedTopicIndexer } from "../../server/domain/ai/core/scoped-topic-indexer.js";
import { compilePhasePrompt } from "../../server/domain/ai/core/phase-compiler.js";
import { GovernedAgentRuntime } from "../../server/domain/agents/core/governed-agent-runtime.service.js";
import { PredictionEngine } from "../../server/domain/ai/core/prediction-engine.service.js";
import { XRayGraph, OperationalGuide } from "../../server/domain/ai/core/spec-compiler.js";

describe("End-to-End Control Plane Simulation: 5-Layer Governed Stack Proof", () => {
    const mockGraph: XRayGraph = {
        scopeAppId: "oddjob-production",
        fingerprint: "sha256-e2e-proof-7788",
        nodes: [
            { id: "node_dispatch", label: "/api/agent-dispatch", type: "api_endpoint" },
            { id: "node_agent", label: "Emergency Dispatch Coordinator", type: "ai_agent" }
        ],
        edges: [
            { source: "node_dispatch", target: "node_agent", relation: "triggers" }
        ],
        stats: { totalNodes: 33, totalRelationships: 13, endpointsCount: 10, agentsCount: 16 }
    };

    const mockGuide: OperationalGuide = {
        readinessScore: 78,
        readinessGaps: [
            { gap: "coverage-missing-dataset", finding: "Missing Playwright E2E dataset node", severity: "high" }
        ]
    };

    it("PROOFS ALL 5 LAYERS WORKING TOGETHER IN AN INCIDENT LIFECYCLE SIMULATION", async () => {
        // LAYER 1 & LAYER 2: AST Indexing Event & Cache Compilation
        const reindexStart = performance.now();
        const compiledPrompt = await onArchitectureReindexed(mockGraph, mockGuide);
        const reindexDurationMs = performance.now() - reindexStart;

        expect(getCachedCompiledPrompt("oddjob-production")).toBe(compiledPrompt);
        expect(copilotPromptManager.getFingerprint().readinessScore).toBe(78);
        expect(reindexDurationMs).toBeLessThan(50); // Under 50ms compilation

        // LAYER 3: O(1) Scoped Agent Subgraph Warm-Up
        const clusters = ScopedTopicIndexer.indexGraphTopics(mockGraph);
        const subgraphView = ScopedTopicIndexer.getAgentSubgraphView("emergency_dispatch_coordinator", "topic::dispatch_and_routing");

        expect(clusters.length).toBeGreaterThan(0);
        expect(subgraphView.nodes).toContain("node_dispatch");
        expect(subgraphView.warmUpLatencyMs).toBeLessThan(10); // <10ms lookup

        // LAYER 4: Phase-Aware HUD Prompt Weight Bounding (~150-350 tokens)
        const hudDiagnose = compilePhasePrompt(mockGraph, mockGuide, { phase: "diagnose", targetNodeId: "node_dispatch" });
        const hudApprove = compilePhasePrompt(mockGraph, mockGuide, { phase: "approve", targetNodeId: "node_dispatch" });

        expect(hudDiagnose.tokenWeightEst).toBeLessThan(400);
        expect(hudApprove.tokenWeightEst).toBeLessThan(300);
        expect(hudDiagnose.prompt).toContain("CURRENT PHASE: [DIAGNOSE]");

        // LAYER 5: Trajectory Vector Evaluation & Governed Execution Loop
        const runtime = new GovernedAgentRuntime("Observe");

        // Step 1: Low-Risk Diagnostic Step -> AUTO EXECUTES
        const step1Result = runtime.executeStep({
            agentId: "emergency_dispatch_coordinator",
            assignedTopicKey: "topic::dispatch_and_routing",
            stage: "Diagnose",
            targetFileOrNode: "server/routes/dispatch.ts",
            proposedAction: "Analyze failure logs",
            confidenceScore: 0.95
        });

        expect(step1Result.executionPermitted).toBe(true);
        expect(step1Result.trajectoryResult.safeTransitionScore).toBeGreaterThanOrEqual(0.85);

        // Step 2: Agent Retry Loop Attempt -> DETECTED & HALTED
        const loopEvaluation = PredictionEngine.evaluateTrajectory({
            previousStep: { stage: "Improve", targetFileOrNode: "server/routes/dispatch.ts" },
            currentState: { stage: "Diagnose", targetFileOrNode: "server/routes/dispatch.ts" },
            candidateNextStep: { stage: "Improve", targetFileOrNode: "server/routes/dispatch.ts" }
        });

        expect(loopEvaluation.loopDetected).toBe(true);
        expect(loopEvaluation.recommendedAction).toBe("halt_loop");
        expect(loopEvaluation.safeTransitionScore).toBe(0.0);

        // Step 3: High-Risk Production Deployment -> BLOCKED & GQE FORM EMITTED
        const step3Result = runtime.executeStep({
            agentId: "emergency_dispatch_coordinator",
            assignedTopicKey: "topic::dispatch_and_routing",
            stage: "Deploy",
            targetFileOrNode: "prod/database/schema.ts",
            proposedAction: "Deploy schema mutation to production database"
        });

        expect(step3Result.executionPermitted).toBe(false);
        expect(step3Result.gqeQuestion).toBeDefined();
        expect(step3Result.gqeQuestion?.formAgentPayload.type).toBe("FormAgent");
        expect(step3Result.gqeQuestion?.formAgentPayload.requiredApproverRoles).toContain("operations-supervisor");
    });
});
