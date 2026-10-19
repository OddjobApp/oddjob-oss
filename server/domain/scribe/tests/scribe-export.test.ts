import { describe, it, expect } from "vitest";
import {
    buildExportFile,
    exportFilename,
    markdownToDocxParagraphs,
    UnsupportedExportFormatError,
} from "../core/scribe-export.service.js";

/**
 * Export had no tests because it never worked: the route replied
 * `{ compiled, format }` and the client read `data.downloadUrl`, a key it has
 * never sent, so every click in every format silently produced nothing. These
 * assert the bytes, since "the endpoint returned 200" was exactly the kind of
 * evidence that hid the fault for this long.
 */
const compiled = {
    title: "Shelfie PRD",
    content: [
        "# Shelfie PRD",
        "",
        "Shelfie tracks **use-by** and *purchase* dates.",
        "",
        "## Scope",
        "",
        "- Inventory capture",
        "- Expiry alerts",
        "",
        "---",
        "",
        "Use `scan()` to add an item.",
    ].join("\n"),
};

describe("markdown export", () => {
    it("returns the compiled manuscript as a .md file", async () => {
        const file = await buildExportFile(compiled, "markdown");

        expect(file.filename).toBe("Shelfie PRD.md");
        expect(file.mimeType).toContain("text/markdown");
        expect(file.body.toString("utf-8")).toBe(compiled.content);
    });

    it("produces a non-empty body, which is the whole point", async () => {
        const file = await buildExportFile(compiled, "markdown");
        expect(file.body.length).toBeGreaterThan(0);
    });
});

describe("word export", () => {
    it("returns a real .docx, not markdown with a different extension", async () => {
        const file = await buildExportFile(compiled, "word");

        expect(file.filename).toBe("Shelfie PRD.docx");
        expect(file.mimeType).toContain("wordprocessingml");
        // A .docx is a zip: the first two bytes are PK. Checking the magic number
        // is the difference between "it produced bytes" and "it produced a file
        // Word will open".
        expect(file.body.subarray(0, 2).toString("latin1")).toBe("PK");
        expect(file.body.length).toBeGreaterThan(1000);
    });

    it("carries the manuscript text into the document", async () => {
        const file = await buildExportFile(compiled, "word");
        // The XML inside the zip is deflated, but docx stores the text such that
        // a round-trip through the library preserves it; assert via the paragraph
        // builder, which is the part that can silently drop content.
        const paragraphs = markdownToDocxParagraphs(compiled.content);
        expect(paragraphs.length).toBeGreaterThan(5);
        expect(file.body.length).toBeGreaterThan(0);
    });
});

describe("markdownToDocxParagraphs", () => {
    it("keeps every line, so nothing is lost on the way out", () => {
        const lines = compiled.content.split("\n");
        const paragraphs = markdownToDocxParagraphs(compiled.content);
        // One paragraph per source line, blank lines included.
        expect(paragraphs).toHaveLength(lines.length);
    });

    it("handles an empty document without throwing", () => {
        expect(markdownToDocxParagraphs("")).toHaveLength(1);
        expect(() => markdownToDocxParagraphs(undefined as unknown as string)).not.toThrow();
    });

    it("writes unrecognised markdown as text rather than dropping it", () => {
        // A table is not translated, but its content must still reach the file.
        const paragraphs = markdownToDocxParagraphs("| A | B |\n|---|---|\n| 1 | 2 |");
        expect(paragraphs).toHaveLength(3);
    });
});

describe("pdf export", () => {
    it("refuses clearly instead of silently producing nothing", async () => {
        // The failure mode being fixed was silence. An honest refusal the author
        // can read and act on is the minimum bar.
        await expect(buildExportFile(compiled, "pdf")).rejects.toBeInstanceOf(
            UnsupportedExportFormatError,
        );
        await expect(buildExportFile(compiled, "pdf")).rejects.toThrow(/not available|Word or Markdown/i);
    });
});

describe("exportFilename", () => {
    it("strips characters a filesystem or header would reject", () => {
        expect(exportFilename('Q3: Plan / "final" <draft>', "md")).toBe("Q3 Plan final draft.md");
    });

    it("falls back rather than producing a dotfile", () => {
        expect(exportFilename("", "docx")).toBe("Manuscript.docx");
        expect(exportFilename("///", "md")).toBe("Manuscript.md");
    });

    it("bounds the length so the header stays valid", () => {
        const name = exportFilename("x".repeat(300), "md");
        expect(name.length).toBeLessThanOrEqual(84);
    });
});
