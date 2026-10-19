/**
 * Which workers a process is allowed to start.
 *
 * The distinction under test is the one that let two App Forge workers run at
 * once: isWorkerEnabled treats an unset ENABLED_WORKERS as "everything is on",
 * which is right for the fleet process but wrong for deciding what to start in a
 * process that was explicitly told to SKIP_WORKERS. Two forge workers on one
 * queue each run a stalled-checker and each pre-warm the same dependency cache,
 * so a long build gets reclaimed mid-flight and restarted from stage 0.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The module reads ENABLED_WORKERS once, at class-definition time, so each case
// has to re-import it under the environment it is describing.
async function loadWith(enabledWorkers?: string) {
    vi.resetModules();
    if (enabledWorkers === undefined) {
        delete process.env.ENABLED_WORKERS;
    } else {
        process.env.ENABLED_WORKERS = enabledWorkers;
    }
    const mod = await import("./worker-manager.service.js");
    return mod.WorkerManagerService;
}

describe("WorkerManagerService worker gating", () => {
    const original = process.env.ENABLED_WORKERS;

    beforeEach(() => {
        vi.resetModules();
    });

    afterEach(() => {
        if (original === undefined) delete process.env.ENABLED_WORKERS;
        else process.env.ENABLED_WORKERS = original;
    });

    it("treats an unset list as every worker enabled", async () => {
        const svc = await loadWith(undefined);

        expect(svc.isWorkerEnabled("forge")).toBe(true);
        expect(svc.isWorkerEnabled("mission")).toBe(true);
    });

    it("does NOT treat an unset list as an explicit opt-in", async () => {
        // The whole point. A deployment running the dedicated worker fleet leaves
        // ENABLED_WORKERS unset; the HTTP process must not read that silence as
        // permission to start a second forge worker.
        const svc = await loadWith(undefined);

        expect(svc.isWorkerExplicitlyEnabled("forge")).toBe(false);
    });

    it("honours forge named outright, for a genuinely single-process deployment", async () => {
        const svc = await loadWith("forge");

        expect(svc.isWorkerExplicitlyEnabled("forge")).toBe(true);
    });

    it("does not let one named worker enable another", async () => {
        const svc = await loadWith("mission,schedules");

        expect(svc.isWorkerExplicitlyEnabled("forge")).toBe(false);
        expect(svc.isWorkerExplicitlyEnabled("mission")).toBe(true);
    });

    it("tolerates spaces around the names", async () => {
        const svc = await loadWith(" forge , mission ");

        expect(svc.isWorkerExplicitlyEnabled("forge")).toBe(true);
    });
});
