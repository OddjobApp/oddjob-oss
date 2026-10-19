/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
vi.mock("@server/database_service.js", () => ({ db: { execute } }));

const pushService = vi.hoisted(() => ({
    isConfigured: vi.fn(),
    devicesConfigured: vi.fn(),
    sendOnce: vi.fn(),
}));
vi.mock("./push.service.js", () => ({ pushService }));
vi.mock("@server/utils/logger.js", () => ({
    createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}));

const { sweepApprovalPushes, approvalPushUrl, describeApproval } = await import("./push-approval-sweep.js");

/** The SQL text of the last query, with its parameters left out. */
function lastQueryText(): string {
    const query = execute.mock.calls.at(-1)?.[0];
    const chunks: unknown[] = query?.queryChunks ?? [];
    return chunks
        .map((c: any) => (Array.isArray(c?.value) ? c.value.join("") : ""))
        .join(" ");
}

const pending = { id: 41, recipientId: "u1", toolName: "send_email", toolArgs: { description: "Email the client" }, modifiedOutput: null };

describe("approval push sweep", () => {
    beforeEach(() => {
        execute.mockReset().mockResolvedValue({ rows: [pending] });
        pushService.isConfigured.mockReset().mockReturnValue(false);
        pushService.devicesConfigured.mockReset().mockReturnValue(false);
        pushService.sendOnce.mockReset().mockResolvedValue(true);
    });

    it("runs for a server with phone push only, and finds approvers by their phones too", async () => {
        // Was gated on VAPID and on push_subscriptions alone, so an FCM-only
        // server never pushed an approval to anyone's phone.
        pushService.devicesConfigured.mockReturnValue(true);

        await expect(sweepApprovalPushes()).resolves.toBe(1);

        expect(lastQueryText()).toContain("push_devices");
        expect(pushService.sendOnce).toHaveBeenCalledWith("approval", 41, "u1", expect.objectContaining({
            title: "Approval needed",
            body: "Email the client",
            url: "/assistant/workbench?approval=41",
            tag: "approval-41",
        }));
    });

    it("does nothing when no push is configured", async () => {
        await expect(sweepApprovalPushes()).resolves.toBe(0);
        expect(execute).not.toHaveBeenCalled();
    });

    it("links each push to its own approval", () => {
        expect(approvalPushUrl(7)).toBe("/assistant/workbench?approval=7");
    });

    it("falls back to a generic line when the approval describes nothing", () => {
        expect(describeApproval({ toolName: null, toolArgs: null, modifiedOutput: null })).toBe("A step is paused until you decide.");
    });
});
