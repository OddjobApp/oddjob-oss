/**
 * The two rules absorbed from the parallel ambient path.
 *
 * They arrived with no precision corpus, so they get one here before they are
 * trusted: an availability target with no remedy, and a sentence long enough to
 * lose the reader. Both are objective, which is why they belong in Tier 1 — and
 * both are easy to make noisy, which is why the silent cases are tested first.
 */

import { describe, expect, it } from "vitest";
import { evaluateAmbient } from "../core/ambient-sentinel.service.js";

const MSA = "saas_msa" as const;
const ids = (text: string, archetype: any = MSA) =>
    evaluateAmbient(text, archetype).map((i) => i.ruleId);

describe("availability target with no remedy", () => {
    it("flags a target stated with nothing behind it", () => {
        expect(ids("The Service will maintain 99.9% uptime each calendar month.")).toContain(
            "sla_without_remedy",
        );
    });

    it("stays silent when a service credit is defined nearby", () => {
        const text =
            "The Service will maintain 99.9% uptime each month. Failure entitles Customer to a service credit.";
        expect(ids(text)).not.toContain("sla_without_remedy");
    });

    it.each(["remedy", "refund", "corrective action", "maintenance window"])(
        "accepts %s as the consequence",
        (word) => {
            const text = `The Service maintains 99.9% availability. Any shortfall triggers the agreed ${word}.`;
            expect(ids(text)).not.toContain("sla_without_remedy");
        },
    );

    it("says nothing about prose that mentions no availability figure", () => {
        expect(ids("The parties shall meet quarterly to review the account.")).not.toContain(
            "sla_without_remedy",
        );
    });

    it("raises one marker however often the target is repeated", () => {
        const text = "Uptime is measured monthly. Uptime excludes maintenance. Uptime is reported.";
        const found = evaluateAmbient(text, MSA).filter((i) => i.ruleId === "sla_without_remedy");
        expect(found).toHaveLength(1);
    });

    it("does not apply to a novel", () => {
        // "availability" is an ordinary word outside a contract.
        expect(ids("Her availability was limited that winter.", "heros_journey")).not.toContain(
            "sla_without_remedy",
        );
    });
});

describe("overlong sentence", () => {
    const long = `The Supplier shall at all times during the term of this agreement and for a period of seven years thereafter maintain complete and accurate books and records relating to the provision of the services and any amounts invoiced under this agreement.`;

    it("flags a sentence past the threshold", () => {
        expect(long.split(/\s+/).length).toBeGreaterThan(38);
        expect(ids(long)).toContain("overlong_sentence");
    });

    it("stays silent on ordinary sentences", () => {
        expect(ids("The Supplier shall keep accurate records for seven years.")).not.toContain(
            "overlong_sentence",
        );
    });

    it("stays silent on several short sentences that are long in total", () => {
        // The rule is about one sentence, not paragraph length. Measuring the
        // paragraph would flag every substantial section.
        const paragraph = Array(8).fill("The Supplier shall keep accurate records.").join(" ");
        expect(paragraph.split(/\s+/).length).toBeGreaterThan(38);
        expect(ids(paragraph)).not.toContain("overlong_sentence");
    });

    it("raises one marker per station, not per long sentence", () => {
        const found = evaluateAmbient(`${long} ${long}`, MSA).filter(
            (i) => i.ruleId === "overlong_sentence",
        );
        expect(found).toHaveLength(1);
    });

    it("applies outside contracts too, unlike the legal rules", () => {
        expect(ids(long, "heros_journey")).toContain("overlong_sentence");
    });
});

describe("patterns widened while absorbing the parallel path", () => {
    it("catches an indemnity worded as uncapped", () => {
        expect(ids("The Supplier shall indemnify without limitation for all claims.")).toContain(
            "unbounded_liability",
        );
    });

    it("catches a bare underscore fill-in line", () => {
        expect(ids("Signed by ______ on behalf of the Supplier.")).toContain("bracketed_blank");
    });

    it("catches a mixed-case insert marker", () => {
        expect(ids("Delivery by [Insert delivery date] at the latest.")).toContain("bracketed_blank");
    });

    it("still leaves ordinary citations alone", () => {
        expect(ids("As set out in [1] and [2] of the annex.")).not.toContain("bracketed_blank");
    });
});
