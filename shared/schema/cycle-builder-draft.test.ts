import { describe, expect, it } from "vitest";
import { cycleBuilderDraftSchema } from "./cycle-builder-draft";
import { quarterlyAccessReviewDraft } from "./cycle-builder-draft.fixtures";

const cloneFixture = () => structuredClone(quarterlyAccessReviewDraft);

describe("cycleBuilderDraftSchema", () => {
  it("accepts a representative timeline-first Cycle draft", () => {
    const result = cycleBuilderDraftSchema.safeParse(quarterlyAccessReviewDraft);

    expect(result.success).toBe(true);
  });

  it("rejects duplicate phase ids", () => {
    const draft = cloneFixture();
    draft.phases[1].id = draft.phases[0].id;

    const result = cycleBuilderDraftSchema.safeParse(draft);

    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.message.includes("Duplicate phase id"))).toBe(true);
  });

  it("rejects dangling dependency references", () => {
    const draft = cloneFixture();
    draft.dependencyEdges[0].targetPhaseId = "missing-phase";

    const result = cycleBuilderDraftSchema.safeParse(draft);

    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.message.includes("Unknown target phase"))).toBe(true);
  });

  it("rejects dependency cycles", () => {
    const draft = cloneFixture();
    draft.dependencyEdges.push({
      id: "dep-risk-inventory",
      sourcePhaseId: "risk-prediction",
      targetPhaseId: "identity-inventory",
      type: "finish_to_start",
    });

    const result = cycleBuilderDraftSchema.safeParse(draft);

    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.message.includes("acyclic"))).toBe(true);
  });

  it("rejects data mappings to unknown target ports", () => {
    const draft = cloneFixture();
    draft.dataEdges[0].target.portKey = "missing_input";

    const result = cycleBuilderDraftSchema.safeParse(draft);

    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.message.includes("Unknown target input"))).toBe(true);
  });

  it("requires conditional branches to include a condition", () => {
    const draft = cloneFixture();
    draft.outcomeEdges.push({
      id: "outcome-condition",
      sourcePhaseId: "risk-prediction",
      targetPhaseId: "rework-access-plan",
      outcome: "condition",
    });

    const result = cycleBuilderDraftSchema.safeParse(draft);

    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.message.includes("require a condition"))).toBe(true);
  });

  it("requires milestones to remain zero-duration", () => {
    const draft = cloneFixture();
    const milestone = draft.phases.find((phase) => phase.type === "milestone");
    if (!milestone || milestone.type !== "milestone") throw new Error("Fixture milestone missing");
    milestone.estimatedDuration.value = 1 as 0;

    const result = cycleBuilderDraftSchema.safeParse(draft);

    expect(result.success).toBe(false);
  });

  it("accepts a governed offline-owner Slack and AgentMail escalation policy", () => {
    const draft = cloneFixture();
    draft.cycle.notificationPolicy = {
      enabled: true,
      ownerUserId: "cycle-owner-42",
      offlineEscalation: {
        enabled: true,
        channels: ["slack", "agentmail"],
        eventTypes: ["mission_failed", "approval_required"],
        minimumSeverity: "high",
        acknowledgementWindowMinutes: 30,
        escalationUserId: "backup-owner-99",
        deliveryMode: "approval_required",
        includeEvidenceSummary: false,
      },
    };

    expect(cycleBuilderDraftSchema.safeParse(draft).success).toBe(true);
  });

  it("rejects an enabled offline escalation without a delivery channel", () => {
    const draft = cloneFixture();
    draft.cycle.notificationPolicy = {
      enabled: true,
      offlineEscalation: {
        enabled: true,
        channels: [],
        eventTypes: ["phase_blocked"],
        minimumSeverity: "high",
        acknowledgementWindowMinutes: 30,
        deliveryMode: "policy_governed",
        includeEvidenceSummary: false,
      },
    };

    expect(cycleBuilderDraftSchema.safeParse(draft).success).toBe(false);
  });

  it("accepts a Workbench app defined as an executable phase step", () => {
    const draft = cloneFixture();
    const mission = draft.phases.find((phase) => phase.type === "mission");
    if (!mission || mission.type !== "mission") throw new Error("Fixture mission missing");
    mission.appStep = {
      appId: 42,
      appName: "Customer Review Workbench",
      deploymentId: 314,
      releaseRef: "deployment:314@2026-07-28T12:00:00.000Z",
      isPublished: true,
      launchHref: "/a/customer-review",
      mode: "open_and_wait",
      outputPortKey: "review_result",
    };

    expect(cycleBuilderDraftSchema.safeParse(draft).success).toBe(true);
  });
});
