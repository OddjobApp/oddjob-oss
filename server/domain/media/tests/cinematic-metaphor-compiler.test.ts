import { describe, it, expect } from "vitest";
import { CinematicMetaphorCompilerService } from "../core/cinematic-metaphor-compiler.service.js";

describe("CinematicMetaphorCompilerService", () => {
    const compiler = new CinematicMetaphorCompilerService();

    it("passes raw prompt through unredacted when videoEngine is comfyui", () => {
        const raw = "Intense knife fight in the rain with bloody wounds and graphic dismemberment.";
        const result = compiler.compilePrompt({
            rawPrompt: raw,
            videoEngine: "comfyui",
        });

        expect(result.targetEngine).toBe("comfyui");
        expect(result.isMetaphorApplied).toBe(false);
        expect(result.effectivePrompt).toBe(raw);
        expect(result.detectedClassifications).toContain("violence");
    });

    it("leaves benign prompts unchanged for fal.ai", () => {
        const raw = "A lone astronaut walking across the lunar surface under starry skies.";
        const result = compiler.compilePrompt({
            rawPrompt: raw,
            videoEngine: "fal",
        });

        expect(result.targetEngine).toBe("fal");
        expect(result.isMetaphorApplied).toBe(false);
        expect(result.effectivePrompt).toBe(raw);
        expect(result.detectedClassifications).toHaveLength(0);
    });

    it("transforms explicit adult romance into evocative visual metaphors for fal.ai", () => {
        const raw = "Two lovers kissing passionately in bedroom with nudity and erotic embrace.";
        const result = compiler.compilePrompt({
            rawPrompt: raw,
            videoEngine: "fal",
            classifications: ["adult"],
        });

        expect(result.targetEngine).toBe("fal");
        expect(result.isMetaphorApplied).toBe(true);
        expect(result.effectivePrompt).not.toContain("nudity");
        expect(result.effectivePrompt).not.toContain("erotic");
        expect(result.effectivePrompt).toContain("intimate candlelit low-key lighting");
        expect(result.effectivePrompt).toContain("soft focus silhouette of lovers");
    });

    it("transforms graphic violence into atmospheric thriller metaphors for fal.ai", () => {
        const raw = "Gory assassination scene with slit throat and bloody aftermath.";
        const result = compiler.compilePrompt({
            rawPrompt: raw,
            videoEngine: "fal",
        });

        expect(result.targetEngine).toBe("fal");
        expect(result.isMetaphorApplied).toBe(true);
        expect(result.effectivePrompt).not.toContain("gory");
        expect(result.effectivePrompt).not.toContain("slit throat");
        expect(result.effectivePrompt).toContain("high-contrast noir shadows");
    });
});
