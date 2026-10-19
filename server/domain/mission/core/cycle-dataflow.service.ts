/**
 * Cycle Data-Flow Contracts (Phase 3 / #4)
 *
 * Typed contracts for mission outputs so the cycle engine can:
 *   - statically verify (at launch / in the builder) that every dataFlow's
 *     sourceOutputKey is actually declared by its source blueprint, and
 *   - validate the resolved value at runtime against the declared schema BEFORE
 *     passing it downstream — replacing the silent `|| "completed"` fallback that
 *     masked missions which never produced their expected artifact.
 *
 * Pure functions only (no DB / I/O).
 *
 * Output declarations accept three shapes for back-compat:
 *   outputs: ["plan", "report"]                      → existence only (no schema)
 *   outputs: { plan: "array" }                       → scalar type shorthand
 *   outputs: { plan: { type: "object",              → full contract
 *                      schema: { tasks: "array" },
 *                      required: true } }
 */

export type FieldType = "array" | "object" | "string" | "number" | "boolean" | "any";

export interface OutputDecl {
  type?: FieldType;
  /** Field → type map; the value must be an object containing these fields. */
  schema?: Record<string, FieldType>;
  /** Whether the output must be present (default true). */
  required?: boolean;
}

export interface ContractValidation {
  valid: boolean;
  errors: string[];
}

const FIELD_TYPES = new Set(["array", "object", "string", "number", "boolean", "any"]);

function checkType(value: unknown, type: FieldType): boolean {
  switch (type) {
    case "array": return Array.isArray(value);
    case "object": return value !== null && typeof value === "object" && !Array.isArray(value);
    case "string": return typeof value === "string";
    case "number": return typeof value === "number" && !Number.isNaN(value);
    case "boolean": return typeof value === "boolean";
    case "any": return value != null;
    default: return true; // unknown type → don't fail
  }
}

/**
 * Normalize a blueprint's `outputs` (string[] | map) into a declaration map.
 * Returns {} when nothing is declared.
 */
export function getOutputDecls(blueprint: any): Record<string, OutputDecl> {
  const raw = blueprint?.outputs ?? blueprint?.config?.outputs;
  if (!raw) return {};
  const out: Record<string, OutputDecl> = {};

  if (Array.isArray(raw)) {
    for (const k of raw) if (typeof k === "string") out[k] = {};
    return out;
  }
  if (typeof raw === "object") {
    for (const [key, decl] of Object.entries(raw)) {
      if (typeof decl === "string") {
        out[key] = FIELD_TYPES.has(decl) ? { type: decl as FieldType } : {};
      } else if (decl && typeof decl === "object") {
        const d = decl as any;
        out[key] = {
          ...(d.type && FIELD_TYPES.has(d.type) ? { type: d.type } : {}),
          ...(d.schema && typeof d.schema === "object" ? { schema: d.schema } : {}),
          ...(typeof d.required === "boolean" ? { required: d.required } : {}),
        };
      } else {
        out[key] = {};
      }
    }
  }
  return out;
}

/** Whether `blueprint` declares ANY output contracts (vs. legacy untyped). */
export function declaresOutputs(blueprint: any): boolean {
  return Object.keys(getOutputDecls(blueprint)).length > 0;
}

/**
 * Validate a resolved output value against its declaration. A declaration with
 * neither `type` nor `schema` only checks presence (unless required === false).
 */
export function validateOutputValue(value: unknown, decl: OutputDecl): ContractValidation {
  const errors: string[] = [];
  const required = decl.required !== false;

  if (value == null) {
    if (required) errors.push("value is missing");
    return { valid: errors.length === 0, errors };
  }

  if (decl.type && !checkType(value, decl.type)) {
    errors.push(`expected ${decl.type}, got ${Array.isArray(value) ? "array" : typeof value}`);
  }

  if (decl.schema) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      errors.push("expected an object matching the declared schema");
    } else {
      for (const [field, type] of Object.entries(decl.schema)) {
        const fv = (value as any)[field];
        if (fv == null) errors.push(`missing field "${field}"`);
        else if (!checkType(fv, type)) errors.push(`field "${field}" expected ${type}, got ${Array.isArray(fv) ? "array" : typeof fv}`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Static validation: every dataFlow's sourceOutputKey must be declared by its
 * source blueprint. Missing source → error. Undeclared key when the source HAS
 * declared outputs → error (typo). Undeclared key when the source declares no
 * outputs at all → warning (legacy, untyped flow).
 */
export function validateDataFlowContracts(
  blueprints: Array<{ name: string; dataFlows?: any[]; outputs?: any; config?: any }>
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const byName = new Map(blueprints.map((b) => [b.name, b]));

  for (const bp of blueprints) {
    const flows = Array.isArray(bp.dataFlows) ? bp.dataFlows : [];
    for (const flow of flows) {
      const sourceName = flow?.sourceBlueprint;
      const key = flow?.sourceOutputKey;
      if (!sourceName || !key) {
        warnings.push(`"${bp.name}" has a dataFlow missing sourceBlueprint/sourceOutputKey`);
        continue;
      }
      const source = byName.get(sourceName);
      if (!source) {
        errors.push(`"${bp.name}" pulls "${key}" from "${sourceName}", which is not a blueprint in this cycle`);
        continue;
      }
      const decls = getOutputDecls(source);
      if (decls[key]) continue; // declared — good
      if (Object.keys(decls).length > 0) {
        errors.push(`"${bp.name}" pulls undeclared output "${key}" from "${sourceName}" (declares: ${Object.keys(decls).join(", ")})`);
      } else {
        warnings.push(`"${bp.name}" pulls "${key}" from "${sourceName}", which declares no output contracts — value will be best-effort`);
      }
    }
  }
  return { errors, warnings };
}

export const cycleDataflowService = {
  getOutputDecls,
  declaresOutputs,
  validateOutputValue,
  validateDataFlowContracts,
};
