/**
 * Janitor Service Unit Tests
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { JanitorService } from "@domain/core/infrastructure/janitor.service.js";

describe("JanitorService", () => {
    const mockClient = {
        execute: vi.fn(),
    };
    const apiKey = "test-key";
    let service: JanitorService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new JanitorService(mockClient as any, apiKey);
    });

    it("should distill history into a summary", async () => {
        mockClient.execute.mockResolvedValue({
            success: true,
            output: "Summary: The user wants to know about jobs."
        });

        const history = [{ type: "thought", content: "searching..." }];
        const summary = await service.distill(history, "Get job count");

        expect(summary).toContain("Summary");
        expect(mockClient.execute).toHaveBeenCalled();
        const callArgs = mockClient.execute.mock.calls[0][0];
        expect(callArgs.userPrompt).toContain("HISTORY TO DISTILL");
    });

    it("should return error message if distillation fails", async () => {
        mockClient.execute.mockResolvedValue({ success: false, error: "AI Error" });
        const summary = await service.distill([], "Goal");
        expect(summary).toContain("Error during distillation");
    });
});
