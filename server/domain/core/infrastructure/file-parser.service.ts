import { parse as parseCsv } from "csv-parse/sync";
import { XMLParser } from "fast-xml-parser";
import { PDFParse } from "pdf-parse";

interface ParsedFile {
    /**
     * `unsupported` is a real outcome, not an error. Decoding an unknown binary
     * as UTF-8 turns "we cannot read this" into "here is some content", and the
     * mojibake is then stored and embedded as if it were real.
     */
    type: "table" | "json" | "text" | "image" | "bpmn" | "unsupported";
    content: any; // Structured content or raw text; null when unsupported
    summary?: string; // Markdown summary for context
    metadata?: Record<string, any>;
}

export interface ParseOptions {
    /**
     * Cut extracted text at this many characters. Omitted means no truncation.
     *
     * Opt-in on purpose: this parser used to truncate every text file at 10,000
     * characters unconditionally and silently, so a long document became its
     * opening pages with nothing to indicate it. When a caller does ask for a
     * limit, `metadata.truncated` and `metadata.fullLength` say so.
     */
    maxTextLength?: number;
}

/** How many data rows of each sheet are rendered into the markdown preview. */
const SPREADSHEET_PREVIEW_ROWS = 20;

const DOCX_MIMES = new Set([
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
]);

const XLSX_MIMES = new Set([
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "application/vnd.ms-excel.sheet.macroenabled.12",
]);

/** MIME types outside `text/*` whose payload is genuinely text. */
const TEXTUAL_MIMES = new Set([
    "application/x-yaml", "application/yaml", "application/toml",
    "application/x-sh", "application/javascript", "application/typescript",
    "application/sql", "application/graphql", "message/rfc822",
]);

/** Extensions that are text even when the browser reports a useless MIME type. */
const TEXTUAL_EXTENSIONS = new Set([
    "txt", "md", "markdown", "rst", "log", "yaml", "yml", "toml", "ini", "cfg", "conf", "env",
    "sql", "graphql", "gql", "sh", "bash", "ps1", "bat",
    "js", "jsx", "ts", "tsx", "py", "rb", "go", "rs", "java", "kt", "cs", "php", "swift",
    "c", "h", "cpp", "hpp", "css", "scss", "html", "htm", "vue", "svelte", "tf", "eml",
]);

/**
 * A process reduced to the shape an assembly can be built from.
 *
 * Extracting only tasks — which is all this parser used to do — yields an
 * unordered bag of names. Order lives in sequence flows and branching lives in
 * gateways, so without them a synthesiser has to INVENT the process, which is
 * exactly the guessing this platform is built to avoid.
 *
 * The field names deliberately echo the assembly primitives these map onto:
 * tasks → pipeline steps, gateways → CEL conditions on those steps, dataObjects
 * → dataset fields, formFields → UI inputs, lanes → role assignment.
 */
export interface ProcessGraph {
    processId: string | null;
    processName: string | null;
    tasks: Array<{ id: string; name: string | null; kind: string; lane: string | null }>;
    gateways: Array<{ id: string; name: string | null; kind: string; default: string | null }>;
    flows: Array<{ id: string; from: string; to: string; name: string | null; condition: string | null }>;
    dataObjects: Array<{ id: string; name: string | null }>;
    lanes: Array<{ id: string; name: string | null; flowNodeRefs: string[] }>;
    events: Array<{ id: string; name: string | null; kind: string }>;
    /** Nodes with no inbound flow — where the process starts. */
    entryPoints: string[];
    /** Reported rather than repaired: a dangling flow means the file is wrong. */
    danglingFlows: Array<{ id: string; from: string; to: string }>;
}

export class FileParser {

