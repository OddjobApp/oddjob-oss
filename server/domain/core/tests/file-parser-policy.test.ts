import { describe, expect, it } from "vitest";
import { FileParser } from "../infrastructure/file-parser.service.js";

/**
 * The parser's old default ran every unknown type through toString("utf-8"),
 * which turns "unsupported" into "corrupted" — and the mojibake was then stored
 * and embedded as if it were content. It also truncated all text at 10,000
 * characters with no signal, so a long document silently became its first pages.
 */

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

describe("unsupported types are rejected, not decoded", () => {
    it("refuses a binary rather than turning it into mojibake", async () => {
        // A PNG signature followed by bytes that are not valid UTF-8.
        const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0xfd, 0x00, 0x01]);

        const parsed = await FileParser.parse(bytes, "application/octet-stream", "mystery.bin");

        expect(parsed.type).toBe("unsupported");
        expect(parsed.content).toBeNull();
        // Actionable: it names the type and lists what would work.
        expect(parsed.summary).toContain("mystery.bin");
        expect(parsed.summary).toMatch(/supported/i);
    });

    it("still reads source and config files as text", async () => {
        for (const name of ["notes.md", "deploy.yaml", "query.sql", "component.tsx"]) {
            const parsed = await FileParser.parse(Buffer.from("real content"), "", name);
            expect(parsed.type, name).toBe("text");
            expect(parsed.content, name).toBe("real content");
        }
    });
});

describe("truncation is opt-in and always reported", () => {
    const long = "y".repeat(25_000);

    it("keeps the whole document when no limit is given", async () => {
        const parsed = await FileParser.parse(Buffer.from(long), "text/plain", "contract.txt");

        expect(parsed.content).toHaveLength(25_000);
        expect(parsed.metadata?.truncated).toBe(false);
        expect(parsed.metadata?.fullLength).toBe(25_000);
    });

    it("says so when a caller does ask for a limit", async () => {
        const parsed = await FileParser.parse(Buffer.from(long), "text/plain", "contract.txt", {
            maxTextLength: 1_000,
        });

        expect(parsed.content).toHaveLength(1_000);
        // Both facts survive: what was kept, and how much there really was.
        expect(parsed.metadata?.truncated).toBe(true);
        expect(parsed.metadata?.fullLength).toBe(25_000);
    });
});

describe("Word documents", () => {
    it("extracts text from a real .docx instead of producing mojibake", async () => {
        // Built with mammoth's own dependency chain rather than a fixture file,
        // so the test exercises a genuine OOXML package.
        const docx = await buildDocx("Quarterly objectives and the risks against them.");

        const parsed = await FileParser.parse(docx, DOCX, "objectives.docx");

        expect(parsed.type).toBe("text");
        expect(parsed.content).toContain("Quarterly objectives");
        expect(parsed.metadata?.fullLength).toBeGreaterThan(0);
    });

    it("reports an unreadable .docx rather than storing garbage", async () => {
        const parsed = await FileParser.parse(Buffer.from("not a zip at all"), DOCX, "broken.docx");

        expect(parsed.type).toBe("unsupported");
        expect(parsed.content).toBeNull();
    });
});

describe("spreadsheets", () => {
    it("renders each sheet as a markdown table", async () => {
        const xlsx = await buildXlsx();

        const parsed = await FileParser.parse(xlsx, XLSX, "budget.xlsx");

        expect(parsed.type).toBe("table");
        expect(parsed.summary).toContain("Sheet: Q1");
        expect(parsed.summary).toContain("| Region | Spend |");
        expect(parsed.summary).toContain("EMEA");
        expect(parsed.metadata?.sheetNames).toEqual(["Q1"]);
    });

    it("reports an unreadable workbook rather than storing garbage", async () => {
        const parsed = await FileParser.parse(Buffer.from("still not a zip"), XLSX, "broken.xlsx");

        expect(parsed.type).toBe("unsupported");
    });
});

/** Minimal but genuine OOXML — mammoth reads the document part. */
async function buildDocx(text: string): Promise<Buffer> {
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    zip.file("[Content_Types].xml",
        `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
    zip.folder("_rels")!.file(".rels",
        `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
    zip.folder("word")!.file("document.xml",
        `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
        `<w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`);
    return zip.generateAsync({ type: "nodebuffer" });
}

async function buildXlsx(): Promise<Buffer> {
    const ExcelJS = (await import("exceljs")).default ?? (await import("exceljs"));
    const workbook = new (ExcelJS as any).Workbook();
    const sheet = workbook.addWorksheet("Q1");
    sheet.addRow(["Region", "Spend"]);
    sheet.addRow(["EMEA", 12000]);
    sheet.addRow(["AMER", 18500]);
    return Buffer.from(await workbook.xlsx.writeBuffer());
}
