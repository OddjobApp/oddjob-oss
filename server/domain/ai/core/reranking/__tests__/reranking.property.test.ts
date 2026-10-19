/**
 * Property-based tests for RerankingService.
 *
 * Uses fast-check for property-based testing with a minimum of 100 iterations.
 * Tag: Feature: reranking-service
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import fc from "fast-check";
import { RerankingService } from "../reranking.service.js";
import type {
  CandidateDocument,
  RerankBackendConfig,
  RerankBackendType,
} from "../types.js";
import type { RerankBackend, RawScore } from "../backends/rerank-backend.interface.js";

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("@server/utils/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("../telemetry.js", () => ({
  emitRerankTelemetry: vi.fn(),
  emitFallbackWarning: vi.fn(),
}));

vi.mock("../config.js", () => ({
  saveRerankingConfig: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../backends/cohere.backend.js", () => ({
  RerankBackendError: class RerankBackendError extends Error {
    reason?: string;
    constructor(message: string, reason?: string) {
      super(message);
      this.reason = reason;
    }
  },
}));

vi.mock("../backends/llm.backend.js", () => ({
  ParseError: class ParseError extends Error {
    constructor(message: string) {
      super(message);
    }
  },
}));

// ─── Generators ──────────────────────────────────────────────────────────────

/** Generate a non-empty query string */
const queryArb = fc
  .string({ minLength: 1, maxLength: 100 })
  .filter((s) => s.trim().length > 0);

/** Generate a unique document ID */
const docIdArb = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter((s) => s.trim().length > 0 && /^[a-zA-Z0-9_-]+$/.test(s));

/** Generate document content */
const contentArb = fc.string({ minLength: 1, maxLength: 200 });

/** Generate optional metadata as a simple key-value record */
const metadataArb = fc.oneof(
  fc.constant(undefined),
  fc.dictionary(
    fc.string({ minLength: 1, maxLength: 10 }).filter((s) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s) && s !== "__proto__"),
    fc.oneof(fc.string({ maxLength: 20 }), fc.integer(), fc.boolean()),
    { minKeys: 0, maxKeys: 4 }
  )
);

/** Generate an optional original score */
const originalScoreArb = fc.oneof(
  fc.constant(undefined),
  fc.double({ min: 0, max: 1, noNaN: true })
);

/** Generate a single CandidateDocument */
const candidateDocArb = fc
  .tuple(docIdArb, contentArb, metadataArb, originalScoreArb)
  .map(([id, content, metadata, originalScore]) => ({
    id,
    content,
    metadata,
    originalScore,
  })) as fc.Arbitrary<CandidateDocument>;

/** Generate a non-empty array of CandidateDocuments with unique IDs */
const candidateDocsArb = fc
  .uniqueArray(candidateDocArb, {
    minLength: 1,
    maxLength: 20,
    comparator: (a, b) => a.id === b.id,
  });

/** Generate a topK value relative to document count */
const topKForDocsArb = (docCount: number) =>
  fc.integer({ min: 1, max: docCount + 5 });

// ─── Mock Backend Factory ────────────────────────────────────────────────────

/**
 * Creates a mock backend that returns deterministic scores based on document index.
 * Score for document at index i = (docCount - i) / docCount, ensuring scores are
 * in [0, 1] and already ordered by input position for predictability.
 */
function createDeterministicBackend(type: RerankBackendType = "cohere"): RerankBackend {
  return {
    type,
    async score(
      _query: string,
      documents: CandidateDocument[]
    ): Promise<RawScore[]> {
      return documents.map((doc, index) => ({
        documentId: doc.id,
        // Assign scores inversely proportional to index position
        // This gives each doc a distinct, deterministic score in (0, 1]
        score: (documents.length - index) / documents.length,
      }));
    },
    async isAvailable(): Promise<boolean> {
      return true;
    },
  };
}

/**
 * Creates a mock backend that returns random but consistent scores.
 * Uses the document id hashCode as a seed for deterministic-per-id scoring.
 */
function createHashBasedBackend(type: RerankBackendType = "cohere"): RerankBackend {
  return {
    type,
    async score(
      _query: string,
      documents: CandidateDocument[]
    ): Promise<RawScore[]> {
      return documents.map((doc) => ({
        documentId: doc.id,
        // Use a simple hash to generate a score in [0, 1]
        score: simpleHash(doc.id) / 0xffffffff,
      }));
    },
    async isAvailable(): Promise<boolean> {
      return true;
    },
  };
}

/** Simple deterministic hash for strings (FNV-1a inspired) */
function simpleHash(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0; // Force unsigned 32-bit
}

// ─── Service Factory ─────────────────────────────────────────────────────────

function createTestService(
  backend: RerankBackend = createDeterministicBackend()
): RerankingService {
  const config: RerankBackendConfig = {
    defaultBackend: backend.type,
    priorityOrder: [backend.type],
  };
  const backends = new Map<RerankBackendType, RerankBackend>();
  backends.set(backend.type, backend);
  return new RerankingService(config, backends);
}

// ─── Property 1: Reranked output is sorted by descending relevance score ─────

