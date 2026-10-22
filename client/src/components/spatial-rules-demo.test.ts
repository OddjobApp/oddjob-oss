import { describe, expect, it } from "vitest";
import { latLngToCell } from "h3-js";
import { DEMO_REQUESTS, evaluateDemoLocation } from "./spatial-rules-demo";
describe("geographic rules demonstration", () => {
  it("evaluates actual sample coordinates, with exclusion taking precedence over coverage", () => {
    const results = DEMO_REQUESTS.map(r => evaluateDemoLocation(latLngToCell(r.coordinates[0], r.coordinates[1], 8)));
    expect(results).toEqual([
      { inServiceArea: true, inRestrictedZone: false, eligible: true },
      { inServiceArea: true, inRestrictedZone: true, eligible: false },
      { inServiceArea: false, inRestrictedZone: false, eligible: false },
    ]);
  });
});
