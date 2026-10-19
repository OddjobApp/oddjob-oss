/**
 * Property Test: Verification level persistence round-trip (Property 13)
 *
 * Feature: autonomous-codegen-pipelines, Property 13: Verification level persistence round-trip
 *
 * For any valid `VerificationLevel` value set on a session, verify retrieving
 * the session's verification level returns the same value.
 *
 * Since this property involves the session metadata storage (which requires DB access),
 * we test it as a pure data transformation property:
 * 1. Generate random `VerificationLevel` values
 * 2. Generate random `SessionMetadataExtension` objects
 * 3. Verify that setting and reading `autonomous_config.verificationLevel` preserves the value
 *
 * The property: for any valid `VerificationLevel` value ("none", "lint_only",
 * "type_check", "full_test"), if stored in a
 * `SessionMetadataExtension.autonomous_config.verificationLevel`, reading it back
 * returns the same value.
 *
 * **Validates: Requirements 6.3**
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import type {
  VerificationLevel,
  SessionMetadataExtension,
  AutonomousCodegenConfig,
} from "../../core/types.js";

// ─── Arbitraries ────────────────────────────────────────────────────────────

/**
 * Generates any valid VerificationLevel value.
 */
const verificationLevelArb: fc.Arbitrary<VerificationLevel> = fc.constantFrom(
  "none" as const,
  "lint_only" as const,
  "type_check" as const,
  "full_test" as const
);

/**
 * Generates a random repository config section.
 */
const repositoryConfigArb = fc.record({
  url: fc.option(fc.webUrl(), { nil: undefined }),
  workspacePath: fc.option(fc.stringMatching(/^\/[a-z][a-z0-9\-\/]{1,30}$/), { nil: undefined }),
  branch: fc.option(fc.stringMatching(/^[a-z][a-z0-9\-]{1,15}$/), { nil: undefined }),
  credentials: fc.option(fc.uuid(), { nil: undefined }),
});

/**
 * Generates a random AutonomousCodegenConfig with a specified verificationLevel.
 */
const autonomousConfigArb = (level: VerificationLevel): fc.Arbitrary<AutonomousCodegenConfig> =>
  fc
    .tuple(
      fc.integer({ min: 1, max: 20 }),          // maxFixAttempts
      fc.integer({ min: 1, max: 200 }),         // maxFileCount
      fc.integer({ min: 1000, max: 500_000 }),  // contextTokenBudget
      fc.integer({ min: 1, max: 10 }),          // dependencyTraceDepth
      repositoryConfigArb,
      fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),  // prTemplate
      fc.option(fc.stringMatching(/^codegen\/[a-z\-]{1,20}\/[a-z\-]{1,20}$/), { nil: undefined })  // branchNamingPattern
    )
    .map(([maxFixAttempts, maxFileCount, contextTokenBudget, dependencyTraceDepth, repository, prTemplate, branchNamingPattern]) => ({
      verificationLevel: level,
      maxFixAttempts,
      maxFileCount,
      contextTokenBudget,
      dependencyTraceDepth,
      repository,
      prTemplate,
      branchNamingPattern,
    }));

/**
 * Generates a random metrics object for the session metadata.
 */
const metricsArb = fc.record({
  fixAttempts: fc.nat({ max: 100 }),
  successfulFixes: fc.nat({ max: 100 }),
  failedFixes: fc.nat({ max: 100 }),
  totalVerificationTime: fc.nat({ max: 600_000 }),
  testLoopIterations: fc.nat({ max: 50 }),
  currentAttemptNumber: fc.option(fc.nat({ max: 20 }), { nil: undefined }),
  currentAttemptElapsedMs: fc.option(fc.nat({ max: 300_000 }), { nil: undefined }),
});

/**
 * Generates a full SessionMetadataExtension with the given verificationLevel.
 */
const sessionMetadataExtensionArb = (level: VerificationLevel): fc.Arbitrary<SessionMetadataExtension> =>
  fc
    .tuple(autonomousConfigArb(level), metricsArb)
    .map(([autonomousConfig, metrics]) => ({
      pipeline_mode: "code_generation" as const,
      autonomous_config: autonomousConfig,
      metrics,
    }));

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Simulates storing metadata and reading back the verification level.
 * This mirrors how the pipeline orchestrator persists/reads the value
 * from the session metadata JSON column.
 */
function storeAndRetrieveVerificationLevel(
  metadata: SessionMetadataExtension
): VerificationLevel {
  // Simulate JSON serialization round-trip (as happens with DB storage)
  const serialized = JSON.stringify(metadata);
  const deserialized = JSON.parse(serialized) as SessionMetadataExtension;

  return deserialized.autonomous_config.verificationLevel;
}

/**
 * Simulates updating the verification level on existing metadata.
 * This mirrors `pipelineOrchestratorService.updateVerificationLevel()`.
 */
