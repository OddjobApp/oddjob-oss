import { describe, it, expect, vi, beforeEach } from "vitest";
import { swarmCommunicationService, SwarmMessage } from "./swarm-communication.service.js";
import { redis, redisService } from "@domain/core/infrastructure/redis/redis-client.js";
import { queueService } from "@domain/core/infrastructure/queue/queue-service.js";

vi.mock("@domain/core/infrastructure/redis/redis-client.js", () => ({
    redis: {
        sadd: vi.fn().mockResolvedValue(1),
        expire: vi.fn().mockResolvedValue(1),
        smembers: vi.fn().mockResolvedValue(["agent-1", "agent-2"]),
        publish: vi.fn().mockResolvedValue(1),
    },
    redisService: {
        publisher: {
            publish: vi.fn().mockResolvedValue(1)
        },
        subscriber: {
            subscribe: vi.fn(),
            on: vi.fn()
        },
        client: {
            sadd: vi.fn().mockResolvedValue(1),
            expire: vi.fn().mockResolvedValue(1),
            smembers: vi.fn().mockResolvedValue(["agent-1", "agent-2"])
        }
    }
}));

vi.mock("@domain/core/infrastructure/queue/queue-service.js", () => ({
    queueService: {
        systemQueue: {},
        addJobWithTrace: vi.fn().mockResolvedValue({})
    }
}));

describe("SwarmCommunicationService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("should broadcast a message using Redis Pub/Sub", async () => {
        const payload = { test: "data" };
        const message = await swarmCommunicationService.broadcast("mesh-1", "sender-1", payload);

        expect(message.targetSwarmId).toBe("mesh-1");
        expect(message.type).toBe("broadcast");
        expect(redisService.publisher.publish).toHaveBeenCalledWith(
            "swarm:mesh-1:broadcast",
            expect.stringContaining('"test":"data"')
        );
    });

    it("should fallback to system queue if Redis broadcast fails", async () => {
        vi.mocked(redisService.publisher.publish).mockRejectedValueOnce(new Error("Redis Down"));

        await swarmCommunicationService.broadcast("mesh-1", "sender-1", { test: "fallback" });

        expect(queueService.addJobWithTrace).toHaveBeenCalledWith(
            expect.anything(),
            "swarm-broadcast",
            expect.objectContaining({ swarmId: "mesh-1" })
        );
    });

    it("should register heartbeats in Redis", async () => {
        await swarmCommunicationService.heartbeat("mesh-1", "agent-1");

        expect(redis.sadd).toHaveBeenCalledWith("swarm:mesh-1:members", "agent-1");
        expect(redis.expire).toHaveBeenCalledWith("swarm:mesh-1:members", 60);
    });

    it("should fetch swarm members from Redis", async () => {
        const members = await swarmCommunicationService.getMembers("mesh-1");
        expect(members).toEqual(["agent-1", "agent-2"]);
        expect(redis.smembers).toHaveBeenCalledWith("swarm:mesh-1:members");
    });
});


