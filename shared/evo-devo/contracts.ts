import { z } from "zod";

export const EVO_DEVO_SCHEMA_VERSION = "1.0.0" as const;

const stableId = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const stringMap = z.record(z.string());

/**
 * A genome step's capability must be a capability the platform could actually
 * register.
 *
 * `stableId` permits uppercase, dots, colons and hyphens — so `Triage.Agent:v2`
 * was a valid genome capability while the registry's own
 * CAPABILITY_ID_PATTERN (`^[a-z0-9_]+$`) could never mint such an id. Genomes
 * were free to name capabilities that can never exist, and nothing noticed
 * until a phenotype was run.
 *
 * Duplicated rather than imported from `@shared/schema/capabilities` on
 * purpose: this module is deliberately dependency-free so the evo-devo algebra
 * stays testable without pulling in drizzle and the schema barrel. The
 * `capabilityIdPatternsAgree` test in contracts.test.ts fails if the two ever
 * drift apart, which is the real risk a copy introduces.
 */
export const EVO_DEVO_CAPABILITY_ID_PATTERN = /^[a-z0-9_]+$/;

const capabilityId = z
  .string()
  .min(1)
  .max(128)
  .regex(
    EVO_DEVO_CAPABILITY_ID_PATTERN,
    "capability must match ^[a-z0-9_]+$ to be registrable in the capability registry",
  );

export const genomeStepSchema = z.object({
  id: stableId,
  kind: z.enum(["agent", "tool", "decision", "approval"]),
  capability: capabilityId,
  dependsOn: z.array(stableId).default([]),
  config: z.record(z.unknown()).default({}),
  permissions: z.array(stableId).default([]),
});

export const developmentalRuleSchema = z.object({
  id: stableId,
  stage: z.enum(["embryonic", "validation", "differentiation", "sandbox", "shadow", "canary", "mature"]),
  when: z.object({ key: stableId, equals: z.union([z.string(), z.number(), z.boolean()]) }),
  action: z.discriminatedUnion("type", [
    z.object({ type: z.literal("enable_step"), stepId: stableId }),
    z.object({ type: z.literal("disable_step"), stepId: stableId }),
    z.object({ type: z.literal("require_approval"), capability: capabilityId }),
  ]),
});

export const genomeDocumentSchema = z.object({
  schemaVersion: z.literal(EVO_DEVO_SCHEMA_VERSION),
  id: stableId,
  organizationId: z.number().int().positive(),
  speciesId: stableId,
  generation: z.number().int().nonnegative(),
  parentIds: z.array(stableId).max(2).default([]),
  steps: z.array(genomeStepSchema).min(1),
  developmentalRules: z.array(developmentalRuleSchema).default([]),
  protectedLoci: z.array(z.string().min(1)).default([]),
  metadata: stringMap.default({}),
});

export const developmentEnvironmentSchema = z.object({
  schemaVersion: z.literal(EVO_DEVO_SCHEMA_VERSION),
  id: stableId,
  organizationId: z.number().int().positive(),
  capabilities: z.array(stableId),
  allowedPermissions: z.array(stableId),
  signals: z.record(z.union([z.string(), z.number(), z.boolean()])).default({}),
  maxSteps: z.number().int().positive().default(100),
});

export const phenotypeStepSchema = genomeStepSchema.extend({
  sourceGeneId: stableId,
  generatedByRuleId: stableId.optional(),
});

export const phenotypeDocumentSchema = z.object({
  schemaVersion: z.literal(EVO_DEVO_SCHEMA_VERSION),
  genomeId: stableId,
  environmentId: stableId,
  compilerVersion: z.string().min(1),
  seed: z.number().int(),
  steps: z.array(phenotypeStepSchema),
  requiredApprovals: z.array(stableId),
  trace: z.record(z.object({ geneId: stableId, ruleId: stableId.optional() })),
  contentHash: z.string().min(1),
});

export type GenomeDocument = z.infer<typeof genomeDocumentSchema>;
export type DevelopmentEnvironment = z.infer<typeof developmentEnvironmentSchema>;
export type PhenotypeDocument = z.infer<typeof phenotypeDocumentSchema>;

export const genomeMutationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("replace_step_config"), stepId: stableId, config: z.record(z.unknown()) }),
  // A mutation is the other way an unregistrable capability could enter a
  // genome — validating only at registration would leave descendants unchecked.
  z.object({ type: z.literal("replace_step_capability"), stepId: stableId, capability: capabilityId }),
  z.object({ type: z.literal("replace_step_permissions"), stepId: stableId, permissions: z.array(stableId) }),
]);
export type GenomeMutation = z.infer<typeof genomeMutationSchema>;

export const fitnessVectorSchema = z.object({
  outcome: z.number().min(0).max(1),
  reliability: z.number().min(0).max(1),
  safety: z.number().min(0).max(1),
  humanExperience: z.number().min(0).max(1),
  costUsd: z.number().nonnegative(),
  latencyMs: z.number().nonnegative(),
  sampleSize: z.number().int().positive(),
});

export const evaluatedIndividualSchema = z.object({
  genomeId: stableId,
  phenotypeHash: z.string().min(1),
  fitness: fitnessVectorSchema,
  eligible: z.boolean(),
  ineligibilityReasons: z.array(z.string()).default([]),
});
export type FitnessVector = z.infer<typeof fitnessVectorSchema>;
export type EvaluatedIndividual = z.infer<typeof evaluatedIndividualSchema>;
