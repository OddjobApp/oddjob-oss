/**
 * Accepting a spelling.
 *
 * Drift detection is only worth having if the author can disagree with it. A
 * contract that deliberately uses "Confidential Info" as a short form must be
 * able to settle that once — a warning that cannot be settled is one the author
 * learns to scroll past, and then the warnings that matter go with it.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { findTermDrift } from "../core/defined-terms.service.js";

const rows: Array<{ id: number; documentId: number; termName: string; aliases: string[] }> = [];
const updates: Array<{ id: number; aliases: string[] }> = [];

vi.mock("@domain/ai/index.js", () => ({ systemAiService: { generateText: vi.fn() } }));
vi.mock("@domain/crew/core/crew-stream.service.js", () => ({ crewStreamService: { publish: vi.fn() } }));
vi.mock("@server/utils/logger.js", () => ({
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock("@server/database_service.js", () => ({
    db: {
        select: () => ({
            from: () => ({
                where: () => ({ limit: async () => rows }),
            }),
        }),
        update: () => ({
            set: (vals: any) => ({
                where: async () => { updates.push({ id: rows[0]?.id ?? -1, aliases: vals.aliases }); },
            }),
        }),
    },
}));

const { scribeService } = await import("../core/scribe.service.js");

// requireDocument is the org gate and is covered elsewhere.
vi.spyOn(scribeService as any, "requireDocument").mockResolvedValue({ id: 5, organizationId: 7 });

describe("addTermAlias", () => {
    beforeEach(() => {
        rows.length = 0;
        updates.length = 0;
        rows.push({ id: 1, documentId: 5, termName: "Confidential Information", aliases: [] });
    });

    it("records the accepted spelling against the canonical term", async () => {
        const out = await scribeService.addTermAlias(5, 7, "Confidential Information", "Confidential Info");

        expect(out.aliases).toContain("Confidential Info");
        expect(updates).toHaveLength(1);
        expect(updates[0].aliases).toEqual(["Confidential Info"]);
    });

    it("is idempotent, so accepting twice does not grow the row", async () => {
        rows[0].aliases = ["Confidential Info"];

        const out = await scribeService.addTermAlias(5, 7, "Confidential Information", "Confidential Info");

        expect(out.aliases).toEqual(["Confidential Info"]);
        expect(updates).toHaveLength(0);
    });

    it("treats a differently-cased spelling as its own alias", async () => {
        // Not the same approval. Drift matches an alias exactly, so accepting
        // "Confidential Info" must not quietly accept "confidential info" —
        // in a contract those are two forms and the author approved one.
        rows[0].aliases = ["Confidential Info"];

        const out = await scribeService.addTermAlias(5, 7, "Confidential Information", "confidential info");

        expect(out.aliases).toEqual(["Confidential Info", "confidential info"]);
        expect(updates).toHaveLength(1);
    });

    it("keeps aliases already accepted", async () => {
        rows[0].aliases = ["CI"];

        const out = await scribeService.addTermAlias(5, 7, "Confidential Information", "Confidential Info");

        expect(out.aliases).toEqual(["CI", "Confidential Info"]);
    });

    it("refuses a term the document has not defined", async () => {
        rows.length = 0;

        await expect(
            scribeService.addTermAlias(5, 7, "Nonexistent Term", "NT"),
        ).rejects.toThrow(/not a defined term/i);
    });

    it("refuses blank input rather than storing an empty alias", async () => {
        await expect(
            scribeService.addTermAlias(5, 7, "Confidential Information", "   "),
        ).rejects.toThrow(/required/i);
        expect(updates).toHaveLength(0);
    });
});

describe("the accepted alias actually silences the marker", () => {
    it("clears the accepted spelling and leaves the others flagged", () => {
        const text = "Confidential information may be shared. confidential information may not.";

        const before = findTermDrift(text, ["Confidential Information"], []);
        const after = findTermDrift(text, ["Confidential Information"], ["Confidential information"]);

        // Two spellings drift; accepting one leaves exactly the other.
        expect(before.map((f) => f.variant).sort()).toEqual(
            ["Confidential information", "confidential information"].sort(),
        );
        expect(after.map((f) => f.variant)).toEqual(["confidential information"]);
    });

    it("scopes the exemption to the accepted form, not the term", () => {
        // Aliases live on the ledger row, so accepting one spelling is not a
        // mute on the term itself.
        const text = "confidential information appears here.";
        expect(findTermDrift(text, ["Confidential Information"], ["Confidential information"])).toHaveLength(1);
    });

    it("does not offer an escape hatch for abbreviations, because none is flagged", () => {
        // Worth stating: drift covers casing and spacing, not abbreviation.
        // "Confidential Info" is a different string, not a variant spelling, so
        // it never raises a marker and never needs accepting. Detecting
        // abbreviations would mean guessing which shortenings are deliberate,
        // and guessing wrong on a contract is the expensive direction.
        expect(findTermDrift("Confidential Info may be shared.", ["Confidential Information"], [])).toEqual([]);
    });
});
