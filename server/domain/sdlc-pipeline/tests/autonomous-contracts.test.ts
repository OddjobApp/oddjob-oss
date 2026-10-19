/**
 * Tests for autonomous pipeline artifact contracts.
 *
 * Validates that the JSON Schema contracts defined in contracts.ts correctly
 * validate conforming artifacts and reject non-conforming artifacts using the
 * existing artifactContractValidator.
 */

import { describe, it, expect } from "vitest";
import { artifactContractValidator } from "../core/artifact-contract-validator.js";
import {
  repositoryContextContract,
  editPlanContract,
  verificationReportContract,
  testLoopResultContract,
  gateResultContract,
  prResultContract,
  assemblyManifestContract,
  registerAutonomousContracts,
  autonomousPhaseContracts,
} from "../autonomous/contracts.js";

describe("Autonomous Pipeline Artifact Contracts", () => {
  describe("assemblyManifestContract", () => {
    const validAssemblyManifest = {
      matchedComponents: [
        {
          name: "MetricSummaryCard",
          category: "ui-data-viz",
          importPath: "@oddjob/design-system",
          exportType: "named",
          propSchema: { title: "string" },
          codeSnippet: "<MetricSummaryCard title='Test' value='10' />",
          effectivenessScore: 4.9,
        },
      ],
      componentImports: ['import { MetricSummaryCard } from "@oddjob/design-system";'],
      suggestedBlueprints: ["<MetricSummaryCard title='{{title}}' value='{{value}}' />"],
      assemblyContext: {
        targetLanguages: ["typescript"],
        relevantFilesCount: 5,
        recommendedPatterns: ["MetricSummaryCard"],
      },
    };

    it("should validate a conforming assembly manifest", () => {
      const result = artifactContractValidator.validate(validAssemblyManifest, assemblyManifestContract);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should reject when required fields are missing", () => {
      const { assemblyContext, ...incomplete } = validAssemblyManifest;
      const result = artifactContractValidator.validate(incomplete, assemblyManifestContract);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.keyword === "required")).toBe(true);
    });
  });

  describe("repositoryContextContract", () => {
    const validContext = {
      projectStructure: [{ path: "src/index.ts", type: "file", language: "typescript" }],
      dependencyGraph: {
        nodes: [{ filePath: "src/index.ts", exports: ["main"], language: "typescript" }],
        edges: [{ source: "src/app.ts", target: "src/index.ts", importType: "static" }],
      },
      conventions: {
        namingPatterns: [{ scope: "files", pattern: "kebab-case", examples: ["my-file.ts"] }],
        formattingRules: [{ rule: "indent", value: 2 }],
        architecturalPatterns: ["service-layer"],
        testingConventions: [{ framework: "vitest", filePattern: "*.test.ts", location: "co-located" }],
      },
      languageMetadata: {
        primaryLanguage: "typescript",
        frameworks: ["express"],
        packageManager: "npm",
      },
      relevantFiles: [{ path: "src/index.ts", content: "export const main = () => {};", relevanceScore: 0.9 }],
      tokenCount: 5000,
    };

    it("should validate a conforming repository context", () => {
      const result = artifactContractValidator.validate(validContext, repositoryContextContract);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should reject when required fields are missing", () => {
      const { tokenCount, ...incomplete } = validContext;
      const result = artifactContractValidator.validate(incomplete, repositoryContextContract);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.keyword === "required")).toBe(true);
    });

    it("should reject invalid relevanceScore outside 0-1", () => {
      const invalid = {
        ...validContext,
        relevantFiles: [{ path: "x.ts", content: "code", relevanceScore: 1.5 }],
      };
      const result = artifactContractValidator.validate(invalid, repositoryContextContract);
      expect(result.valid).toBe(false);
    });
  });

  describe("editPlanContract", () => {
    const validPlan = {
      sessionId: "session-123",
      objective: "Add user authentication",
      operations: [
        {
          id: "op-1",
          type: "create",
          filePath: "src/auth.ts",
          dependsOn: [],
          rationale: "New module following service-layer pattern",
          newContent: "export class AuthService {}",
        },
      ],
      dependencyOrder: ["op-1"],
      totalFileCount: 1,
      requiresHumanReview: false,
    };

    it("should validate a conforming edit plan", () => {
      const result = artifactContractValidator.validate(validPlan, editPlanContract);
      expect(result.valid).toBe(true);
    });

    it("should reject edit plan with empty objective", () => {
      const invalid = { ...validPlan, objective: "" };
      const result = artifactContractValidator.validate(invalid, editPlanContract);
      expect(result.valid).toBe(false);
    });

    it("should reject operation with empty rationale", () => {
      const invalid = {
        ...validPlan,
        operations: [{ ...validPlan.operations[0], rationale: "" }],
      };
      const result = artifactContractValidator.validate(invalid, editPlanContract);
      expect(result.valid).toBe(false);
    });
  });

  describe("verificationReportContract", () => {
    const validReport = {
      sessionId: "session-123",
      verificationLevel: "full_test",
      timeline: [
        {
          timestamp: "2025-01-01T00:00:00.000Z",
          type: "step_check",
          status: "passed",
          details: {},
          duration: 1200,
        },
      ],
      summary: {
        totalChecks: 5,
        passed: 4,
        failed: 1,
        fixAttempts: 2,
        successfulFixes: 1,
        totalDuration: 30000,
      },
      finalStatus: "has_failures",
    };

    it("should validate a conforming verification report", () => {
      const result = artifactContractValidator.validate(validReport, verificationReportContract);
      expect(result.valid).toBe(true);
    });

    it("should reject invalid verificationLevel", () => {
      const invalid = { ...validReport, verificationLevel: "extreme" };
      const result = artifactContractValidator.validate(invalid, verificationReportContract);
      expect(result.valid).toBe(false);
    });
  });

  describe("testLoopResultContract", () => {
    const validResult = {
      status: "all_passed",
      totalAttempts: 2,
      fixAttempts: [
        {
          attemptNumber: 1,
          timestamp: "2025-01-01T00:00:00.000Z",
          diagnosis: {
            testFile: "src/auth.test.ts",
            testName: "should authenticate user",
            errorMessage: "Expected true to be false",
            rootCause: "Missing null check",
            affectedFile: "src/auth.ts",
            suggestedApproach: "Add null guard at line 42",
          },
          appliedFix: {
            filePath: "src/auth.ts",
            changes: [],
            description: "Added null check before accessing user.email",
          },
          outcome: "resolved",
          duration: 5000,
          newFailuresIntroduced: [],
        },
      ],
      passingTests: ["src/auth.test.ts"],
      failingTests: [],
      duration: 12000,
    };

    it("should validate a conforming test loop result", () => {
      const result = artifactContractValidator.validate(validResult, testLoopResultContract);
      expect(result.valid).toBe(true);
    });

    it("should reject invalid status enum value", () => {
      const invalid = { ...validResult, status: "unknown_status" };
      const result = artifactContractValidator.validate(invalid, testLoopResultContract);
      expect(result.valid).toBe(false);
    });
  });

  describe("gateResultContract", () => {
    const validGateResult = {
      passed: true,
      evaluatedAt: "2025-01-01T12:00:00.000Z",
      checks: [
        { name: "lint", description: "ESLint passes", passed: true },
        { name: "type_check", description: "TypeScript compiles", passed: true },
      ],
      blockingFailures: [],
    };

    it("should validate a conforming gate result", () => {
      const result = artifactContractValidator.validate(validGateResult, gateResultContract);
      expect(result.valid).toBe(true);
    });

    it("should validate a failing gate result with blocking failures", () => {
      const failing = {
        passed: false,
        evaluatedAt: "2025-01-01T12:00:00.000Z",
        checks: [{ name: "tests", description: "Unit tests", passed: false }],
        blockingFailures: [
          { check: "tests", reason: "3 test failures remain", testFile: "src/auth.test.ts" },
        ],
      };
      const result = artifactContractValidator.validate(failing, gateResultContract);
      expect(result.valid).toBe(true);
    });
  });

  describe("prResultContract", () => {
    const validPRResult = {
      branchName: "codegen/session-123/add-auth",
      commitSha: "abc123def456",
      prUrl: "https://github.com/org/repo/pull/42",
      prNumber: 42,
      description: "Adds user authentication module with JWT support",
      testEvidence: {
        totalTests: 15,
        passingTests: 15,
        fixAttempts: 2,
        verificationTimeline: "## Verification\n- All 15 tests passing",
      },
    };

    it("should validate a conforming PR result", () => {
      const result = artifactContractValidator.validate(validPRResult, prResultContract);
      expect(result.valid).toBe(true);
    });

    it("should reject PR result with empty branchName", () => {
      const invalid = { ...validPRResult, branchName: "" };
      const result = artifactContractValidator.validate(invalid, prResultContract);
      expect(result.valid).toBe(false);
    });

    it("should reject PR result with prNumber less than 1", () => {
      const invalid = { ...validPRResult, prNumber: 0 };
      const result = artifactContractValidator.validate(invalid, prResultContract);
      expect(result.valid).toBe(false);
    });
  });

  describe("registerAutonomousContracts()", () => {
    it("should return output contracts for all 7 phases", () => {
      const contracts = registerAutonomousContracts();
      expect(Object.keys(contracts)).toHaveLength(7);
      expect(contracts.context_load.output_contract).toBe(repositoryContextContract);
      expect(contracts.component_lookup.output_contract).toBe(assemblyManifestContract);
      expect(contracts.change_plan.output_contract).toBe(editPlanContract);
      expect(contracts.apply_edits.output_contract).toBe(verificationReportContract);
      expect(contracts.test_loop.output_contract).toBe(testLoopResultContract);
      expect(contracts.quality_gate.output_contract).toBe(gateResultContract);
      expect(contracts.pr_generation.output_contract).toBe(prResultContract);
    });

    it("should return contracts with valid schemaVersion and mimeType", () => {
      const contracts = registerAutonomousContracts();
      for (const [, { output_contract }] of Object.entries(contracts)) {
        expect(output_contract.schemaVersion).toBe("2025-01-01");
        expect(output_contract.mimeType).toBe("application/json");
        expect(output_contract.jsonSchema).toBeDefined();
        expect(output_contract.requiredFields.length).toBeGreaterThan(0);
      }
    });
  });

  describe("autonomousPhaseContracts mapping", () => {
    it("should map each phase to its artifact name and contract", () => {
      expect(autonomousPhaseContracts.context_load.artifactName).toBe("repository_context");
      expect(autonomousPhaseContracts.component_lookup.artifactName).toBe("assembly_manifest");
      expect(autonomousPhaseContracts.change_plan.artifactName).toBe("edit_plan");
      expect(autonomousPhaseContracts.apply_edits.artifactName).toBe("verification_report");
      expect(autonomousPhaseContracts.test_loop.artifactName).toBe("test_loop_result");
      expect(autonomousPhaseContracts.quality_gate.artifactName).toBe("gate_result");
      expect(autonomousPhaseContracts.pr_generation.artifactName).toBe("pr_result");
    });
  });
});
