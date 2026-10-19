import { describe, it, expect } from "vitest";
import { generateEgressPreview } from "./egress-preview";

describe("generateEgressPreview", () => {
    it("handles plain text without sandboxes", () => {
        const text = "# Chapter 1\n\nIt was a dark and stormy night.";
        const result = generateEgressPreview(text);
        expect(result.sandboxedBlockCount).toBe(0);
        expect(result.sandboxedWords).toBe(0);
        expect(result.sanitizedEgress).toBe(text);
        expect(result.isClean).toBe(false);
    });

    it("redacts single sandbox block and extracts metadata", () => {
        const text = [
            "Before the door.",
            ':::sandbox id="scene_1" type="adult" mode="static_reinsert" summary="Passionate embrace"',
            "They kissed passionately with raw hunger.",
            ":::",
            "After the encounter.",
        ].join("\n");

        const result = generateEgressPreview(text);
        expect(result.sandboxedBlockCount).toBe(1);
        expect(result.sandboxedWords).toBe(6);
        expect(result.isClean).toBe(true);
        expect(result.blocks[0].id).toBe("scene_1");
        expect(result.blocks[0].type).toBe("adult");
        expect(result.blocks[0].summary).toBe("Passionate embrace");

        expect(result.sanitizedEgress).toContain("[SCENE_BEAT: Passionate embrace] <<ODDJOB_MASK:");
        expect(result.sanitizedEgress).not.toContain("kissed passionately");
        expect(result.sanitizedEgress).toContain("Before the door.");
        expect(result.sanitizedEgress).toContain("After the encounter.");
    });
});
