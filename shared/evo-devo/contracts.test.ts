import { describe, expect, it } from "vitest";
import { CAPABILITY_ID_PATTERN } from "../schema/capabilities/manifest.js";
import {
  EVO_DEVO_CAPABILITY_ID_PATTERN,
  genomeDocumentSchema,
  genomeMutationSchema,
} from "./contracts.js";

/**
 * Genome capabilities must be capabilities the platform could actually register.
 *
 * Before this, a step's `capability` was a loose `stableId` allowing uppercase,
 * dots, colons and hyphens, while the registry's own pattern is `^[a-z0-9_]+$`.
 * A genome could therefore name `Triage.Agent:v2` — an id the registry can
 * never mint — and nothing would notice until the phenotype ran.
 */

function genomeWith(capability: string) {
  return {
    schemaVersion: "1.0.0",
    id: "founder",
    speciesId: "support",
    organizationId: 1,
    generation: 0,
    parentIds: [],
    steps: [{ id: "triage", kind: "agent", capability, dependsOn: [], config: {}, permissions: [] }],
    developmentalRules: [],
    protectedLoci: [],
    metadata: {},
  };
}

describe("genome capability identifiers", () => {
  it("agrees with the capability registry's own pattern", () => {
    // The evo-devo copy exists so this module stays dependency-free. That is
    // only safe while the two definitions are identical — this test is what
    // makes the duplication safe rather than a latent divergence.
    expect(EVO_DEVO_CAPABILITY_ID_PATTERN.source).toBe(CAPABILITY_ID_PATTERN.source);
  });

  it("accepts an id the registry could mint", () => {
    expect(genomeDocumentSchema.safeParse(genomeWith("triage_agent")).success).toBe(true);
  });

  it.each([
    ["uppercase", "TriageAgent"],
    ["dots", "triage.agent"],
    ["colons", "triage:v2"],
    ["hyphens", "triage-agent"],
  ])("rejects a capability the registry could never mint (%s)", (_label, capability) => {
    const result = genomeDocumentSchema.safeParse(genomeWith(capability));
    expect(result.success).toBe(false);
  });

  it("rejects an unregistrable capability introduced by MUTATION, not just registration", () => {
    // Descendants are the other entry point. Validating only founder genomes
    // would leave every child unchecked.
    const result = genomeMutationSchema.safeParse({
      type: "replace_step_capability",
      stepId: "triage",
      capability: "Triage.Agent:v2",
    });
    expect(result.success).toBe(false);
  });

  it("still accepts a valid capability replacement", () => {
    const result = genomeMutationSchema.safeParse({
      type: "replace_step_capability",
      stepId: "triage",
      capability: "escalation_router",
    });
    expect(result.success).toBe(true);
  });
});
