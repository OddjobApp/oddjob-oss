import { describe, expect, it } from "vitest";
import {
  CAMERA_ANGLE_INFO,
  SHOT_SCALE_INFO,
  SHOT_TYPES_CATALOG,
  compileShotTypePrompt,
  recommendShotType,
  shotTypeDefinitionSchema,
} from "./shot-types.js";

describe("Cinematic Shot Types Library", () => {
  it("provides comprehensive shot scales with framing anchors", () => {
    expect(SHOT_SCALE_INFO.medium_close_up.abbreviation).toBe("MCU");
    expect(SHOT_SCALE_INFO.extreme_long_shot.abbreviation).toBe("ELS");
    expect(SHOT_SCALE_INFO.choker_shot.framingAnchor).toContain("Eyebrows to chin");
    expect(SHOT_SCALE_INFO.macro_detail.narrativePurpose).toContain("Forensics");
  });

  it("provides distinct camera angle pitch definitions", () => {
    expect(CAMERA_ANGLE_INFO.birds_eye_overhead.degreesPitch).toBe(-90);
    expect(CAMERA_ANGLE_INFO.eye_level.degreesPitch).toBe(0);
    expect(CAMERA_ANGLE_INFO.low_angle.degreesPitch).toBe(30);
  });

  it("validates catalog entries against schema", () => {
    for (const [id, def] of Object.entries(SHOT_TYPES_CATALOG)) {
      expect(def.id).toBe(id);
      expect(() => shotTypeDefinitionSchema.parse(def)).not.toThrow();
    }
  });

  it("compiles deterministic shot type prompts with exclusions", () => {
    const compiled = compileShotTypePrompt("hero_low_angle_mcu", {
      subjectName: "Devon Cross",
      action: "steps onto the observation deck",
    });

    expect(compiled.promptDirective).toContain("Medium Close-Up (MCU)");
    expect(compiled.promptDirective).toContain("Low-Angle Shot");
    expect(compiled.promptDirective).toContain("focused on Devon Cross");
    expect(compiled.promptDirective).toContain("as steps onto the observation deck");
    expect(compiled.promptDirective).toContain("shot on 35mm lens");
    expect(compiled.negativeDirectives).toContain("no double chins");
  });

  it("recommends shot types based on narrative beat and character count", () => {
    // Two characters in dialogue
    const dialogueRecs = recommendShotType({
      characterCount: 2,
      isDialogue: true,
      isAction: false,
      isClimactic: false,
    });
    expect(dialogueRecs.map((r) => r.id)).toContain("intimate_dirty_ots");
    expect(dialogueRecs.map((r) => r.id)).toContain("confrontation_profile_two_shot");

    // Climactic showdown
    const climacticRecs = recommendShotType({
      characterCount: 1,
      isDialogue: false,
      isAction: false,
      isClimactic: true,
    });
    expect(climacticRecs.map((r) => r.id)).toContain("neo_noir_dutch_choker");

    // Action sequence
    const actionRecs = recommendShotType({
      characterCount: 1,
      isDialogue: false,
      isAction: true,
      isClimactic: false,
    });
    expect(actionRecs.map((r) => r.id)).toContain("epic_cowboy_tracking");
  });
});
