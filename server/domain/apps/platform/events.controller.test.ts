import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Hoisted mock state ---
const { mockDbRows } = vi.hoisted(() => {
    return { mockDbRows: { value: [] as any[] } };
});

vi.mock("@server/database_service.js", () => ({
    db: {
        select: () => ({
            from: () => ({
                where: () => ({
                    orderBy: () => ({
                        limit: () => Promise.resolve(mockDbRows.value),
                    }),
                }),
            }),
        }),
    },
}));

vi.mock("@shared/schema/index.js", () => ({
    forensicEventLog: {
        id: "id",
        organizationId: "organization_id",
        createdAt: "created_at",
    },
}));

vi.mock("drizzle-orm", () => ({
    eq: vi.fn((a, b) => ({ type: "eq", a, b })),
    and: vi.fn((...args: any[]) => ({ type: "and", args })),
    desc: vi.fn((col) => ({ type: "desc", col })),
    lt: vi.fn((col, val) => ({ type: "lt", col, val })),
    sql: vi.fn(),
    SQL: class {},
}));

vi.mock("@server/utils/logger.js", () => ({
    createLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    }),
}));

import { EventsController } from "./events.controller.js";

describe("EventsController.getEventsHistory", () => {
    let req: any;
    let res: any;

    beforeEach(() => {
        vi.clearAllMocks();
        mockDbRows.value = [];
        req = {
            appTokenContext: { orgId: 291, appId: 1, deploymentId: 1 },
            query: {},
        };
        res = {
            json: vi.fn(),
            status: vi.fn().mockReturnThis(),
        };
    });

    it("returns empty events array when no data found", async () => {
        await EventsController.getEventsHistory(req, res);

        expect(res.json).toHaveBeenCalledWith({
            events: [],
            nextCursor: undefined,
            hasMore: false,
        });
    });

    it("maps rows to ActivityEvent format", async () => {
        const now = new Date();
        mockDbRows.value = [
            {
                id: 1001,
                jobType: "agent_thought",
                status: "success",
                createdAt: now,
                missionRunId: 42,
                attributes: {
                    agentName: "dev-agent",
                    stage: "development",
                    summary: "Analyzing requirements",
                },
                thoughts: null,
                errorMessage: null,
            },
        ];

        await EventsController.getEventsHistory(req, res);

        const result = res.json.mock.calls[0][0];
        expect(result.events).toHaveLength(1);
        expect(result.events[0]).toMatchObject({
            id: "1001",
            type: "agent_thought",
            agentName: "dev-agent",
            missionStage: "development",
            summary: "Analyzing requirements",
            missionRunId: 42,
            timestamp: now.toISOString(),
        });
        expect(result.hasMore).toBe(false);
    });

    it("detects hasMore when extra row is returned", async () => {
        // Default limit is 50, so we return 51 rows to trigger hasMore
        mockDbRows.value = Array.from({ length: 51 }, (_, i) => ({
            id: 1000 - i,
            jobType: "tool_start",
            status: "success",
            createdAt: new Date(),
            missionRunId: null,
            attributes: { agentName: "qa-agent", summary: `Event ${i}` },
            thoughts: null,
            errorMessage: null,
        }));

        await EventsController.getEventsHistory(req, res);

        const result = res.json.mock.calls[0][0];
        expect(result.events).toHaveLength(50);
        expect(result.hasMore).toBe(true);
        expect(result.nextCursor).toBeDefined();
    });

    it("filters events by agent name (case-insensitive)", async () => {
        mockDbRows.value = [
            { id: 1, jobType: "agent_thought", status: "success", createdAt: new Date(), missionRunId: null, attributes: { agentName: "dev-agent", summary: "Dev work" }, thoughts: null, errorMessage: null },
            { id: 2, jobType: "agent_thought", status: "success", createdAt: new Date(), missionRunId: null, attributes: { agentName: "qa-agent", summary: "QA work" }, thoughts: null, errorMessage: null },
        ];

        req.query.agent = "dev";
        await EventsController.getEventsHistory(req, res);

        const result = res.json.mock.calls[0][0];
        expect(result.events).toHaveLength(1);
        expect(result.events[0].agentName).toBe("dev-agent");
    });

    it("filters events by stage", async () => {
        mockDbRows.value = [
            { id: 1, jobType: "tool_start", status: "success", createdAt: new Date(), missionRunId: null, attributes: { agentName: "agent-1", stage: "development", summary: "Build" }, thoughts: null, errorMessage: null },
            { id: 2, jobType: "tool_start", status: "success", createdAt: new Date(), missionRunId: null, attributes: { agentName: "agent-2", stage: "qa", summary: "Test" }, thoughts: null, errorMessage: null },
        ];

        req.query.stage = "qa";
        await EventsController.getEventsHistory(req, res);

        const result = res.json.mock.calls[0][0];
        expect(result.events).toHaveLength(1);
        expect(result.events[0].missionStage).toBe("qa");
    });

    it("filters events by type", async () => {
        mockDbRows.value = [
            { id: 1, jobType: "agent_thought", status: "success", createdAt: new Date(), missionRunId: null, attributes: { agentName: "agent-1", summary: "Thinking" }, thoughts: null, errorMessage: null },
            { id: 2, jobType: "error", status: "failure", createdAt: new Date(), missionRunId: null, attributes: { agentName: "agent-1", summary: "Failed" }, thoughts: null, errorMessage: "crash" },
        ];

        req.query.type = "error";
        await EventsController.getEventsHistory(req, res);

        const result = res.json.mock.calls[0][0];
        expect(result.events).toHaveLength(1);
        expect(result.events[0].type).toBe("error");
    });

    it("maps error events with errorMessage to detail", async () => {
        mockDbRows.value = [
            { id: 1, jobType: "error", status: "failure", createdAt: new Date(), missionRunId: null, attributes: { agentName: "agent-1", summary: "Task failed" }, thoughts: null, errorMessage: "Connection timeout" },
        ];

        await EventsController.getEventsHistory(req, res);

        const result = res.json.mock.calls[0][0];
        expect(result.events[0].detail).toBe("Connection timeout");
    });

    it("adds actionable for HIL events with hilId", async () => {
        mockDbRows.value = [
            { id: 1, jobType: "hil_created", status: "success", createdAt: new Date(), missionRunId: null, attributes: { agentName: "pm-agent", summary: "Approval needed", hilId: "123" }, thoughts: null, errorMessage: null },
        ];

        await EventsController.getEventsHistory(req, res);

        const result = res.json.mock.calls[0][0];
        expect(result.events[0].actionable).toEqual({ type: "hil", hilId: "123" });
    });

    it("maps handoff events from stage_handoff jobType", async () => {
        mockDbRows.value = [
            { id: 1, jobType: "cross_app:stage_handoff", status: "success", createdAt: new Date(), missionRunId: 5, attributes: { agentName: "pm-agent", payload: { targetStage: "Development" }, summary: "Handoff to dev" }, thoughts: null, errorMessage: null },
        ];

        await EventsController.getEventsHistory(req, res);

        const result = res.json.mock.calls[0][0];
        expect(result.events[0].type).toBe("handoff");
        expect(result.events[0].missionStage).toBe("development");
    });

    it("uses thoughts field as summary fallback", async () => {
        mockDbRows.value = [
            { id: 1, jobType: "agent_thought", status: "success", createdAt: new Date(), missionRunId: null, attributes: { agentName: "agent-1" }, thoughts: "I should refactor this module", errorMessage: null },
        ];

        await EventsController.getEventsHistory(req, res);

        const result = res.json.mock.calls[0][0];
        expect(result.events[0].summary).toBe("I should refactor this module");
    });
});
