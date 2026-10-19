import { describe, expect, it } from "vitest";
import { wardrobeForScene } from "./media-studio";
import { biblePromptInput, emotionFor, parseProjectStyleBible } from "./style-bible";
import { compileKeyframe, compileShot, referencePrompt } from "./media-prompt";

/**
 * Wardrobe, emotion and camera: the three things a production knows about itself
 * that never reached a render.
 *
 * `costumeGuidelines` was one paragraph applied to every frame of the film at
 * once, a character anchor's `wardrobe` was read by nothing, and a scene's mood
 * arrived at the model as a bare adjective. These pin the replacements.
 */

// Three scenes, in order.
const positions = new Map([[21, 0], [22, 1], [23, 2]]);

describe("what a character wears in a scene", () => {
    const wardrobe = [
        { characterName: "Elena", garment: "charcoal trench coat", notes: "worn open", fromSceneId: null },
        { characterName: "Elena", garment: "heavy wool coat", notes: "collar up", fromSceneId: 22 },
        { characterName: "Marcus", garment: "grey uniform", notes: "", fromSceneId: null },
    ];

    it("holds a garment from its scene onward until another supersedes it", () => {
        expect(wardrobeForScene(wardrobe, positions, 0)).toEqual([
            { characterName: "Elena", garment: "charcoal trench coat", notes: "worn open" },
            { characterName: "Marcus", garment: "grey uniform", notes: "" },
        ]);
        // From scene 2 the heavier coat takes over, and keeps hold in scene 3.
        for (const at of [1, 2]) {
            expect(wardrobeForScene(wardrobe, positions, at)).toContainEqual(
                { characterName: "Elena", garment: "heavy wool coat", notes: "collar up" },
            );
        }
        // And never reaches back into the scene before it — the flashback problem.
        expect(wardrobeForScene(wardrobe, positions, 0)).not.toContainEqual(
            { characterName: "Elena", garment: "heavy wool coat", notes: "collar up" },
        );
    });

    it("keeps a garment whose starting scene was deleted, worn from the beginning", () => {
        // fromSceneId is SET NULL on scene delete; the costume was still worn, so
        // losing the scene must not undress the character.
        const orphaned = [{ characterName: "Elena", garment: "heavy wool coat", notes: "", fromSceneId: 99 }];
        expect(wardrobeForScene(orphaned, positions, 0)).toEqual([
            { characterName: "Elena", garment: "heavy wool coat", notes: "" },
        ]);
    });

    it("matches a character by name whatever case it was written in", () => {
        const mixed = [
            { characterName: "elena", garment: "coat", notes: "", fromSceneId: null },
            { characterName: "Elena", garment: "torn coat", notes: "", fromSceneId: 23 },
        ];
        expect(wardrobeForScene(mixed, positions, 2)).toEqual([{ characterName: "Elena", garment: "torn coat", notes: "" }]);
    });
});

describe("wardrobe in a prompt", () => {
    const scene = { location: "Archive rooftop", timeOfDay: "night", mood: "tense" };
    const shot = {
        prompt: "", action: "Elena vaults the parapet", framing: null, lens: null, cameraMotion: null,
        negativePrompt: null, dialogue: [], durationSeconds: 5,
    };

    it("names who wears what, so two garments cannot land on one person", () => {
        const compiled = compileShot({
            aspectRatio: "2.39:1", scene, shot,
            wardrobe: [
                { characterName: "Elena", garment: "heavy wool coat", notes: "collar up" },
                { characterName: "Marcus", garment: "grey uniform" },
            ],
        });
        expect(compiled.prompt).toContain("Wardrobe: Elena wears heavy wool coat, collar up; Marcus wears grey uniform.");
    });

    it("reaches a keyframe too, and is left out entirely when nobody is dressed", () => {
        const base = {
            productionTitle: "Rooftop chase",
            scene: { sceneKey: "SCENE-02", title: "The rooftop", ...scene },
            plotPoint: { title: "Elena reaches the roof", beat: "" },
        };
        expect(compileKeyframe({ ...base, wardrobe: [{ characterName: "Elena", garment: "heavy wool coat" }] }))
            .toContain("Wardrobe: Elena wears heavy wool coat.");
        expect(compileKeyframe(base)).not.toContain("Wardrobe:");
        expect(compileShot({ aspectRatio: "16:9", scene, shot, wardrobe: [] }).prompt).not.toContain("Wardrobe:");
    });

    it("draws a character's reference sheet in what they wear", () => {
        // canonicalCharacters[].wardrobe was declared and read by nothing; this is
        // the reader. A sheet in the wrong coat anchors every later frame to it.
        expect(referencePrompt({ kind: "character", name: "Elena", description: "dark bob", wardrobe: "heavy wool coat" }))
            .toContain("Wearing heavy wool coat.");
        expect(referencePrompt({ kind: "character", name: "Elena" })).not.toContain("Wearing");
    });

    it("asks a theme plate for a look and nothing else", () => {
        const prompt = referencePrompt({ kind: "theme", name: "Cold war winter" });
        expect(prompt).toContain("mood board plate");
        expect(prompt).toContain("no people, no places and no story in it");
    });
});

