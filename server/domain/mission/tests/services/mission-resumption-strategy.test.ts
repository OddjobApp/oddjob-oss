/**
 * Which execution strategies resumeMissionRun can actually restart.
 *
 * It had branches for rolling_wave, dynamic_autonomous and parallel_fan_out only.
 * pre_planned — 388 of 423 missions in the dev database — fell through all of
 * them, so a resume set status back to "active", bumped updated_at and queued no
 * work. The stale-run watchdog then re-detected the same run and repeated that 37
 * times over 9 hours on mission 500 before it was triaged as failed. Nothing
 * logged, because falling through the if/else chain looked exactly like success.
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
    scheduleMissionWave: vi.fn().mockResolvedValue(undefined),
    queueMissionCycle: vi.fn().mockResolvedValue(undefined),
    resumeSequence: vi.fn().mockResolvedValue(undefined),
    warn: vi.fn(),
    strategy: "pre_planned" as string | null,
    selectCall: 0,
    runStatus: "active",
    update: vi.fn(),
}));

const RUN = { id: 7, status: "active", missionId: 10, createdBy: "u1", organizationId: 1, resumeCondition: null, missionContext: {} };

vi.mock("@server/database_service.js", () => ({
    db: {
        // First select() resolves the mission run, second resolves the parent mission.
        select: () => ({
            from: () => ({
                where: () => ({
                    limit: () => {
                        h.selectCall += 1;
                        return h.selectCall === 1 ? [{ ...RUN, status: h.runStatus }] : [{ id: 10, executionStrategy: h.strategy }];
                    },
                }),
            }),
        }),
        update: (...args: unknown[]) => { h.update(...args); return { set: () => ({ where: () => ({ returning: () => [{ id: RUN.id }] }) }) }; },
    },
}));
vi.mock("@server/utils/logger.js", () => ({
    createLogger: () => ({ info: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: h.warn }),
}));
vi.mock("@domain/mission/core/mission-correlation.service.js", () => ({
    missionCorrelationService: {}, correlatedLog: vi.fn(),
}));
vi.mock("@domain/mission/infrastructure/rolling-wave-queue.js", () => ({ scheduleMissionWave: h.scheduleMissionWave }));
vi.mock("@domain/mission/infrastructure/dynamic-mission-queue.js", () => ({ queueMissionCycle: h.queueMissionCycle }));
vi.mock("@domain/mission/core/mission-execution.service.js", () => ({
    missionExecutionService: { resumeSequence: h.resumeSequence },
}));

import { missionResumptionService } from "@domain/mission/core/mission-resumption.service.js";

beforeEach(() => {
    vi.clearAllMocks();
    h.selectCall = 0;
    h.runStatus = "active";
});

describe("resumeMissionRun strategy dispatch", () => {
    it.each(["failed", "completed", "cancelled", "timeout"])("never resurrects a %s run", async (status) => {
        h.runStatus = status;
        await missionResumptionService.resumeMissionRun(RUN.id);
        expect(h.update).not.toHaveBeenCalled();
        expect(h.resumeSequence).not.toHaveBeenCalled();
        expect(h.scheduleMissionWave).not.toHaveBeenCalled();
        expect(h.queueMissionCycle).not.toHaveBeenCalled();
    });
    it("re-enters the sequence for a pre_planned run", async () => {
        h.strategy = "pre_planned";
        await missionResumptionService.resumeMissionRun(RUN.id);
        expect(h.resumeSequence).toHaveBeenCalledWith(RUN.id);
    });

    it("still schedules a wave for rolling_wave", async () => {
        h.strategy = "rolling_wave";
        await missionResumptionService.resumeMissionRun(RUN.id);
        expect(h.scheduleMissionWave).toHaveBeenCalled();
        expect(h.resumeSequence).not.toHaveBeenCalled();
    });

    it("still queues a cycle for dynamic_autonomous", async () => {
        h.strategy = "dynamic_autonomous";
        await missionResumptionService.resumeMissionRun(RUN.id);
        expect(h.queueMissionCycle).toHaveBeenCalled();
        expect(h.resumeSequence).not.toHaveBeenCalled();
    });

    it.each([["human_driven"], [null]])(
        "warns loudly instead of silently doing nothing for %s",
        async (strategy) => {
            h.strategy = strategy as string | null;
            await missionResumptionService.resumeMissionRun(RUN.id);

            expect(h.resumeSequence).not.toHaveBeenCalled();
            expect(h.scheduleMissionWave).not.toHaveBeenCalled();
            expect(h.queueMissionCycle).not.toHaveBeenCalled();
            expect(h.warn).toHaveBeenCalledWith(expect.stringContaining("no restart path"));
        },
    );
});
