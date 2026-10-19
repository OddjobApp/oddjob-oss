import { describe, expect, it } from "vitest";
import { charactersNamedIn, compileKeyframe, compileShot, referencePrompt } from "./media-prompt";
import type { CharacterView } from "./media-studio";

const elena: CharacterView = { id: 1, kind: "character", name: "Elena", description: "a courier in a rain-soaked trench coat", aliases: ["El"] };
const roof: CharacterView = { id: 2, kind: "location", name: "The Archive Roof", description: "a flat concrete roof with a parapet", aliases: [] };
const scene = { location: "Archive rooftop", timeOfDay: "night", mood: "tense, cold cyan light" };
const shot = {
  prompt: "Elena crouches behind the parapet as a drone sweeps its light",
  negativePrompt: "text overlays",
  framing: "medium close-up",
  lens: "35mm",
  cameraMotion: "slow push-in",
  action: "She presses the cylinder to her chest",
  dialogue: [{ speaker: "Elena", line: "Not tonight.", delivery: "whispering" }],
  durationSeconds: 5,
};

describe("compiling a shot for the video model", () => {
  it("writes the scene's direction, the shot, the character, and the dialogue in order", () => {
    const compiled = compileShot({ aspectRatio: "2.39:1", scene, shot, characters: [elena, roof] });
    expect(compiled.prompt).toBe([
      "Setting: Archive rooftop, night.",
      "Mood: tense, cold cyan light.",
      "Shot: medium close-up, 35mm lens, camera slow push-in.",
      "Elena crouches behind the parapet as a drone sweeps its light.",
      "Action: She presses the cylinder to her chest.",
      "Characters: Elena, a courier in a rain-soaked trench coat.",
      "Dialogue:",
      'Elena (whispering): "Not tonight."',
      "Avoid: text overlays.",
    ].join("\n"));
    expect(compiled).toMatchObject({ aspectRatio: "21:9", durationSeconds: 5, generateAudio: true, warnings: [] });
  });

  it("says there is no dialogue, so the model does not invent any", () => {
    const compiled = compileShot({ aspectRatio: "16:9", scene: { location: "", timeOfDay: "", mood: "" }, shot: { ...shot, dialogue: [], framing: null, lens: null, cameraMotion: null, negativePrompt: null, action: "" } });
    expect(compiled.prompt).toBe("Elena crouches behind the parapet as a drone sweeps its light.\nNo dialogue.");
  });

  it("matches speakers by alias, and warns about a speaker the manuscript does not have", () => {
    const compiled = compileShot({
      aspectRatio: "16:9", scene, characters: [elena],
      shot: { ...shot, dialogue: [{ speaker: "el", line: "Go." }, { speaker: "Marcus", line: "Wait!" }] },
    });
    expect(compiled.warnings).toEqual(['"Marcus" is not a character in the manuscript.']);
    expect(compiled.prompt).toContain('Marcus: "Wait!"');
  });

  it("warns when the dialogue will not fit, the shot is outside Seedance's range, or nothing is described", () => {
    const long = compileShot({ aspectRatio: "16:9", scene, shot: { ...shot, durationSeconds: 4, dialogue: [{ speaker: "Elena", line: "one two three four five six seven eight nine ten eleven" }] } });
    expect(long.warnings).toEqual(["11 words of dialogue will not fit in 4 seconds; about 10 will."]);

    const empty = compileShot({ aspectRatio: "16:9", scene, shot: { ...shot, prompt: "", action: " ", durationSeconds: 20, dialogue: [] } });
    expect(empty.warnings).toEqual([
      "Describe what the shot shows, in its prompt or its action.",
      "Seedance renders 4 to 15 seconds; this shot is 20.",
    ]);
  });

  it("drops blank dialogue lines and keeps a quote inside a line from breaking it", () => {
    const compiled = compileShot({ aspectRatio: "16:9", scene, shot: { ...shot, dialogue: [{ speaker: " ", line: "ghost" }, { speaker: "Elena", line: 'She said "run"' }] } });
    expect(compiled.prompt).toContain(`Elena: "She said 'run'"`);
    expect(compiled.prompt).not.toContain("ghost");
  });

  it("adds the production's look after the scene's mood", () => {
    const compiled = compileShot({ aspectRatio: "16:9", scene, shot: { ...shot, dialogue: [] }, style: "35mm film grain" });
    expect(compiled.prompt.split("\n").slice(0, 3)).toEqual(["Setting: Archive rooftop, night.", "Mood: tense, cold cyan light.", "Look: 35mm film grain."]);
  });
});

