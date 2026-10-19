import { describe, it, expect, beforeEach } from "vitest";
import { mockLLMAdapter, mockLLMRegistry } from "./mock-llm.adapter.js";

describe("MockLLMAdapter", () => {
    beforeEach(() => {
        // Reset or test preset rules
    });

    it("should match default triage rules", async () => {
        // mockLLMAdapter is typed as LLMAdapter, whose complete() takes (request,
        // model, provider); the mock's own defaults are not visible through the
        // interface, so the model/provider args are supplied here.
        const res = await mockLLMAdapter.complete({
            messages: [{ role: "user", content: "Please run triage anomaly detection on sector 7." }]
        }, {}, {});

        expect(res.provider).toBe("mock");
        const parsed = JSON.parse(res.content);
        expect(parsed.status).toBe("TRIAGED");
        expect(parsed.recommendedAction).toBe("DEPLOY_SQUAD");
    });

    it("should allow dynamic rule registration", async () => {
        mockLLMRegistry.registerRule({
            pattern: "custom-token-123",
            response: "MOCK_CUSTOM_SUCCESS"
        });

        const res = await mockLLMAdapter.complete({
            messages: [{ role: "user", content: "Testing with custom-token-123 now." }]
        }, {}, {});

        expect(res.content).toBe("MOCK_CUSTOM_SUCCESS");
    });

    it("should support streaming chunks", async () => {
        const chunks: string[] = [];
        await mockLLMAdapter.stream?.(
            { messages: [{ role: "user", content: "address serial verification" }] },
            {},
            {},
            (chunk) => chunks.push(chunk)
        );

        expect(chunks.length).toBeGreaterThan(0);
        expect(chunks.join("")).toContain("GEN-8842-X");
    });
});
