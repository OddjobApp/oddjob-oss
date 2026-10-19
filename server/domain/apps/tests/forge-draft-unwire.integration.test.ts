/**
 * The Assembly Stack showed every unit as "Wired" with no way to remove one.
 *
 * The stack the user sees is a projection of the last mount_builder_pod artifact, but
 * what survives the conversation is the forge draft in Redis — options.components,
 * options.pipelineSteps and options.dataset.fields. Dropping a unit from the chat view
 * alone would leave it wired in the draft and it would return on the next deploy, so
 * removal has to reach the draft.
 *
 * Integration: it reads and writes the real Redis draft store, so it runs under
 * `npm run test:integration` (CI provisions Redis there), not the hermetic unit gate.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { redis } from "@domain/core/infrastructure/redis/redis-client.js";
import { forgeDraftService } from "@domain/apps/core/forge-draft.service.js";

const JOB = `draft_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const KEY = `forge:draft:${JOB}`;

const seed = async () => {
    await redis.setex(KEY, 300, JSON.stringify({
        jobId: JOB,
        organizationId: 342,
        blueprintSlug: "fullstack-template",
        name: "Test App",
        slug: "test-app",
        status: "draft",
        options: {
            organizationId: 342,
            components: [{ id: "field_a", name: "Field A" }, { id: "field_b", name: "Field B" }],
            pipelineSteps: [{ id: "step_1" }, { id: "step_2" }, { id: "step_3" }],
            dataset: { tableName: "t", fields: [{ id: "col_x" }, { id: "col_y" }] },
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    }));
};

beforeEach(seed);
afterAll(async () => { await redis.del(KEY); });

describe("forgeDraftService.removeDraftUnit", () => {
    it("unwires a UI field from the draft, not just the view", async () => {
        const res = await forgeDraftService.removeDraftUnit(JOB, { kind: "component", id: "field_a" });
        expect(res?.removed).toBe(true);

        const after = await forgeDraftService.getDraft(JOB);
        const ids = ((after!.options as any).components as any[]).map((c) => c.id);
        expect(ids).toEqual(["field_b"]);
    });

    it("unwires a pipeline step", async () => {
        await forgeDraftService.removeDraftUnit(JOB, { kind: "pipelineStep", id: "step_2" });
        const after = await forgeDraftService.getDraft(JOB);
        expect(((after!.options as any).pipelineSteps as any[]).map((s) => s.id)).toEqual(["step_1", "step_3"]);
    });

    it("unwires a dataset field without disturbing the table", async () => {
        await forgeDraftService.removeDraftUnit(JOB, { kind: "datasetField", id: "col_x" });
        const after = await forgeDraftService.getDraft(JOB);
        const ds = (after!.options as any).dataset;
        expect(ds.fields.map((f: any) => f.id)).toEqual(["col_y"]);
        expect(ds.tableName).toBe("t");
    });

    it("persists the removal — it survives a re-read", async () => {
        await forgeDraftService.removeDraftUnit(JOB, { kind: "component", id: "field_a" });
        const raw = await redis.get(KEY);
        expect(raw).not.toContain("field_a");
    });

    it("does not touch the other collections", async () => {
        await forgeDraftService.removeDraftUnit(JOB, { kind: "component", id: "field_a" });
        const after = await forgeDraftService.getDraft(JOB);
        expect(((after!.options as any).pipelineSteps as any[]).length).toBe(3);
    });

    it("reports removed:false when nothing matched, rather than a silent success", async () => {
        const res = await forgeDraftService.removeDraftUnit(JOB, { kind: "component", id: "does_not_exist" });
        expect(res?.removed).toBe(false);
        const after = await forgeDraftService.getDraft(JOB);
        expect(((after!.options as any).components as any[]).length).toBe(2);
    });

    it("returns null for a draft that has expired or never existed", async () => {
        const res = await forgeDraftService.removeDraftUnit("draft_nope_nope", { kind: "component", id: "x" });
        expect(res).toBeNull();
    });
});

describe("forgeDraftService.clearDraftLayer", () => {
    it("clears the UI form layer", async () => {
        const res = await forgeDraftService.clearDraftLayer(JOB, "components");
        expect(res?.removed).toBe(true);
        const after = await forgeDraftService.getDraft(JOB);
        expect((after!.options as any).components).toEqual([]);
    });

    it("clears the pipeline DAG without touching the dataset", async () => {
        await forgeDraftService.clearDraftLayer(JOB, "pipelineSteps");
        const after = await forgeDraftService.getDraft(JOB);
        expect((after!.options as any).pipelineSteps).toEqual([]);
        expect((after!.options as any).dataset.fields).toHaveLength(2);
    });

    it("deletes the dataset outright rather than emptying it", async () => {
        // An empty field list still says "make me a table"; absence says "no dataset".
        await forgeDraftService.clearDraftLayer(JOB, "dataset");
        const after = await forgeDraftService.getDraft(JOB);
        expect((after!.options as any).dataset).toBeUndefined();
    });

    it("reports removed:false when the layer was already empty", async () => {
        await forgeDraftService.clearDraftLayer(JOB, "components");
        const again = await forgeDraftService.clearDraftLayer(JOB, "components");
        expect(again?.removed).toBe(false);
    });

    it("returns null for a draft that does not exist", async () => {
        expect(await forgeDraftService.clearDraftLayer("draft_missing", "components")).toBeNull();
    });
});
