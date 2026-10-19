import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";

// Mock database
const createMockQuery = (result: any = []) => ({
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockReturnValue(Promise.resolve(result)),
    then: vi.fn(onFulfilled => Promise.resolve(result).then(onFulfilled))
});

vi.mock("@server/database_service.js", () => ({
    db: {
        select: vi.fn(() => createMockQuery()),
        insert: vi.fn(() => createMockQuery())
    }
}));

import { videoFeedbackService } from "../../server/domain/media/video-feedback-service.js";
import { db } from "@server/database_service.js";

describe("VideoFeedbackService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("should record a critique", async () => {
        const mockCritique = { videoId: "v1", rating: 1 };
        (db.insert as Mock).mockReturnValue(createMockQuery([mockCritique]));

        await videoFeedbackService.recordCritique({
            videoId: "v1",
            rating: 1,
            organizationId: 1,
            createdBy: "user1"
        });

        expect(db.insert).toHaveBeenCalled();
    });

    it("should generate prompt instructions from past feedback", async () => {
        const mockFeedbacks = [
            { videoId: "v1", rating: 1, feedback: "Good", topic: "React" },
            { videoId: "v2", rating: -1, feedback: "Bad", topic: "React" }
        ];
        (db.select as Mock).mockReturnValue(createMockQuery(mockFeedbacks));

        const instructions = await videoFeedbackService.getPromptInstructions("React", 1);

        expect(instructions).toContain("Video v1");
        expect(instructions).toContain("Video v2");
        expect(instructions).toContain("RECOMMENDED");
        expect(instructions).toContain("AVOIDANCE");
    });
});
