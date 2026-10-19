/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import { configureTestEnvironment } from "../../../../../tests/configure-test-environment.js";

/**
 * Phase 6, agent-filled stages, against a real database: a stage assigned to an
 * agent is answered by the organization's agent of that name from the cycle's
 * material, every answer's source is recorded with the stage, and a stage the
 * agent cannot ground is not locked. The model call is passed in.
 */

configureTestEnvironment();

const { db } = await import("@server/database_service.js");
const { hilForms, jobs } = await import("@shared/schema/index.js");
const { orgs } = await import("@shared/schema/auth.js");
const { formStudioService: studio } = await import("../../core/form-studio.service.js");
const { formStudioStages: stages } = await import("../../core/form-studio-stages.service.js");
const { openFormStage } = await import("../../core/form-studio-stage-requests.service.js");
const { successionAnswers, successionForm } = await import("@shared/form-studio-stages.fixture.js");

let reachable = false;
try {
    await db.execute("SELECT 1" as any);
    reachable = true;
} catch (e: any) {
    console.warn(
        `[form-studio-stage-agent] SKIPPED — no test database reachable (${e?.message ?? e}). `
        + `Set TEST_DATABASE_URL and run npm run test:db:setup.`,
    );
}

const stamp = Date.now();
const agentName = `HR Data Agent ${stamp}`;
const hrExport = { candidate: "J. Rivera", flight_risk: "Low_Risk_Committed", team_retention_pct: 94.5, promotions_sponsored: 4, leadership_360: 4.8 };
const sourced = (answers: Record<string, unknown>) => JSON.stringify({
    answers: Object.fromEntries(Object.entries(answers).map(([key, value]) => [key, { value, source: `mission context: hr_export (${key})` }])),
});

describe.skipIf(!reachable)("Agent-filled Form Studio stages", () => {
    let orgId: number;
    let formId: number;

    async function responseAfterCandidate() {
        const { responseId } = await stages.start(formId, orgId);
        await stages.submit(responseId, "candidate", successionAnswers.candidate, orgId, { type: "external", email: "candidate@example.com" });
        return responseId;
    }
    const openHr = (responseId: number, generate: (prompt: string) => Promise<string | null>, extra: Record<string, unknown> = {}) => openFormStage({
        organizationId: orgId, formId, stageId: "hr", approvers: [], jobId: 0, pipelineName: "Succession cycle", stepExecutionId: 1_900_000_000,
        contextData: { formStudioResponses: { [formId]: responseId }, hr_export: hrExport, ...extra },
    }, { generate });

    beforeAll(async () => {
        const [org] = await db.insert(orgs).values({ name: `Stage agent ${stamp}`, slug: `stage-agent-${stamp}` } as any).returning();
        orgId = org.id;
        const ctx = { organizationId: orgId, userId: undefined, isAdmin: false, isSuperAdmin: false, isOrgAdmin: false } as any;
        await db.insert(jobs).values({ name: agentName, type: "ai_agent", config: { systemPrompt: "You read the HR system export." }, createdBy: "tester", organizationId: orgId } as any);
        const definition = successionForm();
        definition.studio.stages[1].assignee = { type: "agent", agent: agentName };
        const form = await studio.create("Succession review", ctx, { schema: definition });
        formId = form.id;
        await studio.publish(formId, 0, ctx);
    });

    afterAll(async () => {
        if (!orgId) return;
        await db.delete(hilForms).where(eq(hilForms.organizationId, orgId));
        await db.delete(jobs).where(eq(jobs.organizationId, orgId));
        await db.delete(orgs).where(eq(orgs.id, orgId));
    });

    it("fills HR's stage from the cycle's material, recording each answer's source, after one correction", async () => {
        const responseId = await responseAfterCandidate();
        const { leadership_360_score: _later, ...withoutScore } = successionAnswers.hr;
        const generate = vi.fn()
            .mockResolvedValueOnce(sourced(withoutScore))
            .mockResolvedValueOnce(sourced(successionAnswers.hr));

        const opened = await openHr(responseId, generate);
        expect(opened).toMatchObject({ kind: "filled", output: { formStudioResponseId: responseId, stageId: "hr", status: "PRIMARY_SUCCESSOR_CERTIFIED" } });
        if (opened.kind !== "filled") return;
        expect((opened.output.values as any).lri).toBeCloseTo(96.5625, 6);

        expect(generate).toHaveBeenCalledTimes(2);
        const [firstPrompt] = generate.mock.calls[0];
        expect(firstPrompt).toContain(`You are ${agentName}`);
        expect(firstPrompt).toContain("You read the HR system export.");
        expect(firstPrompt).toContain('"leadership_360":4.8');
        expect(generate.mock.calls[1][0]).toContain("These answers were refused: 360 leadership score: This field is required.");

        const [row] = await db.select().from(hilForms).where(eq(hilForms.id, responseId));
        const hr = (row.config as any).formStudioResponse.stages[1];
        expect(hr).toMatchObject({ stageId: "hr", submittedBy: { type: "agent", agent: agentName } });
        expect(hr.provenance.leadership_360_score).toEqual({ source: "mission context: hr_export (leadership_360_score)" });

        const committee = await stages.view(responseId, "committee", orgId);
        expect(committee.earlier[1].answers.find((a) => a.key === "flight_risk_tier")?.source).toBe("mission context: hr_export (flight_risk_tier)");
    });

    it("leaves the stage open and says why when the agent cannot ground its answers", async () => {
        const responseId = await responseAfterCandidate();
        const unsourced = JSON.stringify({ answers: { flight_risk_tier: { value: "Moderate_Watch" } } });
        const opened = await openHr(responseId, vi.fn().mockResolvedValue(unsourced));
        expect(opened).toEqual({
            kind: "failed",
            error: `${agentName} could not fill in "HR data" from the cycle's material. Every answer needs a source, and these have none: flight_risk_tier.`,
        });
        expect((await stages.progress(responseId, orgId)).stages.find((s) => s.id === "hr")?.locked).toBe(false);
    });

    it("refuses an agent this organization does not have", async () => {
        const definition = successionForm();
        definition.studio.stages[1].assignee = { type: "agent", agent: "Payroll Agent" };
        const ctx = { organizationId: orgId, userId: undefined, isAdmin: false, isSuperAdmin: false, isOrgAdmin: false } as any;
        const other = await studio.create("Succession review (payroll)", ctx, { schema: definition });
        await studio.publish(other.id, 0, ctx);
        const { responseId } = await stages.start(other.id, orgId);
        await stages.submit(responseId, "candidate", successionAnswers.candidate, orgId, { type: "external", email: "candidate@example.com" });

        const generate = vi.fn();
        const opened = await openFormStage({
            organizationId: orgId, formId: other.id, stageId: "hr", approvers: [], jobId: 0, pipelineName: "Succession cycle", stepExecutionId: 1_900_000_001,
            contextData: { formStudioResponses: { [other.id]: responseId } },
        }, { generate });
        expect(opened).toEqual({ kind: "failed", error: `"HR data" is assigned to the agent Payroll Agent, and this organization has no agent by that name.` });
        expect(generate).not.toHaveBeenCalled();
    });
});
