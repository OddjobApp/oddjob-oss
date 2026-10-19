/**
 * The Tier 1 delta path: rules in, a `scribe-insight` event out — but only when
 * the findings actually changed.
 *
 * The quiet-when-nothing-changed rule is the whole reason this is safe to call
 * per keystroke. Without it, an author typing inside a clean paragraph wakes
 * every subscriber in the room on every delta to tell them nothing happened.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

const published: any[] = [];

vi.mock("@domain/crew/core/crew-stream.service.js", () => ({
    crewStreamService: { publish: vi.fn(async (e: any) => { published.push(e); }) },
}));

vi.mock("@server/utils/logger.js", () => ({
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const doc = { id: 5, sessionId: 42, archetypeMode: "saas_msa", organizationId: 7 };

/**
 * `where()` is awaited directly by the ledger read and chained into `limit()`
 * by the document and session reads, so the mock has to be both: a thenable
 * that resolves to rows, and an object carrying `limit`.
 */
const ledgerRows: Array<{ termName: string; aliases: string[] }> = [];

vi.mock("@server/database_service.js", () => ({
    db: {
        select: () => ({
            from: () => ({
                where: () => ({
                    limit: async () => [{ ...doc, sessionKey: "crew-room-42" }],
                    then: (resolve: any) => resolve(ledgerRows),
                }),
            }),
        }),
    },
}));

const { scribeService } = await import("../core/scribe.service.js");

/** requireDocument is the org gate; stub it so these tests are about the stream. */
function allowDocument(owner = 7) {
    vi.spyOn(scribeService as any, "requireDocument").mockImplementation(async (id: any, orgId: any) => {
        if (orgId !== owner) {
            throw Object.assign(new Error(`Scribe document ${id} not found`), { status: 404 });
        }
        return doc;
    });
}

describe("ambient delta evaluation", () => {
    beforeEach(() => {
        published.length = 0;
        vi.restoreAllMocks();
        allowDocument();
    });

    it("publishes a scribe-insight into the room when a finding appears", async () => {
        const out = await scribeService.evaluateAmbientDelta({
            documentId: 5,
            organizationId: 7,
            nodeId: 11,
            text: "Vendor shall respond promptly to each request.",
        });

        expect(out.insights.map((i) => i.ruleId)).toContain("vague_obligation");
        expect(out.published).toBe(true);

        expect(published).toHaveLength(1);
        expect(published[0].type).toBe("scribe-insight");
        expect(published[0].sessionKey).toBe("crew-room-42");
        expect(published[0].organizationId).toBe(7);
        expect(published[0].payload.documentId).toBe(5);
        expect(published[0].payload.nodeId).toBe(11);
    });

    it("stays silent while the author types inside clean prose", async () => {
        const out = await scribeService.evaluateAmbientDelta({
            documentId: 5,
            organizationId: 7,
            text: "Vendor shall respond within four business hours.",
            previousInsights: [],
        });

        expect(out.insights).toEqual([]);
        // Nothing found, nothing changed, so the room is not woken.
        expect(out.published).toBe(false);
        expect(published).toHaveLength(0);
    });

    it("does not re-publish an unchanged finding on the next keystroke", async () => {
        const text = "Vendor shall respond promptly to each request.";
        const first = await scribeService.evaluateAmbientDelta({
            documentId: 5, organizationId: 7, text,
        });
        expect(first.published).toBe(true);

        const second = await scribeService.evaluateAmbientDelta({
            documentId: 5, organizationId: 7, text, previousInsights: first.insights,
        });

        // This is what makes per-delta evaluation affordable.
        expect(second.published).toBe(false);
        expect(published).toHaveLength(1);
    });

    it("publishes again once the author fixes the clause", async () => {
        const before = await scribeService.evaluateAmbientDelta({
            documentId: 5, organizationId: 7,
            text: "Vendor shall respond promptly.",
        });
        const after = await scribeService.evaluateAmbientDelta({
            documentId: 5, organizationId: 7,
            text: "Vendor shall respond within four business hours.",
            previousInsights: before.insights,
        });

        // Clearing a marker is as much a change as raising one.
        expect(after.insights).toEqual([]);
        expect(after.published).toBe(true);
        expect(published).toHaveLength(2);
    });

    it("reports the worst severity, which is what the station marker shows", async () => {
        const out = await scribeService.evaluateAmbientDelta({
            documentId: 5, organizationId: 7,
            text: "The the fee is lorem ipsum and promptly due.",
        });

        expect(out.severity).toBe("critical_conflict");
        expect(published[0].payload.severity).toBe("critical_conflict");
    });

    it("applies the document's archetype, not a default", async () => {
        // saas_msa turns the legal rules on; the same sentence in a novel is
        // ordinary narration.
        const out = await scribeService.evaluateAmbientDelta({
            documentId: 5, organizationId: 7,
            text: "He promptly left.",
        });
        expect(out.insights.map((i) => i.ruleId)).toContain("vague_obligation");
    });

    it("refuses a document belonging to another organisation", async () => {
        await expect(
            scribeService.evaluateAmbientDelta({
                documentId: 5, organizationId: 9999, text: "Fee is TBD.",
            }),
        ).rejects.toThrow(/not found/i);

        // The org gate runs before anything reaches the room.
        expect(published).toHaveLength(0);
    });
});
