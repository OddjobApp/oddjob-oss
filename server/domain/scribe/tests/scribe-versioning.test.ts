/**
 * The version history is the audit trail.
 *
 * scribe_authoring_operations proves a write was attempted and verified;
 * scribe_revisions stores the state itself. These tests cover the parts that
 * can be proven without a database: the line diff, the cross-scope station
 * diff, metadata reference validation, and that a rollback writes the
 * snapshot back as a new revision instead of erasing history.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@server/utils/logger.js", () => ({
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

/**
 * A thenable fluent query builder: every chain method returns another
 * thenable query, and awaiting any of them pops the next scripted result.
 * The service's query sequences are deterministic, so results are queued in
 * the order its terminal calls fire.
 */
const results: any[] = [];
const inserts: any[] = [];
const updates: any[] = [];

const makeQuery = (): any => {
    const q: any = {
        then(resolve: any, reject: any) {
            return Promise.resolve(results.shift() ?? []).then(resolve, reject);
        },
    };
    for (const method of ["from", "where", "innerJoin", "orderBy", "limit", "set", "returning"]) {
        q[method] = () => makeQuery();
    }
    q.values = (v: any) => {
        inserts.push(v);
        return makeQuery();
    };
    // Track update payloads for assertions.
    q.set = (v: any) => {
        updates.push(v);
        return makeQuery();
    };
    return q;
};

vi.mock("@server/database_service.js", () => ({
    db: {
        select: () => makeQuery(),
        insert: () => makeQuery(),
        update: () => makeQuery(),
        delete: () => makeQuery(),
    },
}));

// Rollback records through the operation log; run the write it wraps.
vi.mock("../core/authoring-operation.service.js", () => ({
    authoringOperationService: {
        record: async (_ctx: any, write: () => Promise<any>) => write(),
    },
}));

const { scribeVersioningService, diffLines } = await import("../core/scribe-versioning.service.js");
const { SCRIBE_FRAMEWORKS } = await import("../frameworks/index.js");
const { scribeArchetypeModes } = await import("@shared/schema/index.js");
const { scribeIntentResolverService } = await import(
    "@domain/intent-router/core/scribe-intent-resolver.service.js"
);

const DOC = {
    id: 5,
    organizationId: 7,
    title: "Governance Doc",
    archetypeMode: "ai_system_governance",
    activeBranchId: 11,
    aiSystemId: "sys-1",
    dataLineageGraphId: null,
    biasMitigationStrategyDocumentId: null,
    governancePolicyDocumentId: null,
};

const snapNode = (over: Record<string, any> = {}) => ({
    nodeId: 1,
    stationKey: "purpose",
    title: "1. System Purpose",
    sortOrder: 1,
    content: "The system scores credit applications.",
    contentRich: null,
    wordCount: 6,
    status: "draft",
    ...over,
});

const revisionOf = (snapshot: any, over: Record<string, any> = {}) => ({
    id: 100,
    organizationId: 7,
    documentId: 5,
    branchId: 11,
    nodeId: null,
    revisionNumber: 2,
    scope: "document",
    kind: "commit",
    message: null,
    actor: "author",
    snapshot,
    createdAt: new Date(),
    ...over,
});

beforeEach(() => {
    results.length = 0;
    inserts.length = 0;
    updates.length = 0;
});

describe("diffLines", () => {
    it("marks unchanged lines as same", () => {
        expect(diffLines("a\nb", "a\nb")).toEqual([
            { type: "same", text: "a" },
            { type: "same", text: "b" },
        ]);
    });

    it("surrounds an inserted line with its unchanged context", () => {
        const diff = diffLines("a\nc", "a\nb\nc");
        expect(diff.map((l) => l.type)).toEqual(["same", "added", "same"]);
        expect(diff[1].text).toBe("b");
    });

    it("shows a rewritten line as removed then added", () => {
        const diff = diffLines("a\nold\nz", "a\nnew\nz");
        expect(diff).toContainEqual({ type: "removed", text: "old" });
        expect(diff).toContainEqual({ type: "added", text: "new" });
    });
});

describe("governance framework coverage", () => {
    it("defines a framework for every archetype mode", () => {
        for (const mode of scribeArchetypeModes) {
            expect(SCRIBE_FRAMEWORKS[mode], `missing framework for ${mode}`).toBeDefined();
        }
    });

    it("scaffolds the three governance archetypes with real stations", () => {
        for (const mode of ["ai_system_governance", "data_lineage_narrative", "bias_mitigation_strategy"] as const) {
            const def = SCRIBE_FRAMEWORKS[mode];
            expect(def.stations.length).toBeGreaterThanOrEqual(4);
            for (const station of def.stations) {
                expect(station.stationKey).toBeTruthy();
                expect(station.suggestedScaffolding ?? station.description).toBeTruthy();
            }
        }
    });
});

describe("intent resolution to the new archetypes", () => {
    it("routes a governance prompt to ai_system_governance", () => {
        const out = scribeIntentResolverService.resolve("Draft an AI governance policy for our credit model");
        expect(out.archetypeMode).toBe("ai_system_governance");
    });

    it("routes a lineage prompt to data_lineage_narrative", () => {
        const out = scribeIntentResolverService.resolve("Write the data lineage documentation for this pipeline");
        expect(out.archetypeMode).toBe("data_lineage_narrative");
    });

    it("routes a fairness prompt to bias_mitigation_strategy", () => {
        const out = scribeIntentResolverService.resolve("Create a bias mitigation strategy covering fairness testing");
        expect(out.archetypeMode).toBe("bias_mitigation_strategy");
    });
});

