import { describe, it, expect } from "vitest";
import {
    panelHtml,
    expandHtml,
    statusHtml,
    isMacroElement,
    PANEL_CLASS,
    STATUS_CLASS,
    STATUS_DEFAULT_LABELS,
} from "./document-macros";
import { renderMarkdownToSafeHtml, sanitizeEditorHtml } from "./markdown-html";
import { createTurndownService } from "./editor-turndown";

/**
 * A macro is only real if it survives a save.
 *
 * The manuscript is stored as markdown, and the editor round-trips it through
 * marked -> DOMPurify -> (author edits) -> turndown -> markdown on every
 * autosave. A panel that renders beautifully but is stripped by the sanitizer,
 * or flattened by turndown, is a panel the author watches disappear. So these
 * assert the cycle, not the markup.
 */


/** One full autosave: markdown in, markdown out. */
function roundTrip(markdown: string): string {
    const html = renderMarkdownToSafeHtml(markdown);
    return createTurndownService().turndown(sanitizeEditorHtml(html)).trim();
}

describe("panels", () => {
    it("survives a full markdown round-trip", () => {
        const original = panelHtml("info", "Shelfie tracks two date types.");
        const after = roundTrip(original);

        expect(after).toContain(`${PANEL_CLASS}-info`);
        expect(after).toContain("Shelfie tracks two date types.");
        expect(after).toContain("Info");
    });

    it("keeps each kind distinguishable after the trip", () => {
        for (const kind of ["info", "note", "warning", "success"] as const) {
            expect(roundTrip(panelHtml(kind))).toContain(`${PANEL_CLASS}-${kind}`);
        }
    });

    it("is not stripped by the sanitizer that guards the editor", () => {
        // The whole macro approach depends on div+class being allowed.
        const html = sanitizeEditorHtml(panelHtml("warning", "Do not ship on a Friday."));
        expect(html).toContain(`${PANEL_CLASS}-warning`);
        expect(html).toContain("Do not ship on a Friday.");
    });

    it("escapes body text rather than letting it become markup", () => {
        const html = panelHtml("note", '</div><img src=x onerror="alert(1)">');
        expect(html).not.toContain("<img");
        expect(html).toContain("&lt;img");
        // And one panel element, not a broken pair.
        expect(html.match(/<div/g)).toHaveLength(1);
    });
});

describe("expand sections", () => {
    it("survives a round-trip with its summary intact", () => {
        const after = roundTrip(expandHtml("Assumptions", "Costs assume 3 engineers."));
        expect(after).toContain("<details");
        expect(after).toContain("<summary");
        expect(after).toContain("Assumptions");
        expect(after).toContain("Costs assume 3 engineers.");
    });

    it("emits the summary exactly once", () => {
        // The turndown rule must not fire for <summary> as well as <details>,
        // which would duplicate the title on every save.
        const after = roundTrip(expandHtml("Open Questions"));
        expect(after.match(/<summary/g)).toHaveLength(1);
        expect(after.match(/Open Questions/g)).toHaveLength(1);
    });

    it("is allowed through both sanitizers", () => {
        expect(sanitizeEditorHtml(expandHtml("T", "B"))).toContain("<details");
    });
});

describe("status lozenges", () => {
    it("survives a round-trip inline, without becoming a block", () => {
        const after = roundTrip(`Delivery is ${statusHtml("green", "Done")} for phase one.`);
        expect(after).toContain(`${STATUS_CLASS}-green`);
        expect(after).toContain("DONE");
        // Still one paragraph: a block-level result would break the sentence.
        expect(after).toContain("Delivery is");
        expect(after).toContain("for phase one.");
    });

    it("uppercases and defaults its label", () => {
        expect(statusHtml("red", "blocked")).toContain("BLOCKED");
        expect(statusHtml("grey", "  ")).toContain("STATUS");
    });

    it("labels states rather than colours", () => {
        expect(STATUS_DEFAULT_LABELS.green).toBe("Done");
        expect(STATUS_DEFAULT_LABELS.red).toBe("Blocked");
        expect(Object.values(STATUS_DEFAULT_LABELS)).not.toContain("green");
    });
});

describe("macro detection", () => {
    it("recognises macro roots and ignores ordinary prose", () => {
        const host = document.createElement("div");
        host.innerHTML = `${panelHtml("info")}<p>plain</p>${expandHtml()}`;

        expect(isMacroElement(host.querySelector(`.${PANEL_CLASS}`)!)).toBe(true);
        expect(isMacroElement(host.querySelector("details")!)).toBe(true);
        expect(isMacroElement(host.querySelector("p")!)).toBe(false);
        expect(isMacroElement(document.createTextNode("text"))).toBe(false);
    });
});

describe("ordinary markdown still round-trips", () => {
    it("leaves headings, lists and emphasis as markdown, not HTML", () => {
        // The macro rules must not turn the whole document into kept HTML.
        const after = roundTrip("# Title\n\n**bold** text\n\n- one\n- two\n");
        expect(after).toContain("# Title");
        expect(after).toContain("**bold**");
        expect(after).toContain("-   one");
        expect(after).not.toContain("<h1");
        expect(after).not.toContain("<strong>");
    });

    it("keeps GFM task lists as checkboxes", () => {
        const after = roundTrip("- [x] done\n- [ ] todo\n");
        expect(after).toContain("[x]");
        expect(after).toContain("[ ]");
    });
});
