/**
 * Tier 1 runs on every keystroke, so what matters is that it is right, cheap,
 * and quiet. Quiet especially: a rule that fires on ordinary prose becomes
 * something authors learn to ignore, which is worse than not having it.
 */

import { describe, expect, it } from "vitest";
import {
    evaluateAmbient,
    highestSeverity,
    insightsChanged,
    type AmbientInsight,
} from "../core/ambient-sentinel.service.js";

const ids = (out: AmbientInsight[]) => out.map((i) => i.ruleId);

describe("placeholders", () => {
    it.each(["TODO", "TBD", "FIXME", "XXX", "PLACEHOLDER"])("catches %s", (token) => {
        const out = evaluateAmbient(`The fee schedule is ${token} before signing.`);
        expect(ids(out)).toContain("placeholder_token");
    });

    it("is case-insensitive but still word-bounded", () => {
        expect(ids(evaluateAmbient("this is tbd"))).toContain("placeholder_token");
        // "tbdx" is not a placeholder, and neither is a word that contains it.
        expect(ids(evaluateAmbient("the tbdx protocol"))).not.toContain("placeholder_token");
    });

    it("catches an unfilled bracketed field", () => {
        expect(ids(evaluateAmbient("This agreement is between [PARTY NAME] and us."))).toContain("bracketed_blank");
        expect(ids(evaluateAmbient("Delivery by <INSERT DATE>."))).toContain("bracketed_blank");
        expect(ids(evaluateAmbient("Signed by ___ on [__]."))).toContain("bracketed_blank");
    });

    it("leaves ordinary citations and inline code alone", () => {
        // The reason to bound the pattern: prose is full of brackets.
        expect(ids(evaluateAmbient("As shown in [1] and [2]."))).not.toContain("bracketed_blank");
        expect(ids(evaluateAmbient("Call items[i] in the loop."))).not.toContain("bracketed_blank");
    });

    it("treats lorem ipsum as the most serious placeholder", () => {
        const out = evaluateAmbient("Lorem ipsum dolor sit amet.");
        expect(out[0].ruleId).toBe("lorem_ipsum");
        expect(out[0].severity).toBe("critical_conflict");
    });
});

describe("legal precision rules", () => {
    const msa = "saas_msa" as const;

    it.each([
        "reasonable efforts",
        "best efforts",
        "commercially reasonable",
        "promptly",
        "in a timely manner",
        "as soon as reasonably possible",
        "from time to time",
    ])("flags the unmeasurable obligation %s", (phrase) => {
        const out = evaluateAmbient(`Vendor shall respond ${phrase} to each request.`, msa);
        expect(ids(out)).toContain("vague_obligation");
    });

    it("flags unbounded liability", () => {
        const out = evaluateAmbient("The provider accepts unlimited liability for losses.", msa);
        expect(ids(out)).toContain("unbounded_liability");
        expect(out.find((i) => i.ruleId === "unbounded_liability")!.severity).toBe("critical_conflict");
    });

    it("does not apply legal rules to a novel", () => {
        // "promptly" is ordinary narration, not a defect, outside a contract.
        const out = evaluateAmbient("She promptly left the room.", "heros_journey");
        expect(ids(out)).not.toContain("vague_obligation");
    });

    it("stays silent on an obligation that is already measurable", () => {
        const out = evaluateAmbient("Vendor shall respond within 4 business hours.", msa);
        expect(ids(out)).not.toContain("vague_obligation");
    });

    it("does not fire on 'material breach', which is a term of art", () => {
        const out = evaluateAmbient("Either party may terminate on material breach.", msa);
        expect(ids(out)).not.toContain("vague_obligation");
    });
});

describe("service levels", () => {
    const msa = "saas_msa" as const;

    it("flags a service level with no unit", () => {
        expect(ids(evaluateAmbient("Target of 99.9 uptime.", msa))).toContain("sla_without_unit");
    });

    it("accepts one that carries its unit", () => {
        expect(ids(evaluateAmbient("Target of 99.9% uptime.", msa))).not.toContain("sla_without_unit");
        expect(ids(evaluateAmbient("Response time of 200ms.", msa))).not.toContain("sla_without_unit");
    });
});

describe("style", () => {
    it("catches a repeated word", () => {
        const out = evaluateAmbient("The the agreement is signed.");
        expect(ids(out)).toContain("duplicated_word");
    });

    it("does not treat a legitimate repeat as a defect", () => {
        // "had had" is grammatical; so is any word followed by a different one.
        expect(ids(evaluateAmbient("The party is bound."))).not.toContain("duplicated_word");
    });

    it("catches double spacing after a sentence", () => {
        expect(ids(evaluateAmbient("One.  Two."))).toContain("double_space_after_period");
    });
});

