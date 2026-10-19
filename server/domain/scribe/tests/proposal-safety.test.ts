/**
 * A critic writing terms the author never agreed to.
 *
 * The audit found recommendations that invented compliance requirements,
 * remedies and a liability amount. The prompt now forbids it; this is the part
 * that does not depend on the model having listened, because proposedDiff is
 * one click from being written into the clause.
 *
 * The other half matters just as much: a screen that blanks out ordinary
 * numbers would put brackets through sound prose and teach the author to
 * ignore them. So the cases that must pass through untouched come first.
 */

import { describe, expect, it } from "vitest";
import { screenProposal } from "../core/proposal-safety.service.js";

const CONTRACT =
    "The Annual Fee is £2.4M for the initial term of 24 months. " +
    "The vendor shall respond to a Severity 1 incident within 4 hours. " +
    "Uptime shall not fall below 99.9% in any calendar month.";

describe("proposals that pass through untouched", () => {
    const SAFE = [
        ["no figures at all", "The vendor shall act in good faith at all times."],
        ["a figure the document already states", "Liability shall be capped at £2.4M."],
        ["the same amount written another way", "Liability shall be capped at £2,400,000."],
        ["a term the document already states", "The agreement runs for 24 months."],
        ["an SLA the document already states", "Uptime shall not fall below 99.9%."],
        ["small numbers that are not commercial terms", "Both parties shall each name 2 representatives."],
        ["list numbering", "The vendor shall: 1. deliver the report; 2. present it; 3. revise it."],
    ] as const;

    it.each(SAFE)("leaves %s alone", (_name, proposal) => {
        const out = screenProposal(proposal, CONTRACT);

        expect(out.proposedDiff).toBe(proposal);
        expect(out.redactions).toEqual([]);
    });

    it("measures a zero redaction rate across the safe corpus", () => {
        const total = SAFE.reduce((n, [, p]) => n + screenProposal(p, CONTRACT).redactions.length, 0);
        expect(total).toBe(0);
    });

    it("handles an absent proposal", () => {
        expect(screenProposal(null, CONTRACT)).toEqual({ proposedDiff: null, redactions: [] });
        expect(screenProposal(undefined, CONTRACT)).toEqual({ proposedDiff: null, redactions: [] });
        expect(screenProposal("   ", CONTRACT)).toEqual({ proposedDiff: null, redactions: [] });
    });
});

describe("a liability amount the model chose", () => {
    it("blanks a cap that appears nowhere in the document", () => {
        const out = screenProposal("Liability shall be capped at £5,000,000.", CONTRACT);

        expect(out.proposedDiff).not.toContain("5,000,000");
        expect(out.proposedDiff).toContain("[AMOUNT — to be agreed]");
    });

    it("leaves a bracketed blank, so Tier 1 tracks the open decision", () => {
        // bracketed_blank already flags this in the gutter the moment it is
        // applied, so an unfilled term cannot quietly reach a signature.
        const out = screenProposal("Liability shall be capped at £5,000,000.", CONTRACT);
        expect(out.proposedDiff).toMatch(/\[[^\]]+\]/);
    });

    it("tells the author what was taken out and why", () => {
        const [note] = screenProposal("Capped at £5,000,000.", CONTRACT).redactions;

        expect(note).toContain("£5,000,000");
        expect(note).toMatch(/do(es)? not appear/);
    });

    it("blanks an invented notice period", () => {
        const out = screenProposal("Either party may terminate on 90 days written notice.", CONTRACT);
        expect(out.proposedDiff).toContain("[NUMBER — to be agreed]");
    });

    it("blanks an invented service level", () => {
        const out = screenProposal("Uptime shall not fall below 99.99%.", CONTRACT);
        expect(out.proposedDiff).toContain("[PERCENTAGE — to be agreed]");
    });

    it("blanks every invented figure, not just the first", () => {
        const out = screenProposal("Capped at £5,000,000 for a term of 60 months.", CONTRACT);

        expect(out.proposedDiff).not.toContain("5,000,000");
        expect(out.proposedDiff).not.toContain("60");
    });

    it("keeps the figures the document does state while blanking the ones it does not", () => {
        const out = screenProposal("The Annual Fee of £2.4M shall be capped at £5,000,000.", CONTRACT);

        expect(out.proposedDiff).toContain("£2.4M");
        expect(out.proposedDiff).not.toContain("5,000,000");
    });

    it("keeps the wording around the blank intact", () => {
        // Replacing right to left, so an earlier substitution cannot shift a
        // later offset and corrupt the sentence.
        const out = screenProposal("Capped at £5,000,000 and £7,000,000 respectively.", CONTRACT);

        expect(out.proposedDiff).toMatch(/^Capped at \[.+\] and \[.+\] respectively\.$/);
    });
});

describe("a compliance obligation the model decided applied", () => {
    it("does not offer wording that names an unmentioned standard", () => {
        // Not a clause with a gap in it. Whether SOC 2 applies is a question
        // about the parties and the data, which the model cannot see.
        const out = screenProposal("The vendor shall maintain SOC 2 Type II certification.", CONTRACT);

        expect(out.proposedDiff).toBeNull();
    });

    it.each(["GDPR", "HIPAA", "ISO 27001", "PCI DSS", "FedRAMP", "Sarbanes-Oxley"])(
        "catches %s",
        (standard) => {
            expect(screenProposal(`The vendor shall comply with ${standard}.`, CONTRACT).proposedDiff).toBeNull();
        },
    );

    it("says which standard it was and leaves the decision with the author", () => {
        const [note] = screenProposal("Must comply with HIPAA.", CONTRACT).redactions;

        expect(note).toContain("HIPAA");
        expect(note).toMatch(/yours to decide/);
    });

    it("allows a standard the document already invokes", () => {
        const gdprContract = CONTRACT + " The parties shall process personal data under the UK GDPR.";
        const proposal = "The vendor shall appoint a data protection officer as required by the UK GDPR.";

        expect(screenProposal(proposal, gdprContract).proposedDiff).toBe(proposal);
    });

    it("matches a standard regardless of how the document cased it", () => {
        const proposal = "The vendor shall comply with gdpr.";
        expect(screenProposal(proposal, CONTRACT + " GDPR applies.").proposedDiff).toBe(proposal);
    });

    it("drops the proposal even when its figures were all sound", () => {
        // The obligation is the problem, not the numbers.
        const out = screenProposal("Maintain HIPAA controls for 24 months.", CONTRACT);
        expect(out.proposedDiff).toBeNull();
    });
});
