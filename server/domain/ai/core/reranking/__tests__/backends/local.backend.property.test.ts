/**
 * Property-based tests for LocalBackend batching correctness
 *
 * Feature: reranking-service, Property 10: Local backend batching correctness
 *
 * For any list of N documents and a configured batch size B, the local backend
 * SHALL produce exactly ceil(N / B) batches, each containing at most B document pairs.
 *
 * Validates: Requirements 4.4
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fc from "fast-check";
import { LocalBackend } from "../../backends/local.backend.js";
import type { CandidateDocument } from "../../types.js";

/**
 * Generate a list of N CandidateDocuments with unique IDs.
 */
function generateDocuments(n: number): CandidateDocument[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `doc-${i}`,
    content: `Content for document ${i}`,
  }));
}

describe("LocalBackend batching correctness (Property 10)", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("Feature: reranking-service, Property 10: Local backend batching correctness — produces exactly ceil(N/B) batches each with at most B documents", async () => {
    await fc.assert(
      fc.asyncProperty(
        // N: number of documents (1 to 200)
        fc.integer({ min: 1, max: 200 }),
        // B: batch size (1 to 50)
        fc.integer({ min: 1, max: 50 }),
        async (numDocs, batchSize) => {
          // Track rerank batch calls
          const batchBodies: any[] = [];

          // Mock global fetch to intercept all requests
          globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = typeof input === "string"
              ? input
              : input instanceof URL
                ? input.toString()
                : input.url;

            // Handle rerank requests — record the batch body
            if (url.includes("/api/rerank")) {
              const body = JSON.parse(init?.body as string);
              batchBodies.push(body);

              const results = body.documents.map((_: any, index: number) => ({
                index,
                relevance_score: 0.5 + index * 0.01,
              }));

              return new Response(JSON.stringify({ results }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
              });
            }

            // Health check
            if (url.includes("/api/tags")) {
              return new Response(JSON.stringify({ models: [] }), { status: 200 });
            }

            return new Response(JSON.stringify({ results: [] }), { status: 200 });
          }) as typeof fetch;

          const backend = new LocalBackend({
            endpoint: "http://localhost:11434",
            model: "test-model",
            batchSize,
            timeoutMs: 5000,
          });

          const documents = generateDocuments(numDocs);
          await backend.score("test query", documents);

          const expectedBatches = Math.ceil(numDocs / batchSize);

          // 1. Exactly ceil(N/batchSize) batch requests were made
          expect(batchBodies.length).toBe(expectedBatches);

          // 2. Each batch contains at most batchSize documents (and at least 1)
          for (const body of batchBodies) {
            expect(body.documents.length).toBeLessThanOrEqual(batchSize);
            expect(body.documents.length).toBeGreaterThan(0);
          }

          // 3. All N documents are covered across all batches
          const totalDocsCovered = batchBodies.reduce(
            (sum, body) => sum + body.documents.length,
            0
          );
          expect(totalDocsCovered).toBe(numDocs);
        }
      ),
      { numRuns: 100 }
    );
  });
});
