/**
 * AIHealingService Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@domain/ai/core/ai-config-resolver.js", () => ({
    aiConfigResolver: {
        resolveSystemConfig: vi.fn()
    }
}));

vi.mock("@domain/ai/core/ai-client.service.js", () => ({
    AIClientFactory: {
        getClient: vi.fn()
    }
}));

vi.mock("@server/utils/logger.js", () => ({
    createLogger: vi.fn().mockReturnValue({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
    })
}));

import { AIHealingService } from "@domain/ai/core/ai-healing.service.js";
import { aiConfigResolver } from "@domain/ai/core/ai-config-resolver.js";
import { AIClientFactory } from "@domain/ai/core/ai-client.service.js";

describe("AIHealingService", () => {
    let service: AIHealingService;
    let mockExecute: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.clearAllMocks();

        mockExecute = vi.fn();
        (AIClientFactory.getClient as any).mockReturnValue({ execute: mockExecute });
        (aiConfigResolver.resolveSystemConfig as any).mockResolvedValue({
            provider: "openai",
            model: "gpt-4o-mini",
            credentialId: 1,
            apiKey: "test-key"
        });

        service = new AIHealingService();
    });

    it("should return healed selector when AI provides a valid one", async () => {
        mockExecute.mockResolvedValue({ success: true, output: "#new-login-button" });

        const result = await service.healSelector(
            "#old-login-btn",
            "<html><button id='new-login-button'>Login</button></html>",
            "Element not found"
        );

        expect(result).toBe("#new-login-button");
    });

    it("should return null when AI responds with 'NULL'", async () => {
        mockExecute.mockResolvedValue({ success: true, output: "NULL" });
        const result = await service.healSelector("#x", "<html/>", "err");
        expect(result).toBeNull();
    });

    it("should return null when AI response is too short (< 2 chars)", async () => {
        mockExecute.mockResolvedValue({ success: true, output: "a" });
        const result = await service.healSelector("#x", "<html/>", "err");
        expect(result).toBeNull();
    });

    it("should return null when AI call is unsuccessful", async () => {
        mockExecute.mockResolvedValue({ success: false, output: null, error: "API error" });
        const result = await service.healSelector("#x", "<html/>", "err");
        expect(result).toBeNull();
    });

    it("should return null when no AI config is available", async () => {
        (aiConfigResolver.resolveSystemConfig as any).mockResolvedValueOnce(null);
        const result = await service.healSelector("#x", "<html/>", "err");
        expect(result).toBeNull();
        expect(mockExecute).not.toHaveBeenCalled();
    });

    it("should return null and not throw on network errors", async () => {
        mockExecute.mockRejectedValue(new Error("Network timeout"));
        const result = await service.healSelector("#x", "<html/>", "err");
        expect(result).toBeNull();
    });

    it("should truncate very large HTML to ~20k chars before sending", async () => {
        mockExecute.mockResolvedValue({ success: true, output: ".found" });
        const largeHtml = "a".repeat(50000);
        await service.healSelector("#x", largeHtml, "err");
        const callArgs = mockExecute.mock.calls[0][0];
        expect(callArgs.userPrompt.length).toBeLessThan(40000);
    });

    it("should include broken selector and error context in the prompt", async () => {
        mockExecute.mockResolvedValue({ success: true, output: ".valid" });
        await service.healSelector("#my-broken-selector", "<html/>", "Element timed out");
        const prompt = mockExecute.mock.calls[0][0].userPrompt;
        expect(prompt).toContain("#my-broken-selector");
        expect(prompt).toContain("Element timed out");
    });
});
