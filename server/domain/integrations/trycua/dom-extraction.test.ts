/** @vitest-environment jsdom */

/**
 * Extraction reads the page in ONE pass. The version this replaced walked
 * Playwright locators, which is a CDP round trip per element — and per cell, so a
 * 100x20 table was ~2,000 sequential round trips.
 *
 * The evaluate callback is invoked here against jsdom, which is what it runs
 * against in the browser, so these also cover what each mode returns.
 */

import { describe, it, expect, vi } from "vitest";
import { extractDom, chooseExtractionPage } from "./dom-extraction.js";

/** A Page stand-in that runs the evaluate callback in-process, against jsdom. */
function pageWith(html: string, url = "https://example.com/list") {
    document.body.innerHTML = html;
    const evaluate = vi.fn(async (fn: any, args: any) => fn(args));
    return { page: { evaluate, url: () => url } as any, evaluate };
}

describe("extractDom", () => {
    it("reads every matching element in a single evaluate", async () => {
        const { page, evaluate } = pageWith("<ul>" + Array.from({ length: 40 }, (_, i) => `<li>Item ${i}</li>`).join("") + "</ul>");

        const results = await extractDom(page, { mode: "text", selector: "li" }) as string[];

        expect(evaluate).toHaveBeenCalledTimes(1);
        expect(results).toHaveLength(40);
        expect(results[0]).toBe("Item 0");
    });

    it("reads a whole table in a single evaluate", async () => {
        const rows = Array.from({ length: 30 }, (_, r) =>
            `<tr>${Array.from({ length: 6 }, (_, c) => `<td>r${r}c${c}</td>`).join("")}</tr>`).join("");
        const { page, evaluate } = pageWith(`<table>${rows}</table>`);

        const tables = await extractDom(page, { mode: "table", selector: "table" }) as string[][][];

        expect(evaluate).toHaveBeenCalledTimes(1);
        expect(tables[0]).toHaveLength(30);
        expect(tables[0][2][3]).toBe("r2c3");
    });

    it("honours the element limit", async () => {
        const { page } = pageWith(Array.from({ length: 10 }, (_, i) => `<p>${i}</p>`).join(""));
        expect(await extractDom(page, { mode: "text", selector: "p", limit: 3 })).toHaveLength(3);
    });

    it("returns the named attribute, and null where the element lacks it", async () => {
        const { page } = pageWith(`<a href="https://a.test">A</a><a>B</a>`);
        expect(await extractDom(page, { mode: "attribute", selector: "a", attribute: "href" }))
            .toEqual(["https://a.test", null]);
    });

    it("never returns a password field's value", async () => {
        const { page } = pageWith(`<input type="password" value="hunter2" aria-label="Password" />`);
        const [field] = await extractDom(page, { mode: "structured_json", selector: "input" }) as Array<Record<string, unknown>>;

        expect(field.value).toBeUndefined();
        expect(field.ariaLabel).toBe("Password");
    });

    it("needs a selector, and an attribute for attribute mode", async () => {
        const { page } = pageWith("<p>x</p>");
        await expect(extractDom(page, { mode: "text" })).rejects.toThrow(/selector/);
        await expect(extractDom(page, { mode: "attribute", selector: "p" })).rejects.toThrow(/attribute/);
    });

    it("answers url mode from the page, without touching the DOM", async () => {
        const { page, evaluate } = pageWith("<p>x</p>", "https://example.com/here");
        expect(await extractDom(page, { mode: "url" })).toBe("https://example.com/here");
        expect(evaluate).not.toHaveBeenCalled();
    });
});

describe("chooseExtractionPage", () => {
    const tab = (url: string) => ({ url: () => url });

    it("ignores blank and internal tabs", () => {
        const chosen = chooseExtractionPage([tab("about:blank"), tab("https://real.test/a"), tab("devtools://x")]);
        expect(chosen.page?.url()).toBe("https://real.test/a");
        expect(chosen.ambiguous).toBe(false);
    });

    it("says so when several tabs could have been meant", () => {
        const chosen = chooseExtractionPage([tab("https://a.test"), tab("https://b.test")]);
        expect(chosen.ambiguous).toBe(true);
        expect(chosen.candidates).toEqual(["https://a.test", "https://b.test"]);
    });

    it("takes the caller's hint over the tab order", () => {
        const chosen = chooseExtractionPage([tab("https://a.test/x"), tab("https://b.test/y")], "a.test");
        expect(chosen.page?.url()).toBe("https://a.test/x");
        expect(chosen.ambiguous).toBe(false);
    });

    it("reports no page when nothing matches the hint", () => {
        const chosen = chooseExtractionPage([tab("https://a.test")], "nowhere");
        expect(chosen.page).toBeUndefined();
        expect(chosen.candidates).toEqual(["https://a.test"]);
    });
});
