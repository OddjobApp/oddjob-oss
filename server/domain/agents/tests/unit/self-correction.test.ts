import { describe, it, expect, vi, beforeEach } from "vitest";
import { SelfCorrectionService } from "../../core/self-correction.service.js";

// Mock AIClientFactory
vi.mock("../../../ai/core/ai-client.service.js", () => {
    return {
        AIClientFactory: {
            getClient: vi.fn().mockReturnValue({
                execute: vi.fn().mockImplementation(async (config: any) => {
                    const sysPrompt = config.systemPrompt;
                    if (sysPrompt.includes("failed_tool")) {
                        return {
                            success: true,
                            output: JSON.stringify({ fixedParam: "correctedValue" })
                        };
                    }
                    if (sysPrompt.includes("unfixable_tool")) {
                        return {
                            success: true,
                            output: "null"
                        };
                    }
                    return {
                        success: false,
                        error: "Mock error"
                    };
                })
            })
        }
    };
});

describe("SelfCorrectionService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("should successfully correct parameters for a failed tool", async () => {
        const result = await SelfCorrectionService.correct(
            "mock-api-key",
            "failed_tool",
            { failedParam: "wrongValue" },
            "Error: Parameter wrongValue is invalid",
            "Fix the parameters"
        );

        expect(result).toEqual({ fixedParam: "correctedValue" });
    });

    it("should return null if the correction model returns null", async () => {
        const result = await SelfCorrectionService.correct(
            "mock-api-key",
            "unfixable_tool",
            { failedParam: "wrongValue" },
            "Error: Completely broken",
            "Fix the parameters"
        );

        expect(result).toBeNull();
    });

    it("should return null if the AI client call fails", async () => {
        const result = await SelfCorrectionService.correct(
            "mock-api-key",
            "failing_api_tool",
            { failedParam: "wrongValue" },
            "Error: Network issue",
            "Fix the parameters"
        );

        expect(result).toBeNull();
    });
});
