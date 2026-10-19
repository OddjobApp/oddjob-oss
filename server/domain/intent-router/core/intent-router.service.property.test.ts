/**
 * Property-Based Tests: Intent Router Classification Logic (Task 5.3)
 *
 * Tests correctness properties 9–13 from the design document using fast-check.
 * These properties verify universal invariants that hold across all valid inputs
 * for the classifyTopic() and classifyIntent() methods.
 *
 * **Validates: Requirements 6.1–6.5, 7.1–7.6**
 *
 * Uses fast-check with a minimum of 100 iterations per property.
 * Tag: Feature: hat-menu-intent-router, Properties 9–13
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { IntentRouterService } from "./intent-router.service.js";
import { topicCategories, intentCategories } from "@shared/schema/agent-cards.js";

const service = new IntentRouterService();

// ─── Valid category sets ──────────────────────────────────────────────────────

const VALID_TOPICS: readonly string[] = topicCategories;
const VALID_INTENTS: readonly string[] = intentCategories;

// ─── Generators ───────────────────────────────────────────────────────────────

/**
 * Generate a non-empty, non-whitespace-only string.
 */
const nonEmptyNonWhitespaceArb = fc
  .string({ minLength: 1, maxLength: 200 })
  .filter((s) => s.trim().length > 0);

/**
 * Generate whitespace-only strings (spaces, tabs, newlines, etc.)
 * Also includes the empty string.
 */
const whitespaceOnlyArb = fc.oneof(
  fc.constant(""),
  fc.stringOf(fc.constantFrom(" ", "\t", "\n", "\r", "\f", "\v"), {
    minLength: 1,
    maxLength: 50,
  })
);

// ─── Property 9: Exactly one category per axis ────────────────────────────────

