/**
 * Flow Studio in a CREW room: a flow drafted from the organization's existing
 * jobs, and the message a person's card sends to create it.
 *
 * A "flow" is a pipeline whose steps are jobs. Jobs are where the platform's
 * whole vocabulary lives — decision, transformer, iterator, reranker,
 * human_approval and the rest — so binding steps to jobs reaches all of it,
 * where binding them to tools would reach only the handful of registered tools.
 *
 * Shared because both halves read the same room history: the server decides from
 * it what a message does, and the client sends the exact approval the server
 * looks for.
 *
 * Drafting is NOT decided here. Asking for a flow is a REQUEST, answered by the
 * room's speakers reaching for `propose_flow` after they have read `list_jobs` —
 * the same way asking for a bot is answered by `propose_agent`. Only the
 * approval a card emits is read directly, because that string stands between a
 * sentence and a saved pipeline.
 */

export const FLOW_CREATE_PROPOSAL = "flow_create_proposal";
export const FLOW_CREATED = "flow_created";
export const FLOW_STUDIO_POD = "flow_studio_pod";

type RoomArtifact = { tool?: string; payload?: Record<string, unknown> | null };
type RoomTurn = { id?: number | string; artifacts?: RoomArtifact[] | null };

export interface FlowStepProposal {
  jobId: number;
  jobName: string;
  jobType: string;
  /** Name downstream steps use to reference this step's output. */
  outputName?: string;
  /** Guard evaluated before the step runs. Empty means it always runs. */
  conditionExpression?: string;
  /** What the flow does when this step fails. Defaults to stopping. */
  onError?: "stop" | "continue";
  /** Status of the step: ready if backed by an existing job, or needs_scaffolding if newly requested. */
  status?: "ready" | "needs_scaffolding";
  /** Suggested studio to scaffold this capability if not yet configured. */
  scaffoldStudio?: "form" | "prediction" | "app" | "media" | "signal" | "hil" | "job";
  /** Estimated duration in seconds (P50). */
  estimatedDurationSec?: number;
  /** Estimated cost in USD (P50). */
  estimatedCostUsd?: number;
  /** Optional HTTP connector configuration for direct REST/API steps */
  httpConnectorConfig?: {
    url: string;
    method?: "GET" | "POST";
    params?: Record<string, any>;
    headers?: Record<string, string>;
    jsonPath?: string;
    cacheTtlSeconds?: number;
  };
}

export interface FlowReviewPerspective {
  lens: "security" | "finops" | "sre" | "domain";
  title: string;
  status: "optimal" | "warning" | "risk";
  summary: string;
  notes: string[];
  repairPrompt?: string;
}

export interface FlowDataEdge {
  id: string;
  sourceStepIndex: number;
  targetStepIndex: number;
  portKey: string;
  schemaType?: string;
}

/** A flow drafted from a room request, shown as a card until someone creates it. */
export interface FlowCreateProposal {
  proposalId: string;
  name: string;
  instruction: string;
  steps: FlowStepProposal[];
  /** What the flow does, one line per step, as the card shows them. */
  summary: string[];
  /** Things worth seeing before creating it. None of these block creation. */
  checks: string[];
  /** Overall readiness score 0-100 computed from DAG topology, contract validity, and scaffolding. */
  readinessScore?: number;
  /** Pre-flight verification status. */
  proofStatus?: "VERIFIED" | "ACTION_REQUIRED" | "BLOCKED";
  /** Monte Carlo latency and cost bounds. */
  bounds?: {
    durationP50: number;
    durationP95: number;
    costP50: number;
    costP95: number;
  };
  /** Multi-agent review perspectives. */
  reviewPerspectives?: FlowReviewPerspective[];
  /** Inferred or explicit data flow contracts between steps. */
  dataEdges?: FlowDataEdge[];
}

/** The pipeline a created flow became. */
export interface CreatedFlow {
  proposalId: string;
  pipelineId: number;
  /** The workflow registered over the draft, when registration succeeded. */
  workflowId?: number;
  name: string;
  stepCount: number;
}

/** The message a flow card sends to create its draft. Exact and anchored. */
export function createFlowMessage(proposalId: string): string {
  return `Create flow "${proposalId}".`;
}

const CREATE_APPROVAL = /^Create flow "([A-Za-z0-9_-]{8,64})"\.?$/;

/**
 * The approval a flow card sent, or null.
 *
 * Anchored to the whole message, like every other confirmation a surface emits:
 * this creates a pipeline, so agreeing in prose must not reach it.
 */
export function parseFlowCreateApproval(message: string): { proposalId: string } | null {
  const match = message.trim().match(CREATE_APPROVAL);
  return match ? { proposalId: match[1] } : null;
}

/**
 * A drafted flow by id, and whether the room has already created it.
 *
 * The proposal is read back from the room's own history rather than from the
 * message, so what gets created is the draft that was on screen — not a
 * re-reading of the request, which could differ from what the person agreed to.
 */
export function findFlowCreateProposal(
  turns: RoomTurn[],
  proposalId: string,
): { proposal: FlowCreateProposal; created: boolean } | null {
  let proposal: FlowCreateProposal | null = null;
  let created = false;
  for (const turn of turns) {
    for (const artifact of turn?.artifacts ?? []) {
      const p = artifact?.payload ?? {};
      if (p.proposalId !== proposalId) continue;
      if (p.type === FLOW_CREATE_PROPOSAL) proposal = p as unknown as FlowCreateProposal;
      if (p.type === FLOW_CREATED) created = true;
    }
  }
  return proposal ? { proposal, created } : null;
}

export type FlowStudioAction =
  | { kind: "none" }
  | { kind: "create"; proposalId: string };

/**
 * What a message does to Flow Studio in this room.
 *
 * Only the approval. Everything else — including "build me a flow" — falls
 * through to the room, whose speakers answer it with `propose_flow`. Keeping the
 * direct path this narrow is deliberate: a resolver that also claimed requests
 * would have to out-guess Form Studio and App Studio for phrases like "build me
 * a scorecard flow", and the studios that tried that have all had to be narrowed
 * afterwards.
 */
export function decideFlowStudioAction(message: string): FlowStudioAction {
  const approval = parseFlowCreateApproval(message);
  if (approval) return { kind: "create", proposalId: approval.proposalId };
  return { kind: "none" };
}
