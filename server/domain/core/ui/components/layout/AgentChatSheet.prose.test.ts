import { describe, it, expect } from "vitest";
import {
    stripRichPayloadFromProse,
    stripInternalScaffolding,
    parseSubmissionEcho,
    humanizeFieldKey,
    formatSubmittedValue,
} from "./AgentChatSheet";

/**
 * Regression coverage for raw JSON / internal scaffolding leaking into the
 * copilot transcript. The previous stripper used a lazy regex ending in `\}`,
 * which stopped at the first NESTED closing brace and left the payload's tail on
 * screen as prose.
 */

const MORTGAGE_FORM = JSON.stringify({
    type: "assistant_form",
    title: "Mortgage Calculator",
    description: "Enter the loan details to calculate your estimated monthly mortgage payment.",
    schema: {
        fields: [
            { key: "principal", label: "Loan Principal ($)", type: "number", required: true, defaultValue: "200000" },
            { key: "annualRate", label: "Annual Interest Rate (%)", type: "number", required: true, defaultValue: "4.5", format: "percent" },
            { key: "loanTermYears", label: "Loan Term (Years)", type: "number", required: true, defaultValue: "30" },
            { key: "monthlyPayment", label: "Estimated Monthly Payment", type: "computed", required: false, formula: "round(principal / loanTermYears, 2)", format: "currency" },
        ],
    },
});

const SURFACE = JSON.stringify({
    type: "instant_app_surface",
    title: "Instant App",
    note: "",
    layout: "grid",
    blocks: [
        { module: "PlatformFormBlock", componentName: "Form", props: {} },
        { module: "MetricGrid", componentName: "Metric Grid", props: {} },
    ],
});

describe("stripRichPayloadFromProse", () => {
    it("removes a nested assistant_form payload completely", () => {
        const out = stripRichPayloadFromProse("Here is your calculator.\n\n" + MORTGAGE_FORM);
        expect(out).toBe("Here is your calculator.");
        expect(out).not.toContain("annualRate");
        expect(out).not.toContain("{");
    });

    it("removes a nested instant_app_surface payload completely", () => {
        const out = stripRichPayloadFromProse("Assembled it below.\n\n" + SURFACE);
        expect(out).toBe("Assembled it below.");
        expect(out).not.toContain("MetricGrid");
    });

    it("leaves nothing behind when the payload is the entire message", () => {
        expect(stripRichPayloadFromProse(MORTGAGE_FORM)).toBe("");
        expect(stripRichPayloadFromProse(SURFACE)).toBe("");
    });

    it("strips the whole fenced block, not just the JSON inside it", () => {
        const out = stripRichPayloadFromProse("Done:\n\n```json\n" + MORTGAGE_FORM + "\n```\n\nAnything else?");
        expect(out).not.toContain("```");
        expect(out).not.toContain("principal");
        expect(out).toContain("Done:");
        expect(out).toContain("Anything else?");
    });

    it("does not mangle braces that appear inside string values", () => {
        const payload = JSON.stringify({
            type: "instant_app",
            module: "MetricGrid",
            note: "shows {count} of {total} — literal braces }{ here",
            props: { label: "a}b{c" },
        });
        const out = stripRichPayloadFromProse("Rendering.\n\n" + payload);
        expect(out).toBe("Rendering.");
    });

    it("preserves ordinary prose and unrelated JSON", () => {
        const text = "The config is {\"retries\": 3} and that's fine.";
        expect(stripRichPayloadFromProse(text)).toBe(text);
    });

    it("removes both a fenced and a bare payload in one message", () => {
        const out = stripRichPayloadFromProse("First:\n```json\n" + MORTGAGE_FORM + "\n```\nSecond:\n" + SURFACE);
        expect(out).not.toContain("{");
        expect(out).toContain("First:");
        expect(out).toContain("Second:");
    });
});

