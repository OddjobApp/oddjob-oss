import { describe, expect, it } from "vitest";
import { GoodQuestionEngine } from "../good-question-engine.js";

describe("GoodQuestionEngine Gap Detection & Socratic Elicitation (Phase 5)", () => {
  it("synthesizes a structured Design Entry card for initial blueprint creation", () => {
    const card = GoodQuestionEngine.synthesizeDesignEntryCard("bp-incident-response");
    expect(card).toBeDefined();
    expect(card.headline).toContain("bp-incident-response");
    expect(card.formAgentPayload.type).toBe("assistant_form");
    expect(card.formAgentPayload.fields).toHaveLength(2);
    expect(card.discriminativeValueBits).toBeGreaterThanOrEqual(0.9);
  });

  it("detects pack conflicts when incompatible auth packs are selected", () => {
    const blueprint = {
      id: "bp-test-conflict",
      scaffoldPacks: ["core-node-express", "auth-jwt", "auth-session"],
      stages: []
    };

    const report = GoodQuestionEngine.lintBlueprintFunctionalGaps(blueprint);
    expect(report.gaps.some(g => g.defectClass === "pack_conflict")).toBe(true);
    expect(report.entropyScore).toBeGreaterThan(0);
  });

  it("detects governance gaps when state-modifying actions lack HIL approval gates", () => {
    const blueprint = {
      id: "bp-test-gov-gap",
      scaffoldPacks: ["core-node-express", "auth-jwt"],
      stages: [
        { id: "stage-ingest", type: "data_extract" },
        { id: "stage-deploy-prod", type: "action_dispatch" }
      ]
    };

    const report = GoodQuestionEngine.lintBlueprintFunctionalGaps(blueprint);
    const govGap = report.gaps.find(g => g.defectClass === "governance_gap");
    expect(govGap).toBeDefined();
    expect(govGap?.severity).toBe("critical");
    expect(govGap?.remediation).toContain("<HILGovernancePod />");
  });

  it("detects unbound I/O dependencies for missing prerequisite stages", () => {
    const blueprint = {
      id: "bp-test-unbound-io",
      scaffoldPacks: ["core-node-express"],
      stages: [
        { id: "stage-review", name: "Security Review", type: "hil_approval", requires: ["stage-missing-extract"] }
      ]
    };

    const report = GoodQuestionEngine.lintBlueprintFunctionalGaps(blueprint);
    const ioGap = report.gaps.find(g => g.defectClass === "unbound_io");
    expect(ioGap).toBeDefined();
    expect(ioGap?.message).toContain("stage-missing-extract");
  });

  it("synthesizes an in-chat 1-click Gap Remediation Card", () => {
    const gap = {
      defectClass: "governance_gap",
      message: "Destructive deployment stage lacks an approval gate.",
      recommendedAction: "Insert an <HILGovernancePod /> before stage-deploy",
      stageId: "stage-deploy"
    };

    const remediationCard = GoodQuestionEngine.synthesizeGapRemediationCard(gap);
    expect(remediationCard.headline).toContain("GOVERNANCE_GAP");
    const firstField = remediationCard.formAgentPayload.fields?.[0];
    expect(firstField?.options?.[0]).toContain("Apply Auto-Fix");
  });
});
