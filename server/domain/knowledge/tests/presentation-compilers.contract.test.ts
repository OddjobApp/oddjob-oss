/**
 * Characterization tests for the three presentation compilers.
 *
 * compileToWebDeck / compileASTToDocx / compileASTToPptx are ~750, ~740 and ~520
 * lines each, and each switches over the same nine block types. These tests drive
 * an AST containing EVERY block type through all three, so the per-block-type
 * rendering can be extracted into named methods without silently dropping a case.
 *
 * They assert on content that must survive compilation rather than on exact
 * markup, so they constrain behaviour without freezing formatting.
 */

import { describe, it, expect } from "vitest";
import {
    DocumentBlockASTSchema,
    PREBUILT_PRESENTATION_THEMES,
    type DocumentBlockAST,
} from "@shared/schema/document-block.schema.js";
import { presentationAssemblyService } from "../core/presentation-assembly.service.js";

/** Marker strings, one per block type, that must appear in rendered web output. */
const MARKERS = {
    hero: "HeroHeadlineMarker",
    slide: "SlideHeadlineMarker",
    magazine: "MagazineHeadlineMarker",
    feature: "FeatureGridTitleMarker",
    stat: "StatCalloutTitleMarker",
    comparison: "ComparisonFeatureMarker",
    timeline: "TimelineEventMarker",
    chart: "ChartLabelMarker",
    diagram: "DiagramCaptionMarker",
};

function fullAst(): DocumentBlockAST {
    return DocumentBlockASTSchema.parse({
        id: "ast-contract",
        title: "Compiler Contract Deck",
        subtitle: "Every block type, once",
        formatCategory: "presentation_deck",
        designSystem: PREBUILT_PRESENTATION_THEMES[Object.keys(PREBUILT_PRESENTATION_THEMES)[0]],
        metadata: {},
        blocks: [
            { id: "b1", type: "hero_header", headline: MARKERS.hero, subheadline: "sub", layout: "split_left" },
            {
                id: "b2", type: "slide_frame", slideNumber: 1, headline: MARKERS.slide,
                bodyMarkdown: "body copy", bulletPoints: ["alpha", "beta"], layout: "three_cards",
            },
            {
                id: "b3", type: "magazine_ad", headline: MARKERS.magazine, bodyText: "body",
                quote: "a quote", author: "An Author", layout: "editorial_asymmetric",
            },
            {
                id: "b4", type: "feature_grid", title: MARKERS.feature, columns: 2,
                cards: [
                    { title: "Card One", description: "desc one" },
                    { title: "Card Two", description: "desc two" },
                ],
            },
            {
                id: "b5", type: "stat_callout", title: MARKERS.stat,
                stats: [{ value: "99.9%", label: "Uptime", delta: "+2%", isPositive: true }],
            },
            {
                id: "b6", type: "comparison_matrix", competitorName: "Them", ourName: "Us",
                rows: [{ feature: MARKERS.comparison, competitorValue: "no", ourValue: "yes", isOurAdvantage: true }],
            },
            {
                id: "b7", type: "timeline",
                events: [{ dateOrPhase: "Q1", title: MARKERS.timeline, description: "d", status: "active" }],
            },
            {
                id: "b8", type: "chart", chartType: "bar", labels: [MARKERS.chart],
                datasets: [{ label: "Series", data: [1, 2, 3] }],
            },
            {
                id: "b9", type: "diagram", diagramType: "mermaid",
                code: "graph TD; A-->B;", caption: MARKERS.diagram,
            },
        ],
    });
}

describe("presentation compilers — block coverage contract", () => {
    it("builds an AST containing every declared block type", () => {
        const ast = fullAst();
        const types = new Set(ast.blocks.map(b => b.type));
        expect(types).toEqual(new Set([
            "hero_header", "slide_frame", "magazine_ad", "feature_grid",
            "stat_callout", "comparison_matrix", "timeline", "chart", "diagram",
        ]));
    });

    describe("compileToWebDeck", () => {
        const html = () => presentationAssemblyService.compileToWebDeck(fullAst());

        it("returns a non-trivial HTML document", () => {
            const out = html();
            expect(typeof out).toBe("string");
            expect(out.length).toBeGreaterThan(500);
            expect(out).toMatch(/<html|<section|<div/i);
        });

        it.each(Object.entries(MARKERS))("renders the %s block's content", (_name, marker) => {
            expect(html()).toContain(marker);
        });

        it("carries the deck title through", () => {
            expect(html()).toContain("Compiler Contract Deck");
        });

        it("renders each block type without leaving an unhandled placeholder", () => {
            expect(html()).not.toMatch(/undefined|\[object Object\]/);
        });
    });

    describe("compileASTToDocx", () => {
        it("produces a non-empty buffer for an AST with every block type", async () => {
            const buf = await presentationAssemblyService.compileASTToDocx(fullAst());
            expect(Buffer.isBuffer(buf)).toBe(true);
            expect(buf.length).toBeGreaterThan(0);
        });
    });

    describe("compileASTToPptx", () => {
        it("produces a non-empty buffer for an AST with every block type", async () => {
            const buf = await presentationAssemblyService.compileASTToPptx(fullAst());
            expect(Buffer.isBuffer(buf)).toBe(true);
            expect(buf.length).toBeGreaterThan(0);
        });
    });
});
