/**
 * CriticService Unit Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@server/database_service.js", () => ({
    db: {
        insert: vi.fn()
    }
}));

vi.mock("@shared/schema/index.js", () => ({
    agentCritiques: {}
}));

vi.mock("@shared/schema/agent/critiques.js", () => ({
    agentCritiques: {}
}));

vi.mock("@domain/ai/core/ai-client.service.js", () => ({
    AIClientFactory: {
        getClient: vi.fn()
    }
}));

import { CriticService } from "@domain/agents/core/critic-service.js";
import { db } from "@server/database_service.js";
import { AIClientFactory } from "@domain/ai/core/ai-client.service.js";

describe("CriticService", () => {
    let service: CriticService;
    let mockExecute: ReturnType<typeof vi.fn>;
    let mockInsert: ReturnType<typeof vi.fn>;
    const savedKey = process.env.GEMINI_API_KEY;

    beforeEach(() => {
        vi.clearAllMocks();
        process.env.GEMINI_API_KEY = "test-gemini-key";

        mockExecute = vi.fn();
        (AIClientFactory.getClient as any).mockReturnValue({ execute: mockExecute });

        mockInsert = vi.fn().mockReturnValue({
            values: vi.fn().mockResolvedValue(undefined)
        });
        (db.insert as any).mockImplementation(mockInsert);

        // Always create service AFTER mocks are set up
        service = new CriticService();
    });

    afterEach(() => {
        if (savedKey !== undefined) {
            process.env.GEMINI_API_KEY = savedKey;
        } else {
            delete process.env.GEMINI_API_KEY;
        }
    });

    it("should skip assessment when GEMINI_API_KEY is missing", async () => {
        delete process.env.GEMINI_API_KEY;
        const result = await service.assessInteraction(1, "Who is the president?", "Obama");
        expect(result).toBeUndefined();
        expect(mockExecute).not.toHaveBeenCalled();
    });

    it("should call AI client and insert a critique on success", async () => {
        mockExecute.mockResolvedValue({
            success: true,
            output: JSON.stringify({ score: 8, criticism: "Good", issues: ["Perfect"] })
        });

        await service.assessInteraction(42, "Who?", "Biden");

        expect(mockExecute).toHaveBeenCalledOnce();
        expect(mockInsert).toHaveBeenCalledOnce();
    });

    it("should not insert when AI call fails", async () => {
        mockExecute.mockResolvedValue({ success: false, output: null, error: "err" });
        await service.assessInteraction(99, "Query", "Response");
        expect(mockInsert).not.toHaveBeenCalled();
    });

    it("should not throw and not insert when AI responds with invalid JSON", async () => {
        mockExecute.mockResolvedValue({ success: true, output: "not-json" });
        await expect(service.assessInteraction(1, "q", "a")).resolves.toBeFalsy();
        expect(mockInsert).not.toHaveBeenCalled();
    });

    it("should include retrievedContext in the AI prompt when provided", async () => {
        mockExecute.mockResolvedValue({
            success: true,
            output: JSON.stringify({ score: 9, criticism: "Great", issues: ["Perfect"] })
        });

        await service.assessInteraction(1, "q", "a", "Some retrieved context");

        const prompt = mockExecute.mock.calls[0][0].userPrompt;
        expect(prompt).toContain("Context Used");
        expect(prompt).toContain("Some retrieved context");
    });

    it("should return empty array from getRelevantCritiques", async () => {
        const result = await service.getRelevantCritiques("any query");
        expect(result).toEqual([]);
    });
});
