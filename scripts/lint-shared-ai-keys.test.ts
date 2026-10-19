import { describe, expect, it } from "vitest";
import { auditSourceFile } from "./lint-shared-ai-keys.js";

/**
 * The linter's own tests — a gate that reads green while checking nothing is
 * this repo's most repeated defect, so every spelling it claims to catch is
 * pinned here, along with the reads it must leave alone.
 */
const keysFor = (code: string) => auditSourceFile("server/fixture.ts", code).map((f) => f.key);

describe("lint:shared-ai-keys", () => {
    it("catches the dotted form, including inside a fallback chain", () => {
        expect(keysFor(`const k = config.apiKey || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || "";`))
            .toEqual(["GOOGLE_API_KEY", "GEMINI_API_KEY"]);
    });

    it("catches bracket access and destructuring", () => {
        expect(keysFor(`const k = process.env["OPENAI_API_KEY"];`)).toEqual(["OPENAI_API_KEY"]);
        expect(keysFor(`const { FAL_KEY, PORT } = process.env;`)).toEqual(["FAL_KEY"]);
        expect(keysFor(`const { ANTHROPIC_API_KEY: key } = process.env;`)).toEqual(["ANTHROPIC_API_KEY"]);
    });

    it("leaves other environment variables and other objects alone", () => {
        expect(keysFor(`const a = process.env.ENCRYPTION_KEY; const b = env.GEMINI_API_KEY; const c = config.GEMINI_API_KEY;`))
            .toEqual([]);
    });
});
