import { describe, it, expect } from "vitest";

/**
 * A diagram in a crew room rendered as raw syntax with "Showing Mermaid syntax
 * overview", and the "Visual Diagram" button did nothing when clicked.
 *
 * Two faults. The chart genuinely failed to parse, and the toggle was inert because
 * the view is chosen by `showCode || error` — with error set, flipping showCode could
 * not reach the diagram branch.
 *
 * This pins the parse half against mermaid itself: agent-authored labels routinely
 * embed double quotes, which are a mermaid parse error.
 */
const AUTHORED = [
    "graph TD",
    '    A[CI/CD Cost Calculator Intake App] --> B{Extract & Validate Ingestion Payload};',
    "    B --> C{Execute Business Logic & Calculations};",
    '    C --> D[Persist Records to Dataset "ci_cd_cost_calculator_records"];',
    "    D --> E[Project Space: oddjob-system];",
].join("\n");

/** Mirrors sanitizeMermaidChart's quote and parens handling in MermaidRenderer.tsx. */
function sanitizeMermaidChart(chart: string): string {
    return chart
        // First, handle bracketed node labels [ ... ] which can contain internal parentheses or quotes
        .replace(/\[([^\[\]]+)\]/g, (match, body) => {
            let newBody = body;
            if (newBody.includes('"')) {
                newBody = newBody.replace(/"/g, "\u201C");
            }
            if (newBody.includes("(") || newBody.includes(")")) {
                newBody = newBody.replace(/\(/g, "（").replace(/\)/g, "）");
            }
            return `[${newBody}]`;
        })
        // Next, handle other node shapes: ( ... ), { ... }, (( ... )), etc.
        .replace(/(\{|\()([^\[\]{}()]*)(\}|\))/g, (match, open, body, close) => {
            let newBody = body;
            if (newBody.includes('"')) {
                newBody = newBody.replace(/"/g, "\u201C");
            }
            return `${open}${newBody}${close}`;
        });
}

const AUTHORED_WITH_PARENS = [
    "graph TD",
    "    Discovery --> ZOPA[3. Zone of Possible Agreement (ZOPA) Calculation]",
    "    ZOPA -->|No Overlap| WalkAway[Walk Away / Escalate to Human]",
].join("\n");

describe("mermaid label sanitisation", () => {
    it("the chart as the agent wrote it does NOT parse", async () => {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({ startOnLoad: false, securityLevel: "loose" });
        await expect(mermaid.parse(AUTHORED)).rejects.toBeTruthy();
    });

    it("the chart with inner parens in bracketed node does NOT parse", async () => {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({ startOnLoad: false, securityLevel: "loose" });
        await expect(mermaid.parse(AUTHORED_WITH_PARENS)).rejects.toBeTruthy();
    });

    it("parses once embedded label quotes are neutralised", async () => {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({ startOnLoad: false, securityLevel: "loose" });
        await expect(mermaid.parse(sanitizeMermaidChart(AUTHORED))).resolves.toBeTruthy();
    });

    it("parses once embedded parens in bracketed labels are neutralised", async () => {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({ startOnLoad: false, securityLevel: "loose" });
        await expect(mermaid.parse(sanitizeMermaidChart(AUTHORED_WITH_PARENS))).resolves.toBeTruthy();
    });

    it("keeps the label readable rather than deleting the text", () => {
        const out = sanitizeMermaidChart(AUTHORED);
        expect(out).toContain("ci_cd_cost_calculator_records");
        expect(out).not.toContain('"ci_cd_cost_calculator_records"');
    });

    it("leaves ampersands alone, which parse fine on their own", () => {
        const out = sanitizeMermaidChart(AUTHORED);
        expect(out).toContain("Extract & Validate Ingestion Payload");
    });

    it("does not touch a chart that has no embedded quotes or parens", () => {
        const clean = "graph TD\n    A[One] --> B[Two];";
        expect(sanitizeMermaidChart(clean)).toBe(clean);
    });
});
