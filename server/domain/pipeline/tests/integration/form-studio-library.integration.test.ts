/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { configureTestEnvironment } from "../../../../../tests/configure-test-environment.js";

/**
 * The Forms library and what depends on a form, against a real database.
 *
 * Browsing went through the legacy /api/forms list, which mixed runtime requests
 * and stored responses in with authored forms and knew nothing of drafts,
 * releases or which pipelines use a form. A rename could silently break a
 * pipeline step that finds its form by name.
 */

configureTestEnvironment();

const { db } = await import("@server/database_service.js");
const { hilForms, jobs, missionTemplates } = await import("@shared/schema/index.js");
const { orgs } = await import("@shared/schema/auth.js");
const { reconcileTemplateForm } = await import("@shared/form-studio.js");
const { formStudioService: studio } = await import("../../core/form-studio.service.js");
const { formStudioLibrary: library } = await import("../../core/form-studio-library.service.js");

let reachable = false;
try {
    await db.execute("SELECT 1" as any);
    reachable = true;
} catch (e: any) {
    console.warn(
        `[form-studio-library] SKIPPED — no test database reachable (${e?.message ?? e}). `
        + `Set TEST_DATABASE_URL and run npm run test:db:setup.`,
    );
}

const stamp = Date.now();
const onePage = (fields: unknown[]) => ({ fields, studio: { version: 2, pages: [{ id: "page_1", title: "Form" }] } });

