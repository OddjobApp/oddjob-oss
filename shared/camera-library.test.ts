import { describe, expect, it } from "vitest";
import {
  CAMERA_MOTION_PRESETS,
  FRAMING_CATALOG,
  LENS_KIT,
  SENSOR_PROFILES,
  cameraSetupSchema,
  compileCameraPrompt,
  resolveCameraControlVector,
} from "./camera-library.js";

describe("Cinematic Camera Library", () => {
  it("provides comprehensive sensor, lens, framing, and motion catalogs", () => {
    expect(SENSOR_PROFILES.full_frame_35mm.cropFactor).toBe(1.0);
    expect(SENSOR_PROFILES.large_format_65mm.cropFactor).toBe(0.5);
    expect(LENS_KIT["35mm"].focalLengthMm).toBe(35);
    expect(LENS_KIT["40mm_anamorphic"].distortionCharacteristic).toBe("anamorphic_streak");
    expect(FRAMING_CATALOG.medium_close_up.abbreviation).toBe("MCU");
    expect(CAMERA_MOTION_PRESETS.slow_push_in.cameraControlVector.zoom).toBe(2.5);
  });

  it("validates camera setup schema with sensible cinema defaults", () => {
    const defaultSetup = cameraSetupSchema.parse({});
    expect(defaultSetup.sensorFormat).toBe("full_frame_35mm");
    expect(defaultSetup.lensFocalLength).toBe("35mm");
    expect(defaultSetup.framing).toBe("medium_close_up");
    expect(defaultSetup.motionPresetId).toBe("static_lock");
    expect(defaultSetup.shutterAngle).toBe(180);
    expect(defaultSetup.iso).toBe(800);
  });

  it("compiles detailed cinematic camera prompts", () => {
    const prompt = compileCameraPrompt({
      sensorFormat: "full_frame_35mm",
      lensFocalLength: "50mm",
      framing: "close_up",
      motionPresetId: "tracking_lead",
      aperture: "f/1.4",
      opticalFilters: ["1/8 Black Pro-Mist"],
    });

    expect(prompt).toContain("Close-Up (CU)");
    expect(prompt).toContain("Shot on Full Frame 35mm");
    expect(prompt).toContain("Using 50mm Human Perspective at f/1.4");
    expect(prompt).toContain("with 1/8 Black Pro-Mist filtration");
    expect(prompt).toContain("Smooth Steadicam tracking backward ahead of walking character");
  });

  it("resolves exact camera control vectors from presets", () => {
    const slowPush = resolveCameraControlVector("slow_push_in");
    expect(slowPush.zoom).toBe(2.5);
    expect(slowPush.pan).toBe(0);

    const lateralTruck = resolveCameraControlVector("lateral_truck_right", 1.5);
    expect(lateralTruck.pan).toBe(5.25); // 3.5 * 1.5
  });

  it("heuristically translates natural language camera motion strings into control vectors", () => {
    const push = resolveCameraControlVector("slow dolly push-in");
    expect(push.zoom).toBeGreaterThan(0);

    const pull = resolveCameraControlVector("pull out to reveal");
    expect(pull.zoom).toBeLessThan(0);

    const pan = resolveCameraControlVector("pan right to operative");
    expect(pan.pan).toBeGreaterThan(0);

    const tilt = resolveCameraControlVector("tilt up towards the sky");
    expect(tilt.tilt).toBeLessThan(0);
  });
});