    /**
     * Parse an uploaded file based on its MIME type and content
     */
    static async parse(
        buffer: Buffer,
        mimetype: string,
        originalName: string,
        options: ParseOptions = {},
    ): Promise<ParsedFile> {
        const extension = originalName.split('.').pop()?.toLowerCase() ?? "";

        // 1. CSV / Tabular
        if (mimetype === "text/csv" || extension === "csv") {
            return this.parseCsv(buffer);
        }

        // 2. JSON
        if (mimetype === "application/json" || extension === "json") {
            return this.parseJson(buffer);
        }

        // 3. BPMN / XML
        if (mimetype === "application/xml" || mimetype === "text/xml" || extension === "bpmn" || extension === "xml") {
            return this.parseBpmn(buffer);
        }

        // 4. PDF
        if (mimetype === "application/pdf" || extension === "pdf") {
            return this.parsePdf(buffer, originalName);
        }

        // 5. Word. `mammoth` was already a dependency with no branch, so a .docx
        //    fell through to the text fallback below and became mojibake — which
        //    then got stored and embedded as if it were content.
        if (DOCX_MIMES.has(mimetype) || extension === "docx") {
            return this.parseDocx(buffer, originalName, options);
        }

        // 6. Spreadsheets. Same failure as .docx: a binary zip read as UTF-8.
        if (XLSX_MIMES.has(mimetype) || ["xlsx", "xlsm"].includes(extension)) {
            return this.parseSpreadsheet(buffer, originalName);
        }

        // 7. Images — returned as bytes for a vision model to read. The caller
        //    decides; this parser does not describe pictures.
        if (mimetype.startsWith("image/")) {
            return {
                type: "image",
                content: buffer.toString("base64"),
                summary: `Image file: ${originalName}`,
                metadata: { mimeType: mimetype }
            };
        }

        // 8. Known-textual formats read as text.
        if (this.isTextual(mimetype, extension)) {
            return this.asText(buffer, originalName, options);
        }

        // 9. Everything else is REJECTED rather than decoded as text.
        //
        //    The old default ran every unknown type through toString("utf-8"),
        //    which turns "unsupported" into "corrupted" — and the corruption was
        //    then indistinguishable from real content. Naming the type gives the
        //    user something actionable and keeps garbage out of the index.
        return {
            type: "unsupported",
            content: null,
            summary: `Unsupported file type: ${originalName} (${mimetype || "unknown type"}). ` +
                `Supported: text, Markdown, CSV, JSON, XML/BPMN, PDF, Word (.docx), Excel (.xlsx), and images.`,
            metadata: { mimeType: mimetype, extension },
        };
    }

    /** Formats whose bytes are genuinely text. Anything else is not decoded. */
    private static isTextual(mimetype: string, extension: string): boolean {
        if (mimetype.startsWith("text/")) return true;
        if (TEXTUAL_MIMES.has(mimetype)) return true;
        return TEXTUAL_EXTENSIONS.has(extension);
    }

    /**
     * Text, truncated only when a caller asks for it.
     *
     * The parser used to cut every text file at 10,000 characters with no
     * signal, so a 40-page contract silently became its first three pages.
     * Truncation is now opt-in and always reported.
     */
    private static asText(buffer: Buffer, originalName: string, options: ParseOptions): ParsedFile {
        const full = buffer.toString("utf-8");
        const limit = options.maxTextLength;
        const truncated = typeof limit === "number" && limit > 0 && full.length > limit;

        return {
            type: "text",
            content: truncated ? full.slice(0, limit) : full,
            summary: `Text file: ${originalName}`,
            metadata: {
                fullLength: full.length,
                truncated,
                ...(truncated ? { truncatedAt: limit } : {}),
            },
        };
    }

    /** Word documents, via the dependency that was already installed. */
    private static async parseDocx(
        buffer: Buffer,
        originalName: string,
        options: ParseOptions,
    ): Promise<ParsedFile> {
        try {
            const mammoth = await import("mammoth");
            const { value, messages } = await mammoth.extractRawText({ buffer });
            const limit = options.maxTextLength;
            const truncated = typeof limit === "number" && limit > 0 && value.length > limit;

            return {
                type: "text",
                content: truncated ? value.slice(0, limit) : value,
                summary: `### Word Document: ${originalName}\n${value.length} characters extracted.`,
                metadata: {
                    fullLength: value.length,
                    truncated,
                    // mammoth reports unconvertible elements; kept so a document
                    // that lost content does not look like a clean extraction.
                    conversionWarnings: (messages ?? []).map((m: any) => m.message).slice(0, 20),
                },
            };
        } catch (err: any) {
            return {
                type: "unsupported",
                content: null,
                summary: `Could not read Word document ${originalName}: ${err.message}`,
                metadata: { error: err.message },
            };
        }
    }

