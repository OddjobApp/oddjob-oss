// ============================================================================
// PREDICTION INTELLIGENCE DOMAIN — HERMES INTEGRATION TEST
// Verifies that predictions can be injected into agent prompts (Hermes protocol).
// ============================================================================

import { describe, it, expect } from "vitest";
import { PromptBuilder } from "../../agents/core/prompt-builder.js";
import { randomUUID } from "crypto";

describe("Hermes Prediction Integration", () => {
    it("should inject prediction explanation into agent system prompt", async () => {
        const predictionExplanation = "The engine predicts 'user_will_bounce' with 85% confidence based on high field entropy.";

        const systemPrompt = PromptBuilder.buildSystemInstructions(
            "Analyze user behavior", // goal
            "Tool descriptions", // toolDescriptions
            "You are a helpful assistant", // identityMsg
            "", // customPrompt
            "", // sharedMemories
            `## PREDICTION INTELLIGENCE CONTEXT\n${predictionExplanation}\n`, // additionalContext
            "", // distilledSummary
            undefined, // manifestation
            100, // remainingBudgetUsd
            "hermes_xml" // reasoningProtocol
        );

        expect(systemPrompt).toBeDefined();
        expect(systemPrompt).toContain("PREDICTION INTELLIGENCE CONTEXT");
        expect(systemPrompt).toContain("user_will_bounce");
        expect(systemPrompt).toContain("85% confidence");

        console.log("[Hermes Test] Successfully verified prediction injection into prompt!");
    });
});
