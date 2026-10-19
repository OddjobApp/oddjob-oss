import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";

// 1. Hoisted Mocks
vi.mock("@server/database_service.js", () => {
    const mockQuery = {
        from: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        execute: vi.fn().mockResolvedValue([]),
        then: vi.fn(function(this: any, onFulfilled) {
            return Promise.resolve(this._results || []).then(onFulfilled);
        }),
        _results: [] as any[]
    };
    return {
        db: {
            select: vi.fn(() => mockQuery),
            insert: vi.fn(() => mockQuery),
            update: vi.fn(() => mockQuery),
            delete: vi.fn(() => mockQuery),
            execute: vi.fn().mockResolvedValue([]),
            transaction: vi.fn((cb) => cb({ select: vi.fn(() => mockQuery) })),
        },
        pool: { connect: vi.fn(), end: vi.fn() }
    };
});

vi.mock("@server/database_service.js", () => {
    const mockQuery = {
        from: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        execute: vi.fn().mockResolvedValue([]),
        then: vi.fn((onFulfilled) => Promise.resolve([]).then(onFulfilled)),
    };
    return {
        db: { select: vi.fn(() => mockQuery) },
        pool: { connect: vi.fn(), end: vi.fn() }
    };
});

vi.mock("@server/domain/core/infrastructure/event-stream.service.js", () => ({
    eventStream: { 
        publish: vi.fn(), 
        emit: vi.fn(), 
        on: vi.fn() 
    }
}));

vi.mock("@domain/mission/core/mission-query.service.js", () => ({
    missionQueryService: { getMissionDetail: vi.fn(), getById: vi.fn() }
}));

vi.mock("@domain/apps/app-registry.service.js", () => ({
    appRegistryService: { findDeploymentBySlug: vi.fn() }
}));

vi.mock("@domain/billing/payout.service.js", () => ({
    payoutService: { recordAppLaunchPayout: vi.fn() }
}));

vi.mock("@domain/mission/core/mission-run.service.js", () => ({
    missionRunService: { create: vi.fn(), getById: vi.fn(), update: vi.fn(), list: vi.fn() }
}));

vi.mock("@domain/pipeline/core/pipeline.service.js", () => ({
    pipelineService: { getSystem: vi.fn(), listSteps: vi.fn() }
}));

vi.mock("@server/core/pipeline-executor.js", () => ({
    pipelineExecutor: { executePipeline: vi.fn().mockResolvedValue({ success: true, executionId: 1000 }) }
}));

// 2. Regular Imports
import { missionService } from "@server/domain/mission/core/mission.service.js";
import { db } from "@server/database_service.js";
import { appRegistryService } from "@domain/apps/app-registry.service.js";
import { missionRunService } from "@domain/mission/core/mission-run.service.js";
import { eventStream } from "@server/domain/core/infrastructure/event-stream.service.js";
import { POD_EVENTS } from "@server/domain/core/infrastructure/pod-events.contract.js";
import { missionQueryService } from "@domain/mission/core/mission-query.service.js";

describe("Mission Billing Integration", () => {
    const testOrgId = 10;
    const testUserId = "u1";

    beforeEach(async () => {
        vi.clearAllMocks();
        
        vi.mocked(missionQueryService.getMissionDetail).mockResolvedValue({
            id: 1,
            name: "Test Mission",
            objective: "Test Objective",
            executionStrategy: "dynamic_autonomous", // Required for billing guard routing
            blackboard: { viaAppSlug: "test-app" },
            organizationId: testOrgId
        } as any);

        vi.mocked(appRegistryService.findDeploymentBySlug).mockResolvedValue({
            app: { id: 1, pricePerLaunchUsd: "5.00" },
            deployment: { id: 1 }
        } as any);
    });

    it("should fail mission launch if subscription is canceled and app is paid", async () => {
        // Prepare mock results for the sequence in dynamicOrchestrator:
        // 1. Get mission: [mission] (Handled by db.select in the service)
        // 2. Get org: [org]
        const mockResults = [
            [{ id: 1, executionStrategy: "dynamic_autonomous", blackboard: { viaAppSlug: "test-app" }, objective: "Test" }], // mission fetch
            [{ id: testOrgId, subscriptionStatus: "canceled" }] // org fetch
        ];
        
        let callCount = 0;
        vi.mocked(db.select).mockImplementation(() => {
            const query = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
                then: (onFulfilled: any) => Promise.resolve(mockResults[callCount++] || []).then(onFulfilled)
            } as any;
            return query;
        });

        const result = await missionService.launchMission(1, testUserId, testOrgId);

        expect(result.success).toBe(false);
        expect(result.error).toContain("requires an active subscription");
    });

    it("should publish mission_run_completed event on webhook trigger", async () => {
        vi.mocked(missionRunService.getById).mockResolvedValue({
            id: 100, status: "completed", missionContext: {}
        } as any);

        await missionService.triggerAppWebhook(100, "test-app", testOrgId);

        expect(eventStream.publish).toHaveBeenCalledWith(
            POD_EVENTS.MISSION.RUN_COMPLETED,
            expect.objectContaining({
                missionRunId: 100,
                appSlug: "test-app",
                organizationId: testOrgId
            }),
            expect.any(Object),
            expect.any(String)
        );
    });
});
