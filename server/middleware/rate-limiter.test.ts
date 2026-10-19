import { describe, expect, it, vi } from "vitest";

const keys: string[] = [];
vi.mock("../domain/core/infrastructure/redis/redis-client.js", () => ({
    redis: {
        incr: vi.fn(async (key: string) => { keys.push(key); return 1; }),
        pexpire: vi.fn(async () => 1),
        pttl: vi.fn(async () => 1000),
    },
}));

const { createRateLimiter } = await import("./rate-limiter");

async function keyFor(ip: string): Promise<string> {
    keys.length = 0;
    const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 5 });
    const req = { ip, originalUrl: "/s/abc?x=1", socket: {} } as any;
    const res = { setHeader: vi.fn() } as any;
    await limiter(req, res, vi.fn());
    return keys[0];
}

describe("createRateLimiter default key", () => {
    // Keyed on the full address, one IPv6 client could rotate through its
    // block and get a fresh limit with every request.
    it("groups IPv6 addresses from the same /56 under one key", async () => {
        const a = await keyFor("2001:db8:1:2:3:4:5:6");
        const b = await keyFor("2001:db8:1:2:ffff::1");
        expect(a).toBe("ratelimit:/s/abc:2001:db8:1::/56");
        expect(b).toBe(a);
    });

    it("keeps IPv4 addresses as they are", async () => {
        expect(await keyFor("203.0.113.9")).toBe("ratelimit:/s/abc:203.0.113.9");
    });
});
