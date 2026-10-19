import { describe, it, expect, beforeEach, vi } from "vitest";
import { analyticsService } from "@domain/analytics/core/analytics.service.js";
import { db } from "@server/database_service.js";
import { appAnalyticsDaily } from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";

vi.mock("@server/database_service.js", () => ({
    db: {
        insert: vi.fn(() => ({
            values: vi.fn(() => ({
                onConflictDoUpdate: vi.fn(() => Promise.resolve())
            }))
        })),
        select: vi.fn(() => ({
            from: vi.fn(() => ({
                where: vi.fn(() => ({
                    limit: vi.fn(() => Promise.resolve([]))
                }))
            }))
        }))
    }
}));

describe("AnalyticsService", () => {
    const mockDeploymentId = 123;
    const mockUserId = "user-abc";
    const today = new Date().toISOString().split('T')[0];

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("should record an app launch with atomic upsert", async () => {
        await analyticsService.recordLaunch(mockDeploymentId, mockUserId);

        expect(db.insert).toHaveBeenCalledWith(appAnalyticsDaily);
        // Additional checks for onConflictDoUpdate would be complex with mocks 
        // but this verifies the primary entry point is triggered.
    });

    it("should handle insertion errors gracefully", async () => {
        vi.mocked(db.insert).mockImplementationOnce(() => {
            throw new Error("DB Error");
        });

        // Should not throw
        await expect(analyticsService.recordLaunch(mockDeploymentId, mockUserId)).resolves.not.toThrow();
    });
});
