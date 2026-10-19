/**
 * Property-based tests for Event Extraction Service
 *
 * Feature: hat-menu-intent-router
 *
 * Properties tested:
 * - Property 24: Valid Event Primitives produced — all required typed fields present
 * - Property 25: Unknown fields reduce confidence by 0.2 each
 * - Property 26: Low-confidence events flagged and excluded
 * - Property 27: Sibling primitives share source_entry_id
 *
 * **Validates: Requirements 14.1, 14.2, 14.3, 14.6, 14.7**
 */

import { describe, it, expect, vi } from "vitest";
import * as fc from "fast-check";

// ─── Mock setup ─────────────────────────────────────────────────────────────

vi.mock("@server/utils/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Import AFTER mocks are established
import {
  EventExtractionService,
  type EventPrimitive,
} from "./event-extraction.service.js";
import type { FeedEntry } from "./signal-ingestion.service.js";

// ─── fast-check Arbitraries ─────────────────────────────────────────────────

/** Valid URL generator */
const validUrlArb = fc.tuple(
  fc.constantFrom("https"),
  fc.stringOf(
    fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789".split("")),
    { minLength: 3, maxLength: 15 }
  ),
  fc.constantFrom(".com", ".org", ".io", ".gov"),
  fc.stringOf(
    fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz/".split("")),
    { minLength: 0, maxLength: 10 }
  )
).map(([protocol, domain, tld, path]) => `${protocol}://${domain}${tld}/${path}`);

/** Generate a non-empty title */
const titleArb = fc.stringOf(
  fc.constantFrom(
    ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ".split("")
  ),
  { minLength: 5, maxLength: 50 }
);

/** Generate content that contains at least some classifiable keywords */
const contentWithKeywordsArb = fc.oneof(
  // Content with event type keywords
  fc.constantFrom(
    "The US announced new tariff rates on semiconductor imports from China.",
    "EU regulation enacted for energy sector compliance in Germany.",
    "Sanctions imposed on Russian defense entities by the United Kingdom.",
    "Trade agreement modified between Japan and South Korea for manufacturing.",
    "Central bank rate change announced: Federal Reserve cut interest rate.",
    "Export control updated for technology sector in Taiwan.",
    "Compliance deadline set for healthcare industry in France.",
    "New tariff on agriculture imports from Brazil affects supply chain.",
    "Major sanctions imposed on Iran's energy sector by the EU.",
    "Germany enacted regulation for semiconductor manufacturing.",
  ),
  // Content that may not match any keywords (tests "Unknown" path)
  fc.stringOf(
    fc.constantFrom(
      ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ ,.'\"!?-".split("")
    ),
    { minLength: 10, maxLength: 100 }
  )
);

/** Generate content with multiple sentences that can produce multiple events */
const multiEventContentArb = fc.tuple(
  fc.constantFrom(
    "The US imposed new tariffs on semiconductor chips from China.",
    "EU enacted a regulation for the energy sector.",
    "Japan modified trade agreements with South Korea.",
    "UK sanctions imposed on Russian defense companies.",
  ),
  fc.constantFrom(
    "Meanwhile, the central bank announced a rate cut affecting finance.",
    "Additionally, new export controls updated for technology in Taiwan.",
    "Separately, compliance deadline set for healthcare in Germany.",
    "Also, sanctions imposed on Iran affecting the energy sector.",
  )
).map(([s1, s2]) => `${s1} ${s2}`);

/** Generate a FeedEntry with non-empty content */
const feedEntryArb: fc.Arbitrary<FeedEntry> = fc.record({
  id: fc.uuid(),
  feedId: fc.integer({ min: 1, max: 1000 }),
  organizationId: fc.integer({ min: 1, max: 1000 }),
  sourceUrl: validUrlArb,
  title: titleArb,
  content: contentWithKeywordsArb,
  publishedAt: fc.date({ min: new Date("2020-01-01"), max: new Date("2030-01-01") }),
  retrievedAt: fc.date({ min: new Date("2020-01-01"), max: new Date("2030-01-01") }),
  rawData: fc.constant({} as Record<string, unknown>),
}) as fc.Arbitrary<FeedEntry>;

/** Generate a FeedEntry that produces multiple primitives */
const multiEventFeedEntryArb: fc.Arbitrary<FeedEntry> = fc.record({
  id: fc.uuid(),
  feedId: fc.integer({ min: 1, max: 1000 }),
  organizationId: fc.integer({ min: 1, max: 1000 }),
  sourceUrl: validUrlArb,
  title: titleArb,
  content: multiEventContentArb,
  publishedAt: fc.date({ min: new Date("2020-01-01"), max: new Date("2030-01-01") }),
  retrievedAt: fc.date({ min: new Date("2020-01-01"), max: new Date("2030-01-01") }),
  rawData: fc.constant({} as Record<string, unknown>),
}) as fc.Arbitrary<FeedEntry>;

// ─── Required fields list ────────────────────────────────────────────────────

const REQUIRED_FIELDS: (keyof EventPrimitive)[] = [
  "id",
  "sourceEntryId",
  "eventType",
  "targetSector",
  "jurisdiction",
  "severity",
  "sourceUrl",
  "extractionTimestamp",
  "confidenceScore",
  "rawText",
  "flags",
  "organizationId",
];

// ─── Property Tests ─────────────────────────────────────────────────────────

describe("Feature: hat-menu-intent-router, Property 24: Valid Event Primitives produced", () => {
  const service = new EventExtractionService();

  /**
   * Property 24: Valid Event Primitives produced
   *
   * For any FeedEntry with non-empty content, `extractFromEntry` produces
   * EventPrimitives where each has all required fields (id, sourceEntryId,
   * eventType, targetSector, jurisdiction, severity, sourceUrl,
   * extractionTimestamp, confidenceScore, rawText, flags, organizationId).
   *
   * **Validates: Requirements 14.1, 14.2**
   */
  it("every extracted primitive contains all required typed fields", async () => {
    await fc.assert(
      fc.asyncProperty(feedEntryArb, async (entry) => {
        const primitives = await service.extractFromEntry(entry);

        // Must produce at least one primitive for non-empty content
        expect(primitives.length).toBeGreaterThanOrEqual(1);

        for (const primitive of primitives) {
          // All required fields must be present and defined
          for (const field of REQUIRED_FIELDS) {
            expect(primitive).toHaveProperty(field);
            expect(primitive[field]).not.toBeUndefined();
          }

          // Type validations for specific fields
          expect(typeof primitive.id).toBe("string");
          expect(primitive.id.length).toBeGreaterThan(0);
          expect(typeof primitive.sourceEntryId).toBe("string");
          expect(primitive.sourceEntryId.length).toBeGreaterThan(0);
          expect(typeof primitive.eventType).toBe("string");
          expect(typeof primitive.targetSector).toBe("string");
          expect(typeof primitive.jurisdiction).toBe("string");
          expect(typeof primitive.severity).toBe("string");
          expect(typeof primitive.sourceUrl).toBe("string");
          expect(typeof primitive.extractionTimestamp).toBe("string");
          expect(typeof primitive.confidenceScore).toBe("number");
          expect(typeof primitive.rawText).toBe("string");
          expect(Array.isArray(primitive.flags)).toBe(true);
          expect(typeof primitive.organizationId).toBe("number");

          // confidenceScore must be in [0.0, 1.0]
          expect(primitive.confidenceScore).toBeGreaterThanOrEqual(0.0);
          expect(primitive.confidenceScore).toBeLessThanOrEqual(1.0);
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 24: Valid Event Primitives produced
   *
   * The extraction_timestamp is a valid ISO 8601 datetime.
   *
   * **Validates: Requirements 14.2**
   */
  it("extraction_timestamp is valid ISO 8601", async () => {
    await fc.assert(
      fc.asyncProperty(feedEntryArb, async (entry) => {
        const primitives = await service.extractFromEntry(entry);

        for (const primitive of primitives) {
          const parsed = new Date(primitive.extractionTimestamp);
          expect(parsed.toISOString()).toBe(primitive.extractionTimestamp);
        }
      }),
      { numRuns: 50 }
    );
  });
});

describe("Feature: hat-menu-intent-router, Property 25: Unknown fields reduce confidence by 0.2 each", () => {
  const service = new EventExtractionService();

  /**
   * Property 25: Unknown fields reduce confidence by 0.2 each
   *
   * For any primitive where eventType="Unknown", targetSector="Unknown",
   * or jurisdiction="Unknown", the confidenceScore is reduced by 0.2 for
   * each Unknown (starting from a base of 1.0).
   *
   * **Validates: Requirements 14.6**
   */
  it("confidence is reduced by 0.2 for each Unknown field", async () => {
    await fc.assert(
      fc.asyncProperty(feedEntryArb, async (entry) => {
        const primitives = await service.extractFromEntry(entry);

        for (const primitive of primitives) {
          // Count how many of the 3 penalizable fields are "Unknown"
          let unknownCount = 0;
          if (primitive.eventType === "Unknown") unknownCount++;
          if (primitive.targetSector === "Unknown") unknownCount++;
          if (primitive.jurisdiction === "Unknown") unknownCount++;

          // Expected confidence: 1.0 - (unknownCount * 0.2), clamped to [0, 1]
          const expectedConfidence = Math.max(0, 1.0 - unknownCount * 0.2);

          expect(primitive.confidenceScore).toBeCloseTo(expectedConfidence, 10);
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 25: Unknown fields reduce confidence by 0.2 each
   *
   * Primitives with no Unknown fields always have confidence 1.0.
   * Primitives with all 3 Unknown have confidence 0.4.
   *
   * **Validates: Requirements 14.6**
   */
  it("primitives with zero Unknown fields have confidence 1.0, three Unknown have 0.4", async () => {
    await fc.assert(
      fc.asyncProperty(feedEntryArb, async (entry) => {
        const primitives = await service.extractFromEntry(entry);

        for (const primitive of primitives) {
          let unknownCount = 0;
          if (primitive.eventType === "Unknown") unknownCount++;
          if (primitive.targetSector === "Unknown") unknownCount++;
          if (primitive.jurisdiction === "Unknown") unknownCount++;

          if (unknownCount === 0) {
            expect(primitive.confidenceScore).toBeCloseTo(1.0, 10);
          } else if (unknownCount === 3) {
            expect(primitive.confidenceScore).toBeCloseTo(0.4, 10);
          }
        }
      }),
      { numRuns: 100 }
    );
  });
});

describe("Feature: hat-menu-intent-router, Property 26: Low-confidence events flagged and excluded", () => {
  const service = new EventExtractionService();

  /**
   * Property 26: Low-confidence events flagged and excluded
   *
   * For any primitive with confidenceScore < 0.3, the flags array
   * contains "low_confidence".
   *
   * **Validates: Requirements 14.3**
   */
  it("primitives with confidence < 0.3 are flagged as low_confidence", async () => {
    await fc.assert(
      fc.asyncProperty(feedEntryArb, async (entry) => {
        const primitives = await service.extractFromEntry(entry);

        for (const primitive of primitives) {
          if (primitive.confidenceScore < 0.3) {
            expect(primitive.flags).toContain("low_confidence");
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 26: Low-confidence events flagged and excluded
   *
   * For any primitive with confidenceScore >= 0.3, the flags array
   * does NOT contain "low_confidence".
   *
   * **Validates: Requirements 14.3**
   */
  it("primitives with confidence >= 0.3 are NOT flagged as low_confidence", async () => {
    await fc.assert(
      fc.asyncProperty(feedEntryArb, async (entry) => {
        const primitives = await service.extractFromEntry(entry);

        for (const primitive of primitives) {
          if (primitive.confidenceScore >= 0.3) {
            expect(primitive.flags).not.toContain("low_confidence");
          }
        }
      }),
      { numRuns: 100 }
    );
  });
});

describe("Feature: hat-menu-intent-router, Property 27: Sibling primitives share source_entry_id", () => {
  const service = new EventExtractionService();

  /**
   * Property 27: Sibling primitives share source_entry_id
   *
   * For any entry producing multiple primitives, ALL share the same
   * sourceEntryId (equal to the entry's id).
   *
   * **Validates: Requirements 14.7**
   */
  it("all primitives from a single entry share the same sourceEntryId equal to entry.id", async () => {
    await fc.assert(
      fc.asyncProperty(multiEventFeedEntryArb, async (entry) => {
        const primitives = await service.extractFromEntry(entry);

        // All primitives must have sourceEntryId equal to the entry's id
        for (const primitive of primitives) {
          expect(primitive.sourceEntryId).toBe(entry.id);
        }

        // If there are multiple primitives, confirm they all match
        if (primitives.length > 1) {
          const allSameSourceId = primitives.every(
            (p) => p.sourceEntryId === primitives[0].sourceEntryId
          );
          expect(allSameSourceId).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 27: Sibling primitives share source_entry_id
   *
   * Even single-event entries have sourceEntryId matching the entry's id.
   *
   * **Validates: Requirements 14.7**
   */
  it("single-event entries also have sourceEntryId equal to entry.id", async () => {
    await fc.assert(
      fc.asyncProperty(feedEntryArb, async (entry) => {
        const primitives = await service.extractFromEntry(entry);

        for (const primitive of primitives) {
          expect(primitive.sourceEntryId).toBe(entry.id);
        }
      }),
      { numRuns: 100 }
    );
  });
});
