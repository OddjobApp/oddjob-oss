import { describe, it, expect, vi, beforeEach } from "vitest";
import { MissionLifecycleHooks } from "./mission-lifecycle-hooks.js";
import { db } from "@server/database_service.js";
import { operationalCycles, orgs } from "@shared/schema/index.js";

// The hook dynamic-imports eventStream by this exact specifier.
const publish = vi.fn().mockResolvedValue("mock-event-id");
vi.mock("@domain/core/infrastructure/event-stream.service.js", () => ({
    eventStream: { publish },
}));

// Private static; reads the cycle from the DB by mission.cycleId, then publishes.
const runCycleStepAnnouncement = (mission: any) =>
    (MissionLifecycleHooks as any).runCycleStepAnnouncement(mission);

const flush = () => new Promise((r) => setTimeout(r, 30));

describe("MissionLifecycleHooks.runCycleStepAnnouncement", () => {
    let orgId: number;
    let cycleId: number;

    beforeEach(async () => {
        vi.clearAllMocks();
        const [org] = await db.insert(orgs).values({ name: `Cycle Step Test ${Date.now()}-${Math.random()}` }).returning();
        orgId = org.id;

        // executionPlan is the authoritative "major step" source: Alpha is on the
        // critical path, Beta is not.
        const [cycle] = await db.insert(operationalCycles).values({
            name: "Announce Test Cycle",
            objective: "test",
            organizationId: orgId,
            createdBy: "test-user",
            status: "active",
            executionPlan: {
                criticalPath: ["Alpha"],
                nodes: {
                    Alpha: { onCriticalPath: true },
                    Beta: { onCriticalPath: false },
                },
            },
        } as any).returning();
        cycleId = cycle.id;
    });

    it("announces a MAJOR (critical-path) step completion to the assistant feed", async () => {
        runCycleStepAnnouncement({ id: 5001, cycleId, name: "Alpha", missionId: null, organizationId: orgId });
        await flush();

        expect(publish).toHaveBeenCalledTimes(1);
        expect(publish).toHaveBeenCalledWith(
            "intervention.triggered",
            expect.objectContaining({
                interventionId: `cycle-step-complete-${cycleId}-5001`,
                title: "Step complete: Alpha",
                context: expect.objectContaining({ cycleId, stepName: "Alpha" }),
            }),
            expect.objectContaining({ organizationId: orgId, source: "cycle-step" }),
            "cycle-step",
        );
    });

    it("stays silent for a NON-major (off-critical-path) step", async () => {
        runCycleStepAnnouncement({ id: 5002, cycleId, name: "Beta", missionId: null, organizationId: orgId });
        await flush();
        expect(publish).not.toHaveBeenCalled();
    });

    it("does nothing when the cycle no longer exists", async () => {
        runCycleStepAnnouncement({ id: 5003, cycleId: 999999999, name: "Alpha", missionId: null, organizationId: orgId });
        await flush();
        expect(publish).not.toHaveBeenCalled();
    });
});
