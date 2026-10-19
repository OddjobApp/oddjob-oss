/**
 * Rescue Dispatch intake form — the structured turn a requester sees first.
 *
 * This lived as a literal inside the public chat route, duplicated into a
 * per-slug `if (deployment.slug === "rescue-dispatcher")` branch. That made it
 * invisible to everything that reasons about an agent's forms: the form manifest
 * did not know it existed, so neither did the derived fallback routes, and the
 * agent's own limp mode could not serve its primary interaction.
 *
 * It now lives here as data and is attached to the agent's job config, the same
 * way `assetForms` is blueprint-owned for the asset-service agents. The manifest
 * builder merges it, the fallback deriver picks it up for free, and the route
 * serves it through the generic initial-turn path rather than a slug check.
 */

/** Form-manifest key. Kept stable — issued nonces reference it. */
export const RESCUE_INTAKE_FORM_ID = "incident_intake:19";

export const RESCUE_INTAKE_PIPELINE_NAME = "Service Dispatch Pipeline — Process Incident Intake";

export interface IntakeFormDefinition {
    formId: string;
    pipelineName: string;
    /** Serve this form deterministically on the agent's first turn, with no model call. */
    servesInitialTurn: boolean;
    fields: Array<Record<string, unknown>>;
}

export const RESCUE_INTAKE_FORM: IntakeFormDefinition = {
    formId: RESCUE_INTAKE_FORM_ID,
    pipelineName: RESCUE_INTAKE_PIPELINE_NAME,
    servesInitialTurn: true,
    fields: [
        { name: "address", label: "Incident Address or Location", type: "location", required: true, placeholder: "e.g. 200 N Spring St, Los Angeles, CA" },
        { name: "serialNumber", label: "Asset Serial Number", type: "text", required: true, placeholder: "e.g. GEN-8842-X" },
        { name: "target", label: "Who or What Needs Help?", type: "text", required: true, placeholder: "e.g. Commercial Generator #4" },
        { name: "incidentType", label: "Incident Type", type: "select", options: ["Roadside rescue", "Medical support", "Equipment recovery", "Site safety", "Other"], required: true },
        { name: "priority", label: "Priority", type: "select", options: ["Critical", "High", "Medium", "Low"], required: true },
        { name: "details", label: "Situation Details", type: "text", required: true, placeholder: "Add hazards, access instructions, or details for dispatch." },
    ],
};
