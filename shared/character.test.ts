import { describe, expect, it } from "vitest";
import {
  characterDefinitionSchema,
  parseCharacterDefinition,
  safeParseCharacterDefinition,
  type CharacterDefinition,
} from "./character.js";

describe("Character Definition Schema (character.json)", () => {
  const sampleCharacter: CharacterDefinition = {
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
      casual_office: {
        outerwear: "navy blue unstructured wool overcoat",
        base_layer: "heather grey Merino wool turtleneck",
        bottoms: "dark charcoal tailored flat-front trousers",
        footwear: "burnished oxblood Chelsea boots",
        prohibited_elements: [],
      },
    },
    media_assets: {
      master_turnaround_url: "s3://agent-assets/characters/devon/turnaround_v1.png",
      expression_matrix_url: "s3://agent-assets/characters/devon/expressions_v1.png",
      lora_checkpoint: "s3://agent-assets/models/loras/devon_cross_flux_v12.safetensors",
      ip_adapter_embedding: "s3://agent-assets/embeddings/devon_insightface.bin",
      voice_profile: {
        provider: "elevenlabs",
        voice_id: "EXAVITQu4vr4xnSDxMaL",
        stability: 0.65,
        similarity_boost: 0.85,
      },
    },
    turnaround_coordinates: {
      canvas_dimensions: { width: 3840, height: 2160 },
      crops: {
        front_full: { x: 100, y: 200, w: 650, h: 1800 },
        three_quarter_left: { x: 800, y: 200, w: 650, h: 1800 },
        profile_left: { x: 1500, y: 200, w: 650, h: 1800 },
        three_quarter_right: { x: 2200, y: 200, w: 650, h: 1800 },
        rear_full: { x: 2900, y: 200, w: 650, h: 1800 },
        headshot_neutral: { x: 180, y: 220, w: 480, h: 580 },
      },
    },
  };

  it("parses a valid character definition matching the specification", () => {
    const parsed = parseCharacterDefinition(sampleCharacter);
    expect(parsed.character_id).toBe("char_devon_cross_01");
    expect(parsed.demographics.height_cm).toBe(182);
    expect(parsed.invariant_phenotype.hair).toContain("textured low-fade crop");
    expect(parsed.wardrobe_states.field_tactical.prohibited_elements).toContain("logos");
    expect(parsed.turnaround_coordinates.crops.front_full.w).toBe(650);
  });

  it("safely handles 512D face embeddings", () => {
    const embedding = new Array(512).fill(0.044);
    const withEmbedding = {
      ...sampleCharacter,
      face_embedding: embedding,
    };
    const result = safeParseCharacterDefinition(withEmbedding);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.face_embedding?.length).toBe(512);
    }
  });

  it("rejects invalid face embeddings of incorrect length", () => {
    const invalidEmbedding = new Array(256).fill(0.1);
    const withInvalid = {
      ...sampleCharacter,
      face_embedding: invalidEmbedding,
    };
    const result = safeParseCharacterDefinition(withInvalid);
    expect(result.success).toBe(false);
  });

  it("rejects characters without required invariant phenotype elements", () => {
    const invalid = {
      ...sampleCharacter,
      invariant_phenotype: {
        face_structure: "",
      },
    };
    expect(() => parseCharacterDefinition(invalid)).toThrow();
  });
});
