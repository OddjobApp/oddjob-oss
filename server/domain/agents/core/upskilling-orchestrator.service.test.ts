/**
 * The upskilling pipeline must not report work it did not do.
 *
 * Every tier used to end in success: prompt optimization claimed patches it never
 * applied, golden samples inserted a canned example and claimed five, fine-tuning
 * slept 800ms and registered a model id for a model that was never trained, and a
 * hardcoded 5/5 canary then wrote a "verified" competency into actor_competencies.
 * These tests pin the honest behaviour: nothing is promoted without an evaluation.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const inserted: Array<{ table: unknown; values: unknown }> = [];
const updated: unknown[] = [];

// A chainable stand-in for drizzle: every select resolves to `selectResult()`.
let selectResult: () => unknown[] = () => [];
function chain(): any {
    const c: any = {};
    for (const m of ["from", "where", "orderBy", "limit"]) c[m] = () => c;
    c.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(selectResult()).then(resolve, reject);
    return c;
}

vi.mock("@server/database_service.js", () => ({
    db: {
        select: () => chain(),
        insert: (table: unknown) => ({
            values: (values: unknown) => {
                inserted.push({ table, values });
                const r: any = Promise.resolve([{ id: 1 }]);
                r.returning = async () => [{ id: 1 }];
                return r;
            },
        }),
        update: () => ({ set: (v: unknown) => ({ where: async () => { updated.push(v); } }) }),
    },
}));

vi.mock("@server/utils/logger.js", () => ({
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock("@server/domain/core/infrastructure/event-stream.service.js", () => ({
    eventStream: { publish: vi.fn() },
}));

vi.mock("@server/domain/ai/core/fine-tuning.service.js", () => ({
    FineTuningService: class {
        async createDataset() { return { id: 77, name: "ds" }; }
    },
}));

import { UpskillingOrchestratorService } from "./upskilling-orchestrator.service.js";
import { actorCompetencies, competencies, fineTuningExamples, agentConductLogs } from "@shared/schema/index.js";
import type { UpskillingJob } from "./performance-manager.service.js";

const job = (type: UpskillingJob["type"], agentId = "12"): UpskillingJob => ({
    id: `job-${type}`,
    agentId,
    pipId: "pip-1",
    status: "queued",
    type,
    progressPercent: 0,
});

describe("UpskillingOrchestratorService", () => {
    let service: UpskillingOrchestratorService;

    beforeEach(() => {
        inserted.length = 0;
        updated.length = 0;
        selectResult = () => [];
        service = new UpskillingOrchestratorService();
    });

    const wroteCompetency = () =>
        inserted.some(i => i.table === actorCompetencies || i.table === competencies) || updated.length > 0;

    it.each(["prompt_optimization", "golden_samples", "fine_tuning"] as const)(
        "%s never promotes a competency, and ends failed with a stated reason",
        async (type) => {
            if (type === "golden_samples") selectResult = () => [{ id: 77, count: 0 }];
            const j = job(type);

            const result = await service.executeUpskilling(j, 5);

            expect(result.success).toBe(false);
            expect(j.status).toBe("failed");
            expect(j.progressPercent).toBe(100);
            expect(j.error).toBeTruthy();
            expect(wroteCompetency()).toBe(false);
        },
    );

    it("fine_tuning registers no model id, and says no model was trained", async () => {
        const j = job("fine_tuning");
        const result = await service.executeUpskilling(j, 5);

        expect(j.modelId).toBeUndefined();
        expect(j.datasetId).toBe("77");
        expect(result.resultSummary).toMatch(/No model was trained/);
        expect(result.resultSummary).not.toMatch(/LoRA Adapter|Completed SFT/);
    });

    it("the canary reports not-evaluated rather than a pass or a measured score", async () => {
        const j = job("prompt_optimization");
        const result = await service.executeUpskilling(j, 5);

        expect(result.canaryScore).toBe(0);
        expect(j.error).toMatch(/^Not verified: no canary benchmark harness exists/);
        expect(result.resultSummary).not.toMatch(/Latency improved|Zero policy violations/);
    });

    it("golden_samples inserts no canned training example", async () => {
        selectResult = () => [{ id: 77, count: 3 }];
        const result = await service.executeUpskilling(job("golden_samples"), 5);

        expect(inserted.some(i => i.table === fineTuningExamples)).toBe(false);
        expect(result.resultSummary).toMatch(/holds 3 example\(s\)\. None were curated/);
    });

    it("prompt_optimization reports the real failure count and applies no patch", async () => {
        selectResult = () => [];
        const result = await service.executeUpskilling(job("prompt_optimization"), 5);

        // It used to report max(errorCount, 3) patches applied.
        expect(result.resultSummary).toMatch(/Collected 0 recent tool failure\(s\)/);
        expect(result.resultSummary).toMatch(/No directive patch was applied/);
    });

    it("prompt_optimization files the conduct log against the real agent, never a fallback", async () => {
        await service.executeUpskilling(job("prompt_optimization", "12"), 5);
        const logs = inserted.filter(i => i.table === agentConductLogs);
        expect(logs).toHaveLength(1);
        expect((logs[0].values as any).agentId).toBe(12);

        inserted.length = 0;
        // `Number("agent-7") || 1` used to file this against agent 1.
        await service.executeUpskilling(job("prompt_optimization", "agent-7"), 5);
        expect(inserted.filter(i => i.table === agentConductLogs)).toHaveLength(0);
    });
});
