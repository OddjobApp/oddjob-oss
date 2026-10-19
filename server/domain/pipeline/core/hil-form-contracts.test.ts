/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { formUpdateSchema, toBlockField, toBlockForm, missingRequiredFields } from "./hil-form-contracts.js";

describe("formUpdateSchema", () => {
    it("accepts what the Form Builder saves", () => {
        const result = formUpdateSchema.safeParse({
            name: "Incident intake",
            description: null,
            schema: { fields: [{ key: "reason", type: "text", label: "Reason" }] },
            themeConfig: { primaryColor: "#4F46E5" },
            securityConfig: { requireOtp: false, tokenExpirationHours: 48 },
        });
        expect(result.success).toBe(true);
    });

    it("accepts restoring an archived form", () => {
        expect(formUpdateSchema.safeParse({ isArchived: false }).success).toBe(true);
    });

    it.each([
        ["organizationId", 999],
        ["status", "completed"],
        ["data", { reason: "forged" }],
        ["stepExecutionId", 5],
    ])("rejects %s, which the raw update used to write", (key, value) => {
        const result = formUpdateSchema.safeParse({ description: "ok", [key]: value });
        expect(result.success).toBe(false);
        expect(JSON.stringify((result as any).error.issues)).toContain(key);
    });
});

describe("toBlockField", () => {
    it("keys the block field by the builder's key and keeps required", () => {
        expect(toBlockField({ key: "reason", type: "text", label: "Reason", required: true })).toEqual({
            id: "reason",
            type: "text",
            label: "Reason",
            required: true,
        });
    });

    it("turns radio options given as strings into value/label pairs", () => {
        expect(toBlockField({ key: "tier", type: "radio", label: "Tier", options: ["Gold", "", "Silver"] })).toMatchObject({
            type: "select",
            options: [
                { value: "Gold", label: "Gold" },
                { value: "Silver", label: "Silver" },
            ],
        });
    });

    it("draws a rating as a bounded number and a boolean as a checkbox", () => {
        expect(toBlockField({ key: "score", type: "rating", label: "Score", max: 7 })).toMatchObject({
            type: "number",
            validation: { min: 1, max: 7 },
        });
        expect(toBlockField({ key: "consent", type: "boolean", label: "Consent" })?.type).toBe("checkbox");
    });

    it("leaves out computed fields and fields without a key", () => {
        expect(toBlockField({ key: "total", type: "computed", label: "Total", formula: "a + b" })).toBeNull();
        expect(toBlockField({ type: "text", label: "Nameless" })).toBeNull();
    });

    it("falls back to text for types the block cannot draw", () => {
        expect(toBlockField({ key: "where", type: "location", label: "Where" })?.type).toBe("text");
    });
});

describe("toBlockForm and missingRequiredFields", () => {
    const form = toBlockForm({
        id: 42,
        name: "Resources Required: Deploy",
        description: null,
        schema: {
            fields: [
                { key: "repo_url", type: "text", label: "Repo", required: true },
                { key: "notes", type: "textarea", label: "Notes" },
                { key: "total", type: "computed", label: "Total" },
            ],
        },
    });

    it("maps the stored schema without its computed fields", () => {
        expect(form.id).toBe(42);
        expect(form.fields.map((field) => field.id)).toEqual(["repo_url", "notes"]);
        expect(form).not.toHaveProperty("description");
    });

    it("names required fields that are blank", () => {
        expect(missingRequiredFields(form.fields, { repo_url: "  ", notes: "" })).toEqual(["repo_url"]);
        expect(missingRequiredFields(form.fields, { repo_url: "https://example.test" })).toEqual([]);
    });
});
