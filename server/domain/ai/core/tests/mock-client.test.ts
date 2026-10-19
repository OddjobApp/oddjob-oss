import { describe, it, expect } from "vitest";
import { MockAIClient } from "../providers/mock-client.js";

describe("MockAIClient", () => {
    it("should respond to greetings when passed in messages array with system context", async () => {
        const client = new MockAIClient();
        const response = await client.execute(
            {
                messages: [
                    { role: "system", content: "[SYNTHETIC USER PERSONA & STEERING DIRECTIVES]\nUser Archetype: Data Sentinel" },
                    { role: "user", content: "Hi" }
                ]
            } as any,
            undefined,
            "mock-key"
        );

        expect(response.success).toBe(true);
        expect(response.output).toContain("Hello! I am the Oddjob Copilot.");
        expect(response.output).not.toContain("private PIN");
    });

    it("should process user queries directly without requiring PIN verification", async () => {
        const client = new MockAIClient();
        const response = await client.execute(
            {
                messages: [
                    { role: "system", content: "System context" },
                    { role: "user", content: "Inspect project resources" }
                ]
            } as any,
            undefined,
            "mock-key"
        );

        expect(response.success).toBe(true);
        expect(response.output).toContain("processed your request");
        expect(response.output).not.toContain("private PIN");
    });
});
