import { describe, it, expect } from "vitest";
import { compileSpecToSystemPrompt, XRayGraph, OperationalGuide } from "../../server/domain/ai/core/spec-compiler.js";
import { onArchitectureReindexed, getCachedCompiledPrompt } from "../../server/domain/ai/core/prompt-event-bus.js";
import { copilotPromptManager } from "../../server/domain/ai/core/copilot-prompt-manager.service.js";

describe("SpecCompiler & Event-Driven System Prompt Bus", () => {
    const sampleGraph: XRayGraph = {
        scopeAppId: "analytics-suite",
        fingerprint: "sha256-abc123xyz",
        nodes: [
            { id: "node1", label: "/api/agent-training", type: "api_endpoint" },
            { id: "node2", label: "QA Planner", type: "ai_agent" }
        ],
        stats: {
            totalNodes: 25,
            totalRelationships: 10,
            endpointsCount: 5,
            agentsCount: 4
        }
    };

    const sampleGuide: OperationalGuide = {
        readinessScore: 85,
        readinessGaps: [
            { gap: "coverage-missing-dataset", finding: "No dataset edge linked", severity: "high" }
        ]
    };

    it("should compile graph and operational guide into condensed system prompt", () => {
        const prompt = compileSpecToSystemPrompt(sampleGraph, sampleGuide);

        expect(prompt).toContain("Graph Fingerprint: sha256-abc123xyz");
        expect(prompt).toContain("Readiness Score: 85/100");
        expect(prompt).toContain("[CRITICAL] coverage-missing-dataset: No dataset edge linked");
        expect(prompt).toContain("/api/agent-training");
        expect(prompt).toContain("QA Planner");
    });

    it("should process architecture re-indexing event and update cache & copilotPromptManager", async () => {
        const compiled = await onArchitectureReindexed(sampleGraph, sampleGuide);

        const cached = getCachedCompiledPrompt("analytics-suite");
        expect(cached).toBe(compiled);

        const fp = copilotPromptManager.getFingerprint();
        expect(fp.readinessScore).toBe(85);
        expect(fp.subgraphNodesCount).toBe(25);
    });
});
