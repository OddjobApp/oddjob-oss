/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { configureTestEnvironment } from "../../../../../tests/configure-test-environment.js";

/**
 * Phase 7 exit, against a real database: the succession bench gate computes from
 * real responses. "No emergency-ready successor on the bench" used to be a box the
 * committee ticked; here it is `cohort.ready_now_bench == 0`, counted over the
 * form's completed responses, so the first certified candidate raises the bench
 * alert and the next one does not.
 */

configureTestEnvironment();

const { db } = await import("@server/database_service.js");
const { hilForms } = await import("@shared/schema/index.js");
const { orgs } = await import("@shared/schema/auth.js");
const { studioDefinitionSchema } = await import("@shared/form-studio.js");
const { formStudioService: studio } = await import("../../core/form-studio.service.js");
const { formStudioStages: stages } = await import("../../core/form-studio-stages.service.js");
const { successionAnswers, successionForm } = await import("@shared/form-studio-stages.fixture.js");

let reachable = false;
try {
    await db.execute("SELECT 1" as any);
    reachable = true;
} catch (e: any) {
    console.warn(
        `[form-studio-cohorts] SKIPPED — no test database reachable (${e?.message ?? e}). `
        + `Set TEST_DATABASE_URL and run npm run test:db:setup.`,
    );
}

const stamp = Date.now();
const certified = "readiness_horizon == 'Emergency_Ready_Now' && lri >= 85";

function benchGatedSuccession() {
    const definition = successionForm();
    definition.fields = definition.fields.map((field) => field.key === "gate_zero_emergency_ready_now_successors"
        ? { key: field.key, label: field.label, type: "computed", pageId: "committee", formula: "cohort.ready_now_bench == 0" } as any
        : field);
    definition.studio.cohorts = [
        { id: "ready_now_bench", label: "Certified ready-now successors", aggregate: "count", where: certified },
        { id: "certified_lri", label: "Readiness index of the certified", aggregate: "avg", field: "lri", where: certified },
    ];
    definition.studio.results.push({ id: "bench", title: "Against the certified bench", type: "cohort", audience: "reviewer", field: "lri", metric: "certified_lri" } as any);
    return studioDefinitionSchema.parse(definition);
}

describe.skipIf(!reachable)("Cohort metrics from real responses", () => {
    let orgId: number;
    let ctx: any;
    let formId: number;
    const committee = { committee_notes: successionAnswers.committee.committee_notes };

    async function throughHr() {
        const { responseId } = await stages.start(formId, orgId);
        await stages.submit(responseId, "candidate", successionAnswers.candidate, orgId, { type: "external", email: "candidate@example.com" });
        const hr = await stages.submit(responseId, "hr", successionAnswers.hr, orgId, { type: "user", userId: "hr" });
        return { responseId, hr };
    }

    beforeAll(async () => {
        const [org] = await db.insert(orgs).values({ name: `Studio cohorts ${stamp}`, slug: `studio-cohorts-${stamp}` } as any).returning();
        orgId = org.id;
        ctx = { organizationId: orgId, userId: undefined, isAdmin: false, isSuperAdmin: false, isOrgAdmin: false };
        const form = await studio.create("Succession review", ctx, { schema: benchGatedSuccession() });
        formId = form.id;
        expect(form.checks).toEqual([]);
        await studio.publish(formId, 0, ctx);
    });

    afterAll(async () => {
        if (!orgId) return;
        await db.delete(hilForms).where(eq(hilForms.organizationId, orgId));
        await db.delete(orgs).where(eq(orgs.id, orgId));
    });

    it("raises the bench alert for the first certified candidate, and not for the next", async () => {
        const first = await throughHr();
        expect(first.hr.pipelineOutput).toMatchObject({ status: "CRITICAL_BENCH_DEFICIT_BOARD_ALERT", values: { gate_zero_emergency_ready_now_successors: true, "cohort.ready_now_bench": 0 } });
        const done = await stages.submit(first.responseId, "committee", committee, orgId, { type: "user", userId: "chair" });
        expect(done.complete).toBe(true);

        // A response still being filled in is not part of anyone's cohort.
        const second = await throughHr();
        const third = await throughHr();
        expect(second.hr.pipelineOutput).toMatchObject({ status: "PRIMARY_SUCCESSOR_CERTIFIED", values: { gate_zero_emergency_ready_now_successors: false, "cohort.ready_now_bench": 1 } });
        expect(third.hr.pipelineOutput.values["cohort.ready_now_bench"]).toBe(1);

        const view = await stages.view(second.responseId, "committee", orgId);
        expect(view.results.find((r) => r.id === "bench")).toMatchObject({
            type: "cohort", value: 96.5625, metric: { id: "certified_lri", value: 96.5625, rows: 1, asOf: expect.any(String) },
        });
        expect(view.cohort.ready_now_bench).toMatchObject({ value: 1, rows: 1 });

        const [row] = await db.select().from(hilForms).where(eq(hilForms.id, second.responseId));
        const hrStage = (row.config as any).formStudioResponse.stages[1];
        expect(hrStage.cohort.ready_now_bench).toMatchObject({ value: 1, rows: 1 });
        expect(Object.keys(row.data as object).some((name) => name.startsWith("cohort."))).toBe(false);
        expect((row.data as any).gate_zero_emergency_ready_now_successors).toBe(false);

        // The candidate's view carries no metric about other people's responses.
        const candidateView = await stages.view(second.responseId, "candidate", orgId);
        expect(candidateView.cohort).toEqual({});
        expect(candidateView.definition.studio.cohorts).toEqual([]);
    });

    it("gives a public submission its metrics, and keeps them out of the stored answers", async () => {
        const definition = studioDefinitionSchema.parse({
            fields: [
                { key: "score", label: "Score", type: "number", required: true },
                { key: "above_average", label: "Above the average", type: "computed", formula: "score > cohort.average_score" },
            ],
            studio: {
                version: 2,
                pages: [{ id: "page_1", title: "Score" }],
                cohorts: [{ id: "average_score", label: "Average score", aggregate: "avg", field: "score" }],
                results: [{ id: "against", title: "Against everyone so far", type: "cohort", audience: "respondent", field: "score", metric: "average_score" }],
            },
        });
        const form = await studio.create(`Pulse ${stamp}`, ctx, { schema: definition });
        const { href } = await studio.publish(form.id, 0, ctx);
        const token = href.split("/").pop()!;

        const first = await studio.submit(token, 0, { score: 10 });
        expect(first.results[0]).toMatchObject({ type: "cohort", value: 10, metric: { value: "", rows: 0 } });
        const second = await studio.submit(token, 0, { score: 20 });
        expect(second.results[0]).toMatchObject({ type: "cohort", value: 20, metric: { value: 10, rows: 1 } });

        const [row] = await db.select().from(hilForms).where(eq(hilForms.id, second.id));
        expect(row.data).toEqual({ score: 20, above_average: true });
        expect((row.config as any).formStudioResponse.cohort.average_score).toMatchObject({ value: 10, rows: 1 });
    });
});
