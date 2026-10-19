import { describe, expect, it } from "vitest";
import {
  LOCATION_CATALOG,
  compileLocationPrompt,
  locationDefinitionSchema,
} from "./location-library.js";

describe("Locations & Sets Library", () => {
  it("validates location definitions against schema", () => {
    for (const [id, def] of Object.entries(LOCATION_CATALOG)) {
      expect(def.locationId).toBe(id);
      expect(() => locationDefinitionSchema.parse(def)).not.toThrow();
    }
  });

  it("compiles deterministic location prompt with materials, zones, and atmosphere", () => {
    const loc = LOCATION_CATALOG.loc_subterranean_market;
    const compiled = compileLocationPrompt(loc, {
      zoneKey: "zone_alleyway",
      atmosphericPresetKey: "midnight_downpour",
    });

    expect(compiled.promptBlock).toContain("Location setting: Kowloon-Style Subterranean Bazaar");
    expect(compiled.promptBlock).toContain("wet cracked hydraulic concrete");
    expect(compiled.promptBlock).toContain("Specific zone: Narrow Conduit Alley");
    expect(compiled.promptBlock).toContain("flickering cyan noodle shop sign");
    expect(compiled.promptBlock).toContain("Setting atmosphere: midnight, damp underground condensation");
    expect(compiled.prohibitedExclusions).toContain("sunlight");
    expect(compiled.prohibitedExclusions).toContain("blue sky");
  });

  it("handles location compilation without specified zone or atmosphere", () => {
    const loc = LOCATION_CATALOG.loc_brutalist_interrogation_room;
    const compiled = compileLocationPrompt(loc);

    expect(compiled.promptBlock).toContain("Sub-Level Ministry Interrogation Cell");
    expect(compiled.materialsClause).toContain("battleship-grey concrete");
    expect(compiled.prohibitedExclusions).toContain("windows");
  });
});
