import { describe, it, expect, vi } from "vitest";
import { decisionRouter } from "../core/decision-router.js";

// Mock the DB and Redis since we want a pure unit test of the auto-approval interceptor logic
vi.mock("@server/database_service.js", () => ({
    db: {
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([{ id: 123 }]),
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([{ id: 123 }])
    }
}));

vi.mock("@server/utils/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe("DecisionRouter Auto-Approval", () => {
    it("should auto-approve file_read tool requests", async () => {
        const result = await decisionRouter.requestDecision({
            sessionId: "test-session",
            tool: "file_read",
            params: { path: "/some/file" },
            goal: "read config file",
            riskLevel: "medium",
            approverType: "internal",
            channels: []
        });

        expect(result.approved).toBe(true);
        expect(result.source).toBe("auto");
        expect(result.reason).toContain("read-only file");
    });

    it("should auto-approve view_file tool requests", async () => {
        const result = await decisionRouter.requestDecision({
            sessionId: "test-session",
            tool: "view_file",
            params: { AbsolutePath: "/some/file" },
            goal: "view config file",
            riskLevel: "medium",
            approverType: "internal",
            channels: []
        });

        expect(result.approved).toBe(true);
        expect(result.source).toBe("auto");
        expect(result.reason).toContain("read-only file");
    });

    it("should auto-approve read_file tool requests", async () => {
        const result = await decisionRouter.requestDecision({
            sessionId: "test-session",
            tool: "read_file",
            params: { path: "/some/file" },
            goal: "read config file",
            riskLevel: "medium",
            approverType: "internal",
            channels: []
        });

        expect(result.approved).toBe(true);
        expect(result.source).toBe("auto");
        expect(result.reason).toContain("read-only file");
    });

    it("should NOT auto-approve destructive shell commands even with crisis-recovery goal", async () => {
        // Crisis recovery is not a valid bypass — destructive commands must go through HIL
        const result = await decisionRouter.requestDecision({
            sessionId: "test-session",
            tool: "shell",
            params: { command: "rm -rf /" },
            goal: "CRISIS RECOVERY: restore system",
            riskLevel: "high",
            approverType: "internal",
            channels: []
        });

        expect(result.approved).not.toBe(true);
        expect(result.source).not.toBe("auto");
    });

    it("should auto-approve safe diagnostic shell commands", async () => {
        const result = await decisionRouter.requestDecision({
            sessionId: "test-session",
            tool: "shell",
            params: { command: "ps -ef | grep node" },
            goal: "check running processes",
            riskLevel: "medium",
            approverType: "internal",
            channels: []
        });

        expect(result.approved).toBe(true);
        expect(result.source).toBe("auto");
        expect(result.reason).toContain("safe diagnostic command");
    });

    it("should NOT auto-approve shell commands that access sensitive paths", async () => {
        const result = await decisionRouter.requestDecision({
            sessionId: "test-session",
            tool: "shell",
            params: { command: "ls /etc/passwd" },
            goal: "check config",
            riskLevel: "medium",
            approverType: "internal",
            channels: []
        });

        expect(result.approved).not.toBe(true);
        expect(result.source).not.toBe("auto");
    });

    it("should auto-approve trusted system shell requests", async () => {
        const result = await decisionRouter.requestDecision({
            sessionId: "system-session",
            tool: "shell",
            params: { command: "ps aux" },
            goal: "system diagnostics",
            riskLevel: "low",
            approverType: "internal",
            approverId: "system",
            channels: []
        });

        expect(result.approved).toBe(true);
        expect(result.source).toBe("auto");
    });
});
