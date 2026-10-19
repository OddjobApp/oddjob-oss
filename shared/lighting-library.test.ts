import { describe, expect, it } from "vitest";
import {
  LIGHTING_CATALOG,
  compileLightingPrompt,
  lightingRigDefinitionSchema,
} from "./lighting-library.js";

describe("Cinematic Lighting & Atmosphere Library", () => {
  it("validates lighting rig definitions against schema", () => {
    for (const [id, def] of Object.entries(LIGHTING_CATALOG)) {
      expect(def.rigId).toBe(id);
      expect(() => lightingRigDefinitionSchema.parse(def)).not.toThrow();
    }
  });

  it("compiles deterministic lighting directives with key, fill, rim, and practicals", () => {
    const rig = LIGHTING_CATALOG.cyberpunk_bicolor_neon;
    const compiled = compileLightingPrompt(rig, {
      additionalPracticals: ["holographic vending machine projection"],
    });

    expect(compiled.promptClause).toContain("Cyberpunk Dual-Complementary");
    expect(compiled.promptClause).toContain("Key light: 45° horizontal angle at 7500K");
    expect(compiled.promptClause).toContain("Fill: 4:1 dramatic cinematic with deep electric magenta-pink ambient fill");
    expect(compiled.promptClause).toContain("Rim light: high camera-left sodium street spill");
    expect(compiled.promptClause).toContain("holographic vending machine projection");
    expect(compiled.promptClause).toContain("Volumetrics: heavy steam condensation");
    expect(compiled.avoidExclusions).toContain("no natural daylight");
  });
});
