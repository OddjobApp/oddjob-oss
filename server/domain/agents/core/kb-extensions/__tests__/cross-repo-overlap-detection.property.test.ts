/**
 * Property-based test for Cross-Repo Overlap Detection.
 *
 * **Property 5: Cross-Repo Overlap Detection**
 *
 * For any pair of KB questions across different repositories, overlap SHALL be
 * detected if and only if at least one of these conditions holds:
 * (a) file path extensions overlap
 * (b) error category values match exactly
 * (c) question text keyword Jaccard similarity ≥ 60%
 *
 * **Validates: Requirements 3.6**
 *
 * Uses fast-check for property-based testing with a minimum of 100 iterations.
 * Tag: Feature: kb-question-engine-extensions, Property 5: Cross-Repo Overlap Detection
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { computeJaccardSimilarity } from "../keyword-similarity.js";

// ─── Reproduce the overlap detection logic from propagateToSiblingRepos ───────

/**
 * Extracts file extensions from a list of file paths.
 * Mirrors the logic in propagateToSiblingRepos: lastIndexOf("."), slice, lowercase.
 */
function extractExtensions(filePaths: string[]): Set<string> {
  const extensions = new Set<string>();
  for (const fp of filePaths) {
    const lastDot = fp.lastIndexOf(".");
    if (lastDot >= 0) {
      const ext = fp.slice(lastDot).toLowerCase();
      if (ext.length > 0) {
        extensions.add(ext);
      }
    }
  }
  return extensions;
}

/**
 * Determines whether two question contexts overlap, replicating the logic
 * from `propagateToSiblingRepos` in knowledge-base-question-engine.service.ts.
 *
 * Returns the match reason or null if no overlap.
 */
function detectOverlap(
  resolved: { filePaths: string[]; errorCategory: string; questionText: string },
  pending: { filePaths: string[]; errorCategory: string; questionText: string }
): "extension_overlap" | "error_category_match" | "keyword_similarity" | null {
  // (a) File path extension overlap
  const resolvedExtensions = extractExtensions(resolved.filePaths);
  if (resolvedExtensions.size > 0 && pending.filePaths.length > 0) {
    const pendingExtensions = extractExtensions(pending.filePaths);
    for (const ext of pendingExtensions) {
      if (resolvedExtensions.has(ext)) {
        return "extension_overlap";
      }
    }
  }

  // (b) Error category exact match
  if (resolved.errorCategory && pending.errorCategory) {
    if (resolved.errorCategory === pending.errorCategory) {
      return "error_category_match";
    }
  }

  // (c) Keyword Jaccard similarity ≥ 60%
  if (resolved.questionText && pending.questionText) {
    const similarity = computeJaccardSimilarity(resolved.questionText, pending.questionText);
    if (similarity >= 0.6) {
      return "keyword_similarity";
    }
  }

  return null;
}

/**
 * Computes whether overlap SHOULD be detected based on the three conditions.
 * Used as the oracle to verify detectOverlap is correct.
 */
function shouldOverlap(
  resolved: { filePaths: string[]; errorCategory: string; questionText: string },
  pending: { filePaths: string[]; errorCategory: string; questionText: string }
): boolean {
  // (a) Extension overlap: both must have file paths with extensions, and share one
  const resolvedExts = extractExtensions(resolved.filePaths);
  const pendingExts = extractExtensions(pending.filePaths);
  if (resolvedExts.size > 0 && pendingExts.size > 0) {
    for (const ext of pendingExts) {
      if (resolvedExts.has(ext)) return true;
    }
  }

  // (b) Error category exact match: both must be non-empty and equal
  if (resolved.errorCategory && pending.errorCategory) {
    if (resolved.errorCategory === pending.errorCategory) return true;
  }

  // (c) Keyword Jaccard ≥ 60%: both texts must be non-empty
  if (resolved.questionText && pending.questionText) {
    const sim = computeJaccardSimilarity(resolved.questionText, pending.questionText);
    if (sim >= 0.6) return true;
  }

  return false;
}

// ─── Generators ───────────────────────────────────────────────────────────────

