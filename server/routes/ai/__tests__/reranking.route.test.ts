/**
 * Unit Tests: Reranking API Route
 *
 * Tests for POST /api/ai/reranking/rerank including:
 * - Request validation (empty query, missing docs, >1000 docs, invalid backend, invalid topK)
 * - Authentication requirement (requireAuth blocks unauthenticated requests)
 * - Organization access control (403 when no org access)
 * - Successful reranking response shape
 *
 * Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// --- Hoisted mock references ---
const { mockGetUserOrgContext, mockRerank, mockRequireAuth } = vi.hoisted(() => ({
  mockGetUserOrgContext: vi.fn(),
  mockRerank: vi.fn(),
  mockRequireAuth: vi.fn((_req: any, _res: any, next: any) => next()),
}));

// --- Mocks: auth middleware ---
vi.mock("@domain/core/auth/security.service.js", () => ({
  requireAuth: mockRequireAuth,
}));

// --- Mocks: org context ---
vi.mock("@server/utils/auth-context.js", () => ({
  getUserOrgContext: mockGetUserOrgContext,
}));

// --- Mocks: reranking service ---
vi.mock("@domain/ai/core/reranking/reranking.service.js", () => ({
  getRerankingService: () => ({
    rerank: mockRerank,
  }),
}));

// --- Mocks: logger ---
vi.mock("@server/utils/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

// --- Mocks: error-handler asyncHandler (pass-through) ---
vi.mock("@server/middleware/error-handler.js", () => ({
  asyncHandler: (fn: any) => (req: any, res: any, next: any) =>
    Promise.resolve(fn(req, res, next)).catch(next),
}));

import rerankingRouter from "../reranking.route.js";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/ai/reranking", rerankingRouter);
  return app;
}

describe("Reranking API Route - POST /api/ai/reranking/rerank", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: authenticated user with org access
    mockRequireAuth.mockImplementation((_req: any, _res: any, next: any) => next());
    mockGetUserOrgContext.mockResolvedValue({
      userId: "user-1",
      organizationId: 1,
      isAdmin: false,
      isSuperAdmin: false,
      isOrgAdmin: false,
    });
  });

  // ─── Validation Tests ───────────────────────────────────────────────────────

  describe("Request Validation", () => {
    it("returns 400 with 'Query string is required' when query is missing", async () => {
      const app = makeApp();
      const res = await request(app)
        .post("/api/ai/reranking/rerank")
        .send({ documents: [{ id: "1", content: "hello" }] })
        .expect(400);

      expect(res.body.error).toBe("Query string is required");
    });

    it("returns 400 with 'Query string is required' when query is empty string", async () => {
      const app = makeApp();
      const res = await request(app)
        .post("/api/ai/reranking/rerank")
        .send({ query: "   ", documents: [{ id: "1", content: "hello" }] })
        .expect(400);

      expect(res.body.error).toBe("Query string is required");
    });

    it("returns 400 with 'Documents array is required' when documents is missing", async () => {
      const app = makeApp();
      const res = await request(app)
        .post("/api/ai/reranking/rerank")
        .send({ query: "search query" })
        .expect(400);

      expect(res.body.error).toBe("Documents array is required");
    });

    it("returns 400 with 'Documents array is required' when documents is not an array", async () => {
      const app = makeApp();
      const res = await request(app)
        .post("/api/ai/reranking/rerank")
        .send({ query: "search query", documents: "not-an-array" })
        .expect(400);

      expect(res.body.error).toBe("Documents array is required");
    });

    it("returns 400 with 'Maximum 1000 documents per request' when >1000 docs", async () => {
      const app = makeApp();
      const documents = Array.from({ length: 1001 }, (_, i) => ({
        id: `doc-${i}`,
        content: `content ${i}`,
      }));

      const res = await request(app)
        .post("/api/ai/reranking/rerank")
        .send({ query: "search query", documents })
        .expect(400);

      expect(res.body.error).toBe("Maximum 1000 documents per request");
    });

    it("returns 400 with 'Invalid backend. Must be: cohere, local, llm' for invalid backend", async () => {
      const app = makeApp();
      const res = await request(app)
        .post("/api/ai/reranking/rerank")
        .send({
          query: "search query",
          documents: [{ id: "1", content: "hello" }],
          backend: "openai",
        })
        .expect(400);

      expect(res.body.error).toBe("Invalid backend. Must be: cohere, local, llm");
    });

    it("returns 400 with 'topK must be a positive integer' for negative topK", async () => {
      const app = makeApp();
      const res = await request(app)
        .post("/api/ai/reranking/rerank")
        .send({
          query: "search query",
          documents: [{ id: "1", content: "hello" }],
          topK: -1,
        })
        .expect(400);

      expect(res.body.error).toBe("topK must be a positive integer");
    });

    it("returns 400 with 'topK must be a positive integer' for non-integer topK", async () => {
      const app = makeApp();
      const res = await request(app)
        .post("/api/ai/reranking/rerank")
        .send({
          query: "search query",
          documents: [{ id: "1", content: "hello" }],
          topK: 2.5,
        })
        .expect(400);

      expect(res.body.error).toBe("topK must be a positive integer");
    });

    it("returns 400 with 'topK must be a positive integer' for topK of 0", async () => {
      const app = makeApp();
      const res = await request(app)
        .post("/api/ai/reranking/rerank")
        .send({
          query: "search query",
          documents: [{ id: "1", content: "hello" }],
          topK: 0,
        })
        .expect(400);

      expect(res.body.error).toBe("topK must be a positive integer");
    });
  });

  // ─── Authentication Tests ───────────────────────────────────────────────────

  describe("Authentication", () => {
    it("returns 401 when requireAuth blocks the request", async () => {
      mockRequireAuth.mockImplementation((_req: any, res: any, _next: any) => {
        res.status(401).json({ error: "Authentication required" });
      });

      const app = makeApp();
      const res = await request(app)
        .post("/api/ai/reranking/rerank")
        .send({
          query: "search query",
          documents: [{ id: "1", content: "hello" }],
        })
        .expect(401);

      expect(res.body.error).toBe("Authentication required");
      expect(mockRerank).not.toHaveBeenCalled();
    });

    it("returns 403 with 'Organization access required' when no org access", async () => {
      mockGetUserOrgContext.mockResolvedValue({
        userId: "user-1",
        organizationId: null,
        isAdmin: false,
        isSuperAdmin: false,
        isOrgAdmin: false,
      });

      const app = makeApp();
      const res = await request(app)
        .post("/api/ai/reranking/rerank")
        .send({
          query: "search query",
          documents: [{ id: "1", content: "hello" }],
        })
        .expect(403);

      expect(res.body.error).toBe("Organization access required");
      expect(mockRerank).not.toHaveBeenCalled();
    });
  });

  // ─── Successful Request Tests ───────────────────────────────────────────────

  describe("Successful Reranking", () => {
    it("returns 200 with results and metadata on valid request", async () => {
      const mockResponse = {
        results: [
          { id: "doc-1", content: "relevant doc", relevanceScore: 0.95, metadata: {} },
          { id: "doc-2", content: "less relevant", relevanceScore: 0.72, metadata: {} },
        ],
        metadata: {
          backendUsed: "cohere",
          fallbackTriggered: false,
          latencyMs: 142,
          documentCount: 2,
        },
      };
      mockRerank.mockResolvedValue(mockResponse);

      const app = makeApp();
      const res = await request(app)
        .post("/api/ai/reranking/rerank")
        .send({
          query: "search query",
          documents: [
            { id: "doc-1", content: "relevant doc" },
            { id: "doc-2", content: "less relevant" },
          ],
        })
        .expect(200);

      // Verify response shape
      expect(res.body.results).toBeInstanceOf(Array);
      expect(res.body.results).toHaveLength(2);
      expect(res.body.results[0]).toHaveProperty("id");
      expect(res.body.results[0]).toHaveProperty("content");
      expect(res.body.results[0]).toHaveProperty("relevanceScore");

      expect(res.body.metadata).toBeDefined();
      expect(res.body.metadata).toHaveProperty("backendUsed", "cohere");
      expect(res.body.metadata).toHaveProperty("fallbackTriggered", false);
      expect(res.body.metadata).toHaveProperty("latencyMs", 142);
      expect(res.body.metadata).toHaveProperty("documentCount", 2);
    });

    it("passes query, documents, topK, and backend to the reranking service", async () => {
      mockRerank.mockResolvedValue({
        results: [{ id: "doc-1", content: "c", relevanceScore: 1.0, metadata: {} }],
        metadata: { backendUsed: "local", fallbackTriggered: false, latencyMs: 50, documentCount: 1 },
      });

      const app = makeApp();
      await request(app)
        .post("/api/ai/reranking/rerank")
        .send({
          query: "  my query  ",
          documents: [{ id: "doc-1", content: "content", metadata: { key: "val" }, originalScore: 0.8 }],
          topK: 5,
          backend: "local",
        })
        .expect(200);

      expect(mockRerank).toHaveBeenCalledOnce();
      const [rerankArg] = mockRerank.mock.calls[0];
      expect(rerankArg.query).toBe("my query"); // trimmed
      expect(rerankArg.documents).toHaveLength(1);
      expect(rerankArg.documents[0].id).toBe("doc-1");
      expect(rerankArg.documents[0].content).toBe("content");
      expect(rerankArg.documents[0].metadata).toEqual({ key: "val" });
      expect(rerankArg.documents[0].originalScore).toBe(0.8);
      expect(rerankArg.topK).toBe(5);
      expect(rerankArg.backend).toBe("local");
      expect(rerankArg.options.organizationId).toBe(1);
    });

    it("accepts valid backend types: cohere, local, llm", async () => {
      mockRerank.mockResolvedValue({
        results: [],
        metadata: { backendUsed: "cohere", fallbackTriggered: false, latencyMs: 10, documentCount: 0 },
      });

      const app = makeApp();

      for (const backend of ["cohere", "local", "llm"]) {
        const res = await request(app)
          .post("/api/ai/reranking/rerank")
          .send({
            query: "test",
            documents: [{ id: "1", content: "c" }],
            backend,
          })
          .expect(200);

        expect(res.status).toBe(200);
      }
    });

    it("allows request without optional fields (topK, backend)", async () => {
      mockRerank.mockResolvedValue({
        results: [{ id: "doc-0", content: "c", relevanceScore: 1.0, metadata: {} }],
        metadata: { backendUsed: "cohere", fallbackTriggered: false, latencyMs: 20, documentCount: 1 },
      });

      const app = makeApp();
      const res = await request(app)
        .post("/api/ai/reranking/rerank")
        .send({
          query: "query",
          documents: [{ content: "just content, no id" }],
        })
        .expect(200);

      expect(res.body.results).toBeDefined();
      // Verify auto-generated ID for doc without explicit id
      const [rerankArg] = mockRerank.mock.calls[0];
      expect(rerankArg.documents[0].id).toBe("doc-0");
    });
  });
});
