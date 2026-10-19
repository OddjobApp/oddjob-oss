import { describe, expect, it, vi, beforeEach } from "vitest";

const getWorkers = vi.fn();
const getJobs = vi.fn();
vi.mock("@domain/apps/infrastructure/forge-queue.js", () => ({
    forgeQueue: {
        getWorkers: (...a: unknown[]) => getWorkers(...a),
        getJobs: (...a: unknown[]) => getJobs(...a),
    },
}));

const listDrafts = vi.fn();
const updateDraft = vi.fn();
vi.mock("@domain/apps/core/forge-draft.service.js", () => ({
    forgeDraftService: {
        listDrafts: (...a: unknown[]) => listDrafts(...a),
        updateDraft: (...a: unknown[]) => updateDraft(...a),
    },
}));

import {
    getForgeExecutorHealth,
    resetForgeExecutorHealthCache,
    runsForgeWorkerInProcess,
    findStaleForgeDrafts,
    markStaleForgeDrafts,
} from "@domain/apps/core/forge-executor-health.service.js";

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

beforeEach(() => {
    getWorkers.mockReset().mockResolvedValue([]);
    getJobs.mockReset().mockResolvedValue([]);
    listDrafts.mockReset().mockResolvedValue([]);
    updateDraft.mockReset().mockResolvedValue(undefined);
    resetForgeExecutorHealthCache();
    delete process.env.SKIP_WORKERS;
    delete process.env.ENABLED_WORKERS;
});

/**
 * A forge request is accepted in one process and executed in another. Accepting
 * one with nothing to run it strands the build forever, which is what
 * "the API must never accept a Forge request unless an execution path exists"
 * is about.
 */
describe("runsForgeWorkerInProcess", () => {
    it("runs the worker when workers are not skipped", () => {
        expect(runsForgeWorkerInProcess({} as any)).toBe(true);
    });

    it("does not run it when a separate fleet is expected", () => {
        expect(runsForgeWorkerInProcess({ SKIP_WORKERS: "true" } as any)).toBe(false);
    });

    /*
     * A single-process deployment says so by naming forge outright. Starting one
     * unconditionally under SKIP_WORKERS would give the fleet a second worker on
     * the same queue, and a long build gets reclaimed mid-flight.
     */
    it("runs it when this deployment names forge explicitly", () => {
        expect(runsForgeWorkerInProcess({ SKIP_WORKERS: "true", ENABLED_WORKERS: "forge,signal-feeds" } as any)).toBe(true);
        expect(runsForgeWorkerInProcess({ SKIP_WORKERS: "true", ENABLED_WORKERS: "signal-feeds" } as any)).toBe(false);
    });
});

describe("getForgeExecutorHealth", () => {
    it("reports in-process when this process runs the worker", async () => {
        const health = await getForgeExecutorHealth(true);
        expect(health.available).toBe(true);
        expect(health.location).toBe("in-process");
        // No queue round trip is needed to answer that.
        expect(getWorkers).not.toHaveBeenCalled();
    });

    it("asks the queue who is listening when the worker is elsewhere", async () => {
        process.env.SKIP_WORKERS = "true";
        getWorkers.mockResolvedValue([{ id: "w1" }, { id: "w2" }]);

        const health = await getForgeExecutorHealth(true);
        expect(health.available).toBe(true);
        expect(health.location).toBe("queue");
        expect(health.workerCount).toBe(2);
    });

    it("refuses when a fleet is expected and none is connected", async () => {
        process.env.SKIP_WORKERS = "true";
        getWorkers.mockResolvedValue([]);

        const health = await getForgeExecutorHealth(true);
        expect(health.available).toBe(false);
        expect(health.reason).toContain("No App Forge worker");
        expect(health.reason).toContain("ENABLED_WORKERS=forge");
    });

    /*
     * Treating an unreachable Redis as "probably fine" is how a build gets
     * accepted into a queue nobody can read.
     */
    it("treats an unreachable queue as no executor", async () => {
        process.env.SKIP_WORKERS = "true";
        getWorkers.mockRejectedValue(new Error("ECONNREFUSED"));

        const health = await getForgeExecutorHealth(true);
        expect(health.available).toBe(false);
        expect(health.reason).toContain("ECONNREFUSED");
    });

    it("reuses a recent answer rather than asking per request", async () => {
        process.env.SKIP_WORKERS = "true";
        getWorkers.mockResolvedValue([{ id: "w1" }]);

        await getForgeExecutorHealth(true);
        await getForgeExecutorHealth();
        await getForgeExecutorHealth();

        expect(getWorkers).toHaveBeenCalledTimes(1);
    });
});

