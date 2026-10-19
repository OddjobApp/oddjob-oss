/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { parseCreateCalculationBody } from "./create-calculation-input.js";

describe("parseCreateCalculationBody", () => {
    it("accepts the builder's default FORMULA calculation", () => {
        const result = parseCreateCalculationBody({ nodeId: 105, operation: "FORMULA", formula: "revenue - expenses" });
        expect(result.ok).toBe(true);
    });

    it("accepts a set-membership constraint, which the evaluator supports", () => {
        const result = parseCreateCalculationBody({
            nodeId: 7,
            operation: "CONSTRAINT_CHECK",
            formula: "tier",
            constraintType: "SET_MEMBERSHIP",
            enforcementAction: "WARN",
        });
        expect(result.ok).toBe(true);
    });

    it("names a missing node, which a canvas drop does not send", () => {
        const result = parseCreateCalculationBody({ operation: "SUM", formula: "a + b" });
        expect(result).toMatchObject({ ok: false });
        expect((result as any).issues.join(" ")).toContain("nodeId");
    });

    it.each(["DYNAMIC_FORMULA", "YOY_GROWTH", "MONTE_CARLO"])("rejects %s, an operation the service never evaluates", (operation) => {
        const result = parseCreateCalculationBody({ nodeId: 1, operation, formula: "a" });
        expect(result.ok).toBe(false);
        expect((result as any).issues.join(" ")).toContain("operation");
    });

    it("rejects an empty formula, which the database column cannot store", () => {
        const result = parseCreateCalculationBody({ nodeId: 1, operation: "FORMULA", formula: "" });
        expect(result.ok).toBe(false);
        expect((result as any).issues.join(" ")).toContain("formula");
    });

    it("ignores an organizationId in the body; the route takes it from the session", () => {
        const result = parseCreateCalculationBody({ nodeId: 1, operation: "FORMULA", formula: "a", organizationId: 999 });
        expect(result.ok).toBe(true);
        expect((result as any).data).not.toHaveProperty("organizationId");
    });
});
