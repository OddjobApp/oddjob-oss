/**
 * PromptBuilder Tests — full static method coverage
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("@shared/schema", () => ({ AIApiCallConfig: {} }));
vi.mock("@domain/tools/v1/capabilities/types.js", () => ({
    AgentStep: {},
    AgentContext: {},
    SupervisionLevel: {}
}));
vi.mock("@domain/ai/core/autonomous-lifecycle.service.js", () => ({ TaskManifest: {} }));

import { PromptBuilder } from "@domain/agents/core/prompt-builder.js";

describe("PromptBuilder.buildSystemInstructions", () => {
    const BASE_ARGS = {
        goal: "Find all open tickets",
        toolDescriptions: "search_tool: search the KB\nsql_query: run SQL",
        identityMsg: "You are OddJob, an AI assistant."
    };

    it("includes the goal in the prompt", () => {
        const result = PromptBuilder.buildSystemInstructions(
            BASE_ARGS.goal, BASE_ARGS.toolDescriptions, BASE_ARGS.identityMsg
        );
        expect(result).toContain(BASE_ARGS.goal);
    });

    it("includes the identity message", () => {
        const result = PromptBuilder.buildSystemInstructions(
            BASE_ARGS.goal, BASE_ARGS.toolDescriptions, BASE_ARGS.identityMsg
        );
        expect(result).toContain(BASE_ARGS.identityMsg);
    });

    it("includes tool descriptions", () => {
        const result = PromptBuilder.buildSystemInstructions(
            BASE_ARGS.goal, BASE_ARGS.toolDescriptions, BASE_ARGS.identityMsg
        );
        expect(result).toContain("search_tool");
    });

    it("includes custom prompt when provided", () => {
        const result = PromptBuilder.buildSystemInstructions(
            BASE_ARGS.goal, BASE_ARGS.toolDescriptions, BASE_ARGS.identityMsg,
            "Always respond in Spanish."
        );
        expect(result).toContain("CUSTOM SYSTEM PROMPT");
        expect(result).toContain("Always respond in Spanish.");
    });

    it("omits CUSTOM SYSTEM PROMPT section when customPrompt is undefined", () => {
        const result = PromptBuilder.buildSystemInstructions(
            BASE_ARGS.goal, BASE_ARGS.toolDescriptions, BASE_ARGS.identityMsg
        );
        expect(result).not.toContain("CUSTOM SYSTEM PROMPT");
    });

    it("includes shared memories when provided", () => {
        const result = PromptBuilder.buildSystemInstructions(
            BASE_ARGS.goal, BASE_ARGS.toolDescriptions, BASE_ARGS.identityMsg,
            undefined, "User prefers concise answers."
        );
        expect(result).toContain("User prefers concise answers.");
    });

    it("includes additional context when provided", () => {
        const result = PromptBuilder.buildSystemInstructions(
            BASE_ARGS.goal, BASE_ARGS.toolDescriptions, BASE_ARGS.identityMsg,
            undefined, undefined, "This org has 500 employees."
        );
        expect(result).toContain("This org has 500 employees.");
    });

    it("includes distilled summary when provided", () => {
        const result = PromptBuilder.buildSystemInstructions(
            BASE_ARGS.goal, BASE_ARGS.toolDescriptions, BASE_ARGS.identityMsg,
            undefined, undefined, undefined, "Summary of past session."
        );
        expect(result).toContain("Summary of past session.");
    });

    it("includes manifestation/strategy when provided", () => {
        const manifestation = {
            strategy: "Search then summarize",
            steps: [
                { description: "Search for tickets", tool: "search_tool" },
                { description: "Summarize findings", tool: "final_answer" }
            ]
        } as any;
        const result = PromptBuilder.buildSystemInstructions(
            BASE_ARGS.goal, BASE_ARGS.toolDescriptions, BASE_ARGS.identityMsg,
            undefined, undefined, undefined, undefined, manifestation
        );
        expect(result).toContain("STRATEGIC MANIFEST");
        expect(result).toContain("Search then summarize");
        expect(result).toContain("Search for tickets");
    });

    it("omits STRATEGIC MANIFEST when manifestation is undefined", () => {
        const result = PromptBuilder.buildSystemInstructions(
            BASE_ARGS.goal, BASE_ARGS.toolDescriptions, BASE_ARGS.identityMsg
        );
        expect(result).not.toContain("STRATEGIC MANIFEST");
    });

    it("wraps goal in [GOAL] tags", () => {
        const result = PromptBuilder.buildSystemInstructions(
            BASE_ARGS.goal, BASE_ARGS.toolDescriptions, BASE_ARGS.identityMsg
        );
        expect(result).toContain("[GOAL]");
        expect(result).toContain("[/GOAL]");
    });

    it("includes JSON output format instructions", () => {
        const result = PromptBuilder.buildSystemInstructions(
            BASE_ARGS.goal, BASE_ARGS.toolDescriptions, BASE_ARGS.identityMsg
        );
        expect(result).toContain("final_answer");
        expect(result).toContain("json");
    });
});

describe("PromptBuilder.buildTurnPrompt", () => {
    it("includes USER QUESTION on first iteration", () => {
        const result = PromptBuilder.buildTurnPrompt(
            "What is the ticket count?",
            [],
            1,
            { organizationId: 1, userId: "test-user" }
        );
        expect(result).toContain("USER QUESTION");
        expect(result).toContain("[USER_MESSAGE]");
    });

    it("omits USER QUESTION on subsequent iterations", () => {
        const result = PromptBuilder.buildTurnPrompt("goal", [], 2, { organizationId: 1, userId: "test-user" });
        expect(result).not.toContain("USER QUESTION");
    });

    it("formats thought steps correctly", () => {
        const history = [{ type: "thought", content: "I should search first" }] as any;
        const result = PromptBuilder.buildTurnPrompt("goal", history, 2, { organizationId: 1, userId: "test-user" });
        expect(result).toContain("THOUGHT: I should search first");
    });

    it("formats action steps correctly", () => {
        const history = [{ type: "action", content: "Calling search tool" }] as any;
        const result = PromptBuilder.buildTurnPrompt("goal", history, 2, { organizationId: 1, userId: "test-user" });
        expect(result).toContain("ACTION: Calling search tool");
    });

    it("formats observation steps correctly", () => {
        const history = [{ type: "observation", content: "Found 5 results" }] as any;
        const result = PromptBuilder.buildTurnPrompt("goal", history, 2, { organizationId: 1, userId: "test-user" });
        expect(result).toContain("OBSERVATION: Found 5 results");
    });

    it("formats system steps correctly", () => {
        const history = [{ type: "system", content: "Token limit approaching" }] as any;
        const result = PromptBuilder.buildTurnPrompt("goal", history, 2, { organizationId: 1, userId: "test-user" });
        expect(result).toContain("SYSTEM: Token limit approaching");
    });

    it("falls back to raw content for unknown step types", () => {
        const history = [{ type: "unknown", content: "some content" }] as any;
        const result = PromptBuilder.buildTurnPrompt("goal", history, 2, { organizationId: 1, userId: "test-user" });
        expect(result).toContain("some content");
    });

    it("uses final_answer prompt when last step is a successful observation", () => {
        const history = [{ type: "observation", content: "Here are the results: 5 tickets found" }] as any;
        const result = PromptBuilder.buildTurnPrompt("goal", history, 2, { organizationId: 1, userId: "test-user" });
        expect(result).toContain("final_answer");
    });

    it("uses tool prompt when last step is an error observation", () => {
        const history = [{ type: "observation", content: "Error: tool failed" }] as any;
        const result = PromptBuilder.buildTurnPrompt("goal", history, 2, { organizationId: 1, userId: "test-user" });
        expect(result).toContain("tool");
    });

    it("includes previous history when provided in context", () => {
        const context = {
            organizationId: 1,
            userId: "test-user",
            previousHistory: [
                { role: "user", content: "Hello" },
                { role: "assistant", content: "Hi there" }
            ]
        } as any;
        const result = PromptBuilder.buildTurnPrompt("goal", [], 2, context);
        expect(result).toContain("YOUR CONVERSATION WITH THE USER");
        expect(result).toContain("[USER_MESSAGE]");
        expect(result).toContain("Hi there");
    });

    it("handles empty history array correctly", () => {
        const result = PromptBuilder.buildTurnPrompt("goal", [], 1, { organizationId: 1, userId: "test-user" });
        expect(result).toContain("YOUR TURN");
    });

    it("includes all instructions and current task section", () => {
        const result = PromptBuilder.buildTurnPrompt("goal", [], 1, { organizationId: 1, userId: "test-user" });
        expect(result).toContain("CURRENT TASK HISTORY");
    });
});
