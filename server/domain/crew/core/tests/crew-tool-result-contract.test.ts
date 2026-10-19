import { describe, it, expect } from "vitest";
import {
    classifyToolFailure,
    digestArtifactForModel,
    RETRIEVAL_TOOLS,
    RICH_PAYLOAD_TYPES,
    compactToolOutputForPrompt,
} from "../crew-tools.service.js";

/**
 * Both of these are regressions taken from one real room (session 387, org 473),
 * where the author twice reported that the crew "ignored" them.
 *
 * Neither was the model ignoring anything. One failure was reported as a success
 * and the other never reached the model at all.
 */
describe("classifyToolFailure", () => {
    it("treats the v1 capability prose convention as a failure", () => {
        // Verbatim from crew_turns #2085: recorded {ok:true, ms:3} while nothing
        // was written, because the tool returned this string instead of throwing.
        expect(
            classifyToolFailure("Error updating Scribe station: Node #1 not found"),
        ).toBe("Error updating Scribe station: Node #1 not found");

        expect(classifyToolFailure("Error configuring Scribe stations: no documentId")).toContain(
            "Error configuring Scribe stations",
        );
    });

    it("treats a JSON error envelope as a failure", () => {
        expect(
            classifyToolFailure(JSON.stringify({ error: "No attachment 7 in this project." })),
        ).toBe("No attachment 7 in this project.");
    });

    it("does not mistake ordinary results for failures", () => {
        expect(classifyToolFailure(JSON.stringify({ success: true, documentId: 19 }))).toBeNull();
        expect(classifyToolFailure("Configured 8 stations for \"Shelfie PRD\".")).toBeNull();
        expect(classifyToolFailure("")).toBeNull();
        // A document that merely opens with the word, with no colon near it.
        expect(
            classifyToolFailure(
                "Error handling in distributed systems is a broad topic that this section introduces at length for the reader.",
            ),
        ).toBeNull();
    });

    it("reports only the first line, so a stack does not become the label", () => {
        const msg = classifyToolFailure("Error saving: connection reset\n    at Foo.bar (x.ts:1:1)");
        expect(msg).toBe("Error saving: connection reset");
    });

    it("records a refused or unmatched instant-app render as a failure", () => {
        // These outputs previously recorded ok:true with no artifact — the
        // ledger then read a render that never happened as evidence it did.
        expect(
            classifyToolFailure('Error: no renderable instant-app block matches "Wombat Widget".'),
        ).toContain("no renderable instant-app block");
        expect(
            classifyToolFailure("Error: no blocks could be composed (unknown blocks: Wombat)."),
        ).toContain("no blocks could be composed");
        expect(
            classifyToolFailure("Error: instant-app blocks CANNOT calculate or query external live APIs"),
        ).toContain("CANNOT calculate");
    });
});

describe("retrieval tool results reach the model", () => {
    it("keeps the attachment lookups on the retrieval list", () => {
        // These render a surface AND answer a question. Dropping one back to the
        // "do not repeat its contents" branch is what made an attached file
        // invisible to every agent in the room.
        expect(RETRIEVAL_TOOLS.has("list_attachments")).toBe(true);
        expect(RETRIEVAL_TOOLS.has("search_attachments")).toBe(true);
        expect(RETRIEVAL_TOOLS.has("get_attachment_text")).toBe(true);
    });

    it("still classifies those payloads as renderable artifacts", () => {
        // The digest is additional, not a replacement: the human keeps the table.
        expect(RICH_PAYLOAD_TYPES.has("assistant_table")).toBe(true);
    });

    it("renders a table payload as readable lines rather than an envelope", () => {
        // The real list_attachments answer for session 387.
        const digest = digestArtifactForModel({
            type: "assistant_table",
            title: "Files attached in this room",
            description: "1 file",
            columns: [
                { key: "name", label: "File" },
                { key: "kind", label: "Kind" },
                { key: "read", label: "Read" },
            ],
            rows: [{ name: "App Concept ShelfLife.txt", kind: "text", read: "4211 chars" }],
        });

        expect(digest).toContain("App Concept ShelfLife.txt");
        expect(digest).toContain("Files attached in this room");
        expect(digest).toContain("1 file");
        // No envelope for the model to echo into the room.
        expect(digest).not.toContain('"type"');
        expect(digest).not.toContain("assistant_table");
    });

    it("says so plainly when a lookup is genuinely empty", () => {
        const digest = digestArtifactForModel({
            type: "assistant_table",
            title: "Files attached in this room",
            description: "0 files",
            columns: [{ key: "name", label: "File" }],
            rows: [],
        });
        expect(digest).toContain("0 files");
        expect(digest).toContain("(no rows)");
    });

    it("caps a long result instead of pasting all of it", () => {
        const rows = Array.from({ length: 40 }, (_, i) => ({ name: `file-${i}.txt` }));
        const digest = digestArtifactForModel({
            type: "assistant_table",
            title: "Files",
            columns: [{ key: "name", label: "File" }],
            rows,
        });
        expect(digest).toContain("file-0.txt");
        expect(digest).toContain("...and 10 more");
        expect(digest).not.toContain("file-39.txt");
    });
});

describe("compactToolOutputForPrompt — context pruning & offloading", () => {
    it("compacts google_workspace_results into concise evidence summaries", () => {
        const rawJson = JSON.stringify({
            items: [
                { Id: "101", DocNumber: "INV-101", TotalAmt: 1500, Balance: 1500, CurrencyRef: { value: "USD" } },
            ],
        });
        const artifact = {
            tool: "quickbooks_list_records",
            payload: {
                type: "google_workspace_results",
                title: "Invoices",
                items: [
                    { id: "101", kind: "accounting", title: "Invoice INV-101", preview: "Total: $1,500.00 | Balance: $1,500.00" },
                ],
            },
        };
        const compacted = compactToolOutputForPrompt("quickbooks_list_records", rawJson, artifact as any);
        expect(compacted).toContain('Rendered surface: "Invoices" (1 item)');
        expect(compacted).toContain("Invoice INV-101");
        expect(compacted).toContain("Total: $1,500.00");
        expect(compacted).not.toContain('"CurrencyRef"');
        expect(compacted).not.toContain('"DocNumber"');
    });

    it("compacts assistant_table into row digest", () => {
        const rawJson = JSON.stringify({ ok: true, data: [1, 2, 3] });
        const artifact = {
            tool: "list_attachments",
            payload: {
                type: "assistant_table",
                title: "Files",
                columns: [{ key: "name", label: "File" }],
                rows: [{ name: "budget.xlsx" }],
            },
        };
        const compacted = compactToolOutputForPrompt("list_attachments", rawJson, artifact as any);
        expect(compacted).toContain("Files");
        expect(compacted).toContain("budget.xlsx");
        expect(compacted).not.toContain('"assistant_table"');
    });

    it("falls back to standard capped output when no artifact exists", () => {
        const prose = "Simple execution completed successfully.";
        expect(compactToolOutputForPrompt("simple_tool", prose, null)).toBe(prose);
    });
});




