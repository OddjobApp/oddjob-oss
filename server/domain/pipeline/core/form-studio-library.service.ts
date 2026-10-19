import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { formStudioRevisions, hilForms } from "@shared/schema/index.js";
import { getOrgConditions } from "@server/utils/org-conditions.js";
import type { OrgContext } from "@server/utils/auth-context.js";
import { asStudioDefinition, definitionIssues, runStudioTests } from "@shared/form-studio.js";
import { formUsage, type FormUse } from "./form-studio-usage.js";
import { userDisplayNames } from "./form-studio-people.js";
import { formStudioService } from "./form-studio.service.js";

type Form = typeof hilForms.$inferSelect;

export type LibraryState = "draft" | "published" | "draft_ahead";

export interface LibraryRow {
    id: number;
    name: string;
    description: string | null;
    isArchived: boolean;
    /** A Form Builder, Org Forge or agent form the Studio has not saved yet. */
    legacy: boolean;
    revision: number;
    state: LibraryState;
    releaseNumber: number | null;
    updatedAt: Date;
    lastEditedBy: string | null;
    sources: Array<{ id: number; title: string }>;
    responses: number;
    /** Requests made from this form that are still waiting on someone. */
    waitingRequests: number;
    issueCount: number;
    testCount: number;
    failingTests: number;
    usedBy: FormUse[];
    templateUpdate: boolean;
}

export interface LibraryFilter {
    q?: string;
    state?: LibraryState | "legacy" | "archived";
    issues?: "open" | "clear";
    use?: "used" | "unused";
}

export function toLibraryRow(
    row: Form,
    facts: { usedBy: FormUse[]; responses: number; waitingRequests: number; lastEditedBy?: string | null },
): LibraryRow {
    const state = ((row.config ?? {}) as any).formStudio ?? {};
    const revision = Number(state.revision ?? 0);
    const published = state.published?.releaseNumber ? state.published : null;
    let issueCount = 0, testCount = 0, failingTests = 0;
    let sources: LibraryRow["sources"] = [];
    try {
        const definition = asStudioDefinition(row.schema);
        issueCount = definitionIssues(definition).length + definition.studio.issues.length;
        const tests = runStudioTests(definition);
        testCount = tests.length;
        failingTests = tests.filter((test) => !test.passed).length;
        sources = definition.studio.sources.map(({ id, title }) => ({ id, title }));
    } catch {
        // A definition the Studio cannot read is itself an issue.
        issueCount = 1;
    }
    return {
        id: row.id,
        name: row.name,
        description: row.description ?? null,
        isArchived: Boolean(row.isArchived),
        legacy: !(row.schema as any)?.studio,
        revision,
        state: !published ? "draft" : published.revision === revision ? "published" : "draft_ahead",
        releaseNumber: published?.releaseNumber ?? null,
        updatedAt: row.updatedAt,
        // A name, never a raw user id.
        lastEditedBy: facts.lastEditedBy ?? null,
        sources,
        responses: facts.responses,
        waitingRequests: facts.waitingRequests,
        issueCount,
        testCount,
        failingTests,
        usedBy: facts.usedBy,
        templateUpdate: Boolean(state.templateUpdate),
    };
}

export function filterLibrary(rows: LibraryRow[], filter: LibraryFilter): LibraryRow[] {
    const q = filter.q?.trim().toLowerCase();
    return rows.filter((row) => {
        if (filter.state === "archived") {
            if (!row.isArchived) return false;
        } else {
            if (row.isArchived) return false;
            if (filter.state === "legacy" && !row.legacy) return false;
            if (filter.state && filter.state !== "legacy" && row.state !== filter.state) return false;
        }
        const problems = row.issueCount + row.failingTests;
        if (filter.issues === "open" && problems === 0) return false;
        if (filter.issues === "clear" && problems > 0) return false;
        if (filter.use === "used" && !row.usedBy.length) return false;
        if (filter.use === "unused" && row.usedBy.length) return false;
        if (q && !`${row.name} ${row.description ?? ""}`.toLowerCase().includes(q)) return false;
        return true;
    });
}

/**
 * The Forms library: authored forms only (templates), never runtime requests or
 * stored responses, which the legacy /api/forms list mixed in.
 */
export const formStudioLibrary = {
    async list(ctx: OrgContext, filter: LibraryFilter = {}): Promise<LibraryRow[]> {
        const scope = getOrgConditions({ ...ctx, isSuperAdmin: false }, hilForms, false);
        // Forms in a private Project Space the caller is not a member of are left out, as if absent.
        const { hiddenFormIds } = await import("./form-studio-access.js");
        const hidden = await hiddenFormIds(ctx);
        const rows = (await db.select().from(hilForms).where(and(eq(hilForms.kind, "template"), ...scope)).orderBy(desc(hilForms.updatedAt)))
            .filter((row) => !hidden.has(row.id));
        if (!rows.length) return [];
        const ids = rows.map((row) => row.id);
        const responseFormId = sql<string>`${hilForms.config}->'formStudioResponse'->>'formId'`;

        const [usedBy, responses, waiting, edits] = await Promise.all([
            formUsage(rows, ctx),
            db.select({ formId: responseFormId, count: sql<number>`count(*)::int` }).from(hilForms)
                .where(and(eq(hilForms.kind, "response"), ...scope)).groupBy(responseFormId),
            db.select({ formId: hilForms.templateFormId, count: sql<number>`count(*)::int` }).from(hilForms)
                .where(and(eq(hilForms.kind, "request"), eq(hilForms.status, "pending"), inArray(hilForms.templateFormId, ids), ...scope))
                .groupBy(hilForms.templateFormId),
            db.select({ formId: formStudioRevisions.formId, createdBy: formStudioRevisions.createdBy }).from(formStudioRevisions)
                .where(and(eq(formStudioRevisions.kind, "revision"), inArray(formStudioRevisions.formId, ids)))
                .orderBy(desc(formStudioRevisions.updatedAt)),
        ]);

        const responseCounts = new Map(responses.map((r) => [Number(r.formId), r.count]));
        const waitingCounts = new Map(waiting.map((r) => [r.formId, r.count]));
        const lastEditors = new Map<number, string | null>();
        for (const edit of edits) if (!lastEditors.has(edit.formId)) lastEditors.set(edit.formId, edit.createdBy);
        const editorOf = (row: Form) => lastEditors.get(row.id) ?? row.createdBy ?? null;
        const names = await userDisplayNames(rows.map(editorOf));

        return filterLibrary(
            rows.map((row) => toLibraryRow(row, {
                usedBy: usedBy.get(row.id) ?? [],
                responses: responseCounts.get(row.id) ?? 0,
                waitingRequests: waitingCounts.get(row.id) ?? 0,
                lastEditedBy: names.get(editorOf(row) ?? "") ?? null,
            })),
            filter,
        );
    },

    /** What publishing or renaming this form affects. */
    async usage(id: number, ctx: OrgContext) {
        const form = await formStudioService.get(id, ctx);
        const usedBy = (await formUsage([form], ctx)).get(id) ?? [];
        const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(hilForms)
            .where(and(eq(hilForms.kind, "request"), eq(hilForms.status, "pending"), eq(hilForms.templateFormId, id), ...getOrgConditions({ ...ctx, isSuperAdmin: false }, hilForms, false)));
        return { formId: id, name: form.name, usedBy, waitingRequests: count };
    },
};
