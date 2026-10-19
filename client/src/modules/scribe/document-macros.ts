/**
 * Confluence-style authoring blocks for the Living Document Canvas.
 *
 * Panels, expandable sections and status lozenges have no markdown syntax, so
 * each is a small piece of HTML embedded in the manuscript — the same choice
 * Confluence makes, whose storage format is XHTML rather than wiki text.
 *
 * That only works because every stage of the round-trip preserves it:
 *
 *   marked.parse      passes raw HTML through
 *   DOMPurify         keeps these tags and their class (see markdown-html.ts)
 *   rehype-raw        parses it back for the rendered pane
 *   rehype-sanitize   keeps it, sharing that same allowlist
 *   turndown          returns these elements verbatim (macroTurndownRules)
 *
 * Break any one of those and a panel becomes loose prose on the next save, so
 * the tests assert the whole cycle rather than the markup in isolation.
 *
 * Class names are the contract between this file, the sanitizer allowlist and
 * the rendered-pane styling; they are matched with a prefix, so a macro keeps
 * working when Tailwind utilities are appended to it.
 */

export const PANEL_CLASS = "scribe-panel";
export const STATUS_CLASS = "scribe-status";
export const SANDBOX_CLASS = "scribe-sandbox";

export type PanelKind = "info" | "note" | "warning" | "success";
export type StatusKind = "grey" | "blue" | "green" | "amber" | "red";


interface PanelStyle {
    label: string;
    icon: string;
    /** Light and dark are both explicit: the pane never inherits a theme. */
    className: string;
}

/**
 * The four panels Confluence users reach for. Icons are text, not an icon font,
 * so a panel survives being copied out as markdown and still reads correctly.
 */
export const PANEL_STYLES: Record<PanelKind, PanelStyle> = {
    info: {
        label: "Info",
        icon: "ℹ️",
        className: "border-sky-500/40 bg-sky-500/10 text-foreground",
    },
    note: {
        label: "Note",
        icon: "📝",
        className: "border-violet-500/40 bg-violet-500/10 text-foreground",
    },
    warning: {
        label: "Warning",
        icon: "⚠️",
        className: "border-amber-500/50 bg-amber-500/10 text-foreground",
    },
    success: {
        label: "Success",
        icon: "✅",
        className: "border-emerald-500/40 bg-emerald-500/10 text-foreground",
    },
};

export const STATUS_STYLES: Record<StatusKind, string> = {
    grey: "border-border bg-muted text-muted-foreground",
    blue: "border-sky-500/40 bg-sky-500/15 text-sky-700 dark:text-sky-300",
    green: "border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    amber: "border-amber-500/50 bg-amber-500/15 text-amber-700 dark:text-amber-300",
    red: "border-rose-500/40 bg-rose-500/15 text-rose-700 dark:text-rose-300",
};

/** Escape text destined for an HTML string literal. */
function escapeHtml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

/**
 * A panel. The body is a <p> so the caret has somewhere to land and the author
 * can type immediately rather than having to click into an empty div.
 */
export function panelHtml(kind: PanelKind, body = ""): string {
    const style = PANEL_STYLES[kind];
    const text = body.trim() ? escapeHtml(body.trim()) : `${style.label} text`;
    return (
        `<div class="${PANEL_CLASS} ${PANEL_CLASS}-${kind} my-3 rounded-md border px-3 py-2 ${style.className}">` +
        `<p><strong>${style.icon} ${style.label}</strong></p>` +
        `<p>${text}</p>` +
        `</div>`
    );
}

/** A collapsed section. <details> is native, so this needs no script to work. */
export function expandHtml(summary = "Details", body = ""): string {
    const title = escapeHtml(summary.trim() || "Details");
    const text = body.trim() ? escapeHtml(body.trim()) : "Hidden content";
    return (
        `<details class="scribe-expand my-3 rounded-md border border-border bg-muted/30 px-3 py-2">` +
        `<summary class="cursor-pointer font-semibold text-foreground">${title}</summary>` +
        `<p>${text}</p>` +
        `</details>`
    );
}

/** An inline status lozenge. */
export function statusHtml(kind: StatusKind, label: string): string {
    const text = escapeHtml(label.trim() || "STATUS").toUpperCase();
    return (
        `<span class="${STATUS_CLASS} ${STATUS_CLASS}-${kind} mx-0.5 rounded border px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${STATUS_STYLES[kind]}">` +
        `${text}</span>`
    );
}

