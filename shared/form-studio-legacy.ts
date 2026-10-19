import { asStudioDefinition, STUDIO_FIELD_TYPES, type StudioDefinition } from "./form-studio";

/**
 * A form written for the older FormRenderer (a list of fields, as HIL steps,
 * approval requests and chat calculators still send) as a Form Studio definition,
 * so every form renders with the same renderer and the same strict engine the
 * server uses.
 *
 * A form already authored in Form Studio passes through with its own pages and
 * navigation. A plain field list becomes one page with no review step and no
 * progress bar, which is how those forms have always looked.
 */

const STUDIO_TYPES = new Set<string>(STUDIO_FIELD_TYPES);

// Types the older renderers accepted that Form Studio names differently.
const TYPE_ALIASES: Record<string, string> = {
  checkbox: "boolean",
  switch: "boolean",
  toggle: "boolean",
  password: "text",
  phone: "text",
  tel: "text",
  vin: "text",
  string: "text",
  integer: "number",
  float: "number",
  decimal: "number",
  currency: "number",
  dropdown: "select",
  multi_select: "multiselect",
  checkboxes: "multiselect",
};

/** {{ path.to.value }} placeholders in a default, filled from the caller's context. */
export function fillTemplate(template: string, context: unknown): string {
  if (!context || typeof context !== "object") return template;
  return template.replace(/\{\{([^}]+)\}\}/g, (_match, path: string) => {
    let value: any = context;
    for (const part of path.trim().split(".")) {
      if (value === undefined || value === null) return "";
      value = value[part];
    }
    return value === undefined || value === null ? "" : String(value);
  });
}

export interface LegacyFormConversion {
  definition: StudioDefinition;
  initialInputs: Record<string, unknown>;
  /** True when the form was a plain field list rather than a Form Studio definition. */
  legacy: boolean;
}

function studioTypeOf(type: unknown): string {
  const raw = typeof type === "string" ? type.trim().toLowerCase() : "";
  if (STUDIO_TYPES.has(raw)) return raw;
  return TYPE_ALIASES[raw] ?? "text";
}

export function definitionFromLegacyForm(schema: unknown, context: unknown = {}, title = "Form"): LegacyFormConversion {
  const source = (schema && typeof schema === "object" ? schema : {}) as Record<string, any>;

  if (source.studio) {
    try {
      return { definition: asStudioDefinition(source), initialInputs: {}, legacy: false };
    } catch {
      // A definition the Studio cannot read still has fields worth showing.
    }
  }

  const initialInputs: Record<string, unknown> = {};

  const mapField = (field: Record<string, any>, index: number, pageId: string) => {
    const key = String(field.key ?? field.id ?? field.name ?? `field_${index + 1}`);
    const type = studioTypeOf(field.type);
    const defaultValue = typeof field.defaultValue === "string" ? fillTemplate(field.defaultValue, context) : field.defaultValue;
    if (defaultValue !== undefined && defaultValue !== null && defaultValue !== "") initialInputs[key] = defaultValue;
    return {
      key,
      label: String(field.label ?? field.name ?? key),
      type,
      pageId,
      ...(field.required ? { required: true } : {}),
      ...(field.placeholder ? { placeholder: String(field.placeholder) } : {}),
      ...(field.description ? { description: String(field.description) } : {}),
      ...(field.readOnly ? { readOnly: true } : {}),
      ...(Array.isArray(field.options) ? { options: field.options } : {}),
      ...(typeof field.formula === "string" ? { formula: field.formula } : {}),
      ...(field.format ? { format: field.format } : {}),
      ...(typeof field.unit === "string" ? { unit: field.unit } : {}),
      ...(typeof field.min === "number" ? { min: field.min } : {}),
      ...(typeof field.max === "number" ? { max: field.max } : {}),
      ...(typeof field.url === "string" ? { url: field.url } : {}),
      ...(typeof field.jsonPath === "string" ? { jsonPath: field.jsonPath } : {}),
      ...(field.params && typeof field.params === "object" ? { params: field.params } : {}),
      ...(typeof field.credentialId === "number" ? { credentialId: field.credentialId } : {}),
      ...(typeof field.cacheTtlSeconds === "number" ? { cacheTtlSeconds: field.cacheTtlSeconds } : {}),
    };
  };

  let pages: StudioDefinition["studio"]["pages"] = [];
  let fields: any[] = [];

  if (Array.isArray(source.steps) && source.steps.length > 0) {
    pages = source.steps.map((step: any, stepIndex: number) => {
      const pageId = String(step.id || `step_${stepIndex + 1}`);
      const pageTitle = String(step.title || `Step ${stepIndex + 1}`);
      const html = step.description ? `<p>${String(step.description)}</p>` : "";
      return { id: pageId, title: pageTitle, html } as StudioDefinition["studio"]["pages"][number];
    });

    const seenKeys = new Set<string>();
    source.steps.forEach((step: any, stepIndex: number) => {
      const pageId = String(step.id || `step_${stepIndex + 1}`);
      const stepFields = Array.isArray(step.fields) ? step.fields : [];
      stepFields.forEach((field: any, fieldIndex: number) => {
        const mapped = mapField(field, fields.length + fieldIndex, pageId);
        if (!seenKeys.has(mapped.key)) {
          seenKeys.add(mapped.key);
          fields.push(mapped);
        }
      });
    });

    // If source also had top-level fields not in any step, append them to first page
    if (Array.isArray(source.fields)) {
      source.fields.forEach((field: any, fieldIndex: number) => {
        const key = String(field.key ?? field.id ?? field.name ?? `field_${fields.length + fieldIndex + 1}`);
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          fields.push(mapField(field, fields.length + fieldIndex, pages[0]?.id || "step_1"));
        }
      });
    }
  } else {
    const rawFields: Record<string, any>[] = Array.isArray(source.fields) ? source.fields : [];
    pages = [{ id: "page_1", title: title || source.title || "Form", html: source.description ? `<p>${String(source.description)}</p>` : "" } as StudioDefinition["studio"]["pages"][number]];
    fields = rawFields.map((field, index) => mapField(field, index, "page_1"));
  }

  // Handle results / reports
  let results: StudioDefinition["studio"]["results"] = [];
  if (Array.isArray(source.results)) {
    results = source.results;
  } else if (Array.isArray(source.reports)) {
    results = source.reports.map((report: any, index: number) => ({
      id: String(report.id || `report_${index + 1}`),
      title: String(report.title || `Report ${index + 1}`),
      type: "narrative" as const,
      audience: "reviewer" as const,
      html: String(report.html || ""),
      ...(report.visibleWhen ? { visibleWhen: String(report.visibleWhen) } : {}),
    }));
  }

  const isPaged = pages.length > 1;
  const definition = asStudioDefinition({ fields });
  definition.studio.pages = pages;
  definition.studio.navigation = {
    mode: isPaged ? "paged" : "single",
    allowBack: true,
    reviewBeforeSubmit: isPaged,
    showProgress: isPaged,
  };
  if (results.length > 0) {
    definition.studio.results = results;
  }

  return { definition, initialInputs, legacy: true };
}
