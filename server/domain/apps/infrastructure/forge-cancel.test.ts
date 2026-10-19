/**
 * Cancelling a forge job.
 *
 * The thing worth testing is that all four places agree. Forge state lives in the
 * draft, in the `forge:job:<id>` overlay that getDraft lets WIN over the draft,
 * in the BullMQ entries that would otherwise retry the job back to life, and in
 * the per-slug lock whose survival makes the next forge for that app fail with
 * "a forge is already running". Writing three of the four looks like it worked
 * and isn't: that is how a cancelled job kept reading "building" for hours.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { store, removed, jobs, updateDraft, getDraft } = vi.hoisted(() => ({
    store: new Map<string, string>(),
    removed: [] as string[],
    jobs: { current: [] as any[] },
    updateDraft: vi.fn(async () => null),
    getDraft: vi.fn(async () => ({ jobId: "job-1", slug: "widget-app", progress: 40, stage: 3 } as any)),
}));

vi.mock("@domain/core/infrastructure/redis/redis-client.js", () => ({
    redis: {
        get: async (k: string) => (store.has(k) ? store.get(k)! : null),
        set: async (k: string, v: string) => { store.set(k, v); return "OK"; },
        del: async (k: string) => { store.delete(k); return 1; },
        keys: async (pattern: string) => {
            const prefix = pattern.replace(/\*$/, "");
            return [...store.keys()].filter(k => k.startsWith(prefix));
        },
    },
}));

vi.mock("../core/forge-draft.service.js", () => ({
    forgeDraftService: { getDraft, updateDraft },
}));

vi.mock("bullmq", () => ({
    Queue: class { async getJobs() { return jobs.current; } },
    Job: class {},
}));

vi.mock("@server/workers/base-worker.js", () => ({
    BaseWorker: class { worker = { on: () => {} }; logger = { info: () => {}, warn: () => {}, error: () => {} }; },
}));

vi.mock("@server/domain/org/core/event-bus.service.js", () => ({
    crossAppEventBus: { publish: vi.fn() },
    CrossAppEventType: {},
}));

const { cancelForgeJob, isForgeCancelled, forgeCancelKey } = await import("./forge-queue.js");

const makeJob = (jobId: string, state: string, onRemove?: () => void) => ({
    data: { jobId },
    getState: async () => state,
    remove: async () => { if (onRemove) onRemove(); removed.push(jobId); },
});

describe("cancelForgeJob", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        store.clear();
        removed.length = 0;
        jobs.current = [];
        getDraft.mockResolvedValue({ jobId: "job-1", slug: "widget-app", progress: 40, stage: 3 } as any);
    });

    it("writes the overlay, not just the draft", async () => {
        store.set("forge:job:job-1", JSON.stringify({ status: "building", progress: 40 }));

        await cancelForgeJob("job-1");

        // getDraft merges this over the draft record and lets it win, so a cancel
        // that skipped it would still read "building" everywhere.
        expect(JSON.parse(store.get("forge:job:job-1")!).status).toBe("cancelled");
        expect(updateDraft).toHaveBeenCalledWith("job-1", expect.objectContaining({ status: "cancelled" }));
    });

    it("frees the per-slug lock so the app can be forged again", async () => {
        store.set("forge:active:widget-app", "job-1");

        await cancelForgeJob("job-1");

        expect(store.has("forge:active:widget-app")).toBe(false);
    });

    it("finds the lock by job id when no draft names the slug", async () => {
        // A draft can expire — its TTL is 30 days — while the lock remains. Left
        // behind, it refuses every future forge of that app.
        getDraft.mockResolvedValue(null as any);
        store.set("forge:active:orphaned-app", "job-1");
        store.set("forge:active:someone-elses-app", "job-2");

        await cancelForgeJob("job-1");

        expect(store.has("forge:active:orphaned-app")).toBe(false);
        // Another job's lock is not collateral damage.
        expect(store.get("forge:active:someone-elses-app")).toBe("job-2");
    });

    it("removes queue entries so nothing retries the job back to life", async () => {
        jobs.current = [makeJob("job-1", "waiting"), makeJob("other", "waiting")];

        const result = await cancelForgeJob("job-1");

        expect(removed).toEqual(["job-1"]);
        expect(result.removedFromQueue).toBe(1);
        expect(result.wasRunning).toBe(false);
    });

    it("reports a running attempt rather than claiming it stopped", async () => {
        // An active job holding its lock cannot be removed; the flag is what stops
        // it, at the next stage boundary. The caller has to be able to say so.
        jobs.current = [makeJob("job-1", "active", () => { throw new Error("locked"); })];

        const result = await cancelForgeJob("job-1");

        expect(result.wasRunning).toBe(true);
        expect(result.removedFromQueue).toBe(0);
        expect(await isForgeCancelled("job-1")).toBe(true);
    });

    it("raises a flag the running pipeline can see", async () => {
        expect(await isForgeCancelled("job-1")).toBe(false);

        await cancelForgeJob("job-1", "because I said so");

        expect(await isForgeCancelled("job-1")).toBe(true);
        expect(store.get(forgeCancelKey("job-1"))).toBe("because I said so");
    });

    it("leaves an unrelated job uncancelled", async () => {
        await cancelForgeJob("job-1");

        expect(await isForgeCancelled("job-2")).toBe(false);
    });
});
