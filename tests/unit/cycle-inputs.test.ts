import { describe, expect, it } from "vitest";
import {
  buildCycleInputBriefing,
  buildCycleMissionInputContext,
  normalizeCycleInputRequirements,
} from "../../shared/cycle-inputs";

describe("cycle input requirements", () => {
  it("normalizes string inputs and resources into runtime requirements", () => {
    const requirements = normalizeCycleInputRequirements({
      name: "Requirements & Design Analysis",
      inputs: ["jira_ticket", { id: "feature_requirements", label: "Feature Requirements" }],
      resourcesRequired: "design_approval",
    });

    expect(requirements.map(req => req.id)).toEqual([
      "design_approval",
      "jira_ticket",
      "feature_requirements",
    ]);
    expect(requirements.every(req => req.required)).toBe(true);
  });

  it("builds mission ground truth with provided and missing inputs", () => {
    const context = buildCycleMissionInputContext({
      cycle: {
        id: 273,
        name: "Oddjob Enterprise Hybrid AI SDLC",
        objective: "Run the SDLC process",
        metadata: {
          resource_answers: {
            "Requirements & Design Analysis": {
              jira_ticket: "ODD-123",
              feature_requirements: "Users need timeline playhead controls",
            },
          },
        },
      },
      blueprint: {
        name: "Requirements & Design Analysis",
        objective: "Generate functional specs",
        inputs: ["jira_ticket", "feature_requirements", "team_capacity"],
        outputs: ["prd_document"],
      },
    });

    expect(context.providedInputs).toMatchObject({
      jira_ticket: "ODD-123",
      feature_requirements: "Users need timeline playhead controls",
    });
    expect(context.missingInputs).toEqual(["team_capacity"]);
    expect(context.requirement).toBe("Users need timeline playhead controls");
    expect(context.inputContract.requiredInputs.map((input: any) => input.id)).toContain("jira_ticket");
  });

  it("includes the input contract in supervisor briefing text", () => {
    const briefing = buildCycleInputBriefing({
      requirement: "Users need timeline playhead controls",
      inputContract: {
        requiredInputs: [{ id: "feature_requirements" }],
        providedInputs: { feature_requirements: "Users need timeline playhead controls" },
        missingInputs: [],
      },
    });

    expect(briefing).toContain("Required inputs: feature_requirements");
    expect(briefing).toContain("Provided inputs: feature_requirements");
    expect(briefing).toContain("Primary requirement: Users need timeline playhead controls");
  });
});