    /**
     * Spreadsheets, one markdown table per sheet.
     *
     * Sheets are tabular like CSV, so they are rendered the same way — an agent
     * reading a table in markdown does far better than one handed a cell dump.
     */
    private static async parseSpreadsheet(buffer: Buffer, originalName: string): Promise<ParsedFile> {
        try {
            const ExcelJS = (await import("exceljs")).default ?? (await import("exceljs"));
            const workbook = new (ExcelJS as any).Workbook();
            await workbook.xlsx.load(buffer);

            const sheets: Array<{ name: string; rowCount: number; markdown: string }> = [];

            workbook.eachSheet((sheet: any) => {
                const rows: string[][] = [];
                sheet.eachRow({ includeEmpty: false }, (row: any) => {
                    const values = (row.values as any[]).slice(1).map((cell: any) => {
                        if (cell === null || cell === undefined) return "";
                        // A formula cell carries { formula, result } — the result
                        // is what a reader means by the cell's value.
                        if (typeof cell === "object") {
                            if ("result" in cell) return String(cell.result ?? "");
                            if ("text" in cell) return String(cell.text ?? "");
                            if (cell instanceof Date) return cell.toISOString();
                            return "";
                        }
                        return String(cell);
                    });
                    rows.push(values);
                });

                if (rows.length === 0) return;
                const [header, ...body] = rows;
                const shown = body.slice(0, SPREADSHEET_PREVIEW_ROWS);
                const markdown = [
                    `| ${header.join(" | ")} |`,
                    `| ${header.map(() => "---").join(" | ")} |`,
                    ...shown.map((r) => `| ${r.join(" | ")} |`),
                ].join("\n");

                sheets.push({ name: sheet.name, rowCount: rows.length, markdown });
            });

            if (sheets.length === 0) {
                return {
                    type: "unsupported",
                    content: null,
                    summary: `Spreadsheet ${originalName} contains no readable rows.`,
                    metadata: { sheets: 0 },
                };
            }

            const summary = sheets
                .map((s) => `#### Sheet: ${s.name} (${s.rowCount} rows)\n${s.markdown}`)
                .join("\n\n");

            return {
                type: "table",
                content: sheets,
                summary: `### Spreadsheet: ${originalName}\n${sheets.length} sheet(s).\n\n${summary}`,
                metadata: {
                    sheetNames: sheets.map((s) => s.name),
                    // Row counts are the full totals; the markdown is a preview.
                    rowCounts: sheets.map((s) => s.rowCount),
                    previewRows: SPREADSHEET_PREVIEW_ROWS,
                },
            };
        } catch (err: any) {
            return {
                type: "unsupported",
                content: null,
                summary: `Could not read spreadsheet ${originalName}: ${err.message}`,
                metadata: { error: err.message },
            };
        }
    }

    private static parseCsv(buffer: Buffer): ParsedFile {
        try {
            const records = parseCsv(buffer, {
                columns: true,
                skip_empty_lines: true,
                to: 50 // Limit to 50 rows for context
            });

            // Create markdown table summary
            const headers = Object.keys(records[0] || {});
            const tableHeader = `| ${headers.join(" | ")} |`;
            const tableDivider = `| ${headers.map(() => "---").join(" | ")} |`;
            const tableRows = records.slice(0, 5).map((row: any) =>
                `| ${headers.map(h => row[h]).join(" | ")} |`
            ).join("\n");

            return {
                type: "table",
                content: records,
                summary: `### CSV Data Preview (${records.length} rows)\n${tableHeader}\n${tableDivider}\n${tableRows}`
            };
        } catch (err: any) {
            return {
                type: "text",
                content: buffer.toString("utf-8").slice(0, 1000),
                summary: `Error parsing CSV: ${err.message}`
            };
        }
    }

    private static parseJson(buffer: Buffer): ParsedFile {
        try {
            const json = JSON.parse(buffer.toString("utf-8"));
            return {
                type: "json",
                content: json,
                summary: `### JSON Data\n\`\`\`json\n${JSON.stringify(json, null, 2).slice(0, 500)}...\n\`\`\``
            };
        } catch (err: any) {
            return {
                type: "text",
                content: buffer.toString("utf-8").slice(0, 1000),
                summary: `Error parsing JSON: ${err.message}`
            };
        }
    }

    /** BPMN files vary in namespace prefix (`bpmn:`, `bpmn2:`, `ns0:`, none). */
    private static localName(key: string): string {
        return key.includes(":") ? key.split(":").pop()! : key;
    }

    private static asArray(value: any): any[] {
        if (value === undefined || value === null) return [];
        return Array.isArray(value) ? value : [value];
    }

