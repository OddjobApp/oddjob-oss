/**
 * The screen reaching the critic pass, not just existing beside it.
 *
 * proposal-safety.test.ts proves the rule. This proves the critic actually runs
 * a model's answer through it before writing the row — the gap that would let
 * an invented liability cap reach the annotation table with the rule sitting
 * unused one file away.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

const generateText = vi.fn();
vi.mock("@domain/ai/index.js", () => ({ systemAiService: { generateText } }));
vi.mock("@domain/crew/core/crew-stream.service.js", () => ({ crewStreamService: { publish: vi.fn() } }));
vi.mock("@server/utils/logger.js", () => ({
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const STATION = {
    id: 7,
    documentId: 5,
    stationKey: "liability",
    title: "Liability",
    content:
        "The vendor accepts unlimited liability for all losses arising from the services. " +
        "The Annual Fee is £2.4M for the initial term of 24 months.",
};

/** Rows the critic pass tried to write. */
const inserted: any[] = [];

/**
 * .where(...) is awaited directly for the station reads and chained into
 * .limit(1) for the document lookup, so the mock has to be both.
 */
const rows = (result: any[]) => ({
    then: (ok: any, no: any) => Promise.resolve(result).then(ok, no),
    limit: async () => [{ id: 5, organizationId: 7 }],
});

vi.mock("@server/database_service.js", () => ({
    db: {
        select: (cols?: any) => ({
            // A projected select is the document-wide corpus read; a bare one
            // is the stations to review.
            from: () => ({ where: () => rows(cols ? [{ content: STATION.content }] : [STATION]) }),
        }),
        insert: () => ({
            values: (row: any) => ({ returning: async () => { inserted.push(row); return [row]; } }),
        }),
    },
}));

const { scribeService } = await import("../core/scribe.service.js");

const runCritic = () => scribeService.runCriticEvaluation(5, 7, undefined, ["legal"]);

describe("what the critic pass stores", () => {
    beforeEach(() => {
        inserted.length = 0;
        generateText.mockReset();
    });

    const modelReturns = (item: Record<string, unknown>) =>
        generateText.mockResolvedValue(JSON.stringify([{
            title: "Uncapped liability",
            severity: "critical_conflict",
            critiqueBody: "The vendor's exposure is unlimited.",
            excerpt: "unlimited liability for all losses",
            ...item,
        }]));

    it("blanks a liability cap the model invented", async () => {
        modelReturns({ proposedDiff: "Liability shall be capped at £5,000,000." });

        await runCritic();

        expect(inserted).toHaveLength(1);
        expect(inserted[0].proposedDiff).not.toContain("5,000,000");
        expect(inserted[0].proposedDiff).toContain("[AMOUNT");
    });

    it("refuses to store wording that invents a compliance obligation", async () => {
        modelReturns({ proposedDiff: "The vendor shall maintain SOC 2 Type II certification." });

        await runCritic();

        expect(inserted[0].proposedDiff).toBeNull();
    });

    it("keeps the critique itself, which is the part worth having", async () => {
        // "Liability here is uncapped" is true whether or not the model's
        // proposed cap is worth applying.
        modelReturns({ proposedDiff: "Capped at £5,000,000." });

        await runCritic();

        expect(inserted[0].title).toBe("Uncapped liability");
        expect(inserted[0].critiqueBody).toContain("The vendor's exposure is unlimited.");
    });

    it("tells the author what was taken out", async () => {
        modelReturns({ proposedDiff: "Capped at £5,000,000." });

        await runCritic();

        expect(inserted[0].critiqueBody).toContain("£5,000,000");
    });

    it("leaves a sound proposal exactly as written", async () => {
        // The fee is stated in the document, so nothing here is invented.
        modelReturns({ proposedDiff: "Liability shall be capped at £2.4M." });

        await runCritic();

        expect(inserted[0].proposedDiff).toBe("Liability shall be capped at £2.4M.");
        expect(inserted[0].critiqueBody).toBe("The vendor's exposure is unlimited.");
    });
});
