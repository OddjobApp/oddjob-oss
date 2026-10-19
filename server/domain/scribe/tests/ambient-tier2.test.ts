/**
 * Tier 2 spends money, so what is tested hardest is when it refuses to.
 *
 * The guard is pure and takes `now` as a parameter precisely so the cooldown
 * can be exercised without waiting a minute — a spend policy nobody can test is
 * a spend policy nobody can trust.
 */

import { describe, expect, it } from "vitest";
import {
    shouldReviewOnSave,
    changedChars,
    parseAmbientFindings,
    lensesForArchetype,
    buildAmbientPrompt,
    MIN_REVIEW_CHARS,
    REVIEW_COOLDOWN_MS,
    MIN_CHANGED_CHARS,
} from "../core/ambient-tier2.service.js";

const long = (n = MIN_REVIEW_CHARS + 50) => "a".repeat(n);
const NOW = 1_700_000_000_000;

describe("shouldReviewOnSave", () => {
    it("reviews a substantial station the first time it is saved", () => {
        expect(shouldReviewOnSave({ text: long(), now: NOW })).toEqual({
            review: true,
            reason: "first_review",
        });
    });

    it("refuses a station too short to be worth a model call", () => {
        const d = shouldReviewOnSave({ text: "Short opening line.", now: NOW });
        expect(d.review).toBe(false);
        expect(d.reason).toBe("too_short");
    });

    it("counts only real characters toward the minimum", () => {
        // Whitespace padding must not buy a review.
        const d = shouldReviewOnSave({ text: "  " + " ".repeat(500) + "  ", now: NOW });
        expect(d.review).toBe(false);
        expect(d.reason).toBe("too_short");
    });

    it("refuses a second save inside the cooldown, however much changed", () => {
        // The expensive case: rapid saves on a paragraph being heavily rewritten.
        const d = shouldReviewOnSave({
            text: long() + "completely different tail text here",
            state: { lastReviewedText: long(), lastReviewedAt: NOW - 1_000 },
            now: NOW,
        });
        expect(d.review).toBe(false);
        expect(d.reason).toBe("cooling_down");
    });

    it("refuses once the cooldown passes if the text barely moved", () => {
        const d = shouldReviewOnSave({
            text: long() + "tweak",
            state: { lastReviewedText: long(), lastReviewedAt: NOW - REVIEW_COOLDOWN_MS - 1 },
            now: NOW,
        });
        expect(d.review).toBe(false);
        expect(d.reason).toBe("unchanged");
    });

    it("reviews once the cooldown has passed and the text really moved", () => {
        const d = shouldReviewOnSave({
            text: long() + "x".repeat(MIN_CHANGED_CHARS + 10),
            state: { lastReviewedText: long(), lastReviewedAt: NOW - REVIEW_COOLDOWN_MS - 1 },
            now: NOW,
        });
        expect(d.review).toBe(true);
        expect(d.reason).toBe("changed_enough");
    });

    it("never reviews the same text twice", () => {
        const text = long();
        const d = shouldReviewOnSave({
            text,
            state: { lastReviewedText: text, lastReviewedAt: NOW - REVIEW_COOLDOWN_MS - 1 },
            now: NOW,
        });
        expect(d.review).toBe(false);
        expect(d.reason).toBe("unchanged");
    });

    it("bounds a burst of saves to one review", () => {
        // Twenty saves a few seconds apart — the simulation's session shape.
        let state = { lastReviewedText: long(), lastReviewedAt: NOW };
        let reviews = 0;
        for (let i = 1; i <= 20; i++) {
            const text = long() + "y".repeat(i * 20);
            const d = shouldReviewOnSave({ text, state, now: NOW + i * 3_000 });
            if (d.review) {
                reviews++;
                state = { lastReviewedText: text, lastReviewedAt: NOW + i * 3_000 };
            }
        }
        // A minute of cooldown over a 60s burst admits at most one more.
        expect(reviews).toBeLessThanOrEqual(1);
    });
});

describe("changedChars", () => {
    it("is zero for identical text", () => {
        expect(changedChars("hello", "hello")).toBe(0);
    });

    it("measures an insertion by its own size, not the tail that shifted", () => {
        // The reason for trimming a shared head and tail: appending one word to
        // a long paragraph must not read as a rewrite of everything after it.
        const before = "The quick brown fox jumps over the lazy dog.";
        const after = "The quick brown lazy fox jumps over the lazy dog.";
        expect(changedChars(before, after)).toBeLessThan(10);
    });

    it("measures a full rewrite as large", () => {
        expect(changedChars("a".repeat(200), "b".repeat(200))).toBe(200);
    });

    it("handles growth from empty", () => {
        expect(changedChars("", "new paragraph")).toBe(13);
    });
});

