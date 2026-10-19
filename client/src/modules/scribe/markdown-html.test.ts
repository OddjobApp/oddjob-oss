import { describe, it, expect } from "vitest";
import { renderMarkdownToSafeHtml, sanitizeEditorHtml, escapeHtmlText } from "./markdown-html";

/**
 * Two obligations, and the second is the one that makes the first safe to keep:
 * the sanitizer has to strip the markup that executes, and it has to leave every
 * construct the ribbon and turndown round-trip through untouched. A sanitizer
 * that quietly eats tables would be reverted the first time an author lost one.
 */
describe("renderMarkdownToSafeHtml", () => {
    it("strips the event handlers that execute under innerHTML", () => {
        // <script> would not run via innerHTML anyway; these would.
        const html = renderMarkdownToSafeHtml(
            'Intro text\n\n<img src="x" onerror="alert(1)">\n\n<svg onload="alert(2)"></svg>',
        );
        expect(html).not.toMatch(/onerror/i);
        expect(html).not.toMatch(/onload/i);
        expect(html).not.toMatch(/<svg/i);
        expect(html).toContain("Intro text");
    });

    it("removes script, iframe and object markup", () => {
        const html = renderMarkdownToSafeHtml(
            'A\n\n<script>alert(1)</script>\n\n<iframe src="https://evil.example"></iframe>\n\n<object data="x"></object>',
        );
        expect(html).not.toMatch(/<script/i);
        expect(html).not.toMatch(/<iframe/i);
        expect(html).not.toMatch(/<object/i);
    });

    it("rejects javascript: and data: URLs but keeps real links and anchors", () => {
        const bad = renderMarkdownToSafeHtml("[click](javascript:alert(1))");
        expect(bad).not.toMatch(/javascript:/i);

        const good = renderMarkdownToSafeHtml("[docs](https://example.com/a) and [top](#overview)");
        expect(good).toContain('href="https://example.com/a"');
        expect(good).toContain('href="#overview"');
    });

    it("keeps the formatting the ribbon emits", () => {
        const html = renderMarkdownToSafeHtml(
            "# Heading\n\n**bold** and *italic* and ~~struck~~\n\n> quoted\n\n- one\n- two\n\n---\n",
        );
        expect(html).toContain("<h1");
        expect(html).toContain("<strong>");
        expect(html).toContain("<em>");
        expect(html).toContain("<del>");
        expect(html).toContain("<blockquote>");
        expect(html).toContain("<li>");
        expect(html).toContain("<hr");
    });

    it("keeps GFM tables, including the classes the table builder sets", () => {
        const html = renderMarkdownToSafeHtml("| Col 1 | Col 2 |\n|---|---|\n| A | B |\n");
        expect(html).toContain("<table");
        expect(html).toContain("<th");
        expect(html).toContain("<td");
        expect(html).toContain("A");

        const styled = sanitizeEditorHtml('<table class="w-full border-collapse"><tbody><tr><td>x</td></tr></tbody></table>');
        expect(styled).toContain('class="w-full border-collapse"');
    });

    it("keeps task-list checkboxes so turndown can read them back", () => {
        const html = renderMarkdownToSafeHtml("- [x] done\n- [ ] todo\n");
        expect(html).toContain("<input");
        expect(html).toContain("checkbox");
    });

    it("keeps <mark> highlights with their colour class", () => {
        const html = sanitizeEditorHtml('<p><mark class="bg-amber-400/30 text-foreground px-1 py-0.5 rounded">note</mark></p>');
        expect(html).toContain("<mark");
        expect(html).toContain("bg-amber-400/30");
        expect(html).toContain("note");
    });

    it("drops inline style without dropping the text it wrapped", () => {
        const html = sanitizeEditorHtml('<p style="position:fixed;top:0">visible prose</p>');
        expect(html).not.toContain("position:fixed");
        expect(html).toContain("visible prose");
    });

    it("survives empty and nullish content", () => {
        expect(renderMarkdownToSafeHtml("")).toBe("");
        expect(renderMarkdownToSafeHtml(undefined as unknown as string)).toBe("");
    });
});

describe("escapeHtmlText", () => {
    it("escapes a selection so it is highlighted as text, not parsed as markup", () => {
        expect(escapeHtmlText('a < b && c > d')).toBe("a &lt; b &amp;&amp; c &gt; d");
    });

    it("neutralises a selection that closes the mark element", () => {
        const escaped = escapeHtmlText('</mark><img src=x onerror=alert(1)>');
        expect(escaped).not.toContain("<img");
        expect(escaped).not.toContain("</mark>");
        // Interpolated into the wrapper, it stays inert text inside one <mark>:
        // "onerror" is still readable, because it is now prose rather than an
        // attribute on an element that was never created.
        const html = sanitizeEditorHtml(`<mark class="bg-amber-400/30">${escaped}</mark>`);
        expect(html).not.toContain("<img");
        expect(html).toContain("&lt;img");
        expect(html.match(/<mark/g)).toHaveLength(1);
    });
});
