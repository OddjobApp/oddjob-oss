import {
  developmentEnvironmentSchema,
  genomeDocumentSchema,
  phenotypeDocumentSchema,
  type DevelopmentEnvironment,
  type GenomeDocument,
  type PhenotypeDocument,
} from "./contracts.js";

export const EVO_DEVO_COMPILER_VERSION = "1.0.0";

export class DevelopmentError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "DevelopmentError";
  }
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

// Stable, dependency-free FNV-1a identifier. Persistence may additionally use a
// cryptographic digest; this hash exists to make browser and Node replays equal.
export function stableContentHash(value: unknown): string {
  const input = canonicalize(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function assertUniqueIds(values: Array<{ id: string }>, label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value.id)) throw new DevelopmentError(`Duplicate ${label} id: ${value.id}`, "DUPLICATE_ID");
    seen.add(value.id);
  }
}

function assertAcyclic(steps: Array<{ id: string; dependsOn: string[] }>): void {
  const ids = new Set(steps.map((step) => step.id));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(steps.map((step) => [step.id, step]));
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new DevelopmentError(`Cycle detected at step ${id}`, "CYCLIC_PHENOTYPE");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id)?.dependsOn ?? []) {
      if (!ids.has(dependency)) throw new DevelopmentError(`Unknown dependency ${dependency}`, "DANGLING_DEPENDENCY");
      visit(dependency);
    }
    visiting.delete(id);
    visited.add(id);
  };
  steps.forEach((step) => visit(step.id));
}

export function developGenome(
  genomeInput: GenomeDocument,
  environmentInput: DevelopmentEnvironment,
  seed = 0,
): PhenotypeDocument {
  const genome = genomeDocumentSchema.parse(genomeInput);
  const environment = developmentEnvironmentSchema.parse(environmentInput);
  if (genome.organizationId !== environment.organizationId) {
    throw new DevelopmentError("Genome and environment belong to different organizations", "ORG_MISMATCH");
  }
  assertUniqueIds(genome.steps, "gene");
  assertUniqueIds(genome.developmentalRules, "developmental rule");

  const enabled = new Set(genome.steps.map((step) => step.id));
  const ruleForStep = new Map<string, string>();
  const requiredApprovals = new Set<string>();
  for (const rule of genome.developmentalRules) {
    if (environment.signals[rule.when.key] !== rule.when.equals) continue;
    if (rule.action.type === "enable_step") enabled.add(rule.action.stepId);
    if (rule.action.type === "disable_step") enabled.delete(rule.action.stepId);
    if (rule.action.type === "require_approval") requiredApprovals.add(rule.action.capability);
    if (rule.action.type !== "require_approval") ruleForStep.set(rule.action.stepId, rule.id);
  }

  const capabilitySet = new Set(environment.capabilities);
  const permissionSet = new Set(environment.allowedPermissions);
  const steps = genome.steps.filter((step) => enabled.has(step.id)).map((step) => {
    if (!capabilitySet.has(step.capability)) {
      throw new DevelopmentError(`Capability ${step.capability} is unavailable`, "MISSING_CAPABILITY");
    }
    const excessive = step.permissions.filter((permission) => !permissionSet.has(permission));
    if (excessive.length) {
      throw new DevelopmentError(`Step ${step.id} requests disallowed permissions: ${excessive.join(", ")}`, "PERMISSION_ESCALATION");
    }
    return { ...step, sourceGeneId: step.id, generatedByRuleId: ruleForStep.get(step.id) };
  });
  if (steps.length > environment.maxSteps) throw new DevelopmentError("Phenotype exceeds environment step limit", "STEP_LIMIT");
  assertAcyclic(steps);

  const trace = Object.fromEntries(steps.map((step) => [step.id, {
    geneId: step.sourceGeneId,
    ...(step.generatedByRuleId ? { ruleId: step.generatedByRuleId } : {}),
  }]));
  const unhashed = {
    schemaVersion: genome.schemaVersion,
    genomeId: genome.id,
    environmentId: environment.id,
    compilerVersion: EVO_DEVO_COMPILER_VERSION,
    seed,
    steps,
    requiredApprovals: [...requiredApprovals].sort(),
    trace,
  };
  return phenotypeDocumentSchema.parse({ ...unhashed, contentHash: stableContentHash(unhashed) });
}

