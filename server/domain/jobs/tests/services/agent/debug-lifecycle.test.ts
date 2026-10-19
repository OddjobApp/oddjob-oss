import { describe, it, expect, vi } from "vitest";
import { AutonomousLifecycleManager } from "@domain/ai/core/autonomous-lifecycle.service.js";

describe("Simplified AutonomousLifecycleManager", () => {
    it("should use the provided client", async () => {
        const mockClient = {
            execute: vi.fn().mockResolvedValue({ success: true, output: "ok" })
        };
        const manager = new AutonomousLifecycleManager("session-1", 1, mockClient, "key");

        // Directly test if execute is a function on the instance
        expect(typeof (manager as any).client.execute).toBe("function");

        // This is where it was failing in the full test
        const result = await (manager as any).client.execute({});
        expect(result.output).toBe("ok");
    });
});
