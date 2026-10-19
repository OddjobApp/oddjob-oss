/**
 * Anchoring a critique to the passage it is about.
 *
 * paragraphAnchor has been on scribe_annotations since Scribe shipped, accepted
 * by createAnnotation and the route, and never written by the critic pass or
 * read by the gallery. So every AI finding arrived unplaced: on a 5,000-word
 * station, "use active voice" is not something an author can act on without
 * knowing where.
 *
 * The rule that matters is the negative one. A model asked to quote a phrase
 * will sometimes tidy it, paraphrase it, or invent it, and an anchor pointing
 * at the wrong sentence is worse than no anchor — it sends the author to edit
 * something that was fine.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("@domain/ai/index.js", () => ({ systemAiService: { generateText: vi.fn() } }));
vi.mock("@domain/crew/core/crew-stream.service.js", () => ({ crewStreamService: { publish: vi.fn() } }));
vi.mock("@server/database_service.js", () => ({ db: {} }));
vi.mock("@server/utils/logger.js", () => ({
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const { scribeService } = await import("../core/scribe.service.js");
const anchorFor = (excerpt: unknown, content: string) =>
    (scribeService as any).anchorFor(excerpt, content);

const CONTENT =
    "The vendor accepts unlimited liability for all losses arising from the services. " +
    "Payment falls due within thirty days of invoice.";

describe("anchorFor", () => {
    it("anchors to a phrase that is really in the station", () => {
        expect(anchorFor("unlimited liability for all losses", CONTENT)).toBe(
            "unlimited liability for all losses",
        );
    });

    it("refuses a phrase the model invented", () => {
        // The failure that matters: an anchor pointing at text the author never
        // wrote would move the marker onto an unrelated sentence.
        expect(anchorFor("uncapped indemnity obligations", CONTENT)).toBeNull();
    });

    it("refuses a paraphrase, however close", () => {
        // "unlimited liabilities" is not what the text says.
        expect(anchorFor("unlimited liabilities for all losses", CONTENT)).toBeNull();
    });

    it("trims surrounding whitespace before matching", () => {
        expect(anchorFor("  unlimited liability  ", CONTENT)).toBe("unlimited liability");
    });

    it("refuses a phrase too short to locate anything", () => {
        // "the" occurs everywhere; anchoring to it places the marker at random.
        expect(anchorFor("the", CONTENT)).toBeNull();
        expect(anchorFor("vendor", CONTENT)).toBeNull();
    });

    it("accepts a phrase at the length boundary that does occur", () => {
        expect(anchorFor("thirty days", CONTENT)).toBe("thirty days");
    });

    it("handles a critique about the section as a whole", () => {
        // The prompt allows null when nothing specific is meant.
        expect(anchorFor(null, CONTENT)).toBeNull();
        expect(anchorFor(undefined, CONTENT)).toBeNull();
    });

    it("ignores a non-string the model may return", () => {
        expect(anchorFor(42, CONTENT)).toBeNull();
        expect(anchorFor({ text: "unlimited liability" }, CONTENT)).toBeNull();
        expect(anchorFor(["unlimited liability"], CONTENT)).toBeNull();
    });

    it("handles an empty station without throwing", () => {
        expect(anchorFor("anything at all", "")).toBeNull();
    });
});
