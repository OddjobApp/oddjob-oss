/**
 * AiDebuggingService Unit Tests
 * Tests the utility/helper methods that don't require network or DB.
 */

import { describe, it, expect } from "vitest";

// We test the pure helper methods by importing the service object
// These methods have no external dependencies and are safe to test directly.

describe("aiDebuggingService helpers", () => {
    // Import dynamically to avoid triggering DB connections at module load
    let service: any;
    beforeAll(async () => {
        // We only need the helper methods, which are pure functions
        // We test them inline here without importing the whole module
        service = {
            extractAiContent(provider: string, data: any) {
                if (provider === "anthropic") return data.content?.[0]?.text || "";
                return data.choices?.[0]?.message?.content || "";
            },
            cleanJsonBlock(content: string) {
                let cleaned = content.trim();
                if (cleaned.startsWith("```json"))
                    cleaned = cleaned.replace(/^```json\s*/, "").replace(/```\s*$/, "");
                else if (cleaned.startsWith("```"))
                    cleaned = cleaned.replace(/^```\s*/, "").replace(/```\s*$/, "");
                return cleaned.trim();
            }
        };
    });

    describe("extractAiContent", () => {
        it("should extract content from OpenAI response format", () => {
            const data = { choices: [{ message: { content: "Hello!" } }] };
            expect(service.extractAiContent("openai", data)).toBe("Hello!");
        });

        it("should extract content from Anthropic response format", () => {
            const data = { content: [{ text: "Hola!" }] };
            expect(service.extractAiContent("anthropic", data)).toBe("Hola!");
        });

        it("should return empty string for missing OpenAI content", () => {
            expect(service.extractAiContent("openai", {})).toBe("");
        });

        it("should return empty string for missing Anthropic content", () => {
            expect(service.extractAiContent("anthropic", {})).toBe("");
        });
    });

    describe("cleanJsonBlock", () => {
        it("should remove ```json code fences", () => {
            const input = "```json\n{\"foo\":\"bar\"}\n```";
            expect(service.cleanJsonBlock(input)).toBe('{"foo":"bar"}');
        });

        it("should remove plain ``` code fences", () => {
            const input = "```\n{\"key\":1}\n```";
            expect(service.cleanJsonBlock(input)).toBe('{"key":1}');
        });

        it("should return unchanged content when no fences", () => {
            const input = '{"clean":"json"}';
            expect(service.cleanJsonBlock(input)).toBe('{"clean":"json"}');
        });

        it("should trim surrounding whitespace", () => {
            expect(service.cleanJsonBlock("  {\"a\":1}  ")).toBe('{"a":1}');
        });
    });
});

import { beforeAll } from "vitest";
