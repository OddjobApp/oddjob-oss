import { describe, expect, it } from "vitest";
import { buildAttentionQueue, type AttentionQueueRows } from "./attention-queue.service";

const now = new Date("2026-07-19T12:00:00.000Z");

function rows(): AttentionQueueRows {
    return {
        approvals: [{
            id: 10,
            organizationId: 7,
            missionId: 20,
            modifiedOutput: { risk: "high", tool: "Send email", description: "Notify customer" },
            toolName: "email_send",
            createdAt: new Date("2026-07-19T11:50:00.000Z"),
        }],
        missions: [{
            id: 30,
            organizationId: 7,
            missionId: 20,
            name: "Payment triage",
            status: "failed",
            failureReason: "Provider timeout",
            resumeCondition: null,
            updatedAt: new Date("2026-07-19T11:55:00.000Z"),
            missionContext: null,
        }],
        cycles: [{
            id: 40,
            organizationId: 7,
            name: "Support operations",
            status: "active",
            budgetLimitUsd: "100.00",
            currentSpendUsd: "125.00",
            updatedAt: new Date("2026-07-19T11:45:00.000Z"),
        }],
        connections: [{
            id: 50,
            orgId: 7,
            platform: "jira",
            status: "disconnected",
            lastSync: null,
            updatedAt: new Date("2026-07-18T10:00:00.000Z"),
        }],
    };
}

describe("buildAttentionQueue", () => {
    it("combines and risk-sorts organization attention signals", () => {
        const result = buildAttentionQueue(rows(), now, 20);

        expect(result.summary.total).toBe(4);
        expect(result.summary.critical).toBe(3);
        expect(result.summary.byKind).toEqual({ approval: 1, mission: 1, cycle: 1, connection: 1 });
        expect(result.items.slice(0, 3).every((item) => item.severity === "critical")).toBe(true);
        expect(result.items.at(-1)?.kind).toBe("connection");
        expect(result.items.every((item) => item.organizationId === 7)).toBe(true);
    });

    it("raises stale waiting work and omits healthy connections", () => {
        const data = rows();
        data.approvals = [];
        data.cycles = [];
        data.missions = [{
            id: 31,
            organizationId: 7,
            missionId: 21,
            name: "Awaiting source file",
            status: "waiting_on_file",
            failureReason: null,
            resumeCondition: { type: "file" },
            updatedAt: new Date("2026-07-19T09:00:00.000Z"),
            missionContext: null,
        }];
        data.connections = [{
            id: 51,
            orgId: 7,
            platform: "slack",
            status: "connected",
            lastSync: new Date("2026-07-19T11:59:00.000Z"),
            updatedAt: new Date("2026-07-19T11:59:00.000Z"),
        }];

        const result = buildAttentionQueue(data, now, 20);

        expect(result.items).toHaveLength(1);
        expect(result.items[0]).toMatchObject({ kind: "mission", severity: "high" });
    });

    it("reports the complete summary while limiting visible items", () => {
        const result = buildAttentionQueue(rows(), now, 2);

        expect(result.summary.total).toBe(4);
        expect(result.items).toHaveLength(2);
    });

    it("surfaces the real diagnosis + recovery for a failed run with root_cause_analysis", () => {
        const data = rows();
        data.approvals = [];
        data.cycles = [];
        data.connections = [];
        data.missions = [{
            id: 99,
            organizationId: 7,
            missionId: 22,
            name: "Rolling Wave: Repository Context Reloading",
            status: "failed",
            failureReason: null, // existing failed runs carry the diagnosis on missionContext, not failureReason
            resumeCondition: null,
            updatedAt: new Date("2026-07-19T11:00:00.000Z"),
            missionContext: {
                root_cause_analysis: "npm install failed: ENOENT, no such file or directory, open 'package.json'.",
            },
        }];

        const item = buildAttentionQueue(data, now, 20).items[0];

        expect(item.summary).toContain("ENOENT"); // real problem, not the generic fallback
        expect(item.recommendation).toContain("package.json");
        expect(item.recovery).toEqual({ strategy: "reset", missionRunId: 99 });
    });
});
