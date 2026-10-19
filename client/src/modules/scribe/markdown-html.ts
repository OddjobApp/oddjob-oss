/**
 * Markdown to HTML for the Living Document Canvas rich editor.
 *
 * The rich editor is a contenteditable surface, so the manuscript round-trips
 * markdown -> HTML -> (author edits) -> turndown -> markdown. The HTML half of
 * that trip is assigned with innerHTML, and `marked` does not sanitize: the
 * `sanitize` option was removed in v5, so raw HTML in the source markdown is
 * passed straight through.
 *
 * That matters because station content is not only typed by the author. Crew
 * agents write stations through scribe_update_node and scribe_configure_stations,
 * and a document can be forked, imported, or reconciled from a room transcript.
 * innerHTML does not run <script>, but it does run `<img onerror>` and
 * `<svg onload>`, which is enough to execute in the author's session under their
 * own credentials.
 *
 * The fix costs nothing here, because the editor's own capability surface is
 * already an allowlist: the ribbon emits headings, bold/italic/underline/strike,
 * lists, blockquote, tables, links, horizontal rules and <mark> highlights, and
 * turndown only knows how to convert that same set back to markdown. Anything
 * outside it could not survive a save anyway, so stripping it loses no authoring
 * feature — it only removes the markup that has no business in a document.
 */

import DOMPurify from "dompurify";
import { marked } from "marked";
import { sandboxHtml } from "./document-macros";

/**
 * GFM for tables and task lists; breaks so a single newline in a manuscript
 * renders as a line break rather than being folded into the paragraph.
 *
 * This lives here rather than in the component because `marked` is a module
 * singleton: configuring it next to the render call keeps the two from being
 * separated by an import-order accident.
 */
marked.setOptions({ gfm: true, breaks: true });

/**
 * Everything the ribbon can insert, plus what `marked` emits for GFM.
 *
 * `input` is here for GFM task lists: marked renders `- [x]` as a disabled
 * checkbox, and createTurndownService has a taskList rule that reads it back.
 * Dropping it would silently turn every checklist into a bare list item on the
 * next save.
 */
const ALLOWED_TAGS = [
    "p", "br", "hr", "span", "div",
    "h1", "h2", "h3", "h4", "h5", "h6",
    "strong", "b", "em", "i", "u", "s", "strike", "del", "ins", "mark", "sub", "sup", "small",
    "ul", "ol", "li",
    "blockquote", "pre", "code",
    // Confluence-style macros (see document-macros.ts). <details>/<summary> are
    // native collapse, so an expandable section needs no script; dropping them
    // here would silently flatten every one on the next save.
    "details", "summary",
    "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "colgroup", "col",
    "a", "img",
    "input",
];

/**
 * class is required: the table and highlight builders emit Tailwind classes,
 * and dropping them would leave inserted tables unstyled.
 */
const ALLOWED_ATTR = [
    "class", "href", "title", "target", "rel",
    "src", "alt", "width", "height",
    "colspan", "rowspan", "align",
    "type", "checked", "disabled",
    "start", "reversed", "value",
    "data-sandbox-id", "data-type", "data-mode", "data-summary", "data-token-id",
];

const PURIFY_CONFIG = {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    // Event handlers are the actual vector; name them so a future config edit
    // cannot re-admit them by widening ALLOWED_ATTR.
    FORBID_ATTR: ["style", "srcset", "formaction", "form", "xlink:href"],
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "base", "link", "meta", "svg", "math"],
    // Blocks javascript: and data: URLs in href/src while leaving http(s),
    // mailto and relative anchors (the table of contents links) intact.
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
    KEEP_CONTENT: true,
};

/** Anything the editor sets on a link, it should survive a same-tab open safely. */
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A" && node.getAttribute("target") === "_blank") {
        node.setAttribute("rel", "noopener noreferrer");
    }
});

