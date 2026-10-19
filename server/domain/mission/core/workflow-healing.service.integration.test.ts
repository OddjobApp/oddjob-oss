import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { missions, missionRuns, orgs, pipelines, pipelineExecutions } from "@shared/schema/index.js";

// A run closing fires its terminal-state side effects (trust graph, compaction, notifications…).
// They are not what this suite is about, so they are stubbed; the run's own status write is real.
vi.mock("./mission-lifecycle-hooks.js", () => ({
    MissionLifecycleHooks: { onMissionTerminalState: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock("@domain/core/infrastructure/event-stream.service.js", () => ({
    eventStream: { publish: vi.fn().mockResolvedValue("id"), on: vi.fn(), emit: vi.fn() },
}));

import { workflowHealingService, MAX_WATCHDOG_RESUMES, STALE_RUN_MINUTES } from "./workflow-healing.service.js";
import { missionRunService } from "./mission-run.service.js";

/**
 * The stale-run healer used to resume every idle active run. When a run's pipeline
 * execution had already finished — the executor skipped the pipeline-complete hook on
 * the resume-after-approval path — that relaunched the pipeline and put the same step
 * back up for human approval, a dozen times over four days for runs 160 and 177. Every
 * wake-up also refreshed updated_at, so the 60-minute reaper never reached those runs.
 */
describe("WorkflowHealingService stale-run handling", () => {
    let orgId: number;
    let pipelineId: number;
    let resume: ReturnType<typeof vi.spyOn>;
    const longAgo = () => new Date(Date.now() - (STALE_RUN_MINUTES + 20) * 60 * 1000);

    beforeEach(async () => {
        const [org] = await db.insert(orgs).values({ name: `Healer Test ${Date.now()}-${Math.random()}` }).returning();
        orgId = org.id;
        const [p] = await db.insert(pipelines).values({ name: "p", triggerType: "manual", organizationId: orgId, createdBy: "t" } as any).returning();
        pipelineId = p.id;
        resume = vi.spyOn(missionRunService, "resumeMissionRun").mockResolvedValue(undefined as any);
    });

    afterEach(() => resume.mockRestore());

    async function staleRun(opts: { execStatus?: string; sequence?: number[]; context?: Record<string, unknown>; lastCheckpointAt?: Date } = {}) {
        const [m] = await db.insert(missions).values({
            name: "m", organizationId: orgId, createdBy: "t", status: "active", executionStrategy: "pre_planned",
        } as any).returning();
        const [r] = await db.insert(missionRuns).values({
            missionId: m.id, name: "r", organizationId: orgId, status: "active", createdBy: "t",
            pipelineSequence: opts.sequence ?? [pipelineId],
            missionContext: opts.context ?? {},
            lastCheckpointAt: opts.lastCheckpointAt ?? longAgo(),
            updatedAt: longAgo(),
        } as any).returning();
        let execution: any = null;
        if (opts.execStatus) {
            [execution] = await db.insert(pipelineExecutions).values({
                pipelineId, status: opts.execStatus, organizationId: orgId, createdBy: "t", missionId: m.id, missionRunId: r.id,
            } as any).returning();
            await db.update(missionRuns).set({ pipelineExecutionId: execution.id, updatedAt: longAgo() }).where(eq(missionRuns.id, r.id));
        }
        const [fresh] = await db.select().from(missionRuns).where(eq(missionRuns.id, r.id));
        return { run: fresh, execution };
    }

    const reload = async (id: number) => (await db.select().from(missionRuns).where(eq(missionRuns.id, id)))[0];

    it("closes a run whose execution already COMPLETED instead of relaunching it", async () => {
        const { run, execution } = await staleRun({ execStatus: "completed" });

        expect(await workflowHealingService.handleStaleRun(run, execution)).toBe("reconciled");

        expect((await reload(run.id)).status).toBe("completed");
        expect(resume).not.toHaveBeenCalled();
    });

    it("fails a run whose execution already FAILED instead of relaunching it", async () => {
        const { run, execution } = await staleRun({ execStatus: "failed" });

        expect(await workflowHealingService.handleStaleRun(run, execution)).toBe("reconciled");

        expect((await reload(run.id)).status).toBe("failed");
        expect(resume).not.toHaveBeenCalled();
    });

    it.each(["waiting_external_input", "waiting_async"])("leaves a run whose execution is %s alone", async (status) => {
        const { run, execution } = await staleRun({ execStatus: status });

        expect(await workflowHealingService.handleStaleRun(run, execution)).toBe("skipped_waiting");

        const after = await reload(run.id);
        expect(after.status).toBe("active");
        expect(after.updatedAt.getTime()).toBe(run.updatedAt.getTime());
        expect(resume).not.toHaveBeenCalled();
    });

    it.each(["cancelled", "timeout"])("does not relaunch an execution that was %s", async (status) => {
        const { run, execution } = await staleRun({ execStatus: status });
        expect(await workflowHealingService.handleStaleRun(run, execution)).toBe("skipped_ended");
        expect(resume).not.toHaveBeenCalled();
    });

    it(`resumes a genuinely stuck run at most ${MAX_WATCHDOG_RESUMES} times, then stops touching it for the reaper`, async () => {
        const { run } = await staleRun({ execStatus: "running" });
        const execution = { id: 1, status: "running" };

        for (let i = 1; i <= MAX_WATCHDOG_RESUMES; i++) {
            const current = await reload(run.id);
            expect(await workflowHealingService.handleStaleRun(current, execution)).toBe("resumed");
            expect(((await reload(run.id)).missionContext as any)._watchdog.resumeAttempts).toBe(i);
        }
        expect(resume).toHaveBeenCalledTimes(MAX_WATCHDOG_RESUMES);

        const capped = await reload(run.id);
        expect(await workflowHealingService.handleStaleRun(capped, execution)).toBe("skipped_resume_cap");
        expect(resume).toHaveBeenCalledTimes(MAX_WATCHDOG_RESUMES);
        // No write at all, so updated_at keeps aging toward the reaper's threshold.
        expect((await reload(run.id)).updatedAt.getTime()).toBe(capped.updatedAt.getTime());
    });

    it("resets the wake-up count once the run checkpoints again", async () => {
        const old = longAgo();
        const { run } = await staleRun({
            lastCheckpointAt: new Date(Date.now() - 5 * 60 * 1000), // progressed since the count began
            context: { _watchdog: { resumeAttempts: MAX_WATCHDOG_RESUMES, sinceCheckpointAt: old.toISOString() } },
        });

        expect(await workflowHealingService.handleStaleRun(run, null)).toBe("resumed");
        expect(((await reload(run.id)).missionContext as any)._watchdog.resumeAttempts).toBe(1);
    });

    it("the scan only examines idle active runs, and routes them through the same decisions", async () => {
        const { run: finished } = await staleRun({ execStatus: "completed" });
        const [m] = await db.insert(missions).values({ name: "fresh", organizationId: orgId, createdBy: "t", status: "active" } as any).returning();
        const [fresh] = await db.insert(missionRuns).values({
            missionId: m.id, name: "fresh", organizationId: orgId, status: "active", createdBy: "t",
        } as any).returning();

        await workflowHealingService.scanForStaleMissions();

        expect((await reload(finished.id)).status).toBe("completed");
        expect(resume).not.toHaveBeenCalledWith(fresh.id);
        expect(resume).not.toHaveBeenCalledWith(finished.id);
    });
});
