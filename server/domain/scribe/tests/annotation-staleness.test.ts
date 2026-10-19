/**
 * Critiques that outlived the text they were about.
 *
 * The failure being fixed: nothing ever invalidated an annotation, so a finding
 * against a deleted paragraph stayed open forever — counted in the Health
 * Index, and still offering to apply a replacement written for text that is
 * gone.
 *
 * The failure being guarded against is the opposite one. Marking a live
 * critique stale hides a real finding, and an author who sees that once stops
 * trusting the flag. So the cases that must NOT be called stale come first, and
 * every ambiguous case resolves to current.
 */

import { describe, expect, it } from "vitest";
import {
    markStaleness,
    anchorSurvives,
    scorableAnnotations,
    type AnnotationView,
} from "@shared/scribe-annotation-staleness.js";

const CONTENT =
    "The vendor accepts unlimited liability for all losses arising from the services. " +
    "Payment falls due within thirty days of invoice.";

const annotation = (over: Partial<AnnotationView> = {}) =>
    ({
        id: 1,
        documentId: 5,
        nodeId: 7,
        agentCardId: null,
        lensType: "legal",
        paragraphAnchor: "unlimited liability for all losses",
        severity: "warning",
        title: "Uncapped liability",
        critiqueBody: "This exposes the vendor without limit.",
        proposedDiff: "liability capped at fees paid",
        status: "open",
        createdAt: new Date(),
        ...over,
    }) as any;

const nodes = (content = CONTENT) => [{ id: 7, content }];
const mark = (over: Partial<AnnotationView> = {}, content = CONTENT) =>
    markStaleness([annotation(over)], nodes(content))[0];

describe("anchorSurvives", () => {
    it("finds a passage that is still there", () => {
        expect(anchorSurvives("unlimited liability", CONTENT)).toBe(true);
    });

    it("does not find a passage that was removed", () => {
        expect(anchorSurvives("unlimited liability", "Liability is capped at fees paid.")).toBe(false);
    });

    it("ignores reflowed whitespace", () => {
        // Rewrapping a line is not rewriting it, and calling that stale would
        // train the author to ignore the flag.
        expect(anchorSurvives("unlimited liability for all", "accepts unlimited\n  liability   for all losses")).toBe(true);
    });

    it("treats an empty anchor as no evidence of change", () => {
        expect(anchorSurvives("", CONTENT)).toBe(true);
        expect(anchorSurvives("   ", CONTENT)).toBe(true);
    });
});

describe("critiques that must stay", () => {
    it("keeps one whose passage is untouched", () => {
        expect(mark()).toMatchObject({ isStale: false });
    });

    it("keeps one with no anchor at all", () => {
        // "About the section as a whole", or written by hand. There is nothing
        // to check it against, so it stands.
        expect(mark({ paragraphAnchor: null }, "Completely different text now.")).toMatchObject({
            isStale: false,
        });
    });

    it("keeps one whose station was edited elsewhere", () => {
        const edited = CONTENT + " The parties shall meet quarterly to review performance.";
        expect(mark({}, edited)).toMatchObject({ isStale: false });
    });

    it("leaves a settled annotation alone", () => {
        // Accepted and rejected are records of the author's decision. Relabelling
        // one would overwrite what they already said about it.
        for (const status of ["accepted", "rejected", "resolved"] as const) {
            expect(mark({ status }, "Completely different text now.")).toMatchObject({ isStale: false });
        }
    });
});

describe("critiques that no longer apply", () => {
    it("flags one whose passage was rewritten", () => {
        expect(mark({}, "Liability is capped at the fees paid in the preceding 12 months.")).toMatchObject({
            isStale: true,
            staleReason: "text_changed",
        });
    });

    it("flags one whose station was emptied", () => {
        expect(mark({}, "")).toMatchObject({ isStale: true, staleReason: "text_changed" });
    });

    it("flags one belonging to a branch that is not in view", () => {
        // getDocument loads nodes for the active branch but annotations for the
        // whole document, so another branch's findings arrive in the payload.
        const out = markStaleness([annotation({ nodeId: 999 })], nodes());
        expect(out[0]).toMatchObject({ isStale: true, staleReason: "other_branch" });
    });

    it("says why, so the card can explain itself rather than just hiding", () => {
        expect(mark({}, "Rewritten.").staleReason).toBe("text_changed");
    });
});

describe("what a score is computed from", () => {
    const forNode = (id: number, anchor: string | null) => annotation({ id, nodeId: 7, paragraphAnchor: anchor });

    it("drops stale findings and keeps live ones", () => {
        const marked = markStaleness(
            [forNode(1, "unlimited liability"), forNode(2, "a phrase that was deleted"), forNode(3, null)],
            nodes(),
        );

        expect(scorableAnnotations(marked).map((a) => a.id)).toEqual([1, 3]);
    });

    it("returns everything when the document has not been touched", () => {
        const marked = markStaleness([forNode(1, "unlimited liability"), forNode(2, "thirty days")], nodes());
        expect(scorableAnnotations(marked)).toHaveLength(2);
    });

    it("handles a document with no annotations", () => {
        expect(markStaleness([], nodes())).toEqual([]);
        expect(scorableAnnotations([])).toEqual([]);
    });
});
