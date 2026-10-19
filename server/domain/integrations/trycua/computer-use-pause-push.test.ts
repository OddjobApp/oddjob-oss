/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

const sendToUser = vi.hoisted(() => vi.fn());
vi.mock("../../core/notifications/push.service.js", () => ({ pushService: { sendToUser } }));
vi.mock("../../../db/index.js", () => ({ db: {} }));
vi.mock("./trycua-service.js", () => ({ trycuaService: {} }));
vi.mock("./computer-intelligence.service.js", () => ({ resolveGeminiApiKey: vi.fn(), trycuaComputerIntelligenceService: {} }));
vi.mock("../../governor/core/decision-router.js", () => ({ decisionRouter: {} }));
vi.mock("./learned-skills.service.js", () => ({ learnedSkillsService: {} }));
const sendSolverLink = vi.hoisted(() => vi.fn());
vi.mock("./hil-solver.js", () => ({ sendSolverLink }));

import { notifyPause } from "./computer-use-task.service.js";

const task = { id: "task-1", sessionId: "sess 1", userId: "u1", organizationId: 291, task: "Book the meeting room" };

describe("computer-use pause push", () => {
    beforeEach(() => {
        sendToUser.mockReset();
    });

    it("tells the task's owner the agent handed them the desktop, linking to the studio on that task", async () => {
        await notifyPause(task, "yield", "Please log in to the booking site");
        expect(sendToUser).toHaveBeenCalledWith("u1", expect.objectContaining({
            title: "The computer needs you",
            body: "Please log in to the booking site",
            url: "/workspace/computer-use?session=sess%201&task=task-1&orgId=291",
            tag: "computer-use-task-1",
        }));
    });

    it("falls back to the task text when the model gave no explanation", async () => {
        await notifyPause(task, "safety");
        expect(sendToUser).toHaveBeenCalledWith("u1", expect.objectContaining({
            title: "A computer action needs your approval",
            body: "Book the meeting room",
        }));
    });

    it("offers a signed SMS solver link alongside the push", async () => {
        await notifyPause(task, "yield");
        expect(sendSolverLink).toHaveBeenCalledWith(task);
    });

    it("never lets a push failure break the task", async () => {
        sendToUser.mockRejectedValue(new Error("push service down"));
        await expect(notifyPause(task, "yield")).resolves.toBeUndefined();
    });
});
