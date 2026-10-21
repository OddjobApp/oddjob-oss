/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ rows: [] as any[], update: vi.fn(), confirm: vi.fn(), project: vi.fn() }));
vi.mock("@server/database_service.js", () => ({ db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [state.rows.shift()] }) }) }),
    update: state.update,
} }));
vi.mock("@domain/core/auth/jwt.service.js", () => ({ validateExternalToken: vi.fn(), generateExternalToken: vi.fn() }));
vi.mock("./external.service.js", () => ({ externalService: {} }));
vi.mock("../../mission/core/mission-run.service.js", () => ({ missionRunService: {} }));
vi.mock("@domain/queue/queue.service.js", () => ({ queueService: {}, JobPriority: {} }));
vi.mock("../workers/approval-notification.worker.js", () => ({ ApprovalNotificationType: {} }));
vi.mock("../../governor/core/decision-router.js", () => ({ decisionRouter: {} }));
vi.mock("@domain/core/infrastructure/event-stream.service.js", () => ({ eventStream: {} }));
vi.mock("./outbound-email-accounts.service.js", () => ({ outboundEmailAccounts: { confirm: state.confirm, projectForRoom: state.project } }));
import { approvalService } from "./approval.service.js";
beforeEach(() => {
    vi.clearAllMocks(); state.rows = [{ id: 99, status: "pending", organizationId: 9, approverId: "u1", approverEmail: "me@example.com", toolArgs: { kind: "outbound_message", channel: "email", sessionKey: "room-a" } }];
    state.project.mockResolvedValue(7); state.confirm.mockRejectedValue(new Error("Confirm the connected sender"));
});
describe("sender confirmation precedes approval claim", () => {
    it("leaves the draft pending when no sender is confirmed", async () => {
        await expect(approvalService.processDecision(99, { decision: "approved" }, "u1", "me@example.com")).rejects.toThrow("Confirm the connected sender");
        expect(state.confirm).toHaveBeenCalledWith(9, "u1", undefined, 7); expect(state.update).not.toHaveBeenCalled();
    });
    it("rechecks a selected identity before claiming the send", async () => {
        const choice = { connectorId: 11, email: "old@example.com", provider: "google" as const, remember: true };
        state.confirm.mockRejectedValue(new Error("Sender account changed"));
        await expect(approvalService.processDecision(99, { decision: "approved", modifiedOutput: { emailAccount: choice } }, "u1", "me@example.com")).rejects.toThrow("account changed");
        expect(state.confirm).toHaveBeenCalledWith(9, "u1", choice, 7); expect(state.update).not.toHaveBeenCalled();
    });
    it("does not inspect accounts for an unauthorized approver", async () => {
        await expect(approvalService.processDecision(99, { decision: "approved" }, "other", "other@example.com")).rejects.toThrow("designated approver");
        expect(state.confirm).not.toHaveBeenCalled(); expect(state.project).not.toHaveBeenCalled(); expect(state.update).not.toHaveBeenCalled();
    });
});