describe("how a film shoots a mood", () => {
    const bible = parseProjectStyleBible({
        look: "anamorphic 2.39:1",
        camera: { lens: "35mm", framing: "medium" },
        emotions: [
            { mood: "tense", lighting: "hard sodium keylight", palette: "cold teal", camera: { motion: "slow push-in" } },
            { mood: "quiet dread", lighting: "single practical", palette: "amber" },
        ],
    });

    it("matches the scene's own words, preferring the more specific entry", () => {
        expect(emotionFor(bible, "tense")?.lighting).toBe("hard sodium keylight");
        expect(emotionFor(bible, "Tense and airless")?.lighting).toBe("hard sodium keylight");
        expect(emotionFor(bible, "quiet dread")?.lighting).toBe("single practical");
        expect(emotionFor(bible, "warm")).toBeNull();
        expect(emotionFor(bible, "")).toBeNull();
    });

    it("does not fire inside another word", () => {
        // "intense" is close to the opposite of "tense" in a shot list.
        expect(emotionFor(bible, "intense")).toBeNull();
    });

    it("supplies lighting, palette and a camera that beats the bible's default", () => {
        const input = biblePromptInput(bible, "", "tense");
        expect(input.lightingModifier).toBe("hard sodium keylight");
        expect(input.palette).toBe("cold teal");
        // The emotion's motion is added; the bible's lens and framing survive.
        expect(input.camera).toEqual({ lens: "35mm", framing: "medium", motion: "slow push-in" });
    });

    it("lets the production's own look win over the project's", () => {
        expect(biblePromptInput(bible, "handheld 16mm", "tense").style).toBe("handheld 16mm");
        expect(biblePromptInput(bible, "", "tense").style).toBe("anamorphic 2.39:1");
    });

    it("fills only the camera fields a shot left blank", () => {
        const scene = { location: "", timeOfDay: "", mood: "tense" };
        const shot = {
            prompt: "", action: "She runs", framing: null, lens: "50mm", cameraMotion: null,
            negativePrompt: null, dialogue: [], durationSeconds: 5,
        };
        const compiled = compileShot({ aspectRatio: "16:9", scene, shot, ...biblePromptInput(bible, "", "tense") });
        // The shot chose 50mm, so the bible's 35mm must not override it.
        expect(compiled.prompt).toContain("Shot: medium, 50mm lens, camera slow push-in.");
        expect(compiled.prompt).not.toContain("35mm");
    });

    it("merges the house negative prompt with the shot's own", () => {
        const scene = { location: "", timeOfDay: "", mood: "" };
        const shot = {
            prompt: "", action: "She runs", framing: null, lens: null, cameraMotion: null,
            negativePrompt: "blur", dialogue: [], durationSeconds: 5,
        };
        const compiled = compileShot({ aspectRatio: "16:9", scene, shot, avoidAlways: "wristwatches, modern cars" });
        expect(compiled.prompt).toContain("Avoid: blur, wristwatches, modern cars.");
    });
});
