import { describe, expect, it } from "vitest";
import { compileBiblePromptDirectives, parseProjectStyleBible, projectStyleBibleSchema } from "./style-bible.js";

describe("ProjectStyleBible", () => {
  it("validates and parses a full project style bible", () => {
    const raw = {
      look: "1920s Weimar noir, chiaroscuro, 35mm monochrome grain",
      period: "1920s",
      costumeGuidelines: "Heavy wool trench coats, fedoras, three-piece suits",
      negativePrompt: "modern buildings, wristwatches, synthetic fabrics, zippers",
      defaultAspectRatio: "2.39:1",
      defaultVideoEngine: "comfyui",
      canonicalCharacters: [
        {
          name: "Elena",
          aliases: ["Agent 7"],
          kind: "character",
          description: "Sharp jawline, bob cut hair, piercing gray eyes",
          wardrobe: "Dark charcoal double-breasted coat with wide lapels",
        },
      ],
    };

    const parsed = parseProjectStyleBible(raw);
    expect(parsed.look).toBe(raw.look);
    expect(parsed.period).toBe("1920s");
    expect(parsed.defaultAspectRatio).toBe("2.39:1");
    expect(parsed.defaultVideoEngine).toBe("comfyui");
    expect(parsed.canonicalCharacters).toHaveLength(1);
    expect(parsed.canonicalCharacters[0].name).toBe("Elena");
    expect(parsed.canonicalCharacters[0].aliases).toEqual(["Agent 7"]);
  });

  it("provides safe fallbacks for empty or malformed inputs", () => {
    const parsed = parseProjectStyleBible(null);
    expect(parsed.look).toBe("");
    expect(parsed.defaultAspectRatio).toBe("16:9");
    expect(parsed.defaultVideoEngine).toBe("fal");
    expect(parsed.canonicalCharacters).toEqual([]);
  });

  it("compiles style bible directives into prompt lines", () => {
    const directives = compileBiblePromptDirectives({
      look: "Gritty 35mm anamorphic, amber and teal",
      period: "1980s Cold War",
      costumeGuidelines: "Military surplus parka, worn leather boots",
      negativePrompt: "smartphones, plastic sunglasses, modern cars",
    });

    expect(directives.styleDirective).toBe("Period: 1980s Cold War. Gritty 35mm anamorphic, amber and teal");
    expect(directives.costumeDirective).toBe("Wardrobe & Costumes: Military surplus parka, worn leather boots");
    expect(directives.negativeDirectives).toEqual(["smartphones", "plastic sunglasses", "modern cars"]);
  });
});
