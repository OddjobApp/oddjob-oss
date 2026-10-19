/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { compareFields, reconcileTemplateForm } from "./form-studio";

/**
 * Org Forge reinstalls against forms edited in Form Studio.
 *
 * A reinstall matched its template's form by name and overwrote `schema` with the
 * template's `{ fields }`, deleting a Studio form's pages, rules, results and tests.
 */

const templateFields = [
    { key: "reason", label: "Reason for override", type: "textarea", required: true, placeholder: null, options: null },
    { key: "severity", label: "Severity", type: "select", required: true, placeholder: null, options: ["low", "high"] },
];

describe("compareFields", () => {
    it("names added, changed and form-only fields by key", () => {
        const current = [
            { key: "reason", label: "Reason", type: "textarea", required: true, placeholder: null, options: null },
            { key: "risk_score", label: "Risk", type: "computed", formula: "1" },
        ];
        expect(compareFields(current, templateFields)).toEqual({ added: ["severity"], changed: ["reason"], notInTemplate: ["risk_score"] });
    });
});

describe("reconcileTemplateForm", () => {
    it("replaces a plain form, as installs always have", () => {
        expect(reconcileTemplateForm({ schema: { fields: [] }, config: { formId: "dispatch_override" } }, { key: "dispatch_override", description: null, fields: templateFields }))
            .toEqual({ action: "overwrite" });
    });

    it("leaves a Studio form alone when the template asks for nothing new", () => {
        const studioForm = { schema: { fields: templateFields, studio: { version: 2 } }, config: {} };
        expect(reconcileTemplateForm(studioForm, { key: "dispatch_override", description: null, fields: templateFields })).toEqual({ action: "unchanged" });
    });

    it("holds the template's changes on a Studio form instead of overwriting it", () => {
        const studioForm = { schema: { fields: [templateFields[0]], studio: { version: 2 } }, config: { formStudio: { revision: 4 } } };
        const at = new Date("2026-09-12T10:00:00Z");
        expect(reconcileTemplateForm(studioForm, { key: "dispatch_override", description: "Override a dispatch", fields: templateFields }, at)).toEqual({
            action: "hold",
            templateUpdate: {
                at: "2026-09-12T10:00:00.000Z", templateKey: "dispatch_override", description: "Override a dispatch",
                fields: templateFields, added: ["severity"], changed: [], notInTemplate: [],
            },
        });
    });
});
