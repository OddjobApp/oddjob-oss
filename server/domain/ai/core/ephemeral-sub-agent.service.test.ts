import { describe, it, expect, beforeEach } from "vitest";
import { ephemeralSubAgent } from "./ephemeral-sub-agent.service.js";
import { mockLLMRegistry } from "../adapters/mock-llm.adapter.js";

describe("EphemeralSubAgentService", () => {
    beforeEach(() => {
        process.env.LLM_PROVIDER = "mock";
    });

    it("should execute ephemeral json_repair tasks quickly", async () => {
        mockLLMRegistry.registerRule({
            pattern: /json repair/i,
            response: '{"repaired": true, "key": "value"}'
        });

        const result = await ephemeralSubAgent.execute({
            taskType: "json_repair",
            input: "{ key: value, invalid json"
        });

        expect(result.success).toBe(true);
        expect(result.data).toEqual({ repaired: true, key: "value" });
        expect(result.subAgentId).toContain("ephemeral-agent-");
    });

    it("should handle timeout constraints gracefully", async () => {
        const result = await ephemeralSubAgent.execute({
            taskType: "custom_transform",
            input: "Test input",
            timeoutMs: 5000
        });

        expect(result.success).toBe(true);
        expect(result.durationMs).toBeLessThan(5000);
    });
});
