/**
 * Prompt Builder Unit Tests
 */

import { describe, it, expect } from "vitest";
import { PromptBuilder } from "@domain/agents/core/prompt-builder.js";

describe("PromptBuilder", () => {
    describe("buildSystemInstructions", () => {
        it("should include goal and tool descriptions", () => {
            const prompt = PromptBuilder.buildSystemInstructions(
                "Find all jobs",
                "list_jobs: List all jobs",
                "You are an assistant"
            );

            expect(prompt).toContain("Find all jobs");
            expect(prompt).toContain("list_jobs: List all jobs");
            expect(prompt).toContain("You are an assistant");
        });

        it("should include distilled summary if provided", () => {
            const prompt = PromptBuilder.buildSystemInstructions(
                "Goal", "tools", "identity", undefined, undefined, undefined,
                "Previously: Found 3 jobs"
            );
            expect(prompt).toContain("Previously: Found 3 jobs");
        });

        it("should include strategic manifest if provided", () => {
            const manifestation: any = {
                strategy: "Step-by-step",
                steps: [{ description: "Search", tool: "search_tool" }]
            };
            const prompt = PromptBuilder.buildSystemInstructions(
                "Goal", "tools", "identity", undefined, undefined, undefined, undefined,
                manifestation
            );
            expect(prompt).toContain("STRATEGIC MANIFEST");
            expect(prompt).toContain("Step-by-step");
            expect(prompt).toContain("Search (using search_tool)");
        });
    });

    describe("buildTurnPrompt", () => {
        it("should include task history", () => {
            const history: any[] = [
                { type: "thought", content: "I should search" },
                { type: "observation", content: "Found something" }
            ];
            const prompt = PromptBuilder.buildTurnPrompt("My goal", history, 2, { organizationId: 1, userId: "system" } as any);

            expect(prompt).toContain("THOUGHT: I should search");
            expect(prompt).toContain("OBSERVATION: Found something");
        });

        it("should include user question on first iteration", () => {
            const prompt = PromptBuilder.buildTurnPrompt("First Goal", [], 1, { organizationId: 1, userId: "system" } as any);
            expect(prompt).toContain("USER QUESTION");
            expect(prompt).toContain("First Goal");
        });

        it("should suggest final answer if last history is an observation", () => {
            const history: any[] = [{ type: "observation", content: "Result" }];
            const prompt = PromptBuilder.buildTurnPrompt("Goal", history, 2, { organizationId: 1, userId: "system" } as any);
            expect(prompt).toMatch(/final_answer|provide a final_answer/i);
        });
    });
});
