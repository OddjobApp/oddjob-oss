/**
 * HTML back to manuscript markdown — the return leg of the editor round-trip.
 *
 * The outbound leg lives in markdown-html.ts. This is its counterpart, and the
 * two have to agree: whatever renderMarkdownToSafeHtml emits, this must convert
 * back without loss, or the author watches formatting vanish on autosave.
 *
 * It lives in its own module rather than inside LivingDocumentCanvas so tests
 * exercise the configuration the editor actually uses. A test that builds its
 * own TurndownService proves nothing about the editor — the first version of the
 * macro tests did exactly that and "passed" while silently disagreeing with the
 * real one about bullet markers and task lists.
 */

import TurndownService from "turndown";
import { macroTurndownRules } from "./document-macros";

/** Turndown ships CommonJS, and the interop differs between the two tsconfigs. */
const Turndown = (typeof TurndownService === "function"
    ? TurndownService
    : (TurndownService as any).default) as typeof TurndownService;

export function createTurndownService(): TurndownService {
    const td = new Turndown({
        headingStyle: "atx",
        codeBlockStyle: "fenced",
        bulletListMarker: "-",
        emDelimiter: "*",
        strongDelimiter: "**",
    });

    // Clean GFM tables. Cell text is read with textContent, which is also why a
    // table nested in a cell cannot survive — see table-editing.ts.
    td.addRule("table", {
        filter: "table",
        replacement: function (_content, node) {
            const table = node as HTMLTableElement;
            const rows = Array.from(table.rows);
            if (!rows.length) return "";
            return (
                "\n\n" +
                rows
                    .map((row, i) => {
                        const cells = Array.from(row.cells).map(
                            (c) => c.textContent?.trim().replace(/\|/g, "\\|") || "",
                        );
                        const rowStr = "| " + cells.join(" | ") + " |";
                        if (i === 0) {
                            const sep = "| " + cells.map(() => "---").join(" | ") + " |";
                            return rowStr + "\n" + sep;
                        }
                        return rowStr;
                    })
                    .join("\n") +
                "\n\n"
            );
        },
    });

    // Confluence-style macros survive as HTML: there is no markdown that means
    // "info panel", so the alternative to keeping the element is losing it.
    for (const { key, rule } of macroTurndownRules()) {
        td.addRule(key, rule as any);
    }

    // Confidential / Sandboxed narrative blocks (CORE)
    td.addRule("scribeSandbox", {
        filter: function (node) {
            if (node.nodeType !== 1) return false;
            const el = node as Element;
            return (el.getAttribute("class") ?? "").includes("scribe-sandbox");
        },
        replacement: function (_content, node) {
            const el = node as HTMLElement;
            const id = el.getAttribute("data-sandbox-id") || "sandbox_block";
            const type = el.getAttribute("data-type") || "confidential";
            const mode = el.getAttribute("data-mode") || "static_reinsert";
            const summary = el.getAttribute("data-summary") || "Protected scene";
            const bodyEl = el.querySelector(".scribe-sandbox-body");
            const body = bodyEl ? (bodyEl.textContent?.trim() ?? "") : (el.textContent?.trim() ?? "");
            return `\n\n:::sandbox id="${id}" type="${type}" mode="${mode}" summary="${summary}"\n${body}\n:::\n\n`;
        },
    });

    // GFM task lists. marked renders `- [x]` as a disabled checkbox; this reads
    // it back, and without it every checklist flattens to a plain bullet.
    td.addRule("taskList", {
        filter: function (node) {
            return node.nodeName === "INPUT" && (node as HTMLInputElement).type === "checkbox";
        },
        replacement: function (_content, node) {
            return (node as HTMLInputElement).checked ? "[x] " : "[ ] ";
        },
    });

    return td;

}

/** The editor's own instance. Stateless across calls, so one is enough. */
export const turndownInstance = createTurndownService();