describe("stripInternalScaffolding", () => {
    it("removes the orchestrator verification marker and its context line", () => {
        const raw = "[Verification: FAILED] Here is the app.\nContext: Verification tool render_instant_app returned failure: Error: Invalid parameters for tool 'render_instant_app'. component: Required. Please correct the parameters and try again.";
        const out = stripInternalScaffolding(raw);
        expect(out).toBe("Here is the app.");
        expect(out).not.toContain("Verification");
        expect(out).not.toContain("render_instant_app");
    });

    it("removes a PASSED marker too", () => {
        expect(stripInternalScaffolding("[Verification: PASSED] All good.")).toBe("All good.");
    });

    it("leaves an ordinary message untouched", () => {
        expect(stripInternalScaffolding("Your cycle is ready to approve.")).toBe("Your cycle is ready to approve.");
    });

    it("does not eat the word Context in normal prose", () => {
        const text = "Context: the mission ran overnight.";
        expect(stripInternalScaffolding(text)).toBe(text);
    });
});

describe("parseSubmissionEcho", () => {
    it("recognises the form submission from the 08:45 screenshot", () => {
        const raw = 'Submitted assistant form:\n\n{ "principal": "1600000", "annualRate": "5.6", "loanTermYears": "15", "monthlyPayment": false }';
        const parsed = parseSubmissionEcho(raw);
        expect(parsed).not.toBeNull();
        expect(parsed!.title).toBe("Form submitted");
        expect(parsed!.values.principal).toBe("1600000");
    });

    it("recognises an input-request submission", () => {
        const parsed = parseSubmissionEcho('Submitted requested inputs for abc123:\n\n{"env":"prod"}');
        expect(parsed!.title).toBe("Inputs submitted");
        expect(parsed!.values.env).toBe("prod");
    });

    it("returns null for an ordinary message so it renders as text", () => {
        expect(parseSubmissionEcho("Submitted assistant form: it went fine")).toBeNull();
        expect(parseSubmissionEcho("What's the status of my cycle?")).toBeNull();
        expect(parseSubmissionEcho("Submitted assistant form:\n\n[1,2,3]")).toBeNull();
    });
});

describe("value + label presentation", () => {
    it("humanizes camelCase and snake_case keys", () => {
        expect(humanizeFieldKey("annualRate")).toBe("Annual Rate");
        expect(humanizeFieldKey("loanTermYears")).toBe("Loan Term Years");
        expect(humanizeFieldKey("monthly_payment")).toBe("Monthly Payment");
        expect(humanizeFieldKey("principal")).toBe("Principal");
    });

    it("renders values the way a person wrote them", () => {
        expect(formatSubmittedValue("1600000")).toBe("1,600,000");
        expect(formatSubmittedValue(1600000)).toBe("1,600,000");
        expect(formatSubmittedValue(true)).toBe("Yes");
        expect(formatSubmittedValue(false)).toBe("No");
        expect(formatSubmittedValue(["a", "b"])).toBe("a, b");
        expect(formatSubmittedValue("Acme Corp")).toBe("Acme Corp");
    });

    it("does not mangle an identifier that merely looks numeric-ish", () => {
        expect(formatSubmittedValue("v1.2.3")).toBe("v1.2.3");
        expect(formatSubmittedValue("2026-08-01")).toBe("2026-08-01");
    });

    it("keeps small decimals meaningful instead of rounding them to 0", () => {
        // A 4.5% annual rate as a monthly decimal. Fixed 2-digit precision printed
        // "0", which reads as a broken calculation.
        expect(formatSubmittedValue(0.00375)).toBe("0.00375");
        expect(formatSubmittedValue("0.00375")).toBe("0.00375");
        expect(formatSubmittedValue(0.05)).toBe("0.05");
        expect(formatSubmittedValue(13158.39)).toBe("13,158.39");
        expect(formatSubmittedValue(0)).toBe("0");
    });
});

describe("the two together (what the message body actually renders)", () => {
    it("cleans the exact failure from the 08:00 screenshot", () => {
        const raw =
            "[Verification: FAILED] " + SURFACE +
            "\nContext: Verification tool render_instant_app returned failure: Error: Invalid parameters for tool 'render_instant_app'. component: Required. Please correct the parameters and try again.";
        const out = stripInternalScaffolding(stripRichPayloadFromProse(raw));
        expect(out).toBe("");
    });

    it("cleans the exact failure from the 08:45 screenshot", () => {
        const raw = MORTGAGE_FORM;
        const out = stripInternalScaffolding(stripRichPayloadFromProse(raw));
        expect(out).toBe("");
        expect(out).not.toContain('"key":"annualRate"');
    });
});
