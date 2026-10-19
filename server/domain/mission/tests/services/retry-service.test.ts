/**
 * RetryService — surviving surface.
 *
 * This file previously covered calculateBackoff and getRecommendedBackoff as well.
 * Both were removed along with shouldRetry, the diagnosis-driven retry decision they
 * supported, which had no production callers; see retry-service.ts for why. The db,
 * drizzle, schema and diagnostics mocks that preamble needed went with them.
 *
 * getRetryAfterMs and executeWithRetry are covered by
 * server/domain/core/tests/resilience.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@server/utils/logger", () => ({
    createLogger: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }))
}));

import { RetryService } from "@domain/core/retry-service.js";

describe("RetryService", () => {
    let svc: RetryService;

    beforeEach(() => { svc = new RetryService(); });

    describe("sleep", () => {
        it("should resolve after the specified delay", async () => {
            vi.useFakeTimers();
            const promise = svc.sleep(100);
            vi.advanceTimersByTime(100);
            await expect(promise).resolves.toBeUndefined();
            vi.useRealTimers();
        });
    });
});
