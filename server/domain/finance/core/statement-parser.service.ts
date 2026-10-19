/**
 * Statement parser — normalizes OFX, QIF, and CSV bank/card exports into a
 * common ParsedTransaction shape. Dependency-light: OFX/QIF are parsed with
 * line/regex scanning; CSV uses csv-parse/sync (already a project dependency,
 * see folder-import-executor.ts). When a source has no FITID we synthesize a
 * stable one from date+amount+payee so dedupe (FITID == recordId) still works.
 */

import crypto from "crypto";

export interface ParsedTransaction {
    fitid: string;
    timestamp: string; // ISO-8601
    payee_raw: string;
    amount: number;
    memo?: string;
}

export type StatementFormat = "ofx" | "qif" | "csv";

export function detectFormat(fileName: string): StatementFormat | null {
    const lower = fileName.toLowerCase();
    if (lower.endsWith(".ofx") || lower.endsWith(".qfx")) return "ofx";
    if (lower.endsWith(".qif")) return "qif";
    if (lower.endsWith(".csv")) return "csv";
    return null;
}

function syntheticFitid(timestamp: string, amount: number, payee: string): string {
    return crypto
        .createHash("sha1")
        .update(`${timestamp}|${amount.toFixed(2)}|${payee.trim().toLowerCase()}`)
        .digest("hex")
        .slice(0, 24);
}

/** OFX/QFX dates look like 20260115 or 20260115120000[-5:EST]. */
function parseOfxDate(raw: string): string {
    const digits = (raw || "").trim().replace(/\[.*$/, "");
    const y = digits.slice(0, 4);
    const m = digits.slice(4, 6) || "01";
    const d = digits.slice(6, 8) || "01";
    const iso = new Date(`${y}-${m}-${d}T00:00:00Z`);
    return isNaN(iso.getTime()) ? new Date().toISOString() : iso.toISOString();
}

/** QIF dates: M/D'YY, M/D/YYYY, or D/M/YYYY — normalized leniently. */
function parseQifDate(raw: string): string {
    const cleaned = (raw || "").trim().replace(/'/g, "/").replace(/\s+/g, "");
    const parts = cleaned.split(/[/.-]/).filter(Boolean);
    if (parts.length >= 3) {
        let [a, b, c] = parts;
        if (c.length === 2) c = `20${c}`;
        const mm = a.padStart(2, "0");
        const dd = b.padStart(2, "0");
        const iso = new Date(`${c}-${mm}-${dd}T00:00:00Z`);
        if (!isNaN(iso.getTime())) return iso.toISOString();
    }
    const fallback = new Date(cleaned);
    return isNaN(fallback.getTime()) ? new Date().toISOString() : fallback.toISOString();
}

function ofxTag(block: string, tag: string): string {
    const m = block.match(new RegExp(`<${tag}>([^<\\r\\n]*)`, "i"));
    return m ? m[1].trim() : "";
}

export function parseOfx(content: string): ParsedTransaction[] {
    const out: ParsedTransaction[] = [];
    const blocks = content.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi) || [];
    for (const block of blocks) {
        const amount = parseFloat(ofxTag(block, "TRNAMT")) || 0;
        const timestamp = parseOfxDate(ofxTag(block, "DTPOSTED"));
        const payee_raw = ofxTag(block, "NAME") || ofxTag(block, "PAYEE") || ofxTag(block, "MEMO") || "Unknown";
        const memo = ofxTag(block, "MEMO") || undefined;
        const fitid = ofxTag(block, "FITID") || syntheticFitid(timestamp, amount, payee_raw);
        out.push({ fitid, timestamp, payee_raw, amount, memo });
    }
    return out;
}

export function parseQif(content: string): ParsedTransaction[] {
    const out: ParsedTransaction[] = [];
    const lines = content.split(/\r?\n/);
    let cur: { date?: string; amount?: number; payee?: string; memo?: string } = {};
    const flush = () => {
        if (cur.date || cur.amount != null || cur.payee) {
            const timestamp = parseQifDate(cur.date || "");
            const amount = cur.amount ?? 0;
            const payee_raw = cur.payee || cur.memo || "Unknown";
            out.push({
                fitid: syntheticFitid(timestamp, amount, payee_raw),
                timestamp,
                payee_raw,
                amount,
                memo: cur.memo,
            });
        }
        cur = {};
    };
    for (const line of lines) {
        if (!line) continue;
        const code = line[0];
        const value = line.slice(1).trim();
        switch (code) {
            case "D": cur.date = value; break;
            case "T":
            case "U": cur.amount = parseFloat(value.replace(/,/g, "")) || 0; break;
            case "P": cur.payee = value; break;
            case "M": cur.memo = value; break;
            case "^": flush(); break;
            default: break; // ignore !Type headers and other fields
        }
    }
    flush();
    return out;
}

function pick(row: Record<string, any>, keys: string[]): string {
    for (const k of Object.keys(row)) {
        if (keys.includes(k.trim().toLowerCase())) return String(row[k] ?? "").trim();
    }
    return "";
}

export async function parseCsv(content: string): Promise<ParsedTransaction[]> {
    const { parse } = await import("csv-parse/sync");
    const rows: Record<string, any>[] = parse(content, { columns: true, skip_empty_lines: true, trim: true });
    const out: ParsedTransaction[] = [];
    for (const row of rows) {
        const dateRaw = pick(row, ["date", "posted", "transaction date", "post date"]);
        const payee_raw = pick(row, ["payee", "description", "name", "memo", "details"]) || "Unknown";
        const amountRaw =
            pick(row, ["amount", "value"]) ||
            // debit/credit split columns
            (pick(row, ["credit"]) ? pick(row, ["credit"]) : `-${pick(row, ["debit"]) || "0"}`);
        const amount = parseFloat(String(amountRaw).replace(/[,$\s]/g, "")) || 0;
        const ts = new Date(dateRaw);
        const timestamp = isNaN(ts.getTime()) ? new Date().toISOString() : ts.toISOString();
        const providedFitid = pick(row, ["fitid", "id", "transaction id", "reference"]);
        out.push({
            fitid: providedFitid || syntheticFitid(timestamp, amount, payee_raw),
            timestamp,
            payee_raw,
            amount,
            memo: pick(row, ["memo", "notes"]) || undefined,
        });
    }
    return out;
}

export async function parseStatement(fileName: string, content: string): Promise<ParsedTransaction[]> {
    const format = detectFormat(fileName);
    switch (format) {
        case "ofx": return parseOfx(content);
        case "qif": return parseQif(content);
        case "csv": return parseCsv(content);
        default: throw new Error(`Unsupported statement format for file: ${fileName}`);
    }
}
