/**
 * Prediction Studio in a CREW room: real-time inference, surrogate models,
 * confidence envelopes, and spatial reranking for the Sense-Predict-Act Triad.
 *
 * Prediction Studio represents Layer 1 (Model/Prediction) in the Oddjob
 * 5-Layer AI Control Plane, sitting directly between Layer 0 (Telemetry/Signal)
 * and Layer 2 (Pipeline/Flow).
 */

export const PREDICTION_STUDIO_POD = "prediction_studio_pod";
export const PREDICTION_MODEL_PROPOSAL = "prediction_model_proposal";
export const PREDICTION_INFERENCE_RESULT = "prediction_inference_result";

export type ForecastHorizon = "15m" | "30m" | "60m" | "120m";

export interface EnvironmentalCoFactors {
  windSpeedKnots?: number;
  windDirectionDeg?: number;
  currentSpeedKnots?: number;
  currentDirectionDeg?: number;
  bathymetryDepthM?: number;
  vesselDraftM?: number;
}

export interface MultiHorizonPoint {
  horizon: ForecastHorizon;
  horizonMinutes: number;
  p10: number;
  p50: number;
  p90: number;
  breachRisk: number;
  estimatedClearanceM?: number;
}

export interface PredictionSurrogateConfig {
  id: string;
  name: string;
  framework: "onnx" | "pytorch" | "lightgbm" | "python_script" | "kinematic_surrogate";
  version: string;
  inputDim: number;
  outputDim: number;
  quantization?: "fp32" | "fp16" | "int8";
  latencyBudgetMs: number;
  driftThreshold: number;
  horizonSeconds: number;
  environmentalFactorsSupported?: boolean;
}

export interface PredictionEnvelope {
  timestamp: string;
  p10: number;
  p50: number;
  p90: number;
  actual?: number;
  anomalyDetected?: boolean;
  environmental?: EnvironmentalCoFactors;
  multiHorizonPoints?: MultiHorizonPoint[];
  timeToBreachMinutes?: number | null;
}

export interface PredictionStudioPayload {
  type: typeof PREDICTION_STUDIO_POD;
  module: "PredictionStudioPod";
  component: "PredictionStudioPod";
  modelId?: string;
  modelName?: string;
  framework?: string;
  contextId?: string;
  streamId?: string;
  h3Index?: string;
  environmental?: EnvironmentalCoFactors;
  activeHorizon?: ForecastHorizon;
  multiHorizonPoints?: MultiHorizonPoint[];
  props?: {
    modelId?: string;
    modelName?: string;
    streamId?: string;
    title?: string;
    view?: "inference" | "distribution" | "drift" | "surrogates";
    activeHorizon?: ForecastHorizon;
    environmental?: EnvironmentalCoFactors;
  };
}

// ============================================================================
// PROPOSING A PREDICTION JOB
// ============================================================================

/**
 * A prediction_inference job drafted in a room, shown as a card until someone
 * creates it.
 *
 * Same grammar as Flow Studio's, and for the same reason: this writes a job into
 * an organization, so the approval that reaches it is an exact anchored string a
 * card emitted, never a sentence someone agreed with.
 *
 * `framework` is deliberately not a free choice. Only kinematic_surrogate is
 * implemented; the executor refuses the rest rather than substituting, so a card
 * offering onnx would be offering a job that cannot run.
 */
export interface PredictionJobProposal {
  proposalId: string;
  /** What the job will be called. */
  name: string;
  /** What the person asked for, in their words. */
  instruction: string;
  /** The config the job is created with, validated by predictionInferenceConfigSchema. */
  config: {
    modelId: string;
    framework: "kinematic_surrogate";
    inputFeatures: string;
    horizonSeconds: number;
    confidenceThreshold: number;
  };
  /** One line per part of the config, as the card shows them. */
  summary: string[];
  /** Worth seeing before creating it. None of these block creation. */
  checks: string[];
}

/** The job a created proposal became. */
export interface CreatedPredictionJob {
  proposalId: string;
  jobId: number;
  name: string;
}

/** The message a prediction card sends to create its job. Exact and anchored. */
export function createPredictionJobMessage(proposalId: string): string {
  return `Create prediction job "${proposalId}".`;
}

const CREATE_APPROVAL = /^Create prediction job "([A-Za-z0-9_-]{8,64})"\.?$/;

/**
 * The approval a prediction card sent, or null.
 *
 * Anchored to the whole message: this creates a job in the organization, and
 * agreeing in prose must not reach it.
 */
export function parsePredictionJobApproval(message: string): { proposalId: string } | null {
  const match = message.trim().match(CREATE_APPROVAL);
  return match ? { proposalId: match[1] } : null;
}

type RoomArtifact = { tool?: string; payload?: Record<string, unknown> | null };
type RoomTurn = { artifacts?: RoomArtifact[] | null };

/**
 * A drafted job by id, and whether the room already created it.
 *
 * Read back from the room's own history, so what is created is the draft that
 * was on screen rather than a re-reading of the request.
 */
export function findPredictionJobProposal(
  turns: RoomTurn[],
  proposalId: string,
): { proposal: PredictionJobProposal; created: boolean } | null {
  let proposal: PredictionJobProposal | null = null;
  let created = false;
  for (const turn of turns) {
    for (const artifact of turn?.artifacts ?? []) {
      const p = artifact?.payload ?? {};
      if (p.proposalId !== proposalId) continue;
      if (p.type === PREDICTION_MODEL_PROPOSAL) proposal = p as unknown as PredictionJobProposal;
      if (p.type === PREDICTION_INFERENCE_RESULT) created = true;
    }
  }
  return proposal ? { proposal, created } : null;
}

export type PredictionStudioAction = { kind: "none" } | { kind: "create"; proposalId: string };

/**
 * What a message does to Prediction Studio in this room.
 *
 * Only the approval, like Flow Studio. Asking for a prediction job is a request
 * the room's speakers answer with propose_prediction_job.
 */
export function decidePredictionStudioAction(message: string): PredictionStudioAction {
  const approval = parsePredictionJobApproval(message);
  if (approval) return { kind: "create", proposalId: approval.proposalId };
  return { kind: "none" };
}
