/**
 * Property Test: PR convention conformance (Property 12)
 *
 * Feature: autonomous-codegen-pipelines, Property 12: PR convention conformance
 *
 * For any detected branch naming convention, verify generated branch name matches
 * the pattern. For any detected PR template, verify description conforms to
 * template structure.
 *
 * **Validates: Requirements 5.5**
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  generateBranchName,
  buildPRDescription,
} from "../../autonomous/pr-generator.service.js";
import type {
  FileOperation,
  VerificationReport,
  DetectedConventions,
} from "../../core/types.js";

// ─── Arbitraries ────────────────────────────────────────────────────────────

/**
 * Generates a random session ID (UUID-like string).
 */
const sessionIdArb: fc.Arbitrary<string> = fc.stringMatching(
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
);

/**
 * Generates a random objective string (1-100 chars, alphanumeric with spaces).
 */
const objectiveArb: fc.Arbitrary<string> = fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ]{0,99}$/);

/**
 * Generates a random branch naming pattern containing the required placeholders.
 * Patterns have a prefix, the {session-id} placeholder, a separator, and the {objective-slug} placeholder.
 */
const branchNamingPatternArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom("feature", "codegen", "auto", "fix", "gen"),
    fc.constantFrom("/", "-", "_"),
    fc.constantFrom("/", "-", "_")
  )
  .map(
    ([prefix, sep1, sep2]) =>
      `${prefix}${sep1}{session-id}${sep2}{objective-slug}`
  );

/**
 * Generates a random PR template string (multi-line markdown-like template).
 */
const prTemplateArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom("## Description", "## Summary", "## What changed"),
    fc.constantFrom(
      "\n\nPlease describe the changes.",
      "\n\nDescribe your changes here.",
      "\n\nBrief overview of changes."
    ),
    fc.constantFrom(
      "\n\n## Testing\n\nDescribe testing done.",
      "\n\n## Checklist\n\n- [ ] Tests pass",
      "\n\n## Related Issues\n\nLinked issues."
    )
  )
  .map(([heading, body, section]) => `${heading}${body}${section}`);

/**
 * Generates a minimal set of file operations for PR description building.
 */
const fileOperationsArb: fc.Arbitrary<FileOperation[]> = fc.array(
  fc.record({
    id: fc.stringMatching(/^op-[a-z0-9]{4}$/),
    type: fc.constantFrom("create" as const, "modify" as const, "delete" as const),
    filePath: fc.stringMatching(/^src\/[a-z]{2,10}\.[a-z]{2,4}$/),
    dependsOn: fc.constant([] as string[]),
    rationale: fc.stringMatching(/^[A-Za-z ]{5,50}$/),
    changes: fc.constant([
      {
        startLine: 1,
        endLine: 5,
        originalCode: "// old code",
        newCode: "// new code",
        contextLines: 2,
      },
    ]),
    newContent: fc.constant("// new file content"),
  }),
  { minLength: 1, maxLength: 5 }
);

/**
 * Generates a valid VerificationReport for use in buildPRDescription.
 */
const verificationReportArb: fc.Arbitrary<VerificationReport> = fc
  .tuple(
    fc.integer({ min: 1, max: 50 }),
    fc.integer({ min: 0, max: 5 }),
    fc.integer({ min: 0, max: 10 })
  )
  .map(([total, failed, fixAttempts]) => ({
    sessionId: "test-session-001",
    verificationLevel: "full_test" as const,
    timeline: [],
    summary: {
      totalChecks: total,
      passed: total - failed,
      failed,
      fixAttempts,
      successfulFixes: Math.max(0, fixAttempts - 1),
      totalDuration: 5000,
    },
    finalStatus: failed === 0 ? ("all_passed" as const) : ("has_failures" as const),
  }));

// ─── Property Tests ─────────────────────────────────────────────────────────

describe("Feature: autonomous-codegen-pipelines, Property 12: PR convention conformance", () => {
  describe("Branch naming convention conformance", () => {
    it("generated branch name matches the specified naming pattern for any valid pattern, session ID, and objective", () => {
      fc.assert(
        fc.property(
          branchNamingPatternArb,
          sessionIdArb,
          objectiveArb,
          (pattern, sessionId, objective) => {
            const branchName = generateBranchName(sessionId, objective, pattern);

            // The branch name should contain the short session ID (first 8 chars)
            const shortSessionId = sessionId.slice(0, 8);
            expect(branchName).toContain(shortSessionId);

            // Build the expected slug from the objective
            const expectedSlug = objective
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-|-$/g, "")
              .slice(0, 50);

            // The branch name should match the pattern with placeholders replaced
            const expectedBranchName = pattern
              .replace("{session-id}", shortSessionId)
              .replace("{objective-slug}", expectedSlug);

            expect(branchName).toBe(expectedBranchName);
          }
        ),
        { numRuns: 100 }
      );
    });

    it("generated branch name uses default pattern when no convention is provided", () => {
      fc.assert(
        fc.property(sessionIdArb, objectiveArb, (sessionId, objective) => {
          const branchName = generateBranchName(sessionId, objective);

          // Default pattern: codegen/{session-id}/{objective-slug}
          const shortSessionId = sessionId.slice(0, 8);
          expect(branchName.startsWith(`codegen/${shortSessionId}/`)).toBe(true);

          // Verify slug portion is correctly derived from objective
          const expectedSlug = objective
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "")
            .slice(0, 50);

          expect(branchName).toBe(`codegen/${shortSessionId}/${expectedSlug}`);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe("PR template conformance", () => {
    it("PR description includes the PR template content when a template convention is detected", () => {
      fc.assert(
        fc.property(
          prTemplateArb,
          objectiveArb,
          fileOperationsArb,
          verificationReportArb,
          (prTemplate, objective, operations, report) => {
            const conventions: DetectedConventions = {
              namingPatterns: [],
              formattingRules: [],
              architecturalPatterns: [],
              testingConventions: [],
              prTemplate,
            };

            const description = buildPRDescription(
              objective,
              operations,
              report,
              conventions
            );

            // The PR description MUST include the template content
            expect(description).toContain(prTemplate);

            // The PR description should still contain the required sections
            expect(description).toContain("## Objective");
            expect(description).toContain(objective);
            expect(description).toContain("## Changes Summary");
            expect(description).toContain("## Test Results");
            expect(description).toContain("## Verification Report");
          }
        ),
        { numRuns: 100 }
      );
    });

    it("PR description still contains all required sections when no template convention is detected", () => {
      fc.assert(
        fc.property(
          objectiveArb,
          fileOperationsArb,
          verificationReportArb,
          (objective, operations, report) => {
            const conventions: DetectedConventions = {
              namingPatterns: [],
              formattingRules: [],
              architecturalPatterns: [],
              testingConventions: [],
              // No prTemplate set
            };

            const description = buildPRDescription(
              objective,
              operations,
              report,
              conventions
            );

            // Without a template, the description should NOT contain template-specific separator
            // but should still have all required sections
            expect(description).toContain("## Objective");
            expect(description).toContain(objective);
            expect(description).toContain("## Changes Summary");
            expect(description).toContain("## Test Results");
            expect(description).toContain("## Verification Report");
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
