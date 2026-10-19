/**
 * Bug Triage trigger — the fire-and-forget cycle launch behind dataset 71.
 *
 * This logic was duplicated between addItem and addItems (67 identical lines,
 * already drifting in their error handling) and had no test coverage at all.
 * It is now one helper, and these are the guarantees the two call sites rely on.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const launchCycle = vi.fn();
const publish = vi.fn();

vi.mock("../../../mission/core/cycle-manager.service.js", () => ({
    CycleManagerService: {
        get launchCycle() {
            return launchCycle;
        },
    },
}));

vi.mock("../../../core/infrastructure/event-stream.service.js", () => ({
    eventStream: {
        get publish() {
            return publish;
        },
    },
}));

// The helper reads the cycle manifest off disk; serve it from memory instead.
vi.mock("fs/promises", () => ({
    default: { readFile: vi.fn().mockResolvedValue(MANIFEST_YAML) },
    readFile: vi.fn().mockResolvedValue(MANIFEST_YAML),
}));

const MANIFEST_YAML = `
missions:
  - id: intake
    name: Intake
    objective: Collect the defect
    type: mission
  - id: classify
    name: Classify
    objective: Classify the defect
    trigger: on_success(intake)
`;

const { launchBugTriageCycles } = await import(
    "../../core/dataset/item-service.js"
);

const item = (id: number, summary = "Checkout crashes") =>
    ({ id, data: { bug_summary: summary, description: "stack trace" } }) as any;

const orgContext = (organizationId: number | null) =>
    ({ organizationId, userId: "u-1" }) as any;

describe("launchBugTriageCycles", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        launchCycle.mockResolvedValue({ id: 900 });
        publish.mockResolvedValue(undefined);
    });

    it("launches one cycle and one intervention per item", async () => {
        await launchBugTriageCycles([item(1), item(2)], orgContext(7));

        expect(launchCycle).toHaveBeenCalledTimes(2);
        expect(publish).toHaveBeenCalledTimes(2);

        // Every launch is attributed to the caller's org, never a default.
        for (const call of launchCycle.mock.calls) {
            expect(call[1]).toBe("u-1");
            expect(call[2]).toBe(7);
        }
        for (const call of publish.mock.calls) {
            expect(call[2]).toEqual({ organizationId: 7 });
        }
    });

    it("builds the cycle from the manifest, carrying the dependency edge", async () => {
        await launchBugTriageCycles([item(1)], orgContext(7));

        const [cycleData] = launchCycle.mock.calls[0];
        expect(cycleData.name).toContain("Checkout crashes");
        expect(cycleData.blueprints).toHaveLength(2);
        // `trigger: on_success(intake)` becomes a finish_to_start dependency.
        expect(cycleData.blueprints[1].dependencies).toEqual([
            { blueprintName: "Intake", type: "finish_to_start" },
        ]);
        expect(cycleData.blueprints[0].dependencies).toEqual([]);
    });

    it("launches nothing when the org cannot be resolved", async () => {
        await launchBugTriageCycles([item(1)], orgContext(null));

        expect(launchCycle).not.toHaveBeenCalled();
        expect(publish).not.toHaveBeenCalled();
    });

    it("keeps going when one item fails", async () => {
        launchCycle
            .mockRejectedValueOnce(new Error("cycle manager unavailable"))
            .mockResolvedValueOnce({ id: 901 });

        await launchBugTriageCycles([item(1), item(2)], orgContext(7));

        expect(launchCycle).toHaveBeenCalledTimes(2);
        // Only the surviving item published its intervention.
        expect(publish).toHaveBeenCalledTimes(1);
    });

    it("never rejects, so it cannot fail the insert that triggered it", async () => {
        launchCycle.mockRejectedValue(new Error("everything is down"));

        await expect(
            launchBugTriageCycles([item(1)], orgContext(7)),
        ).resolves.toBeUndefined();
    });

    it("does no work for an empty batch", async () => {
        await launchBugTriageCycles([], orgContext(7));
        expect(launchCycle).not.toHaveBeenCalled();
    });
});
