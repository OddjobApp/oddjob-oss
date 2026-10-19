import { describe, expect, it } from "vitest";
import { capToolOutput, MAX_TOOL_OUTPUT_CHARS } from "./crew-tools.service.js";

/** A catalogue shaped like list_installed_apps, big enough to need capping. */
function catalogue(n: number) {
    return JSON.stringify({
        items: Array.from({ length: n }, (_, i) => ({
            slug: `app-${i}`,
            title: `Application Number ${i}`,
            description: "x".repeat(220),
            source: "app",
            availability: "advertised",
            href: `/armory/apps/${700 + i}`,
        })),
    });
}

describe("capToolOutput", () => {
    it("leaves a small result exactly as it was", () => {
        const small = JSON.stringify({ items: [{ slug: "a" }] });
        expect(capToolOutput(small)).toBe(small);
    });

    it("keeps truncated JSON parseable", () => {
        // The old character slice cut mid-object, so the agent could not read
        // even the entries it did receive.
        const capped = capToolOutput(catalogue(57));
        expect(capped.length).toBeLessThanOrEqual(MAX_TOOL_OUTPUT_CHARS);
        expect(() => JSON.parse(capped)).not.toThrow();
    });

    it("reports the TRUE total, not the number it kept", () => {
        // The defect this exists to prevent: 7 of 57 presented as the catalogue.
        const parsed = JSON.parse(capToolOutput(catalogue(57)));
        expect(parsed._truncated.total).toBe(57);
        expect(parsed._truncated.shown).toBeLessThan(57);
        expect(parsed.items).toHaveLength(parsed._truncated.shown);
        expect(parsed._truncated.note).toMatch(/57/);
    });

    it("keeps whole items, never a fragment of one", () => {
        const parsed = JSON.parse(capToolOutput(catalogue(57)));
        for (const item of parsed.items) {
            expect(item.slug).toBeTruthy();
            expect(item.href).toBeTruthy();
        }
    });

    it("keeps the front of the list, which is the ranked part", () => {
        const parsed = JSON.parse(capToolOutput(catalogue(57)));
        expect(parsed.items[0].slug).toBe("app-0");
    });

    it("preserves sibling fields alongside the trimmed list", () => {
        const withHints = JSON.stringify({
            items: JSON.parse(catalogue(57)).items,
            _disambiguationHint: "two apps share a name",
        });
        const parsed = JSON.parse(capToolOutput(withHints));
        expect(parsed._disambiguationHint).toBe("two apps share a name");
    });

    it("handles a bare top-level array", () => {
        const bare = JSON.stringify(JSON.parse(catalogue(57)).items);
        const parsed = JSON.parse(capToolOutput(bare));
        expect(parsed._truncated.total).toBe(57);
        expect(Array.isArray(parsed.items)).toBe(true);
    });

    it("marks a long non-JSON result as truncated rather than cutting silently", () => {
        const prose = "y".repeat(MAX_TOOL_OUTPUT_CHARS + 500);
        const capped = capToolOutput(prose);
        expect(capped).toMatch(/TRUNCATED: 500 more characters/);
        expect(capped).toMatch(/do not present what you see as complete/i);
    });

    it("does not truncate JSON that has no list to trim", () => {
        // A big single object cannot be trimmed by item; it takes the text path
        // and still says it was cut.
        const blob = JSON.stringify({ body: "z".repeat(MAX_TOOL_OUTPUT_CHARS + 100) });
        expect(capToolOutput(blob)).toMatch(/TRUNCATED/);
    });

    it("survives an empty list without looping", () => {
        const empty = JSON.stringify({ items: [], filler: "q".repeat(MAX_TOOL_OUTPUT_CHARS + 10) });
        expect(capToolOutput(empty)).toMatch(/TRUNCATED/);
    });
});

describe("capToolOutput — awareness of what was dropped", () => {
    it("names every omitted item, so nothing is invisible", () => {
        // The point of the whole change: an agent asked "what apps are there?"
        // must be able to answer completely, even holding full records for only
        // a few. Several of these tools take no arguments, so there is no page
        // two to ask for.
        const parsed = JSON.parse(capToolOutput(catalogue(57)));
        const shown = parsed._truncated.shown;
        expect(parsed._truncated.alsoAvailable).toHaveLength(57 - shown);
        expect(parsed._truncated.alsoAvailable).toContain("Application Number 56");
    });

    it("does not repeat an item in both the detail and the name list", () => {
        const parsed = JSON.parse(capToolOutput(catalogue(57)));
        const shownTitles = parsed.items.map((i: any) => i.title);
        for (const name of parsed._truncated.alsoAvailable) {
            expect(shownTitles).not.toContain(name);
        }
    });

    it("labels items by whatever naming field they carry", () => {
        const mixed = JSON.stringify({
            items: [
                ...Array.from({ length: 40 }, (_, i) => ({ name: `named-${i}`, blob: "b".repeat(200) })),
                { slug: "slug-only", blob: "b".repeat(200) },
            ],
        });
        const parsed = JSON.parse(capToolOutput(mixed));
        expect(parsed._truncated.alsoAvailable).toContain("slug-only");
    });

    it("skips unlabelable entries rather than emitting [object Object]", () => {
        const junk = JSON.stringify({
            items: Array.from({ length: 60 }, () => ({ blob: "b".repeat(200) })),
        });
        const parsed = JSON.parse(capToolOutput(junk));
        expect(parsed._truncated.alsoAvailable).toEqual([]);
        expect(capToolOutput(junk)).not.toContain("[object Object]");
    });
});
