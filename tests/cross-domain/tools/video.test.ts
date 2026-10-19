import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";

// Mock dependencies
const { mockSearchUnified, mockGetPromptInstructions } = vi.hoisted(() => ({
    mockSearchUnified: vi.fn(),
    mockGetPromptInstructions: vi.fn()
}));

vi.mock("@domain/knowledge/knowledge.service.js", () => ({
    knowledgeService: {
        searchUnified: (...args: any[]) => mockSearchUnified(...args)
    }
}));

vi.mock("@domain/media/video-feedback-service.js", () => ({
    videoFeedbackService: {
        getPromptInstructions: (...args: any[]) => mockGetPromptInstructions(...args)
    }
}));

import { VIDEO_TOOLS } from "../../../server/domain/tools/v1/capabilities/video.js";

describe("search_videos tool", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("should search for videos and include feedback context", async () => {
        const tool = VIDEO_TOOLS.search_videos;

        mockSearchUnified.mockResolvedValue([
            {
                id: 1,
                title: "Intro to React",
                content: "React is a framework...",
                matchScore: 0.9,
                sourceType: "youtube",
                metadata: { videoId: "react101" }
            }
        ]);

        mockGetPromptInstructions.mockResolvedValue("TRAINING CONTEXT: Avoid video XYZ.");

        const result = await tool.execute({ query: "React intro" }, { organizationId: 1 } as any);

        expect(result).toContain("Intro to React");
        expect(result).toContain("react101");
        expect(result).toContain("TRAINING CONTEXT");
        expect(mockSearchUnified).toHaveBeenCalledWith(
            "React intro",
            expect.objectContaining({ organizationId: 1 }),
            expect.objectContaining({ limit: 5 })
        );
    });

    it("should handle no results gracefully", async () => {
        const tool = VIDEO_TOOLS.search_videos;
        mockSearchUnified.mockResolvedValue([]);

        const result = await tool.execute({ query: "Unknown" }, { organizationId: 1 } as any);

        expect(result).toContain("No relevant video clips found");
    });
});