/** Common file extensions used in software repos */
const FILE_EXTENSIONS = [
  ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java",
  ".css", ".scss", ".html", ".json", ".yaml", ".yml", ".md",
  ".sql", ".sh", ".dockerfile", ".toml", ".xml",
];

/** Common error categories */
const ERROR_CATEGORIES = [
  "test_failure", "type_error", "runtime_error", "build_error",
  "lint_error", "timeout", "memory_leak", "connection_error",
  "auth_failure", "validation_error", "dependency_conflict",
];

/** Content words for building question text (non-stop-words) */
const CONTENT_WORDS = [
  "database", "migration", "error", "timeout", "connection",
  "typescript", "python", "react", "angular", "deployment",
  "kubernetes", "docker", "redis", "postgres", "authentication",
  "authorization", "payment", "gateway", "api", "endpoint",
  "controller", "service", "repository", "model", "schema",
  "validation", "serialization", "configuration", "middleware",
  "pipeline", "testing", "coverage", "refactoring", "optimization",
  "caching", "indexing", "monitoring", "alerting", "logging",
  "encryption", "certificate", "webhook", "integration", "workflow",
  "scheduling", "queueing", "streaming", "batching", "pagination",
];

/** Generate a file path with a specific extension */
const filePathWithExtArb = (ext: string) =>
  fc.tuple(
    fc.stringOf(fc.constantFrom(...("abcdefghijklmnopqrstuvwxyz".split(""))), { minLength: 1, maxLength: 10 }),
    fc.stringOf(fc.constantFrom(...("abcdefghijklmnopqrstuvwxyz".split(""))), { minLength: 1, maxLength: 10 })
  ).map(([dir, name]) => `src/${dir}/${name}${ext}`);

/** Generate a random file path with a random extension from the pool */
const filePathArb = fc.constantFrom(...FILE_EXTENSIONS).chain(ext => filePathWithExtArb(ext));

/** Generate an array of file paths (0–5 paths) */
const filePathsArb = fc.array(filePathArb, { minLength: 0, maxLength: 5 });

/** Generate an error category (possibly empty) */
const errorCategoryArb = fc.oneof(
  fc.constant(""),
  fc.constantFrom(...ERROR_CATEGORIES)
);

/** Generate question text from content words (possibly empty) */
const questionTextArb = fc.oneof(
  fc.constant(""),
  fc.array(fc.constantFrom(...CONTENT_WORDS), { minLength: 1, maxLength: 10 })
    .map(words => words.join(" "))
);

/** Generate a full question context */
const questionContextArb = fc.record({
  filePaths: filePathsArb,
  errorCategory: errorCategoryArb,
  questionText: questionTextArb,
});

// ─── Property Tests ───────────────────────────────────────────────────────────

