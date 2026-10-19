import { describe, it, expect } from "vitest";
import { artifactContractValidator } from "../core/artifact-contract-validator.js";
import type { ArtifactContract } from "../core/types.js";

describe("ArtifactContractValidator", () => {
  describe("validate", () => {
    const contract: ArtifactContract = {
      schemaVersion: "1.0.0",
      jsonSchema: {
        type: "object",
        required: ["prd", "test_scenarios"],
        properties: {
          prd: { type: "object" },
          test_scenarios: { type: "array", items: { type: "object" } },
        },
      },
      requiredFields: ["prd", "test_scenarios"],
    };

    it("should return valid for artifacts that match the contract schema", () => {
      const artifacts = {
        prd: { title: "My PRD" },
        test_scenarios: [{ name: "scenario 1" }],
      };

      const result = artifactContractValidator.validate(artifacts, contract);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should return invalid when required fields are missing", () => {
      const artifacts = {
        prd: { title: "My PRD" },
        // missing test_scenarios
      };

      const result = artifactContractValidator.validate(artifacts, contract);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].keyword).toBe("required");
    });

    it("should return invalid when field types do not match", () => {
      const artifacts = {
        prd: "not an object",
        test_scenarios: [{ name: "scenario 1" }],
      };

      const result = artifactContractValidator.validate(artifacts, contract);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.keyword === "type")).toBe(true);
    });

    it("should return valid for artifacts with extra properties", () => {
      const artifacts = {
        prd: { title: "My PRD" },
        test_scenarios: [{ name: "scenario 1" }],
        extra_field: "bonus data",
      };

      const result = artifactContractValidator.validate(artifacts, contract);
      expect(result.valid).toBe(true);
    });

    it("should handle empty objects when no properties are required", () => {
      const permissiveContract: ArtifactContract = {
        schemaVersion: "1.0.0",
        jsonSchema: { type: "object" },
        requiredFields: [],
      };

      const result = artifactContractValidator.validate({}, permissiveContract);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("checkCompatibility", () => {
    it("should return compatible when upstream has all required downstream fields", () => {
      const upstreamOutput: ArtifactContract = {
        schemaVersion: "1.0.0",
        jsonSchema: {
          type: "object",
          properties: {
            prd: { type: "object" },
            test_scenarios: { type: "array" },
            notes: { type: "string" },
          },
        },
        requiredFields: ["prd", "test_scenarios"],
      };

      const downstreamInput: ArtifactContract = {
        schemaVersion: "1.0.0",
        jsonSchema: { type: "object" },
        requiredFields: ["prd", "test_scenarios"],
      };

      const result = artifactContractValidator.checkCompatibility(
        upstreamOutput,
        downstreamInput
      );
      expect(result.compatible).toBe(true);
      expect(result.missingFields).toHaveLength(0);
      expect(result.details).toHaveLength(0);
    });

    it("should return incompatible when upstream is missing required downstream fields", () => {
      const upstreamOutput: ArtifactContract = {
        schemaVersion: "1.0.0",
        jsonSchema: {
          type: "object",
          properties: {
            prd: { type: "object" },
          },
        },
        requiredFields: ["prd"],
      };

      const downstreamInput: ArtifactContract = {
        schemaVersion: "1.0.0",
        jsonSchema: { type: "object" },
        requiredFields: ["prd", "test_scenarios", "acceptance_criteria"],
      };

      const result = artifactContractValidator.checkCompatibility(
        upstreamOutput,
        downstreamInput
      );
      expect(result.compatible).toBe(false);
      expect(result.missingFields).toEqual(["test_scenarios", "acceptance_criteria"]);
      expect(result.details.length).toBeGreaterThan(0);
    });

    it("should return compatible when downstream has no required fields", () => {
      const upstreamOutput: ArtifactContract = {
        schemaVersion: "1.0.0",
        jsonSchema: {
          type: "object",
          properties: { anything: { type: "string" } },
        },
        requiredFields: [],
      };

      const downstreamInput: ArtifactContract = {
        schemaVersion: "1.0.0",
        jsonSchema: { type: "object" },
        requiredFields: [],
      };

      const result = artifactContractValidator.checkCompatibility(
        upstreamOutput,
        downstreamInput
      );
      expect(result.compatible).toBe(true);
      expect(result.missingFields).toHaveLength(0);
    });

    it("should check against upstream schema properties, not upstream requiredFields", () => {
      // Upstream declares properties a, b, c but only requires a
      // Downstream requires a, b (both are in upstream properties)
      const upstreamOutput: ArtifactContract = {
        schemaVersion: "1.0.0",
        jsonSchema: {
          type: "object",
          properties: {
            a: { type: "string" },
            b: { type: "number" },
            c: { type: "boolean" },
          },
        },
        requiredFields: ["a"],
      };

      const downstreamInput: ArtifactContract = {
        schemaVersion: "1.0.0",
        jsonSchema: { type: "object" },
        requiredFields: ["a", "b"],
      };

      const result = artifactContractValidator.checkCompatibility(
        upstreamOutput,
        downstreamInput
      );
      expect(result.compatible).toBe(true);
      expect(result.missingFields).toHaveLength(0);
    });

    it("should handle upstream schema with no properties defined", () => {
      const upstreamOutput: ArtifactContract = {
        schemaVersion: "1.0.0",
        jsonSchema: { type: "object" },
        requiredFields: [],
      };

      const downstreamInput: ArtifactContract = {
        schemaVersion: "1.0.0",
        jsonSchema: { type: "object" },
        requiredFields: ["needed_field"],
      };

      const result = artifactContractValidator.checkCompatibility(
        upstreamOutput,
        downstreamInput
      );
      expect(result.compatible).toBe(false);
      expect(result.missingFields).toEqual(["needed_field"]);
    });
  });
});
