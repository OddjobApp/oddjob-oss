/**
 * Figures, and a document contradicting itself.
 *
 * The failure this catches is a fee that is £2.4M in the recital and £2.1M in
 * the schedule — both correct in isolation, which is why nobody notices.
 *
 * The precision risk is the mirror of it: prose is full of numbers that have
 * nothing to do with each other, and a rule that pairs them up would be
 * unusable. So the silence cases come first, and the false-positive count is
 * asserted rather than implied.
 */

import { describe, expect, it } from "vitest";
import { parseFigures, findFigureConflicts } from "../core/figures.service.js";

const values = (t: string) => parseFigures(t).map((f) => f.value);

describe("parsing a figure as written", () => {
    it("reads a plain number", () => {
        expect(values("The term is 24 months.")).toEqual([24]);
    });

    it("reads thousands separators", () => {
        expect(values("A fee of 2,400,000 applies.")).toEqual([2400000]);
    });

    it("reads magnitude suffixes", () => {
        expect(values("£2.4M")).toEqual([2400000]);
        expect(values("$750K")).toEqual([750000]);
        expect(values("€1.2bn")).toEqual([1200000000]);
    });

    it("normalises the same amount written two ways", () => {
        // The whole reason for normalising rather than comparing strings.
        expect(parseFigures("£2.4M")[0].value).toBe(parseFigures("£2,400,000")[0].value);
    });

    it("captures the currency, so unlike things are not compared", () => {
        expect(parseFigures("£2.4M")[0].unit).toBe("£");
        expect(parseFigures("$2.4M")[0].unit).toBe("$");
        expect(parseFigures("30%")[0].unit).toBe("%");
        expect(parseFigures("24 months")[0].unit).toBeNull();
    });

    it("does not read a suffix that is the start of a word", () => {
        // "5 members" is five, not five milli-anything.
        expect(values("The board has 5 members.")).toEqual([5]);
        expect(values("Within 3 business days.")).toEqual([3]);
    });

    it("finds every figure in a sentence", () => {
        expect(values("Fees of £2.4M over 24 months at 30%.")).toEqual([2400000, 24, 30]);
    });

    it("returns nothing for prose with no figures", () => {
        expect(parseFigures("The parties shall act in good faith.")).toEqual([]);
        expect(parseFigures("")).toEqual([]);
    });
});

describe("precision — prose that must raise nothing", () => {
    const CLEAN = [
        ["unrelated numbers", "The board has 5 members and meets 4 times a year."],
        ["a figure stated once", "The Annual Fee is £2.4M for the initial term."],
        ["the same figure restated identically", "The Annual Fee is £2.4M. The Annual Fee is £2.4M."],
        ["the same amount written another way", "The Annual Fee is £2.4M. The Annual Fee is £2,400,000."],
        ["different labels with different figures", "The Annual Fee is £2.4M. The Setup Charge is £150,000."],
        ["different kinds of figure under one label", "The Annual Fee is £2.4M. The Annual Fee is 30% of revenue."],
        ["numbers with no defined-term label", "It costs 2400000 and then 2100000 later."],
        ["ordinary narrative", "She waited 20 minutes, then another 40 minutes."],
    ] as const;

    it.each(CLEAN)("stays silent on %s", (_n, text) => {
        expect(findFigureConflicts(text)).toEqual([]);
    });

    it("measures a false-positive rate of zero across the clean corpus", () => {
        const total = CLEAN.reduce((n, [, text]) => n + findFigureConflicts(text).length, 0);
        expect(total).toBe(0);
    });
});

describe("recall — a document contradicting itself", () => {
    it("catches a fee stated two ways", () => {
        const text = "The Annual Fee is £2.4M for the term. Later: the Annual Fee is £2.1M.";
        const [conflict] = findFigureConflicts(text);

        expect(conflict).toBeDefined();
        expect(conflict.first.value).toBe(2400000);
        expect(conflict.second.value).toBe(2100000);
    });

    it("names the label so the author knows which figure to check", () => {
        const text = "The Annual Fee is £2.4M. The Annual Fee is £2.1M.";
        expect(findFigureConflicts(text)[0].label).toBe("Annual Fee");
    });

    it("anchors both figures in the text", () => {
        const text = "The Annual Fee is £2.4M. The Annual Fee is £2.1M.";
        const [c] = findFigureConflicts(text);

        expect(text.slice(c.first.start, c.first.end).trim()).toBe(c.first.raw);
        expect(text.slice(c.second.start, c.second.end).trim()).toBe(c.second.raw);
    });

    it("catches a term length stated two ways", () => {
        const text = "The Initial Term is 24 months. The Initial Term is 36 months.";
        expect(findFigureConflicts(text)).toHaveLength(1);
    });

    it("reports one conflict per label, not one per restatement", () => {
        // An author fixes the discrepancy once.
        const text = "The Annual Fee is £2.4M. The Annual Fee is £2.1M. The Annual Fee is £2.9M.";
        expect(findFigureConflicts(text)).toHaveLength(1);
    });

    it("matches a label case-insensitively", () => {
        const text = "The Annual Fee is £2.4M. the Annual Fee is £2.1M.";
        expect(findFigureConflicts(text)).toHaveLength(1);
    });

    it("keeps two different labels separate", () => {
        const text =
            "The Annual Fee is £2.4M. The Annual Fee is £2.1M. The Setup Charge is £100,000. The Setup Charge is £120,000.";
        expect(findFigureConflicts(text)).toHaveLength(2);
    });
});
