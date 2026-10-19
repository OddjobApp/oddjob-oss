/**
 * DecisionRouter Publish Edge Cases - Unit Tests
 * 
 * Tests for Requirements 7.5, 7.6, 7.7:
 * - 7.5: Redis Pub/Sub event emitted within 100ms of DB write
 * - 7.6: If Redis publish fails, log failure and continue without interrupting request flow
 * - 7.7: Auto-approved requests do NOT publish to Redis Pub/Sub
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Hoisted mocks ---
const mockPublish = vi.hoisted(() => vi.fn().mockResolvedValue(1));
const mockInsertReturning = vi.hoisted(() => vi.fn());
const mockDbSelectResult = vi.hoisted(() => vi.fn());
const mockLoggerError = vi.hoisted(() => vi.fn());
const mockLoggerInfo = vi.hoisted(() => vi.fn());
const mockGenerateToken = vi.hoisted(() => vi.fn());

vi.mock("@domain/core/infrastructure/redis/redis-client.js", () => ({
    nodeRedisClient: {
        lpush: vi.fn().mockResolvedValue(1),
        expire: vi.fn().mockResolvedValue(1),
        del: vi.fn().mockResolvedValue(1),
    },
    redisService: {
        publisher: {
            publish: mockPublish,
        },
        subscriber: {
            subscribe: vi.fn(),
            on: vi.fn(),
        },
        client: {},
    },
}));

vi.mock("@server/database_service.js", () => ({
    db: {
        insert: vi.fn(() => ({
            values: vi.fn(() => ({
                returning: vi.fn(() => mockInsertReturning()),
            })),
        })),
        select: vi.fn(() => ({
            from: vi.fn(() => ({
                where: vi.fn(() => ({
                    limit: vi.fn(() => Promise.resolve(mockDbSelectResult())),
                })),
            })),
        })),
        update: vi.fn(() => ({
            set: vi.fn(() => ({
                where: vi.fn().mockResolvedValue([{ id: 1 }]),
            })),
        })),
    },
}));

vi.mock("@server/utils/logger.js", () => ({
    createLogger: () => ({
        info: mockLoggerInfo,
        debug: vi.fn(),
        warn: vi.fn(),
        error: mockLoggerError,
    }),
}));

vi.mock("@domain/core/auth/jwt.service.js", () => ({
    generateExternalToken: (...args: unknown[]) => mockGenerateToken(...args),
}));

vi.mock("@shared/schema/index.js", () => ({
    approvalRequests: { id: "id", organizationId: "organizationId" },
    saasConnectors: {},
    jobs: { id: "id", organizationId: "organizationId" },
}));

vi.mock("drizzle-orm", () => ({
    eq: vi.fn(),
    and: vi.fn(),
}));

vi.mock("../molt-producer.js", () => ({
    MoltProducer: vi.fn().mockImplementation(() => ({
        publish: vi.fn().mockResolvedValue("proposal-id"),
        disconnect: vi.fn().mockResolvedValue(undefined),
    })),
}));

vi.mock("../form-publishing-service.js", () => ({
    formPublishingService: {
        publish: vi.fn().mockResolvedValue(undefined),
    },
}));

vi.mock("ioredis", () => {
    class RedisMock {
        xadd = vi.fn().mockResolvedValue("redis-id");
        xrange = vi.fn().mockResolvedValue([]);
        quit = vi.fn().mockResolvedValue("OK");
        on = vi.fn();
        get = vi.fn().mockResolvedValue(null);
        blpop = vi.fn().mockImplementation((_key: string, _timeout: number) => {
            return new Promise(resolve => setTimeout(() => resolve(null), 50));
        });
    }
    return { default: RedisMock, Redis: RedisMock };
});

import { DecisionRouter, type DecisionRequest } from "../decision-router.js";

describe("DecisionRouter Publish Edge Cases", () => {
    let router: DecisionRouter;

    const baseNonAutoApproveRequest: DecisionRequest = {
        sessionId: "test-session",
        tool: "sql_query",
        params: { query: "DROP TABLE users" },
        goal: "Execute dangerous query",
        riskLevel: "high",
        approverType: "internal",
        channels: ["copilot"],
        organizationId: 42,
        missionId: 7,
        description: "Execute deployment script on production",
    };

    beforeEach(() => {
        vi.clearAllMocks();
        router = new DecisionRouter();
        mockGenerateToken.mockReturnValue("mock-token");
        mockInsertReturning.mockResolvedValue([{ id: 99 }]);
        mockDbSelectResult.mockResolvedValue([]);
    });

    describe("Requirement 7.6: Publish failure is logged but does not throw", () => {
        it("should log error and continue when Redis publish fails", async () => {
            const publishError = new Error("Redis connection refused");
            mockPublish.mockRejectedValueOnce(publishError);

            // Should NOT throw — the request should still complete (timeout expected)
            const result = await router.requestDecision({
                ...baseNonAutoApproveRequest,
                timeoutMs: 100,
                noWait: true,
            });

            // Verify the error was logged
            expect(mockLoggerError).toHaveBeenCalledWith(
                expect.stringContaining("Failed to publish"),
                expect.any(Error)
            );

            // The request flow was not interrupted — we got a result
            expect(result).toBeDefined();
            expect(result.requestId).toBe(99);
        });

        it("should not propagate Redis publish errors to the caller", async () => {
            mockPublish.mockRejectedValueOnce(new Error("ECONNREFUSED"));

            // The method itself should not throw
            await expect(
                router.requestDecision({
                    ...baseNonAutoApproveRequest,
                    timeoutMs: 100,
                    noWait: true,
                })
            ).resolves.toBeDefined();
        });
    });

    describe("Requirement 7.7: Null organizationId skips publishing", () => {
        it("should not call redis.publish when organizationId is null", async () => {
            const result = await router.requestDecision({
                ...baseNonAutoApproveRequest,
                organizationId: undefined, // null/undefined org
                timeoutMs: 100,
                noWait: true,
            });

            // Verify publish was NOT called for decision:new
            // (It may still be called by MoltProducer for copilot channel, but NOT for decisions:{orgId})
            const decisionPublishCalls = mockPublish.mock.calls.filter(
                (call: unknown[]) => typeof call[0] === "string" && (call[0] as string).startsWith("decisions:")
            );
            expect(decisionPublishCalls).toHaveLength(0);
            expect(result).toBeDefined();
        });

        it("should not call redis.publish when organizationId is explicitly undefined", async () => {
            await router.requestDecision({
                ...baseNonAutoApproveRequest,
                organizationId: undefined,
                timeoutMs: 100,
                noWait: true,
            });

            const decisionChannelCalls = mockPublish.mock.calls.filter(
                (call: unknown[]) => typeof call[0] === "string" && (call[0] as string).startsWith("decisions:")
            );
            expect(decisionChannelCalls).toHaveLength(0);
        });
    });

    describe("Requirement 7.7: Auto-approved requests do not trigger publish", () => {
        it("should not publish for read-only file tools (file_read)", async () => {
            await router.requestDecision({
                ...baseNonAutoApproveRequest,
                tool: "file_read",
                organizationId: 42,
            });

            expect(mockPublish).not.toHaveBeenCalled();
        });

        it("should not publish for read-only file tools (view_file)", async () => {
            await router.requestDecision({
                ...baseNonAutoApproveRequest,
                tool: "view_file",
                organizationId: 42,
            });

            expect(mockPublish).not.toHaveBeenCalled();
        });

        it("should not publish for low-risk routine tools (browse_web)", async () => {
            await router.requestDecision({
                ...baseNonAutoApproveRequest,
                tool: "browse_web",
                organizationId: 42,
            });

            expect(mockPublish).not.toHaveBeenCalled();
        });

        it("should not publish for low-risk routine tools (google_search)", async () => {
            await router.requestDecision({
                ...baseNonAutoApproveRequest,
                tool: "google_search",
                organizationId: 42,
            });

            expect(mockPublish).not.toHaveBeenCalled();
        });

        it("should not publish for trusted system shell", async () => {
            await router.requestDecision({
                ...baseNonAutoApproveRequest,
                tool: "shell",
                params: { command: "ps aux" },
                approverId: "system",
                organizationId: 42,
            });

            expect(mockPublish).not.toHaveBeenCalled();
        });

        it("should not publish for safe diagnostic shell commands", async () => {
            await router.requestDecision({
                ...baseNonAutoApproveRequest,
                tool: "shell",
                params: { command: "ps -ef | wc -l" },
                organizationId: 42,
            });

            expect(mockPublish).not.toHaveBeenCalled();
        });

        it("should not publish for get_blackboard tool", async () => {
            await router.requestDecision({
                ...baseNonAutoApproveRequest,
                tool: "get_blackboard",
                organizationId: 42,
            });

            expect(mockPublish).not.toHaveBeenCalled();
        });
    });

    describe("Requirement 7.4: Payload serialization matches expected JSON structure", () => {
        it("should publish decision:new with correct payload structure", async () => {
            mockPublish.mockResolvedValueOnce(1);

            await router.requestDecision({
                ...baseNonAutoApproveRequest,
                timeoutMs: 100,
                noWait: true,
            });

            // Find the publish call for the decisions channel
            const decisionPublishCalls = mockPublish.mock.calls.filter(
                (call: unknown[]) => typeof call[0] === "string" && (call[0] as string).startsWith("decisions:")
            );

            expect(decisionPublishCalls.length).toBeGreaterThanOrEqual(1);

            const [channel, payloadJson] = decisionPublishCalls[0];
            expect(channel).toBe("decisions:42");

            const payload = JSON.parse(payloadJson as string);
            expect(payload).toMatchObject({
                type: "decision:new",
                requestId: 99,
                toolName: "sql_query",
                riskLevel: "high",
                description: "Execute deployment script on production",
                missionId: 7,
            });

            // Verify required fields are present
            expect(payload.eventId).toBeDefined();
            expect(typeof payload.eventId).toBe("string");
            expect(payload.eventId.length).toBeGreaterThan(0);
            expect(payload.createdAt).toBeDefined();
            expect(new Date(payload.createdAt).toISOString()).toBe(payload.createdAt);
        });

        it("should use goal as fallback when description is undefined", async () => {
            mockPublish.mockResolvedValueOnce(1);

            await router.requestDecision({
                ...baseNonAutoApproveRequest,
                description: undefined,
                goal: "My fallback goal",
                timeoutMs: 100,
                noWait: true,
            });

            const decisionPublishCalls = mockPublish.mock.calls.filter(
                (call: unknown[]) => typeof call[0] === "string" && (call[0] as string).startsWith("decisions:")
            );

            expect(decisionPublishCalls.length).toBeGreaterThanOrEqual(1);
            const payload = JSON.parse(decisionPublishCalls[0][1] as string);
            expect(payload.description).toBe("My fallback goal");
        });

        it("should include null missionId when mission is not set", async () => {
            mockPublish.mockResolvedValueOnce(1);

            await router.requestDecision({
                ...baseNonAutoApproveRequest,
                missionId: undefined,
                timeoutMs: 100,
                noWait: true,
            });

            const decisionPublishCalls = mockPublish.mock.calls.filter(
                (call: unknown[]) => typeof call[0] === "string" && (call[0] as string).startsWith("decisions:")
            );

            expect(decisionPublishCalls.length).toBeGreaterThanOrEqual(1);
            const payload = JSON.parse(decisionPublishCalls[0][1] as string);
            expect(payload.missionId).toBeNull();
        });

        it("should serialize payload as valid JSON string", async () => {
            mockPublish.mockResolvedValueOnce(1);

            await router.requestDecision({
                ...baseNonAutoApproveRequest,
                timeoutMs: 100,
                noWait: true,
            });

            const decisionPublishCalls = mockPublish.mock.calls.filter(
                (call: unknown[]) => typeof call[0] === "string" && (call[0] as string).startsWith("decisions:")
            );

            expect(decisionPublishCalls.length).toBeGreaterThanOrEqual(1);
            const payloadStr = decisionPublishCalls[0][1] as string;

            // Should be valid JSON
            expect(() => JSON.parse(payloadStr)).not.toThrow();
        });
    });

    describe("publishResolution", () => {
        it("should publish decision:resolved with correct payload structure", async () => {
            mockPublish.mockResolvedValueOnce(1);

            await router.publishResolution(42, 10, "approved");

            expect(mockPublish).toHaveBeenCalledTimes(1);
            const [channel, payloadJson] = mockPublish.mock.calls[0];
            expect(channel).toBe("decisions:10");

            const payload = JSON.parse(payloadJson as string);
            expect(payload).toMatchObject({
                type: "decision:resolved",
                requestId: 42,
                newStatus: "approved",
            });
            expect(payload.eventId).toBeDefined();
            expect(payload.resolvedAt).toBeDefined();
            expect(new Date(payload.resolvedAt).toISOString()).toBe(payload.resolvedAt);
        });

        it("should handle publish failure in publishResolution without throwing", async () => {
            mockPublish.mockRejectedValueOnce(new Error("Redis down"));

            // Should not throw
            await expect(
                router.publishResolution(42, 10, "rejected")
            ).resolves.toBeUndefined();

            expect(mockLoggerError).toHaveBeenCalledWith(
                expect.stringContaining("Failed to publish"),
                expect.any(Error)
            );
        });
    });
});
