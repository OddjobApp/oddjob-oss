import { describe, it, expect, vi, beforeEach } from "vitest";
import { probeDraftReadiness } from "../../server/routes/cycle-builder-drafts";
import { quarterlyAccessReviewDraft } from "../../shared/schema/cycle-builder-draft.fixtures";

// Mock the db calls in cycle-builder-drafts
vi.mock("@server/database_service.js", () => {
  return {
    db: {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(async () => [
              { id: 101, appId: 1, isPublished: true, status: "installed" }
            ]),
          })),
        })),
      })),
    },
  };
});

describe("Multi-Studio Flow Readiness Prober", () => {
  it("probes a multi-studio draft with valid contracts and passes readiness", async () => {
    const validDraft = {
      ...quarterlyAccessReviewDraft,
      phases: quarterlyAccessReviewDraft.phases.map(p => ({
        ...p,
        ownerAgentId: p.ownerAgentId || (p.type === "mission" ? "assigned-agent" : undefined),
      })),
      readiness: { validation: "valid", test: "not_run" },
    };

    const result = await probeDraftReadiness(validDraft, 1);
    expect(result.ready).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.simulationResult).toBeDefined();
    expect(result.simulationResult.proofCertificate.status).toBe("VERIFIED");
  });

  it("fails readiness when structural validation is invalid", async () => {
    const invalidDraft = {
      ...quarterlyAccessReviewDraft,
      readiness: { validation: "invalid", test: "not_run" },
    };

    const result = await probeDraftReadiness(invalidDraft, 1);
    expect(result.ready).toBe(false);
    expect(result.errors).toContain("Structural validation must pass before readiness testing.");
  });

  it("fails readiness when a multi-studio data contract has type incompatibilities", async () => {
    const contractMismatchDraft = {
      ...quarterlyAccessReviewDraft,
      readiness: { validation: "valid", test: "not_run" },
      phases: [
        {
          id: "app-review",
          name: "App Review Phase",
          type: "mission",
          estimatedDuration: { value: 1, unit: "hours" },
          inputs: [],
          outputs: [{ key: "score", valueType: "number", required: true }],
        },
        {
          id: "prediction-gate",
          name: "Prediction Gate",
          type: "prediction",
          estimatedDuration: { value: 1, unit: "hours" },
          inputs: [{ key: "sentiment_text", valueType: "string", required: true }],
          outputs: [],
          prediction: { target: "risk_prediction", confidenceThreshold: 0.85, lowConfidenceBehavior: "manual_review" },
        },
      ],
      dependencyEdges: [
        { id: "dep1", sourcePhaseId: "app-review", targetPhaseId: "prediction-gate", type: "finish_to_start" },
      ],
      dataEdges: [
        {
          id: "mismatched-edge",
          source: { kind: "phase_output", phaseId: "app-review", portKey: "score" },
          target: { phaseId: "prediction-gate", portKey: "sentiment_text" },
        },
      ],
      resources: [],
      inputs: [],
    };

    const result = await probeDraftReadiness(contractMismatchDraft, 1);
    expect(result.ready).toBe(false);
    expect(result.errors.some(e => e.includes("Type contract incompatibility"))).toBe(true);
  });

  it("fails readiness when Prediction Studio target is missing or has invalid threshold", async () => {
    const badPredictionDraft = {
      ...quarterlyAccessReviewDraft,
      readiness: { validation: "valid", test: "not_run" },
      phases: [
        {
          id: "bad-pred",
          name: "Uncalibrated Predictor",
          type: "prediction",
          estimatedDuration: { value: 1, unit: "hours" },
          inputs: [],
          outputs: [],
          prediction: { target: "", confidenceThreshold: 1.5, lowConfidenceBehavior: "manual_review" },
        },
      ],
      dependencyEdges: [],
      dataEdges: [],
      resources: [],
      inputs: [],
    };

    const result = await probeDraftReadiness(badPredictionDraft, 1);
    expect(result.ready).toBe(false);
    expect(result.errors).toContain("Uncalibrated Predictor: Prediction target objective is missing.");
    expect(result.errors).toContain("Uncalibrated Predictor: Prediction confidence threshold must be between 0.0 and 1.0.");
  });
});
