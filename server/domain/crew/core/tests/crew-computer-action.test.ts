/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ postTurn: vi.fn(), listSessions: vi.fn(), createSession: vi.fn(), createTask: vi.fn(), run: vi.fn() }));
vi.mock("../crew-form-studio.service.js", () => ({ postTurn: mocks.postTurn }));
vi.mock("@domain/integrations/trycua/trycua-service.js", () => ({ trycuaService: { listSessions: mocks.listSessions, createSession: mocks.createSession } }));
vi.mock("@domain/integrations/trycua/computer-use-task.service.js", () => ({ trycuaComputerUseTaskService: { createTask: mocks.createTask, runAutonomousLoop: mocks.run } }));
import { isActiveStudioWebCommand, isComputerCommand, runDirectComputerAction } from "../crew-computer-action.service.js";

describe("direct computer commands", () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mocks.listSessions.mockResolvedValue([{ id: "desktop", status: "active", expiresAt: new Date(Date.now() + 60_000) }]);
        mocks.createTask.mockResolvedValue({ task: { id: "task" } });
        mocks.run.mockResolvedValue({ task: { status: "succeeded", result: { summary: "Example Domain" } } });
    });
    it.each(["Open browser and type wired.com", "Use the computer to open https://example.com in the browser", "Open Firefox browser"])("executes %s", text => {
        expect(isComputerCommand(text)).toBe(true);
    });
    it.each(["Open Computer", "Explain how to open the browser", "Do not open the browser", "Discuss browser automation", "Create a browser automation agent"])("does not execute %s", text => {
        expect(isComputerCommand(text)).toBe(false);
    });
    it.each(["Navigate to the Wired article and summarize it", "Visit wired.com", "Find the article on the website"])("routes %s through an active studio", text => {
        expect(isActiveStudioWebCommand(text)).toBe(true);
    });
    it.each(["Explain how to visit wired.com", "Summarize our discussion", "Find the database record"])("does not route %s as active-studio web work", text => {
        expect(isActiveStudioWebCommand(text)).toBe(false);
    });
    const context = () => ({ orgId: 291, userId: "user", message: "Use the computer to open example.com", computerUseStudioActive: false, cost: { toolCalls: 0 } }) as any;
    it("routes an ordinary web request only while Computer Use Studio is active", async () => {
        const inactive = { ...context(), message: "Navigate to the Wired article and summarize it" };
        expect(await runDirectComputerAction(inactive, { id: 217 } as any)).toBe(false);
        expect(mocks.createTask).not.toHaveBeenCalled();
        const active = { ...inactive, computerUseStudioActive: true };
        expect(await runDirectComputerAction(active, { id: 217 } as any)).toBe(true);
        expect(mocks.createTask).toHaveBeenCalledWith(expect.objectContaining({ task: active.message }));
        expect(mocks.run).toHaveBeenCalledWith("task", 291, "user");
    });
    it("runs the actual task and mounts its session even when the speaker has no tools", async () => {
        await runDirectComputerAction(context(), { id: 217, tools: [] } as any);
        expect(mocks.listSessions).toHaveBeenCalledWith(291, "user");
        expect(mocks.createTask).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "desktop", organizationId: 291, userId: "user", requireConfirmation: false }));
        expect(mocks.postTurn.mock.calls[0][2].artifact.payload.props).toEqual({ sessionId: "desktop", taskId: "task" });
        expect(mocks.run).toHaveBeenCalledWith("task", 291, "user");
        expect(mocks.postTurn.mock.calls[1][2].content).toBe("Example Domain");
    });
    it("reports execution failures without claiming success", async () => {
        mocks.run.mockRejectedValue(new Error("Desktop unavailable"));
        await runDirectComputerAction(context(), { id: 1 } as any);
        expect(mocks.postTurn.mock.calls.at(-1)?.[2]).toEqual(expect.objectContaining({ content: expect.stringContaining("Desktop unavailable"), record: expect.objectContaining({ ok: false }) }));
    });
    it("requires a signed-in user before reading or executing desktop work", async () => {
        await runDirectComputerAction({ ...context(), userId: undefined }, { id: 1 } as any);
        expect(mocks.listSessions).not.toHaveBeenCalled();
        expect(mocks.createTask).not.toHaveBeenCalled();
    });
});
