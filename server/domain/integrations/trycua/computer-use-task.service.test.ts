/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), insert: vi.fn(), values: vi.fn(), returning: vi.fn(), getSkill: vi.fn(), replay: vi.fn(), resolveInputs: vi.fn() }));
vi.mock("../../../db/index.js", () => ({ db: { insert: mocks.insert } }));
vi.mock("./trycua-service.js", () => ({ trycuaService: { getSession: mocks.getSession } }));
vi.mock("./computer-use-provider.service.js", () => ({
    resolveComputerUseProviderConfig: vi.fn(),
    resolveAndCreateComputerUseLoop: vi.fn(),
    createComputerUseLoop: vi.fn(),
}));
vi.mock("./computer-intelligence.service.js", () => ({ trycuaComputerIntelligenceService: {} }));
vi.mock("../../governor/core/decision-router.js", () => ({ decisionRouter: {} }));
// importOriginal, so the mock cannot drift out of step with what the module exports:
// stubbing the whole module meant a new export (skillReliability) broke every test here
// with "no export is defined on the mock" rather than telling us anything true.
vi.mock("./learned-skills.service.js", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./learned-skills.service.js")>()),
    learnedSkillsService: { getSkill: mocks.getSkill, replay: mocks.replay, resolveInputs: mocks.resolveInputs },
}));
import { TrycuaComputerUseTaskService } from "./computer-use-task.service.js";

const input = { sessionId: "session", organizationId: 7, userId: "owner", task: "Continue with a new goal", previousTaskId: "previous", executeImmediately: false };
beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ userId: "owner" });
    mocks.insert.mockReturnValue({ values: mocks.values });
    mocks.values.mockReturnValue({ returning: mocks.returning });
    mocks.returning.mockResolvedValue([{ id: "new" }]);
});

describe("computer-use task continuation", () => {
    it("uses skill guidance without bypassing per-action approval in supervised mode", async () => {
        mocks.getSkill.mockResolvedValue({ id: "skill", status: "active", name: "Report", procedure: "Open the report" });
        const service = new TrycuaComputerUseTaskService();
        const insertStep = vi.spyOn(service as any, "insertStep").mockResolvedValue(undefined);
        const result = await (service as any).replaySkillIfAny({ organizationId: 7, task: "Read a report", requireConfirmation: true, metadata: { skillId: "skill" } });
        expect(result.goal).toContain("Open the report");
        // Recorded, so the studio can show which skill the supervised run follows.
        expect(insertStep).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ phase: "skill_replay", status: "guided", action: "Report" }));
        expect(mocks.replay).not.toHaveBeenCalled();
        expect(mocks.resolveInputs).not.toHaveBeenCalled();
    });
    it("loads the previous task within the requesting org and user, preserving the conversation state", async () => {
        const service = new TrycuaComputerUseTaskService();
        const getTask = vi.spyOn(service as any, "getTask").mockResolvedValue({ sessionId: "session", status: "succeeded", metadata: { gemini: { interactionId: "interaction" } } });
        vi.spyOn(service, "getTaskWithSteps").mockResolvedValue({ task: { id: "new" }, steps: [] } as any);
        await service.createTask(input);
        expect(getTask).toHaveBeenCalledWith("previous", 7, "owner");
        expect(mocks.values).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ loopState: { providerState: { interactionId: "interaction" } } }) }));
    });

    it("rejects cross-session continuation before creating a task", async () => {
        const service = new TrycuaComputerUseTaskService();
        vi.spyOn(service as any, "getTask").mockResolvedValue({ sessionId: "another", status: "succeeded" });
        await expect(service.createTask(input)).rejects.toThrow(/different session/);
        expect(mocks.insert).not.toHaveBeenCalled();
    });

    it.each(["queued", "running", "needs_confirmation"])("rejects a previous task that is %s", async status => {
        const service = new TrycuaComputerUseTaskService();
        vi.spyOn(service as any, "getTask").mockResolvedValue({ sessionId: "session", status });
        await expect(service.createTask(input)).rejects.toThrow(/must finish or be cancelled/);
        expect(mocks.insert).not.toHaveBeenCalled();
    });

    it("does not silently discard a missing or inaccessible previous task", async () => {
        const service = new TrycuaComputerUseTaskService();
        vi.spyOn(service as any, "getTask").mockRejectedValue(new Error("Computer-use task not found"));
        await expect(service.createTask(input)).rejects.toThrow(/not found/);
        expect(mocks.insert).not.toHaveBeenCalled();
    });
});
