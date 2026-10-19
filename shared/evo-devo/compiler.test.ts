import { describe, expect, it } from "vitest";
import { developGenome, DevelopmentError } from "./compiler.js";
import type { DevelopmentEnvironment, GenomeDocument } from "./contracts.js";

const genome: GenomeDocument = {
  schemaVersion: "1.0.0",
  id: "genome-1",
  organizationId: 7,
  speciesId: "support-flow",
  generation: 0,
  parentIds: [],
  steps: [
    { id: "triage", kind: "agent", capability: "classify", dependsOn: [], config: {}, permissions: ["tickets:read"] },
    { id: "resolve", kind: "tool", capability: "resolve", dependsOn: ["triage"], config: {}, permissions: ["tickets:write"] },
  ],
  developmentalRules: [{
    id: "regulated-approval",
    stage: "validation",
    when: { key: "risk", equals: "high" },
    action: { type: "require_approval", capability: "resolve" },
  }],
  protectedLoci: ["steps.triage.permissions"],
  metadata: {},
};

const environment: DevelopmentEnvironment = {
  schemaVersion: "1.0.0",
  id: "sandbox-1",
  organizationId: 7,
  capabilities: ["classify", "resolve"],
  allowedPermissions: ["tickets:read", "tickets:write"],
  signals: { risk: "high" },
  maxSteps: 10,
};

describe("developGenome", () => {
  it("is deterministic and creates a complete gene trace", () => {
    const first = developGenome(genome, environment, 42);
    const replay = developGenome(structuredClone(genome), structuredClone(environment), 42);
    expect(replay).toEqual(first);
    expect(first.trace).toEqual({ triage: { geneId: "triage" }, resolve: { geneId: "resolve" } });
    expect(first.requiredApprovals).toEqual(["resolve"]);
  });

  it("does not mutate its genome", () => {
    const before = structuredClone(genome);
    developGenome(genome, environment);
    expect(genome).toEqual(before);
  });

  it("refuses permission escalation", () => {
    const restricted = { ...environment, allowedPermissions: ["tickets:read"] };
    expect(() => developGenome(genome, restricted)).toThrowError(
      expect.objectContaining<Partial<DevelopmentError>>({ code: "PERMISSION_ESCALATION" }),
    );
  });

  it("refuses dangling dependencies after regulation", () => {
    const regulated: GenomeDocument = {
      ...genome,
      developmentalRules: [{
        id: "disable-parent",
        stage: "validation",
        when: { key: "risk", equals: "high" },
        action: { type: "disable_step", stepId: "triage" },
      }],
    };
    expect(() => developGenome(regulated, environment)).toThrowError(
      expect.objectContaining<Partial<DevelopmentError>>({ code: "DANGLING_DEPENDENCY" }),
    );
  });

  it("enforces organization isolation", () => {
    expect(() => developGenome(genome, { ...environment, organizationId: 8 })).toThrowError(
      expect.objectContaining<Partial<DevelopmentError>>({ code: "ORG_MISMATCH" }),
    );
  });
});

