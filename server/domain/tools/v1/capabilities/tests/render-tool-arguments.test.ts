import { describe, expect, it } from "vitest";
import { ASSEMBLY_TOOLS } from "../assembly-tools.js";
import { RENDER_TOOLS } from "../render-tools.js";

/**
 * Both of these failed repeatedly in live crew rooms with "invalid arguments",
 * and the agent then spent its turn narrating the failure instead of retrying.
 * The calls were reasonable descriptions of the thing being built — a pipeline
 * whose steps have names but no ids and statuses like "completed", and an
 * intake form with a transaction date — that the schemas happened to forbid.
 */

describe("render_workflow_diagram argument tolerance", () => {
    const tool = ASSEMBLY_TOOLS.render_workflow_diagram;

    it("accepts stages that carry no explicit id", async () => {
        const parsed = tool.parameters.safeParse({
            stages: [
                { name: "Extract Payload", status: "completed" },
                { name: "Evaluate Tip", status: "in_progress", dependsOn: ["Extract Payload"] },
            ],
        });
        expect(parsed.success, JSON.stringify((parsed as any).error?.issues)).toBe(true);
    });

    it("accepts the wider status vocabulary models actually use", async () => {
        for (const status of ["pending", "in_progress", "running", "completed", "done", "failed"]) {
            const parsed = tool.parameters.safeParse({ stages: [{ name: "A step", status }] });
            expect(parsed.success, `status "${status}" should be accepted`).toBe(true);
        }
    });

    it("maps every accepted status onto a declared Mermaid class", async () => {
        const parsed = tool.parameters.parse({
            stages: [
                { name: "One", status: "completed" },
                { name: "Two", status: "pending", dependsOn: ["One"] },
                { name: "Three", status: "running" },
            ],
        });
        const result: any = await tool.execute(parsed, {} as any);

        expect(result.success).toBe(true);
        // An unmapped status would emit `:::completed`, which has no classDef
        // and renders unstyled.
        const classes = [...String(result.chart).matchAll(/:::(\w+)/g)].map((m) => m[1]);
        expect(new Set(classes)).toEqual(new Set(["ready", "blocked", "active"]));
        // The derived ids must still connect the dependency edge.
        expect(result.chart).toContain("One --> Two");
    });

    it("still refuses a call carrying neither stages nor code", async () => {
        const parsed = tool.parameters.parse({});
        const result: any = await tool.execute(parsed, {} as any);
        expect(result.success).toBe(false);
    });
});

describe("render_intake_form field types", () => {
    const tool = RENDER_TOOLS.render_intake_form;

    it("accepts a date field", () => {
        const parsed = tool.parameters.safeParse({
            title: "Tip Calculator",
            fields: [
                { key: "bill", label: "Bill Amount", type: "number" },
                { key: "date", label: "Date", type: "date" },
            ],
        });
        expect(parsed.success, JSON.stringify((parsed as any).error?.issues)).toBe(true);
    });

    it("accepts datetime and time fields", () => {
        for (const type of ["datetime", "time"]) {
            const parsed = tool.parameters.safeParse({
                title: "Booking",
                fields: [{ key: "when", label: "When", type }],
            });
            expect(parsed.success, `type "${type}" should be accepted`).toBe(true);
        }
    });

    it("rejects a type the renderer cannot draw, rather than silently blanking", () => {
        const parsed = tool.parameters.safeParse({
            title: "Form",
            fields: [{ key: "f", label: "F", type: "colour-picker" }],
        });
        expect(parsed.success).toBe(false);
    });
});

