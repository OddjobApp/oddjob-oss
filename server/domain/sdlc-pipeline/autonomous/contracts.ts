/**
 * Autonomous Codegen Pipeline — Artifact Contract Schemas
 *
 * Defines JSON Schema 7 artifact contracts for each phase of the autonomous
 * code generation pipeline. These contracts are validated by the existing
 * `artifactContractValidator` (AJV) before phase advancement.
 *
 * Phase → Artifact mapping:
 *   context_load   → repository_context
 *   change_plan    → edit_plan
 *   apply_edits    → verification_report
 *   test_loop      → test_loop_result
 *   quality_gate   → gate_result
 *   pr_generation  → pr_result
 *
 * ─── v2 Capability Extensions (additive) ────────────────────────────────────
 * Five enterprise extensions are layered onto the baseline contracts as OPTIONAL
 * telemetry surfaces. They are intentionally NOT added to `requiredFields` / the
 * per-schema `required` arrays, because the validator runs AJV without
 * `additionalProperties: false`; keeping them optional means existing phase
 * producers keep validating while upgraded handlers populate the new blocks.
 * (Nested `required` arrays only bind when the parent block is emitted.)
 *
 *   1. Agentic Consensus Matrix        → edit_plan.consensusMatrix        (Phase 2)
 *   2. Predictive Blast-Radius Scoping → repository_context.blastRadius   (Phase 1)
 *   3. Mock Link Sandboxing            → verification_report.sandboxing   (Phase 3)
 *   4. Automated Mutation Testing      → test_loop_result.mutationTesting (Phase 4)
 *   5. Adaptive Resource Scaling       → edit_plan.adaptiveScaling        (orchestrator)
 */

import type { ArtifactContract } from "../core/types.js";
import type { JSONSchema7 } from "json-schema";

// ─── Schema Version ─────────────────────────────────────────────────────────

const SCHEMA_VERSION = "2025-01-01";

// ─── v2 Extension Sub-Schemas (optional, additive telemetry) ────────────────

/**
 * Extension 2 — Predictive Blast-Radius Scoping (context_load phase).
 *
 * Captures the abstract import-tree trace: for each file targeted for
 * modification, the immediate upstream dependants pulled into context (up to
 * `dependencyTraceDepth`) so downstream regressions are surfaced pre-emptively.
 */
const blastRadiusSchema: JSONSchema7 = {
  type: "object",
  required: [
    "traceDepth",
    "scopedFiles",
    "totalDependantsPulled",
    "regressionRiskScore",
  ],
  properties: {
    traceDepth: { type: "number", minimum: 0 },
    scopedFiles: {
      type: "array",
      items: {
        type: "object",
        required: [
          "targetFile",
          "operationHint",
          "upstreamDependants",
          "autoIncludedInContext",
        ],
        properties: {
          targetFile: { type: "string" },
          operationHint: {
            type: "string",
            enum: ["create", "modify", "delete", "read"],
          },
          upstreamDependants: {
            type: "array",
            items: {
              type: "object",
              required: ["filePath", "importType", "distance", "regressionRisk"],
              properties: {
                filePath: { type: "string" },
                importType: {
                  type: "string",
                  enum: ["static", "dynamic", "type_only"],
                },
                // Hops from the target file in the import tree (1 = direct dependant).
                distance: { type: "number", minimum: 1 },
                regressionRisk: {
                  type: "string",
                  enum: ["low", "medium", "high"],
                },
              },
            },
          },
          // True when this dependant was auto-hoisted into `relevantFiles`.
          autoIncludedInContext: { type: "boolean" },
        },
      },
    },
    totalDependantsPulled: { type: "number", minimum: 0 },
    // Aggregate 0..1 score across all scoped files.
    regressionRiskScore: { type: "number", minimum: 0, maximum: 1 },
  },
};

/**
 * Extension 1 — Agentic Consensus Matrix (change_plan phase).
 *
 * Records the 3-agent internal critique loop that produces the edit plan:
 * Architect (drafts) → Security/Performance (audits) → Refiner (compiles &
 * decides human-review escalation). Scoring logs make the consensus auditable.
 */
