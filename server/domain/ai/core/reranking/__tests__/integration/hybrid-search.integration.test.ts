/**
 * Integration tests for Hybrid Search Pipeline ↔ Reranking Service.
 *
 * Validates that the hybrid search pipeline (rag-langchain.service.ts)
 * correctly invokes the reranking service when `enableReranking: true`,
 * preserves backward compatibility when disabled, and passes through
 * originalScore (the pre-rerank weighted fusion score).
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// rag-langchain.service binds GEMINI_API_KEY into a module-scope const at import
// time and throws from getEmbeddings() without it — before the mocked
// GoogleGenerativeAIEmbeddings constructor below is ever reached. So the mock
// could not take effect and all eight tests failed on a missing key, which made
// a pure wiring test ("was rerank() called?") unrunnable anywhere without live
// credentials.
//
// vi.hoisted runs ahead of the import graph, so the constant sees this. The
// value is never used: the SDK is mocked. SKIP_GEMINI_EMBEDDINGS would also get
// past the guard, but it routes to a zero-vector stub instead of the code under
// test — and zero vectors are what made RAG retrieval silently dead before.
vi.hoisted(() => {
  process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "test-key-sdk-is-mocked";
});

// ─── Mock External Dependencies ──────────────────────────────────────────────

// Mock the Qdrant client (database)
vi.mock("@server/integrations/qdrant-client.js", () => ({
  ensureQdrantCollection: vi.fn(),
  upsertQdrantPoints: vi.fn(),
  searchQdrant: vi.fn().mockResolvedValue([
    {
      id: "chunk-1",
      score: 0.9,
      payload: {
        pageContent: "Artificial intelligence is transforming business processes.",
        assetId: 101,
        assetKey: "asset-101",
        name: "AI Overview",
        assetType: "document",
        sourceType: "upload",
        order: 0,
        chunkId: "chunk-1",
        capturedAt: "2024-01-01T00:00:00Z",
        verificationStatus: "verified",
      },
    },
    {
      id: "chunk-2",
      score: 0.75,
      payload: {
        pageContent: "Machine learning algorithms optimize production pipelines.",
        assetId: 102,
        assetKey: "asset-102",
        name: "ML Systems",
        assetType: "document",
        sourceType: "upload",
        order: 1,
        chunkId: "chunk-2",
        capturedAt: "2024-01-02T00:00:00Z",
        verificationStatus: "verified",
      },
    },
    {
      id: "chunk-3",
      score: 0.6,
      payload: {
        pageContent: "Cloud computing provides scalable infrastructure for data workloads.",
        assetId: 103,
        assetKey: "asset-103",
        name: "Cloud Infra",
        assetType: "document",
        sourceType: "upload",
        order: 2,
        chunkId: "chunk-3",
        capturedAt: "2024-01-03T00:00:00Z",
        verificationStatus: "verified",
      },
    },
  ]),
  deleteQdrantByFilter: vi.fn(),
  QDRANT_COLLECTION: "oddjob_test",
}));

// Mock the embeddings — use a proper class constructor
vi.mock("@langchain/google-genai", () => ({
  GoogleGenerativeAIEmbeddings: class MockEmbeddings {
    constructor() {}
    async embedQuery() { return new Array(3072).fill(0.1); }
    async embedDocuments(texts: string[]) { return texts.map(() => new Array(3072).fill(0.1)); }
  },
}));

vi.mock("@langchain/textsplitters", () => ({
  RecursiveCharacterTextSplitter: class MockSplitter {
    constructor() {}
    splitText() { return Promise.resolve(["chunk1"]); }
  },
}));

// Mock database
vi.mock("@server/database_service.js", () => ({
  db: { select: vi.fn().mockReturnThis(), from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue([]) },
}));

vi.mock("@shared/schema/index.js", () => ({
  credentials: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
}));

// Mock AI client
vi.mock("@domain/ai/core/ai-client.service.js", () => ({
  AIClientFactory: {
    getClient: vi.fn().mockReturnValue({
      execute: vi.fn().mockResolvedValue({ success: true, output: '{"rankings":[]}' }),
    }),
  },
}));

// Mock logger
vi.mock("@server/utils/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock embedding retry
vi.mock("@server/utils/embedding-retry.js", () => ({
  withEmbeddingRetry: vi.fn((fn) => fn()),
}));

// Mock rag-utils
vi.mock("@domain/knowledge/core/rag-utils.service.js", () => ({
  getAssetPlainText: vi.fn().mockResolvedValue("test content"),
  buildRagContextString: vi.fn().mockResolvedValue({ context: "", sources: [] }),
}));

// ─── Mock Reranking Service ──────────────────────────────────────────────────

const mockRerank = vi.fn();

vi.mock("@domain/ai/core/reranking/reranking.service.js", () => ({
  getRerankingService: vi.fn(() => ({
    rerank: mockRerank,
  })),
}));

// ─── Import After Mocks ─────────────────────────────────────────────────────

import { retrieveSimilarDocuments } from "@domain/knowledge/core/rag-langchain.service.js";
import { getRerankingService } from "@domain/ai/core/reranking/reranking.service.js";

// ─── Tests ───────────────────────────────────────────────────────────────────

const TEST_ORG_ID = 1;

describe("Hybrid Search Pipeline ↔ Reranking Service Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: reranking service returns reranked results
    mockRerank.mockResolvedValue({
      results: [
        {
          id: "chunk-2",
          content: "Machine learning algorithms optimize production pipelines.",
          relevanceScore: 0.95,
          originalScore: 0.75,
          metadata: {
            assetId: 102,
            assetKey: "asset-102",
            name: "ML Systems",
            assetType: "document",
            sourceType: "upload",
            order: 1,
            chunkId: "chunk-2",
          },
        },
        {
          id: "chunk-1",
          content: "Artificial intelligence is transforming business processes.",
          relevanceScore: 0.88,
          originalScore: 0.9,
          metadata: {
            assetId: 101,
            assetKey: "asset-101",
            name: "AI Overview",
            assetType: "document",
            sourceType: "upload",
            order: 0,
            chunkId: "chunk-1",
          },
        },
        {
          id: "chunk-3",
          content: "Cloud computing provides scalable infrastructure for data workloads.",
          relevanceScore: 0.42,
          originalScore: 0.6,
          metadata: {
            assetId: 103,
            assetKey: "asset-103",
            name: "Cloud Infra",
            assetType: "document",
            sourceType: "upload",
            order: 2,
            chunkId: "chunk-3",
          },
        },
      ],
      metadata: {
        backendUsed: "cohere",
        fallbackTriggered: false,
        latencyMs: 120,
        documentCount: 3,
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Requirement 6.1: WHEN hybrid search completes weighted fusion, THE Hybrid_Search_Pipeline
   * SHALL pass the fused results to the Reranking_Service for re-scoring.
   */
  it("invokes rerankingService.rerank() when enableReranking is true", async () => {
    const results = await retrieveSimilarDocuments("AI automation", {
      // Retrieval always runs for an organization; without one it refuses.
      organizationId: TEST_ORG_ID,
      enableReranking: true,
      k: 5,
    });

    expect(getRerankingService).toHaveBeenCalled();
    expect(mockRerank).toHaveBeenCalledTimes(1);

    // Verify the reranking request includes the fused documents
    const rerankCall = mockRerank.mock.calls[0][0];
    expect(rerankCall.query).toBe("AI automation");
    expect(rerankCall.documents).toHaveLength(3);
    expect(rerankCall.documents[0]).toHaveProperty("id");
    expect(rerankCall.documents[0]).toHaveProperty("content");
  });

  /**
   * Requirement 6.2: THE Hybrid_Search_Pipeline SHALL support an `enableReranking` flag.
   * Requirement 6.3: WHEN `enableReranking` is false or not specified, THE pipeline
   * SHALL return results without invoking the Reranking_Service.
   */
  it("does NOT invoke reranking when enableReranking is false", async () => {
    const results = await retrieveSimilarDocuments("AI automation", {
      // Retrieval always runs for an organization; without one it refuses.
      organizationId: TEST_ORG_ID,
      enableReranking: false,
      k: 5,
    });

    expect(mockRerank).not.toHaveBeenCalled();
    expect(results.length).toBeGreaterThan(0);
  });

  /**
   * Requirement 6.3: Backward compatibility — when enableReranking is not specified,
   * reranking is NOT invoked (default is disabled).
   */
  it("does NOT invoke reranking when enableReranking is omitted (backward compatibility)", async () => {
    const results = await retrieveSimilarDocuments("AI automation", {
      // Retrieval always runs for an organization; without one it refuses.
      organizationId: TEST_ORG_ID,
      k: 5,
    });

    expect(mockRerank).not.toHaveBeenCalled();
    expect(results.length).toBeGreaterThan(0);
  });

  /**
   * Requirement 6.5: THE Reranking_Service SHALL attach the original pre-rerank score
   * alongside the new Relevance_Score on each returned document.
   */
  it("preserves originalScore (pre-rerank weighted fusion score) in results", async () => {
    const results = await retrieveSimilarDocuments("AI automation", {
      // Retrieval always runs for an organization; without one it refuses.
      organizationId: TEST_ORG_ID,
      enableReranking: true,
      k: 5,
    });

    // Verify the reranking call passes originalScore (the adjustedScore from fusion)
    const rerankCall = mockRerank.mock.calls[0][0];
    for (const doc of rerankCall.documents) {
      expect(doc).toHaveProperty("originalScore");
      expect(typeof doc.originalScore).toBe("number");
    }
  });

  /**
   * Requirement 6.4: THE Reranking_Service SHALL preserve all original metadata.
   */
  it("passes document metadata through to the reranking service", async () => {
    await retrieveSimilarDocuments("AI automation", {
      // Retrieval always runs for an organization; without one it refuses.
      organizationId: TEST_ORG_ID,
      enableReranking: true,
      k: 5,
    });

    const rerankCall = mockRerank.mock.calls[0][0];
    // Documents should carry metadata from the Qdrant payload
    for (const doc of rerankCall.documents) {
      expect(doc).toHaveProperty("metadata");
      expect(doc.metadata).toHaveProperty("name");
      expect(doc.metadata).toHaveProperty("assetType");
    }
  });

  /**
   * Requirement 6.1: Results after reranking use the reranked order.
   */
  it("returns results in the reranked order when reranking is enabled", async () => {
    const results = await retrieveSimilarDocuments("AI automation", {
      // Retrieval always runs for an organization; without one it refuses.
      organizationId: TEST_ORG_ID,
      enableReranking: true,
      k: 5,
    });

    // The mock reranking returns chunk-2 first (highest relevanceScore)
    expect(results[0].pageContent).toBe(
      "Machine learning algorithms optimize production pipelines."
    );
    expect(results[1].pageContent).toBe(
      "Artificial intelligence is transforming business processes."
    );
  });

  /**
   * Requirement 6.1: topK is passed through to the reranking service.
   */
  it("passes topK to the reranking service", async () => {
    await retrieveSimilarDocuments("AI automation", {
      // Retrieval always runs for an organization; without one it refuses.
      organizationId: TEST_ORG_ID,
      enableReranking: true,
      k: 2,
    });

    const rerankCall = mockRerank.mock.calls[0][0];
    expect(rerankCall.topK).toBe(2);
  });

  /**
   * Graceful degradation: when reranking service throws, results are returned
   * without reranking (no crash).
   */
  it("falls back to unranked results when reranking service throws", async () => {
    mockRerank.mockRejectedValueOnce(new Error("Service unavailable"));

    const results = await retrieveSimilarDocuments("AI automation", {
      // Retrieval always runs for an organization; without one it refuses.
      organizationId: TEST_ORG_ID,
      enableReranking: true,
      k: 5,
    });

    // Should still return results (from the initial search without reranking)
    expect(results.length).toBeGreaterThan(0);
    // Original order should be preserved (by initial search score)
    expect(results[0].score).toBeGreaterThanOrEqual(results[1].score!);
  });
});