describe("lensesForArchetype", () => {
    it("reads a contract for legal risk, not for pacing", () => {
        const lenses = lensesForArchetype("saas_msa");
        expect(lenses).toContain("legal");
        expect(lenses).not.toContain("pacing");
    });

    it("reads a novel for pacing, not for legal risk", () => {
        const lenses = lensesForArchetype("heros_journey");
        expect(lenses).toContain("pacing");
        expect(lenses).not.toContain("legal");
    });

    it("falls back to something sensible for freeform", () => {
        expect(lensesForArchetype("freeform").length).toBeGreaterThan(0);
    });
});

describe("buildAmbientPrompt", () => {
    it("asks for every active lens in one call", () => {
        // One call covering N lenses, not N calls. runCriticEvaluation loops
        // per lens, which is right for an audit the author asked for and would
        // multiply this budget on every save.
        const p = buildAmbientPrompt("body", "Liability", ["legal", "fact_check"]);
        expect(p).toContain("legal, fact_check");
    });

    it("tells the model that silence is allowed", () => {
        // Without this a critic invents problems to fill the list, and the
        // author learns to ignore the gutter.
        const p = buildAmbientPrompt("body", "Liability", ["legal"]);
        expect(p).toMatch(/silence is a valid answer/i);
    });
});

describe("parseAmbientFindings", () => {
    const text = "The vendor accepts unlimited liability for all losses arising.";
    const lenses = ["legal", "fact_check"] as const;

    const reply = (findings: unknown) => JSON.stringify(findings);

    it("parses a well-formed finding and anchors it to the text", () => {
        const out = parseAmbientFindings(
            reply([{ lens: "legal", severity: "critical_conflict", title: "Uncapped", detail: "No ceiling.", excerpt: "unlimited liability" }]),
            text,
            [...lenses],
        );

        expect(out).toHaveLength(1);
        expect(out[0].severity).toBe("critical_conflict");
        // The gutter marker depends on the offsets locating the phrase.
        expect(text.slice(out[0].start, out[0].end)).toBe("unlimited liability");
    });

    it("gives no anchor rather than a wrong one when the model misquotes", () => {
        const out = parseAmbientFindings(
            reply([{ lens: "legal", severity: "warning", title: "T", detail: "D", excerpt: "text that is not present" }]),
            text,
            [...lenses],
        );

        expect(out[0].start).toBe(0);
        expect(out[0].excerpt).toBe("");
    });

    it("survives prose instead of JSON", () => {
        expect(parseAmbientFindings("I think this looks fine, actually.", text, [...lenses])).toEqual([]);
    });

    it("survives a truncated array", () => {
        expect(parseAmbientFindings('[{"lens":"legal","title":"T"', text, [...lenses])).toEqual([]);
    });

    it("survives an empty or missing reply", () => {
        expect(parseAmbientFindings(null, text, [...lenses])).toEqual([]);
        expect(parseAmbientFindings("", text, [...lenses])).toEqual([]);
        expect(parseAmbientFindings("[]", text, [...lenses])).toEqual([]);
    });

    it("drops a finding with no title or detail", () => {
        const out = parseAmbientFindings(
            reply([{ lens: "legal", title: "Only a title" }, { lens: "legal", detail: "Only a detail" }]),
            text,
            [...lenses],
        );
        expect(out).toEqual([]);
    });

    it("coerces a lens the model invented back to an active one", () => {
        const out = parseAmbientFindings(
            reply([{ lens: "astrology", severity: "warning", title: "T", detail: "D" }]),
            text,
            [...lenses],
        );
        expect(lenses).toContain(out[0].lensType as any);
    });

    it("coerces an unknown severity to a suggestion", () => {
        const out = parseAmbientFindings(
            reply([{ lens: "legal", severity: "catastrophic", title: "T", detail: "D" }]),
            text,
            [...lenses],
        );
        expect(out[0].severity).toBe("suggestion");
    });

    it("caps a model that ignores the limit", () => {
        const many = Array.from({ length: 12 }, (_, i) => ({
            lens: "legal", severity: "info", title: `T${i}`, detail: "D",
        }));
        expect(parseAmbientFindings(reply(many), text, [...lenses])).toHaveLength(3);
    });

    it("carries a replacement through, which is what separates Tier 2 from Tier 1", () => {
        const out = parseAmbientFindings(
            reply([{ lens: "legal", severity: "warning", title: "T", detail: "D", excerpt: "unlimited liability", replacement: "liability capped at fees paid" }]),
            text,
            [...lenses],
        );
        expect((out[0] as any).replacement).toBe("liability capped at fees paid");
    });
});
