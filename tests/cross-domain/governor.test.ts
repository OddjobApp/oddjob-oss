
import { describe, it, expect, beforeEach, vi } from "vitest";
import { MoltProducer } from "@domain/governor/core/molt-producer.js";

// vi.hoisted: the vi.mock factory below is hoisted above these declarations, so
// plain consts are read from the temporal dead zone. The class initialised its
// members from them the moment redis-client constructed a client — at import
// time — so the file failed to collect with "Cannot access 'mockXadd' before
// initialization" and reported 0 tests rather than a failure.
const { mockXadd, mockXrange } = vi.hoisted(() => ({
    mockXadd: vi.fn().mockResolvedValue("test-id"),
    mockXrange: vi.fn().mockResolvedValue([]),
}));

vi.mock("ioredis", async () => {
    const { ioredisMockModule } = await import("../helpers/ioredis-mock.js");
    return ioredisMockModule({ xadd: mockXadd, xrange: mockXrange });
});

vi.mock("@server/database_service.js", () => ({
    db: {
        select: vi.fn(() => ({
            from: vi.fn(() => ({
                where: vi.fn(() => ({
                    limit: vi.fn(() => Promise.resolve([])),
                })),
            })),
        })),
    },
}));

vi.mock("../../server/routes/agent-decision.js", () => ({
    pendingDecisions: new Map(),
}));

vi.mock("../../server/domain/integrations/messaging-service.js", () => ({
    messagingService: {
        notify: vi.fn().mockResolvedValue(undefined),
    },
}));

describe("MoltProducer", () => {
    let producer: MoltProducer;

    beforeEach(() => {
        vi.clearAllMocks();
        producer = new MoltProducer("test-session");
    });

    it("should generate a valid signature", () => {
        const payload = { command: "ls", context: {} };
        const timestamp = Date.now().toString();
        const signature = (producer as any).signPayload("PROPOSAL", payload, timestamp);
        expect(signature).toBeDefined();
        expect(typeof signature).toBe("string");
        expect(signature.length).toBe(64); // SHA256 hex
    });

    it("should verify a correct signature", () => {
        const payload = { command: "ls", context: {} };
        const timestamp = Date.now().toString();
        const signature = (producer as any).signPayload("PROPOSAL", payload, timestamp);
        expect(producer.verify("PROPOSAL", payload, timestamp, signature)).toBe(true);
    });

    it("should reject an incorrect signature", () => {
        const payload = { command: "ls", context: {} };
        const timestamp = Date.now().toString();
        expect(producer.verify("PROPOSAL", payload, timestamp, "wrong-signature")).toBe(false);
    });

    it("should validate and publish events", async () => {
        const payload = { command: "ls" };
        const id = await producer.publish("PROPOSAL", payload);
        expect(id).toBe("test-id");
    });

    it("should throw on invalid event type", async () => {
        const payload = { command: "ls" };
        // @ts-ignore
        await expect(producer.publish("INVALID_TYPE", payload)).rejects.toThrow();
    });

    describe("propose", () => {
        it("resolves with approved: false on timeout", async () => {
            mockXrange.mockResolvedValue([]);
            const result = await producer.propose("ls -la", {}, 300);
            expect(result).toEqual({ approved: false, reason: "Consensus Timeout" });
        }, 1000);

        it("resolves with approved: true when DECISION received", async () => {
            mockXadd.mockResolvedValue("proposal-123");
            mockXrange.mockResolvedValue([
                [
                    "decision-1",
                    ["type", "DECISION", "payload", JSON.stringify({ proposalId: "proposal-123", approved: true, reason: "OK" })],
                ],
            ]);

            const result = await producer.propose("ls", {}, 2000);
            expect(result).toEqual({ approved: true, reason: "OK" });
        }, 5000);

        it("resolves with approved: false when DECISION has approved: false", async () => {
            mockXadd.mockResolvedValue("proposal-456");
            mockXrange.mockResolvedValue([
                [
                    "decision-2",
                    ["type", "DECISION", "payload", JSON.stringify({ proposalId: "proposal-456", approved: false, reason: "Rejected" })],
                ],
            ]);

            const result = await producer.propose("rm -rf /", {}, 2000);
            expect(result).toEqual({ approved: false, reason: "Rejected" });
        }, 5000);
    });
});
