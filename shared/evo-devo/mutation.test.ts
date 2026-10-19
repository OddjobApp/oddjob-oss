import { describe, expect, it } from "vitest";
import { createDescendant } from "./mutation.js";
import type { GenomeDocument } from "./contracts.js";

const parent: GenomeDocument = {
  schemaVersion: "1.0.0", id: "parent", organizationId: 1, speciesId: "species", generation: 2,
  parentIds: ["grandparent"], developmentalRules: [], metadata: {},
  protectedLoci: ["steps.safe.permissions"],
  steps: [{ id: "safe", kind: "agent", capability: "work", dependsOn: [], config: {}, permissions: ["read"] }],
};

describe("createDescendant", () => {
  it("creates an immutable next-generation child", () => {
    const child = createDescendant(parent, "child", { type: "replace_step_config", stepId: "safe", config: { retries: 2 } });
    expect(child).toMatchObject({ id: "child", generation: 3, parentIds: ["parent"] });
    expect(child.steps[0].config).toEqual({ retries: 2 });
    expect(parent.steps[0].config).toEqual({});
  });

  it("rejects mutation of protected loci", () => {
    expect(() => createDescendant(parent, "child", {
      type: "replace_step_permissions", stepId: "safe", permissions: ["admin"],
    })).toThrowError(expect.objectContaining({ code: "PROTECTED_LOCUS" }));
  });
});

