import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { scribeService, hasAuthoredProse, normalizeStationTitle } from "../core/scribe.service.js";
import { db } from "@server/database_service.js";
import { crewSessions, scribeAnnotations, scribeNodes } from "@shared/schema/index.js";
import { eq, inArray } from "drizzle-orm";

/**
 * Outline reconciliation, against a real database.
 *
 * Every case here is a way the previous implementation lost an author's work.
 * An outline change is the one operation performed *expecting* nothing to be
 * lost, so these are regression tests in the strict sense: each asserts that
 * prose, ids or critiques written before the change still exist after it.
 */
describe("configureStations preserves identity and content", () => {
    const testOrgId = 1;
    const sessionIds: number[] = [];
    let documentId: number;

    async function freshDocument(): Promise<number> {
        const [session] = await db
            .insert(crewSessions)
            .values({
                organizationId: testOrgId,
                sessionKey: `test-outline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                title: "Outline reconciliation room",
                status: "active",
                mode: "explore",
                createdBy: "test_runner",
            })
            .returning();
        sessionIds.push(session.id);
        const view = await scribeService.createOrGetDocument(session.id, testOrgId, "Reconciliation Doc");
        return view.document.id;
    }

    beforeEach(async () => {
        documentId = await freshDocument();
    });

    afterAll(async () => {
        for (const id of sessionIds) {
            await db.delete(crewSessions).where(eq(crewSessions.id, id));
        }
    });

    it("keeps a station's id, and therefore its annotations, across a reorder", async () => {
        await scribeService.configureStations(documentId, testOrgId, [
            { stationKey: "scope", title: "Scope" },
            { stationKey: "risks", title: "Risks" },
        ]);

        let view = await scribeService.getDocument(documentId, testOrgId);
        const scope = view.nodes.find((n) => n.stationKey === "scope")!;
        await scribeService.updateNodeContent(scope.id, testOrgId, "The scope covers two date types.");

        // A critique hangs off the node id, with ON DELETE CASCADE behind it.
        const [annotation] = await db
            .insert(scribeAnnotations)
            .values({
                documentId,
                nodeId: scope.id,
                lensType: "legal",
                severity: "suggestion",
                status: "open",
                title: "Tighten this",
                critiqueBody: "Name the two date types.",
            })
            .returning();

        // Reordering: Risks first now.
        await scribeService.configureStations(documentId, testOrgId, [
            { stationKey: "risks", title: "Risks" },
            { stationKey: "scope", title: "Scope" },
        ]);

        view = await scribeService.getDocument(documentId, testOrgId);
        const after = view.nodes.find((n) => n.stationKey === "scope")!;

        expect(after.id).toBe(scope.id);
        expect(after.content).toContain("two date types");
        expect(view.nodes.map((n) => n.stationKey)).toEqual(["risks", "scope"]);

        const [survivingAnnotation] = await db
            .select()
            .from(scribeAnnotations)
            .where(eq(scribeAnnotations.id, annotation.id));
        expect(survivingAnnotation).toBeDefined();
    });

    it("does not retitle other sections when one is inserted at the top", async () => {
        // The index-matching bug: stations[i] against existingNodes[i] attached
        // each incoming title to the previous section's prose.
        await scribeService.configureStations(documentId, testOrgId, [
            { stationKey: "alpha", title: "Alpha" },
            { stationKey: "beta", title: "Beta" },
        ]);

        let view = await scribeService.getDocument(documentId, testOrgId);
        for (const node of view.nodes) {
            await scribeService.updateNodeContent(node.id, testOrgId, `Prose belonging to ${node.stationKey}.`);
        }

        await scribeService.configureStations(documentId, testOrgId, [
            { stationKey: "intro", title: "Intro" },
            { stationKey: "alpha", title: "Alpha" },
            { stationKey: "beta", title: "Beta" },
        ]);

        view = await scribeService.getDocument(documentId, testOrgId);
        const byKey = Object.fromEntries(view.nodes.map((n) => [n.stationKey, n]));

        expect(byKey.alpha.content).toContain("belonging to alpha");
        expect(byKey.beta.content).toContain("belonging to beta");
        expect(byKey.intro.title).toBe("Intro");
    });

    it("keeps a section the new outline omits when it holds written prose", async () => {
        await scribeService.configureStations(documentId, testOrgId, [
            { stationKey: "keep", title: "Keep" },
            { stationKey: "drop", title: "Drop" },
        ]);

        let view = await scribeService.getDocument(documentId, testOrgId);
        const written = view.nodes.find((n) => n.stationKey === "drop")!;
        await scribeService.updateNodeContent(written.id, testOrgId, "Three paragraphs the author wrote.");

        await scribeService.configureStations(documentId, testOrgId, [
            { stationKey: "keep", title: "Keep" },
        ]);

        view = await scribeService.getDocument(documentId, testOrgId);
        const survivor = view.nodes.find((n) => n.stationKey === "drop");

        // Silently discarding paragraphs is never the right reading of
        // "reorganise the sections" — it is kept, after the outline.
        expect(survivor).toBeDefined();
        expect(survivor!.content).toContain("the author wrote");
        expect(survivor!.sortOrder).toBeGreaterThan(
            view.nodes.find((n) => n.stationKey === "keep")!.sortOrder,
        );
    });

    it("removes an omitted section that was never written in", async () => {
        await scribeService.configureStations(documentId, testOrgId, [
            { stationKey: "one", title: "One" },
            { stationKey: "two", title: "Two" },
        ]);

        await scribeService.configureStations(documentId, testOrgId, [
            { stationKey: "one", title: "One" },
        ]);

        const view = await scribeService.getDocument(documentId, testOrgId);
        expect(view.nodes.map((n) => n.stationKey)).toEqual(["one"]);
    });

    it("replaces framework scaffolding rather than treating it as authored", async () => {
        // createOrGetDocument seeds scaffolding with wordCount 0; a fresh
        // document reconciled to a new outline should end up with just it.
        const view = await scribeService.configureStations(documentId, testOrgId, [
            { stationKey: "a", title: "A" },
            { stationKey: "b", title: "B" },
        ]);
        expect(view.nodes.map((n) => n.stationKey)).toEqual(["a", "b"]);
    });

    it("matches a renamed section by title when the key is absent", async () => {
        await scribeService.configureStations(documentId, testOrgId, [
            { stationKey: "scope_and_objectives", title: "Scope and Objectives" },
        ]);

        let view = await scribeService.getDocument(documentId, testOrgId);
        const original = view.nodes[0];
        await scribeService.updateNodeContent(original.id, testOrgId, "Original scope prose.");

        // An outline pasted from chat: numbered, ampersand, and no key at all.
        await scribeService.configureStations(documentId, testOrgId, [
            { title: "1. Scope & Objectives" },
        ]);

        view = await scribeService.getDocument(documentId, testOrgId);
        expect(view.nodes).toHaveLength(1);
        expect(view.nodes[0].id).toBe(original.id);
        expect(view.nodes[0].content).toContain("Original scope prose");
        expect(view.nodes[0].title).toBe("1. Scope & Objectives");
    });

    it("bumps the document revision once per reconciliation", async () => {
        const before = (await scribeService.getDocument(documentId, testOrgId)).document.currentRevision;
        await scribeService.configureStations(documentId, testOrgId, [{ stationKey: "x", title: "X" }]);
        const after = (await scribeService.getDocument(documentId, testOrgId)).document.currentRevision;

        expect(after).toBe(before + 1);
    });

    it("leaves the table of contents in place and refreshes it", async () => {
        await scribeService.configureStations(documentId, testOrgId, [
            { stationKey: "first", title: "First" },
            { stationKey: "second", title: "Second" },
        ]);
        await scribeService.addTableOfContents(documentId, testOrgId);

        const view = await scribeService.configureStations(documentId, testOrgId, [
            { stationKey: "second", title: "Second" },
            { stationKey: "first", title: "First" },
        ]);

        const toc = view.nodes.find((n) => n.stationKey === "table_of_contents");
        expect(toc).toBeDefined();
        // Rebuilt to the new order rather than left describing the old one.
        expect(toc!.content!.indexOf("Second")).toBeLessThan(toc!.content!.indexOf("First"));
    });
});

describe("hasAuthoredProse", () => {
    it("treats framework scaffolding as unwritten", () => {
        // Seeded with content but wordCount 0, which is the only signal.
        expect(
            hasAuthoredProse({ content: "Open with the strategic imperative.", wordCount: 0, status: "draft" }),
        ).toBe(false);
    });

    it("treats a generated heading stub as unwritten", () => {
        expect(hasAuthoredProse({ content: "# Scope\n\n", wordCount: 1, status: "draft" })).toBe(false);
    });

    it("treats prose under a heading as written", () => {
        expect(
            hasAuthoredProse({ content: "# Scope\n\nThe scope is two dates.", wordCount: 6, status: "draft" }),
        ).toBe(true);
    });

    it("treats an approved station as written even when empty", () => {
        expect(hasAuthoredProse({ content: "", wordCount: 0, status: "approved" })).toBe(true);
    });
});

describe("normalizeStationTitle", () => {
    it("matches the same section across numbering and ampersands", () => {
        expect(normalizeStationTitle("1. Scope & Objectives")).toBe(normalizeStationTitle("Scope and Objectives"));
        expect(normalizeStationTitle("2) Risks")).toBe(normalizeStationTitle("Risks"));
    });

    it("keeps genuinely different sections apart", () => {
        expect(normalizeStationTitle("Scope")).not.toBe(normalizeStationTitle("Risks"));
    });
});
