import type { Page } from "playwright";

export type DomExtractMode = "text" | "attribute" | "full_page_text" | "structured_json" | "table" | "url";

export interface DomExtractOptions {
    mode: DomExtractMode;
    selector?: string;
    attribute?: string;
    limit?: number;
}

/** One element's worth of structured_json. */
export interface StructuredElement {
    text: string;
    href?: string;
    src?: string;
    value?: string;
    ariaLabel?: string;
}

const MAX_ELEMENTS = 500;
const MAX_CHARS = 10_000;
const MAX_PAGE_CHARS = 100_000;
const MAX_TABLE_ROWS = 500;
const MAX_TABLE_CELLS = 100;

/**
 * Shared by the CDP tool and learned skills: extract from the authenticated
 * desktop tab.
 *
 * Every mode runs as ONE page.evaluate. Reading through Playwright locators
 * instead cost a CDP round trip per element — and per cell, so a 100x20 table
 * was ~2,000 sequential round trips, seconds of wall clock for a page the
 * browser can walk in one pass.
 */
export async function extractDom(page: Page, options: DomExtractOptions): Promise<unknown> {
    if (options.mode === "url") return page.url();

    if (options.mode === "full_page_text") {
        return page.evaluate(
            (max) => ((document.body as HTMLElement | null)?.innerText ?? "").slice(0, max),
            MAX_PAGE_CHARS,
        );
    }

    if (!options.selector) throw new Error("Extraction requires a selector");
    if (options.mode === "attribute" && !options.attribute) throw new Error("Extraction requires an attribute");

    const limit = Math.min(Math.max(options.limit ?? 50, 1), MAX_ELEMENTS);
    const args = {
        selector: options.selector,
        attribute: options.attribute ?? "",
        mode: options.mode,
        limit,
        maxChars: MAX_CHARS,
        maxRows: MAX_TABLE_ROWS,
        maxCells: MAX_TABLE_CELLS,
    };

    return page.evaluate((input) => {
        const clip = (value: string | null | undefined) => (value ?? "").trim().slice(0, input.maxChars);
        const textOf = (el: Element) => clip((el as HTMLElement).innerText ?? el.textContent);
        const elements = Array.from(document.querySelectorAll(input.selector)).slice(0, input.limit);

        if (input.mode === "text") return elements.map(textOf);

        if (input.mode === "attribute") {
            return elements.map((el) => {
                const value = el.getAttribute(input.attribute);
                return value === null ? null : value.slice(0, input.maxChars);
            });
        }

        if (input.mode === "table") {
            return elements.map((table) =>
                Array.from(table.querySelectorAll("tr"))
                    .slice(0, input.maxRows)
                    .map((row) => Array.from(row.querySelectorAll("th,td")).slice(0, input.maxCells).map(textOf)),
            );
        }

        // structured_json. A password field's value never leaves the page: the
        // recorder refuses to capture secrets, and extraction must not be the
        // way around that.
        return elements.map((el) => {
            const input_ = el as HTMLInputElement;
            const isSecret = input_.type === "password";
            return {
                text: textOf(el),
                href: el.getAttribute("href") ?? undefined,
                src: el.getAttribute("src") ?? undefined,
                value: isSecret || typeof input_.value !== "string" ? undefined : clip(input_.value) || undefined,
                ariaLabel: el.getAttribute("aria-label") ?? undefined,
            };
        });
    }, args);
}

/**
 * The tab to extract from.
 *
 * Under Xvfb every tab reports itself visible and focused, and the DevTools
 * target list is not ordered by recency, so "the active tab" cannot be read
 * from the browser. Rather than guess silently, this prefers a caller's URL
 * hint, ignores blank and internal pages, and reports every candidate so the
 * result says which page the extract came from.
 */
export function chooseExtractionPage<T extends { url(): string }>(
    pages: T[],
    urlHint?: string,
): { page?: T; candidates: string[]; ambiguous: boolean } {
    const real = pages.filter((p) => /^https?:/i.test(p.url()));
    const candidates = real.map((p) => p.url());
    const hint = urlHint?.trim().toLowerCase();

    if (hint) {
        const matched = real.filter((p) => p.url().toLowerCase().includes(hint));
        return { page: matched[matched.length - 1], candidates, ambiguous: matched.length > 1 };
    }

    return { page: real[real.length - 1], candidates, ambiguous: real.length > 1 };
}
