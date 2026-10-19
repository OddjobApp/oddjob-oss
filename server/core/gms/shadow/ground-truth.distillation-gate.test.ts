import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Automatic heuristic distillation is opt-in. When it fires, the distiller
 * overwrites any same-named skill with LLM-written code (no version snapshot,
 * shadow run or approval) and saves it with no organization, so a reliable
 * blueprint alone must not trigger it.
 */

const distill = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("../../../domain/agents/core/heuristic-distiller.service.js", () => ({
    heuristicDistillerService: { distill },
}));

import { createGroundTruthCollector } from "./ground-truth.js";

const prediction = { successProbability: 1, confidence: 1, latencyEstimate: 1, costEstimate: 0, riskFactors: [] } as any;
const actual = { successRate: 1, avgLatency: 1, totalCost: 0, failureModes: [] } as any;

async function recordReliableBlueprint() {
    const collector = createGroundTruthCollector(1000);
    for (let i = 0; i < 50; i++) collector.record(`c${i}`, prediction, actual, "reliable_blueprint");
    // The distiller is loaded with a dynamic import; let it settle.
    await new Promise((resolve) => setTimeout(resolve, 20));
}

describe("heuristic distillation gate", () => {
    const original = process.env.ENABLE_HEURISTIC_DISTILLATION;
    beforeEach(() => distill.mockClear());
    afterEach(() => {
        if (original === undefined) delete process.env.ENABLE_HEURISTIC_DISTILLATION;
        else process.env.ENABLE_HEURISTIC_DISTILLATION = original;
    });

    it("does not distill when the flag is unset", async () => {
        delete process.env.ENABLE_HEURISTIC_DISTILLATION;
        await recordReliableBlueprint();
        expect(distill).not.toHaveBeenCalled();
    });

    it("does not distill when the flag is anything but \"true\"", async () => {
        process.env.ENABLE_HEURISTIC_DISTILLATION = "false";
        await recordReliableBlueprint();
        expect(distill).not.toHaveBeenCalled();
    });

    it("distills once enabled", async () => {
        process.env.ENABLE_HEURISTIC_DISTILLATION = "true";
        await recordReliableBlueprint();
        expect(distill).toHaveBeenCalledWith("reliable_blueprint");
    });
});