describe.skipIf(!reachable)("Forms library and form usage", () => {
    let orgId: number, otherOrgId: number;
    let ctx: any, otherCtx: any;
    const ids: Record<string, number> = {};
    const jobIds: number[] = [], templateIds: number[] = [];

    beforeAll(async () => {
        const [org] = await db.insert(orgs).values({ name: `Forms library ${stamp}`, slug: `forms-library-${stamp}` } as any).returning();
        const [other] = await db.insert(orgs).values({ name: `Forms library other ${stamp}`, slug: `forms-library-other-${stamp}` } as any).returning();
        orgId = org.id; otherOrgId = other.id;
        ctx = { organizationId: orgId, userId: undefined, isAdmin: false, isSuperAdmin: false, isOrgAdmin: false };
        otherCtx = { ...ctx, organizationId: otherOrgId };

        ids.draft = (await studio.create(`Dangling draft ${stamp}`, ctx)).id;
        await studio.save(ids.draft, 0, { schema: onePage([{ key: "total", label: "Total", type: "computed", formula: "price * 2" }]) }, ctx);

        ids.published = (await studio.create(`Stable form ${stamp}`, ctx)).id;
        await studio.save(ids.published, 0, { schema: onePage([{ key: "reason", label: "Reason", type: "text" }]) }, ctx);
        await studio.publish(ids.published, 1, ctx);

        ids.ahead = (await studio.create(`Edited after publishing ${stamp}`, ctx)).id;
        await studio.save(ids.ahead, 0, { schema: onePage([{ key: "reason", label: "Reason", type: "text" }]) }, ctx);
        await studio.publish(ids.ahead, 1, ctx);
        await studio.save(ids.ahead, 1, { schema: onePage([{ key: "reason", label: "Why", type: "text" }]) }, ctx);

        const [legacy] = await db.insert(hilForms).values({
            name: `Dispatch Override ${stamp}`, organizationId: orgId, status: "active",
            schema: { fields: [{ key: "reason", label: "Reason", type: "text" }] }, config: { formId: "dispatch_override" },
        }).returning();
        ids.legacy = legacy.id;

        const [archived] = await db.insert(hilForms).values({ name: `Retired form ${stamp}`, organizationId: orgId, status: "active", isArchived: true, schema: { fields: [] } }).returning();
        ids.archived = archived.id;

        const [request] = await db.insert(hilForms).values({ name: `Stable form ${stamp}`, organizationId: orgId, kind: "request", status: "pending", templateFormId: ids.published, schema: { fields: [] } }).returning();
        const [response] = await db.insert(hilForms).values({ name: "Stable — response", organizationId: orgId, kind: "response", status: "completed", isArchived: true, schema: { fields: [] }, config: { formStudioResponse: { formId: ids.published } } }).returning();
        ids.request = request.id; ids.response = response.id;

        ids.otherOrg = (await studio.create(`Someone else's form ${stamp}`, otherCtx)).id;

        const [job] = await db.insert(jobs).values({ name: `Approve dispatch ${stamp}`, type: "human_approval", config: { formId: ids.published }, createdBy: "tester", organizationId: orgId } as any).returning();
        jobIds.push(job.id);
        const [missionTemplate] = await db.insert(missionTemplates).values({
            name: `Dispatch mission ${stamp}`, organizationId: orgId, createdBy: "tester",
            config: { sequence: [{ order: 2, requiresHuman: true, formRef: `Stable form ${stamp}` }] },
        }).returning();
        templateIds.push(missionTemplate.id);
    });

    afterAll(async () => {
        if (jobIds.length) await db.delete(jobs).where(inArray(jobs.id, jobIds));
        if (templateIds.length) await db.delete(missionTemplates).where(inArray(missionTemplates.id, templateIds));
        for (const id of [orgId, otherOrgId].filter(Boolean)) {
            await db.delete(hilForms).where(eq(hilForms.organizationId, id));
            await db.delete(orgs).where(eq(orgs.id, id));
        }
    });

    it("lists this organization's authored forms, with state, counts and what uses them", async () => {
        const rows = await library.list(ctx);
        const listed = rows.map((row) => row.id);
        expect(listed).toEqual(expect.arrayContaining([ids.draft, ids.published, ids.ahead, ids.legacy]));
        for (const hidden of [ids.archived, ids.request, ids.response, ids.otherOrg]) expect(listed).not.toContain(hidden);

        const byId = new Map(rows.map((row) => [row.id, row]));
        expect(byId.get(ids.draft)).toMatchObject({ state: "draft", legacy: false, releaseNumber: null, issueCount: 1 });
        expect(byId.get(ids.ahead)).toMatchObject({ state: "draft_ahead", releaseNumber: 1 });
        expect(byId.get(ids.legacy)).toMatchObject({ legacy: true, usedBy: [{ type: "org_forge", via: "name", templateKey: "dispatch_override" }] });

        const stable = byId.get(ids.published)!;
        expect(stable).toMatchObject({ state: "published", releaseNumber: 1, responses: 1, waitingRequests: 1, issueCount: 0 });
        expect(stable.usedBy).toEqual(expect.arrayContaining([
            { type: "pipeline_step", via: "id", jobId: jobIds[0], name: `Approve dispatch ${stamp}` },
            { type: "mission_template", via: "name", templateId: templateIds[0], name: `Dispatch mission ${stamp}`, stepOrder: 2 },
        ]));
    });

    it("filters by state, issues, use and search", async () => {
        const idsOf = async (filter: any) => (await library.list(ctx, filter)).map((row) => row.id);
        expect(await idsOf({ state: "draft" })).toContain(ids.draft);
        expect(await idsOf({ state: "draft" })).not.toContain(ids.published);
        expect(await idsOf({ state: "legacy" })).toEqual([ids.legacy]);
        expect(await idsOf({ state: "archived" })).toEqual([ids.archived]);
        expect(await idsOf({ issues: "open" })).toEqual([ids.draft]);
        expect(await idsOf({ use: "used" })).toEqual(expect.arrayContaining([ids.published, ids.legacy]));
        expect(await idsOf({ use: "used" })).not.toContain(ids.draft);
        expect(await idsOf({ q: "after publishing" })).toEqual([ids.ahead]);
    });

    it("reports what publishing a form affects", async () => {
        const usage = await library.usage(ids.published, ctx);
        expect(usage.waitingRequests).toBe(1);
        expect(usage.usedBy.map((use) => use.type).sort()).toEqual(["mission_template", "pipeline_step"]);
        await expect(library.usage(ids.published, otherCtx)).rejects.toThrow(/Form not found/);
    });

    it("refuses to rename a form a mission template finds by name unless the rename is confirmed", async () => {
        const form = await studio.get(ids.published, ctx);
        const refusal = await studio.save(ids.published, form.revision, { name: "Renamed" }, ctx).catch((error) => error);
        expect(refusal.statusCode).toBe(409);
        expect(refusal.details).toMatchObject({ reason: "rename_breaks_references", references: [{ type: "mission_template", name: `Dispatch mission ${stamp}` }] });

        const stale = await studio.save(ids.published, form.revision + 5, { name: "Renamed" }, ctx).catch((error) => error);
        expect(stale.details).toEqual({ reason: "stale_revision", currentRevision: form.revision });

        const renamed = await studio.save(ids.published, form.revision, { name: `Stable form renamed ${stamp}` }, ctx, undefined, { confirmRename: true });
        expect(renamed.name).toBe(`Stable form renamed ${stamp}`);
        await studio.save(ids.published, renamed.revision, { name: `Stable form ${stamp}` }, ctx, undefined, { confirmRename: true });
    });

    it("duplicates a form's pages, logic and tests without its releases", async () => {
        const source = await studio.create(`Scored intake ${stamp}`, ctx);
        const definition = {
            fields: [{ key: "a", label: "A", type: "number", pageId: "two" }, { key: "double", label: "Double", type: "computed", formula: "a * 2", pageId: "two" }],
            studio: { version: 2, pages: [{ id: "one", title: "One" }, { id: "two", title: "Two" }], tests: [{ name: "doubles", inputs: { a: 2 }, expected: { double: 4 } }] },
        };
        await studio.save(source.id, 0, { schema: definition }, ctx);
        await studio.publish(source.id, 1, ctx);

        const copy = await studio.duplicate(source.id, ctx);
        expect(copy).toMatchObject({ name: `Scored intake ${stamp} (copy)`, revision: 0, published: null });
        expect(copy.schema.studio.pages.map((p) => p.id)).toEqual(["one", "two"]);
        expect(copy.schema.studio.tests).toHaveLength(1);
        expect((await studio.releases(copy.id, ctx))).toEqual([]);
        expect((await studio.revisions(copy.id, ctx)).revisions.map((r) => r.summary)).toEqual([`Duplicated from "Scored intake ${stamp}"`]);
    });

    it("creates a draft from an accepted proposal, and refuses a proposal with the wrong shape", async () => {
        const created = await studio.create(`From documents ${stamp}`, ctx, { schema: onePage([{ key: "q1", label: "Q1", type: "rating", min: 1, max: 5 }]), description: "Pulse check" });
        expect(created).toMatchObject({ revision: 0, description: "Pulse check", legacy: false });
        expect(created.schema.fields[0].key).toBe("q1");
        expect((await studio.revisions(created.id, ctx)).revisions[0].summary).toBe("Created from a proposal");
        await expect(studio.create("Bad", ctx, { schema: { fields: [{ key: "9", label: "x", type: "text" }] } })).rejects.toThrow(/Invalid form definition/);
    });

    it("applies an Org Forge template update held on a Studio form, keeping the Studio's own fields", async () => {
        const form = await studio.create(`Held update ${stamp}`, ctx);
        await studio.save(form.id, 0, {
            schema: onePage([
                { key: "reason", label: "Reason", type: "text", required: true },
                { key: "risk", label: "Risk", type: "computed", formula: "1" },
            ]),
        }, ctx);
        const [row] = await db.select().from(hilForms).where(eq(hilForms.id, form.id));
        const templateFields = [
            { key: "reason", label: "Reason for override", type: "textarea", required: true, placeholder: null, options: null },
            { key: "severity", label: "Severity", type: "select", required: true, placeholder: null, options: ["low", "high"] },
        ];
        const reconciled = reconcileTemplateForm(row, { key: "dispatch_override", description: null, fields: templateFields });
        expect(reconciled.action).toBe("hold");
        const config = row.config as any;
        await db.update(hilForms).set({ config: { ...config, formStudio: { ...config.formStudio, templateUpdate: (reconciled as any).templateUpdate } } }).where(eq(hilForms.id, form.id));

        const held = await studio.get(form.id, ctx);
        expect(held.templateUpdate).toMatchObject({ added: ["severity"], changed: ["reason"], notInTemplate: ["risk"] });
        expect((await library.list(ctx, { q: `Held update ${stamp}` }))[0].templateUpdate).toBe(true);

        const applied = await studio.applyTemplateUpdate(form.id, held.revision, ctx);
        expect(applied.templateUpdate).toBeNull();
        expect(applied.schema.fields.map((f) => [f.key, f.label, f.type])).toEqual([
            ["reason", "Reason for override", "textarea"], ["risk", "Risk", "computed"], ["severity", "Severity", "select"],
        ]);
        expect((applied.schema.fields[2] as any).placeholder).toBeUndefined();
        await expect(studio.dismissTemplateUpdate(form.id, applied.revision, ctx)).rejects.toThrow(/no template update/);
    });

    it("duplicates and saves an Org Forge form whose unset field properties are null", async () => {
        // Org Forge writes `placeholder: null, options: null`; the first live duplicate of one failed with "Validation failed".
        const [forge] = await db.insert(hilForms).values({
            name: `Forge nulls ${stamp}`, organizationId: orgId, status: "active", config: { formId: "forge_nulls" },
            schema: { fields: [{ key: "reason", label: "Reason", type: "textarea", required: true, placeholder: null, options: null }] },
        }).returning();

        const copy = await studio.duplicate(forge.id, ctx);
        expect(copy.schema.fields).toEqual([{ key: "reason", label: "Reason", type: "textarea", required: true }]);

        const opened = await studio.get(forge.id, ctx);
        const saved = await studio.save(forge.id, 0, { schema: { ...opened.schema, fields: [{ ...opened.schema.fields[0], label: "Reason for override" }] } }, ctx);
        expect(saved).toMatchObject({ revision: 1, legacy: false });
        expect(saved.schema.fields[0]).toEqual({ key: "reason", label: "Reason for override", type: "textarea", required: true });
    });
});
