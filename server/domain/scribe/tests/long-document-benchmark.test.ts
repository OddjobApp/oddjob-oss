// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import AdmZip from "adm-zip";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const mocks = vi.hoisted(() => ({ generateText: vi.fn(), select: vi.fn() }));
vi.mock("@domain/ai/index.js", () => ({ systemAiService: { generateText: mocks.generateText } }));
vi.mock("@server/database_service.js", () => ({ db: { select: mocks.select } }));

import { buildExportFile } from "../core/scribe-export.service.js";
import { continuityEngine } from "../core/continuity-engine.service.js";

// Real export and continuity code; no model calls or database writes.
// Emit evidence only when explicitly requested, keeping normal CI read-only.
const outputDir = process.env.SCRIBE_BENCHMARK_OUTPUT
    ? resolve(process.env.SCRIBE_BENCHMARK_OUTPUT) : null;
function evidence(name: string, value: string | Buffer) {
    if (!outputDir) return;
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(resolve(outputDir, name), value);
}

function manuscript(words: number, count: number) {
    const sections = Array.from({ length: count }, (_, index) => {
        const beginning = `## Section ${index + 1}\n\nSTARTSECTION${index + 1}\n\n`;
        const ending = `\n\nENDSECTION${index + 1}`;
        const allocation = Math.floor(words / count) + (index < words % count ? 1 : 0);
        const reserved = `${beginning} ${ending}`.trim().split(/\s+/).length;
        const vocabulary = "Shelfie records purchase dates separately from printed use-by dates and preserves user choices".split(" ");
        const body = Array.from({ length: allocation - reserved }, (_, n) => vocabulary[n % vocabulary.length]).join(" ");
        return beginning + body + ending;
    });
    return sections.join("\n\n");
}

describe("long-document export benchmark", () => {
    for (const [words, sections] of [[5000, 10], [20000, 30], [50000, 60]]) {
        it(`preserves ${words} words and all ${sections} section boundaries in Markdown and DOCX`, async () => {
            const content = manuscript(words, sections);
            expect(content.trim().split(/\s+/)).toHaveLength(words);
            const compiled = { title: `Shelfie benchmark ${words}`, content };
            const started = performance.now();
            const markdown = await buildExportFile(compiled, "markdown");
            const word = await buildExportFile(compiled, "word");
            expect(markdown.body.toString("utf8")).toBe(content);
            const xml = new AdmZip(word.body).readAsText("word/document.xml");
            const textRuns = [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((m) => m[1]);
            // Compare actual OOXML text with each source paragraph, not a ZIP signature.
            expect(textRuns).toEqual(content.split("\n").filter((line) => line.trim()).map((line) => line.replace(/^## /, "")));
            for (let section = 1; section <= sections; section++) {
                expect(xml.split(`STARTSECTION${section}<`).length - 1).toBe(1);
                expect(xml.split(`ENDSECTION${section}<`).length - 1).toBe(1);
            }
            evidence(`${words}.md`, markdown.body);
            evidence(`${words}.docx`, word.body);
            evidence(`${words}-metrics.json`, JSON.stringify({ words, sections, milliseconds: performance.now() - started, docxBytes: word.body.length, textRoundTrip: true }, null, 2));
        });
    }

    it("records semantic export support separately from text preservation", async () => {
        const content = "# Evidence\n\n| Requirement | Status |\n|---|---|\n| DATE-01 | Accepted |\n\n[Source](https://example.invalid/source)\n\n1. Capture\n2. Review";
        const word = await buildExportFile({ title: "Rich structure probe", content }, "word");
        const xml = new AdmZip(word.body).readAsText("word/document.xml");
        expect(xml).toContain("DATE-01");
        const support = { nativeTable: xml.includes("<w:tbl>"), nativeHyperlink: xml.includes("<w:hyperlink"), sourceTextPreserved: xml.includes("https://example.invalid/source") };
        evidence("rich-structure.json", JSON.stringify(support, null, 2));
        evidence("rich-structure.docx", word.body);
    });
});

describe("continuity input and failure probes", () => {
    function downstream(content: string) {
        const node = { id: 2, documentId: 1, branchId: 1, stationKey: "later", title: "Later", sortOrder: 2, status: "draft", content };
        mocks.select.mockReset();
        mocks.select.mockReturnValueOnce({ from: () => ({ where: () => ({ orderBy: async () => [node] }) }) });
        mocks.select.mockReturnValueOnce({ from: () => ({ where: async () => [] }) });
        mocks.generateText.mockReset();
    }

    it("measures whether late-section facts reach the continuity reviewer", async () => {
        const padding = "Background context remains unchanged. ".repeat(80);
        downstream(padding + " Purchase date and use-by date are interchangeable.");
        mocks.generateText.mockResolvedValue("[]");
        await continuityEngine.analyzeDownstreamContinuity(1, 1, 1, padding + " Purchase date must never substitute for use-by date.", "scope");
        const prompt = String(mocks.generateText.mock.calls[0][0]);
        const coverage = { sourceTailIncluded: prompt.includes("must never substitute"), downstreamTailIncluded: prompt.includes("are interchangeable"), modelCalls: mocks.generateText.mock.calls.length };
        evidence("continuity-input-coverage.json", JSON.stringify(coverage, null, 2));
        expect(mocks.generateText).toHaveBeenCalledOnce();
        // This is a measured coverage probe, not an assertion of expert accuracy.
    });

    it("records the caller-visible outcome when the model is unavailable", async () => {
        downstream("Purchase date and use-by date are interchangeable in every workflow.");
        mocks.generateText.mockRejectedValue(new Error("Injected benchmark provider outage"));
        const result = await continuityEngine.analyzeDownstreamContinuity(1, 1, 1, "Purchase date must never substitute for use-by date.", "scope");
        evidence("continuity-provider-outage.json", JSON.stringify(result, null, 2));
        expect(mocks.generateText).toHaveBeenCalledOnce();
    });
});
