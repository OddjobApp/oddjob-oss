import { describe, it, expect } from "vitest";
import { simulateDefinition } from "../../server/routes/cycle-builder-drafts";
import { quarterlyAccessReviewDraft } from "../../shared/schema/cycle-builder-draft.fixtures";

describe("Simulation Engine & Proof of Flow Verification", () => {
  it("verifies a well-formed acyclic draft with valid contracts", () => {
    const simulation = simulateDefinition(quarterlyAccessReviewDraft);

    expect(simulation.missionCount).toBe(6);
    expect(simulation.milestoneCount).toBe(1);
    expect(simulation.estimatedTokens).toBeGreaterThan(10_000);
    expect(simulation.estimatedCostUsd).toBeGreaterThan(0);
    expect(simulation.costBounds.p95).toBeGreaterThanOrEqual(simulation.costBounds.p50);
    expect(simulation.tokenBounds.p95).toBeGreaterThanOrEqual(simulation.tokenBounds.p50);
    expect(simulation.durationHoursBounds.p95).toBeGreaterThanOrEqual(simulation.durationHoursBounds.p50);

    // Proof certificate
    expect(simulation.proofCertificate).toBeDefined();
    expect(simulation.proofCertificate.proofHash).toMatch(/^proof-[a-f0-9]{16}$/);
    expect(simulation.proofCertificate.checks.dagAcyclicity).toBe("PASSED");
    expect(simulation.proofCertificate.checks.budgetCompliance).toBe("PASSED");
  });

  it("detects and flags unresolved DAG cycles", () => {
    const cyclicDraft = {
      ...quarterlyAccessReviewDraft,
      phases: [
        { id: "p1", name: "P1", type: "mission", estimatedDuration: { value: 1, unit: "hours" }, inputs: [], outputs: [] },
        { id: "p2", name: "P2", type: "mission", estimatedDuration: { value: 1, unit: "hours" }, inputs: [], outputs: [] },
      ],
      dependencyEdges: [
        { id: "e1", sourcePhaseId: "p1", targetPhaseId: "p2", type: "finish_to_start" },
        { id: "e2", sourcePhaseId: "p2", targetPhaseId: "p1", type: "finish_to_start" },
      ],
      dataEdges: [],
      outcomeEdges: [],
      resources: [],
      inputs: [],
    };

    const simulation = simulateDefinition(cyclicDraft);
    expect(simulation.proofCertificate.status).toBe("BLOCKED");
    expect(simulation.proofCertificate.checks.dagAcyclicity).toBe("FAILED");
    expect(simulation.risks).toContain("Dependency graph contains an unresolved cycle.");
  });

  it("detects data contract type incompatibilities", () => {
    const mismatchDraft = {
      ...quarterlyAccessReviewDraft,
      phases: [
        {
          id: "producer",
          name: "Producer",
          type: "mission",
          estimatedDuration: { value: 1, unit: "hours" },
          inputs: [],
          outputs: [{ key: "score", valueType: "number", required: true }],
        },
        {
          id: "consumer",
          name: "Consumer",
          type: "mission",
          estimatedDuration: { value: 1, unit: "hours" },
          inputs: [{ key: "text_data", valueType: "string", required: true }],
          outputs: [],
        },
      ],
      dependencyEdges: [
        { id: "dep1", sourcePhaseId: "producer", targetPhaseId: "consumer", type: "finish_to_start" },
      ],
      dataEdges: [
        {
          id: "data-edge-mismatch",
          source: { kind: "phase_output", phaseId: "producer", portKey: "score" },
          target: { phaseId: "consumer", portKey: "text_data" },
        },
      ],
      outcomeEdges: [],
      resources: [],
      inputs: [],
    };

    const simulation = simulateDefinition(mismatchDraft);
    expect(simulation.contractAudit.mismatches.length).toBe(1);
    expect(simulation.contractAudit.mismatches[0].issue).toContain("Type contract incompatibility");
    expect(simulation.contractAudit.mismatches[0].sourceType).toBe("number");
    expect(simulation.contractAudit.mismatches[0].targetType).toBe("string");
    expect(simulation.proofCertificate.checks.dataContracts).toBe("FAILED");
  });

  it("flags unfulfilled required inputs", () => {
    const missingInputDraft = {
      ...quarterlyAccessReviewDraft,
      phases: [
        {
          id: "consumer",
          name: "Consumer",
          type: "mission",
          estimatedDuration: { value: 1, unit: "hours" },
          inputs: [{ key: "mandatory_report", valueType: "object", required: true }],
          outputs: [],
        },
      ],
      dependencyEdges: [],
      dataEdges: [],
      outcomeEdges: [],
      resources: [],
      inputs: [],
    };

    const simulation = simulateDefinition(missingInputDraft);
    expect(simulation.contractAudit.unfulfilledInputs.length).toBe(1);
    expect(simulation.contractAudit.unfulfilledInputs[0].portKey).toBe("mandatory_report");
    expect(simulation.proofCertificate.checks.inputFulfillment).toBe("FAILED");
  });
});
