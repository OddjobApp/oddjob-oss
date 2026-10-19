import { describe, expect, it } from "vitest";
import {
    isExplicitExternalResearchRequest,
    isFactualLookupRequest,
} from "./crew-orchestrator.service.js";

describe("crew research routing", () => {
    it.each([
        "Visit the Orange County Assessor's Office website",
        "Navigate to the Orange County Assessor's Office website",
        "Can you figure out how to find an aggregator of this information?",
        "Read https://example.com/property-records",
        "Why aren't you using Google?",
        "Use your web search tool",
        "Have Gemini provide its answer",
        "Research this using external sources",
    ])("recognizes an explicit external research request: %s", (message) => {
        expect(isExplicitExternalResearchRequest(message)).toBe(true);
    });

    it("does not misclassify ordinary product work as external research", () => {
        expect(isExplicitExternalResearchRequest("Build the report surface")).toBe(false);
    });

    it.each([
        "What is a world model?",
        "Teach me how Oddjob uses world models",
        "Explain the assembly stack",
    ])("routes a direct factual question to one answerer: %s", (message) => {
        expect(isFactualLookupRequest(message)).toBe(true);
    });

    it("keeps build requests in multi-agent discussion mode", () => {
        expect(isFactualLookupRequest("How should we design and build this app?")).toBe(false);
    });
});
