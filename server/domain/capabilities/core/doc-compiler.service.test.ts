import { describe, it, expect, vi } from "vitest";

import { type CapabilityManifest } from "@shared/schema/capabilities/index.js";
import { DocCompilerService, sanitize, renderFallback } from "./doc-compiler.service.js";

function makeManifest(overrides: Partial<CapabilityManifest> = {}): CapabilityManifest {
    return {
        schema_version: 1,
        capability_version: "1.0.0",
        capability_id: "extract_invoice_rows",
        metadata: {
            display_name: "Extract Invoice Rows",
            category: "Financial Operations",
            description: "Extract line items from an invoice image.",
            owner: "data-team",
        },
        technical_spec: { inputs: { image_url: "str" }, outputs: { rows: "list" } },
        documentation_meta: {
            summary: "Turns invoice images into structured rows.",
            business_use_cases: ["Accounts payable automation"],
            guardrails: ["Never store raw card numbers"],
        },
        runtime_context: { risk_profile: "High", execution_environment: "Isolated Docker Container", dependencies: [] },
        ...overrides,
    };
}

describe("sanitize", () => {
    it("strips a wrapping ```markdown fence", () => {
        const raw = "```markdown\n# Title\n\nBody.\n```";
        expect(sanitize(raw)).toBe("# Title\n\nBody.");
    });

    it("drops leading conversational chatter before the first heading", () => {
        const raw = "Here is your documentation:\n\n# Title\n\nBody.";
        expect(sanitize(raw)).toBe("# Title\n\nBody.");
    });
});

describe("renderFallback", () => {
    it("renders skeleton with metadata callout, tables and guardrail warning", () => {
        const md = renderFallback(makeManifest());
        expect(md).toContain("# 💳 Extract Invoice Rows");
        expect(md).toContain("**Capability ID:** `extract_invoice_rows`");
        expect(md).toContain("| Name | Type |");
        expect(md).toContain("| `image_url` | `str` |");
        expect(md).toContain("> [!WARNING]");
        expect(md).toContain("Never store raw card numbers");
        expect(md).toContain("- Accounts payable automation");
        expect(md.endsWith("\n")).toBe(true);
    });

    it("renders a NOTE callout when there are no guardrails", () => {
        const md = renderFallback(
            makeManifest({ documentation_meta: { summary: "", business_use_cases: [], guardrails: [] } }),
        );
        expect(md).toContain("> [!NOTE]");
        expect(md).toContain("No explicit guardrails declared.");
    });
});

describe("DocCompilerService.compile", () => {
    it("renders deterministically by default, without calling the model", async () => {
        // These docs are committed and recompiled on every sync. A model does not
        // emit byte-identical Markdown twice, so the LLM path rewrote all ~166 of
        // them on every run. Deterministic is the default; the LLM is opt-in.
        const generate = vi.fn(async () => "# 🤖 Something The Model Made Up");
        const compiler = new DocCompilerService({ generate });
        const out = await compiler.compile(makeManifest());
        expect(generate).not.toHaveBeenCalled();
        expect(out).toBe(renderFallback(makeManifest()));
    });

    it("is byte-identical across repeated compiles", async () => {
        const compiler = new DocCompilerService();
        const a = await compiler.compile(makeManifest());
        const b = await compiler.compile(makeManifest());
        expect(a).toBe(b);
    });

    it("uses the sanitised LLM output when generation succeeds", async () => {
        const generate = vi.fn(async () => "```markdown\n# 💳 Extract Invoice Rows\n\nGenerated body.\n```");
        const compiler = new DocCompilerService({ generate, useLlm: true });
        const out = await compiler.compile(makeManifest());
        expect(generate).toHaveBeenCalledOnce();
        expect(out).toBe("# 💳 Extract Invoice Rows\n\nGenerated body.");
    });

    it("falls back deterministically when generation returns null", async () => {
        const compiler = new DocCompilerService({ generate: vi.fn(async () => null), useLlm: true });
        const out = await compiler.compile(makeManifest());
        expect(out).toContain("# 💳 Extract Invoice Rows");
        expect(out).toContain("| `rows` | `list` |");
    });

    it("falls back deterministically when generation throws", async () => {
        const compiler = new DocCompilerService({
            generate: vi.fn(async () => {
                throw new Error("model offline");
            }),
            useLlm: true,
        });
        const out = await compiler.compile(makeManifest());
        expect(out).toContain("# 💳 Extract Invoice Rows");
    });
});

describe("overview de-duplication", () => {
    it("prints the overview paragraph once when summary repeats the description", async () => {
        // The tool registry and the pipeline canvas both set summary to the
        // description, so this was every code-generated page.
        const manifest = makeManifest({
            metadata: {
                display_name: "HTTP Query",
                category: "Web & Browser",
                description: "Fetch a live API endpoint.",
                owner: "platform",
            },
            documentation_meta: {
                summary: "Fetch a live API endpoint.",
                business_use_cases: [],
                guardrails: [],
            },
        });

        const markdown = await new DocCompilerService({ useLlm: false }).compile(manifest);
        const occurrences = markdown.split("Fetch a live API endpoint.").length - 1;
        expect(occurrences).toBe(1);
    });

    it("still renders a summary that adds something", async () => {
        const manifest = makeManifest({
            metadata: {
                display_name: "HTTP Query",
                category: "Web & Browser",
                description: "Fetch a live API endpoint.",
                owner: "platform",
            },
            documentation_meta: {
                summary: "Used by the weather and currency surfaces.",
                business_use_cases: [],
                guardrails: [],
            },
        });

        const markdown = await new DocCompilerService({ useLlm: false }).compile(manifest);
        expect(markdown).toContain("Fetch a live API endpoint.");
        expect(markdown).toContain("Used by the weather and currency surfaces.");
    });
});
