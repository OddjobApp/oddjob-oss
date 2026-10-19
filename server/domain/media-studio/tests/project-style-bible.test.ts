/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { parseProjectStyleBible, compileBiblePromptDirectives } from "@shared/style-bible.js";
import { compileShot, compileKeyframe } from "@shared/media-prompt.js";

describe("Project Space Style Bible & Continuity", () => {
  it("parses and validates project style bible data with historical and costume rules", () => {
    const raw = {
      look: "35mm anamorphic, chiaroscuro, muted amber and teal",
      period: "1920s Weimar",
      costumeGuidelines: "Heavy wool coats, tailored waistcoats, fedoras",
      negativePrompt: "wristwatches, modern cars, synthetic fabrics",
      defaultAspectRatio: "2.39:1",
      defaultVideoEngine: "comfyui",
      canonicalCharacters: [
        {
          name: "Elena",
          kind: "character",
          description: "Courier with dark bob cut",
          wardrobe: "Charcoal trench coat",
        },
      ],
    };

    const bible = parseProjectStyleBible(raw);
    expect(bible.look).toBe(raw.look);
    expect(bible.period).toBe("1920s Weimar");
    expect(bible.costumeGuidelines).toBe("Heavy wool coats, tailored waistcoats, fedoras");
    expect(bible.defaultAspectRatio).toBe("2.39:1");
    expect(bible.defaultVideoEngine).toBe("comfyui");
    expect(bible.canonicalCharacters).toHaveLength(1);
    expect(bible.canonicalCharacters[0].name).toBe("Elena");
  });

  it("injects costume guidelines and period into compileShot and compileKeyframe", () => {
    const scene = { location: "Archive rooftop", timeOfDay: "dusk", mood: "tense" };
    const shot = {
      prompt: "Elena runs across the roof",
      action: "She vaults the parapet",
      framing: "medium close-up",
      lens: "35mm",
      cameraMotion: "tracking",
      negativePrompt: "blur, modern buildings",
      dialogue: [],
      durationSeconds: 5,
    };

    const compiledShot = compileShot({
      aspectRatio: "2.39:1",
      scene,
      shot,
      style: "1920s Weimar noir, chiaroscuro",
      costumeGuidelines: "Heavy wool trench coat, fedora",
    });

    expect(compiledShot.prompt).toContain("Look: 1920s Weimar noir, chiaroscuro.");
    expect(compiledShot.prompt).toContain("Costume: Heavy wool trench coat, fedora.");
    expect(compiledShot.prompt).toContain("Setting: Archive rooftop, dusk.");

    const compiledKeyframe = compileKeyframe({
      productionTitle: "Berlin Noir",
      style: "1920s Weimar noir, chiaroscuro",
      costumeGuidelines: "Heavy wool trench coat, fedora",
      scene: { sceneKey: "SCENE-01", title: "Arrival", ...scene },
      plotPoint: { title: "Elena reaches the roof", beat: "She spots the shadow" },
    });

    expect(compiledKeyframe).toContain("Look: 1920s Weimar noir, chiaroscuro.");
    expect(compiledKeyframe).toContain("Costume: Heavy wool trench coat, fedora.");
  });

  it("compiles bible directives into complementary prompt fragments", () => {
    const directives = compileBiblePromptDirectives({
      look: "Monochrome film noir",
      period: "1940s",
      costumeGuidelines: "Double-breasted suit",
      negativePrompt: "sneakers, smartphones",
    });

    expect(directives.styleDirective).toBe("Period: 1940s. Monochrome film noir");
    expect(directives.costumeDirective).toBe("Wardrobe & Costumes: Double-breasted suit");
    expect(directives.negativeDirectives).toEqual(["sneakers", "smartphones"]);
  });
});
