/**
 * Deduplication Service — Unit Tests
 *
 * Validates:
 * - Semantic deduplication retains only one of similar items (threshold 0.85)
 * - Retains the item with larger contentSize when deduplicating
 * - Graceful degradation when embedding service is unavailable
 * - Pre-computed embeddings are used when available
 * - Trivial cases (0 or 1 items) pass through unchanged
 *
 * Requirements: 3.4
 */

import { describe, it, expect, vi } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@server/utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

// Mock the rag-langchain import to prevent actual initialization
vi.mock("../rag-langchain.service.js", () => ({
  getEmbeddings: vi.fn(() => null),
}));

// ── Import after mocks ─────────────────────────────────────────────────────

import { deduplicationService, cosineSimilarity, type EmbeddingProvider } from "./deduplication.service.js";
import type { CollectedContent } from "./collectors/collector.interface.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeContent(overrides: Partial<CollectedContent> = {}): CollectedContent {
  return {
    url: "https://example.com/article",
    title: "Test Article",
    content: "Some test content about a topic.",
    contentType: "text/html",
    sourceType: "web_scraper",
    contentSize: 1000,
    metadata: {},
    ...overrides,
  };
}

/**
 * Create a mock embedding provider that returns consistent embeddings
 * based on provided vectors for each document.
 */
function createMockProvider(vectors: number[][]): EmbeddingProvider {
  let callIndex = 0;
  return {
    embedDocuments: vi.fn(async (texts: string[]) => {
      const result = vectors.slice(callIndex, callIndex + texts.length);
      callIndex += texts.length;
      return result;
    }),
  };
}

/**
 * Create a normalized vector. Two vectors with small angular difference
 * will have high cosine similarity.
 */
function makeVector(base: number[], perturbation = 0): number[] {
  return base.map((v, i) => v + (i < perturbation ? 0.01 : 0));
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    const v = [1, 2, 3, 4, 5];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0);
  });

  it("returns 0 for orthogonal vectors", () => {
    const a = [1, 0, 0];
    const b = [0, 1, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.0);
  });

  it("returns -1 for opposite vectors", () => {
    const a = [1, 2, 3];
    const b = [-1, -2, -3];
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0);
  });

  it("returns 0 for empty vectors", () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it("returns 0 for mismatched lengths", () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });

  it("returns 0 for zero vectors", () => {
    expect(cosineSimilarity([0, 0, 0], [0, 0, 0])).toBe(0);
  });
});

describe("deduplicationService.deduplicate", () => {
  it("returns empty array for empty input", async () => {
    const result = await deduplicationService.deduplicate([]);
    expect(result).toEqual([]);
  });

  it("returns single item unchanged", async () => {
    const item = makeContent();
    const result = await deduplicationService.deduplicate([item]);
    expect(result).toEqual([item]);
  });

  it("returns original array when embedding provider is null (graceful degradation)", async () => {
    const items = [
      makeContent({ url: "https://a.com" }),
      makeContent({ url: "https://b.com" }),
    ];
    const result = await deduplicationService.deduplicate(items, null);
    expect(result).toEqual(items);
  });

  it("removes duplicate when similarity is above threshold", async () => {
    // Two nearly identical vectors → similarity will be ≥ 0.85
    const vec1 = [1, 0, 0, 0, 0];
    const vec2 = [0.99, 0.01, 0, 0, 0]; // Very close to vec1

    const items = [
      makeContent({ url: "https://a.com", contentSize: 500 }),
      makeContent({ url: "https://b.com", contentSize: 1000 }),
    ];

    const provider = createMockProvider([vec1, vec2]);
    const result = await deduplicationService.deduplicate(items, provider);

    // Should keep only one — the one with larger contentSize
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe("https://b.com");
    expect(result[0].contentSize).toBe(1000);
  });

  it("keeps both items when similarity is below threshold", async () => {
    // Orthogonal vectors → similarity near 0
    const vec1 = [1, 0, 0, 0, 0];
    const vec2 = [0, 1, 0, 0, 0];

    const items = [
      makeContent({ url: "https://a.com", contentSize: 500 }),
      makeContent({ url: "https://b.com", contentSize: 1000 }),
    ];

    const provider = createMockProvider([vec1, vec2]);
    const result = await deduplicationService.deduplicate(items, provider);

    expect(result).toHaveLength(2);
  });

  it("uses pre-computed embeddings when available", async () => {
    const vec = [1, 0, 0, 0, 0];

    const items = [
      makeContent({ url: "https://a.com", contentSize: 500, embedding: vec }),
      makeContent({ url: "https://b.com", contentSize: 1000, embedding: vec }),
    ];

    // Provider should not be called since embeddings are pre-computed
    const provider: EmbeddingProvider = {
      embedDocuments: vi.fn(async () => []),
    };

    const result = await deduplicationService.deduplicate(items, provider);

    // Identical embeddings → similarity is 1.0 → should deduplicate
    expect(result).toHaveLength(1);
    expect(result[0].contentSize).toBe(1000);
    expect(provider.embedDocuments).not.toHaveBeenCalled();
  });

  it("handles mixed pre-computed and computed embeddings", async () => {
    const vec = [1, 0, 0, 0, 0];
    const orthogonalVec = [0, 0, 1, 0, 0];

    const items = [
      makeContent({ url: "https://a.com", contentSize: 500, embedding: vec }),
      makeContent({ url: "https://b.com", contentSize: 1000 }), // No embedding
      makeContent({ url: "https://c.com", contentSize: 800, embedding: orthogonalVec }),
    ];

    // Provider returns a vector identical to vec for item[1]
    const provider = createMockProvider([vec]);

    const result = await deduplicationService.deduplicate(items, provider);

    // items[0] and items[1] have identical vectors → keep larger (items[1], 1000)
    // items[2] is orthogonal → keep it
    expect(result).toHaveLength(2);
    expect(result.map(r => r.url)).toContain("https://b.com");
    expect(result.map(r => r.url)).toContain("https://c.com");
  });

  it("returns original array when embedDocuments throws an error", async () => {
    const items = [
      makeContent({ url: "https://a.com" }),
      makeContent({ url: "https://b.com" }),
    ];

    const provider: EmbeddingProvider = {
      embedDocuments: vi.fn(async () => {
        throw new Error("API quota exceeded");
      }),
    };

    const result = await deduplicationService.deduplicate(items, provider);
    expect(result).toEqual(items);
  });

  it("handles multiple groups of duplicates correctly", async () => {
    // Group 1: items 0, 1 are similar; Group 2: items 2, 3 are similar; item 4 is unique
    const items = [
      makeContent({ url: "https://a1.com", contentSize: 100, embedding: [1, 0, 0] }),
      makeContent({ url: "https://a2.com", contentSize: 200, embedding: [1, 0, 0] }),
      makeContent({ url: "https://b1.com", contentSize: 300, embedding: [0, 1, 0] }),
      makeContent({ url: "https://b2.com", contentSize: 400, embedding: [0, 1, 0] }),
      makeContent({ url: "https://c1.com", contentSize: 500, embedding: [0, 0, 1] }),
    ];

    const result = await deduplicationService.deduplicate(items, { embedDocuments: vi.fn() });

    // From group 1: keep a2 (200 > 100)
    // From group 2: keep b2 (400 > 300)
    // Unique: keep c1
    expect(result).toHaveLength(3);
    expect(result.map(r => r.url).sort()).toEqual([
      "https://a2.com",
      "https://b2.com",
      "https://c1.com",
    ]);
  });
});
