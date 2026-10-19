/**
 * The progress footer's numbers.
 *
 * Two failures, pulling in opposite directions.
 *
 * The footer was computed once when the payload was built and never again, so
 * an author filled three stations and watched it sit at the page-load figures
 * until publishing forced a reload. That one is fixed by this function being
 * pure and cheap enough to re-derive on every render.
 *
 * And a station counted as complete at 100 characters of content, while new
 * stations are seeded with framework scaffolding as their content — 18 of the
 * 21 scaffolding strings are longer than that. So a document reported most of
 * its stations Done before a word was written. That one is fixed here, and is
 * what most of these tests are about.
 */

import { describe, expect, it } from "vitest";
import {
    computeTelemetry,
    isStationDrafted,
    stationScore,
    DEFAULT_TARGET_WORD_COUNT,
} from "@shared/scribe-telemetry.js";

/** The shortest real scaffolding string in the frameworks table is 84 chars. */
const SCAFFOLDING =
    "Start with the business outcome this engagement achieves, then provide context on why this work is being undertaken now.";

const node = (over: Partial<Parameters<typeof stationScore>[0]> = {}) =>
    ({
        stationKey: "overview",
        title: "Overview",
        content: "",
        wordCount: 0,
        status: "draft",
        targetPercentage: 0.1,
        ...over,
    }) as any;

describe("whether a station has been drafted", () => {
    it("does not count one that only holds its seeded scaffolding", () => {
        // The defect: createOrGetDocument inserts scaffolding as content with
        // wordCount 0, and the old predicate asked whether content was longer
        // than 100 characters. This string is 120.
        expect(SCAFFOLDING.length).toBeGreaterThan(100);
        expect(isStationDrafted(node({ content: SCAFFOLDING, wordCount: 0 }))).toBe(false);
    });

    it("counts one the author has written in", () => {
        expect(isStationDrafted(node({ content: "Real prose.", wordCount: 2 }))).toBe(true);
    });

    it("does not count an empty station", () => {
        expect(isStationDrafted(node())).toBe(false);
    });

    it("counts an approved station even with nothing in it", () => {
        // Approval is an explicit human act; it outranks any heuristic.
        expect(isStationDrafted(node({ status: "approved", wordCount: 0 }))).toBe(true);
    });

    it("tolerates a missing word count", () => {
        // The column is non-null in the schema. The guard is there because
        // rows reaching this code have not always matched their declared types.
        expect(isStationDrafted({ status: "draft", wordCount: null as any })).toBe(false);
        expect(isStationDrafted({ status: "draft", wordCount: undefined as any })).toBe(false);
    });
});

describe("a station's fullness score", () => {
    // 10% of 5000 = a 500-word allocation.
    const target = 5000;

    it("scores an empty station at zero, not at a healthy-looking floor", () => {
        // It used to score a flat 20 and render green, so an untouched document
        // looked like a finished one.
        expect(stationScore(node(), target)).toBe(0);
    });

    it("rises with the draft", () => {
        const quarter = stationScore(node({ wordCount: 125 }), target);
        const half = stationScore(node({ wordCount: 250 }), target);

        expect(quarter).toBeGreaterThan(0);
        expect(half).toBeGreaterThan(quarter);
    });

    it("reaches its allocation without tipping into the red band", () => {
        // A station written to length is finished, not a problem.
        expect(stationScore(node({ wordCount: 500 }), target)).toBeLessThanOrEqual(70);
    });

    it("flags a station well past its allocation", () => {
        expect(stationScore(node({ wordCount: 900 }), target)).toBeGreaterThan(70);
    });

    it("flags a continuity conflict however full the station is", () => {
        // As an addend this was dilutable: half-drafted landed exactly on the
        // amber/red boundary, and empty came out amber.
        for (const wordCount of [0, 250, 500]) {
            expect(stationScore(node({ status: "continuity_conflict", wordCount }), target)).toBeGreaterThan(70);
        }
    });

    it("never exceeds the top of the scale", () => {
        const worst = stationScore(node({ status: "continuity_conflict", wordCount: 99999 }), target);
        expect(worst).toBeLessThanOrEqual(100);
    });

    it("survives a station with no allocation of its own", () => {
        // targetPercentage is nullable and becomes a divisor.
        expect(Number.isFinite(stationScore(node({ targetPercentage: null, wordCount: 100 }), target))).toBe(true);
        expect(Number.isFinite(stationScore(node({ targetPercentage: 0, wordCount: 100 }), target))).toBe(true);
    });
});

describe("the footer as a whole", () => {
    it("reports a freshly seeded document as untouched", () => {
        // Every station holds scaffolding; none holds writing.
        const seeded = [
            node({ stationKey: "a", content: SCAFFOLDING }),
            node({ stationKey: "b", content: SCAFFOLDING }),
            node({ stationKey: "c", content: SCAFFOLDING }),
        ];

        const t = computeTelemetry(seeded, 5000);

        expect(t.stationsComplete).toBe(0);
        expect(t.totalStations).toBe(3);
        expect(t.totalWordCount).toBe(0);
        expect(t.completionPercentage).toBe(0);
    });

    it("counts the stations the author has actually written", () => {
        const t = computeTelemetry(
            [
                node({ stationKey: "a", wordCount: 120 }),
                node({ stationKey: "b", wordCount: 90 }),
                node({ stationKey: "c", content: SCAFFOLDING, wordCount: 0 }),
            ],
            5000,
        );

        expect(t.stationsComplete).toBe(2);
        expect(t.totalWordCount).toBe(210);
    });

    it("caps completion at 100 when the draft runs past its target", () => {
        const t = computeTelemetry([node({ wordCount: 9000 })], 5000);
        expect(t.completionPercentage).toBe(100);
    });

    it("falls back to a default target rather than dividing by zero", () => {
        expect(computeTelemetry([node({ wordCount: 100 })], null).targetWordCount).toBe(DEFAULT_TARGET_WORD_COUNT);
        expect(computeTelemetry([node({ wordCount: 100 })], 0).targetWordCount).toBe(DEFAULT_TARGET_WORD_COUNT);
    });

    it("handles a document with no stations", () => {
        const t = computeTelemetry([], 5000);

        expect(t).toMatchObject({ totalWordCount: 0, stationsComplete: 0, totalStations: 0, completionPercentage: 0 });
        expect(t.ekgPoints).toEqual([]);
    });

    it("gives one waveform point per station, labelled", () => {
        const t = computeTelemetry([node({ stationKey: "a", title: "Overview" })], 5000);
        expect(t.ekgPoints).toEqual([{ stationKey: "a", score: 0, label: "Overview" }]);
    });

    it("is a pure function of the nodes, so it can be re-derived on every render", () => {
        const nodes = [node({ wordCount: 120 })];
        expect(computeTelemetry(nodes, 5000)).toEqual(computeTelemetry(nodes, 5000));
    });
});