const consensusMatrixSchema: JSONSchema7 = {
  type: "object",
  required: ["iterations", "agents", "refinerDecision", "consensusScore"],
  properties: {
    iterations: { type: "number", minimum: 1 },
    architectDraftId: { type: "string" },
    agents: {
      type: "array",
      items: {
        type: "object",
        required: ["role", "confidence", "findings"],
        properties: {
          role: {
            type: "string",
            enum: ["architect", "security_performance", "refiner"],
          },
          model: { type: "string" },
          // Per-agent self-reported confidence in its output (0..1).
          confidence: { type: "number", minimum: 0, maximum: 1 },
          findings: { type: "array", items: { type: "string" } },
          durationMs: { type: "number", minimum: 0 },
        },
      },
    },
    securityAudit: {
      type: "object",
      required: ["tokenLeakFindings", "vulnerabilityPatterns", "dependencyRisks"],
      properties: {
        tokenLeakFindings: {
          type: "array",
          items: {
            type: "object",
            required: ["location", "severity", "description"],
            properties: {
              location: { type: "string" },
              severity: {
                type: "string",
                enum: ["low", "medium", "high", "critical"],
              },
              description: { type: "string" },
            },
          },
        },
        vulnerabilityPatterns: {
          type: "array",
          items: {
            type: "object",
            required: ["pattern", "filePath", "severity"],
            properties: {
              pattern: { type: "string" },
              cwe: { type: "string" },
              filePath: { type: "string" },
              severity: {
                type: "string",
                enum: ["low", "medium", "high", "critical"],
              },
            },
          },
        },
        dependencyRisks: {
          type: "array",
          items: {
            type: "object",
            required: ["dependency", "reason", "severity"],
            properties: {
              dependency: { type: "string" },
              reason: { type: "string" },
              severity: {
                type: "string",
                enum: ["low", "medium", "high", "critical"],
              },
            },
          },
        },
      },
    },
    refinerDecision: {
      type: "object",
      required: ["humanReviewTriggered", "triggerReasons"],
      properties: {
        finalizedBy: { type: "string" },
        // Mirrors the value the Refiner writes to edit_plan.requiresHumanReview.
        humanReviewTriggered: { type: "boolean" },
        triggerReasons: { type: "array", items: { type: "string" } },
        securityCriticalStructuresTargeted: {
          type: "array",
          items: { type: "string" },
        },
      },
    },
    // Cross-agent agreement score (0 = full dissent, 1 = unanimous).
    consensusScore: { type: "number", minimum: 0, maximum: 1 },
    dissentCount: { type: "number", minimum: 0 },
  },
};

/**
 * Extension 5 — Telemetry-Driven Adaptive Resource Scaling (orchestrator).
 *
 * Emitted by the planning phase when it detects an extensive multi-file
 * refactor: records how `contextTokenBudget` / `maxFileCount` were scaled up and
 * how lower-tier analytical blocks were routed to cheaper inference models.
 */
const adaptiveScalingSchema: JSONSchema7 = {
  type: "object",
  required: ["triggered", "trigger", "original", "scaled"],
  properties: {
    triggered: { type: "boolean" },
    trigger: {
      type: "string",
      enum: [
        "none",
        "multi_file_refactor",
        "large_context",
        "high_dependency_fanout",
      ],
    },
    detectedFileCount: { type: "number", minimum: 0 },
    original: {
      type: "object",
      required: ["contextTokenBudget", "maxFileCount"],
      properties: {
        contextTokenBudget: { type: "number", minimum: 0 },
        maxFileCount: { type: "number", minimum: 0 },
      },
    },
    scaled: {
      type: "object",
      required: ["contextTokenBudget", "maxFileCount"],
      properties: {
        contextTokenBudget: { type: "number", minimum: 0 },
        maxFileCount: { type: "number", minimum: 0 },
      },
    },
    modelTierRouting: {
      type: "array",
      items: {
        type: "object",
        required: ["phase", "model", "tier"],
        properties: {
          phase: { type: "string" },
          task: { type: "string" },
          model: { type: "string" },
          tier: {
            type: "string",
            enum: ["premium", "standard", "economy"],
          },
        },
      },
    },
    // Phases intentionally downshifted to cheaper models to fund the scale-up.
    downshiftedPhases: { type: "array", items: { type: "string" } },
    estimatedCostDeltaUsd: { type: "number" },
  },
};