describe("Feature: reranking-service, Property 1: Reranked output is sorted by descending relevance score", () => {
  let service: RerankingService;

  beforeEach(() => {
    service = createTestService(createHashBasedBackend());
  });

  /**
   * **Validates: Requirements 1.1**
   *
   * For any valid query and non-empty list of candidate documents,
   * result[i].relevanceScore >= result[i+1].relevanceScore for all i.
   */
  it("results are sorted by descending relevanceScore for any non-empty document list", async () => {
    await fc.assert(
      fc.asyncProperty(queryArb, candidateDocsArb, async (query, documents) => {
        const response = await service.rerank({ query, documents });

        const results = response.results;
        expect(results.length).toBeGreaterThan(0);

        // Verify descending order
        for (let i = 0; i < results.length - 1; i++) {
          expect(results[i].relevanceScore).toBeGreaterThanOrEqual(
            results[i + 1].relevanceScore
          );
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 1.1**
   *
   * Sorting holds regardless of the backend scoring pattern (deterministic index-based).
   */
  it("results are sorted descending with deterministic index-based backend", async () => {
    const deterministicService = createTestService(createDeterministicBackend());

    await fc.assert(
      fc.asyncProperty(queryArb, candidateDocsArb, async (query, documents) => {
        const response = await deterministicService.rerank({ query, documents });

        for (let i = 0; i < response.results.length - 1; i++) {
          expect(response.results[i].relevanceScore).toBeGreaterThanOrEqual(
            response.results[i + 1].relevanceScore
          );
        }
      }),
      { numRuns: 100 }
    );
  });
});

// ─── Property 3: topK constrains output size ─────────────────────────────────

describe("Feature: reranking-service, Property 3: topK constrains output size", () => {
  let service: RerankingService;

  beforeEach(() => {
    service = createTestService(createDeterministicBackend());
  });

  /**
   * **Validates: Requirements 1.4, 1.5**
   *
   * For any rerank request with N docs and topK=K,
   * response contains exactly min(K, N) results.
   */
  it("response contains exactly min(topK, N) results when topK is specified", async () => {
    await fc.assert(
      fc.asyncProperty(
        queryArb,
        candidateDocsArb.chain((docs) =>
          fc.tuple(fc.constant(docs), topKForDocsArb(docs.length))
        ),
        async (query, [documents, topK]) => {
          const response = await service.rerank({ query, documents, topK });

          const expected = Math.min(topK, documents.length);
          expect(response.results.length).toBe(expected);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 1.5**
   *
   * Without topK, response contains exactly N results.
   */
  it("response contains exactly N results when topK is not specified", async () => {
    await fc.assert(
      fc.asyncProperty(queryArb, candidateDocsArb, async (query, documents) => {
        const response = await service.rerank({ query, documents });

        expect(response.results.length).toBe(documents.length);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 1.4**
   *
   * When topK >= N, all documents are returned (topK does not inflate the result set).
   */
  it("when topK >= N, all N documents are returned", async () => {
    await fc.assert(
      fc.asyncProperty(
        queryArb,
        candidateDocsArb,
        async (query, documents) => {
          const topK = documents.length + 10; // Always greater than N
          const response = await service.rerank({ query, documents, topK });

          expect(response.results.length).toBe(documents.length);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─── Property 6: Document data preservation through reranking ────────────────

describe("Feature: reranking-service, Property 6: Document data preservation through reranking", () => {
  let service: RerankingService;

  beforeEach(() => {
    service = createTestService(createDeterministicBackend());
  });

  /**
   * **Validates: Requirements 6.4, 6.5**
   *
   * For any candidate document, the result preserves id, content, metadata unchanged,
   * and originalScore is set to the document's pre-rerank score.
   */
  it("each result preserves the corresponding input document's id, content, and metadata", async () => {
    await fc.assert(
      fc.asyncProperty(queryArb, candidateDocsArb, async (query, documents) => {
        const response = await service.rerank({ query, documents });

        // Every input document should appear in the results
        for (const doc of documents) {
          const result = response.results.find((r) => r.id === doc.id);
          expect(result).toBeDefined();

          // Content must be preserved exactly
          expect(result!.content).toBe(doc.content);

          // Metadata must be preserved (deep equality)
          if (doc.metadata !== undefined) {
            expect(result!.metadata).toEqual(doc.metadata);
          } else {
            expect(result!.metadata).toBeUndefined();
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 6.5**
   *
   * originalScore in the result is set to the document's pre-rerank originalScore field.
   */
  it("originalScore in result matches the input document's originalScore field", async () => {
    // Use documents that always have an originalScore defined
    const docsWithScoresArb = fc.uniqueArray(
      fc
        .tuple(docIdArb, contentArb, fc.double({ min: 0, max: 1, noNaN: true }))
        .map(([id, content, score]) => ({
          id,
          content,
          originalScore: score,
        })),
      {
        minLength: 1,
        maxLength: 15,
        comparator: (a, b) => a.id === b.id,
      }
    ) as fc.Arbitrary<CandidateDocument[]>;

    await fc.assert(
      fc.asyncProperty(queryArb, docsWithScoresArb, async (query, documents) => {
        const response = await service.rerank({ query, documents });

        for (const doc of documents) {
          const result = response.results.find((r) => r.id === doc.id);
          expect(result).toBeDefined();
          expect(result!.originalScore).toBe(doc.originalScore);
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 6.4, 6.5**
   *
   * When originalScore is undefined on the input document, it remains undefined in the result.
   */
  it("when input document has no originalScore, result's originalScore is undefined", async () => {
    const docsWithoutScoresArb = fc.uniqueArray(
      fc
        .tuple(docIdArb, contentArb)
        .map(([id, content]) => ({
          id,
          content,
          // Explicitly no originalScore
        })),
      {
        minLength: 1,
        maxLength: 15,
        comparator: (a, b) => a.id === b.id,
      }
    ) as fc.Arbitrary<CandidateDocument[]>;

    await fc.assert(
      fc.asyncProperty(queryArb, docsWithoutScoresArb, async (query, documents) => {
        const response = await service.rerank({ query, documents });

        for (const doc of documents) {
          const result = response.results.find((r) => r.id === doc.id);
          expect(result).toBeDefined();
          expect(result!.originalScore).toBeUndefined();
        }
      }),
      { numRuns: 100 }
    );
  });
});
