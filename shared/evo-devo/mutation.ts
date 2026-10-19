import { genomeDocumentSchema, genomeMutationSchema, type GenomeDocument, type GenomeMutation } from "./contracts.js";
import { DevelopmentError } from "./compiler.js";

function mutationLocus(mutation: GenomeMutation): string {
  if (mutation.type === "replace_step_config") return `steps.${mutation.stepId}.config`;
  if (mutation.type === "replace_step_capability") return `steps.${mutation.stepId}.capability`;
  return `steps.${mutation.stepId}.permissions`;
}

export function createDescendant(
  parentInput: GenomeDocument,
  childId: string,
  mutationInput: GenomeMutation,
): GenomeDocument {
  const parent = genomeDocumentSchema.parse(parentInput);
  const mutation = genomeMutationSchema.parse(mutationInput);
  const locus = mutationLocus(mutation);
  if (parent.protectedLoci.some((protectedLocus) => locus === protectedLocus || locus.startsWith(`${protectedLocus}.`))) {
    throw new DevelopmentError(`Mutation targets protected locus ${locus}`, "PROTECTED_LOCUS");
  }
  const stepIndex = parent.steps.findIndex((step) => step.id === mutation.stepId);
  if (stepIndex < 0) throw new DevelopmentError(`Unknown step ${mutation.stepId}`, "UNKNOWN_LOCUS");

  const child = structuredClone(parent);
  child.id = childId;
  child.generation = parent.generation + 1;
  child.parentIds = [parent.id];
  const step = child.steps[stepIndex];
  if (mutation.type === "replace_step_config") step.config = mutation.config;
  if (mutation.type === "replace_step_capability") step.capability = mutation.capability;
  if (mutation.type === "replace_step_permissions") step.permissions = mutation.permissions;
  return genomeDocumentSchema.parse(child);
}