function updateVerificationLevel(
  metadata: SessionMetadataExtension,
  newLevel: VerificationLevel
): SessionMetadataExtension {
  // Spread pattern matching the actual service implementation
  const updated: SessionMetadataExtension = {
    ...metadata,
    autonomous_config: {
      ...metadata.autonomous_config,
      verificationLevel: newLevel,
    },
  };
  return updated;
}

// ─── Property Tests ─────────────────────────────────────────────────────────

describe("Feature: autonomous-codegen-pipelines, Property 13: Verification level persistence round-trip", () => {
  it("storing a VerificationLevel in SessionMetadataExtension and reading it back preserves the value", () => {
    fc.assert(
      fc.property(
        verificationLevelArb.chain((level) =>
          sessionMetadataExtensionArb(level).map((metadata) => ({ level, metadata }))
        ),
        ({ level, metadata }) => {
          // Store and retrieve the verification level
          const retrieved = storeAndRetrieveVerificationLevel(metadata);

          // The round-trip must preserve the value
          expect(retrieved).toBe(level);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("updating verificationLevel on existing metadata and reading it back returns the new value", () => {
    fc.assert(
      fc.property(
        verificationLevelArb.chain((originalLevel) =>
          fc.tuple(
            sessionMetadataExtensionArb(originalLevel),
            verificationLevelArb
          ).map(([metadata, newLevel]) => ({ originalLevel, metadata, newLevel }))
        ),
        ({ metadata, newLevel }) => {
          // Update the verification level (simulating updateVerificationLevel service call)
          const updated = updateVerificationLevel(metadata, newLevel);

          // Simulate JSON round-trip
          const serialized = JSON.stringify(updated);
          const deserialized = JSON.parse(serialized) as SessionMetadataExtension;

          // The retrieved value must match the new level
          expect(deserialized.autonomous_config.verificationLevel).toBe(newLevel);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("verification level is independent of other autonomous_config fields after round-trip", () => {
    fc.assert(
      fc.property(
        verificationLevelArb,
        verificationLevelArb,
        (level1, level2) => {
          // Create two different metadata objects with different verification levels
          // but verify each preserves its own level independently
          const metadata1: SessionMetadataExtension = {
            pipeline_mode: "code_generation",
            autonomous_config: {
              verificationLevel: level1,
              maxFixAttempts: 5,
              maxFileCount: 50,
              contextTokenBudget: 100_000,
              dependencyTraceDepth: 3,
              repository: {},
            },
            metrics: {
              fixAttempts: 0,
              successfulFixes: 0,
              failedFixes: 0,
              totalVerificationTime: 0,
              testLoopIterations: 0,
            },
          };

          const metadata2: SessionMetadataExtension = {
            pipeline_mode: "code_generation",
            autonomous_config: {
              verificationLevel: level2,
              maxFixAttempts: 10,
              maxFileCount: 100,
              contextTokenBudget: 200_000,
              dependencyTraceDepth: 5,
              repository: { url: "https://github.com/test/repo", branch: "develop" },
              prTemplate: "## Changes\n",
              branchNamingPattern: "codegen/{session-id}/{slug}",
            },
            metrics: {
              fixAttempts: 7,
              successfulFixes: 5,
              failedFixes: 2,
              totalVerificationTime: 45_000,
              testLoopIterations: 3,
            },
          };

          // Both should preserve their verification levels through JSON round-trip
          const retrieved1 = storeAndRetrieveVerificationLevel(metadata1);
          const retrieved2 = storeAndRetrieveVerificationLevel(metadata2);

          expect(retrieved1).toBe(level1);
          expect(retrieved2).toBe(level2);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("sequential updates to verificationLevel always reflect the last written value", () => {
    fc.assert(
      fc.property(
        fc.array(verificationLevelArb, { minLength: 2, maxLength: 10 }),
        (levels) => {
          // Start with the first level
          let metadata: SessionMetadataExtension = {
            pipeline_mode: "code_generation",
            autonomous_config: {
              verificationLevel: levels[0],
              maxFixAttempts: 5,
              maxFileCount: 50,
              contextTokenBudget: 100_000,
              dependencyTraceDepth: 3,
              repository: {},
            },
            metrics: {
              fixAttempts: 0,
              successfulFixes: 0,
              failedFixes: 0,
              totalVerificationTime: 0,
              testLoopIterations: 0,
            },
          };

          // Apply each level update sequentially
          for (const level of levels) {
            metadata = updateVerificationLevel(metadata, level);
          }

          // After all updates, the last level should be persisted
          const finalLevel = levels[levels.length - 1];
          const retrieved = storeAndRetrieveVerificationLevel(metadata);

          expect(retrieved).toBe(finalLevel);
        }
      ),
      { numRuns: 100 }
    );
  });
});
