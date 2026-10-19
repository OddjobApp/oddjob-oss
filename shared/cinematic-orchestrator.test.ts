import { describe, expect, it } from "vitest";
import type { CharacterDefinition } from "./character.js";
import { LOCATION_CATALOG } from "./location-library.js";
import { PROP_CATALOG } from "./prop-library.js";
import { LIGHTING_CATALOG } from "./lighting-library.js";
import { SHOT_TYPES_CATALOG } from "./shot-types.js";
import {
  orchestrateCinematicShot,
  type CinematicSceneContext,
  type CinematicShotInput,
} from "./cinematic-orchestrator.js";

describe("Cinematic Orchestrator (Multi-Asset Synthesis)", () => {
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
      face_structure: "high sharp cheekbones, square jaw with subtle cleft chin",
      eyes: "deep-set amber brown almond eyes",
      hair: "textured low-fade crop, raven black",
      skin: "warm olive undertones, light freckling across nose bridge",
      symmetry_safeguards: "symmetrical clean-shaven face",
    },
    wardrobe_states: {
      field_tactical: {
        outerwear: "charcoal-grey waxed cotton M-65 field jacket",
        base_layer: "fitted dark-slate crewneck thermal knit",
        bottoms: "tapered olive drab ripstop cargo pants",
        footwear: "black matte leather tactical utility boots",
        prohibited_elements: ["logos", "brand patches"],
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
        headshot_neutral: { x: 180, y: 220, w: 480, h: 580 },
      },
    },
    face_embedding: new Array(512).fill(0.044),
  };

  const sceneContext: CinematicSceneContext = {
    productionTitle: "Project Chimera: Rogue State",
    aspectRatio: "2.39:1",
    location: LOCATION_CATALOG.loc_subterranean_market,
    locationZoneKey: "zone_alleyway",
    locationAtmosphereKey: "midnight_downpour",
    lightingRig: LIGHTING_CATALOG.cyberpunk_bicolor_neon,
    characters: [devonCross],
    props: [PROP_CATALOG.prop_quantum_core_drive],
  };

  const shotInput: CinematicShotInput = {
    shotNumber: 1,
    shotType: SHOT_TYPES_CATALOG.hero_low_angle_mcu,
    cameraMotion: "slow_push_in",
    action: "Devon pulls the cryptographic core from inside his jacket and checks the optical latch",
    primaryCharacterId: "char_devon_cross_01",
    primaryWardrobeKey: "field_tactical",
    activePropIds: ["prop_quantum_core_drive"],
    dialogue: [{ speaker: "Devon", line: "Coordinates verified. We move now.", delivery: "flat whisper" }],
    durationSeconds: 5,
  };

  it("orchestrates an end-to-end conditioned payload uniting all 6 asset libraries", () => {
    const payload = orchestrateCinematicShot(sceneContext, shotInput);

    // 1. Positive Prompt checks
    expect(payload.compiledPositivePrompt).toContain("Kowloon-Style Subterranean Bazaar");
    expect(payload.compiledPositivePrompt).toContain("Cyberpunk Dual-Complementary");
    expect(payload.compiledPositivePrompt).toContain("Heroic Low-Angle MCU");
    expect(payload.compiledPositivePrompt).toContain("Subject: Devon Cross");
    expect(payload.compiledPositivePrompt).toContain("Wearing charcoal-grey waxed cotton M-65 field jacket");
    expect(payload.compiledPositivePrompt).toContain("Prop: Cipher Core Cryptographic Drive");
    expect(payload.compiledPositivePrompt).toContain('Devon (flat whisper): "Coordinates verified. We move now."');

    // 2. Negative Exclusions merged across Location, Character, Prop, and Lighting
    expect(payload.compiledNegativePrompt).toContain("sunlight"); // from location
    expect(payload.compiledNegativePrompt).toContain("logos"); // from character wardrobe
    expect(payload.compiledNegativePrompt).toContain("cheap plastic"); // from prop
    expect(payload.compiledNegativePrompt).toContain("no natural daylight"); // from lighting
    expect(payload.compiledNegativePrompt).toContain("no double chins"); // from shot type

    // 3. Commercial API Payload
    expect(payload.commercialApiPayload.aspect_ratio).toBe("21:9"); // 2.39:1 maps to 21:9 in FAL/Seedance
    expect(payload.commercialApiPayload.camera_control.zoom).toBe(2.5); // slow_push_in
    expect(payload.commercialApiPayload.reference_frame_url).toBe("s3://agent-assets/characters/devon/turnaround_v1.png");
    expect(payload.commercialApiPayload.reference_crop_box).toBeDefined();

    // 4. ComfyUI Graph Inputs
    expect(payload.comfyUiGraphInputs.lora_weight).toBe(0.75);
    expect(payload.comfyUiGraphInputs.ip_adapter_weight).toBe(0.65);
    expect(payload.comfyUiGraphInputs.openpose_height_scale).toBeCloseTo(1.011, 2);
    expect(payload.comfyUiGraphInputs.camera_motion_type).toBe("dolly_in");

    // 5. Identity Drift Guardrails
    expect(payload.identityDriftGuardrails.minimumSimilarityThreshold).toBe(0.72);
    expect(payload.identityDriftGuardrails.monitoredCharacterId).toBe("char_devon_cross_01");
    expect(payload.identityDriftGuardrails.expectedFaceEmbedding?.length).toBe(512);

    expect(payload.warnings).toHaveLength(0);
  });

  it("emits warning when shot duration violates video model limits", () => {
    const invalidShot: CinematicShotInput = {
      ...shotInput,
      durationSeconds: 20, // max is 15s
    };

    const payload = orchestrateCinematicShot(sceneContext, invalidShot);
    expect(payload.warnings.length).toBeGreaterThan(0);
    expect(payload.warnings[0]).toContain("outside supported range");
  });
});