/**
 * The same allowlist, shaped for rehype-sanitize.
 *
 * The rendered-preview panes take a second route to the same place: ReactMarkdown
 * drops raw HTML by default, which is what makes it safe, but the manuscript
 * genuinely contains HTML — the rich editor writes <mark> highlights and <u> into
 * the markdown — so those panes need rehype-raw to parse it. rehype-raw on its own
 * re-opens exactly what sanitizeEditorHtml closes, one pane over, so it must always
 * be followed by rehype-sanitize with this schema.
 *
 * Derived from the arrays above rather than restated, so widening the editor's
 * capabilities cannot leave the preview behind (or vice versa). hast spells the
 * class attribute `className`.
 */
export const REHYPE_SANITIZE_SCHEMA = {
    tagNames: ALLOWED_TAGS,
    attributes: {
        "*": ["className", "title"],
        div: ["dataSandboxId", "dataType", "dataMode", "dataSummary", "dataTokenId", "data-sandbox-id", "data-type", "data-mode", "data-summary", "data-token-id"],
        a: ["href", "target", "rel"],
        img: ["src", "alt", "width", "height"],
        th: ["colspan", "rowspan", "align"],
        td: ["colspan", "rowspan", "align"],
        col: ["span"],
        ol: ["start", "reversed"],
        input: ["type", "checked", "disabled"],
    },
    // Anything not listed is dropped, so this is belt-and-braces on the two
    // attributes that carry a URL.
    protocols: {
        href: ["http", "https", "mailto", "tel"],
        src: ["http", "https"],
    },
    clobberPrefix: "scribe-",
    strip: ["script", "style"],
};

/** Sanitize HTML that is already HTML (paste, or a value read back off the DOM). */
export function sanitizeEditorHtml(html: string): string {
    return DOMPurify.sanitize(html, PURIFY_CONFIG) as unknown as string;
}

/** Pre-processes :::sandbox markdown container blocks into scribe-sandbox HTML macros */
export function preProcessSandboxBlocks(markdown: string): string {
    const SANDBOX_REGEX = /:::sandbox\s+([^\r\n]+?)\r?\n([\s\S]*?)\r?\n:::/gi;
    return (markdown ?? "").replace(SANDBOX_REGEX, (_match, attrStr, body) => {
        const idMatch = attrStr.match(/id="([^"]*)"|id='([^']*)'/i);
        const typeMatch = attrStr.match(/type="([^"]*)"|type='([^']*)'/i);
        const modeMatch = attrStr.match(/mode="([^"]*)"|mode='([^']*)'/i);
        const summaryMatch = attrStr.match(/summary="([^"]*)"|summary='([^']*)'/i);

        const id = idMatch ? (idMatch[1] ?? idMatch[2]) : "sandbox_block";
        const type = typeMatch ? (typeMatch[1] ?? typeMatch[2]) : "confidential";
        const mode = modeMatch ? (modeMatch[1] ?? modeMatch[2]) : "static_reinsert";
        const summary = summaryMatch ? (summaryMatch[1] ?? summaryMatch[2]) : "Confidential scene";

        return sandboxHtml(id, type, mode, summary, body);
    });
}

/**
 * Render manuscript markdown to the HTML the rich editor mounts.
 *
 * Every innerHTML assignment in LivingDocumentCanvas goes through here; calling
 * marked.parse directly at an assignment site is the bug this module exists to
 * prevent.
 */
export function renderMarkdownToSafeHtml(markdown: string): string {
    const preprocessed = preProcessSandboxBlocks(markdown ?? "");
    return sanitizeEditorHtml(marked.parse(preprocessed) as string);
}


/**
 * Escape text being interpolated into an HTML string literal.
 *
 * The highlight action wraps the current selection in <mark> by building markup
 * as a string, so a selection containing "<" or "&" — ordinary characters in
 * prose about code or contracts — would otherwise be parsed as markup rather
 * than highlighted as text.
 */
export function escapeHtmlText(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
