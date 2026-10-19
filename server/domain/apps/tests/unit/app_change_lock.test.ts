import { describe, expect, it, vi, beforeEach } from "vitest";

/** Minimal in-memory stand-in with real SET NX semantics. */
const store = new Map<string, string>();
vi.mock("@domain/core/infrastructure/redis/redis-client.js", () => ({
    redis: {
        set: async (key: string, value: string, _ex: string, _ttl: number, nx?: string) => {
            if (nx === "NX" && store.has(key)) return null;
            store.set(key, value);
            return "OK";
        },
        get: async (key: string) => store.get(key) ?? null,
        del: async (key: string) => (store.delete(key) ? 1 : 0),
    },
}));

import { claimAppChange, isAppChanging } from "@domain/apps/core/app-change-lock.service.js";

beforeEach(() => store.clear());

/**
 * Applying a change rewrites an app's workspace and rebuilds its container.
 * Two of those at once against the same workspace interleave writes and race
 * the rebuild, so the second has to be refused.
 */
describe("claimAppChange", () => {
    it("lets one change through", async () => {
        expect(await claimAppChange(42)).not.toBeNull();
    });

    it("refuses a second change while the first holds the app", async () => {
        await claimAppChange(42);
        expect(await claimAppChange(42)).toBeNull();
    });

    it("does not block a different app", async () => {
        await claimAppChange(42);
        expect(await claimAppChange(43)).not.toBeNull();
    });

    it("frees the app when the change finishes", async () => {
        const lock = await claimAppChange(42);
        await lock!.release();
        expect(await claimAppChange(42)).not.toBeNull();
    });

    /*
     * release() runs in a finally, and the failure path can reach it twice.
     * A second release must not free a lock a LATER change now holds.
     */
    it("is safe to release twice, and does not free the next holder's claim", async () => {
        const first = await claimAppChange(42);
        await first!.release();

        const second = await claimAppChange(42);
        expect(second).not.toBeNull();

        await first!.release();
        expect(await isAppChanging(42)).toBe(true);
        expect(await claimAppChange(42)).toBeNull();
    });

    it("reports whether a change is in flight", async () => {
        expect(await isAppChanging(42)).toBe(false);
        const lock = await claimAppChange(42);
        expect(await isAppChanging(42)).toBe(true);
        await lock!.release();
        expect(await isAppChanging(42)).toBe(false);
    });
});
