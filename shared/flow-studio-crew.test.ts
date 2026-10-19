import { describe, expect, it } from "vitest";
import {
  createFlowMessage,
  decideFlowStudioAction,
  findFlowCreateProposal,
  parseFlowCreateApproval,
  FLOW_CREATED,
  FLOW_CREATE_PROPOSAL,
  type FlowCreateProposal,
} from "./flow-studio-crew";

const proposal = (proposalId: string): FlowCreateProposal => ({
  proposalId,
  name: "Lead triage",
  instruction: "score inbound leads and email the owner",
  steps: [
    { jobId: 4, jobName: "Score lead", jobType: "ai_agent", outputName: "score" },
    { jobId: 9, jobName: "Email owner", jobType: "email_send", conditionExpression: "score > 70" },
  ],
  summary: ["1. Score lead (ai_agent)", "2. Email owner (email_send) — only if score > 70"],
  checks: [],
});

const turnWith = (payload: Record<string, unknown>) => ({ artifacts: [{ payload }] });

describe("the approval a flow card sends", () => {
  it("round-trips", () => {
    expect(parseFlowCreateApproval(createFlowMessage("flownew_12345678"))).toEqual({
      proposalId: "flownew_12345678",
    });
  });

  it("is anchored, so agreeing in prose does not create a pipeline", () => {
    expect(parseFlowCreateApproval("yes create it")).toBeNull();
    expect(parseFlowCreateApproval("go ahead and create flow \"flownew_12345678\"")).toBeNull();
    expect(parseFlowCreateApproval("Create flow \"flownew_12345678\". Also delete the old one.")).toBeNull();
  });

  it("does not read another surface's approval", () => {
    // Form Studio's create string. These two travel through the same room.
    expect(parseFlowCreateApproval('Create form "formnew_12345678".')).toBeNull();
  });

  it("rejects an id that could not have come from a card", () => {
    expect(parseFlowCreateApproval('Create flow "short".')).toBeNull();
    expect(parseFlowCreateApproval('Create flow "has spaces here".')).toBeNull();
  });
});

describe("decideFlowStudioAction", () => {
  it("acts on the approval", () => {
    expect(decideFlowStudioAction(createFlowMessage("flownew_12345678"))).toEqual({
      kind: "create",
      proposalId: "flownew_12345678",
    });
  });

  it("leaves a request for the room's speakers to answer with propose_flow", () => {
    // Deliberate: the direct path claims nothing but the approval, so it can
    // never out-guess Form Studio or App Studio for an ambiguous noun.
    expect(decideFlowStudioAction("build me a flow that scores leads")).toEqual({ kind: "none" });
    expect(decideFlowStudioAction("build me a scorecard flow")).toEqual({ kind: "none" });
    expect(decideFlowStudioAction("run the lead triage pipeline")).toEqual({ kind: "none" });
  });
});

describe("findFlowCreateProposal", () => {
  it("reads the draft back out of the room's history", () => {
    const turns = [turnWith({ type: FLOW_CREATE_PROPOSAL, ...proposal("flownew_12345678") })];
    const found = findFlowCreateProposal(turns, "flownew_12345678");
    expect(found?.created).toBe(false);
    expect(found?.proposal.steps).toHaveLength(2);
  });

  it("sees that a draft was already created, so a second press makes no twin", () => {
    const turns = [
      turnWith({ type: FLOW_CREATE_PROPOSAL, ...proposal("flownew_12345678") }),
      turnWith({ type: FLOW_CREATED, proposalId: "flownew_12345678", pipelineId: 12, name: "Lead triage" }),
    ];
    expect(findFlowCreateProposal(turns, "flownew_12345678")?.created).toBe(true);
  });

  it("is null for an id this room never drafted", () => {
    const turns = [turnWith({ type: FLOW_CREATE_PROPOSAL, ...proposal("flownew_12345678") })];
    expect(findFlowCreateProposal(turns, "flownew_87654321")).toBeNull();
  });
});
