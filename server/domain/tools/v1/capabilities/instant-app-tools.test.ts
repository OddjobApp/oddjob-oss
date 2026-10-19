import { describe, it, expect } from "vitest";
import { detectComputationIntent, guardRequiredProps } from "./instant-app-tools";

/**
 * Code-level guards for instant apps. Both of these were previously prose
 * warnings in tool descriptions that the model ignored, producing a "mortgage
 * calculator" made of display blocks and an unconfigured form that rendered
 * "HTTP 404" as its entire contents.
 */

describe("detectComputationIntent", () => {
    it("refuses the mortgage calculator that caused this", () => {
        const refusal = detectComputationIntent("PlatformFormBlock", "Mortgage Calculator", "Enter the loan details to calculate your estimated monthly mortgage payment.");
        expect(refusal).toBeTruthy();
        expect(refusal).toContain("render_intake_form");
        expect(refusal).toContain("computed");
    });

    it("catches calculator-shaped requests by noun alone", () => {
        expect(detectComputationIntent(null, "Tip Calculator", null)).toBeTruthy();
        expect(detectComputationIntent(null, "Currency Converter", null)).toBeTruthy();
        expect(detectComputationIntent(null, "BMI calculator", null)).toBeTruthy();
        expect(detectComputationIntent(null, "Amortization schedule", null)).toBeTruthy();
    });

    it("catches a computation verb paired with a numeric domain", () => {
        expect(detectComputationIntent(null, null, "Calculate the monthly loan payment")).toBeTruthy();
        expect(detectComputationIntent(null, null, "Convert currency at today's rate")).toBeTruthy();
    });

    it("does NOT block legitimate platform surfaces", () => {
        expect(detectComputationIntent("MissionControlTable", "Mission Control", "Live view of running missions.")).toBeNull();
        expect(detectComputationIntent("MetricGrid", "Pipeline Health", "Throughput and failure rates for the last 7 days.")).toBeNull();
        expect(detectComputationIntent("AgentRoster", "Agents", "Every agent in this org and its status.")).toBeNull();
        expect(detectComputationIntent(null, "Cycle Timeline", "Shows each step and when it completed.")).toBeNull();
    });

    it("does not fire on a bare verb without a numeric domain", () => {
        expect(detectComputationIntent(null, "Dataset Table", "Compute nodes currently allocated.")).toBeNull();
    });

    it("ignores empty input", () => {
        expect(detectComputationIntent()).toBeNull();
        expect(detectComputationIntent(null, undefined, "")).toBeNull();
    });
});

describe("guardRequiredProps", () => {
    it("rejects PlatformFormBlock without a formId — the HTTP 404 block", () => {
        const refusal = guardRequiredProps("PlatformFormBlock", {});
        expect(refusal).toBeTruthy();
        expect(refusal).toContain("formId");
    });

    it("rejects it when props are omitted entirely", () => {
        expect(guardRequiredProps("PlatformFormBlock", undefined)).toBeTruthy();
    });

    it("allows it once a formId is supplied", () => {
        expect(guardRequiredProps("PlatformFormBlock", { formId: 42 })).toBeNull();
    });

    it("guards dataset blocks that cannot load without an id", () => {
        expect(guardRequiredProps("PlatformDatasetChartBlock", {})).toBeTruthy();
        expect(guardRequiredProps("PlatformDatasetTableBlock", {})).toBeTruthy();
        expect(guardRequiredProps("PlatformDatasetTableBlock", { datasetId: "ds_1" })).toBeNull();
    });

    it("leaves self-wiring blocks alone", () => {
        expect(guardRequiredProps("MetricGrid", {})).toBeNull();
        expect(guardRequiredProps("MissionControlTable", undefined)).toBeNull();
    });
});

describe("render_intake_form location & geo field capability", () => {
    it("successfully creates assistant_form payload with location and geo fields", async () => {
        const { RENDER_TOOLS } = await import("./render-tools");
        const renderIntakeForm = RENDER_TOOLS.render_intake_form;

        const resultJson = await renderIntakeForm.execute({
            title: "Rescue Dispatch Request",
            description: "Provide incident coordinates and details",
            submitLabel: "Dispatch Team",
            fields: [
                {
                    key: "incidentLocation",
                    label: "Incident Location",
                    type: "location",
                    required: true,
                    placeholder: "Search address or drop pin on map",
                },
                {
                    key: "targetCoordinates",
                    label: "Target Area",
                    type: "geo",
                },
                {
                    key: "urgency",
                    label: "Urgency Level",
                    type: "select",
                    options: ["Low", "High", "Critical"],
                },
            ],
        }, {} as any);

        const parsed = JSON.parse(resultJson);
        expect(parsed.type).toBe("assistant_form");
        expect(parsed.title).toBe("Rescue Dispatch Request");
        expect(parsed.schema.fields).toHaveLength(3);
        expect(parsed.schema.fields[0].type).toBe("location");
        expect(parsed.schema.fields[1].type).toBe("geo");
    });
});
