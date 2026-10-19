import { describe, expect, it } from "vitest";
import {
  PROP_CATALOG,
  compilePropPrompt,
  propDefinitionSchema,
} from "./prop-library.js";

describe("Hero Props & Vehicles Library", () => {
  it("validates prop definitions against schema", () => {
    for (const [id, def] of Object.entries(PROP_CATALOG)) {
      expect(def.propId).toBe(id);
      expect(() => propDefinitionSchema.parse(def)).not.toThrow();
    }
  });

  it("compiles deterministic prop prompt with physical specs and handling", () => {
    const prop = PROP_CATALOG.prop_quantum_core_drive;
    const compiled = compilePropPrompt(prop, {
      wearState: "field_weathered",
      actionContext: "sliding thumb across release switch under the interrogation table",
    });

    expect(compiled.promptClause).toContain("Cipher Core Cryptographic Drive");
    expect(compiled.promptClause).toContain("9x3.5x1.2cm");
    expect(compiled.promptClause).toContain("tungsten-titanium alloy");
    expect(compiled.promptClause).toContain("brass substrate showing through worn corners");
    expect(compiled.promptClause).toContain("Handling: sliding thumb across release switch");
    expect(compiled.prohibitedExclusions).toContain("cheap plastic");
    expect(compiled.prohibitedExclusions).toContain("USB-A connector");
  });
});
