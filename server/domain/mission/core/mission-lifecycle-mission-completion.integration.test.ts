import { describe, it, expect, vi, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { MissionLifecycleHooks } from "./mission-lifecycle-hooks.js";
import { missionEventBus, MissionEvent } from "./mission-event-bus.js";
import { db } from "@server/database_service.js";
import { missions, missionRuns, orgs } from "@shared/schema/index.js";

// The hook dynamic-imports eventStream by this exact specifier.
const publish = vi.fn().mockResolvedValue("mock-event-id");
vi.mock("@domain/core/infrastructure/event-stream.service.js", () => ({
    eventStream: { publish },
}));

// Private static: the mission-completion step of onMissionTerminalState.
const completeMissionIfDone = (run: any): Promise<boolean> =>
    (MissionLifecycleHooks as any).completeMissionIfDone(run);

/**
 * Nothing used to write `missions.status = 'completed'`, so every mission with a
 * finished run still read "active" and completion notifications keyed off runs.
 * The mission's own status now drives the notification.
 */
describe("MissionLifecycleHooks.completeMissionIfDone", () => {
    let orgId: number;
    const statusCompleted = vi.fn();

    beforeEach(async () => {
        vi.clearAllMocks();
        missionEventBus.removeAllListeners(MissionEvent.MISSION_STATUS_COMPLETED);
        missionEventBus.on(MissionEvent.MISSION_STATUS_COMPLETED, statusCompleted);
        const [org] = await db.insert(orgs).values({ name: `Mission Completion Test ${Date.now()}-${Math.random()}` }).returning();
        orgId = org.id;
    });

    async function mission(over: Record<string, unknown> = {}) {
        const [m] = await db.insert(missions).values({
            name: "Research the thing",
            organizationId: orgId,
            createdBy: "test-user",
            status: "active",
            ...over,
        } as any).returning();
        return m;
    }

    async function run(missionId: number, over: Record<string, unknown> = {}) {
        const [r] = await db.insert(missionRuns).values({
            missionId,
            name: "run",
            organizationId: orgId,
            status: "completed",
            createdBy: "test-user",
            ...over,
        } as any).returning();
        return r;
    }

    const statusOf = async (id: number) =>
        (await db.select({ status: missions.status }).from(missions).where(eq(missions.id, id)))[0].status;

    it("completes the mission and notifies once, by mission, not by run", async () => {
        const m = await mission();
        const r = await run(m.id, { isSuccess: true });

        expect(await completeMissionIfDone(r)).toBe(true);
        expect(await statusOf(m.id)).toBe("completed");

        expect(statusCompleted).toHaveBeenCalledTimes(1);
        expect(statusCompleted).toHaveBeenCalledWith(expect.objectContaining({
            missionId: m.id, missionRunId: r.id, missionName: "Research the thing", organizationId: orgId,
        }));
        expect(publish).toHaveBeenCalledTimes(1);
        expect(publish).toHaveBeenCalledWith(
            "intervention.triggered",
            expect.objectContaining({
                interventionId: `mission-complete-${m.id}-${r.id}`,
                title: "Mission complete: Research the thing",
                context: expect.objectContaining({ missionId: m.id, missionRunId: r.id }),
            }),
            expect.objectContaining({ organizationId: orgId, source: "mission-complete" }),
            "mission-complete",
        );
    });

    it("is idempotent: a second terminal-hook fire flips nothing and notifies nothing", async () => {
        const m = await mission();
        const r = await run(m.id);
        await completeMissionIfDone(r);
        vi.clearAllMocks();

        expect(await completeMissionIfDone(r)).toBe(false);
        expect(statusCompleted).not.toHaveBeenCalled();
        expect(publish).not.toHaveBeenCalled();
    });

    it("treats a run with no recorded outcome as successful, but not an explicit failure", async () => {
        // 9 of the 11 completed runs in dev have is_success NULL.
        const unrecorded = await mission();
        expect(await completeMissionIfDone(await run(unrecorded.id, { isSuccess: null }))).toBe(true);

        const failed = await mission();
        expect(await completeMissionIfDone(await run(failed.id, { isSuccess: false }))).toBe(false);
        expect(await statusOf(failed.id)).toBe("active");
    });

    it("leaves a scheduled mission active, because it recurs", async () => {
        const m = await mission({ isScheduled: true });
        expect(await completeMissionIfDone(await run(m.id))).toBe(false);
        expect(await statusOf(m.id)).toBe("active");
        expect(publish).not.toHaveBeenCalled();
    });

    it("waits while another run of the same mission is still open", async () => {
        const m = await mission();
        await run(m.id, { status: "active" });
        expect(await completeMissionIfDone(await run(m.id))).toBe(false);
        expect(await statusOf(m.id)).toBe("active");
    });

    it("ignores an open SHADOW run, and never completes a mission from a shadow run", async () => {
        const m = await mission();
        await run(m.id, { status: "active", isShadow: true });
        const shadow = await run(m.id, { isShadow: true });
        expect(await completeMissionIfDone(shadow)).toBe(false);

        expect(await completeMissionIfDone(await run(m.id))).toBe(true);
    });

    it("completes a cycle step's mission without a second Assistant Update", async () => {
        // The cycle-step announcement already posts for cycle runs.
        const m = await mission();
        const r = await run(m.id);
        expect(await completeMissionIfDone({ ...r, cycleId: 12345 })).toBe(true);
        expect(statusCompleted).toHaveBeenCalledTimes(1);
        expect(publish).not.toHaveBeenCalled();
    });

    it("does not double-post for a copilot research mission, which posts its answer", async () => {
        const m = await mission();
        const r = await run(m.id, { missionContext: { source: "copilot_research" } });
        expect(await completeMissionIfDone(r)).toBe(true);
        expect(publish).not.toHaveBeenCalled();
    });
});
