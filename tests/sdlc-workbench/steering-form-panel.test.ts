import { describe, expect, it } from "vitest";
import {
  buildSteeringPreviewPrompt,
  type SteeringMode,
} from "../../server/blueprints/apps/sdlc-workbench/app/components/SteeringFormPanel";

const mode: SteeringMode = {
  id: "dependency-discovery",
  label: "Discover dependencies",
  description: "Collect dependencies.",
  intent: "Create a dependency inventory.",
  outputArtifact: "dependency_inventory",
  fields: [
    {
      name: "outcome",
      label: "Requested outcome",
      type: "textarea",
      required: true,
    },
    {
      name: "resources",
      label: "Required resource types",
      type: "multiselect",
    },
  ],
};

describe("buildSteeringPreviewPrompt", () => {
  it("preserves structured values and the expected artifact", () => {
    const prompt = buildSteeringPreviewPrompt(mode, {
      outcome: "Ship a customer onboarding flow",
      resources: ["API", "Database"],
    });

    expect(prompt).toContain("Expected artifact: dependency_inventory");
    expect(prompt).toContain(
      "- Requested outcome: Ship a customer onboarding flow",
    );
    expect(prompt).toContain("- Required resource types: API, Database");
  });

  it("requires preview-only behavior and formal confirmation", () => {
    const prompt = buildSteeringPreviewPrompt(mode, {
      outcome: "Assess dependencies",
      resources: [],
    });

    expect(prompt).toContain("Prepare a steering preview only");
    expect(prompt).toContain("Do not create records");
    expect(prompt).toContain("formal HIL gate");
  });
});
