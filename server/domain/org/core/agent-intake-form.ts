/**
 * Blueprint-declared agent intake forms.
 *
 * `agents[].intake_form` in a cycle manifest names a `forms[]` entry. The
 * resolved definition lands on the agent's `job.config.intakeForm`, which the
 * deployment form-manifest builder (`AgentDeploymentService.updateManifest`)
 * merges with `servesInitialTurn` — the same ownership model as `assetForms`:
 * the blueprint is the source of truth, and the manifest is where every
 * consumer (initial-turn fast path, derived fallback routes) reads it.
 *
 * The returned shape must stay structurally compatible with
 * IntakeFormDefinition (server/domain/rescue/core/intake-form.ts): the
 * manifest builder reads formId/pipelineName/fields/servesInitialTurn.
 */
export interface AgentIntakeFormConfig {
    formId: string;
    pipelineName: string;
    fields: Record<string, unknown>[];
    servesInitialTurn: boolean;
}

export interface IntakeFormResolution {
    config: AgentIntakeFormConfig | null;
    warning: string | null;
}

/**
 * Resolve an agent's `intake_form` reference against `manifest.forms`.
 * Returns null config when the agent declares none; a warning (not a throw)
 * when it names a form that does not exist or has no usable fields — a bad
 * reference must not sink the whole install.
 */
export function resolveAgentIntakeForm(
    agent: { id?: unknown; name?: unknown; intake_form?: unknown },
    manifestForms: unknown,
): IntakeFormResolution {
    const ref = agent?.intake_form;
    if (ref === undefined || ref === null || ref === "") {
        return { config: null, warning: null };
    }
    const agentName = String(agent?.name || agent?.id || "unknown");
    const formId = String(ref);
    const defs = Array.isArray(manifestForms) ? manifestForms : [];
    const def = defs.find((f: any) => String(f?.id ?? "") === formId);
    if (!def) {
        return {
            config: null,
            warning: `Agent "${agentName}" declares intake_form "${formId}" but no form with that id exists in manifest.forms — skipped`,
        };
    }
    const fields = (Array.isArray(def.fields) ? def.fields : [])
        .map((f: any) => ({
            name: f.name,
            label: f.label ?? f.name,
            type: f.type ?? "text",
            required: f.required ?? true,
            placeholder: f.placeholder ?? null,
            options: f.options ?? null,
        }))
        .filter((f: any) => typeof f.name === "string" && f.name.length > 0);
    if (!fields.length) {
        return {
            config: null,
            warning: `Agent "${agentName}" intake_form "${formId}" resolves to a form with no usable fields — skipped`,
        };
    }
    return {
        config: {
            formId,
            pipelineName: def.name || formId,
            fields,
            servesInitialTurn: def.serves_initial_turn !== false,
        },
        warning: null,
    };
}
