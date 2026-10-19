/**
 * The gate in front of prospecting ingest.
 * @vitest-environment node
 *
 * This had no tests. It is the control deciding whose events this platform
 * accepts: an unregistered property is refused, and a registered one only from
 * its own domain — so a tag copied onto another site cannot write into someone
 * else's funnel. It was also the reason the ingestion suite failed: those tests
 * post a fixture uid no property owns, and every request was refused before it
 * reached the handler.
 *
 * Two deliberate fail-open paths are pinned here as well, because failing open
 * is a decision worth seeing rather than discovering: a database error admits
 * the request, and so does an unreachable Redis during the rate check.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { selectRows, selectThrows, redisIncr } = vi.hoisted(() => ({
    selectRows: { current: [] as unknown[] },
    selectThrows: { current: false },
    redisIncr: vi.fn(async () => 1),
}));

vi.mock("@server/database_service.js", () => ({
    db: {
        select: () => {
            const q: any = {
                from: () => q,
                where: () => q,
                limit: () =>
                    selectThrows.current
                        ? Promise.reject(new Error("connection lost"))
                        : Promise.resolve(selectRows.current),
            };
            return q;
        },
    },
}));

vi.mock("@domain/core/infrastructure/redis/redis-client.js", () => ({
    redis: { incr: redisIncr, expire: vi.fn(async () => 1) },
}));

const { propertyIngestGuard, invalidatePropertyCache } = await import("../ingest-guard.js");

const runGuard = async (
    body: unknown,
    headers: Record<string, string> = {},
    opts: { perMinute?: number } = {},
) => {
    const req: any = { body, headers };
    const res: any = {
        statusCode: 0,
        payload: undefined,
        status(code: number) { this.statusCode = code; return this; },
        json(value: unknown) { this.payload = value; return this; },
    };
    const next = vi.fn();
    await propertyIngestGuard(opts)(req, res, next);
    return { req, res, next };
};

describe("propertyIngestGuard", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        selectRows.current = [];
        selectThrows.current = false;
        redisIncr.mockResolvedValue(1);
        // The guard caches property lookups; without this each test would read
        // the previous one's answer.
        invalidatePropertyCache("prop-known");
        invalidatePropertyCache("prop-unknown");
    });

    it("refuses a payload with no propertyUid", async () => {
        const { res, next } = await runGuard({ activity: "page_view" });

        expect(res.statusCode).toBe(400);
        expect(next).not.toHaveBeenCalled();
    });

    it("refuses a property nobody has registered", async () => {
        selectRows.current = [];

        const { res, next } = await runGuard({ propertyUid: "prop-unknown" });

        expect(res.statusCode).toBe(403);
        expect(res.payload).toEqual({ error: "Unknown property" });
        expect(next).not.toHaveBeenCalled();
    });

    it("accepts a registered property from its own domain", async () => {
        selectRows.current = [{ organizationId: 7, domain: "example.com" }];

        const { req, next } = await runGuard(
            { propertyUid: "prop-known" },
            { origin: "https://example.com" },
        );

        expect(next).toHaveBeenCalled();
        expect(req.prospectProperty).toMatchObject({ found: true, organizationId: 7 });
    });

    it("accepts a subdomain of the registered domain", async () => {
        selectRows.current = [{ organizationId: 7, domain: "example.com" }];

        const { next } = await runGuard(
            { propertyUid: "prop-known" },
            { origin: "https://app.example.com" },
        );

        expect(next).toHaveBeenCalled();
    });

    it("refuses the same property from somewhere else", async () => {
        selectRows.current = [{ organizationId: 7, domain: "example.com" }];

        const { res, next } = await runGuard(
            { propertyUid: "prop-known" },
            { origin: "https://evil.example" },
        );

        expect(res.statusCode).toBe(403);
        expect(res.payload).toEqual({ error: "Origin not allowed for this property" });
        expect(next).not.toHaveBeenCalled();
    });

    it("reads the uid from the first element of a batched payload", async () => {
        selectRows.current = [{ organizationId: 7, domain: null }];

        const { next } = await runGuard([
            { propertyUid: "prop-known", activity: "page_view" },
            { propertyUid: "prop-known", activity: "click" },
        ]);

        expect(next).toHaveBeenCalled();
    });

    it("refuses once the per-minute rate is exceeded", async () => {
        selectRows.current = [{ organizationId: 7, domain: null }];
        redisIncr.mockResolvedValue(3);

        const { res, next } = await runGuard({ propertyUid: "prop-known" }, {}, { perMinute: 2 });

        expect(res.statusCode).toBe(429);
        expect(next).not.toHaveBeenCalled();
    });

    it("fails OPEN when the property lookup errors", async () => {
        selectThrows.current = true;

        const { next } = await runGuard({ propertyUid: "prop-known" });

        // Deliberate: a database blip must not silently stop collecting.
        expect(next).toHaveBeenCalled();
    });

    it("fails OPEN when Redis cannot answer the rate check", async () => {
        selectRows.current = [{ organizationId: 7, domain: null }];
        redisIncr.mockRejectedValue(new Error("redis down"));

        const { next } = await runGuard({ propertyUid: "prop-known" }, {}, { perMinute: 1 });

        expect(next).toHaveBeenCalled();
    });
});
