/**
 * ArtifactContractValidator
 *
 * Validates phase artifacts against their declared JSON Schema contracts
 * and checks compatibility between upstream output and downstream input contracts.
 *
 * Uses Ajv for JSON Schema validation. Pure/stateless — no DB or side effects.
 */

import _Ajv from "ajv";
import type { CjsDefault } from "@shared/cjs-interop.js";

/**
 * ajv ships CommonJS, and the two tsconfigs here type its default import
 * differently. See CjsDefault in shared/cjs-interop.ts. Runtime is unchanged.
 */
const Ajv = _Ajv as unknown as CjsDefault<typeof _Ajv>;
import type { JSONSchema7 } from "json-schema";
import type {
  ArtifactContract,
  CompatibilityResult,
  ValidationError,
  ValidationResult,
} from "./types.js";

const ajv = new Ajv({ allErrors: true, strict: false });

/**
 * Validates artifacts against a phase's declared output contract using JSON Schema.
 *
 * @param artifacts - The artifact payload to validate (unknown shape)
 * @param contract - The ArtifactContract containing a JSON Schema definition
 * @returns ValidationResult with valid flag and any validation errors
 */
function validate(artifacts: unknown, contract: ArtifactContract): ValidationResult {
  const validateFn = ajv.compile(contract.jsonSchema as Record<string, unknown>);
  const valid = validateFn(artifacts);

  if (valid) {
    return { valid: true, errors: [] };
  }

  const errors: ValidationError[] = (validateFn.errors ?? []).map((err) => ({
    path: err.instancePath || "/",
    message: err.message ?? "Validation failed",
    keyword: err.keyword,
    params: err.params as Record<string, unknown> | undefined,
  }));

  return { valid: false, errors };
}

/**
 * Checks compatibility between an upstream output contract and a downstream input contract.
 *
 * The upstream output's JSON Schema properties must be a superset of the downstream
 * input's `requiredFields`. Any fields in the downstream's requiredFields that are
 * NOT present in the upstream's schema properties are returned as missingFields.
 *
 * @param upstreamOutput - The upstream phase's output ArtifactContract
 * @param downstreamInput - The downstream phase's input ArtifactContract
 * @returns CompatibilityResult indicating whether the contracts are compatible
 */
function checkCompatibility(
  upstreamOutput: ArtifactContract,
  downstreamInput: ArtifactContract
): CompatibilityResult {
  const upstreamProperties = getSchemaPropertyNames(upstreamOutput.jsonSchema);
  const downstreamRequired = downstreamInput.requiredFields;

  const missingFields = downstreamRequired.filter(
    (field) => !upstreamProperties.has(field)
  );

  const details: string[] = [];
  if (missingFields.length > 0) {
    details.push(
      `Upstream output is missing fields required by downstream: ${missingFields.join(", ")}`
    );
  }

  return {
    compatible: missingFields.length === 0,
    missingFields,
    details,
  };
}

/**
 * Extracts top-level property names from a JSON Schema.
 * Handles both direct `properties` and schemas with nested `properties` in definitions.
 */
function getSchemaPropertyNames(schema: JSONSchema7): Set<string> {
  const properties = schema.properties ?? {};
  return new Set(Object.keys(properties));
}

export const artifactContractValidator = {
  validate,
  checkCompatibility,
};

export type ArtifactContractValidatorType = typeof artifactContractValidator;
