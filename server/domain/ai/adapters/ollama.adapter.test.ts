import { describe, it, expect } from "vitest";
import { extractReasoningTokens } from "./ollama.adapter.js";

describe("OllamaAdapter & Reasoning Token Extraction", () => {
    it("should extract <thinking> tags and return clean content", () => {
        const raw = "<thinking>\nStep 1: Check database schema\nStep 2: Return query\n</thinking>\nSELECT * FROM active_rescues WHERE status = 'Waiting';";
        const result = extractReasoningTokens(raw);

        expect(result.thinking).toContain("Step 1: Check database schema");
        expect(result.cleanContent).toBe("SELECT * FROM active_rescues WHERE status = 'Waiting';");
    });

    it("should extract <plan> tags", () => {
        const raw = "<plan>\n1. Ingest incident telemetry\n2. Dispatch Alpha Squad\n</plan>\nDeployment initiated successfully.";
        const result = extractReasoningTokens(raw);

        expect(result.plan).toContain("Dispatch Alpha Squad");
        expect(result.cleanContent).toBe("Deployment initiated successfully.");
    });

    it("should handle content without reasoning tags cleanly", () => {
        const raw = "Standard completion without explicit reasoning markers.";
        const result = extractReasoningTokens(raw);

        expect(result.thinking).toBeUndefined();
        expect(result.plan).toBeUndefined();
        expect(result.cleanContent).toBe(raw);
    });
});
