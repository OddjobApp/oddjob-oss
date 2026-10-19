/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { mediaStudio } from "../core/media-studio.service.js";

describe("Cinematic Catalog and Orchestration Wiring", () => {
  it("exposes the full unified cinematic catalog", () => {
    const catalog = mediaStudio.getCinematicCatalog();
    expect(catalog).toBeDefined();

    // Check Locations
    expect(Object.keys(catalog.locations).length).toBeGreaterThan(0);
    expect(catalog.locations.loc_cobblestone_bakery).toBeDefined();
    expect(catalog.locations.loc_cobblestone_bakery.name).toContain("Cobblestone");

    // Check Props
    expect(Object.keys(catalog.props).length).toBeGreaterThan(0);
    expect(catalog.props.prop_golden_honey_brioche).toBeDefined();

    // Check Lighting Rigs
    expect(Object.keys(catalog.lightingRigs).length).toBeGreaterThan(0);
    expect(catalog.lightingRigs.golden_hour_natural).toBeDefined();

    // Check Shot Types
    expect(Object.keys(catalog.shotTypes).length).toBeGreaterThan(0);
    expect(catalog.shotTypes.hero_low_angle_mcu).toBeDefined();

    // Check Camera Lenses & Motions
    expect(Object.keys(catalog.lenses).length).toBeGreaterThan(0);
    expect(Object.keys(catalog.cameraMotions).length).toBeGreaterThan(0);
  });
});
