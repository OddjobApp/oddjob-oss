import { describe, it, expect, vi, beforeEach } from 'vitest';
import { missionAnalystService } from "@domain/mission/core/mission-analyst.service.js";
import { db } from '@server/database_service.js';
import { AIClientFactory } from '@domain/ai/core/ai-client.service.js';
import { systemAiService } from "@domain/ai/core/system-ai.service.js";
import {
    missionRuns, pipelineSteps, pipelineExecutions, pipelineStepExecutions,
    pipelines, jobs, missions
} from "@shared/schema/index.js";
import { eq, inArray, like } from "drizzle-orm";

vi.mock('@server/database_service.js', () => ({
    db: {
        select: vi.fn(),
        insert: vi.fn(),
    }
}));

vi.mock('@domain/ai/core/ai-client.service.js', () => ({
    AIClientFactory: {
        getClient: vi.fn()
    }
}));

vi.mock("@domain/ai/core/system-ai.service.js", () => ({
    systemAiService: {
        getAiConfig: vi.fn()
    }
}));

import { createLogger } from '@server/utils/logger.js';
vi.mock('@server/utils/logger.js', () => ({
    createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() })
}));

describe('MissionAnalystService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should generate a retrospective successfully', async () => {
        // Mock the mission run
        const mockRun = {
            id: 1,
            name: "Test Mission",
            status: "completed",
            missionContext: { some: "data" }
        };

        const selectMock = {
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockResolvedValue([mockRun])
        };
        (db.select as any).mockReturnValue(selectMock);

        // Mock AI Client
        (systemAiService.getAiConfig as any).mockResolvedValue({
            provider: "google",
            model: "gemini-1.5-pro",
            apiKey: "test-key"
        });

        const mockAiClient = {
            execute: vi.fn().mockResolvedValue({
                success: true,
                output: JSON.stringify({
                    successScore: 90,
                    budgetEfficiency: 0.95,
                    timeEfficiency: 0.8,
                    anomaliesEncountered: ["Brief network hiccup"],
                    learnedContext: [{ pattern: "retry logic", heuristic: "always use backoff" }]
                })
            })
        };
        (AIClientFactory.getClient as any).mockReturnValue(mockAiClient);

        // Mock DB Insert
        const insertedRetro = { id: 42 };
        const insertMock = {
            values: vi.fn().mockReturnThis(),
            returning: vi.fn().mockResolvedValue([insertedRetro])
        };
        (db.insert as any).mockReturnValue(insertMock);

        const result = await missionAnalystService.generateRetrospective(1);

        expect(result.success).toBe(true);
        expect(result.retrospectiveId).toBe(42);

        expect(insertMock.values).toHaveBeenCalledWith(expect.objectContaining({
            missionRunId: 1,
            successScore: 90,
            budgetEfficiency: "0.95",
            timeEfficiency: "0.8",
            analyzedBy: "mission-analyst-agent"
        }));
    });

    it('should skip generating retrospective if mission is not finished', async () => {
        // Mock the mission run (active)
        const mockRun = {
            id: 2,
            name: "Active Mission",
            status: "active",
        };

        const selectMock = {
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockResolvedValue([mockRun])
        };
        (db.select as any).mockReturnValue(selectMock);

        const result = await missionAnalystService.generateRetrospective(2);

        expect(result.success).toBe(false);
        expect(result.reason).toBe("Run not finished");
    });
});
