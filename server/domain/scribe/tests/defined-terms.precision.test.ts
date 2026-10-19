/**
 * Does this rule earn its place in the gutter?
 *
 * Recall is the easy half — finding every undefined term is a matter of
 * matching capitals. Precision is what decides whether the feature helps: a
 * marker that appears next to correct prose trains the author to stop reading
 * markers, and then the real findings go unread too. That failure is invisible
 * in a demo and fatal in use.
 *
 * So this measures the rule against realistic passages rather than asserting on
 * contrived ones, and holds it to a stated bar. What CANNOT be established here
 * is whether an author acts on a correct marker — that needs real usage, and no
 * amount of testing substitutes for it. What can be established is that the
 * markers we do show are not noise.
 */

import { describe, expect, it } from "vitest";
import {
    extractDefinedTerms,
    extractTermUsages,
    findUndefinedTerms,
} from "../core/defined-terms.service.js";

/**
 * Passages that must produce NO undefined-term marker. Drawn from the shapes
 * real documents take: contract prose with terms properly defined, ordinary
 * narrative, and technical writing full of capitalised nouns that are not
 * defined terms.
 */
const CLEAN_PASSAGES: Array<[string, string, string[]]> = [
    [
        "contract with the term defined inline",
        'This Agreement defines "Confidential Information" as any non-public material. Confidential Information must be protected by the receiving party.',
        [],
    ],
    [
        "contract relying on the ledger from an earlier section",
        "Confidential Information disclosed under this section survives termination.",
        ["Confidential Information"],
    ],
    [
        "parenthetical definition",
        'Acme Corp (the "Supplier") shall deliver the goods. The Supplier bears the shipping cost.',
        ["Acme Corp"],
    ],
    [
        "ordinary narrative prose",
        "She walked to the harbour on Tuesday morning. The Adriatic Sea was flat and grey, and the boats had not gone out.",
        ["Adriatic Sea"],
    ],
    [
        "sentence openers that happen to be capitalised",
        "The vendor shall respond within four hours. Notwithstanding Section 4, no other remedy applies. Such delay is excused.",
        [],
    ],
    [
        "cross references and schedule names",
        "The fees are set out in Schedule A and Exhibit B. Section 12 governs termination.",
        [],
    ],
    [
        "dates and days",
        "Payment is due on Friday 14 March. The March invoice covers the prior month.",
        [],
    ],
    [
        "single capitalised proper nouns",
        "Ada reviewed the draft in London before sending it to Paris.",
        [],
    ],
];

/** Passages where a marker SHOULD appear — the rule must still work. */
const DEFECTIVE_PASSAGES: Array<[string, string, string[], string]> = [
    [
        "term used but never defined",
        "The Receiving Party shall protect all disclosed material.",
        [],
        "Receiving Party",
    ],
    [
        "term defined elsewhere but not this one",
        "Confidential Information and Derivative Works are both protected.",
        ["Confidential Information"],
        "Derivative Works",
    ],
    [
        "capitalised obligation term with no definition",
        "Failure to meet the Service Credit threshold triggers a refund.",
        [],
        "Service Credit",
    ],
];

describe("defined-term extraction", () => {
    it("recognises the quoted-definition form", () => {
        const terms = extractDefinedTerms('"Confidential Information" means any non-public material.');
        expect(terms.map((t) => t.term)).toContain("Confidential Information");
    });

    it("recognises the parenthetical form", () => {
        const terms = extractDefinedTerms('Acme Corp (the "Supplier") shall deliver.');
        expect(terms.map((t) => t.term)).toContain("Supplier");
    });

    it("recognises an unquoted multi-word definition", () => {
        const terms = extractDefinedTerms("Service Credit means a percentage of monthly fees.");
        expect(terms.map((t) => t.term)).toContain("Service Credit");
    });

    it("does not treat a sentence subject as a definition", () => {
        // "This means" opens a sentence; it defines nothing.
        const terms = extractDefinedTerms("This means the parties must confer.");
        expect(terms.map((t) => t.term)).not.toContain("This");
    });
});

describe("usage detection is deliberately conservative", () => {
    it("ignores a single capitalised word", () => {
        // A lone capital is a proper noun, a heading, or a sentence opener far
        // more often than a defined term. Flagging those is what makes a rule
        // unreadable.
        expect(extractTermUsages("London was cold.")).toEqual([]);
    });

    it("finds a multi-word capitalised phrase", () => {
        const uses = extractTermUsages("The Receiving Party agreed.");
        expect(uses.map((u) => u.term)).toContain("Receiving Party");
    });

    it("strips a leading sentence opener from the phrase", () => {
        // "The Receiving Party" is the phrase; "The" is grammar.
        const uses = extractTermUsages("The Receiving Party agreed.");
        expect(uses.every((u) => !u.term.startsWith("The "))).toBe(true);
    });
});

describe("precision on realistic prose", () => {
    it.each(CLEAN_PASSAGES)("stays silent on %s", (_name, text, known) => {
        expect(findUndefinedTerms(text, known)).toEqual([]);
    });

    it("measures a false-positive rate of zero across the clean corpus", () => {
        // The number the decision to ship rests on. Stated rather than implied,
        // so a rule change that starts crying wolf fails here loudly.
        const totalFindings = CLEAN_PASSAGES.reduce(
            (n, [, text, known]) => n + findUndefinedTerms(text, known).length,
            0,
        );
        expect(totalFindings).toBe(0);
    });
});

describe("recall on defective prose", () => {
    it.each(DEFECTIVE_PASSAGES)("flags %s", (_name, text, known, expected) => {
        const found = findUndefinedTerms(text, known).map((f) => f.term);
        expect(found).toContain(expected);
    });

    it("reports one marker per term, not one per use", () => {
        // Five uses of one undefined term is one problem.
        const text = "The Receiving Party must act. The Receiving Party shall not disclose. Receiving Party obligations survive.";
        expect(findUndefinedTerms(text, [])).toHaveLength(1);
    });

    it("clears the marker as soon as the author defines the term", () => {
        const before = findUndefinedTerms("The Receiving Party shall protect it.", []);
        const after = findUndefinedTerms(
            '"Receiving Party" means the party receiving disclosure. The Receiving Party shall protect it.',
            [],
        );

        // The feedback loop that makes the marker worth reading: fix it and it
        // goes away in the same keystroke.
        expect(before).toHaveLength(1);
        expect(after).toEqual([]);
    });

    it("does not scold an author for using a term defined later in the section", () => {
        // Contracts routinely use a term above its definition block.
        const text = 'The Receiving Party shall protect it. In this section, "Receiving Party" means the recipient.';
        expect(findUndefinedTerms(text, [])).toEqual([]);
    });

    it("anchors the marker to the phrase in the text", () => {
        const text = "The Receiving Party shall protect it.";
        const [finding] = findUndefinedTerms(text, []);
        expect(text.slice(finding.start, finding.end)).toBe("Receiving Party");
    });
});
