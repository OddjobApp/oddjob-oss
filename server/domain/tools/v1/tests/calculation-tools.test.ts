import { describe, it, expect } from "vitest";
import { CALCULATION_TOOLS } from "../capabilities/calculation-tools.js";

describe("CALCULATION_TOOLS tenant isolation", () => {
    it("preserves financial field and currency through agent argument validation", () => {
        const reference = { nodeId: 12, variable: "balance", field: "Balance", currency: "USD" };
        const args = CALCULATION_TOOLS.create_calculation_node.parameters.parse({
            nodeId: 10, operation: "SUM", inputReferences: [reference], outputUnit: "USD",
        });
        expect(args.inputReferences).toEqual([reference]);
        expect(CALCULATION_TOOLS.create_calculation_node.parameters.safeParse({
            ...args, inputReferences: [{ ...reference, currency: "unknown" }],
        }).success).toBe(false);
    });
    it("refuses to execute create_calculation_node without organization context", async () => {
        const tool = CALCULATION_TOOLS.create_calculation_node;
        expect(tool).toBeDefined();

        const invalidContext = { organizationId: null } as any;
        const res = await tool.execute(
            {
                nodeId: 10,
                operation: "FORMULA",
                formula: "a + b",
            },
            invalidContext
        );

        expect(typeof res).toBe("string");
        expect(res).toContain("Error creating calculation node: Organization context required");
    });

    it("refuses to execute execute_calculation_node without organization context", async () => {
        const tool = CALCULATION_TOOLS.execute_calculation_node;
        expect(tool).toBeDefined();

        const invalidContext = {} as any;
        const res = await tool.execute(
            {
                calculationId: 10,
            },
            invalidContext
        );

        expect(typeof res).toBe("string");
        expect(res).toContain("Error executing calculation node: Organization context required");
    });

    it("refuses to execute list_calculation_nodes without organization context", async () => {
        const tool = CALCULATION_TOOLS.list_calculation_nodes;
        expect(tool).toBeDefined();

        const invalidContext = { organizationId: 0 } as any;
        const res = await tool.execute(
            {},
            invalidContext
        );

        expect(typeof res).toBe("string");
        expect(res).toContain("Error listing calculation nodes: Organization context required");
    });
});
