/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { configureTestEnvironment } from "../../../../../tests/configure-test-environment.js";

/**
 * HIL form kinds and the single request path, against a real database.
 *
 * hil_forms held templates, requests and Studio responses with nothing to tell them
 * apart. These tests pin the `kind` column's behaviour: requests are created as
 * requests, a request made from a template leaves the template alone, the forms
 * library lists templates, only requests accept answers, and migration 0112
 * classifies existing rows from the markers their writers left.
 */

configureTestEnvironment();

const { db } = await import("@server/database_service.js");
const { hilForms } = await import("@shared/schema/index.js");
const { orgs } = await import("@shared/schema/auth.js");
const { hilRequests } = await import("../../core/hil-requests.service.js");
const { hilFormAccess } = await import("../../core/hil-form-access.service.js");
const { hilService } = await import("../../core/hil.service.js");

let reachable = false;
try {
    await db.execute("SELECT 1" as any);
    reachable = true;
} catch (e: any) {
    console.warn(
        `[hil-requests] SKIPPED — no test database reachable (${e?.message ?? e}). `
        + `Set TEST_DATABASE_URL and run npm run test:db:setup.`,
    );
}

const stamp = Date.now();

describe.skipIf(!reachable)("HIL form kinds and the request path", () => {
    let orgId: number;
    let template: any;
    const ctx = () => ({ organizationId: orgId, userId: undefined, isAdmin: false, isSuperAdmin: false, isOrgAdmin: false }) as any;

    beforeAll(async () => {
        const [org] = await db.insert(orgs).values({ name: `HIL kinds ${stamp}`, slug: `hil-kinds-${stamp}` } as any).returning();
        orgId = org.id;
        [template] = await db.insert(hilForms).values({
            name: `Deploy sign-off ${stamp}`,
            organizationId: orgId,
            status: "active",
            schema: { fields: [{ key: "reason", type: "text", label: "Reason", required: true }] },
        }).returning();
    });

    afterAll(async () => {
        if (!orgId) return;
        await db.delete(hilForms).where(eq(hilForms.organizationId, orgId));
        await db.delete(orgs).where(eq(orgs.id, orgId));
    });

    it("creates a request marked as one, pending and unviewed, with its source", async () => {
        const request = await hilRequests.create({
            source: "cycle",
            organizationId: orgId,
            name: `Resources Required: Build ${stamp}`,
            schema: { fields: [{ key: "repo_url", type: "text", label: "Repo", required: true }] },
            announce: false,
        });
        expect(request).toMatchObject({ kind: "request", requestSource: "cycle", status: "pending", isViewed: false });
    });

    it("makes a request from a template without touching the template", async () => {
        const request = await hilRequests.createFromTemplate(template, { source: "step", organizationId: orgId, announce: false });
        expect(request.templateFormId).toBe(template.id);
        expect(request.schema).toEqual(template.schema);

        const [after] = await db.select().from(hilForms).where(eq(hilForms.id, template.id));
        expect(after).toMatchObject({ kind: "template", status: "active", stepExecutionId: null });
    });

    it("refuses to make a request from something that is not a template", async () => {
        const request = await hilRequests.create({ source: "agent", organizationId: orgId, name: "Ad hoc", schema: { fields: [] }, announce: false });
        await expect(hilRequests.createFromTemplate(request, { source: "agent", organizationId: orgId, announce: false })).rejects.toThrow(/not a template/);
    });

    it("lists only templates in the forms library unless requests are asked for", async () => {
        const library = await hilService.listForms("tester", orgId);
        expect(library.map((form) => form.id)).toEqual([template.id]);

        const requests = await hilService.listForms("tester", orgId, "request");
        expect(requests.length).toBeGreaterThan(0);
        expect(requests.every((form: any) => form.id !== template.id)).toBe(true);
    });

    it("completes a pending request and refuses to submit a template", async () => {
        const request = await hilRequests.create({ source: "app", organizationId: orgId, name: "Approve spend", schema: { fields: [] }, announce: false });
        const result = await hilFormAccess.submit(request.id, ctx(), { approved: true }, undefined);
        expect(result.status).toBe("completed");

        await expect(hilFormAccess.submit(template.id, ctx(), { reason: "x" }, undefined)).rejects.toThrow(/pending request/);
    });

    it("classifies existing rows from their writers' markers when migration 0112 runs", async () => {
        const insert = async (values: Record<string, unknown>) => {
            const [row] = await db.insert(hilForms).values({ organizationId: orgId, schema: { fields: [] }, ...values } as any).returning({ id: hilForms.id });
            return row.id;
        };
        const ids = {
            response: await insert({ name: "Survey — response", config: { formStudioResponse: { formId: 1 } } }),
            cycle: await insert({ name: "Resources Required: X", config: { type: "cycle_resource_refresh" } }),
            app: await insert({ name: "App HIL: Workbench", schema: { fields: [], sourceType: "app" } }),
            behavioral: await insert({ name: "BI Threshold: churn", schema: { fields: [], sourceType: "behavioral_intelligence" } }),
            agent: await insert({ name: "Agent HIL: migrate" }),
            step: await insert({ name: "Step input", stepExecutionId: 987654321 }),
            mutatedTemplate: await insert({ name: "Dispatch Override", stepExecutionId: 987654322, config: { formId: "dispatch_override" } }),
            builderTemplate: await insert({ name: "Old builder form", status: "pending" }),
        };

        const sql = readFileSync("migrations/runtime/0112_hil_form_kind.sql", "utf8");
        for (const statement of sql.split("--> statement-breakpoint")) {
            if (statement.replace(/--.*$/gm, "").trim()) await db.execute(statement as any);
        }

        const rows = await db.select({ id: hilForms.id, kind: hilForms.kind, requestSource: hilForms.requestSource })
            .from(hilForms).where(inArray(hilForms.id, Object.values(ids)));
        const byId = new Map(rows.map((row) => [row.id, row]));

        expect(byId.get(ids.response)).toMatchObject({ kind: "response" });
        expect(byId.get(ids.cycle)).toMatchObject({ kind: "request", requestSource: "cycle" });
        expect(byId.get(ids.app)).toMatchObject({ kind: "request", requestSource: "app" });
        expect(byId.get(ids.behavioral)).toMatchObject({ kind: "request", requestSource: "behavioral" });
        expect(byId.get(ids.agent)).toMatchObject({ kind: "request", requestSource: "agent" });
        expect(byId.get(ids.step)).toMatchObject({ kind: "request", requestSource: "step" });
        expect(byId.get(ids.mutatedTemplate)).toMatchObject({ kind: "template" });
        expect(byId.get(ids.builderTemplate)).toMatchObject({ kind: "template" });
    });
});
