import { describe, expect, it } from "vitest";
import { resolveAgentIntakeForm } from "./agent-intake-form.js";

const MANIFEST_FORMS = [
    {
        id: "trip_intake_form",
        name: "Create Wayfare Road Trip",
        fields: [
            { name: "trip_name", label: "Trip Name", type: "text", required: true },
            { name: "origin", label: "Starting City/Point", type: "text", required: true },
            { name: "corridor_width", label: "Discovery Corridor Width (Miles)", type: "select", required: true, options: ["5 miles", "25 miles"] },
        ],
    },
];

describe("resolveAgentIntakeForm", () => {
    it("returns null when the agent declares no intake_form", () => {
        expect(resolveAgentIntakeForm({ id: "a", name: "A" }, MANIFEST_FORMS)).toEqual({ config: null, warning: null });
        expect(resolveAgentIntakeForm({ id: "a", intake_form: "" }, MANIFEST_FORMS).config).toBeNull();
    });

    it("resolves a declared form into the manifest-builder shape", () => {
        const { config, warning } = resolveAgentIntakeForm(
            { id: "wayfare-route-architect", intake_form: "trip_intake_form" },
            MANIFEST_FORMS,
        );
        expect(warning).toBeNull();
        expect(config).toMatchObject({
            formId: "trip_intake_form",
            pipelineName: "Create Wayfare Road Trip",
            servesInitialTurn: true,
        });
        expect(config!.fields).toHaveLength(3);
        expect(config!.fields[2]).toMatchObject({ name: "corridor_width", options: ["5 miles", "25 miles"] });
    });

    it("honours a forms-level serves_initial_turn opt-out", () => {
        const forms = [{ ...MANIFEST_FORMS[0], serves_initial_turn: false }];
        const { config } = resolveAgentIntakeForm({ id: "a", intake_form: "trip_intake_form" }, forms);
        expect(config!.servesInitialTurn).toBe(false);
    });

    it("warns instead of throwing when the form id is not declared", () => {
        const { config, warning } = resolveAgentIntakeForm(
            { id: "a", name: "Scout", intake_form: "missing_form" },
            MANIFEST_FORMS,
        );
        expect(config).toBeNull();
        expect(warning).toContain('intake_form "missing_form"');
        expect(warning).toContain('"Scout"');
    });

    it("warns when the resolved form has no usable fields", () => {
        const { config, warning } = resolveAgentIntakeForm(
            { id: "a", intake_form: "empty_form" },
            [{ id: "empty_form", name: "Empty", fields: [] }],
        );
        expect(config).toBeNull();
        expect(warning).toContain("no usable fields");
    });
});
