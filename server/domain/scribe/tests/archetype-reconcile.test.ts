/**
 * Asking for an SOW and getting a freeform draft.
 *
 * createOrGetDocument short-circuited on any existing document for the session
 * and discarded the requested archetypeMode, so whichever path reached a
 * session first decided its framework permanently. Ask for a Statement of Work
 * after anything had opened the studio and you got the freeform "Overview /
 * Main Body / Conclusion" skeleton — while the tool reported success and the
 * log line named the mode it had just ignored.
 *
 * The re-frame replaces the stations, so the guard is what these tests are
 * mostly about: an author who has drafted into a document must never lose it
 * to a later tool call.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@domain/ai/index.js", () => ({ systemAiService: { generateText: vi.fn() } }));
vi.mock("@domain/crew/core/crew-stream.service.js", () => ({ crewStreamService: { publish: vi.fn() } }));

const warnings: string[] = [];
vi.mock("@server/utils/logger.js", () => ({
    createLogger: () => ({
        info: vi.fn(),
        warn: (m: string) => warnings.push(m),
        error: vi.fn(),
        debug: vi.fn(),
    }),
}));

/** What the DB was asked to do, so the destructive path can be asserted on. */
const documentUpdates: any[] = [];
const deletedNodes: number[] = [];
const insertedNodes: any[][] = [];

/** The session already has a document; that is the premise of every case here. */
const existingRows = [{ id: 5, sessionId: 42, organizationId: 7 }];

vi.mock("@server/database_service.js", () => ({
    db: {
        select: () => ({ from: () => ({ where: () => ({ limit: async () => existingRows }) }) }),
        update: () => ({ set: (vals: any) => ({ where: async () => documentUpdates.push(vals) }) }),
        delete: () => ({ where: async () => deletedNodes.push(1) }),
        insert: () => ({ values: async (rows: any[]) => insertedNodes.push(rows) }),
    },
}));

const { scribeService } = await import("../core/scribe.service.js");

const EXISTING = { id: 5, sessionId: 42, organizationId: 7, archetypeMode: "freeform", title: "Manuscript" } as any;

/** The view getDocument returns; the reconcile reads its nodes and branches. */
const viewOf = (nodes: any[], branches = [{ id: 1 }]) => ({
    document: { ...EXISTING },
    activeBranch: branches[0],
    allBranches: branches,
    nodes,
    annotations: [],
    entityLedger: [],
    telemetry: {} as any,
});

const seededStation = (id: number) => ({
    id,
    // Seeded scaffolding: content is present, but nothing is written.
    content: "Start with the business outcome this engagement achieves, then provide context.",
    wordCount: 0,
    status: "draft",
});

/** reconcileArchetype reads the current state through getDocument. */
const withExistingDocument = (nodes: any[], branches = [{ id: 1 }]) => {
    vi.spyOn(scribeService as any, "getDocument").mockResolvedValue(viewOf(nodes, branches));
};

