/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { configureTestEnvironment } from "../../../../../tests/configure-test-environment.js";

/**
 * Phase 6 exit, against a real database: one succession response filled in across
 * a cycle by the candidate, HR and the committee. The LRI is re-scored as each
 * stage lands, the candidate never receives HR's flight risk, and republishing the
 * form mid-cycle leaves an in-flight response on the questions it started with.
 */

configureTestEnvironment();

const { db } = await import("@server/database_service.js");
const { hilForms } = await import("@shared/schema/index.js");
const { orgs } = await import("@shared/schema/auth.js");
const { formStudioService: studio } = await import("../../core/form-studio.service.js");
const { formStudioStages: stages } = await import("../../core/form-studio-stages.service.js");
const { successionAnswers, successionForm } = await import("@shared/form-studio-stages.fixture.js");

let reachable = false;
try {
    await db.execute("SELECT 1" as any);
    reachable = true;
} catch (e: any) {
    console.warn(
        `[form-studio-stages] SKIPPED — no test database reachable (${e?.message ?? e}). `
        + `Set TEST_DATABASE_URL and run npm run test:db:setup.`,
    );
}

const stamp = Date.now();

describe.skipIf(!reachable)("Staged Form Studio responses across a cycle", () => {
    let orgId: number;
    let otherOrgId: number;
    let formId: number;
    let ctx: any;

    beforeAll(async () => {
        const [org] = await db.insert(orgs).values({ name: `Studio stages ${stamp}`, slug: `studio-stages-${stamp}` } as any).returning();
        const [other] = await db.insert(orgs).values({ name: `Studio stages other ${stamp}`, slug: `studio-stages-other-${stamp}` } as any).returning();
        orgId = org.id;
        otherOrgId = other.id;
        ctx = { organizationId: orgId, userId: undefined, isAdmin: false, isSuperAdmin: false, isOrgAdmin: false };
        const form = await studio.create("Succession review", ctx, { schema: successionForm() });
        formId = form.id;
        await studio.publish(formId, 0, ctx);
    });

    afterAll(async () => {
        if (!orgId) return;
        await db.delete(hilForms).where(eq(hilForms.organizationId, orgId));
        await db.delete(orgs).where(eq(orgs.id, orgId));
        if (otherOrgId) await db.delete(orgs).where(eq(orgs.id, otherOrgId));
    });

    it("carries one response through candidate, HR and committee, re-scoring the LRI after each stage", async () => {
        const cycle = { cycleId: 900_000 + (stamp % 99_999) };
        const started = await stages.start(formId, orgId, cycle);
        expect(started).toMatchObject({ formId, releaseNumber: 1, nextStageId: "candidate" });
        expect(await stages.findOpen(formId, orgId, cycle)).toBe(started.responseId);
        expect(await stages.findOpen(formId, otherOrgId, cycle)).toBeNull();

        const candidate = await stages.submit(started.responseId, "candidate", successionAnswers.candidate, orgId, { type: "external", email: "candidate@example.com" });
        expect(candidate).toMatchObject({ complete: false, nextStageId: "hr", pipelineOutput: { status: null, values: { score_vis: 93, lri: "" } } });

        const hr = await stages.submit(started.responseId, "hr", successionAnswers.hr, orgId, { type: "agent", agent: "HR Data Agent" }, {
            leadership_360_score: { source: "Q3 360 survey export, row 14" },
        });
        expect(hr.pipelineOutput.values.lri).toBeCloseTo(96.5625, 6);
        expect(hr.pipelineOutput.status).toBe("PRIMARY_SUCCESSOR_CERTIFIED");

        const committeeView = await stages.view(started.responseId, "committee", orgId);
        expect(committeeView.earlier[1].answers.find((a) => a.key === "leadership_360_score")?.source).toBe("Q3 360 survey export, row 14");

        const committee = await stages.submit(started.responseId, "committee", successionAnswers.committee, orgId, { type: "user", userId: "committee-chair" });
        expect(committee).toMatchObject({ complete: true, nextStageId: null, pipelineOutput: { status: "PRIMARY_SUCCESSOR_CERTIFIED", formStudioResponseId: started.responseId } });

        const [row] = await db.select().from(hilForms).where(eq(hilForms.id, started.responseId));
        expect(row).toMatchObject({ kind: "response", status: "completed", organizationId: orgId });
        expect(row.submittedAt).toBeInstanceOf(Date);
        const ledger = (row.config as any).formStudioResponse.stages;
        expect(ledger.map((s: any) => [s.stageId, s.submittedBy.type, s.status])).toEqual([
            ["candidate", "external", null], ["hr", "agent", "PRIMARY_SUCCESSOR_CERTIFIED"], ["committee", "user", "PRIMARY_SUCCESSOR_CERTIFIED"],
        ]);
        expect(ledger.map((s: any) => s.computed.lri)).toEqual(["", 96.5625, 96.5625]);
        expect((row.data as any).lri).toBeCloseTo(96.5625, 6);
        expect(await stages.findOpen(formId, orgId, cycle)).toBeNull();

        const candidateView = await stages.view(started.responseId, "candidate", orgId);
        const serialized = JSON.stringify(candidateView);
        expect(serialized).not.toContain("flight_risk_tier");
        expect(serialized).not.toContain("Low_Risk_Committed");
        expect(serialized).not.toContain("96.5625");
        expect(candidateView.inputs).toEqual(successionAnswers.candidate);
    });

    it("refuses a stage out of order, a stage already in, and a response from another organization", async () => {
        const { responseId } = await stages.start(formId, orgId, { missionRunId: 424242 });
        await expect(stages.submit(responseId, "hr", successionAnswers.hr, orgId, { type: "user", userId: "hr" }))
            .rejects.toThrow("HR data comes after Candidate self-assessment, which has not been submitted yet.");
        await stages.submit(responseId, "candidate", successionAnswers.candidate, orgId, { type: "external", email: "c@example.com" });
        await expect(stages.submit(responseId, "candidate", successionAnswers.candidate, orgId, { type: "external", email: "c@example.com" }))
            .rejects.toThrow("Candidate self-assessment has already been submitted.");
        await expect(stages.view(responseId, "hr", otherOrgId)).rejects.toThrow("Staged response not found.");
        await expect(stages.submit(responseId, "hr", successionAnswers.hr, otherOrgId, { type: "user", userId: "hr" })).rejects.toThrow("Staged response not found.");
        await expect(stages.start(formId, otherOrgId)).rejects.toThrow("Form not found.");
    });

    it("keeps an in-flight response on the release it started on when the form is republished", async () => {
        const { responseId } = await stages.start(formId, orgId, { cycleId: 777_000 + (stamp % 999) });

        const changed = successionForm();
        changed.fields.push({ key: "hr_attestation", label: "HR attestation", type: "text", required: true, pageId: "hr" } as any);
        const saved = await studio.save(formId, 0, { schema: changed }, ctx);
        const republished = await studio.publish(formId, saved.revision, ctx);
        expect(republished.releaseNumber).toBe(2);

        await stages.submit(responseId, "candidate", successionAnswers.candidate, orgId, { type: "external", email: "c@example.com" });
        const hrView = await stages.view(responseId, "hr", orgId);
        expect(hrView.releaseNumber).toBe(1);
        expect(hrView.definition.fields.some((f) => f.key === "hr_attestation")).toBe(false);
        const hr = await stages.submit(responseId, "hr", successionAnswers.hr, orgId, { type: "user", userId: "hr" });
        expect(hr.pipelineOutput.values.lri).toBeCloseTo(96.5625, 6);

        const fresh = await stages.start(formId, orgId, { cycleId: 778_000 + (stamp % 999) });
        expect(fresh.releaseNumber).toBe(2);
        await stages.submit(fresh.responseId, "candidate", successionAnswers.candidate, orgId, { type: "external", email: "c@example.com" });
        await expect(stages.submit(fresh.responseId, "hr", successionAnswers.hr, orgId, { type: "user", userId: "hr" }))
            .rejects.toThrow(/hr_attestation/);
    });
});