/**
 * A draft is written before the job is queued and updated by the worker as it
 * runs, so a worker that dies leaves a draft saying "running" for good — and
 * the studio shows a progress row that will never advance.
 */
describe("findStaleForgeDrafts", () => {
    it("finds an active draft that no queued job matches", async () => {
        listDrafts.mockResolvedValue([
            { jobId: "job-1", slug: "ops", name: "Ops", status: "running", updatedAt: minutesAgo(90) },
        ]);

        const stale = await findStaleForgeDrafts(1);
        expect(stale).toHaveLength(1);
        expect(stale[0].jobId).toBe("job-1");
        expect(stale[0].ageMinutes).toBeGreaterThanOrEqual(89);
    });

    /*
     * Age alone is not staleness. A long build is not a dead one, so a draft
     * whose job is still in the queue is left alone however old it is.
     */
    it("leaves a long build alone while its job is still queued", async () => {
        listDrafts.mockResolvedValue([
            { jobId: "job-1", slug: "ops", status: "running", updatedAt: minutesAgo(120) },
        ]);
        getJobs.mockResolvedValue([{ data: { jobId: "job-1" } }]);

        expect(await findStaleForgeDrafts(1)).toEqual([]);
    });

    it("leaves a recent draft alone without paying for a queue read", async () => {
        listDrafts.mockResolvedValue([
            { jobId: "job-1", slug: "ops", status: "running", updatedAt: minutesAgo(2) },
        ]);

        expect(await findStaleForgeDrafts(1)).toEqual([]);
        expect(getJobs).not.toHaveBeenCalled();
    });

    it("ignores drafts that already finished", async () => {
        listDrafts.mockResolvedValue([
            { jobId: "job-1", slug: "ops", status: "completed", updatedAt: minutesAgo(500) },
            { jobId: "job-2", slug: "ops", status: "failed", updatedAt: minutesAgo(500) },
        ]);

        expect(await findStaleForgeDrafts(1)).toEqual([]);
    });

    it("still reports age-based candidates when the queue cannot be read", async () => {
        listDrafts.mockResolvedValue([
            { jobId: "job-1", slug: "ops", status: "queued", updatedAt: minutesAgo(90) },
        ]);
        getJobs.mockRejectedValue(new Error("redis down"));

        expect(await findStaleForgeDrafts(1)).toHaveLength(1);
    });

    it("ignores a draft with an unreadable timestamp rather than calling it stale", async () => {
        listDrafts.mockResolvedValue([{ jobId: "job-1", slug: "ops", status: "running", updatedAt: "nonsense" }]);
        expect(await findStaleForgeDrafts(1)).toEqual([]);
    });
});

describe("markStaleForgeDrafts", () => {
    it("stops a stalled draft claiming to be running, and says how to recover", async () => {
        listDrafts.mockResolvedValue([
            { jobId: "job-1", slug: "ops", status: "running", updatedAt: minutesAgo(90) },
        ]);

        const marked = await markStaleForgeDrafts(1);

        expect(marked).toHaveLength(1);
        expect(updateDraft).toHaveBeenCalledWith("job-1", expect.objectContaining({ status: "failed" }));
        expect(updateDraft.mock.calls[0][1].message).toContain("resume or retry");
    });

    /*
     * Deliberately does not restart anything. A build that died halfway has
     * already written files and may hold a container; re-running it unattended
     * can produce a second one. Automatic recovery is unsafe here, so a person
     * decides.
     */
    it("does not requeue the job it marked", async () => {
        listDrafts.mockResolvedValue([
            { jobId: "job-1", slug: "ops", status: "running", updatedAt: minutesAgo(90) },
        ]);

        await markStaleForgeDrafts(1);
        expect(getJobs).toHaveBeenCalled();
        // Nothing was added back to the queue.
        expect(updateDraft).toHaveBeenCalledTimes(1);
    });

    it("does nothing when there is nothing stale", async () => {
        expect(await markStaleForgeDrafts(1)).toEqual([]);
        expect(updateDraft).not.toHaveBeenCalled();
    });
});
