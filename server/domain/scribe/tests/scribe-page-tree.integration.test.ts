import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { scribeService } from "../core/scribe.service.js";
import { db } from "@server/database_service.js";
import { crewSessions, scribeDocuments, scribeNodes } from "@shared/schema/index.js";
import { eq, inArray } from "drizzle-orm";

/**
 * The page tree and labels, against a real database.
 *
 * Worth integration-testing rather than mocking because the parts that can go
 * wrong are the parts a mock would paper over: the self-referencing foreign key,
 * the jsonb default, and what happens to children when a parent is deleted.
 */
describe("Scribe page tree and labels", () => {
    const testOrgId = 1;
    const sessionIds: number[] = [];
    const documentIds: number[] = [];

    async function makeDocument(title: string): Promise<number> {
        const [session] = await db
            .insert(crewSessions)
            .values({
                organizationId: testOrgId,
                sessionKey: `test-tree-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                title: `Room for ${title}`,
                status: "active",
                mode: "explore",
                createdBy: "test_runner",
            })
            .returning();
        sessionIds.push(session.id);

        const view = await scribeService.createOrGetDocument(session.id, testOrgId, title);
        documentIds.push(view.document.id);
        return view.document.id;
    }

    let parentId: number;
    let childId: number;
    let grandchildId: number;

    beforeAll(async () => {
        parentId = await makeDocument("Tree Parent");
        childId = await makeDocument("Tree Child");
        grandchildId = await makeDocument("Tree Grandchild");
    });

    afterAll(async () => {
        if (documentIds.length) {
            await db.delete(scribeDocuments).where(inArray(scribeDocuments.id, documentIds));
        }
        for (const id of sessionIds) {
            await db.delete(crewSessions).where(eq(crewSessions.id, id));
        }
    });

    it("starts every document at the root with no labels", async () => {
        const [row] = await db
            .select()
            .from(scribeDocuments)
            .where(eq(scribeDocuments.id, parentId));

        expect(row.parentDocumentId).toBeNull();
        // The jsonb default: reads must never have to coalesce a null away.
        expect(row.labels).toEqual([]);
    });

    it("files a document under another and nests it in the tree", async () => {
        await scribeService.setDocumentParent(childId, testOrgId, parentId);
        await scribeService.setDocumentParent(grandchildId, testOrgId, childId);

        const roots = await scribeService.listDocumentTree(testOrgId);
        const parent = roots.find((r) => r.id === parentId);

        expect(parent).toBeDefined();
        const child = parent!.children.find((c) => c.id === childId);
        expect(child).toBeDefined();
        expect(child!.children.map((g) => g.id)).toContain(grandchildId);

        // A nested document is not also reported as a root.
        expect(roots.map((r) => r.id)).not.toContain(childId);
    });

    it("refuses to file a document under itself", async () => {
        await expect(
            scribeService.setDocumentParent(parentId, testOrgId, parentId),
        ).rejects.toThrow(/cannot be filed under itself/i);
    });

    it("refuses to file a document under its own descendant", async () => {
        // The cycle that matters: parent -> grandchild would close the loop, and
        // every later tree walk would recurse until the stack ran out.
        await expect(
            scribeService.setDocumentParent(parentId, testOrgId, grandchildId),
        ).rejects.toThrow(/own children/i);
    });

    it("moves a document back to the root", async () => {
        await scribeService.setDocumentParent(grandchildId, testOrgId, null);
        const roots = await scribeService.listDocumentTree(testOrgId);
        expect(roots.map((r) => r.id)).toContain(grandchildId);

        await scribeService.setDocumentParent(grandchildId, testOrgId, childId);
    });

    it("normalises labels so one tag does not split into several", async () => {
        const updated = await scribeService.setDocumentLabels(parentId, testOrgId, [
            "PRD",
            "prd",
            "  Shelfie  ",
            "needs review",
            "",
        ]);

        expect(updated.labels).toEqual(["prd", "shelfie", "needs-review"]);
    });

    it("filters the tree by label", async () => {
        await scribeService.setDocumentLabels(childId, testOrgId, ["shelfie"]);
        const filtered = await scribeService.listDocumentTree(testOrgId, { label: "shelfie" });

        const ids = new Set<number>();
        const walk = (nodes: Awaited<ReturnType<typeof scribeService.listDocumentTree>>) => {
            for (const n of nodes) {
                ids.add(n.id);
                walk(n.children);
            }
        };
        walk(filtered);

        expect(ids.has(parentId)).toBe(true);
        expect(ids.has(childId)).toBe(true);
        // Carries no such label.
        expect(ids.has(grandchildId)).toBe(false);
    });

    it("counts labels across the organization", async () => {
        const labels = await scribeService.listLabels(testOrgId);
        const shelfie = labels.find((l) => l.label === "shelfie");

        expect(shelfie).toBeDefined();
        expect(shelfie!.count).toBeGreaterThanOrEqual(2);
        // Sorted by count, so the busiest label leads.
        expect(labels[0].count).toBeGreaterThanOrEqual(labels[labels.length - 1].count);
    });

    it("surfaces children at the root when their parent is deleted", async () => {
        // ON DELETE SET NULL, not CASCADE: deleting a parent must not destroy the
        // manuscripts filed beneath it.
        const doomed = await makeDocument("Doomed Parent");
        const survivor = await makeDocument("Surviving Child");
        await scribeService.setDocumentParent(survivor, testOrgId, doomed);

        await scribeService.deleteDocument(doomed, testOrgId);

        const [row] = await db
            .select()
            .from(scribeDocuments)
            .where(eq(scribeDocuments.id, survivor));

        expect(row).toBeDefined();
        expect(row.parentDocumentId).toBeNull();

        const roots = await scribeService.listDocumentTree(testOrgId);
        expect(roots.map((r) => r.id)).toContain(survivor);
    });

    it("deletes a document with its stations, and refuses another org's", async () => {
        const victim = await makeDocument("Delete Me");
        const view = await scribeService.getDocument(victim, testOrgId);
        const nodeIds = view.nodes.map((n) => n.id);
        expect(nodeIds.length).toBeGreaterThan(0);

        // Same indistinguishable 404 as every other scoped lookup: a foreign
        // org's id must not even confirm the row exists.
        const otherOrg = 999999;
        await expect(scribeService.deleteDocument(victim, otherOrg)).rejects.toThrow(/not found/i);

        const result = await scribeService.deleteDocument(victim, testOrgId);
        expect(result.deletedId).toBe(victim);

        const [gone] = await db
            .select()
            .from(scribeDocuments)
            .where(eq(scribeDocuments.id, victim));
        expect(gone).toBeUndefined();

        // document_id cascades: the stations went with the manuscript.
        const orphans = await db
            .select()
            .from(scribeNodes)
            .where(inArray(scribeNodes.id, nodeIds));
        expect(orphans).toEqual([]);
    });
});