/**
 * A confidential / sandboxed narrative beat widget.
 * Holds sensitive or mature prose in local memory and client display.
 */
export function sandboxHtml(
    id: string = "sandbox_block",
    type: string = "confidential",
    mode: string = "static_reinsert",
    summary: string = "Confidential scene",
    body: string = ""
): string {
    const safeId = escapeHtml(id || "sandbox_block");
    const safeType = escapeHtml(type || "confidential");
    const safeMode = escapeHtml(mode || "static_reinsert");
    const safeSummary = escapeHtml(summary || "Confidential narrative beat");
    const safeBody = body.trim() ? escapeHtml(body.trim()) : "Protected content";

    const badgeClass = safeType === "adult" || safeType === "violence"
        ? "border-amber-500/50 bg-amber-500/15 text-amber-600 dark:text-amber-400"
        : "border-sky-500/40 bg-sky-500/15 text-sky-600 dark:text-sky-400";

    return (
        `<div class="${SANDBOX_CLASS} my-3 rounded-lg border border-border bg-card p-3" ` +
        `data-sandbox-id="${safeId}" data-type="${safeType}" data-mode="${safeMode}" data-summary="${safeSummary}">` +
        `<div class="scribe-sandbox-header flex items-center justify-between gap-2 pb-2 border-b border-border/50 text-xs select-none">` +
        `<div class="flex items-center gap-2">` +
        `<span class="rounded border px-1.5 py-0.5 font-semibold uppercase tracking-wider ${badgeClass}">` +
        `🛡️ Vault: ${safeType}</span>` +
        `<span class="scribe-sandbox-summary-text font-medium text-foreground">${safeSummary}</span>` +
        `</div>` +
        `<span class="text-[10px] text-muted-foreground uppercase tracking-wider">🔒 Protected Local</span>` +
        `</div>` +
        `<p class="scribe-sandbox-body pt-2 text-sm text-foreground/90 font-serif leading-relaxed">${safeBody}</p>` +
        `</div>`
    );
}

/** Whether an element is a macro turndown must hand back unchanged. */
export function isMacroElement(node: Node): boolean {
    if (node.nodeType !== 1) return false;
    const el = node as Element;
    const name = el.nodeName.toLowerCase();
    if (name === "details" || name === "summary") return true;
    const cls = el.getAttribute("class") ?? "";
    return cls.includes(PANEL_CLASS) || cls.includes(STATUS_CLASS) || cls.includes(SANDBOX_CLASS);
}

/**
 * Turndown rules keeping macros as HTML.
 *
 * Returned verbatim rather than converted: there is no markdown that means
 * "info panel", so the alternative to keeping the element is losing it. Content
 * typed inside stays HTML too, which is the same trade Confluence makes.
 *
 * <summary> is excluded from matching on its own — it is emitted as part of the
 * <details> element, and a rule that also fired for the child would duplicate it.
 */
export function macroTurndownRules(): Array<{
    key: string;
    rule: { filter: (node: Node) => boolean; replacement: (content: string, node: Node) => string };
}> {
    return [
        {
            key: "scribeMacro",
            rule: {
                filter: (node: Node) => {
                    if (!isMacroElement(node)) return false;
                    const el = node as Element;
                    if (el.nodeName.toLowerCase() === "summary") return false;
                    // Scribe sandbox has its own dedicated rule in editor-turndown
                    if ((el.getAttribute("class") ?? "").includes(SANDBOX_CLASS)) return false;
                    // A macro nested in another macro is already inside the
                    // outer element's outerHTML.
                    return !el.parentElement || !el.parentElement.closest(macroSelector());
                },
                replacement: (_content: string, node: Node) => {
                    const html = (node as Element).outerHTML;
                    const block = (node as Element).nodeName.toLowerCase() !== "span";
                    return block ? `\n\n${html}\n\n` : html;
                },
            },
        },
    ];
}

/** CSS selector matching every macro root. */
export function macroSelector(): string {
    return `details, .${PANEL_CLASS}, .${STATUS_CLASS}, .${SANDBOX_CLASS}`;
}


/**
 * What each lozenge says before the author edits it.
 *
 * Named states rather than colour names: a lozenge reading "green" helps nobody,
 * and these are the states a document actually tracks.
 */
export const STATUS_DEFAULT_LABELS: Record<StatusKind, string> = {
    grey: "To Do",
    blue: "In Progress",
    green: "Done",
    amber: "At Risk",
    red: "Blocked",
};
