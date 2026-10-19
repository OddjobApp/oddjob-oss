/**
 * Defined-term drift: the same term written two ways.
 *
 * "Confidential Information" defined and "confidential information" used, or
 * "Sub-Processor" defined and "Sub Processor" used. To a court those are two
 * things; the drafter meant one.
 *
 * The false-positive risk here is sharper than for undefined terms, because a
 * contract deliberately uses the lowercase generic alongside the defined term —
 * "Services" the defined scope versus "services" the ordinary word. Getting
 * that wrong puts a marker on correct drafting several times a paragraph, which
 * is the fastest way to make a gutter worthless. So the rule is measured
 * against passages where drift must NOT be reported, and the count is asserted.
 */

import { describe, expect, it } from "vitest";
import { findTermDrift } from "../core/defined-terms.service.js";

const CONFIDENTIAL = ["Confidential Information"];

/** Must produce NO drift marker. */
const CLEAN: Array<[string, string, string[], string[]]> = [
    [
        "the term used correctly throughout",
        "Confidential Information must be protected. Confidential Information survives termination.",
        CONFIDENTIAL,
        [],
    ],
    [
        "an approved alias from the ledger",
        "Confidential Information is protected. Confidential Info may be shared internally.",
        CONFIDENTIAL,
        ["Confidential Info"],
    ],
    [
        "ordinary prose that shares no full term",
        "The information provided was confidential in nature and handled with care.",
        CONFIDENTIAL,
        [],
    ],
    [
        "a single-word defined term used generically",
        // The case that makes single-word terms unusable: a contract defines
        // Services and then writes services for the ordinary sense, on purpose.
        "The Services are described in Schedule A. Support services are billed separately.",
        ["Services"],
        [],
    ],
    [
        "the definition site itself, quoted",
        '"Confidential Information" means any non-public material disclosed hereunder.',
        CONFIDENTIAL,
        [],
    ],
    [
        "no defined terms at all",
        "The parties agree to act in good faith throughout the term.",
        [],
        [],
    ],
];

/** Must produce a drift marker. */
const DRIFTED: Array<[string, string, string[], string[], string]> = [
    [
        "lowercased mid-sentence",
        "The receiving party shall protect confidential information at all times.",
        CONFIDENTIAL,
        [],
        "confidential information",
    ],
    [
        "title case lost on one word",
        "Confidential information disclosed under this clause survives.",
        CONFIDENTIAL,
        [],
        "Confidential information",
    ],
    [
        "hyphen dropped",
        "Each Sub-Processor is vetted. Any Sub Processor must sign the addendum.",
        ["Sub-Processor"],
        [],
        "Sub Processor",
    ],
    [
        "hyphen added",
        "The Service Credit applies monthly. A Service-Credit is not a refund.",
        ["Service Credit"],
        [],
        "Service-Credit",
    ],
];

describe("precision — drift must not fire on correct drafting", () => {
    it.each(CLEAN)("stays silent on %s", (_n, text, defined, aliases) => {
        expect(findTermDrift(text, defined, aliases)).toEqual([]);
    });

    it("measures a false-positive rate of zero across the clean corpus", () => {
        const total = CLEAN.reduce(
            (n, [, text, defined, aliases]) => n + findTermDrift(text, defined, aliases).length,
            0,
        );
        expect(total).toBe(0);
    });

    it("never reports a single-word term, however it is cased", () => {
        // Stated as a rule rather than left to the corpus: this restriction is
        // what makes the check usable on a real contract at all.
        const text = "The Agreement is signed. This agreement governs. That AGREEMENT is void.";
        expect(findTermDrift(text, ["Agreement"], [])).toEqual([]);
    });
});

describe("recall — drift that matters", () => {
    it.each(DRIFTED)("flags %s", (_n, text, defined, aliases, expected) => {
        const found = findTermDrift(text, defined, aliases);
        expect(found.map((f) => f.variant)).toContain(expected);
    });

    it("names the canonical form so the author knows what to write", () => {
        const [finding] = findTermDrift(
            "Handling of confidential information is governed here.",
            CONFIDENTIAL,
            [],
        );
        expect(finding.canonical).toBe("Confidential Information");
        expect(finding.variant).toBe("confidential information");
    });

    it("anchors the marker to the drifted phrase", () => {
        const text = "Handling of confidential information is governed here.";
        const [finding] = findTermDrift(text, CONFIDENTIAL, []);
        expect(text.slice(finding.start, finding.end)).toBe(finding.variant);
    });

    it("reports one marker per distinct variant, not per occurrence", () => {
        const text =
            "confidential information here, and confidential information again, and once more confidential information.";
        expect(findTermDrift(text, CONFIDENTIAL, [])).toHaveLength(1);
    });

    it("separates two different variants of the same term", () => {
        const text = "First confidential information, then Confidential information.";
        const variants = findTermDrift(text, CONFIDENTIAL, []).map((f) => f.variant);
        expect(new Set(variants).size).toBe(2);
    });

    it("picks up a term defined in this very section", () => {
        // The ledger may not have caught up yet mid-edit.
        const text = '"Receiving Party" means the recipient. The receiving party shall comply.';
        const found = findTermDrift(text, [], []);
        expect(found.map((f) => f.variant)).toContain("receiving party");
    });

    it("distinguishes a spacing drift from a casing drift", () => {
        const spacing = findTermDrift("Any Sub Processor must sign.", ["Sub-Processor"], []);
        expect(spacing[0].kind).toBe("spacing");

        const casing = findTermDrift("Handling of confidential information.", CONFIDENTIAL, []);
        expect(casing[0].kind).toBe("casing");
    });
});
