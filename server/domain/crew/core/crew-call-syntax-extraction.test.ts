import { describe, expect, it } from "vitest";
import { CrewGenerationService } from "./crew-generation.service.js";

/**
 * Regression for a raw tool call reaching the user as chat text.
 *
 * In crew room crew-1786852635041-r4lybtj (turn 1065) Copilot was handed a
 * validation error for generate_presentation_deck, stopped emitting a structured
 * call, and wrote the call it meant to make as source code. That is not JSON, so
 * the content-fallback extractor bailed and the model's code was stored as the
 * agent's turn and rendered verbatim in the room.
 */

// The extraction helpers are internal; the test drives them the way `generate`
// does rather than restating their logic.
const extract = (content: string, offered?: Set<string>) =>
    (CrewGenerationService.prototype as any).extractToolCallsFromContent.call(
        new CrewGenerationService(),
        content,
        offered,
    ) as Array<{ name: string; args: Record<string, unknown> }>;

const OFFERED = new Set(["generate_presentation_deck", "search_unified_knowledge"]);

describe("tool calls written as source code", () => {
    it("recovers the exact payload that leaked into the room", () => {
        const leaked = `generate_presentation_deck({
  title: "How Oddjob Uses World Models for Operational Intelligence",
  content: [
    {
      type: "section",
      title: "Definition of AI World Models",
      body: "An AI world model is a machine learning system that builds an internal representation of an environment to predict changes and aid planning. [Source: Wikipedia, Forbes, NVIDIA]"
    },
    {
      type: "section",
      title: "Internal Representations in Oddjob",
      body: "Our unified knowledge base does not contain specific information on how Oddjob uses world models."
    }
  ],
  themeId: "dark_cyberpunk",
  formatCategory: "presentation_deck"
})`;

        const calls = extract(leaked, OFFERED);

        expect(calls).toHaveLength(1);
        expect(calls[0].name).toBe("generate_presentation_deck");
        expect(calls[0].args.title).toBe(
            "How Oddjob Uses World Models for Operational Intelligence",
        );
        expect(calls[0].args.themeId).toBe("dark_cyberpunk");
        expect(Array.isArray(calls[0].args.content)).toBe(true);
        expect((calls[0].args.content as unknown[]).length).toBe(2);
    });

    it("leaves a colon inside a string value alone", () => {
        const calls = extract(
            `search_unified_knowledge({ query: "world models [Source: Wikipedia, Forbes]" })`,
            OFFERED,
        );
        expect(calls[0].args.query).toBe("world models [Source: Wikipedia, Forbes]");
    });

    it("accepts already-quoted keys and trailing commas", () => {
        const calls = extract(`search_unified_knowledge({ "query": "abc", })`, OFFERED);
        expect(calls).toEqual([{ name: "search_unified_knowledge", args: { query: "abc" } }]);
    });

    it("ignores a call-shaped name the agent was not granted", () => {
        expect(extract(`delete_everything({ target: "prod" })`, OFFERED)).toEqual([]);
    });

    it("ignores ordinary prose", () => {
        expect(
            extract("I attempted to call generate_presentation_deck but it failed.", OFFERED),
        ).toEqual([]);
        expect(extract("Here is my summary of world models.", OFFERED)).toEqual([]);
    });

    it("still parses the structured JSON formats", () => {
        expect(
            extract(`{"toolCalls":[{"functionCall":{"name":"search_unified_knowledge","args":{"query":"x"}}}]}`),
        ).toEqual([{ name: "search_unified_knowledge", args: { query: "x" } }]);
    });
});