describe("Feature: hat-menu-intent-router, Property 9: Classification produces exactly one category per axis", () => {
  /**
   * **Validates: Requirements 6.1, 6.2**
   *
   * For any non-empty, non-whitespace prompt, classifyTopic returns exactly one
   * TopicCategory from the valid set with confidence in [0.0, 1.0].
   */
  it("classifyTopic returns exactly one valid TopicCategory with confidence in [0, 1]", async () => {
    await fc.assert(
      fc.asyncProperty(nonEmptyNonWhitespaceArb, async (prompt) => {
        const result = await service.classifyTopic(prompt);

        // Exactly one topic from valid set
        expect(VALID_TOPICS).toContain(result.topic);

        // Confidence in [0.0, 1.0]
        expect(result.confidence).toBeGreaterThanOrEqual(0.0);
        expect(result.confidence).toBeLessThanOrEqual(1.0);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 7.1, 7.2**
   *
   * For any non-empty, non-whitespace prompt, classifyIntent returns exactly one
   * IntentCategory from the valid set with confidence in [0.0, 1.0].
   */
  it("classifyIntent returns exactly one valid IntentCategory with confidence in [0, 1]", async () => {
    await fc.assert(
      fc.asyncProperty(nonEmptyNonWhitespaceArb, async (prompt) => {
        const result = await service.classifyIntent(prompt);

        // Exactly one intent from valid set
        expect(VALID_INTENTS).toContain(result.intent);

        // Confidence in [0.0, 1.0]
        expect(result.confidence).toBeGreaterThanOrEqual(0.0);
        expect(result.confidence).toBeLessThanOrEqual(1.0);
      }),
      { numRuns: 100 }
    );
  });
});

// ─── Property 10: Low-confidence topic defaults to General ────────────────────

describe("Feature: hat-menu-intent-router, Property 10: Low-confidence topic defaults to General", () => {
  /**
   * **Validates: Requirements 6.3**
   *
   * For any prompt where the Topic classification confidence falls below 0.4,
   * the resolved topic SHALL be "General".
   */
  it("when confidence < 0.4, topic is always General", async () => {
    await fc.assert(
      fc.asyncProperty(nonEmptyNonWhitespaceArb, async (prompt) => {
        const result = await service.classifyTopic(prompt);

        if (result.confidence < 0.4) {
          expect(result.topic).toBe("General");
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 6.3**
   *
   * Conversely, if the topic is NOT "General", then confidence must be >= 0.4.
   */
  it("if topic is not General, confidence must be >= 0.4", async () => {
    await fc.assert(
      fc.asyncProperty(nonEmptyNonWhitespaceArb, async (prompt) => {
        const result = await service.classifyTopic(prompt);

        if (result.topic !== "General") {
          expect(result.confidence).toBeGreaterThanOrEqual(0.4);
        }
      }),
      { numRuns: 100 }
    );
  });
});

// ─── Property 11: Low-confidence intent defaults to Chat ──────────────────────

describe("Feature: hat-menu-intent-router, Property 11: Low-confidence intent defaults to Chat", () => {
  /**
   * **Validates: Requirements 7.3**
   *
   * For any prompt where the Intent classification confidence falls below 0.4,
   * the resolved intent SHALL be "Chat".
   */
  it("when confidence < 0.4, intent is always Chat", async () => {
    await fc.assert(
      fc.asyncProperty(nonEmptyNonWhitespaceArb, async (prompt) => {
        const result = await service.classifyIntent(prompt);

        if (result.confidence < 0.4) {
          expect(result.intent).toBe("Chat");
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 7.3**
   *
   * Conversely, if the intent is NOT "Chat", then confidence must be >= 0.4.
   */
  it("if intent is not Chat, confidence must be >= 0.4", async () => {
    await fc.assert(
      fc.asyncProperty(nonEmptyNonWhitespaceArb, async (prompt) => {
        const result = await service.classifyIntent(prompt);

        if (result.intent !== "Chat") {
          expect(result.confidence).toBeGreaterThanOrEqual(0.4);
        }
      }),
      { numRuns: 100 }
    );
  });
});

// ─── Property 12: Whitespace prompt validation ────────────────────────────────

describe("Feature: hat-menu-intent-router, Property 12: Whitespace prompt validation", () => {
  /**
   * **Validates: Requirements 6.5**
   *
   * For any whitespace-only string (including empty string), classifyTopic
   * SHALL throw a validation error.
   */
  it("classifyTopic throws for whitespace-only prompts", async () => {
    await fc.assert(
      fc.asyncProperty(whitespaceOnlyArb, async (prompt) => {
        await expect(service.classifyTopic(prompt)).rejects.toThrow();
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 7.5**
   *
   * For any whitespace-only string (including empty string), classifyIntent
   * SHALL return { intent: "Chat", confidence: 1.0 }.
   */
  it("classifyIntent returns Chat with confidence 1.0 for whitespace-only prompts", async () => {
    await fc.assert(
      fc.asyncProperty(whitespaceOnlyArb, async (prompt) => {
        const result = await service.classifyIntent(prompt);

        expect(result.intent).toBe("Chat");
        expect(result.confidence).toBe(1.0);
      }),
      { numRuns: 100 }
    );
  });
});

// ─── Property 13: Intent tie-breaking by registered category order ────────────

describe("Feature: hat-menu-intent-router, Property 13: Intent tie-breaking by registered category order", () => {
  /**
   * The registered intent order is:
   * ["Image Generation", "Video", "Code Execution", "Analysis", "Alert", "Chat", "Search"]
   *
   * When two or more intent categories produce equal highest scores,
   * the category earlier in the registered order wins.
   *
   * We test this by constructing prompts that contain equal numbers of keywords
   * from two different categories and verifying the earlier one is selected.
   */

  /**
   * Intent keywords carefully selected to avoid substring overlap within a category.
   * Each entry is a distinct keyword that doesn't trigger additional matches when
   * combined with keywords from other categories.
   *
   * The key insight: keywords like "run this code" also match "run this" in the
   * same category, causing unequal scores. We select keywords that are unique
   * within their category's keyword list (no other keyword is a substring of them).
   */
  const INTENT_KEYWORD_ISOLATED: Record<string, string[]> = {
    "Image Generation": ["dall-e", "midjourney", "stable diffusion"],
    Video: ["motion graphics", "footage", "film this"],
    "Code Execution": ["compile and run", "eval", "code execution"],
    Analysis: ["deep dive", "benchmark", "correlate"],
    Alert: ["set alert", "watch for", "monitor"],
    Search: ["lookup", "google", "locate"],
  };

  // Registered order (excluding "Chat" which is the default/fallback)
  const REGISTERED_ORDER = [
    "Image Generation",
    "Video",
    "Code Execution",
    "Analysis",
    "Alert",
    "Search",
  ];

  /**
   * **Validates: Requirements 7.6**
   *
   * For any pair of non-Chat intent categories where we construct a prompt with
   * equal keyword counts from both, the category that appears first in the
   * registered order should win (since tie-breaking uses strict greater-than,
   * so first-encountered category with equal max score wins).
   */
  it("earlier category in registered order wins on equal keyword score", async () => {
    // Generate pairs of indices where i < j (earlier vs later in registered order)
    const pairArb = fc
      .tuple(
        fc.integer({ min: 0, max: REGISTERED_ORDER.length - 2 }),
        fc.integer({ min: 1, max: REGISTERED_ORDER.length - 1 })
      )
      .filter(([i, j]) => i < j)
      .chain(([i, j]) => {
        const earlierCategory = REGISTERED_ORDER[i];
        const laterCategory = REGISTERED_ORDER[j];
        const earlierKeywords = INTENT_KEYWORD_ISOLATED[earlierCategory];
        const laterKeywords = INTENT_KEYWORD_ISOLATED[laterCategory];

        // Pick equal number of keywords from each to produce tied scores
        const countArb = fc.integer({
          min: 1,
          max: Math.min(earlierKeywords.length, laterKeywords.length),
        });

        return countArb.map((count) => {
          const selectedEarlier = earlierKeywords.slice(0, count);
          const selectedLater = laterKeywords.slice(0, count);
          // Join with separator that won't accidentally form other keywords
          const prompt = [...selectedEarlier, ...selectedLater].join(" | ");
          return { prompt, earlierCategory, laterCategory, count };
        });
      });

    await fc.assert(
      fc.asyncProperty(pairArb, async ({ prompt, earlierCategory }) => {
        const result = await service.classifyIntent(prompt);

        // If confidence meets threshold, earlier category in registered order wins the tie.
        // If below threshold, defaults to Chat — which is acceptable (the property is about
        // tie-breaking behavior, not threshold behavior).
        if (result.confidence >= 0.4) {
          expect(result.intent).toBe(earlierCategory);
        }
      }),
      { numRuns: 100 }
    );
  });
});