describe("re-framing an untouched document", () => {
    beforeEach(() => {
        documentUpdates.length = 0;
        deletedNodes.length = 0;
        insertedNodes.length = 0;
        warnings.length = 0;
        vi.restoreAllMocks();
    });

    it("switches the archetype when nothing has been written", async () => {
        withExistingDocument([seededStation(1), seededStation(2), seededStation(3)]);

        await (scribeService as any).reconcileArchetype(EXISTING, 7, "sow_statement_of_work");

        expect(documentUpdates[0]).toMatchObject({ archetypeMode: "sow_statement_of_work" });
    });

    it("replaces the freeform skeleton with the requested framework's stations", async () => {
        withExistingDocument([seededStation(1), seededStation(2), seededStation(3)]);

        await (scribeService as any).reconcileArchetype(EXISTING, 7, "sow_statement_of_work");

        expect(deletedNodes).toHaveLength(1);
        const stations = insertedNodes[0];
        // The generic three-part skeleton is what the audit saw for an SOW.
        expect(stations.length).toBeGreaterThan(3);
        expect(stations.map((n: any) => n.stationKey)).toContain("scope_in_out");
        expect(stations.map((n: any) => n.stationKey)).not.toContain("core_body");
    });

    it("does nothing at all when the archetype already matches", async () => {
        withExistingDocument([seededStation(1)]);

        await (scribeService as any).reconcileArchetype(EXISTING, 7, "freeform");

        expect(documentUpdates).toHaveLength(0);
        expect(deletedNodes).toHaveLength(0);
    });

    it("adopts the new framework's target word count", async () => {
        withExistingDocument([seededStation(1)]);

        await (scribeService as any).reconcileArchetype(EXISTING, 7, "sow_statement_of_work");

        expect(documentUpdates[0].targetWordCount).toBeGreaterThan(0);
    });

    it("honours an explicit target over the framework default", async () => {
        withExistingDocument([seededStation(1)]);

        await (scribeService as any).reconcileArchetype(EXISTING, 7, "sow_statement_of_work", 4321);

        expect(documentUpdates[0].targetWordCount).toBe(4321);
    });
});

describe("a document the author has written in", () => {
    beforeEach(() => {
        documentUpdates.length = 0;
        deletedNodes.length = 0;
        insertedNodes.length = 0;
        warnings.length = 0;
        vi.restoreAllMocks();
    });

    it("keeps its stations rather than losing them to a later tool call", async () => {
        withExistingDocument([
            seededStation(1),
            { id: 2, content: "The vendor shall deliver...", wordCount: 120, status: "draft" },
        ]);

        await (scribeService as any).reconcileArchetype(EXISTING, 7, "sow_statement_of_work");

        expect(deletedNodes).toHaveLength(0);
        expect(insertedNodes).toHaveLength(0);
        expect(documentUpdates).toHaveLength(0);
    });

    it("keeps an approved station even with no words in it", async () => {
        withExistingDocument([{ id: 1, content: "", wordCount: 0, status: "approved" }]);

        await (scribeService as any).reconcileArchetype(EXISTING, 7, "sow_statement_of_work");

        expect(deletedNodes).toHaveLength(0);
    });

    it("says why, instead of leaving the caller to assume it worked", async () => {
        withExistingDocument([{ id: 1, content: "Written.", wordCount: 5, status: "draft" }]);

        await (scribeService as any).reconcileArchetype(EXISTING, 7, "sow_statement_of_work");

        expect(warnings.join(" ")).toMatch(/sow_statement_of_work/);
    });

    it("will not re-frame under a fork, whatever the word counts say", async () => {
        // Replacing stations beneath a branch would strand it.
        withExistingDocument([seededStation(1)], [{ id: 1 }, { id: 2 }]);

        await (scribeService as any).reconcileArchetype(EXISTING, 7, "sow_statement_of_work");

        expect(deletedNodes).toHaveLength(0);
        expect(warnings.join(" ")).toMatch(/branches/);
    });
});

describe("a caller with no opinion", () => {
    beforeEach(() => {
        documentUpdates.length = 0;
        deletedNodes.length = 0;
        insertedNodes.length = 0;
        warnings.length = 0;
        vi.restoreAllMocks();
    });

    it("does not re-frame a specialised document that nobody asked to change", async () => {
        // The first cut of this fix defaulted the parameter to "freeform", so a
        // caller passing nothing was indistinguishable from one asking for the
        // generic framework — and a bare re-fetch cut an untouched twelve-station
        // hero's journey down to three. The existing suite caught it; this keeps
        // it caught.
        const specialised = { ...EXISTING, archetypeMode: "heros_journey" };
        vi.spyOn(scribeService as any, "getDocument").mockResolvedValue({
            ...viewOf([seededStation(1)]),
            document: specialised,
        });

        await scribeService.createOrGetDocument(42, 7, "Manuscript");

        expect(deletedNodes).toHaveLength(0);
        expect(documentUpdates).toHaveLength(0);
    });
});
