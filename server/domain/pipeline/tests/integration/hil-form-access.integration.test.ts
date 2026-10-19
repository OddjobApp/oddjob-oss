/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { configureTestEnvironment } from "../../../../../tests/configure-test-environment.js";

/**
 * Legacy HIL form access, against a real database.
 *
 * GET/PUT/DELETE /api/forms/:id used to look forms up by id alone, and PUT wrote
 * the raw request body. These tests pin the scoped replacement: a caller in one
 * org cannot read or change another org's forms, and the allow-list holds.
 *
 * Runs against the pinned test database (TEST_DATABASE_URL); skips loudly without one.
 */

configureTestEnvironment();

const { db } = await import("@server/database_service.js");
const { hilForms } = await import("@shared/schema/index.js");
const { orgs } = await import("@shared/schema/auth.js");
const { hilFormAccess } = await import("../../core/hil-form-access.service.js");

let reachable = false;
try {
    await db.execute("SELECT 1" as any);
    reachable = true;
} catch (e: any) {
    console.warn(
        `[hil-form-access] SKIPPED — no test database reachable (${e?.message ?? e}). `
        + `Set TEST_DATABASE_URL and run npm run test:db:setup.`,
    );
}

const stamp = Date.now();

describe.skipIf(!reachable)("HIL form access is scoped to the caller's organization", () => {
    let orgA: number;
    let orgB: number;
    let template: any;
    let request: any;

    const ctx = (organizationId: number | null, extra: Record<string, unknown> = {}) =>
        ({ organizationId, userId: undefined, isAdmin: false, isSuperAdmin: false, isOrgAdmin: false, ...extra }) as any;

    beforeAll(async () => {
        const [a] = await db.insert(orgs).values({ name: `HIL scope A ${stamp}`, slug: `hil-scope-a-${stamp}` } as any).returning();
        const [b] = await db.insert(orgs).values({ name: `HIL scope B ${stamp}`, slug: `hil-scope-b-${stamp}` } as any).returning();
        orgA = a.id;
        orgB = b.id;

        [template] = await db.insert(hilForms).values({
            name: `Template ${stamp}`,
            organizationId: orgA,
            status: "active",
            schema: {
                fields: [
                    { key: "reason", type: "text", label: "Reason", required: true },
                    { key: "total", type: "computed", label: "Total", formula: "1 + 1" },
                ],
            },
        }).returning();

        [request] = await db.insert(hilForms).values({
            name: `Request ${stamp}`,
            organizationId: orgA,
            status: "pending",
            schema: { fields: [] },
        }).returning();
    });

    afterAll(async () => {
        if (!orgA || !orgB) return;
        await db.delete(hilForms).where(inArray(hilForms.organizationId, [orgA, orgB]));
        await db.delete(orgs).where(inArray(orgs.id, [orgA, orgB]));
    });

    it("reads a form only from its own organization", async () => {
        expect((await hilFormAccess.get(template.id, ctx(orgA))).id).toBe(template.id);
        await expect(hilFormAccess.get(template.id, ctx(orgB))).rejects.toThrow(/not found/i);
    });

    it("treats a caller with no organization as having none, not as seeing every tenant", async () => {
        await expect(hilFormAccess.get(template.id, ctx(null))).rejects.toThrow(/not found/i);
    });

    it("changes nothing when another organization updates, archives or marks a form viewed", async () => {
        await expect(hilFormAccess.update(template.id, { description: "hijacked" }, ctx(orgB))).rejects.toThrow(/not found/i);
        await expect(hilFormAccess.archive(template.id, ctx(orgB))).rejects.toThrow(/not found/i);
        await expect(hilFormAccess.markViewed(request.id, ctx(orgB))).rejects.toThrow(/not found/i);

        const [row] = await db.select().from(hilForms).where(eq(hilForms.id, template.id));
        expect(row.description).toBeNull();
        expect(row.isArchived).toBe(false);
    });

    it("refuses to move a form into another organization through an update", async () => {
        await expect(hilFormAccess.update(template.id, { organizationId: orgB }, ctx(orgA))).rejects.toThrow(/organizationId/);

        const [row] = await db.select().from(hilForms).where(eq(hilForms.id, template.id));
        expect(row.organizationId).toBe(orgA);
    });

    it("archives without deleting, and restores through an update", async () => {
        const archived = await hilFormAccess.archive(template.id, ctx(orgA));
        expect(archived.isArchived).toBe(true);
        await expect(hilFormAccess.getBlockForm(template.id, ctx(orgA))).rejects.toThrow(/not found/i);

        const restored = await hilFormAccess.update(template.id, { isArchived: false }, ctx(orgA));
        expect(restored.isArchived).toBe(false);
    });

    it("maps a form for the instant-app block without its computed fields", async () => {
        const { form } = await hilFormAccess.getBlockForm(template.id, ctx(orgA));
        expect(form.fields.map((field) => field.id)).toEqual(["reason"]);
    });

    it("refuses to submit a template as if it were a pending request", async () => {
        await expect(hilFormAccess.submit(template.id, ctx(orgA), { reason: "x" }, undefined)).rejects.toThrow(/pending request/);
    });

    it("names missing required fields before anything is stored", async () => {
        await expect(hilFormAccess.submitBlockForm(template.id, ctx(orgA), {}, undefined)).rejects.toThrow(/Required: Reason/);
    });

    it("says why a template without an output dataset cannot take a block submission", async () => {
        await expect(hilFormAccess.submitBlockForm(template.id, ctx(orgA), { reason: "x" }, undefined)).rejects.toThrow(/no output dataset/);
    });

    it("creates templates as active, in the caller's organization, and refuses a step link", async () => {
        const created = await hilFormAccess.createTemplate({ name: `Authored ${stamp}` }, orgA, undefined);
        expect(created.status).toBe("active");
        expect(created.organizationId).toBe(orgA);

        await expect(hilFormAccess.createTemplate({ name: "Linked", stepExecutionId: 5 }, orgA, undefined)).rejects.toThrow(/stepExecutionId/);
        await expect(hilFormAccess.createTemplate({ name: "Elsewhere", organizationId: orgB }, orgA, undefined)).rejects.toThrow(/organizationId/);
    });
});
