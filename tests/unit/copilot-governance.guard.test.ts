import { describe, it, expect } from "vitest";
import { CopilotGovernanceGuard } from "../../server/domain/governance/copilot-governance.guard.js";
import { CopilotContextFilter } from "../../server/domain/ai/core/copilot-context-filter.service.js";

describe("CopilotGovernanceGuard", () => {
    it("should reject high-risk actions without privileged role or explicit approval", () => {
        const result = CopilotGovernanceGuard.validateAction("deploy_production", {
            userRoles: ["operator"],
            evidenceProvided: true
        });

        expect(result.allowed).toBe(false);
        expect(result.reason).toContain("requires explicit approval");
    });

    it("should allow high-risk actions when user has operations-supervisor role and evidence", () => {
        const result = CopilotGovernanceGuard.validateAction("deploy_production", {
            userRoles: ["operations-supervisor"],
            evidenceProvided: true
        });

        expect(result.allowed).toBe(true);
    });

    it("should reject actions when zero hallucinated evidence rule is violated", () => {
        const result = CopilotGovernanceGuard.validateAction("promote_candidate", {
            userRoles: ["operations-supervisor"],
            evidenceProvided: false
        });

        expect(result.allowed).toBe(false);
        expect(result.reason).toContain("Zero Hallucinated Evidence Rule");
    });

    it("should detect restricted actions from text intent", () => {
        expect(CopilotGovernanceGuard.detectRestrictedAction("Deploy candidate to production")).toBe("deploy_production");
        expect(CopilotGovernanceGuard.detectRestrictedAction("Promote candidate agent")).toBe("promote_candidate");
        expect(CopilotGovernanceGuard.detectRestrictedAction("Rollback production deployment")).toBe("rollback_production");
        expect(CopilotGovernanceGuard.detectRestrictedAction("Override blocking guardrail")).toBe("override_guardrail");
        expect(CopilotGovernanceGuard.detectRestrictedAction("Show me system status")).toBe(null);
    });
});

describe("CopilotContextFilter", () => {
    it("should strictly limit graph retrieval to 2 hops", () => {
        const nodes = [
            { id: "A", label: "A", type: "route" },
            { id: "B", label: "B", type: "pipeline" },
            { id: "C", label: "C", type: "agent" },
            { id: "D", label: "D", type: "job" }
        ];

        const edges = [
            { source: "A", target: "B", relation: "triggers" },
            { source: "B", target: "C", relation: "executes" },
            { source: "C", target: "D", relation: "spawns" }
        ];

        const result = CopilotContextFilter.extractBoundedSubgraph("A", nodes, edges, 2);

        expect(result.rootNodeId).toBe("A");
        expect(result.maxHops).toBe(2);
        // Node D is 3 hops away, so it must be excluded
        const nodeIds = result.nodes.map(n => n.id);
        expect(nodeIds).toContain("A");
        expect(nodeIds).toContain("B");
        expect(nodeIds).toContain("C");
        expect(nodeIds).not.toContain("D");
    });
});
