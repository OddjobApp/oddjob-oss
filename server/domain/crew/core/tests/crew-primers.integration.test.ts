import { describe, expect, it } from "vitest";
import { crewPrimersService } from "../crew-primers.service.js";

describe("CrewPrimersService Creation Studio Recommended Intents", () => {
  it("includes Creation Studio starter primers when building room recommendations", async () => {
    const primers = await crewPrimersService.build({
      orgId: 1,
      projectId: null
    });

    expect(primers.length).toBeGreaterThan(0);
    const creationStudioPrimer = primers.find(p => p.source === "creation_studio");
    expect(creationStudioPrimer).toBeDefined();
    expect(creationStudioPrimer?.sourceLabel).toContain("Creation Studio");
    expect(creationStudioPrimer?.prompt).toContain("Creation Studio");
  });
});
