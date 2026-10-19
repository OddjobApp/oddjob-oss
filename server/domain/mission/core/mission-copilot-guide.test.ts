import { describe, expect, it } from "vitest";
import {
  buildCopilotGuidePrompt,
  buildMissionControlSystemPrompt,
  MISSION_CONTROL_REPLY_STATUSES,
  shouldScheduleMissionControlReply,
} from "./mission-copilot-guide.js";
import { getOddjobCapabilityManifest } from "@shared/product/oddjob-capability-manifest.js";

describe("mission Copilot guide", () => {
  it("injects every canonical command and trust question into Mission Control", () => {
    const guide = getOddjobCapabilityManifest().copilotGuide;
    const prompt = buildCopilotGuidePrompt();

    for (const command of guide.commands) {
      expect(prompt).toContain(command.label);
      expect(prompt).toContain(`Risk=${command.riskLevel}`);
    }
    for (const question of guide.trustQuestions) {
      expect(prompt).toContain(question.question);
    }
  });

  it.each(MISSION_CONTROL_REPLY_STATUSES)("schedules replies for %s runs", (status) => {
    expect(shouldScheduleMissionControlReply(status)).toBe(true);
  });

  it.each(["completed", "failed", "cancelled", "pending", undefined, null])(
    "does not describe %s runs as active",
    (status) => {
      expect(shouldScheduleMissionControlReply(status)).toBe(false);
    },
  );

  it("reports paused state and includes governed-action instructions", () => {
    const prompt = buildMissionControlSystemPrompt({
      missionName: "Support Triage",
      missionObjective: "Resolve payment failures safely",
      missionStatus: "paused",
      ragContext: "MISSION REFERENCE MATERIALS: Refund policy",
    });

    expect(prompt).toContain("currently paused");
    expect(prompt).toContain("Mission Run Status: paused");
    expect(prompt).toContain("Refund policy");
    expect(prompt).toContain("approval requirement and affected objects");
  });
});
