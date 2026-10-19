import { describe, expect, it } from "vitest";
import { INSTANT_APP_TOOLS, detectComputationIntent } from "../instant-app-tools.js";

describe("assemble_instant_app argument tolerance", () => {
    const tool = INSTANT_APP_TOOLS.assemble_instant_app;

    it("accepts canonical blocks array", () => {
        const parsed = tool.parameters.safeParse({
            title: "Weather App",
            blocks: [
                { component: "Metric Grid", props: { metrics: [] } },
            ],
        });
        expect(parsed.success).toBe(true);
        if (parsed.success) {
            expect((parsed.data as any).blocks).toHaveLength(1);
            expect((parsed.data as any).blocks[0].component).toBe("Metric Grid");
        }
    });

    it("accepts 'components' alias instead of 'blocks'", () => {
        const parsed = tool.parameters.safeParse({
            title: "Weather App",
            components: [
                { component: "Metric Grid", props: { metrics: [] } },
            ],
        });
        expect(parsed.success).toBe(true);
        if (parsed.success) {
            expect((parsed.data as any).blocks).toHaveLength(1);
            expect((parsed.data as any).blocks[0].component).toBe("Metric Grid");
        }
    });

    it("accepts 'items' and 'widgets' aliases", () => {
        for (const alias of ["items", "widgets", "elements"]) {
            const parsed = tool.parameters.safeParse({
                title: "Dashboard",
                [alias]: [{ name: "MetricGrid" }],
            });
            expect(parsed.success, `alias ${alias} should parse successfully`).toBe(true);
            if (parsed.success) {
                expect((parsed.data as any).blocks[0].component).toBe("MetricGrid");
            }
        }
    });

    it("accepts single top-level component", () => {
        const parsed = tool.parameters.safeParse({
            title: "Single Widget",
            component: "Metric Grid",
            props: { columns: 4 },
        });
        expect(parsed.success).toBe(true);
        if (parsed.success) {
            expect((parsed.data as any).blocks).toHaveLength(1);
            expect((parsed.data as any).blocks[0].component).toBe("Metric Grid");
        }
    });

    it("accepts top-level 'name' as single component", () => {
        const parsed = tool.parameters.safeParse({
            title: "Single Widget",
            name: "IndustrialDashboardHero",
        });
        expect(parsed.success).toBe(true);
        if (parsed.success) {
            expect((parsed.data as any).blocks[0].component).toBe("IndustrialDashboardHero");
        }
    });

    it("accepts stringified JSON blocks", () => {
        const parsed = tool.parameters.safeParse({
            title: "JSON String Blocks",
            blocks: JSON.stringify([{ component: "Metric Grid" }]),
        });
        expect(parsed.success).toBe(true);
        if (parsed.success) {
            expect((parsed.data as any).blocks[0].component).toBe("Metric Grid");
        }
    });

    it("normalizes block items that use 'name' instead of 'component'", () => {
        const parsed = tool.parameters.safeParse({
            title: "Blocks with Name",
            blocks: [
                { name: "Metric Grid" },
                { name: "Industrial Dashboard Hero" },
            ],
        });
        expect(parsed.success).toBe(true);
        if (parsed.success) {
            expect((parsed.data as any).blocks[0].component).toBe("Metric Grid");
            expect((parsed.data as any).blocks[1].component).toBe("Industrial Dashboard Hero");
        }
    });

    it("normalizes string array of block names", () => {
        const parsed = tool.parameters.safeParse({
            title: "String Blocks",
            blocks: ["Metric Grid", "Industrial Dashboard Hero"],
        });
        expect(parsed.success).toBe(true);
        if (parsed.success) {
            expect((parsed.data as any).blocks).toHaveLength(2);
            expect((parsed.data as any).blocks[0].component).toBe("Metric Grid");
        }
    });

    it("falls back to weather dashboard when blocks array is completely missing but title mentions weather", () => {
        const parsed = tool.parameters.safeParse({
            title: "Weather App",
            note: "Live weather conditions using mock data",
        });
        expect(parsed.success).toBe(true);
        if (parsed.success) {
            expect((parsed.data as any).blocks.length).toBeGreaterThanOrEqual(1);
            expect((parsed.data as any).blocks[0].component).toBe("Metric Grid");
        }
    });
});

describe("render_instant_app argument tolerance", () => {
    const tool = INSTANT_APP_TOOLS.render_instant_app;

    it("accepts 'name' alias instead of 'component'", () => {
        const parsed = tool.parameters.safeParse({
            name: "MetricGrid",
            title: "Current Stats",
        });
        expect(parsed.success).toBe(true);
        if (parsed.success) {
            expect((parsed.data as any).component).toBe("MetricGrid");
        }
    });

    it("accepts stringified JSON for props", () => {
        const parsed = tool.parameters.safeParse({
            component: "MetricGrid",
            props: JSON.stringify({ columns: 3 }),
        });
        expect(parsed.success).toBe(true);
        if (parsed.success) {
            expect((parsed.data as any).props).toEqual({ columns: 3 });
        }
    });

    it("preserves MapPod markers and route props without stripping optional keys", async () => {
        const result = await tool.execute({
            component: "MapPod",
            title: "Route: Origin to Destination",
            props: {
                markers: [
                    { lat: 34.0522, lng: -118.2437, label: "Origin" },
                    { lat: 34.0736, lng: -118.4004, label: "Destination" },
                ],
                route: {
                    waypoints: [
                        { lat: 34.0522, lng: -118.2437, label: "Origin" },
                        { lat: 34.0736, lng: -118.4004, label: "Destination" },
                    ],
                },
            },
        }, {} as any);

        const payload = JSON.parse(result);
        expect(payload.type).toBe("instant_app");
        expect(payload.module).toBe("MapPod");
        expect(payload.props.markers).toHaveLength(2);
        expect(payload.props.markers[0].label).toBe("Origin");
        expect(payload.props.route).toBeDefined();
        expect(payload.props.route.waypoints).toHaveLength(2);
    });
});

describe("detectComputationIntent mock data protection", () => {
    it("allows weather app when mock data is specified", () => {
        const refusal = detectComputationIntent(
            "Weather App",
            "Show me weather app on the fly using mock data if needed",
            "Metric Grid Industrial Dashboard Hero"
        );
        expect(refusal).toBeNull();
    });

    it("allows sample / demo requests without refusal", () => {
        const refusal = detectComputationIntent(
            "Currency preview with sample data",
            "Metric Grid"
        );
        expect(refusal).toBeNull();
    });

    it("still refuses real computational tasks without mock data", () => {
        const refusal = detectComputationIntent(
            "Mortgage Calculator",
            "Calculate monthly payment and amortisation"
        );
        expect(refusal).not.toBeNull();
        expect(refusal).toContain("render_intake_form");
    });
});