    /** Condition text sits either in the element body or on a nested expression. */
    private static conditionOf(flow: any): string | null {
        const raw = Object.entries(flow ?? {}).find(
            ([k]) => FileParser.localName(k) === "conditionExpression",
        )?.[1] as any;
        if (raw === undefined || raw === null) return null;
        const text = typeof raw === "object" ? (raw["#text"] ?? raw["@_body"]) : raw;
        const value = typeof text === "string" ? text.trim() : "";
        return value.length > 0 ? value : null;
    }

    /**
     * Reduces a parsed BPMN process to the graph an assembly can be built from.
     *
     * Namespace-agnostic and shape-agnostic: fast-xml-parser collapses a
     * single-element list into an object, so every collection goes through
     * `asArray` — a one-task process must not parse differently from a two-task
     * one.
     */
    static toProcessGraph(process: any): ProcessGraph {
        const graph: ProcessGraph = {
            processId: process?.["@_id"] ?? null,
            processName: process?.["@_name"] ?? null,
            tasks: [], gateways: [], flows: [], dataObjects: [], lanes: [], events: [],
            entryPoints: [], danglingFlows: [],
        };

        // Lanes first: a task records the lane that owns it, which is what maps
        // onto agent role assignment.
        const laneOf = new Map<string, string>();
        for (const key of Object.keys(process ?? {})) {
            if (FileParser.localName(key) !== "laneSet") continue;
            for (const laneSet of FileParser.asArray(process[key])) {
                for (const laneKey of Object.keys(laneSet ?? {})) {
                    if (FileParser.localName(laneKey) !== "lane") continue;
                    for (const lane of FileParser.asArray(laneSet[laneKey])) {
                        const refs = Object.entries(lane ?? {})
                            .filter(([k]) => FileParser.localName(k) === "flowNodeRef")
                            .flatMap(([, v]) => FileParser.asArray(v))
                            .map((r: any) => (typeof r === "object" ? r["#text"] : r))
                            .filter((r: any): r is string => typeof r === "string");
                        const laneName = lane?.["@_name"] ?? null;
                        for (const ref of refs) laneOf.set(ref, laneName ?? lane?.["@_id"]);
                        graph.lanes.push({ id: lane?.["@_id"], name: laneName, flowNodeRefs: refs });
                    }
                }
            }
        }

        for (const key of Object.keys(process ?? {})) {
            const name = FileParser.localName(key);
            const items = FileParser.asArray(process[key]);

            if (name.endsWith("Task") || name === "task" || name === "callActivity" || name === "subProcess") {
                for (const t of items) {
                    graph.tasks.push({
                        id: t?.["@_id"], name: t?.["@_name"] ?? null, kind: name,
                        lane: laneOf.get(t?.["@_id"]) ?? null,
                    });
                }
            } else if (name.endsWith("Gateway")) {
                for (const g of items) {
                    graph.gateways.push({
                        id: g?.["@_id"], name: g?.["@_name"] ?? null, kind: name,
                        default: g?.["@_default"] ?? null,
                    });
                }
            } else if (name === "sequenceFlow") {
                for (const f of items) {
                    graph.flows.push({
                        id: f?.["@_id"], from: f?.["@_sourceRef"], to: f?.["@_targetRef"],
                        name: f?.["@_name"] ?? null, condition: FileParser.conditionOf(f),
                    });
                }
            } else if (name === "dataObject" || name === "dataObjectReference") {
                for (const d of items) {
                    // A reference and its object are the same thing named twice.
                    if (graph.dataObjects.some((existing) => existing.id === d?.["@_id"])) continue;
                    graph.dataObjects.push({ id: d?.["@_id"], name: d?.["@_name"] ?? null });
                }
            } else if (name.endsWith("Event")) {
                for (const e of items) {
                    graph.events.push({ id: e?.["@_id"], name: e?.["@_name"] ?? null, kind: name });
                }
            }
        }

        const nodeIds = new Set<string>([
            ...graph.tasks.map((t) => t.id),
            ...graph.gateways.map((g) => g.id),
            ...graph.events.map((e) => e.id),
        ].filter(Boolean));

        const hasInbound = new Set(graph.flows.map((f) => f.to));
        graph.entryPoints = [...nodeIds].filter((id) => !hasInbound.has(id));
        // Surfaced, not silently dropped: a flow pointing at a node that does not
        // exist means the diagram is broken, and building from it would invent
        // structure the author never drew.
        graph.danglingFlows = graph.flows
            .filter((f) => !nodeIds.has(f.from) || !nodeIds.has(f.to))
            .map((f) => ({ id: f.id, from: f.from, to: f.to }));

        return graph;
    }