describe("diffRevisions", () => {
    it("reports added, removed, modified and unchanged stations in reading order", async () => {
        const from = revisionOf({
            scope: "document",
            document: {
                title: "Doc",
                archetypeMode: "freeform",
                aiSystemId: null,
                dataLineageGraphId: null,
                biasMitigationStrategyDocumentId: null,
                governancePolicyDocumentId: null,
                nodes: [
                    snapNode({ stationKey: "a", sortOrder: 1, content: "keep me" }),
                    snapNode({ stationKey: "b", sortOrder: 2, content: "before text" }),
                    snapNode({ stationKey: "c", sortOrder: 3, content: "gone soon" }),
                ],
            },
        });
        const to = revisionOf(
            {
                scope: "document",
                document: {
                    title: "Doc",
                    archetypeMode: "freeform",
                    aiSystemId: null,
                    dataLineageGraphId: null,
                    biasMitigationStrategyDocumentId: null,
                    governancePolicyDocumentId: null,
                    nodes: [
                        snapNode({ stationKey: "a", sortOrder: 1, content: "keep me" }),
                        snapNode({ stationKey: "b", sortOrder: 2, content: "after text" }),
                        snapNode({ stationKey: "d", sortOrder: 4, content: "brand new" }),
                    ],
                },
            },
            { id: 101, revisionNumber: 5 },
        );

        results.push([DOC], [{ revision: from }], [{ revision: to }]);

        const diff = await scribeVersioningService.diffRevisions(5, 7, 100, 101);
        const byKey = new Map(diff.changes.map((c) => [c.stationKey, c]));

        expect(byKey.get("a")?.status).toBe("unchanged");
        expect(byKey.get("b")?.status).toBe("modified");
        expect(byKey.get("b")?.lines).toBeDefined();
        expect(byKey.get("c")?.status).toBe("removed");
        expect(byKey.get("d")?.status).toBe("added");
        // Reading order follows the newer snapshot.
        expect(diff.changes.map((c) => c.stationKey)).toEqual(["a", "b", "c", "d"]);
    });

    it("refuses to diff revisions of different documents", async () => {
        const foreign = revisionOf({ scope: "node", node: snapNode() }, { documentId: 99 });
        results.push([DOC], [{ revision: foreign }], [{ revision: revisionOf({ scope: "node", node: snapNode() }) }]);

        await expect(scribeVersioningService.diffRevisions(5, 7, 100, 101)).rejects.toMatchObject({ status: 400 });
    });
});

describe("updateAiSystemMetadata", () => {
    it("returns the document unchanged when nothing in the patch differs", async () => {
        results.push([DOC]);

        const out = await scribeVersioningService.updateAiSystemMetadata(5, 7, { aiSystemId: "sys-1" });
        expect(out).toBe(DOC);
        // No update was issued.
        expect(updates).toHaveLength(0);
    });

    it("rejects a governance link to a document outside the organization", async () => {
        // requireDocument → doc; ref validation → nothing found.
        results.push([DOC], []);

        await expect(
            scribeVersioningService.updateAiSystemMetadata(5, 7, { governancePolicyDocumentId: 999 }),
        ).rejects.toMatchObject({ status: 400 });
        expect(updates).toHaveLength(0);
    });

    it("writes validated metadata and records a metadata revision", async () => {
        const updated = { ...DOC, governancePolicyDocumentId: 9 };
        results.push(
            [DOC], // requireDocument
            [{ id: 9 }], // ref validation: doc 9 exists in org
            [updated], // update .returning()
            [snapNode()], // recordDocumentRevision node load
            [{ max: 3 }], // nextRevisionNumber
            [revisionOf({}, { id: 200, revisionNumber: 4 })], // insert .returning()
        );

        const out = await scribeVersioningService.updateAiSystemMetadata(5, 7, { governancePolicyDocumentId: 9 });
        expect(out.governancePolicyDocumentId).toBe(9);
        expect(inserts.at(-1)).toMatchObject({ kind: "metadata", documentId: 5, revisionNumber: 4 });
    });
});

describe("rollbackRevision", () => {
    it("writes a station snapshot back and records the restore as a new revision", async () => {
        const nodeRev = revisionOf(
            { scope: "node", node: snapNode({ nodeId: 40, content: "the old text" }) },
            { id: 50, nodeId: 40, revisionNumber: 3 },
        );
        const liveNode = {
            id: 40,
            documentId: 5,
            branchId: 11,
            stationKey: "purpose",
            title: "1. System Purpose",
            sortOrder: 1,
            content: "the new text",
            status: "draft",
        };
        const restoredNode = { ...liveNode, content: "the old text" };

        results.push(
            [{ revision: nodeRev }], // getRevision
            [DOC], // requireDocument
            [liveNode], // node still exists
            [restoredNode], // update .returning() inside the operation record
            [{ max: 3 }], // nextRevisionNumber for the rollback revision
            [revisionOf({}, { id: 60, revisionNumber: 4, scope: "node" })],
        );

        const out = await scribeVersioningService.rollbackRevision(50, 7);
        expect(out.restored).toBe(1);
        expect(updates[0]).toMatchObject({ content: "the old text" });
        expect(inserts.at(-1)).toMatchObject({ kind: "rollback", documentId: 5 });
    });
});

describe("decideReview", () => {
    it("refuses to decide a review that is already decided", async () => {
        results.push([{ review: { id: 3, documentId: 5, status: "approved" } }]);

        await expect(
            scribeVersioningService.decideReview(3, 7, { decision: "approved", reviewer: "reviewer-1" }),
        ).rejects.toMatchObject({ status: 409 });
    });
});
