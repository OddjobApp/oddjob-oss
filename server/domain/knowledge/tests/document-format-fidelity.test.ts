/**
 * Document format fidelity.
 *
 * Every case here is a defect that shipped and was found by executing the code
 * rather than reading it, so each test states the wrong behaviour it prevents.
 * The common thread is truthfulness: a document must contain what was gathered,
 * a format must be the format it claims, and a phase must not report work it
 * did not do.
 */
import { describe, it, expect, vi } from "vitest";
import {
    presentationAssemblyService,
    extractMetrics,
    contrastRatio,
    auditThemeContrast,
    jsonToMarkdown,
} from "../core/presentation-assembly.service.js";
import { PREBUILT_PRESENTATION_THEMES } from "@shared/schema/document-block.schema.js";

const FORMATS = ["presentation_deck", "magazine_ad", "whitepaper", "executive_brief"] as const;

const SOURCE = `# Mission Status
Active missions total 7, with 2 blocked on human approval.
- Spatial Signal Rollout is 82% complete
- Q3 Compliance Audit is blocked awaiting sign-off
- Data Retention Review starts Monday
# Spend
Current month spend is $284.17 against a $500.00 cap.`;

const compile = (format: (typeof FORMATS)[number], src = SOURCE) =>
    presentationAssemblyService.compileToWebDeck(
        presentationAssemblyService.distillContentToBlockAST(src, "Status Brief", format, "dark_cyberpunk", false),
    );

describe("declared formats are distinct documents", () => {
    // whitepaper and executive_brief used to compile to markup byte-identical
    // to presentation_deck: the enum accepted them, the AST stored the label,
    // and nothing rendered it. Asking for a whitepaper returned a slide deck.
    it("renders four different documents from one source", () => {
        const outputs = FORMATS.map((f) => compile(f));
        expect(new Set(outputs).size).toBe(4);
    });

    it.each(FORMATS)("%s marks its own format on the document body", (format) => {
        expect(compile(format)).toContain(`<body class="format-${format}">`);
    });

    it("gives the whitepaper prose sections and the brief a card grid", () => {
        expect(compile("whitepaper")).toContain("doc-section-title");
        expect(compile("whitepaper")).not.toContain("SLIDE 1");
        expect(compile("executive_brief")).toContain("brief-grid");
    });
});

describe("no format discards source content", () => {
    // The magazine block kept bodyText and the first bullet (as a pull-quote
    // that the hero image then hid anyway) and dropped every other bullet.
    it.each(FORMATS)("%s carries every gathered fact", (format) => {
        const html = compile(format);
        for (const fact of ["7", "82%", "Q3 Compliance Audit", "Data Retention Review", "$284.17", "$500.00"]) {
            expect(html, `${format} dropped "${fact}"`).toContain(fact);
        }
    });
});

describe("an empty gather is reported, not padded", () => {
    // This branch used to inject "99.4% Synthesis Accuracy", "10x Delivery
    // Velocity" and "0 Manual Formatting Overhead" — literals chosen to make an
    // empty deck look full, rendered identically to figures that were measured.
    it.each(["", "   ", "\n\n"])("does not invent metrics for input %j", (input) => {
        const html = compile("presentation_deck", input);
        for (const fabricated of ["99.4%", "10x", "Synthesis Accuracy", "Delivery Velocity", "Manual Formatting Overhead"]) {
            expect(html, `fabricated "${fabricated}" reappeared`).not.toContain(fabricated);
        }
    });

    it("says plainly that nothing was gathered", () => {
        expect(compile("presentation_deck", "")).toContain("No content was gathered");
    });
});

describe("JSON tool output is structured, not dumped", () => {
    const health = JSON.stringify({ status: "DEGRADED", totalFailedJobs: 11, queues: { steps: { waiting: 0, failed: 3 } } });

    it("humanises keys and keeps values", () => {
        const html = compile("presentation_deck", health);
        expect(html).toContain("Total Failed Jobs");
        expect(html).toContain("11");
        expect(html).toContain("DEGRADED");
    });

    it("does not leave raw JSON in the document body", () => {
        expect(compile("presentation_deck", health)).not.toContain('"totalFailedJobs":');
    });

    it("leaves non-JSON input alone", () => {
        expect(jsonToMarkdown("# Just markdown")).toBeNull();
        expect(jsonToMarkdown("{not json at all")).toBeNull();
    });
});

describe("metric extraction reports only what is present", () => {
    it("finds figures that are in the text", () => {
        const values = extractMetrics(SOURCE).map((m) => m.value);
        expect(values).toContain("$284.17");
        expect(values).toContain("82%");
    });

    it("finds nothing in prose that has no figures", () => {
        expect(extractMetrics("A qualitative summary with no numbers in it at all.")).toEqual([]);
    });
});

describe("contrast auditing actually measures", () => {
    // The Brand Guardian phase asserted "Verified WCAG contrast standards"
    // while executing no code. A checker that cannot fail is the same defect,
    // so this pins both the reference values and a real failing theme.
    it("matches WCAG reference ratios", () => {
        expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
        expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 2);
        expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 1);
    });

    it("returns null rather than guessing at unparseable colours", () => {
        expect(contrastRatio("rgba(0,0,0,0.1)", "#ffffff")).toBeNull();
    });

    it("distinguishes a compliant theme from a non-compliant one", () => {
        const clean = auditThemeContrast(PREBUILT_PRESENTATION_THEMES["clean_minimalist"]);
        const vibrant = auditThemeContrast(PREBUILT_PRESENTATION_THEMES["vibrant_product"]);
        expect(clean.every((c) => c.passesAA)).toBe(true);
        expect(vibrant.some((c) => !c.passesAA)).toBe(true);
    });
});

describe("generation failures surface as failures", () => {
    // Returning `Error generating X: ...` as the tool's output made a crash
    // indistinguishable from success to the CREW executor, which recorded
    // ok:true and handed the model a string it read as a result.
    it("throws instead of returning an error string", async () => {
        vi.resetModules();
        vi.doMock("@domain/crew/core/presentation-crew.service.js", () => ({
            presentationCrewService: {
                orchestrateCreativeCrew: vi.fn(async () => {
                    throw new Error("renderer exploded");
                }),
            },
        }));

        const { GENERATION_TOOLS } = await import("@domain/tools/v1/capabilities/generation.js");
        await expect(
            GENERATION_TOOLS.generate_presentation_deck.execute(
                { title: "T", content: "c", themeId: "dark_cyberpunk", formatCategory: "presentation_deck" },
                { organizationId: 1, userId: "u" } as any,
            ),
        ).rejects.toThrow(/renderer exploded/);

        vi.doUnmock("@domain/crew/core/presentation-crew.service.js");
    });
});