describe("figures that contradict each other", () => {
    const CONFLICT = "The Annual Fee is £2.4M in year one. The Annual Fee is £2.1M thereafter.";

    it("reaches Tier 1 without a ledger", () => {
        // No dataset, no defined-term sync, no model — the document is compared
        // against itself, so this fires on the very first keystroke of a
        // brand-new station.
        expect(ids(evaluateAmbient(CONFLICT))).toContain("figure_conflict");
    });

    it("fires outside legal archetypes too", () => {
        // A board paper contradicting itself is the same defect as a contract
        // doing it; only the term rules are archetype-gated.
        expect(ids(evaluateAmbient(CONFLICT, "freeform"))).toContain("figure_conflict");
        expect(ids(evaluateAmbient(CONFLICT, "saas_msa"))).toContain("figure_conflict");
    });

    it("is a conflict, not a suggestion", () => {
        const found = evaluateAmbient(CONFLICT).find((i) => i.ruleId === "figure_conflict")!;
        expect(found.severity).toBe("critical_conflict");
        expect(found.lensType).toBe("fact_check");
    });

    it("names both figures so the author can see the mismatch without scrolling", () => {
        const found = evaluateAmbient(CONFLICT).find((i) => i.ruleId === "figure_conflict")!;
        expect(found.title).toContain("£2.4M");
        expect(found.title).toContain("£2.1M");
    });

    it("anchors on the later figure, which is the one on screen", () => {
        const found = evaluateAmbient(CONFLICT).find((i) => i.ruleId === "figure_conflict")!;

        expect(CONFLICT.slice(found.start, found.end)).toBe(found.excerpt);
        expect(found.excerpt).toBe("£2.1M");
    });

    it("stays quiet on prose that merely contains numbers", () => {
        // The rule that would be learned-to-ignore: pairing up unrelated
        // figures. Nothing here is a restatement of anything.
        const prose =
            "The vendor shall deliver the report within 5 business days. " +
            "The board has 9 members and meets 4 times a year. Uptime runs at 99.9%.";
        expect(ids(evaluateAmbient(prose, "saas_msa"))).not.toContain("figure_conflict");
    });

    it("stays quiet when the same amount is written two ways", () => {
        const restated = "The Annual Fee is £2.4M. For the avoidance of doubt the Annual Fee is £2,400,000.";
        expect(ids(evaluateAmbient(restated, "saas_msa"))).not.toContain("figure_conflict");
    });
});

describe("output shape", () => {
    it("says nothing about clean prose", () => {
        const clean = "The vendor shall deliver the report within five business days of each quarter end.";
        expect(evaluateAmbient(clean, "saas_msa")).toEqual([]);
    });

    it("returns nothing for empty text", () => {
        expect(evaluateAmbient("")).toEqual([]);
        expect(evaluateAmbient(undefined as any)).toEqual([]);
    });

    it("reports offsets that actually locate the excerpt", () => {
        const text = "Fee is TBD for now.";
        const [insight] = evaluateAmbient(text);

        // The gutter marker depends on this being exact.
        expect(text.slice(insight.start, insight.end)).toBe(insight.excerpt);
        expect(insight.excerpt).toBe("TBD");
    });

    it("orders findings by position so the gutter reads top to bottom", () => {
        const out = evaluateAmbient("TODO first. Then lorem ipsum. Then TBD.");
        const starts = out.map((i) => i.start);
        expect([...starts].sort((a, b) => a - b)).toEqual(starts);
    });

    it("reports every occurrence, not just the first", () => {
        const out = evaluateAmbient("TODO one and TODO two and TODO three.");
        expect(out.filter((i) => i.ruleId === "placeholder_token")).toHaveLength(3);
    });

    it("is deterministic across repeated calls", () => {
        // A shared global RegExp carries lastIndex between calls and silently
        // drops matches on the second run; this is what catches that.
        const text = "TODO one and TODO two.";
        expect(evaluateAmbient(text)).toEqual(evaluateAmbient(text));
    });

    it("caps a flood so one paste cannot swamp the room", () => {
        const out = evaluateAmbient(Array(100).fill("TODO").join(" "));
        expect(out.length).toBeLessThanOrEqual(25);
    });
});

describe("highestSeverity", () => {
    it("returns null when there is nothing to report", () => {
        expect(highestSeverity([])).toBeNull();
    });

    it("picks the worst, not the first", () => {
        const out = evaluateAmbient("The the fee is lorem ipsum.");
        expect(highestSeverity(out)).toBe("critical_conflict");
    });
});

describe("insightsChanged", () => {
    it("is false while the author types inside clean prose", () => {
        // The whole point: no broadcast when nothing changed.
        expect(insightsChanged([], [])).toBe(false);
    });

    it("is true when a finding appears or clears", () => {
        const one = evaluateAmbient("Fee is TBD.");
        expect(insightsChanged([], one)).toBe(true);
        expect(insightsChanged(one, [])).toBe(true);
    });

    it("is true when a finding moves, even with the same count", () => {
        const before = evaluateAmbient("TODO here.");
        const after = evaluateAmbient("Now the TODO is here.");
        expect(before).toHaveLength(1);
        expect(after).toHaveLength(1);
        expect(insightsChanged(before, after)).toBe(true);
    });

    it("is false for an identical re-evaluation", () => {
        const text = "Fee is TBD.";
        expect(insightsChanged(evaluateAmbient(text), evaluateAmbient(text))).toBe(false);
    });
});
