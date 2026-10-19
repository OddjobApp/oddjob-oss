/**
 * Turning a manuscript into a file someone can actually open.
 *
 * Export was not broken so much as absent. POST /api/scribe/export compiled the
 * manuscript and replied `{ compiled, format }`, while the client did
 * `if (data.downloadUrl)` — a key the route has never sent. So every Export
 * click, in every format, silently did nothing: no file, no error, no clue. The
 * `format` argument was accepted and ignored, so the PDF and Word buttons were
 * decorative.
 *
 * This builds the bytes. The route sends them with a Content-Disposition and the
 * browser saves a file, which is the whole of what "export" has to mean.
 */

import {
    Document,
    HeadingLevel,
    Packer,
    Paragraph,
    TextRun,
} from "docx";

export type ScribeExportFormat = "markdown" | "word" | "pdf";

export interface ScribeExportFile {
    filename: string;
    mimeType: string;
    body: Buffer;
}

/** Raised for a format the server genuinely cannot produce, so the UI can say so. */
export class UnsupportedExportFormatError extends Error {
    readonly format: string;
    constructor(format: string, reason: string) {
        super(reason);
        this.name = "UnsupportedExportFormatError";
        this.format = format;
    }
}

/** A filename that survives Windows, macOS and a Content-Disposition header. */
export function exportFilename(title: string, extension: string): string {
    const safe =
        (title ?? "")
            .replace(/[\\/:*?"<>|]/g, "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 80) || "Manuscript";
    return `${safe}.${extension}`;
}

/**
 * Markdown headings and emphasis, rendered as Word paragraphs.
 *
 * Deliberately small. A full markdown-to-OOXML translation is a project; what a
 * manuscript actually contains is headings, paragraphs, bullets and bold/italic
 * runs, and handling those four well beats handling twenty badly. Anything not
 * recognised is written as plain text rather than dropped, so no content is lost
 * on the way out — which is the property that matters for an export.
 */
export function markdownToDocxParagraphs(markdown: string): Paragraph[] {
    const lines = (markdown ?? "").replace(/\r\n/g, "\n").split("\n");
    const paragraphs: Paragraph[] = [];

    for (const raw of lines) {
        const line = raw.trimEnd();

        if (!line.trim()) {
            paragraphs.push(new Paragraph({ children: [] }));
            continue;
        }

        const heading = line.match(/^(#{1,6})\s+(.*)$/);
        if (heading) {
            const level = heading[1].length;
            paragraphs.push(
                new Paragraph({
                    heading:
                        level === 1
                            ? HeadingLevel.HEADING_1
                            : level === 2
                              ? HeadingLevel.HEADING_2
                              : level === 3
                                ? HeadingLevel.HEADING_3
                                : HeadingLevel.HEADING_4,
                    children: inlineRuns(heading[2]),
                }),
            );
            continue;
        }

        const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
        if (bullet) {
            paragraphs.push(new Paragraph({ bullet: { level: 0 }, children: inlineRuns(bullet[1]) }));
            continue;
        }

        const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
        if (numbered) {
            paragraphs.push(new Paragraph({ bullet: { level: 0 }, children: inlineRuns(numbered[1]) }));
            continue;
        }

        if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
            paragraphs.push(new Paragraph({ thematicBreak: true, children: [] }));
            continue;
        }

        paragraphs.push(new Paragraph({ children: inlineRuns(line) }));
    }

    return paragraphs;
}

/** **bold**, *italic* and `code` within one line. */
function inlineRuns(text: string): TextRun[] {
    const runs: TextRun[] = [];
    // One pass over the three markers, so nesting resolves left to right rather
    // than needing a parser.
    const pattern = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|`[^`]+`)/g;
    let last = 0;
    for (const match of text.matchAll(pattern)) {
        const index = match.index ?? 0;
        if (index > last) runs.push(new TextRun(text.slice(last, index)));

        const token = match[0];
        if (token.startsWith("**") || token.startsWith("__")) {
            runs.push(new TextRun({ text: token.slice(2, -2), bold: true }));
        } else if (token.startsWith("`")) {
            runs.push(new TextRun({ text: token.slice(1, -1), font: "Consolas" }));
        } else {
            runs.push(new TextRun({ text: token.slice(1, -1), italics: true }));
        }
        last = index + token.length;
    }
    if (last < text.length) runs.push(new TextRun(text.slice(last)));
    return runs.length > 0 ? runs : [new TextRun("")];
}

/** Build the file for one compiled manuscript. */
export async function buildExportFile(
    compiled: { title: string; content: string },
    format: ScribeExportFormat,
): Promise<ScribeExportFile> {
    if (format === "markdown") {
        return {
            filename: exportFilename(compiled.title, "md"),
            mimeType: "text/markdown; charset=utf-8",
            body: Buffer.from(compiled.content, "utf-8"),
        };
    }

    if (format === "word") {
        const doc = new Document({
            sections: [{ children: markdownToDocxParagraphs(compiled.content) }],
        });
        return {
            filename: exportFilename(compiled.title, "docx"),
            mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            body: await Packer.toBuffer(doc),
        };
    }

    // Honest refusal rather than another silent no-op. Rendering PDF needs a
    // layout engine — Puppeteer is present but launching Chromium per export is
    // a different decision, with its own failure modes, than formatting bytes.
    throw new UnsupportedExportFormatError(
        format,
        "PDF export is not available yet. Export as Word or Markdown, both of which print to PDF.",
    );
}
