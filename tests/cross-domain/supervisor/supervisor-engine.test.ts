
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SupervisorEngine } from "../../../server/domain/integrations/core/supervisor/supervisor-engine";
import { SupervisorPlan, SupervisorState } from "@shared/schema/supervisor";
import { TaskStateManager } from "../../../server/domain/integrations/core/supervisor/task-state-manager";

describe("SupervisorEngine Triage Logic", () => {
    let engine: SupervisorEngine;
    let mockDb: any;

    beforeEach(() => {
        // syncStatuses awaits `.where(...)` directly — it fetches every
        // execution by id, it does not limit — so a double that only resolved
        // at `.limit()` handed the builder back and `executions.map` was not a
        // function. This one is thenable at any stop point, with the rows for
        // each query queued in call order.
        const queued: unknown[][] = [];
        mockDb = {
            queue: (...results: unknown[][]) => queued.push(...results),
            select: vi.fn().mockReturnThis(),
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            orderBy: vi.fn().mockReturnThis(),
            then: (resolve: any, reject: any) =>
                Promise.resolve(queued.shift() ?? []).then(resolve, reject),
        };
        engine = new SupervisorEngine({ db: mockDb, parentExecutionId: 1 });
    });

    describe("evaluateState", () => {
        it("should return TRIAGING if a task failed and triage is needed", () => {
            const plan: SupervisorPlan = {
                intent: "test",
                tasks: [
                    { id: "1", name: "task", description: "desc", status: "rejected", dependencies: [], isCritical: true }
                ],
                autoRescueEnabled: true,
                history: [],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                version: 1,
                estimatedCostUSD: 0,
                replanCount: 0
            };

            expect(engine.evaluateState(plan)).toBe(SupervisorState.TRIAGING);
        });

        it("should return REPLANNING if triage result is already present", () => {
            const plan: SupervisorPlan = {
                intent: "test",
                tasks: [
                    { 
                        id: "1", name: "task", description: "desc", status: "rejected", dependencies: [], isCritical: true,
                        lastTriageResult: { recommendation: "replan", action: "replan", timestamp: new Date().toISOString() }
                    }
                ],
                autoRescueEnabled: true,
                history: [],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                version: 1,
                estimatedCostUSD: 0,
                replanCount: 0
            };

            expect(engine.evaluateState(plan)).toBe(SupervisorState.REPLANNING);
        });
    });

    describe("syncStatuses with Triage", () => {
        it("should transition failed task to rejected for triage when retries exhausted", async () => {
            const plan: SupervisorPlan = {
                intent: "test",
                tasks: [
                    { id: "1", name: "task", description: "desc", status: "in_progress", dependencies: [], childExecutionId: 123, retryCount: 3, isCritical: false }
                ],
                autoRescueEnabled: true,
                history: [],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                version: 1,
                estimatedCostUSD: 0,
                replanCount: 0
            };

            mockDb.queue([{ id: 123, status: "failed", error: "Too many retries" }]);

            const mods = await engine.syncStatuses(plan, "test");
            expect(mods).toBe(1);
            expect(plan.tasks[0].status).toBe("rejected");
            expect(engine.evaluateState(plan)).toBe(SupervisorState.TRIAGING);
        });
    });
});
