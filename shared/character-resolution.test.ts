import { describe, expect, it } from "vitest";
import type { CharacterDefinition } from "./character.js";
import {
  buildConditionedPayload,
  categorizeFraming,
  compileCharacterVideoPrompt,
  resolveFramingCrop,
} from "./character-resolution.js";

describe("Character Resolution Engine", () => {
  const devonCross: CharacterDefinition = {
    character_id: "char_devon_cross_01",
    version: "1.2.0",
    name: "Devon Cross",
    demographics: {
      apparent_age: 34,
      gender_presentation: "male",
      ethnicity: "East Asian / Caucasian mixed descent",
      height_cm: 182,
      body_build: "lean athletic, broad shoulders",
    },
    invariant_phenotype: {
      face_structure: "high sharp cheekbones, square jaw with subtle cleft chin, prominent straight nasal bridge",
      eyes: "deep-set amber brown almond eyes, hooded eyelids, dense straight dark eyebrows",
      hair: "textured low-fade crop, raven black, matte pomade finish, slight right-parted fringe",
      skin: "warm olive undertones, light freckling across nose bridge, faint scar over left eyebrow tail",
      symmetry_safeguards: "symmetrical clean-shaven face, no lateral piercings, no asymmetrical facial marks",
    },
    wardrobe_states: {
      field_tactical: {
        outerwear: "charcoal-grey waxed cotton M-65 field jacket, storm flap, matte black metal snaps",
        base_layer: "fitted dark-slate crewneck thermal knit",
        bottoms: "tapered olive drab ripstop cargo pants, clean low-profile thigh pockets",
        footwear: "black matte leather tactical utility boots with lugged Vibram soles",
        prohibited_elements: ["logos", "brand patches", "asymmetrical shoulder straps", "loose necklaces"],
      },
    },
    media_assets: {
      master_turnaround_url: "s3://agent-assets/characters/devon/turnaround_v1.png",
      lora_checkpoint: "s3://agent-assets/models/loras/devon_cross_flux_v12.safetensors",
      ip_adapter_embedding: "s3://agent-assets/embeddings/devon_insightface.bin",
    },
    turnaround_coordinates: {
      canvas_dimensions: { width: 3840, height: 2160 },
      crops: {
        front_full: { x: 100, y: 200, w: 650, h: 1800 },
        three_quarter_left: { x: 800, y: 200, w: 650, h: 1800 },
        profile_left: { x: 1500, y: 200, w: 650, h: 1800 },
        headshot_neutral: { x: 180, y: 220, w: 480, h: 580 },
      },
    },
  };

  it("categorizes camera framing accurately", () => {
    expect(categorizeFraming("Extreme Close-Up on eyes")).toBe("extreme_close_up");
    expect(categorizeFraming("Headshot neutral")).toBe("close_up");
    expect(categorizeFraming("Medium close-up, tracking backward")).toBe("medium_close_up");
    expect(categorizeFraming("Medium cowboy shot")).toBe("medium");
    expect(categorizeFraming("Wide establishing view")).toBe("extreme_wide");
    expect(categorizeFraming("Full body shot")).toBe("wide");
  });

  it("compiles deterministic prompt without text ambiguity", () => {
    const prompt = compileCharacterVideoPrompt({
      character: devonCross,
      wardrobeKey: "field_tactical",
      action: "walking through a crowded subterranean market, turns to notice an operative, and stops",
      environment: "subterranean market with hanging neon cables and damp concrete",
      lighting: "moody overhead cyan neon lighting with high contrast rim fill",
      framing: "medium close-up",
      lens: "35mm",
    });

    expect(prompt).toContain("Cinematic medium close-up shot of Devon Cross");
    expect(prompt).toContain("high sharp cheekbones, square jaw with subtle cleft chin");
    expect(prompt).toContain("textured low-fade crop, raven black");
    expect(prompt).toContain("Wearing charcoal-grey waxed cotton M-65 field jacket, storm flap, matte black metal snaps");
    expect(prompt).toContain("Action: walking through a crowded subterranean market");
    expect(prompt).toContain("Setting: subterranean market with hanging neon cables");
    expect(prompt).toContain("35mm photography");
  });

  it("strips ambiguous subjective buzzwords from the prompt", () => {
    const prompt = compileCharacterVideoPrompt({
      character: devonCross,
      wardrobeKey: "field_tactical",
      action: "acting like a tough soldier in a pretty cool stance",
      environment: "gorgeous neon market",
      lighting: "stunning cinematic light",
      framing: "medium close-up",
    });

    expect(prompt).not.toMatch(/\btough\b/);
    expect(prompt).not.toMatch(/\bpretty\b/);
    expect(prompt).not.toMatch(/\bgorgeous\b/);
    expect(prompt).not.toMatch(/\bstunning\b/);
  });

  it("resolves optimal crop and scales coordinates to target resolution", () => {
    // 3840x2160 canvas scaled to 1280x720 (scale factor 1/3)
    const result = resolveFramingCrop(devonCross, "medium close-up", "front", { width: 1280, height: 720 });
    expect(result.cropKey).toBe("headshot_neutral");
    expect(result.sourceCrop.w).toBe(480);
    expect(result.sourceCrop.h).toBe(580);
    expect(result.scaledCrop.width).toBe(160); // 480 / 3
    expect(result.scaledCrop.height).toBe(193); // 580 / 3 = 193.33 -> 193
  });

  it("resolves wide/full angle crops correctly", () => {
    const result = resolveFramingCrop(devonCross, "wide shot", "profile", { width: 1920, height: 1080 });
    expect(result.cropKey).toBe("profile_left");
    expect(result.scaledCrop.width).toBe(325); // 650 * (1920/3840) = 325
  });

  it("builds conditioned payloads for both hosted and ComfyUI targets", () => {
    const payloads = buildConditionedPayload(devonCross, {
      wardrobeKey: "field_tactical",
      action: "steps into the shadows",
      environment: "narrow alleyway",
      lighting: "sodium vapor street lamps",
      framing: "medium close-up",
      cameraMotion: { pan: 0, tilt: 0, zoom: -1.5 },
    });

    expect(payloads.hostedApi.provider).toBe("seedance");
    expect(payloads.hostedApi.crop_key).toBe("headshot_neutral");
    expect(payloads.hostedApi.camera_control.zoom).toBe(-1.5);

    expect(payloads.comfyUi.lora_weight).toBe(0.75);
    expect(payloads.comfyUi.ip_adapter_weight).toBe(0.65);
    // Height scale: 182 / 180 = 1.011
    expect(payloads.comfyUi.openpose_height_scale).toBeCloseTo(1.011, 2);
  });

  it("resolves camera preset strings directly in buildConditionedPayload", () => {
    const payloads = buildConditionedPayload(devonCross, {
      wardrobeKey: "field_tactical",
      action: "crawls through air vent",
      environment: "tight metallic duct",
      lighting: "strobe hazard lights",
      framing: "extreme close-up",
      cameraMotion: "slow_push_in",
    });

    expect(payloads.hostedApi.camera_control.zoom).toBe(2.5);
    expect(payloads.hostedApi.crop_key).toBe("headshot_neutral");
  });
});
