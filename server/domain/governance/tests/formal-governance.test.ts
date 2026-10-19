import { describe, it, expect } from "vitest";
import { FormalGovernanceGuard, WorkflowGraph } from "../formal-governance.guard.js";

describe("FormalGovernanceGuard (Safety Invariants & Model Checking)", () => {
  it("should PASS when privileged user executes deployment directly with evidence", () => {
    const graph: WorkflowGraph = {
      initialState: "draft",
      transitions: [
        {
          fromState: "draft",
          action: "validate_build",
          toState: "validated",
          providesEvidence: true
        },
        {
          fromState: "validated",
          action: "trigger_production_deploy",
          toState: "deployed",
          restrictsAction: "deploy_production"
        }
      ]
    };

    const proof = FormalGovernanceGuard.proveWorkflowSafety(graph, {
      userRoles: ["operations-supervisor"],
      evidenceProvided: false // Accumulated via step 1
    });

    expect(proof.status).toBe("PASSED");
    expect(proof.verifiedInvariantsCount).toBe(2);
  });

  it("should FAIL when unprivileged user attempts to reach deploy without HIL approval", () => {
    const graph: WorkflowGraph = {
      initialState: "draft",
      transitions: [
        {
          fromState: "draft",
          action: "validate_build",
          toState: "validated",
          providesEvidence: true
        },
        {
          fromState: "validated",
          action: "trigger_production_deploy",
          toState: "deployed",
          restrictsAction: "deploy_production"
        }
      ]
    };

    const proof = FormalGovernanceGuard.proveWorkflowSafety(graph, {
      userRoles: ["developer"], // Non-privileged role
      evidenceProvided: false
    });

    expect(proof.status).toBe("VIOLATION");
    expect(proof.counterexampleAction).toBe("deploy_production");
    expect(proof.violationPath).toBeDefined();
  });

  it("should PASS for unprivileged user if path goes through an explicit HIL node with evidence", () => {
    const graph: WorkflowGraph = {
      initialState: "draft",
      transitions: [
        {
          fromState: "draft",
          action: "gather_evidence",
          toState: "evidenced",
          providesEvidence: true
        },
        {
          fromState: "evidenced",
          action: "submit_hil_approval",
          toState: "approved",
          isHILApprovalNode: true
        },
        {
          fromState: "approved",
          action: "trigger_production_deploy",
          toState: "deployed",
          restrictsAction: "deploy_production"
        }
      ]
    };

    const proof = FormalGovernanceGuard.proveWorkflowSafety(graph, {
      userRoles: ["developer"],
      evidenceProvided: false
    });

    expect(proof.status).toBe("PASSED");
  });
});
