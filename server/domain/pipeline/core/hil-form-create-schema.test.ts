/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { formCreateSchema } from "./hil-form-contracts.js";

describe("formCreateSchema", () => {
    it("accepts what the Form Builder and the regression suite send", () => {
        const result = formCreateSchema.safeParse({
            name: "Test Regression Form",
            description: "Form created by regression tests",
            schema: { fields: [{ key: "reason", type: "text", label: "Reason", required: true }] },
            themeConfig: { logoUrl: "", primaryColor: "#4F46E5", companyName: "Test Company" },
            securityConfig: { requireOtp: false, tokenExpirationHours: 48 },
        });
        expect(result.success).toBe(true);
    });

    it("requires a name", () => {
        expect(formCreateSchema.safeParse({ name: "   " }).success).toBe(false);
    });

    it.each([
        ["organizationId", 999],
        ["stepExecutionId", 12],
        ["status", "pending"],
    ])("refuses %s from the request body", (key, value) => {
        const result = formCreateSchema.safeParse({ name: "Intake", [key]: value });
        expect(result.success).toBe(false);
        expect(JSON.stringify((result as any).error.issues)).toContain(key);
    });
});
