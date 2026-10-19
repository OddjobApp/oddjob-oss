/**
 * Lineage Service tests
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSelect } = vi.hoisted(() => {
    const chain = (r: unknown[] = []) => ({
        from: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        then: (fn: (v: unknown) => unknown) => Promise.resolve(r).then(fn),
    });
    return { mockSelect: vi.fn(() => chain()) };
});

const createChain = (result: unknown[] = []) => ({
    from: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    then: (fn: (v: unknown) => unknown) => Promise.resolve(result).then(fn),
});

vi.mock("@server/database_service.js", () => ({
    db: {
        select: mockSelect,
    },
}));

vi.mock("../../../server/utils/logger.js", () => ({
    createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

import { lineageService } from "@domain/pipeline/core/lineage.service.js";

describe("Lineage Service", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockSelect.mockReturnValue(createChain([]));
    });

    describe("getPipelineLineage", () => {
        it("returns graph with trigger node and no steps when pipeline has no steps", async () => {
            mockSelect.mockReturnValue(createChain([]));
            const result = await lineageService.getPipelineLineage(1);
            expect(result.nodes).toHaveLength(1);
            expect(result.nodes[0]).toMatchObject({ id: "trigger", type: "trigger", data: { label: "Start" } });
            expect(result.edges).toHaveLength(0);
        });

        it("returns graph with trigger, step nodes, and explicit edges", async () => {
            const steps = [
                {
                    step: { id: 10, order: 0, outputName: "Step 1", destinationStepId: null },
                    job: { id: 1, name: "Job A", type: "api" },
                },
                {
                    step: { id: 11, order: 1, outputName: "Step 2", destinationStepId: null },
                    job: { id: 2, name: "Job B", type: "curl" },
                },
            ];
            mockSelect.mockReturnValue(createChain(steps));
            const result = await lineageService.getPipelineLineage(1);
            expect(result.nodes).toHaveLength(3); // trigger + 2 steps
            expect(result.nodes[1].data.label).toBe("Step 1");
            expect(result.nodes[2].data.label).toBe("Step 2");
            expect(result.edges).toHaveLength(2); // trigger->step1, step1->step2
            expect(result.edges[0]).toMatchObject({ source: "trigger", target: "step-10", type: "explicit" });
            expect(result.edges[1]).toMatchObject({ source: "step-10", target: "step-11", type: "explicit" });
        });

        it("uses destinationStepId when set for explicit edge", async () => {
            const steps = [
                { step: { id: 10, order: 0, outputName: "A", destinationStepId: 12 }, job: { id: 1, name: "J1", type: "api" } },
                { step: { id: 11, order: 1, outputName: "B", destinationStepId: null }, job: { id: 2, name: "J2", type: "api" } },
                { step: { id: 12, order: 2, outputName: "C", destinationStepId: null }, job: { id: 3, name: "J3", type: "api" } },
            ];
            mockSelect.mockReturnValue(createChain(steps));
            const result = await lineageService.getPipelineLineage(1);
            const destEdge = result.edges.find((e) => e.source === "step-10" && e.target === "step-12");
            expect(destEdge).toBeDefined();
            expect(destEdge?.label).toBe("Next");
        });

        it("adds implicit edges when job config references step output", async () => {
            const steps = [
                { step: { id: 10, order: 0, outputName: "Fetch", destinationStepId: null }, job: { id: 1, name: "Fetch", type: "api", config: {} } },
                {
                    step: { id: 11, order: 1, outputName: "Use", destinationStepId: null },
                    job: { id: 2, name: "Use", type: "api", config: { input: "{{step.0.output}}" } },
                },
            ];
            mockSelect.mockReturnValue(createChain(steps));
            const result = await lineageService.getPipelineLineage(1);
            const implicitEdge = result.edges.find((e) => e.type === "implicit");
            expect(implicitEdge).toBeDefined();
            expect(implicitEdge?.label).toBe("output");
        });
    });

    describe("getJobImpact", () => {
        it("returns affected pipelines and empty affectedJobs", async () => {
            const directUsage = [{ id: 1, name: "Pipeline A", stepOrder: 0 }];
            mockSelect.mockReturnValue(createChain(directUsage));
            const result = await lineageService.getJobImpact(5);
            expect(result.affectedPipelines).toEqual(directUsage);
            expect(result.affectedJobs).toEqual([]);
        });

        it("returns empty when job not used", async () => {
            mockSelect.mockReturnValue(createChain([]));
            const result = await lineageService.getJobImpact(999);
            expect(result.affectedPipelines).toEqual([]);
            expect(result.affectedJobs).toEqual([]);
        });
    });
});