describe("render_intake_form argument tolerance", () => {
    const tool = RENDER_TOOLS.render_intake_form;

    // Every shape below was observed in a live room landing as
    // "fields: Required" while the model had written the whole spec.

    it("accepts 'inputs' / 'items' / 'questions' as field aliases", () => {
        for (const alias of ["inputs", "items", "questions", "formFields", "elements"]) {
            const parsed = tool.parameters.safeParse({
                title: "Tip Calculator",
                [alias]: [{ key: "bill", label: "Bill", type: "number" }],
            });
            expect(parsed.success, `alias "${alias}" should parse`).toBe(true);
            if (parsed.success) {
                expect((parsed.data as any).fields[0].key).toBe("bill");
            }
        }
    });

    it("lifts fields nested under 'schema' or 'form'", () => {
        for (const wrap of ["schema", "form", "formSchema"]) {
            const parsed = tool.parameters.safeParse({
                title: "Mortgage Calculator",
                [wrap]: { fields: [{ key: "principal", label: "Principal", type: "number" }] },
            });
            expect(parsed.success, `wrapper "${wrap}" should parse`).toBe(true);
            if (parsed.success) {
                expect((parsed.data as any).fields[0].key).toBe("principal");
            }
        }
    });

    it("accepts a stringified JSON fields array", () => {
        const parsed = tool.parameters.safeParse({
            title: "Tip Calculator",
            fields: JSON.stringify([{ key: "bill", label: "Bill", type: "number" }]),
        });
        expect(parsed.success).toBe(true);
        if (parsed.success) {
            expect((parsed.data as any).fields[0].key).toBe("bill");
        }
    });

    it("accepts fields as an object map keyed by field name", () => {
        const parsed = tool.parameters.safeParse({
            title: "Mortgage Calculator",
            fields: {
                principal: { label: "Loan Amount", type: "number" },
                rate: "Interest Rate",
            },
        });
        expect(parsed.success, JSON.stringify((parsed as any).error?.issues)).toBe(true);
        if (parsed.success) {
            const fields = (parsed.data as any).fields;
            expect(fields).toHaveLength(2);
            expect(fields[0]).toMatchObject({ key: "principal", label: "Loan Amount" });
            expect(fields[1]).toMatchObject({ key: "rate", label: "Interest Rate" });
        }
    });

    it("derives key/label for field objects that use 'name' or 'title'", () => {
        const parsed = tool.parameters.safeParse({
            title: "Mortgage Calculator",
            fields: [
                { name: "Loan Amount", type: "number" },
                { name: "annual_rate", title: "Annual Rate", type: "number" },
                "Term in Years",
            ],
        });
        expect(parsed.success, JSON.stringify((parsed as any).error?.issues)).toBe(true);
        if (parsed.success) {
            const fields = (parsed.data as any).fields;
            expect(fields[0]).toMatchObject({ key: "loan_amount", label: "Loan Amount" });
            expect(fields[1]).toMatchObject({ key: "annual_rate", label: "Annual Rate" });
            expect(fields[2]).toMatchObject({ key: "term_in_years", label: "Term in Years" });
        }
    });

    it("accepts a title carried as 'name' or 'formName'", () => {
        const parsed = tool.parameters.safeParse({
            name: "Mortgage Calculator",
            fields: [{ key: "principal", label: "Principal" }],
        });
        expect(parsed.success).toBe(true);
        if (parsed.success) {
            expect((parsed.data as any).title).toBe("Mortgage Calculator");
        }
    });

    it("still refuses a call with no fields anywhere", () => {
        const parsed = tool.parameters.safeParse({ title: "Mortgage Calculator" });
        expect(parsed.success).toBe(false);
    });
});

describe("render_carousel argument tolerance", () => {
    const tool = RENDER_TOOLS.render_carousel;

    it("emits an assistant_carousel payload with normalized items", async () => {
        const parsed = tool.parameters.parse({
            title: "Dispatch Apps",
            items: [
                { title: "Rescue Dispatch", subtitle: "v3", tags: ["Field Ops"], ctaLabel: "Open", ctaHref: "/apps/rescue" },
                { name: "Fleet Tracker", image: "https://img.example/x.png", href: "https://fleet.example" },
            ],
        });
        const payload = JSON.parse(await tool.execute(parsed, {} as any));
        expect(payload.type).toBe("assistant_carousel");
        expect(payload.items).toHaveLength(2);
        expect(payload.items[1].title).toBe("Fleet Tracker");
        expect(payload.items[1].imageUrl).toBe("https://img.example/x.png");
        expect(payload.items[1].ctaHref).toBe("https://fleet.example");
    });

    it("accepts 'cards'/'slides'/'products' as item aliases and plain-string items", () => {
        for (const alias of ["cards", "slides", "entries", "products", "versions"]) {
            const parsed = tool.parameters.safeParse({ [alias]: ["Alpha", { title: "Beta" }] });
            expect(parsed.success, `alias "${alias}" should parse`).toBe(true);
            if (parsed.success) {
                expect((parsed.data as any).items).toHaveLength(2);
                expect((parsed.data as any).items[0].title).toBe("Alpha");
            }
        }
    });

    it("unwraps a cta object into ctaLabel/ctaHref", async () => {
        const parsed = tool.parameters.parse({
            items: [
                { title: "Doc A", version: "v2", cta: { label: "View", url: "/docs/a?v=2" } },
                { title: "Doc B", version: "v3" },
            ],
        });
        const payload = JSON.parse(await tool.execute(parsed, {} as any));
        expect(payload.items[0].ctaLabel).toBe("View");
        expect(payload.items[0].ctaHref).toBe("/docs/a?v=2");
        expect(payload.items[0].subtitle).toBe("v2");
    });

    it("still refuses a call with fewer than two items", () => {
        expect(tool.parameters.safeParse({ title: "x", items: [{ title: "only one" }] }).success).toBe(false);
        expect(tool.parameters.safeParse({ title: "x" }).success).toBe(false);
    });
});