/**
 * Extension 3 — Mock Link Sandboxing (apply_edits phase).
 *
 * Records the external-integration preprocessing pass: detected calls into
 * external API registries (Salesforce, Slack, Twilio, …) and the MSW / sandbox
 * stubs generated to isolate execution from remote network timeouts.
 */
const sandboxingSchema: JSONSchema7 = {
  type: "object",
  required: [
    "enabled",
    "detectedIntegrations",
    "stubbedCallCount",
    "networkIsolationApplied",
  ],
  properties: {
    enabled: { type: "boolean" },
    detectedIntegrations: {
      type: "array",
      items: {
        type: "object",
        required: ["registry", "callSites", "stubStrategy"],
        properties: {
          registry: {
            type: "string",
            enum: [
              "salesforce",
              "slack",
              "twilio",
              "stripe",
              "github",
              "http_generic",
              "other",
            ],
          },
          callSites: {
            type: "array",
            items: {
              type: "object",
              required: ["filePath", "symbol"],
              properties: {
                filePath: { type: "string" },
                symbol: { type: "string" },
                line: { type: "number", minimum: 1 },
              },
            },
          },
          stubStrategy: {
            type: "string",
            enum: ["msw", "sandbox_schema", "in_memory_fake", "none"],
          },
        },
      },
    },
    stubbedCallCount: { type: "number", minimum: 0 },
    // Identifiers/paths of generated Mock Service Worker handlers.
    mswHandlersGenerated: { type: "array", items: { type: "string" } },
    sandboxSchemaRef: { type: "string" },
    networkIsolationApplied: { type: "boolean" },
    // External calls that could not be stubbed (surfaced as a verification risk).
    unstubbedExternalCalls: {
      type: "array",
      items: {
        type: "object",
        required: ["filePath", "symbol", "reason"],
        properties: {
          filePath: { type: "string" },
          symbol: { type: "string" },
          reason: { type: "string" },
        },
      },
    },
  },
};

/**
 * Extension 4 — Automated Mutation Testing (test_loop phase, full_test tier).
 *
 * When the loop reaches `all_passed`, minor syntactic mutations are injected
 * into the newly written blocks and the suite is re-run. Surviving mutations
 * signal a weak assertion suite → `weakAssertionDetected` forces a refactor
 * iteration and the loop status is reported as `weak_assertion`.
 */
const mutationTestingSchema: JSONSchema7 = {
  type: "object",
  required: [
    "enabled",
    "mutationsInjected",
    "injectedCount",
    "survivedCount",
    "killedCount",
    "mutationScore",
    "weakAssertionDetected",
    "forcedRefactorIteration",
  ],
  properties: {
    enabled: { type: "boolean" },
    // Mutation testing only runs at the full_test verification tier.
    tier: { type: "string", enum: ["full_test"] },
    mutationsInjected: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "filePath", "mutationType", "location", "survived"],
        properties: {
          id: { type: "string" },
          filePath: { type: "string" },
          mutationType: {
            type: "string",
            enum: [
              "conditional_boundary",
              "negate_conditional",
              "arithmetic_operator",
              "return_value",
              "remove_call",
              "string_literal",
              "increment",
            ],
          },
          location: {
            type: "object",
            required: ["startLine", "endLine"],
            properties: {
              startLine: { type: "number", minimum: 1 },
              endLine: { type: "number", minimum: 1 },
            },
          },
          // survived === true means no test caught the mutation (a weak spot).
          survived: { type: "boolean" },
          killingTest: { type: "string" },
        },
      },
    },
    injectedCount: { type: "number", minimum: 0 },
    survivedCount: { type: "number", minimum: 0 },
    killedCount: { type: "number", minimum: 0 },
    // killed / injected — 1.0 means every mutation was caught.
    mutationScore: { type: "number", minimum: 0, maximum: 1 },
    weakAssertionDetected: { type: "boolean" },
    forcedRefactorIteration: { type: "boolean" },
    refactorIterationsTriggered: { type: "number", minimum: 0 },
  },
};

// ─── Assembly Manifest Contract (component_lookup phase) ───────────────────

