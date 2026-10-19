import { describe, it, expect } from "vitest";
import { splitMarkdownIntoStations, detectSplitLevel, stationKeyFromTitle } from "./scribe-outline";

describe("detectSplitLevel", () => {
    it("splits on H2 when the page has one H1 title over many H2 sections", () => {
        // The common Confluence shape. Splitting on H1 would yield one station
        // containing the entire page, which is the failure worth preventing.
        const md = "# Shelfie Requirements\n\n## Scope\n\ntext\n\n## Data Model\n\ntext\n";
        expect(detectSplitLevel(md)).toBe(2);
    });

    it("splits on H1 when the page uses several H1s", () => {
        expect(detectSplitLevel("# One\n\na\n\n# Two\n\nb\n")).toBe(1);
    });

    it("reports no heading level for prose", () => {
        expect(detectSplitLevel("just a paragraph")).toBe(0);
    });
});

describe("splitMarkdownIntoStations", () => {
    it("turns each section into a station, in order", () => {
        const md = [
            "# Shelfie Requirements",
            "",
            "Shelfie tracks refrigerator inventory.",
            "",
            "## Scope",
            "",
            "Use-by and purchase dates.",
            "",
            "## Data Model",
            "",
            "Two date types per item.",
            "",
        ].join("\n");

        const stations = splitMarkdownIntoStations(md);

        expect(stations.map((s) => s.title)).toEqual([
            "Shelfie Requirements",
            "Scope",
            "Data Model",
        ]);
        expect(stations.map((s) => s.sortOrder)).toEqual([1, 2, 3]);
        expect(stations[1].content).toBe("Use-by and purchase dates.");
        expect(stations[2].content).toBe("Two date types per item.");
    });

    it("keeps the text above the first section instead of dropping it", () => {
        // On a Confluence page this is the summary, and its loss would be the
        // first thing the author noticed.
        const stations = splitMarkdownIntoStations(
            "# Title\n\nOpening summary.\n\n## First\n\nbody\n",
        );
        expect(stations[0].title).toBe("Title");
        expect(stations[0].content).toBe("Opening summary.");
    });

    it("gives a heading-free document a single station rather than none", () => {
        const stations = splitMarkdownIntoStations("Some prose with no headings at all.");
        expect(stations).toHaveLength(1);
        expect(stations[0].content).toBe("Some prose with no headings at all.");
        expect(stations[0].title).toBe("Overview");
    });

    it("uses the supplied fallback title for an unstructured import", () => {
        const stations = splitMarkdownIntoStations("prose", { fallbackTitle: "Imported Page" });
        expect(stations[0].title).toBe("Imported Page");
        expect(stations[0].stationKey).toBe("imported_page");
    });

    it("returns nothing for empty input", () => {
        expect(splitMarkdownIntoStations("")).toEqual([]);
        expect(splitMarkdownIntoStations("   \n  ")).toEqual([]);
    });

    it("keeps deeper headings inside their section rather than splitting on them", () => {
        const stations = splitMarkdownIntoStations(
            "## A\n\n### A.1\n\ndetail\n\n## B\n\nbody\n",
        );
        expect(stations).toHaveLength(2);
        expect(stations[0].content).toContain("### A.1");
        expect(stations[0].content).toContain("detail");
    });

    it("disambiguates two sections that slug to the same key", () => {
        const stations = splitMarkdownIntoStations("## Scope\n\na\n\n## Scope\n\nb\n");
        const keys = stations.map((s) => s.stationKey);
        expect(new Set(keys).size).toBe(keys.length);
    });

    it("normalises CRLF so a Windows-authored page splits the same way", () => {
        const stations = splitMarkdownIntoStations("## A\r\n\r\nbody\r\n\r\n## B\r\n\r\nmore\r\n");
        expect(stations.map((s) => s.title)).toEqual(["A", "B"]);
        expect(stations[0].content).toBe("body");
    });
});

describe("stationKeyFromTitle", () => {
    it("slugs a title, dropping any leading numbering", () => {
        expect(stationKeyFromTitle("1. Scope & Objectives", 1)).toBe("scope_objectives");
    });

    it("falls back to a positional key when nothing survives slugging", () => {
        expect(stationKeyFromTitle("—", 3)).toBe("section_3");
    });
});
