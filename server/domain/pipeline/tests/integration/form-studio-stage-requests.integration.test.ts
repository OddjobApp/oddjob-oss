/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { configureTestEnvironment } from "../../../../../tests/configure-test-environment.js";

/**
 * Phase 6 stage steps, against a real database: a human-approval step asks named
 * people for one stage of a cycle's response, internal people fill it in from the
 * Decision Inbox and external people from their task link, and the request is
 * completed only by submitting the stage's answers.
 *
 * The step executions are ids no pipeline has, so resuming a step finds nothing
 * waiting and does nothing; the pipeline side is pinned by the executor's own path.
 */

configureTestEnvironment();

const { db } = await import("@server/database_service.js");
const { approvalRequests, hilForms, otpCodes, users } = await import("@shared/schema/index.js");
const { orgs } = await import("@shared/schema/auth.js");
const { formStudioService: studio } = await import("../../core/form-studio.service.js");
const requests = await import("../../core/form-studio-stage-requests.service.js");
const { approvalService } = await import("@domain/integrations/core/approval.service.js");
const { successionAnswers, successionForm } = await import("@shared/form-studio-stages.fixture.js");

let reachable = false;
try {
    await db.execute("SELECT 1" as any);
    reachable = true;
} catch (e: any) {
    console.warn(
        `[form-studio-stage-requests] SKIPPED — no test database reachable (${e?.message ?? e}). `
        + `Set TEST_DATABASE_URL and run npm run test:db:setup.`,
    );
}

const stamp = Date.now();
// Step execution ids no pipeline uses.
const step = (n: number) => 2_000_000_000 - (stamp % 1_000_000) * 10 - n;
const steps = [1, 2, 3, 4, 5, 6].map(step);

