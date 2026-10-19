import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * ServiceNow returns dictionary rows as strings — booleans included — and mixes
 * table-describing rows in with the column rows. Normalisation is where that
 * gets turned into something comparable to a Jira field list, so drift detection
 * can be shared rather than reimplemented per platform.
 */

const snRequest = vi.fn();

vi.mock("@domain/tools/v1/capabilities/servicenow.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@domain/tools/v1/capabilities/servicenow.js")>();
    return { ...actual, snRequest };
});

const { fetchServiceNowSchemaFields } = await import("../servicenow-schema.service.js");

const config = { instanceUrl: "https://acme.service-now.com", username: "u", password: "p" };

beforeEach(() => snRequest.mockReset());

describe("fetchServiceNowSchemaFields", () => {
    it("normalises dictionary rows into comparable fields", async () => {
        snRequest.mockResolvedValue({
            result: [
                {
                    element: "short_description",
                    column_label: "Short description",
                    internal_type: "String",
                    max_length: "160",
                    mandatory: "true",
                    read_only: "false",
                },
            ],
        });

        const [field] = await fetchServiceNowSchemaFields(config as any, "incident");

        expect(field).toEqual({
            id: "short_description",
            name: "Short description",
            custom: false,
            schema: { type: "String", maxLength: 160, mandatory: true, readOnly: false },
        });
    });

    it('reads ServiceNow\'s string booleans as booleans', async () => {
        snRequest.mockResolvedValue({
            result: [
                { element: "a", column_label: "A", internal_type: "String", max_length: "40", mandatory: "false", read_only: "true" },
            ],
        });

        const [field] = await fetchServiceNowSchemaFields(config as any, "incident");

        // "false" is truthy as a string — reading it directly would mark every
        // field mandatory and read-only.
        expect(field.schema.mandatory).toBe(false);
        expect(field.schema.readOnly).toBe(true);
    });

    it("treats the u_ and x_ prefixes as customer-added fields", async () => {
        snRequest.mockResolvedValue({
            result: [
                { element: "u_cost_centre", column_label: "Cost centre", internal_type: "String", max_length: "40" },
                { element: "x_acme_app_ref", column_label: "App ref", internal_type: "String", max_length: "40" },
                { element: "priority", column_label: "Priority", internal_type: "Integer", max_length: "40" },
            ],
        });

        const fields = await fetchServiceNowSchemaFields(config as any, "incident");

        expect(fields.map((f) => f.custom)).toEqual([true, true, false]);
    });

    it("drops the row that describes the table rather than a column", async () => {
        snRequest.mockResolvedValue({
            result: [
                { element: "", column_label: "Incident", internal_type: "Collection" },
                { element: "   ", column_label: "blank", internal_type: "Collection" },
                { element: "number", column_label: "Number", internal_type: "String", max_length: "40" },
            ],
        });

        const fields = await fetchServiceNowSchemaFields(config as any, "incident");

        expect(fields.map((f) => f.id)).toEqual(["number"]);
    });

    it("reports an unusable max_length as absent rather than zero", async () => {
        snRequest.mockResolvedValue({
            result: [
                { element: "a", column_label: "A", internal_type: "Boolean", max_length: "" },
                { element: "b", column_label: "B", internal_type: "Boolean", max_length: "0" },
            ],
        });

        const fields = await fetchServiceNowSchemaFields(config as any, "incident");

        expect(fields.map((f) => f.schema.maxLength)).toEqual([null, null]);
    });

    it("falls back to the field name when ServiceNow supplies no label", async () => {
        snRequest.mockResolvedValue({
            result: [{ element: "u_widget", column_label: "", internal_type: "String", max_length: "40" }],
        });

        const [field] = await fetchServiceNowSchemaFields(config as any, "incident");

        expect(field.name).toBe("u_widget");
    });

    it("queries sys_dictionary for the requested table, with display values", async () => {
        snRequest.mockResolvedValue({ result: [] });

        await fetchServiceNowSchemaFields(config as any, "change_request");

        const path = snRequest.mock.calls[0][1] as string;
        expect(path).toContain("/table/sys_dictionary");
        expect(decodeURIComponent(path)).toContain("name=change_request");
        // internal_type is a reference; without display values it snapshots sys_ids.
        expect(path).toContain("sysparm_display_value=true");
    });
});

describe("shared drift detection", () => {
    it("sees no drift between identical captures, so versions mean something", async () => {
        const { hasSchemaDrift } = await import("../saas-sync.service.js");
        const rows = [
            { element: "u_cost_centre", column_label: "Cost centre", internal_type: "String", max_length: "40", mandatory: "true", read_only: "false" },
        ];
        snRequest.mockResolvedValue({ result: rows });
        const first = await fetchServiceNowSchemaFields(config as any, "incident");
        snRequest.mockResolvedValue({ result: rows });
        const second = await fetchServiceNowSchemaFields(config as any, "incident");

        expect(hasSchemaDrift(second, first)).toBe(false);
    });

    it("detects a field whose type changed", async () => {
        const { hasSchemaDrift } = await import("../saas-sync.service.js");
        snRequest.mockResolvedValue({
            result: [{ element: "priority", column_label: "Priority", internal_type: "String", max_length: "40" }],
        });
        const before = await fetchServiceNowSchemaFields(config as any, "incident");
        snRequest.mockResolvedValue({
            result: [{ element: "priority", column_label: "Priority", internal_type: "Integer", max_length: "40" }],
        });
        const after = await fetchServiceNowSchemaFields(config as any, "incident");

        expect(hasSchemaDrift(after, before)).toBe(true);
    });
});