export const assemblyManifestContract: ArtifactContract = {
  schemaVersion: SCHEMA_VERSION,
  mimeType: "application/json",
  requiredFields: [
    "matchedComponents",
    "componentImports",
    "suggestedBlueprints",
    "assemblyContext",
  ],
  jsonSchema: {
    type: "object",
    required: [
      "matchedComponents",
      "componentImports",
      "suggestedBlueprints",
      "assemblyContext",
    ],
    properties: {
      matchedComponents: {
        type: "array",
        items: {
          type: "object",
          required: ["name", "category", "importPath", "exportType", "effectivenessScore"],
          properties: {
            name: { type: "string" },
            category: { type: "string" },
            importPath: { type: "string" },
            exportType: { type: "string" },
            propSchema: { type: "object" },
            codeSnippet: { type: "string" },
            effectivenessScore: { type: "number" },
          },
        },
      },
      componentImports: {
        type: "array",
        items: { type: "string" },
      },
      suggestedBlueprints: {
        type: "array",
        items: { type: "string" },
      },
      assemblyContext: {
        type: "object",
        required: ["targetLanguages", "relevantFilesCount", "recommendedPatterns"],
        properties: {
          targetLanguages: { type: "array", items: { type: "string" } },
          relevantFilesCount: { type: "number" },
          recommendedPatterns: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
};

// ─── Repository Context Contract (context_load phase) ───────────────────────

export const repositoryContextContract: ArtifactContract = {
  schemaVersion: SCHEMA_VERSION,
  mimeType: "application/json",
  requiredFields: [
    "projectStructure",
    "dependencyGraph",
    "conventions",
    "languageMetadata",
    "relevantFiles",
    "tokenCount",
  ],
  jsonSchema: {
    type: "object",
    required: [
      "projectStructure",
      "dependencyGraph",
      "conventions",
      "languageMetadata",
      "relevantFiles",
      "tokenCount",
    ],
    properties: {
      projectStructure: {
        type: "array",
        items: {
          type: "object",
          required: ["path", "type"],
          properties: {
            path: { type: "string" },
            type: { type: "string", enum: ["file", "directory"] },
            language: { type: "string" },
            size: { type: "number", minimum: 0 },
            children: { type: "array" },
          },
        },
      },
      dependencyGraph: {
        type: "object",
        required: ["nodes", "edges"],
        properties: {
          nodes: {
            type: "array",
            items: {
              type: "object",
              required: ["filePath", "exports", "language"],
              properties: {
                filePath: { type: "string" },
                exports: { type: "array", items: { type: "string" } },
                language: { type: "string" },
              },
            },
          },
          edges: {
            type: "array",
            items: {
              type: "object",
              required: ["source", "target", "importType"],
              properties: {
                source: { type: "string" },
                target: { type: "string" },
                importType: {
                  type: "string",
                  enum: ["static", "dynamic", "type_only"],
                },
              },
            },
          },
        },
      },
      conventions: {
        type: "object",
        required: [
          "namingPatterns",
          "formattingRules",
          "architecturalPatterns",
          "testingConventions",
        ],
        properties: {
          namingPatterns: {
            type: "array",
            items: {
              type: "object",
              required: ["scope", "pattern", "examples"],
              properties: {
                scope: { type: "string" },
                pattern: { type: "string" },
                examples: { type: "array", items: { type: "string" } },
              },
            },
          },
          formattingRules: {
            type: "array",
            items: {
              type: "object",
              required: ["rule", "value"],
              properties: {
                rule: { type: "string" },
                value: {},
              },
            },
          },
          architecturalPatterns: {
            type: "array",
            items: { type: "string" },
          },
          testingConventions: {
            type: "array",
            items: {
              type: "object",
              required: ["framework", "filePattern", "location"],
              properties: {
                framework: { type: "string" },
                filePattern: { type: "string" },
                location: { type: "string" },
              },
            },
          },
          prTemplate: { type: "string" },
          branchNaming: { type: "string" },
        },
      },
      languageMetadata: {
        type: "object",
        required: ["primaryLanguage", "frameworks"],
        properties: {
          primaryLanguage: { type: "string" },
          frameworks: { type: "array", items: { type: "string" } },
          packageManager: { type: "string" },
          buildTool: { type: "string" },
          testRunner: { type: "string" },
        },
      },
      relevantFiles: {
        type: "array",
        items: {
          type: "object",
          required: ["path", "content", "relevanceScore"],
          properties: {
            path: { type: "string" },
            content: { type: "string" },
            relevanceScore: { type: "number", minimum: 0, maximum: 1 },
            // v2: why this file entered context — blast_radius marks a file that
            // was auto-hoisted as an upstream dependant of a targeted file.
            inclusionReason: {
              type: "string",
              enum: ["objective_match", "blast_radius", "convention_anchor"],
            },
          },
        },
      },
      tokenCount: { type: "number", minimum: 0 },
      // v2 Extension 2 — Predictive Blast-Radius Scoping (optional).
      blastRadius: blastRadiusSchema,
    },
  },
};

// ─── Edit Plan Contract (change_plan phase) ─────────────────────────────────

export const editPlanContract: ArtifactContract = {
  schemaVersion: SCHEMA_VERSION,
  mimeType: "application/json",
  requiredFields: [
    "sessionId",
    "objective",
    "operations",
    "dependencyOrder",
    "totalFileCount",
    "requiresHumanReview",
  ],
  jsonSchema: {
    type: "object",
    required: [
      "sessionId",
      "objective",
      "operations",
      "dependencyOrder",
      "totalFileCount",
      "requiresHumanReview",
    ],
    properties: {
      sessionId: { type: "string" },
      objective: { type: "string", minLength: 1 },
      operations: {
        type: "array",
        items: {
          type: "object",
          required: ["id", "type", "filePath", "dependsOn", "rationale"],
          properties: {
            id: { type: "string" },
            type: { type: "string", enum: ["create", "modify", "delete"] },
            filePath: { type: "string" },
            dependsOn: { type: "array", items: { type: "string" } },
            rationale: { type: "string", minLength: 1 },
            changes: {
              type: "array",
              items: {
                type: "object",
                required: [
                  "startLine",
                  "endLine",
                  "originalCode",
                  "newCode",
                  "contextLines",
                ],
                properties: {
                  startLine: { type: "number", minimum: 1 },
                  endLine: { type: "number", minimum: 1 },
                  originalCode: { type: "string" },
                  newCode: { type: "string" },
                  contextLines: { type: "number", minimum: 0 },
                },
              },
            },
            newContent: { type: "string" },
          },
        },
      },
      dependencyOrder: { type: "array", items: { type: "string" } },
      totalFileCount: { type: "number", minimum: 0 },
      // The Refiner Agent flips this to true for security-critical targets.
      requiresHumanReview: { type: "boolean" },
      // v2 Extension 1 — Agentic Consensus Matrix (optional).
      consensusMatrix: consensusMatrixSchema,
      // v2 Extension 5 — Adaptive Resource Scaling decision (optional).
      adaptiveScaling: adaptiveScalingSchema,
    },
  },
};

// ─── Verification Report Contract (apply_edits phase) ───────────────────────

export const verificationReportContract: ArtifactContract = {
  schemaVersion: SCHEMA_VERSION,
  mimeType: "application/json",
  requiredFields: [
    "sessionId",
    "verificationLevel",
    "timeline",
    "summary",
    "finalStatus",
  ],
  jsonSchema: {
    type: "object",
    required: [
      "sessionId",
      "verificationLevel",
      "timeline",
      "summary",
      "finalStatus",
    ],
    properties: {
      sessionId: { type: "string" },
      verificationLevel: {
        type: "string",
        enum: ["none", "lint_only", "type_check", "full_test"],
      },
      timeline: {
        type: "array",
        items: {
          type: "object",
          required: ["timestamp", "type", "status", "details", "duration"],
          properties: {
            timestamp: { type: "string", format: "date-time" },
            type: {
              type: "string",
              enum: [
                "step_check",
                "test_loop_iteration",
                "fix_attempt",
                "quality_gate",
                // v2: sandbox stubbing + mutation-test activity entries.
                "sandbox_stub",
                "mutation_test",
              ],
            },
            operationId: { type: "string" },
            status: { type: "string", enum: ["passed", "failed", "skipped"] },
            details: { type: "object" },
            duration: { type: "number", minimum: 0 },
          },
        },
      },
      summary: {
        type: "object",
        required: [
          "totalChecks",
          "passed",
          "failed",
          "fixAttempts",
          "successfulFixes",
          "totalDuration",
        ],
        properties: {
          totalChecks: { type: "number", minimum: 0 },
          passed: { type: "number", minimum: 0 },
          failed: { type: "number", minimum: 0 },
          fixAttempts: { type: "number", minimum: 0 },
          successfulFixes: { type: "number", minimum: 0 },
          totalDuration: { type: "number", minimum: 0 },
        },
      },
      finalStatus: {
        type: "string",
        enum: ["all_passed", "has_failures", "in_progress"],
      },
      // v2 Extension 3 — Mock Link Sandboxing (optional).
      sandboxing: sandboxingSchema,
    },
  },
};

// ─── Test Loop Result Contract (test_loop phase) ────────────────────────────

export const testLoopResultContract: ArtifactContract = {
  schemaVersion: SCHEMA_VERSION,
  mimeType: "application/json",
  requiredFields: [
    "status",
    "totalAttempts",
    "fixAttempts",
    "passingTests",
    "failingTests",
    "duration",
  ],
  jsonSchema: {
    type: "object",
    required: [
      "status",
      "totalAttempts",
      "fixAttempts",
      "passingTests",
      "failingTests",
      "duration",
    ],
    properties: {
      status: {
        type: "string",
        enum: [
          "all_passed",
          "partially_fixed",
          "exhausted",
          "escalated",
          // v2: surviving mutations exposed a weak assertion suite.
          "weak_assertion",
        ],
      },
      totalAttempts: { type: "number", minimum: 0 },
      fixAttempts: {
        type: "array",
        items: {
          type: "object",
          required: [
            "attemptNumber",
            "timestamp",
            "diagnosis",
            "appliedFix",
            "outcome",
            "duration",
            "newFailuresIntroduced",
          ],
          properties: {
            attemptNumber: { type: "number", minimum: 1 },
            timestamp: { type: "string", format: "date-time" },
            diagnosis: {
              type: "object",
              required: [
                "testFile",
                "testName",
                "errorMessage",
                "rootCause",
                "affectedFile",
                "suggestedApproach",
              ],
              properties: {
                testFile: { type: "string" },
                testName: { type: "string" },
                errorMessage: { type: "string" },
                stackTrace: { type: "string" },
                rootCause: { type: "string", minLength: 1 },
                affectedFile: { type: "string", minLength: 1 },
                suggestedApproach: { type: "string", minLength: 1 },
              },
            },
            appliedFix: {
              type: "object",
              required: ["filePath", "changes", "description"],
              properties: {
                filePath: { type: "string" },
                changes: { type: "array" },
                description: { type: "string" },
              },
            },
            outcome: {
              type: "string",
              enum: [
                "resolved",
                "failed",
                "regression_detected",
                "reverted",
              ],
            },
            duration: { type: "number", minimum: 0 },
            newFailuresIntroduced: {
              type: "array",
              items: { type: "string" },
            },
          },
        },
      },
      passingTests: { type: "array", items: { type: "string" } },
      failingTests: { type: "array", items: { type: "string" } },
      duration: { type: "number", minimum: 0 },
      // v2 Extension 4 — Automated Mutation Testing (optional).
      mutationTesting: mutationTestingSchema,
    },
  },
};

// ─── Gate Result Contract (quality_gate phase) ──────────────────────────────

export const gateResultContract: ArtifactContract = {
  schemaVersion: SCHEMA_VERSION,
  mimeType: "application/json",
  requiredFields: ["passed", "evaluatedAt", "checks", "blockingFailures"],
  jsonSchema: {
    type: "object",
    required: ["passed", "evaluatedAt", "checks", "blockingFailures"],
    properties: {
      passed: { type: "boolean" },
      evaluatedAt: { type: "string", format: "date-time" },
      checks: {
        type: "array",
        items: {
          type: "object",
          required: ["name", "description", "passed"],
          properties: {
            name: { type: "string" },
            description: { type: "string" },
            passed: { type: "boolean" },
            details: { type: "string" },
            // v2: which extension a gate check originated from, when applicable.
            source: {
              type: "string",
              enum: [
                "baseline",
                "consensus_matrix",
                "blast_radius",
                "sandboxing",
                "mutation_testing",
                "adaptive_scaling",
              ],
            },
          },
        },
      },
      blockingFailures: {
        type: "array",
        items: {
          type: "object",
          required: ["check", "reason"],
          properties: {
            check: { type: "string" },
            reason: { type: "string" },
            operationId: { type: "string" },
            testFile: { type: "string" },
          },
        },
      },
    },
  },
};

// ─── PR Result Contract (pr_generation phase) ───────────────────────────────

export const prResultContract: ArtifactContract = {
  schemaVersion: SCHEMA_VERSION,
  mimeType: "application/json",
  requiredFields: [
    "branchName",
    "commitSha",
    "prUrl",
    "prNumber",
    "description",
    "testEvidence",
  ],
  jsonSchema: {
    type: "object",
    required: [
      "branchName",
      "commitSha",
      "prUrl",
      "prNumber",
      "description",
      "testEvidence",
    ],
    properties: {
      branchName: { type: "string", minLength: 1 },
      commitSha: { type: "string", minLength: 1 },
      prUrl: { type: "string", format: "uri" },
      prNumber: { type: "number", minimum: 1 },
      description: { type: "string", minLength: 1 },
      testEvidence: {
        type: "object",
        required: [
          "totalTests",
          "passingTests",
          "fixAttempts",
          "verificationTimeline",
        ],
        properties: {
          totalTests: { type: "number", minimum: 0 },
          passingTests: { type: "number", minimum: 0 },
          fixAttempts: { type: "number", minimum: 0 },
          verificationTimeline: { type: "string" },
          // v2: mutation score surfaced in the PR body as assertion-strength evidence.
          mutationScore: { type: "number", minimum: 0, maximum: 1 },
          // v2: whether external integrations were sandboxed during verification.
          sandboxed: { type: "boolean" },
        },
      },
    },
  },
};

// ─── Phase-to-Contract Mapping ──────────────────────────────────────────────

/**
 * Maps each autonomous pipeline phase to its artifact name and contract.
 * Used when creating/updating cycle blueprints for autonomous codegen sessions.
 */
export const autonomousPhaseContracts = {
  context_load: {
    artifactName: "repository_context",
    contract: repositoryContextContract,
  },
  component_lookup: {
    artifactName: "assembly_manifest",
    contract: assemblyManifestContract,
  },
  change_plan: {
    artifactName: "edit_plan",
    contract: editPlanContract,
  },
  apply_edits: {
    artifactName: "verification_report",
    contract: verificationReportContract,
  },
  test_loop: {
    artifactName: "test_loop_result",
    contract: testLoopResultContract,
  },
  quality_gate: {
    artifactName: "gate_result",
    contract: gateResultContract,
  },
  pr_generation: {
    artifactName: "pr_result",
    contract: prResultContract,
  },
} as const;

export type AutonomousPhaseName = keyof typeof autonomousPhaseContracts;

// ─── Registration Helper ────────────────────────────────────────────────────

/**
 * Produces the `artifactContracts` structure expected by cycle blueprints.
 *
 * Returns a record keyed by phase name, each containing an `output_contract`
 * matching the `PhaseDefinition.artifactContracts` shape used by the
 * pipeline graph validator and pipeline orchestrator.
 *
 * Usage:
 * ```ts
 * const contracts = registerAutonomousContracts();
 * // Use when creating the cycle blueprint:
 * // cycleBlueprint.phases[i].artifactContracts = contracts[phaseName];
 * ```
 */
export function registerAutonomousContracts(): Record<
  AutonomousPhaseName,
  { output_contract: ArtifactContract }
> {
  return {
    context_load: { output_contract: repositoryContextContract },
    component_lookup: { output_contract: assemblyManifestContract },
    change_plan: { output_contract: editPlanContract },
    apply_edits: { output_contract: verificationReportContract },
    test_loop: { output_contract: testLoopResultContract },
    quality_gate: { output_contract: gateResultContract },
    pr_generation: { output_contract: prResultContract },
  };
}
