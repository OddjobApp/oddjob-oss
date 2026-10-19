/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { configureTestEnvironment } from "../../../../../tests/configure-test-environment.js";

/**
 * Form Studio revisions, drafts and releases, against a real database.
 *
 * History used to be 30 snapshots inside the form row, a draft with a formula
 * naming a field not added yet could not be saved, and publishing overwrote one
 * embedded copy. These tests pin the revision table, draft saving, numbered
 * releases, and the Form Builder not wiping a Studio form.
 */

configureTestEnvironment();

const { db } = await import("@server/database_service.js");
const { hilForms, formStudioRevisions } = await import("@shared/schema/index.js");
const { orgs } = await import("@shared/schema/auth.js");
const { formStudioService: studio } = await import("../../core/form-studio.service.js");
const { hilFormAccess } = await import("../../core/hil-form-access.service.js");

let reachable = false;
try {
    await db.execute("SELECT 1" as any);
    reachable = true;
} catch (e: any) {
    console.warn(
        `[form-studio-revisions] SKIPPED — no test database reachable (${e?.message ?? e}). `
        + `Set TEST_DATABASE_URL and run npm run test:db:setup.`,
    );
}

const stamp = Date.now();
const page = (id: string, title = id) => ({ id, title });

describe.skipIf(!reachable)("Form Studio revisions, drafts and releases", () => {
    let orgId: number;
    let ctx: any;

    beforeAll(async () => {
        const [org] = await db.insert(orgs).values({ name: `Studio revisions ${stamp}`, slug: `studio-revisions-${stamp}` } as any).returning();
        orgId = org.id;
        ctx = { organizationId: orgId, userId: undefined, isAdmin: false, isSuperAdmin: false, isOrgAdmin: false };
    });

    afterAll(async () => {
        if (!orgId) return;
        await db.delete(hilForms).where(eq(hilForms.organizationId, orgId));
        await db.delete(orgs).where(eq(orgs.id, orgId));
    });

    it("saves a draft that still has structural issues, and refuses to publish it", async () => {
        const form = await studio.create("Dangling formula", ctx);
        const saved = await studio.save(form.id, 0, {
            schema: { fields: [{ key: "total", label: "Total", type: "computed", formula: "price * quantity" }], studio: { version: 2, pages: [page("page_1", "Form")] } },
        }, ctx);
        expect(saved.revision).toBe(1);
        expect(saved.checks).toEqual(expect.arrayContaining(["total: unknown field price.", "total: unknown field quantity."]));
        await expect(studio.publish(form.id, 1, ctx)).rejects.toThrow(/unknown field price/);
    });

    it("still refuses a definition with the wrong shape", async () => {
        const form = await studio.create("Bad shape", ctx);
        await expect(studio.save(form.id, 0, { schema: { fields: [{ key: "1bad", label: "Bad", type: "text" }] } }, ctx)).rejects.toThrow(/Invalid form definition/);
    });

    it("publishes numbered releases with a fields projection, and serves the latest behind the link", async () => {
        const form = await studio.create("Pulse survey", ctx);
        const definition = {
            fields: [
                { key: "mood", label: "Mood", type: "rating", scale: "five", required: true, pageId: "questions" },
                { key: "mood_pct", label: "Mood %", type: "computed", formula: "mood / 5 * 100", pageId: "questions" },
            ],
            studio: {
                version: 2,
                pages: [page("intro"), page("questions")],
                scales: [{ id: "five", label: "Five point", min: 1, max: 5 }],
                results: [{ id: "mood_score", title: "Mood", type: "score", audience: "respondent", field: "mood_pct", bands: [] }],
            },
        };
        await studio.save(form.id, 0, { schema: definition }, ctx);

        const first = await studio.publish(form.id, 1, ctx);
        expect(first.releaseNumber).toBe(1);
        expect(first.warnings).toEqual(["Older form renderers show every page's questions on one page.", "Older form renderers show no result blocks."]);
        expect((await studio.publish(form.id, 1, ctx)).releaseNumber).toBe(1);

        await studio.save(form.id, 1, { name: "Pulse survey (Q4)" }, ctx);
        const second = await studio.publish(form.id, 2, ctx);
        expect(second).toMatchObject({ releaseNumber: 2, href: first.href });

        const releases = await studio.releases(form.id, ctx);
        expect(releases.map((r) => [r.releaseNumber, r.name])).toEqual([[2, "Pulse survey (Q4)"], [1, "Pulse survey"]]);

        const [stored] = await db.select().from(formStudioRevisions)
            .where(and(eq(formStudioRevisions.formId, form.id), eq(formStudioRevisions.kind, "release"), eq(formStudioRevisions.releaseNumber, 1)));
        expect((stored.fieldsProjection as any).fields[0]).toEqual({ key: "mood", label: "Mood", type: "rating", required: true, min: 1, max: 5 });

        const token = first.href.split("/").pop()!;
        const { release } = await studio.published(token);
        expect(release).toMatchObject({ releaseNumber: 2, revision: 2, name: "Pulse survey (Q4)" });

        const submitted = await studio.submit(token, 2, { mood: 4 });
        expect(submitted.results).toEqual([{ id: "mood_score", title: "Mood", audience: "respondent", type: "score", value: 80, band: null }]);
        const [response] = await db.select().from(hilForms).where(eq(hilForms.id, submitted.id));
        expect(response).toMatchObject({ kind: "response", data: { mood: 4, mood_pct: 80 } });
        expect((response.config as any).formStudioResponse).toMatchObject({ formId: form.id, releaseNumber: 2, decision: { state: "none" } });
    });

    it("coalesces autosaves by the same author within 30 seconds into one revision", async () => {
        const form = await studio.create("Autosaved", ctx);
        await studio.save(form.id, 0, { name: "A" }, ctx, undefined, { autosave: true });
        await studio.save(form.id, 1, { name: "AB" }, ctx, undefined, { autosave: true });
        const latest = await studio.save(form.id, 2, { name: "ABC" }, ctx, undefined, { autosave: true });
        expect(latest.revision).toBe(3);

        const history = await studio.revisions(form.id, ctx);
        expect(history.revisions.map((r) => [r.seq, r.summary, r.name])).toEqual([[2, "Autosaved", "ABC"], [1, "Created", "Autosaved"]]);
        expect((await studio.undo(form.id, 3, ctx)).name).toBe("Autosaved");
    });

    it("keeps undone revisions listed after a new edit, and restores one as a new revision", async () => {
        const form = await studio.create("One", ctx);
        await studio.save(form.id, 0, { name: "Two" }, ctx);
        await studio.save(form.id, 1, { name: "Three" }, ctx);
        expect((await studio.undo(form.id, 2, ctx)).name).toBe("Two");
        await studio.save(form.id, 3, { name: "Branch" }, ctx);

        const history = await studio.revisions(form.id, ctx);
        expect(history.headSeq).toBe(4);
        expect(history.revisions.map((r) => [r.seq, r.name, r.discardedAt !== null])).toEqual([
            [4, "Branch", false], [3, "Three", true], [2, "Two", false], [1, "One", false],
        ]);
        await expect(studio.redo(form.id, 4, ctx)).rejects.toThrow(/No undone change to redo/);

        const restored = await studio.restore(form.id, 4, 3, ctx);
        expect(restored).toMatchObject({ name: "Three", revision: 5 });
        expect((await studio.revisions(form.id, ctx)).revisions[0]).toMatchObject({ seq: 5, summary: "Restored revision 3" });
        expect((await studio.undo(form.id, 5, ctx)).name).toBe("Branch");
    });

    it("gives a Form Builder form its first revision when the Studio first saves it, so undo can return to it", async () => {
        const [legacy] = await db.insert(hilForms).values({
            name: `Builder form ${stamp}`, organizationId: orgId, status: "active",
            schema: { fields: [{ key: "reason", label: "Reason", type: "text" }] },
        }).returning();
        expect((await studio.get(legacy.id, ctx)).legacy).toBe(true);

        const converted = await studio.save(legacy.id, 0, { name: "Converted" }, ctx);
        expect(converted.schema.studio.version).toBe(2);
        expect(converted.schema.fields).toEqual([{ key: "reason", label: "Reason", type: "text" }]);
        expect((await studio.revisions(legacy.id, ctx)).revisions.map((r) => r.summary)).toEqual(["Saved form draft", "Before Form Studio"]);
        expect((await studio.undo(legacy.id, 1, ctx)).name).toBe(`Builder form ${stamp}`);
    });

    it("keeps Studio pages when the Form Builder saves fields, and makes the open Studio editor reload", async () => {
        const form = await studio.create("Two pages", ctx);
        await studio.save(form.id, 0, {
            schema: { fields: [{ key: "a", label: "A", type: "text", pageId: "second" }], studio: { version: 2, pages: [page("first"), page("second")] } },
        }, ctx);

        const edited = await hilFormAccess.update(form.id, { schema: { fields: [{ key: "a", label: "A (renamed)", type: "text", pageId: "second" }] } }, ctx);
        expect((edited.schema as any).studio.pages.map((p: any) => p.id)).toEqual(["first", "second"]);
        await expect(studio.save(form.id, 1, { name: "Stale editor" }, ctx)).rejects.toThrow(/changed/);

        const reopened = await studio.get(form.id, ctx);
        await studio.save(form.id, reopened.revision, { name: "After the builder" }, ctx);
        const summaries = (await studio.revisions(form.id, ctx)).revisions.map((r) => r.summary);
        expect(summaries.slice(0, 2)).toEqual(["Saved form draft", "Changed outside Form Studio"]);
        expect((await studio.undo(form.id, reopened.revision + 1, ctx)).schema.fields[0].label).toBe("A (renamed)");
    });
});