    /** Markdown an agent can read without re-deriving the graph. */
    static describeProcessGraph(graph: ProcessGraph): string {
        const lines: string[] = [
            `### BPMN Process${graph.processName ? `: ${graph.processName}` : ""}`,
            `${graph.tasks.length} tasks · ${graph.gateways.length} gateways · ${graph.flows.length} flows · ` +
            `${graph.dataObjects.length} data objects · ${graph.lanes.length} lanes`,
        ];

        if (graph.tasks.length) {
            lines.push("", "**Tasks**");
            for (const t of graph.tasks) {
                lines.push(`- [${t.kind}] ${t.name || t.id}${t.lane ? ` — lane: ${t.lane}` : ""}`);
            }
        }
        const branching = graph.flows.filter((f) => f.condition);
        if (branching.length) {
            lines.push("", "**Conditional flows**");
            for (const f of branching) lines.push(`- ${f.from} → ${f.to} when \`${f.condition}\``);
        }
        if (graph.dataObjects.length) {
            lines.push("", "**Data**", ...graph.dataObjects.map((d) => `- ${d.name || d.id}`));
        }
        if (graph.danglingFlows.length) {
            lines.push("", `**${graph.danglingFlows.length} flow(s) reference a node that is not in this process** — ` +
                `the diagram is incomplete; do not infer the missing steps.`);
        }
        return lines.join("\n");
    }

    private static parseBpmn(buffer: Buffer): ParsedFile {
        try {
            const parser = new XMLParser({
                ignoreAttributes: false,
                attributeNamePrefix: "@_"
            });
            const jsonObj = parser.parse(buffer.toString("utf-8"));

            // Basic extraction of BPMN elements
            // Note: BPMN structure can be deep, we look for common elements
            const process = jsonObj["bpmn:definitions"]?.["bpmn:process"] || jsonObj["definitions"]?.["process"];

            if (!process) {
                return {
                    type: "text",
                    content: buffer.toString("utf-8").slice(0, 1000),
                    summary: "XML file (not standard BPMN)"
                };
            }

            const flowElements = Array.isArray(process) ? process[0] : process;
            const graph = FileParser.toProcessGraph(flowElements);

            return {
                type: "bpmn",
                // Both: the graph is what a synthesiser consumes, the raw tree
                // stays so nothing extracted-but-unmodelled is lost.
                content: { graph, raw: jsonObj },
                metadata: { processGraph: graph },
                summary: FileParser.describeProcessGraph(graph),
            };
        } catch (err: any) {
            return {
                type: "text",
                content: buffer.toString("utf-8").slice(0, 1000),
                summary: `Error parsing BPMN/XML: ${err.message}`
            };
        }
    }

    private static async parsePdf(buffer: Buffer, originalName: string): Promise<ParsedFile> {
        try {
            const pyUrl = process.env.PYTHON_BACKEND_URL || "http://localhost:8000";
            const formData = new FormData();
            formData.append("file", new Blob([Uint8Array.from(buffer)], { type: "application/pdf" }), originalName);

            const res = await fetch(`${pyUrl}/api/v1/scraping/pdf/parse`, {
                method: "POST",
                body: formData,
            }).catch(() => null);

            if (res && res.ok) {
                const data = await res.json() as any;
                if (data?.text_content) {
                    return {
                        type: "text",
                        content: data.text_content,
                        summary: `### PDF Document: ${originalName}\nExtracted text via Python PDF service (${data.metadata?.num_pages || 1} pages).`,
                        metadata: data.metadata
                    };
                }
            }
        } catch {
            // Fallback to local JS parser
        }

        try {
            const parser = new PDFParse({ data: buffer });
            const result = await parser.getText();
            return {
                type: "text",
                content: result.text,
                summary: `### PDF Document: ${originalName}\nExtracted ${result.pages.length} pages of text.`
            };
        } catch (err: any) {
            // Reported as unsupported, not as an empty text document. Returning
            // `type: "text"` with `content: ""` made a failed extraction look
            // like a PDF that genuinely had no words in it — and a caller
            // recording that as parsed content stores a lie.
            return {
                type: "unsupported",
                content: null,
                summary: `Could not read PDF ${originalName}: ${err.message}`,
                metadata: { error: err.message },
            };
        }
    }
}




