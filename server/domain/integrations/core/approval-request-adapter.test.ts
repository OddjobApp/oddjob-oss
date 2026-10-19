/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { toBlockApprovalRequest } from "./approval-request-adapter.js";

describe("toBlockApprovalRequest", () => {
    it("maps a tool proposal to an agent action with its arguments and risk", () => {
        const request = toBlockApprovalRequest({
            id: 7,
            toolName: "send_email",
            toolArgs: { to: "ops@example.test" },
            status: "pending",
            createdAt: new Date("2026-09-12T10:00:00Z"),
            pipelineName: "SEND_EMAIL",
            stepName: "Run send_email",
            modifiedOutput: { risk: "HIGH" },
            approverEmail: "approver@example.test",
        });

        expect(request).toMatchObject({
            id: 7,
            type: "agent_action",
            title: "Run send_email",
            priority: "high",
            status: "pending",
            createdAt: "2026-09-12T10:00:00.000Z",
            requester: { id: 0, name: "SEND_EMAIL" },
            context: { action: "send_email", parameters: { to: "ops@example.test" } },
        });
    });

    it("maps a pipeline step using the description and parameters the executor stored", () => {
        const request = toBlockApprovalRequest({
            id: 12,
            jobId: 3,
            status: "pending",
            createdAt: "2026-09-12T11:00:00.000Z",
            stepName: "Deploy approval",
            modifiedOutput: { description: "Human approval required for Deploy", params: { env: "prod" } },
            comments: null,
        });

        expect(request.type).toBe("pipeline_step");
        expect(request.description).toBe("Human approval required for Deploy");
        expect(request.context?.parameters).toEqual({ env: "prod" });
    });

    it("falls back to medium priority and pending status for values the block cannot show", () => {
        const request = toBlockApprovalRequest({ id: 1, status: "weird", modifiedOutput: { risk: "extreme" }, createdAt: "x" });

        expect(request.priority).toBe("medium");
        expect(request.status).toBe("pending");
        expect(request.title).toBe("Approval required");
    });
});
