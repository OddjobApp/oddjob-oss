/**
 * The deliberation alert createApprovalRequest emits.
 *
 * This is here because the call was dark. It invoked eventStream.broadcast(),
 * a method the service does not have — only publish(eventType, payload, context,
 * source). The resulting TypeError landed in a catch that logged at debug, so no
 * event was ever emitted, nothing downstream fired, and the whole deliberation
 * path looked implemented while doing nothing. A test that only checked "does not
 * throw" would still pass today, so these assert the call itself.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { publish, insertReturning, selectRows } = vi.hoisted(() => ({
    publish: vi.fn(async () => "event-id"),
    insertReturning: vi.fn(async () => [{ id: 4242, organizationId: 7 }]),
    selectRows: { current: [] as unknown[] },
}));

vi.mock("@domain/core/infrastructure/event-stream.service.js", () => ({
    eventStream: { publish },
}));

vi.mock("@server/database_service.js", () => {
    const select = () => {
        const q: any = {
            from: () => q,
            where: () => q,
            limit: async () => selectRows.current,
        };
        return q;
    };
    const insert = () => ({
        values: () => ({ returning: insertReturning }),
    });
    const update = () => ({ set: () => ({ where: async () => undefined }) });
    return { db: { select, insert, update } };
});

vi.mock("../workers/approval-notification.worker.js", () => ({
    ApprovalNotificationType: { CREATED: "created" },
    approvalNotificationQueue: { add: vi.fn(async () => undefined) },
}));

vi.mock("../../governor/core/decision-router.js", () => ({
    decisionRouter: {
        route: vi.fn(async () => ({ autoApprove: false })),
        fanOutNotifications: vi.fn(async () => undefined),
    },
}));

// Real BullMQ. Unmocked, addJob() is awaited against a live Redis and the test
// simply hangs rather than failing.
vi.mock("@domain/queue/queue.service.js", () => ({
    queueService: { addJob: vi.fn(async () => ({ id: "job-1" })) },
    JobPriority: { HIGH: 1, NORMAL: 2, LOW: 3 },
}));

// The approval token is signed on this path and the signer reads JWT_SECRET at
// call time; this file is about the event, not the token.
vi.mock("@domain/core/auth/jwt.service.js", () => ({
    generateExternalToken: vi.fn(() => "test-token"),
    validateExternalToken: vi.fn(() => ({ valid: true })),
}));

const { approvalService } = await import("./approval.service.js");

const input = {
    executionId: "exec-1",
    jobId: 9,
    approverType: "human",
    status: "pending",
    organizationId: 7,
    context: {
        missionName: "Warehouse Optimization",
        stepName: "Partition Migration",
        riskLevel: "high",
    },
};

describe("createApprovalRequest deliberation event", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        selectRows.current = [];
        publish.mockResolvedValue("event-id");
        insertReturning.mockResolvedValue([{ id: 4242, organizationId: 7 }]);
    });

    it("publishes deliberation.started, using the method the service actually has", async () => {
        await approvalService.createApprovalRequest(input as any);

        expect(publish).toHaveBeenCalledTimes(1);
        const [eventType, payload, context, source] = publish.mock.calls[0] as any[];

        expect(eventType).toBe("deliberation.started");
        expect(source).toBe("approval.service");
        // The intervention engine keys its item off approvalId; without it the
        // alert cannot address the decision it is about.
        expect(payload.approvalId).toBe(4242);
        expect(payload.pipelineName).toBe("Warehouse Optimization");
        expect(payload.stepName).toBe("Partition Migration");
        expect(context.organizationId).toBe(7);
    });

    it("does not claim agents are deliberating", async () => {
        // The description said "Guardian & Optimizer are deliberating trade-offs".
        // No such personas are convened, so it described participants that do not
        // exist. It may say the step is paused; it may not invent who is on it.
        await approvalService.createApprovalRequest(input as any);

        const [, payload] = publish.mock.calls[0] as any[];
        expect(payload.description).not.toMatch(/Guardian|Optimizer|FinOps/);
        expect(payload.description).toMatch(/paused/i);
    });

    it("survives a publish failure rather than failing the approval", async () => {
        publish.mockRejectedValue(new Error("redis down"));

        const request = await approvalService.createApprovalRequest(input as any);

        // The approval is the durable record; a missed toast must not undo it.
        expect(request).toBeTruthy();
    });

    it("emits nothing when idempotency returns an existing request", async () => {
        selectRows.current = [{ id: 1, status: "pending" }];

        await approvalService.createApprovalRequest(input as any);

        expect(publish).not.toHaveBeenCalled();
    });
});
