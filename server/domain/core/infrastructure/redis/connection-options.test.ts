import { describe, expect, it } from "vitest";
import { redisConnectionOptions } from "./connection-options.js";

describe("Redis connection options for queues", () => {
    it("uses the configured service hostname and database rather than localhost", () => {
        expect(redisConnectionOptions({ REDIS_URL: "redis://redis-service:6380/4" }))
            .toEqual({ host: "redis-service", port: 6380, db: 4 });
    });

    it("preserves TLS and decodes ACL credentials", () => {
        expect(redisConnectionOptions({ REDIS_URL: "rediss://queue%2Duser:p%40ss@managed-redis:6381/2" }))
            .toEqual({ host: "managed-redis", port: 6381, db: 2, username: "queue-user", password: "p@ss", tls: {} });
    });

    it("supports the explicit password override", () => {
        expect(redisConnectionOptions({ REDIS_URL: "redis://:old@redis/0", REDIS_PASSWORD: "new" }).password).toBe("new");
    });

    it("uses the default local Redis when no URL is set", () => {
        expect(redisConnectionOptions({})).toEqual({ host: "127.0.0.1", port: 6379, db: 0 });
    });

    it("preserves host and port configuration when no URL is supplied", () => {
        expect(redisConnectionOptions({ REDIS_HOST: "legacy-redis", REDIS_PORT: "6382" }))
            .toEqual({ host: "legacy-redis", port: 6382, db: 0 });
    });

    it("gives the URL precedence over legacy host and port variables", () => {
        expect(redisConnectionOptions({ REDIS_URL: "redis://queue-redis:6380", REDIS_HOST: "wrong", REDIS_PORT: "1" }))
            .toEqual({ host: "queue-redis", port: 6380, db: 0 });
    });

    it("accepts an IPv6 address", () => {
        expect(redisConnectionOptions({ REDIS_URL: "redis://[::1]:6380/1" }).host).toBe("::1");
    });

    it.each(["https://redis", "redis://redis/not-a-database", "not-a-url"])("rejects invalid configuration without echoing credentials: %s", (url) => {
        expect(() => redisConnectionOptions({ REDIS_URL: url })).toThrow(/REDIS_URL/);
    });
});
