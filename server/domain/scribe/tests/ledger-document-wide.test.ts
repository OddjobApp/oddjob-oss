/**
 * Term checks across the whole document, not just the station being edited.
 *
 * This is what the ledger is for. Without it a term defined in section 2 reads
 * as undefined while the author works in section 9 — a marker on correct
 * drafting, every time, which is the failure that makes an author switch the
 * gutter off. The ledger closes that, and these tests hold the seam.
 */

import { describe, expect, it } from "vitest";
import { evaluateAmbient } from "../core/ambient-sentinel.service.js";

const MSA = "saas_msa" as const;
const ids = (text: string, ledger?: { terms: string[]; aliases: string[] }) =>
    evaluateAmbient(text, MSA, ledger).map((i) => i.ruleId);

const LEDGER = (terms: string[], aliases: string[] = []) => ({ terms, aliases });

describe("undefined terms, document-wide", () => {
    const section9 = "The Receiving Party shall protect all disclosed material.";

    it("flags a term the document has never defined", () => {
        expect(ids(section9, LEDGER([]))).toContain("undefined_term");
    });

    it("stays silent once the ledger knows the term from another section", () => {
        // Defined back in section 2. The author editing section 9 must not be
        // told their own defined term is undefined.
        expect(ids(section9, LEDGER(["Receiving Party"]))).not.toContain("undefined_term");
    });

    it("names the term in the marker, so the author knows which one", () => {
        const finding = evaluateAmbient(section9, MSA, LEDGER([])).find(
            (i) => i.ruleId === "undefined_term",
        );
        expect(finding!.title).toContain("Receiving Party");
        expect(section9.slice(finding!.start, finding!.end)).toBe("Receiving Party");
    });
});

describe("term drift, document-wide", () => {
    const drifted = "Handling of confidential information is governed by this clause.";

    it("flags a lowercase form of a term defined elsewhere", () => {
        expect(ids(drifted, LEDGER(["Confidential Information"]))).toContain("term_drift");
    });

    it("says what to write instead", () => {
        const finding = evaluateAmbient(drifted, MSA, LEDGER(["Confidential Information"])).find(
            (i) => i.ruleId === "term_drift",
        );
        expect(finding!.title).toContain("Confidential Information");
    });

    it("respects an alias the author blessed in the ledger", () => {
        const text = "Confidential Info may be shared with counsel.";
        expect(ids(text, LEDGER(["Confidential Information"], ["Confidential Info"]))).not.toContain("term_drift");
    });

    it("does not flag drift for a term the document never defined", () => {
        // Nothing to drift from. That is the undefined-term rule's business.
        expect(ids(drifted, LEDGER([]))).not.toContain("term_drift");
    });
});

describe("term checks are contract-only", () => {
    const text = "Captain Mara crossed the Silent Desert before the Second Dawn.";

    it("says nothing about a novel full of capitalised names", () => {
        // Every character and place would otherwise read as an undefined term,
        // which is the difference between a useful rule and an unusable one.
        const found = evaluateAmbient(text, "heros_journey", LEDGER([])).map((i) => i.ruleId);
        expect(found).not.toContain("undefined_term");
        expect(found).not.toContain("term_drift");
    });

    it("still applies to a contract", () => {
        expect(ids(text, LEDGER([]))).toContain("undefined_term");
    });
});

describe("term checks stay off when no ledger is supplied", () => {
    it("runs the other rules but not the term ones", () => {
        // A caller with no document context gets the station-local rules only,
        // rather than false positives from a ledger it could not load.
        const found = evaluateAmbient("The Receiving Party shall respond promptly. TODO", MSA);
        const foundIds = found.map((i) => i.ruleId);

        expect(foundIds).toContain("placeholder_token");
        expect(foundIds).toContain("vague_obligation");
        expect(foundIds).not.toContain("undefined_term");
    });
});

describe("a term defined in the station being edited", () => {
    it("is known immediately, before the ledger has caught up", () => {
        // Mid-edit the save has not necessarily run, so the ledger lags. The
        // author must not be scolded for a term they just defined.
        const text = '"Receiving Party" means the recipient. The Receiving Party shall comply.';
        expect(ids(text, LEDGER([]))).not.toContain("undefined_term");
    });
});