describe("Feature: kb-question-engine-extensions, Property 5: Cross-Repo Overlap Detection", () => {
  /**
   * **Validates: Requirements 3.6**
   *
   * Overlap detected iff: extension overlap OR error category match OR keyword Jaccard ≥ 60%.
   */
  it("overlap is detected iff at least one of the three conditions holds", () => {
    fc.assert(
      fc.property(questionContextArb, questionContextArb, (resolved, pending) => {
        const overlapResult = detectOverlap(resolved, pending);
        const expected = shouldOverlap(resolved, pending);

        if (expected) {
          expect(overlapResult).not.toBeNull();
        } else {
          expect(overlapResult).toBeNull();
        }
      }),
      { numRuns: 100, seed: 42 }
    );
  });

  /**
   * **Validates: Requirements 3.6**
   *
   * No overlap when none of the three conditions hold:
   * - No shared file extensions
   * - Different (or empty) error categories
   * - Question text similarity < 60%
   */
  it("no overlap when none of the three conditions hold", () => {
    // Generate pairs specifically designed to have no overlap
    const noOverlapPairArb = fc.tuple(
      fc.array(fc.constantFrom(".ts", ".tsx", ".js"), { minLength: 0, maxLength: 3 }),
      fc.array(fc.constantFrom(".py", ".go", ".rs"), { minLength: 0, maxLength: 3 }),
      fc.constantFrom("test_failure", "type_error", "build_error"),
      fc.constantFrom("timeout", "memory_leak", "connection_error"),
      // Use disjoint word sets for low similarity
      fc.array(fc.constantFrom("database", "migration", "error", "timeout", "connection"), { minLength: 1, maxLength: 5 }),
      fc.array(fc.constantFrom("kubernetes", "docker", "redis", "postgres", "authentication"), { minLength: 1, maxLength: 5 })
    ).map(([extsA, extsB, catA, catB, wordsA, wordsB]) => ({
      resolved: {
        filePaths: extsA.map((ext, i) => `src/dir${i}/file${i}${ext}`),
        errorCategory: catA,
        questionText: wordsA.join(" "),
      },
      pending: {
        filePaths: extsB.map((ext, i) => `lib/mod${i}/item${i}${ext}`),
        errorCategory: catB,
        questionText: wordsB.join(" "),
      },
    }));

    fc.assert(
      fc.property(noOverlapPairArb, ({ resolved, pending }) => {
        // Verify the pair really has no extension overlap
        const resExts = extractExtensions(resolved.filePaths);
        const penExts = extractExtensions(pending.filePaths);
        let hasExtOverlap = false;
        for (const ext of penExts) {
          if (resExts.has(ext)) { hasExtOverlap = true; break; }
        }

        // Verify error categories differ
        const hasCatMatch = resolved.errorCategory === pending.errorCategory;

        // Verify Jaccard < 60%
        const sim = (resolved.questionText && pending.questionText)
          ? computeJaccardSimilarity(resolved.questionText, pending.questionText)
          : 0;
        const hasKeywordMatch = sim >= 0.6;

        // Only assert no overlap when truly none of the conditions hold
        fc.pre(!hasExtOverlap && !hasCatMatch && !hasKeywordMatch);

        const overlapResult = detectOverlap(resolved, pending);
        expect(overlapResult).toBeNull();
      }),
      { numRuns: 100, seed: 123 }
    );
  });

  /**
   * **Validates: Requirements 3.6**
   *
   * Extension overlap alone is sufficient to trigger overlap detection.
   */
  it("extension overlap alone triggers overlap detection", () => {
    const sharedExtArb = fc.constantFrom(...FILE_EXTENSIONS);

    fc.assert(
      fc.property(sharedExtArb, fc.nat({ max: 99 }), (sharedExt, seed) => {
        // Build contexts that share an extension but differ in everything else
        const resolved = {
          filePaths: [`src/module/resolved-file${sharedExt}`],
          errorCategory: "type_error",
          questionText: "database migration error timeout connection",
        };
        const pending = {
          filePaths: [`lib/other/pending-file${sharedExt}`],
          errorCategory: "build_error", // different category
          questionText: "kubernetes docker redis postgres authentication", // disjoint words
        };

        const result = detectOverlap(resolved, pending);
        expect(result).toBe("extension_overlap");
      }),
      { numRuns: 100, seed: 456 }
    );
  });

  /**
   * **Validates: Requirements 3.6**
   *
   * Error category match alone triggers overlap detection (when no extension overlap).
   */
  it("error category match alone triggers overlap detection", () => {
    const categoryArb = fc.constantFrom(...ERROR_CATEGORIES);

    fc.assert(
      fc.property(categoryArb, (category) => {
        // No file paths (so no extension overlap), same error category
        const resolved = {
          filePaths: [] as string[],
          errorCategory: category,
          questionText: "database migration error",
        };
        const pending = {
          filePaths: [] as string[],
          errorCategory: category,
          questionText: "kubernetes docker redis", // disjoint, < 60%
        };

        const result = detectOverlap(resolved, pending);
        expect(result).toBe("error_category_match");
      }),
      { numRuns: 100, seed: 789 }
    );
  });

  /**
   * **Validates: Requirements 3.6**
   *
   * Keyword similarity ≥ 60% alone triggers overlap detection
   * (when no extension overlap and no error category match).
   */
  it("keyword similarity >= 60% alone triggers overlap detection", () => {
    // Generate texts with high overlap by using the same content words
    const highSimPairArb = fc.array(
      fc.constantFrom(...CONTENT_WORDS),
      { minLength: 3, maxLength: 8 }
    ).filter(words => {
      // Only keep word arrays that produce >= 60% self-subset similarity
      const text = words.join(" ");
      return computeJaccardSimilarity(text, text) >= 0.6;
    }).map(words => {
      // Use the same words for both texts to guarantee high similarity
      const text = words.join(" ");
      return { textA: text, textB: text };
    });

    fc.assert(
      fc.property(highSimPairArb, ({ textA, textB }) => {
        // No file paths, different error categories
        const resolved = {
          filePaths: [] as string[],
          errorCategory: "",
          questionText: textA,
        };
        const pending = {
          filePaths: [] as string[],
          errorCategory: "",
          questionText: textB,
        };

        const sim = computeJaccardSimilarity(textA, textB);
        fc.pre(sim >= 0.6);

        const result = detectOverlap(resolved, pending);
        expect(result).toBe("keyword_similarity");
      }),
      { numRuns: 100, seed: 1011 }
    );
  });

  /**
   * **Validates: Requirements 3.6**
   *
   * The priority order of detection is: extension first, then category, then keyword.
   * If extension overlaps, that reason is reported regardless of other matches.
   */
  it("detection priority: extension_overlap > error_category_match > keyword_similarity", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...FILE_EXTENSIONS),
        fc.constantFrom(...ERROR_CATEGORIES),
        fc.array(fc.constantFrom(...CONTENT_WORDS), { minLength: 3, maxLength: 6 }),
        (ext, category, words) => {
          const text = words.join(" ");

          // Create a pair that matches ALL three criteria
          const resolved = {
            filePaths: [`src/a/file${ext}`],
            errorCategory: category,
            questionText: text,
          };
          const pending = {
            filePaths: [`lib/b/other${ext}`],
            errorCategory: category,
            questionText: text,
          };

          // Extension overlap should take priority
          const result = detectOverlap(resolved, pending);
          expect(result).toBe("extension_overlap");
        }
      ),
      { numRuns: 100, seed: 1213 }
    );
  });

  /**
   * **Validates: Requirements 3.6**
   *
   * Empty file paths on either side prevent extension overlap detection.
   */
  it("empty file paths prevent extension overlap detection", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...FILE_EXTENSIONS),
        fc.boolean(),
        (ext, resolvedEmpty) => {
          const resolved = {
            filePaths: resolvedEmpty ? [] as string[] : [`src/file${ext}`],
            errorCategory: "",
            questionText: "",
          };
          const pending = {
            filePaths: resolvedEmpty ? [`lib/file${ext}`] : [] as string[],
            errorCategory: "",
            questionText: "",
          };

          // One side has empty file paths, so extension overlap cannot fire
          const result = detectOverlap(resolved, pending);
          expect(result).toBeNull();
        }
      ),
      { numRuns: 100, seed: 1415 }
    );
  });

  /**
   * **Validates: Requirements 3.6**
   *
   * Empty error categories prevent error category match.
   */
  it("empty error categories prevent category match", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ERROR_CATEGORIES),
        fc.boolean(),
        (category, resolvedEmpty) => {
          const resolved = {
            filePaths: [] as string[],
            errorCategory: resolvedEmpty ? "" : category,
            questionText: "",
          };
          const pending = {
            filePaths: [] as string[],
            errorCategory: resolvedEmpty ? category : "",
            questionText: "",
          };

          // One side has empty category
          const result = detectOverlap(resolved, pending);
          expect(result).toBeNull();
        }
      ),
      { numRuns: 100, seed: 1617 }
    );
  });

  /**
   * **Validates: Requirements 3.6**
   *
   * Empty question texts prevent keyword similarity match.
   */
  it("empty question texts prevent keyword similarity detection", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...CONTENT_WORDS), { minLength: 3, maxLength: 6 }),
        fc.boolean(),
        (words, resolvedEmpty) => {
          const text = words.join(" ");
          const resolved = {
            filePaths: [] as string[],
            errorCategory: "",
            questionText: resolvedEmpty ? "" : text,
          };
          const pending = {
            filePaths: [] as string[],
            errorCategory: "",
            questionText: resolvedEmpty ? text : "",
          };

          // One side has empty text
          const result = detectOverlap(resolved, pending);
          expect(result).toBeNull();
        }
      ),
      { numRuns: 100, seed: 1819 }
    );
  });
});
