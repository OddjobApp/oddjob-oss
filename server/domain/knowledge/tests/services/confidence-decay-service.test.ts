import { describe, it, expect, vi, beforeEach } from 'vitest';
import { confidenceDecayService } from "@domain/knowledge/core/confidence-decay.service.js";
import { db } from '@server/database_service.js';

vi.mock('@server/database_service.js', () => ({
    db: {
        select: vi.fn(),
        update: vi.fn(),
    }
}));

import { createLogger } from '@server/utils/logger.js';
vi.mock('@server/utils/logger.js', () => ({
    createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() })
}));

describe('ConfidenceDecayService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should apply decay correctly based on elapsed days', async () => {
        // Mock the current date
        const now = new Date('2026-03-05T00:00:00Z');
        vi.useFakeTimers();
        vi.setSystemTime(now);

        // 10 days ago
        const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);

        const mockNodes = [
            {
                id: 1,
                initialConfidenceScore: "1.00",
                lastReaffirmedAt: tenDaysAgo,
                verifiedAt: tenDaysAgo,
                createdAt: tenDaysAgo,
            }
        ];

        const selectMock = {
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockResolvedValue(mockNodes)
        };
        (db.select as any).mockReturnValue(selectMock);

        const updateSetMock = {
            where: vi.fn().mockResolvedValue({ id: 1 })
        };
        const updateMock = {
            set: vi.fn().mockReturnValue(updateSetMock)
        };
        (db.update as any).mockReturnValue(updateMock);

        const result = await confidenceDecayService.applyDecay();

        expect(result.success).toBe(true);
        expect(result.updatedCount).toBe(1);

        // 1.0 * e^(-0.01 * 10) = e^(-0.1) ≈ 0.9048 -> toFixed(2) = 0.90
        expect(updateMock.set).toHaveBeenCalledWith({ confidenceScore: "0.9" });

        vi.useRealTimers();
    });

    it('should reaffirm a node by resetting score to initial and updating timestamp', async () => {
        const mockNodeResult = [{
            initialScore: "0.85",
            currentScore: "0.50"
        }];

        const selectMock = {
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockResolvedValue(mockNodeResult)
        };
        (db.select as any).mockReturnValue(selectMock);

        const updateSetMock = {
            where: vi.fn().mockResolvedValue({ id: 2 })
        };
        const updateMock = {
            set: vi.fn().mockReturnValue(updateSetMock)
        };
        (db.update as any).mockReturnValue(updateMock);

        const result = await confidenceDecayService.reaffirmNode(2, "user_123");

        expect(result.success).toBe(true);
        expect(result.restoredScore).toBe("0.85");
        expect(updateMock.set).toHaveBeenCalledWith(expect.objectContaining({
            confidenceScore: "0.85",
            verifiedBy: "user_123"
        }));
    });
});