describe.skipIf(!reachable)("Form Studio stage requests", () => {
    let orgId: number;
    let formId: number;
    let ctx: any;
    const hr = { id: `stage-hr-${stamp}`, email: `hr-${stamp}@example.com` };
    const outsider = { id: `stage-outsider-${stamp}`, email: `outsider-${stamp}@example.com` };
    let responseId: number;

    const open = (overrides: Partial<Parameters<typeof requests.openFormStage>[0]>) => requests.openFormStage({
        organizationId: orgId, formId, stageId: "candidate", approvers: [], jobId: 0, pipelineName: "Succession cycle", stepExecutionId: steps[0], ...overrides,
    });

    beforeAll(async () => {
        const [org] = await db.insert(orgs).values({ name: `Stage requests ${stamp}`, slug: `stage-requests-${stamp}` } as any).returning();
        orgId = org.id;
        ctx = { organizationId: orgId, userId: undefined, isAdmin: false, isSuperAdmin: false, isOrgAdmin: false };
        for (const user of [hr, outsider]) {
            await db.insert(users).values({ id: user.id, username: user.id, password: "not-used", email: user.email } as any);
        }
        const form = await studio.create("Succession review", ctx, { schema: successionForm() });
        formId = form.id;
        await studio.publish(formId, 0, ctx);
    });

    afterAll(async () => {
        if (!orgId) return;
        await db.delete(approvalRequests).where(eq(approvalRequests.organizationId, orgId));
        await db.delete(otpCodes).where(inArray(otpCodes.executionId, steps.map(String)));
        await db.delete(hilForms).where(eq(hilForms.organizationId, orgId));
        // Recording a decision writes memories for the person who made it.
        await db.execute(sql`delete from agent_long_term_memories where user_id in (${hr.id}, ${outsider.id})`);
        await db.delete(users).where(inArray(users.id, [hr.id, outsider.id]));
        // Recording a decision also files knowledge topics under the organization.
        await db.execute(sql`delete from knowledge_topics where organization_id = ${orgId}`).catch(() => undefined);
        await db.delete(orgs).where(eq(orgs.id, orgId)).catch((error: any) => {
            console.warn(`[form-studio-stage-requests] could not remove test organization ${orgId}: ${error?.message ?? error}`);
        });
    });

    it("asks each named person for the candidate's stage, and closes the other requests when one submits", async () => {
        const opened = await open({ approvers: [{ type: "external", email: "candidate@example.com" }, { type: "internal", id: hr.id }] });
        expect(opened.kind).toBe("waiting");
        if (opened.kind !== "waiting") return;
        responseId = opened.responseId;
        expect(opened.approvalRequestIds).toHaveLength(2);

        const rows = await db.select().from(approvalRequests).where(inArray(approvalRequests.id, opened.approvalRequestIds));
        expect(rows.map((r) => [r.approverType, r.approverEmail, r.status])).toEqual(expect.arrayContaining([
            ["external", "candidate@example.com", "pending"], ["internal", hr.email, "pending"],
        ]));
        expect(rows[0].modifiedOutput).toMatchObject({ kind: "form_stage", formId, responseId, stageId: "candidate", stageTitle: "Candidate self-assessment", releaseNumber: 1 });
        const external = rows.find((r) => r.approverType === "external")!;
        const internal = rows.find((r) => r.approverType === "internal")!;
        const link = { executionId: String(steps[0]), formId, requestId: external.id, email: "candidate@example.com" };

        const task = await requests.stageTaskFromToken(link);
        expect(task).toMatchObject({ status: "ready", formId, formStudioStage: { requestStatus: "pending", view: { stage: { id: "candidate", audience: "respondent" } } } });
        await expect(requests.stageTaskFromToken({ ...link, email: "someone@example.com" })).rejects.toThrow("This link is no longer valid.");

        await expect(approvalService.processDecision(internal.id, { decision: "approved" }, hr.id, hr.email))
            .rejects.toThrow("Fill in this form stage to complete it. Approving it without answers would skip the stage.");

        const submitted = await requests.completeStageFromToken(link, successionAnswers.candidate);
        expect(submitted).toMatchObject({ complete: false, alreadySubmitted: false, view: { locked: true } });

        const after = await db.select().from(approvalRequests).where(inArray(approvalRequests.id, opened.approvalRequestIds));
        expect(after.map((r) => r.status)).toEqual(["approved", "approved"]);
        const decided = after.find((r) => r.id === external.id)!;
        expect(decided.approverId).toBeNull();
        expect(decided.modifiedOutput).toMatchObject({ kind: "form_stage", formStudioResponseId: responseId, stageId: "candidate", values: { score_vis: 93 } });
        expect(after.find((r) => r.id === internal.id)!.comments).toBe(`"Candidate self-assessment" was submitted by candidate@example.com.`);

        await expect(requests.completeStageFromToken(link, successionAnswers.candidate)).rejects.toThrow("is no longer waiting for answers on this request.");
    });

    it("asks HR for the next stage of the same response, carried in mission context, and refuses anyone not asked", async () => {
        const opened = await open({ stageId: "hr", approvers: [{ type: "internal", id: hr.id }], stepExecutionId: steps[1], contextData: { formStudioResponses: { [formId]: responseId } } });
        expect(opened).toMatchObject({ kind: "waiting", responseId });
        if (opened.kind !== "waiting") return;
        const [approvalId] = opened.approvalRequestIds;

        await expect(requests.stageRequestForUser(approvalId, outsider)).rejects.toThrow("You are not asked to fill in this stage.");
        await expect(requests.completeStageForUser(approvalId, successionAnswers.hr, outsider)).rejects.toThrow("You are not asked to fill in this stage.");

        const shown = await requests.stageRequestForUser(approvalId, hr);
        expect(shown.request).toMatchObject({ id: approvalId, status: "pending", stageTitle: "HR data" });
        expect(shown.view.earlier.map((e) => e.stageId)).toEqual(["candidate"]);

        const done = await requests.completeStageForUser(approvalId, successionAnswers.hr, hr);
        expect(done).toMatchObject({ complete: false, request: { status: "approved" }, view: { locked: true } });
        const [row] = await db.select().from(approvalRequests).where(eq(approvalRequests.id, approvalId));
        expect((row.modifiedOutput as any).status).toBe("PRIMARY_SUCCESSOR_CERTIFIED");
        expect((row.modifiedOutput as any).values.lri).toBeCloseTo(96.5625, 6);
    });

    it("resumes at once for a stage already in, and fails a step asking out of order or naming no one", async () => {
        const again = await open({ stageId: "hr", stepExecutionId: steps[2], contextData: { formStudioResponses: { [formId]: responseId } } });
        expect(again).toMatchObject({ kind: "already_in", output: { formStudioResponseId: responseId, stageId: "hr", status: "PRIMARY_SUCCESSOR_CERTIFIED" } });

        const nobody = await open({ stageId: "committee", stepExecutionId: steps[3], contextData: { formStudioResponses: { [formId]: responseId } } });
        expect(nobody).toEqual({ kind: "failed", error: `"Committee review" is assigned to the succession_committee role, and this step names no one with an email address to fill it in. Add approvers to the step.` });

        const early = await open({ stageId: "hr", approvers: [{ type: "internal", id: hr.id }], stepExecutionId: steps[4] });
        expect(early).toEqual({ kind: "failed", error: `"HR data" cannot be asked for yet: "Candidate self-assessment" comes first in "Succession review".` });
    });

    it("asks for the email code before showing or taking a stage when the form requires one", async () => {
        await studio.setLinkSecurity(formId, { requireOtp: true, tokenExpirationHours: null }, ctx);
        const opened = await open({ approvers: [{ type: "external", email: "second@example.com" }], stepExecutionId: steps[5] });
        if (opened.kind !== "waiting") throw new Error(JSON.stringify(opened));
        const link = { executionId: String(steps[5]), formId, requestId: opened.approvalRequestIds[0], email: "second@example.com" };

        expect(await requests.stageTaskFromToken(link)).toEqual({ status: "otp_required", email: "second@example.com", formId });
        await expect(requests.completeStageFromToken(link, successionAnswers.candidate)).rejects.toThrow("Confirm your email address with the code before submitting.");

        await db.insert(otpCodes).values({ executionId: link.executionId, email: link.email, code: "123456", expiresAt: new Date(Date.now() + 60_000), usedAt: new Date() });
        expect(await requests.stageTaskFromToken(link)).toMatchObject({ status: "ready" });
    });
});
