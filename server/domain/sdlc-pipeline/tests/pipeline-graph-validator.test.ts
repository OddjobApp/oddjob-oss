import { describe, it, expect } from "vitest";
import {
  validatePipelineGraph,
  type PhaseDefinition,
  type PipelineTemplateConfig,
} from "../core/pipeline-graph-validator.js";

function makeOutputContract(fields: string[]) {
  return {
    schemaVersion: "1.0.0",
    jsonSchema: {
      type: "object" as const,
      required: fields,
      properties: Object.fromEntries(fields.map((f) => [f, { type: "object" }])),
    },
    requiredFields: fields,
  } as any;
}

function makePhase(
  name: string,
  dependencies: string[],
  outputFields: string[],
  inputRequires?: string[]
): PhaseDefinition {
  return {
    name,
    dependencies,
    artifactContracts: {
      output_contract: makeOutputContract(outputFields),
      ...(inputRequires
        ? {
            input_contract: {
              requires: inputRequires,
            },
          }
        : {}),
    },
  };
}

describe("PipelineGraphValidator", () => {
  describe("valid pipelines", () => {
    it("should accept a linear pipeline with compatible contracts", () => {
      const template: PipelineTemplateConfig = {
        phases: [
          makePhase("requirements", [], ["prd", "test_scenarios"]),
          makePhase("design", ["requirements"], ["architecture", "api_specs"], [
            "requirements.prd",
            "requirements.test_scenarios",
          ]),
          makePhase("implementation", ["design"], ["files", "pr_reference"], [
            "design.api_specs",
            "design.architecture",
          ]),
        ],
      };

      const result = validatePipelineGraph(template);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should accept a pipeline with no input contracts (first phase)", () => {
      const template: PipelineTemplateConfig = {
        phases: [makePhase("requirements", [], ["prd"])],
      };

      const result = validatePipelineGraph(template);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should accept a diamond dependency graph without cycles", () => {
      const template: PipelineTemplateConfig = {
        phases: [
          makePhase("start", [], ["data"]),
          makePhase("branch_a", ["start"], ["result_a"], ["start.data"]),
          makePhase("branch_b", ["start"], ["result_b"], ["start.data"]),
          makePhase("merge", ["branch_a", "branch_b"], ["final"], [
            "branch_a.result_a",
            "branch_b.result_b",
          ]),
        ],
      };

      const result = validatePipelineGraph(template);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("cycle detection", () => {
    it("should detect a simple two-node cycle", () => {
      const template: PipelineTemplateConfig = {
        phases: [
          makePhase("a", ["b"], ["output_a"]),
          makePhase("b", ["a"], ["output_b"]),
        ],
      };

      const result = validatePipelineGraph(template);
      expect(result.valid).toBe(false);
      const cycleErrors = result.errors.filter((e) => e.type === "cycle");
      expect(cycleErrors).toHaveLength(1);
      expect(cycleErrors[0].message).toContain("cycle");
    });

    it("should detect a three-node cycle", () => {
      const template: PipelineTemplateConfig = {
        phases: [
          makePhase("a", ["c"], ["output_a"]),
          makePhase("b", ["a"], ["output_b"]),
          makePhase("c", ["b"], ["output_c"]),
        ],
      };

      const result = validatePipelineGraph(template);
      expect(result.valid).toBe(false);
      const cycleErrors = result.errors.filter((e) => e.type === "cycle");
      expect(cycleErrors).toHaveLength(1);
      expect(cycleErrors[0].details).toBeDefined();
      expect(cycleErrors[0].details!.length).toBe(3);
    });

    it("should detect a self-referencing cycle", () => {
      const template: PipelineTemplateConfig = {
        phases: [makePhase("a", ["a"], ["output_a"])],
      };

      const result = validatePipelineGraph(template);
      expect(result.valid).toBe(false);
      const cycleErrors = result.errors.filter((e) => e.type === "cycle");
      expect(cycleErrors).toHaveLength(1);
    });
  });

  describe("output contract completeness", () => {
    it("should error when a phase is missing an output contract", () => {
      const template: PipelineTemplateConfig = {
        phases: [
          {
            name: "requirements",
            dependencies: [],
            artifactContracts: {
              // No output_contract!
            },
          },
        ],
      };

      const result = validatePipelineGraph(template);
      expect(result.valid).toBe(false);
      const missingErrors = result.errors.filter(
        (e) => e.type === "missing_output_contract"
      );
      expect(missingErrors).toHaveLength(1);
      expect(missingErrors[0].phase).toBe("requirements");
    });

    it("should error for each phase missing an output contract", () => {
      const template: PipelineTemplateConfig = {
        phases: [
          {
            name: "phase_a",
            dependencies: [],
            artifactContracts: {},
          },
          {
            name: "phase_b",
            dependencies: [],
            artifactContracts: {},
          },
          makePhase("phase_c", [], ["output"]),
        ],
      };

      const result = validatePipelineGraph(template);
      expect(result.valid).toBe(false);
      const missingErrors = result.errors.filter(
        (e) => e.type === "missing_output_contract"
      );
      expect(missingErrors).toHaveLength(2);
      expect(missingErrors.map((e) => e.phase).sort()).toEqual(["phase_a", "phase_b"]);
    });
  });

  describe("contract compatibility", () => {
    it("should error when upstream output is missing required fields", () => {
      const template: PipelineTemplateConfig = {
        phases: [
          makePhase("requirements", [], ["prd"]), // Only has "prd", missing "test_scenarios"
          makePhase("design", ["requirements"], ["architecture"], [
            "requirements.prd",
            "requirements.test_scenarios", // This field doesn't exist in requirements output
          ]),
        ],
      };

      const result = validatePipelineGraph(template);
      expect(result.valid).toBe(false);
      const compatErrors = result.errors.filter(
        (e) => e.type === "incompatible_contract"
      );
      expect(compatErrors).toHaveLength(1);
      expect(compatErrors[0].phase).toBe("design");
    });

    it("should error when referencing an unknown upstream phase", () => {
      const template: PipelineTemplateConfig = {
        phases: [
          makePhase("requirements", [], ["prd"]),
          makePhase("design", ["requirements"], ["architecture"], [
            "nonexistent.field",
          ]),
        ],
      };

      const result = validatePipelineGraph(template);
      expect(result.valid).toBe(false);
      const compatErrors = result.errors.filter(
        (e) => e.type === "incompatible_contract"
      );
      expect(compatErrors).toHaveLength(1);
      expect(compatErrors[0].message).toContain("unknown phase");
    });

    it("should error when upstream has no output contract and downstream needs it", () => {
      const template: PipelineTemplateConfig = {
        phases: [
          {
            name: "requirements",
            dependencies: [],
            artifactContracts: {}, // No output contract
          },
          makePhase("design", ["requirements"], ["architecture"], [
            "requirements.prd",
          ]),
        ],
      };

      const result = validatePipelineGraph(template);
      expect(result.valid).toBe(false);
      const compatErrors = result.errors.filter(
        (e) => e.type === "incompatible_contract"
      );
      expect(compatErrors).toHaveLength(1);
      expect(compatErrors[0].message).toContain("no output contract");
    });
  });

  describe("combined errors", () => {
    it("should report multiple error types simultaneously", () => {
      const template: PipelineTemplateConfig = {
        phases: [
          {
            name: "a",
            dependencies: ["b"],
            artifactContracts: {}, // Missing output contract + in a cycle
          },
          makePhase("b", ["a"], ["data"], ["a.missing_field"]), // Cycle + incompatible
        ],
      };

      const result = validatePipelineGraph(template);
      expect(result.valid).toBe(false);
      // Should have cycle, missing_output_contract, and incompatible_contract errors
      const errorTypes = new Set(result.errors.map((e) => e.type));
      expect(errorTypes.has("cycle")).toBe(true);
      expect(errorTypes.has("missing_output_contract")).toBe(true);
      expect(errorTypes.has("incompatible_contract")).toBe(true);
    });
  });
});
