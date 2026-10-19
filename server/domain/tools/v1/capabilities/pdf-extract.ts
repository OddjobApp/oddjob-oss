import { z } from "zod";
import type { ToolDefinition } from "./types.js";

export const PDF_EXTRACT_TOOLS: Record<string, ToolDefinition> = {
    pdf_extract_text: {
        name: "pdf_extract_text",

        idempotency: "read-safe",
        label: "Extract PDF Text",
        group: "Document Processing",
        description: "Extract plain text content from a PDF file stored in the file system or accessible via URL.",
        parameters: z.object({
            source: z.string().describe("File path (e.g. 'reports/document.pdf') or HTTPS URL to a PDF"),
            pages: z.string().optional().describe("Page range to extract (e.g. '1-5', '1,3,5', 'all'). Defaults to all."),
            preserve_layout: z.boolean().optional().default(false).describe("Attempt to preserve whitespace layout"),
        }),
        execute: async (params, context) => {
            try {
                let pdfBuffer: Buffer;

                if (params.source.startsWith("http://") || params.source.startsWith("https://")) {
                    const res = await fetch(params.source, { signal: AbortSignal.timeout(30000) });
                    if (!res.ok) throw new Error(`Failed to fetch PDF: HTTP ${res.status}`);
                    pdfBuffer = Buffer.from(await res.arrayBuffer());
                } else {
                    const { fileStorageSuccess } = await import("@domain/knowledge/core/file-storage.js");
                    const orgId = context?.organizationId ?? null;
                    pdfBuffer = await fileStorageSuccess.readBuffer(orgId, params.source);
                }

                const pdfParse = await import("pdf-parse");
                const parseFn: Function = (pdfParse as any).default ?? pdfParse;
                const data = await parseFn(pdfBuffer, { max: 0 });

                let text = data.text;

                if (params.pages && params.pages !== "all") {
                    const pageTexts = text.split(/\f/);
                    const pageNums = parsePageRange(params.pages, pageTexts.length);
                    text = pageNums.map(n => pageTexts[n - 1] || "").join("\n\n---\n\n");
                }

                if (!params.preserve_layout) {
                    text = text.replace(/\n{3,}/g, "\n\n").trim();
                }

                return `**PDF Extraction: ${params.source}**\n**Pages**: ${data.numpages}\n**Characters**: ${data.text.length}\n\n---\n\n${text.substring(0, 15000)}${text.length > 15000 ? "\n\n... (truncated)" : ""}`;
            } catch (err: any) {
                return `PDF extraction error: ${err.message}`;
            }
        },
    },

    pdf_extract_metadata: {
        name: "pdf_extract_metadata",

        idempotency: "read-safe",
        label: "Extract PDF Metadata",
        group: "Document Processing",
        description: "Extract metadata from a PDF file (author, title, page count, creation date, etc.).",
        parameters: z.object({
            source: z.string().describe("File path or HTTPS URL to a PDF"),
        }),
        execute: async (params, context) => {
            try {
                let pdfBuffer: Buffer;

                if (params.source.startsWith("http://") || params.source.startsWith("https://")) {
                    const res = await fetch(params.source, { signal: AbortSignal.timeout(30000) });
                    if (!res.ok) throw new Error(`Failed to fetch PDF: HTTP ${res.status}`);
                    pdfBuffer = Buffer.from(await res.arrayBuffer());
                } else {
                    const { fileStorageSuccess } = await import("@domain/knowledge/core/file-storage.js");
                    const orgId = context?.organizationId ?? null;
                    pdfBuffer = await fileStorageSuccess.readBuffer(orgId, params.source);
                }

                const pdfParse = await import("pdf-parse");
                const parseFn: Function = (pdfParse as any).default ?? pdfParse;
                const data = await parseFn(pdfBuffer);

                return JSON.stringify({
                    pages: data.numpages,
                    info: data.info,
                    metadata: data.metadata,
                    version: data.version,
                    textLength: data.text.length,
                }, null, 2);
            } catch (err: any) {
                return `PDF metadata extraction error: ${err.message}`;
            }
        },
    },
};

function parsePageRange(range: string, totalPages: number): number[] {
    const pages: Set<number> = new Set();
    const parts = range.split(",");
    for (const part of parts) {
        const trimmed = part.trim();
        if (trimmed.includes("-")) {
            const [start, end] = trimmed.split("-").map(Number);
            for (let i = start; i <= Math.min(end, totalPages); i++) pages.add(i);
        } else {
            const n = parseInt(trimmed);
            if (!isNaN(n) && n >= 1 && n <= totalPages) pages.add(n);
        }
    }
    return Array.from(pages).sort((a, b) => a - b);
}
