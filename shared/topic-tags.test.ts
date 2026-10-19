import { describe, expect, it } from "vitest";
import {
    MAX_TOPIC_TAGS_PER_TURN,
    extractTopicTags,
    normalizeTagLabel,
    stripTopicTags,
} from "./topic-tags.js";

describe("topic-tags", () => {
    describe("normalizeTagLabel", () => {
        it("title-cases and space-normalizes", () => {
            expect(normalizeTagLabel("q4-launch")).toBe("Q4 Launch");
            expect(normalizeTagLabel("vendor_a")).toBe("Vendor A");
            expect(normalizeTagLabel("pricing")).toBe("Pricing");
            expect(normalizeTagLabel("  multi   space  ")).toBe("Multi Space");
        });
    });

    describe("extractTopicTags", () => {
        it("extracts bare single-word tags", () => {
            const tags = extractTopicTags("Compare #pricing and #billing");
            expect(tags.map((t) => t.label)).toEqual(["Pricing", "Billing"]);
        });

        it("extracts bracketed multi-word tags", () => {
            const tags = extractTopicTags("compare #[vendor a] to #[Vendor B]");
            expect(tags.map((t) => t.label)).toEqual(["Vendor A", "Vendor B"]);
            expect(tags[0].raw).toBe("vendor a");
        });

        it("mixes both forms", () => {
            const tags = extractTopicTags("Discuss #[Q4 Launch] under #budget");
            expect(tags.map((t) => t.label)).toEqual(["Q4 Launch", "Budget"]);
        });

        it("dedupes case-insensitively on the normalized label", () => {
            const tags = extractTopicTags("#Pricing #PRICING #[pricing]");
            expect(tags).toHaveLength(1);
            expect(tags[0].label).toBe("Pricing");
        });

        it("normalizes #-and-underscore variants to the same label", () => {
            const tags = extractTopicTags("#q4_launch #[Q4 Launch]");
            expect(tags).toHaveLength(1);
        });

        it("requires a word boundary before #", () => {
            expect(extractTopicTags("see#pricing for details")).toHaveLength(0);
            expect(extractTopicTags("email me at x#y")).toHaveLength(0);
        });

        it("ignores tags inside fenced code and inline code", () => {
            const fenced = extractTopicTags("run ```\n#not-a-tag\n``` then #real");
            expect(fenced.map((t) => t.label)).toEqual(["Real"]);
            const inline = extractTopicTags("use `#fake` but tag #real");
            expect(inline.map((t) => t.label)).toEqual(["Real"]);
        });

        it("ignores URL fragments", () => {
            const tags = extractTopicTags("see https://x.test/a#frag and #real");
            expect(tags.map((t) => t.label)).toEqual(["Real"]);
        });

        it("ignores @mentions adjacent to #", () => {
            // "x@y.com #z" — the @mention masks @y, #z still parses.
            const tags = extractTopicTags("mail bob@corp.com about #pricing");
            expect(tags.map((t) => t.label)).toEqual(["Pricing"]);
        });

        it("rejects pure hex colors", () => {
            expect(extractTopicTags("use color #abc123")).toHaveLength(0);
            expect(extractTopicTags("use color #fff")).toHaveLength(0);
        });

        it("markdown headings are not tags", () => {
            expect(extractTopicTags("# Heading\nbody #tag")).toHaveLength(1);
        });

        it("keeps the tag inside a bracket when spaces are used", () => {
            const tags = extractTopicTags("note #[vendor a] end");
            expect(tags).toHaveLength(1);
            expect(tags[0].start).toBe(5);
            expect(tags[0].end).toBe(16);
        });

        it("caps extraction at MAX_TOPIC_TAGS_PER_TURN", () => {
            const text = Array.from({ length: 20 }, (_, i) => `#tag${i}`).join(" ");
            expect(extractTopicTags(text)).toHaveLength(MAX_TOPIC_TAGS_PER_TURN);
        });

        it("returns [] for empty/garbage input", () => {
            expect(extractTopicTags("")).toEqual([]);
            expect(extractTopicTags("no tags here")).toEqual([]);
        });
    });

    describe("stripTopicTags", () => {
        it("removes both tag forms and collapses whitespace", () => {
            expect(stripTopicTags("compare #[vendor a] to #vendor-b now"))
                .toBe("compare to now");
        });

        it("leaves hex colors and code untouched", () => {
            const code = "color #abc123 and ```#code```";
            expect(stripTopicTags(code)).toBe(code);
        });

        it("returns trimmed text when no tags", () => {
            expect(stripTopicTags("  hello  ")).toBe("hello");
        });
    });
});
