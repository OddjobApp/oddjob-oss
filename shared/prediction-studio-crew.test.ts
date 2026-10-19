import { describe, expect, it } from "vitest";
import {
  createPredictionJobMessage,
  decidePredictionStudioAction,
  findPredictionJobProposal,
  parsePredictionJobApproval,
  PREDICTION_INFERENCE_RESULT,
  PREDICTION_MODEL_PROPOSAL,
  type PredictionJobProposal,
} from "./prediction-studio-crew";

const proposal = (proposalId: string): PredictionJobProposal => ({
  proposalId,
  name: "Coastal breach watch",
  instruction: "forecast breach risk for the inbound vessel",
  config: {
    modelId: "kinematic-surrogate-01",
    framework: "kinematic_surrogate",
    inputFeatures: '{"velocity_knots":18,"distance_m":900}',
    horizonSeconds: 300,
    confidenceThreshold: 0.75,
  },
  summary: ["Runs a kinematic trajectory estimate — no model is loaded."],
  checks: [],
});

const turnWith = (payload: Record<string, unknown>) => ({ artifacts: [{ payload }] });

describe("the approval a prediction card sends", () => {
  it("round-trips", () => {
    expect(parsePredictionJobApproval(createPredictionJobMessage("predjob_12345678"))).toEqual({
      proposalId: "predjob_12345678",
    });
  });

  it("is anchored, so agreeing in prose creates no job", () => {
    expect(parsePredictionJobApproval("yes create it")).toBeNull();
    expect(parsePredictionJobApproval('go ahead, Create prediction job "predjob_12345678"')).toBeNull();
  });

  it("does not read another surface's approval", () => {
    // Flow Studio's string travels through the same room.
    expect(parsePredictionJobApproval('Create flow "flownew_12345678".')).toBeNull();
  });
});

describe("decidePredictionStudioAction", () => {
  it("acts on the approval and nothing else", () => {
    expect(decidePredictionStudioAction(createPredictionJobMessage("predjob_12345678"))).toEqual({
      kind: "create",
      proposalId: "predjob_12345678",
    });
    expect(decidePredictionStudioAction("set up a breach forecast")).toEqual({ kind: "none" });
  });
});

describe("findPredictionJobProposal", () => {
  it("reads the draft back out of room history", () => {
    const turns = [turnWith({ type: PREDICTION_MODEL_PROPOSAL, ...proposal("predjob_12345678") })];
    const found = findPredictionJobProposal(turns, "predjob_12345678");
    expect(found?.created).toBe(false);
    expect(found?.proposal.config.framework).toBe("kinematic_surrogate");
  });

  it("sees a draft already used, so a second press makes no twin", () => {
    const turns = [
      turnWith({ type: PREDICTION_MODEL_PROPOSAL, ...proposal("predjob_12345678") }),
      turnWith({ type: PREDICTION_INFERENCE_RESULT, proposalId: "predjob_12345678", jobId: 9, name: "Coastal breach watch" }),
    ];
    expect(findPredictionJobProposal(turns, "predjob_12345678")?.created).toBe(true);
  });
});
