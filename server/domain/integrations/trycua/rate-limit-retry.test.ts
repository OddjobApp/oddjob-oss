/** @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import { executeRespectingRateLimit } from "./rate-limit-retry.js";

describe("executeRespectingRateLimit", () => {
    it("waits the time the rate limiter names, then retries", async () => {
        const sleep = vi.fn(async () => {});
        const run = vi.fn()
            .mockRejectedValueOnce(new Error("Trycua action rate limit exceeded; retry in 412ms"))
            .mockResolvedValueOnce("done");
        await expect(executeRespectingRateLimit(run, sleep)).resolves.toBe("done");
        expect(sleep).toHaveBeenCalledWith(462);
        expect(run).toHaveBeenCalledTimes(2);
    });

    it("gives up after two retries, and never retries other errors", async () => {
        const sleep = vi.fn(async () => {});
        const limited = vi.fn().mockRejectedValue(new Error("Trycua action rate limit exceeded; retry in 10ms"));
        await expect(executeRespectingRateLimit(limited, sleep)).rejects.toThrow(/rate limit/);
        expect(limited).toHaveBeenCalledTimes(3);

        const broken = vi.fn().mockRejectedValue(new Error("Unknown key: foo"));
        await expect(executeRespectingRateLimit(broken, sleep)).rejects.toThrow("Unknown key");
        expect(broken).toHaveBeenCalledTimes(1);
    });
});