describe("compiling a keyframe for the image model", () => {
  const sceneOne = { sceneKey: "SCENE-01", title: "Arrival", location: "Archive rooftop", timeOfDay: "night", mood: "tense" };

  it("describes the plot point in its scene, with the characters it names, the look, and each reference image in order", () => {
    const prompt = compileKeyframe({
      productionTitle: "Rooftop chase", style: "35mm film grain, teal and amber", scene: sceneOne,
      plotPoint: { title: "El sees the drone", beat: "The drone crests the parapet behind her" }, characters: [elena, roof],
      references: [{ kind: "character", label: "Elena" }, { kind: "previous_keyframe", label: "SCENE-01 plot point 1: Arrival" }, { kind: "location", label: "Archive rooftop" }],
    });
    expect(prompt).toBe([
      'A cinematic storyboard keyframe for "Rooftop chase", SCENE-01 "Arrival": El sees the drone.',
      "The drone crests the parapet behind her.",
      "Setting: Archive rooftop, night.",
      "Mood: tense.",
      "Characters: Elena, a courier in a rain-soaked trench coat.",
      "Look: 35mm film grain, teal and amber.",
      "Reference images, in order: image 1 is Elena's appearance; image 2 is the previous frame; image 3 is the setting, Archive rooftop. Keep faces, wardrobe and places consistent with them.",
      "One still frame, no text, captions or borders.",
    ].join("\n"));
  });

  it("keeps the author's own prompt as written, adding only the look and the references", () => {
    const base = { productionTitle: "Rooftop chase", scene: sceneOne, plotPoint: { title: "She sees the drone", beat: "" } };
    expect(compileKeyframe({ ...base, prompt: "Wide on the parapet, drone backlit" })).toBe("Wide on the parapet, drone backlit");
    expect(compileKeyframe({ ...base, prompt: "Wide on the parapet", style: "noir", references: [{ kind: "location", label: "Archive rooftop" }] })).toBe([
      "Wide on the parapet",
      "Look: noir.",
      "Reference images, in order: image 1 is the setting, Archive rooftop. Keep faces, wardrobe and places consistent with them.",
    ].join("\n"));
  });

  it("finds characters and places by whole names and aliases only", () => {
    expect(charactersNamedIn("Elevator doors open; El's hand shakes", [elena]).map((c) => c.name)).toEqual(["Elena"]);
    expect(charactersNamedIn("The elevator hums", [elena])).toEqual([]);
    expect(charactersNamedIn("Dawn over the archive roof", [elena, roof], "location").map((c) => c.name)).toEqual(["The Archive Roof"]);
  });

  it("asks for a clear reference of a character, or of a place with nobody in it, in the production's look", () => {
    expect(referencePrompt({ kind: "character", name: "Elena", description: "a courier in a rain-soaked trench coat.", style: "35mm grain" })).toBe([
      "A character reference sheet for Elena, a courier in a rain-soaked trench coat.",
      "A full-length front view and a head-and-shoulders close-up side by side, on a plain neutral background in even light, so the face, hair and wardrobe are clear.",
      "Look: 35mm grain.",
      "No text, labels or borders.",
    ].join("\n"));
    expect(referencePrompt({ kind: "location", name: "Archive rooftop" })).toBe([
      "A location reference for Archive rooftop.",
      "A wide establishing view with no people in it, showing the layout, materials and light of the place.",
      "No text, labels or borders.",
    ].join("\n"));
  });

  it("enriches prompt with deterministic location, lighting, and prop libraries when specified", () => {
    const compiled = compileShot({
      aspectRatio: "16:9",
      scene: { location: "loc_cobblestone_bakery", timeOfDay: "morning", mood: "warm and peaceful" },
      shot: { ...shot, prompt: "Barnaby slices the golden loaf", action: "Steam rises", dialogue: [] },
      cinematicDirectives: {
        lightingPresetId: "golden_hour_natural",
        propIds: ["prop_golden_honey_brioche"],
      },
    });

    expect(compiled.prompt).toContain("Setting: Sunny Cobblestone Hearth Bakery, morning.");
    expect(compiled.prompt).toContain("Architecture: Charming European rustic artisan bakery");
    expect(compiled.prompt).toContain("Lighting: Cinematic lighting setup (Low-Sun Golden Hour Naturalism)");
    expect(compiled.prompt).toContain("Props: Prop: Artisan Braided Golden Honey Brioche.");
    expect(compiled.prompt).toContain("Materials: warm artisan baked bread");
    expect(compiled.prompt).toContain("Avoid: text overlays, neon signs, fluorescent strip lights");
  });
});
