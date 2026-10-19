/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { configureTestEnvironment } from "../../../../../tests/configure-test-environment.js";

/**
 * The Form Studio runtime against a real database: a published beta form whose
 * open P0 records GA_LAUNCH_BLOCKED, raises an approval request instead of
 * running anything, and records the decision on the response.
 *
 * The runtime's own rules are covered by form-studio-runtime.test.ts. These pin
 * the writes: the approval row, and the JSON written into the response, which a
 * mistyped jsonb path would silently fail to set.
 */

configureTestEnvironment();

const { db } = await import("@server/database_service.js");
const { hilForms, approvalRequests, pipelines } = await import("@shared/schema/index.js");
const { orgs } = await import("@shared/schema/auth.js");
const { formStudioService: studio } = await import("../../core/form-studio.service.js");
const { createFormStudioRuntime } = await import("../../core/form-studio-runtime.js");
const { formStudioRuntimeDeps } = await import("../../core/form-studio-runtime.service.js");

let reachable = false;
try {
    await db.execute("SELECT 1" as any);
    reachable = true;
} catch (e: any) {
    console.warn(
        `[form-studio-runtime] SKIPPED — no test database reachable (${e?.message ?? e}). `
        + `Set TEST_DATABASE_URL and run npm run test:db:setup.`,
    );
}

const stamp = Date.now();

describe.skipIf(!reachable)("Form Studio runtime", () => {
    let orgId: number;
    let otherOrgId: number;
    let pipelineId: number;
    let foreignPipelineId: number;
    let ctx: any;

    beforeAll(async () => {
        const [org] = await db.insert(orgs).values({ name: `Studio runtime ${stamp}`, slug: `studio-runtime-${stamp}` } as any).returning();
        const [other] = await db.insert(orgs).values({ name: `Studio runtime other ${stamp}`, slug: `studio-runtime-other-${stamp}` } as any).returning();
        orgId = org.id;
        otherOrgId = other.id;
        ctx = { organizationId: orgId, userId: undefined, isAdmin: false, isSuperAdmin: false, isOrgAdmin: false };
        const [pipeline] = await db.insert(pipelines).values({ name: `Launch block incident ${stamp}`, triggerType: "event", createdBy: "test", organizationId: orgId } as any).returning();
        const [foreign] = await db.insert(pipelines).values({ name: `Other org pipeline ${stamp}`, triggerType: "event", createdBy: "test", organizationId: otherOrgId } as any).returning();
        pipelineId = pipeline.id;
        foreignPipelineId = foreign.id;
    });

    afterAll(async () => {
        for (const id of [orgId, otherOrgId].filter(Boolean)) {
            await db.delete(approvalRequests).where(eq(approvalRequests.organizationId, id));
            await db.delete(hilForms).where(eq(hilForms.organizationId, id));
            await db.delete(pipelines).where(eq(pipelines.organizationId, id));
            await db.execute(sql`DELETE FROM event_log WHERE organization_id = ${id}`).catch(() => undefined);
            await db.delete(orgs).where(eq(orgs.id, id));
        }
    });

    async function publishBeta(actionPipelineId: number) {
        const form = await studio.create(`Beta validation ${stamp}-${actionPipelineId}`, ctx);
        await studio.save(form.id, 0, {
            schema: {
                fields: [{ key: "p0_blocking_bugs_open", label: "Open P0 bugs", type: "number", required: true, pageId: "gates" }],
                studio: {
                    version: 2,
                    pages: [{ id: "gates", title: "Launch gates" }],
                    decisionRules: [{ id: "hard_stop", when: "p0_blocking_bugs_open > 0", status: "GA_LAUNCH_BLOCKED", actions: ["open_incident"] }],
                    defaultStatus: "PROCEED_TO_GENERAL_AVAILABILITY",
                    actions: [{ id: "open_incident", label: "Open the launch-block incident", type: "start_pipeline", pipelineId: actionPipelineId }],
                },
            },
        }, ctx);
        const published = await studio.publish(form.id, 1, ctx);
        return { form, token: published.href.split("/").pop()!, revision: published.revision };
    }

    const runtimeOf = async (responseId: number) => {
        const [row] = await db.select({ config: hilForms.config }).from(hilForms).where(and(eq(hilForms.id, responseId), eq(hilForms.organizationId, orgId)));
        return (row?.config as any)?.formStudioResponse?.runtime;
    };

    it("records GA_LAUNCH_BLOCKED and raises a pending approval without starting the pipeline", async () => {
        const { token, revision } = await publishBeta(pipelineId);
        const submitted = await studio.submit(token, revision, { p0_blocking_bugs_open: 1 });

        const runtime = await runtimeOf(submitted.id);
        expect(runtime.actions.open_incident).toMatchObject({ status: "awaiting_approval", approvalId: expect.any(Number) });

        const [approval] = await db.select().from(approvalRequests).where(eq(approvalRequests.id, runtime.actions.open_incident.approvalId));
        expect(approval).toMatchObject({ status: "pending", organizationId: orgId, executionId: `form_response:${submitted.id}:open_incident` });
        expect(approval.modifiedOutput).toMatchObject({ kind: "form_action", pipelineId, status: "GA_LAUNCH_BLOCKED", responseId: submitted.id });
    });

    it("writes an approval and a rejection into the response's JSON", async () => {
        const { token, revision } = await publishBeta(pipelineId);
        const first = await studio.submit(token, revision, { p0_blocking_bugs_open: 2 });
        const second = await studio.submit(token, revision, { p0_blocking_bugs_open: 3 });

        const startPipeline = vi.fn(async () => ({ success: true, executionId: 777 }));
        const runtime = createFormStudioRuntime({ ...formStudioRuntimeDeps, startPipeline });

        const [approved] = await db.select().from(approvalRequests).where(eq(approvalRequests.executionId, `form_response:${first.id}:open_incident`));
        const outcome = await runtime.onActionDecision(approved, "approved", { userId: "approver-1", email: "approver@example.com", comments: null });
        await (outcome as any).completion;
        expect(startPipeline).toHaveBeenCalledWith(expect.objectContaining({ pipelineId, organizationId: orgId }));
        expect((await runtimeOf(first.id)).actions.open_incident).toMatchObject({ status: "started", executionId: 777, decidedBy: "approver@example.com" });

        const [rejected] = await db.select().from(approvalRequests).where(eq(approvalRequests.executionId, `form_response:${second.id}:open_incident`));
        await runtime.onActionDecision(rejected, "rejected", { userId: "approver-1", email: null, comments: "Flaky test, not a P0" });
        expect((await runtimeOf(second.id)).actions.open_incident).toMatchObject({ status: "rejected", comments: "Flaky test, not a P0" });
        expect(startPipeline).toHaveBeenCalledTimes(1);
    });

    it("refuses a pipeline from another organization and raises no approval for it", async () => {
        const { token, revision } = await publishBeta(foreignPipelineId);
        const submitted = await studio.submit(token, revision, { p0_blocking_bugs_open: 1 });
        expect((await runtimeOf(submitted.id)).actions.open_incident).toMatchObject({ status: "failed", error: `Pipeline #${foreignPipelineId} is not in this organization.` });
        const approvals = await db.select().from(approvalRequests).where(eq(approvalRequests.executionId, `form_response:${submitted.id}:open_incident`));
        expect(approvals).toEqual([]);
    });
});
