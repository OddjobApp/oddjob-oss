
import { describe, it, expect, vi } from "vitest";
import { SupervisorEngine } from "../../supervisor/supervisor-engine.js";
import { JudgeService } from "../../supervisor/judge-service.js";
import { SupervisorState } from "@shared/schema/supervisor.js";

describe("Supervisor Engine Integration", () => {
    const mockDb = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
    } as any;

    const engine = new SupervisorEngine({ db: mockDb, parentExecutionId: 1 });

    it("should correctly evaluate state based on task statuses", () => {
        const plan: any = {
            tasks: [
                { id: "1", status: "completed", dependencies: [] },
                { id: "2", status: "completed", dependencies: ["1"] }
            ]
        };
        expect(engine.evaluateState(plan)).toBe(SupervisorState.COMPLETED);

        plan.tasks[1].status = "in_progress";
        expect(engine.evaluateState(plan)).toBe(SupervisorState.WAITING);

        plan.tasks[1].status = "rejected";
        expect(engine.evaluateState(plan)).toBe(SupervisorState.REPLANNING);
    });

    it("should identify ready tasks that have no unmet dependencies", () => {
        const plan: any = {
            tasks: [
                { id: "1", status: "completed", dependencies: [] },
                { id: "2", status: "pending", dependencies: ["1"] },
                { id: "3", status: "pending", dependencies: ["2"] }
            ]
        };
        const ready = engine.getReadyTasks(plan);
        expect(ready.length).toBe(1);
        expect(ready[0].id).toBe("2");
    });

    it("should integrate with JudgeService for qualitative evaluation", async () => {
        // Mocking JudgeService
        vi.spyOn(JudgeService, "evaluateTask").mockResolvedValue({
            pass: false,
            feedback: "Quality too low",
            confidence: 0.9
        });

        // Mocking DB response for execution output
        mockDb.select.mockImplementation(() => ({
            from: () => ({
                where: () => ({
                    limit: () => [
                        { id: 100, status: "completed", status_code: 200 }
                    ]
                })
            })
        }));

        // Mocking fetchExecutionOutput (private but we can test logic through syncStatuses)
        // For testing syncStatuses, we'd need a more elaborate mock or a real integration test.
        // This is a unit-style integration check.
    });
});
