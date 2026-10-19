import { describe, expect, it } from "vitest";
import { ODDJOB_CANONICAL_DEMOS, ODDJOB_COPILOT_GUIDE } from "./oddjob-capability-manifest.js";

describe("Oddjob Copilot manifest", () => {
  it("provides a canonical guided prompt for every guided flow", () => {
    const demos = new Map(ODDJOB_CANONICAL_DEMOS.map((demo) => [demo.id, demo]));

    for (const flowId of ODDJOB_COPILOT_GUIDE.guidedFlows) {
      const demo = demos.get(flowId);
      expect(demo, `${flowId} must reference a canonical demo`).toBeDefined();
      expect(demo?.guidedPrompt.trim().length).toBeGreaterThan(40);
    }
  });
});
