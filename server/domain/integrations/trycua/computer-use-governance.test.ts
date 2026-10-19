/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requestDecision: vi.fn(), approvalRow: [] as any[] }));
vi.mock("../../governor/core/decision-router.js", () => ({ decisionRouter: { requestDecision: mocks.requestDecision } }));
vi.mock("../../../db/index.js", () => ({
    db: {
        // Only the approval lookup reads through this mock; everything else is stubbed
        // on the service instance below.
        select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve(mocks.approvalRow) }) }) }),
    },
}));
vi.mock("./trycua-service.js", () => ({ trycuaService: {} }));
vi.mock("./computer-use-provider.service.js", () => ({
    resolveComputerUseProviderConfig: vi.fn(),
    resolveAndCreateComputerUseLoop: vi.fn(),
    createComputerUseLoop: vi.fn(),
}));
vi.mock("./computer-intelligence.service.js", () => ({ trycuaComputerIntelligenceService: {} }));
vi.mock("./learned-skills.service.js", () => ({ learnedSkillsService: { isRecording: () => undefined } }));

import { TrycuaComputerUseTaskService, pendingGovernance } from "./computer-use-task.service.js";

const queued = { id: "t1", organizationId: 7, userId: "u1", task: "Open the reports", status: "queued", maxSteps: 5, requireConfirmation: false, allowSensitive: false, result: {} } as any;

function serviceWith(task: any) {
    const service = new TrycuaComputerUseTaskService();
    vi.spyOn(service as any, "getTask").mockResolvedValue(task);
    vi.spyOn(service, "getTaskWithSteps").mockResolvedValue({ task, steps: [] } as any);
    const insertStep = vi.spyOn(service as any, "insertStep").mockResolvedValue(undefined);
    const updateTask = vi.spyOn(service as any, "updateTask").mockResolvedValue(undefined);
    vi.spyOn(service as any, "driveLoop").mockResolvedValue(undefined);
    vi.spyOn(service as any, "replaySkillIfAny").mockResolvedValue(undefined);
    return { service, insertStep, updateTask };
}

describe("computer-use run governance", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.approvalRow = [];
    });

    it("starts an autonomous run without requesting approval", async () => {
        const { service, updateTask } = serviceWith({ ...queued });
        await service.runAutonomousLoop("t1", 7, "u1");
        expect(mocks.requestDecision).not.toHaveBeenCalled();
        expect(updateTask).toHaveBeenCalledWith("t1", "running");
        expect((service as any).driveLoop).toHaveBeenCalled();
    });

    it.each(["cancelled", "blocked", "succeeded", "failed", "needs_confirmation"])("does not restart a %s task", async (status) => {
        const { service } = serviceWith({ ...queued, status });
        await service.runAutonomousLoop("t1", 7, "u1");
        expect((service as any).driveLoop).not.toHaveBeenCalled();
    });

    it("tests a draft without start approval and stops without autonomous continuation", async () => {
        mocks.requestDecision.mockResolvedValue({ approved: true });
        const { service, updateTask } = serviceWith({ ...queued, metadata: { skillTest: true, skillId: "draft" } });
        vi.mocked((service as any).replaySkillIfAny).mockResolvedValue({ skillId: "draft", completed: false });
        await service.runAutonomousLoop("t1", 7, "u1");
        expect(mocks.requestDecision).not.toHaveBeenCalled();
        expect((service as any).driveLoop).not.toHaveBeenCalled();
        expect(updateTask).toHaveBeenCalledWith("t1", "failed", expect.objectContaining({ completedAt: expect.any(Date) }));
    });

    it("starts a waiting run once its approval is granted, without asking again", async () => {
        mocks.approvalRow = [{ status: "approved", comments: null }];
        const waiting = { ...queued, status: "needs_confirmation", result: { pending: { kind: "governance", approvalRequestId: 42 } } };
        const { service, updateTask } = serviceWith(waiting);

        await service.runAutonomousLoop("t1", 7, "u1");

        expect(mocks.requestDecision).not.toHaveBeenCalled();
        expect(updateTask).toHaveBeenCalledWith("t1", "running", expect.objectContaining({ needsConfirmation: false }));
    });

    it("stops a waiting run whose approval was rejected", async () => {
        mocks.approvalRow = [{ status: "rejected", comments: "Not this one" }];
        const waiting = { ...queued, status: "needs_confirmation", result: { pending: { kind: "governance", approvalRequestId: 42 } } };
        const { service, updateTask } = serviceWith(waiting);

        await service.runAutonomousLoop("t1", 7, "u1");

        expect(updateTask).toHaveBeenCalledWith("t1", "blocked", expect.objectContaining({ result: { blockedByGovernance: true, reason: "Not this one" } }));
    });

    it.each(["pending", "snoozed"])("resumes a legacy %s request without approval", async (status) => {
        mocks.approvalRow = [{ status, comments: null }];
        const waiting = { ...queued, status: "needs_confirmation", result: { pending: { kind: "governance", approvalRequestId: 42 } } };
        const { service, updateTask } = serviceWith(waiting);

        await service.runAutonomousLoop("t1", 7, "u1");

        expect(mocks.requestDecision).not.toHaveBeenCalled();
        expect(updateTask).toHaveBeenCalledWith("t1", "running", expect.objectContaining({ needsConfirmation: false }));
        expect((service as any).driveLoop).toHaveBeenCalled();
    });

    it.each([true, false])("handles legacy confirmation with allow=%s", async (allow) => {
        const waiting = { ...queued, status: "needs_confirmation", result: { pending: { kind: "governance", approvalRequestId: 42 } } };
        const { service, updateTask } = serviceWith(waiting);
        await service.confirmTask({ taskId: "t1", organizationId: 7, userId: "u1", allow });
        if (allow) expect((service as any).driveLoop).toHaveBeenCalled();
        else {
            expect((service as any).driveLoop).not.toHaveBeenCalled();
            expect(updateTask).toHaveBeenCalledWith("t1", "cancelled", expect.anything());
        }
    });

    it("tells a governance wait apart from the model's own pause", () => {
        expect(pendingGovernance({ status: "needs_confirmation", result: { pending: { kind: "governance", approvalRequestId: 9 } } } as any)).toEqual({ approvalRequestId: 9 });
        expect(pendingGovernance({ status: "needs_confirmation", result: { pending: { kind: "yield" } } } as any)).toBeUndefined();
        expect(pendingGovernance({ status: "running", result: {} } as any)).toBeUndefined();
    });
});
