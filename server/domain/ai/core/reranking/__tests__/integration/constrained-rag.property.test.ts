/**
 * Property-based tests for RetrievedFact content extraction in the constrained RAG integration.
 *
 * Uses fast-check for property-based testing with a minimum of 100 iterations.
 * Tag: Feature: reranking-service, Property 12: RetrievedFact content extraction
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import fc from "fast-check";
import { RerankingService } from "../../reranking.service.js";
import type {
  CandidateDocument,
  RerankBackendConfig,
  RerankBackendType,
} from "../../types.js";
import type { RerankBackend, RawScore } from "../../backends/rerank-backend.interface.js";

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("@server/utils/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("../../telemetry.js", () => ({
  emitRerankTelemetry: vi.fn(),
  emitFallbackWarning: vi.fn(),
}));

vi.mock("../../config.js", () => ({
  saveRerankingConfig: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../backends/cohere.backend.js", () => ({
  RerankBackendError: class RerankBackendError extends Error {
    reason?: string;
    constructor(message: string, reason?: string) {
      super(message);
      this.reason = reason;
    }
  },
}));

vi.mock("../../backends/llm.backend.js", () => ({
  ParseError: class ParseError extends Error {
    constructor(message: string) {
      super(message);
    }
  },
}));

// ─── RetrievedFact Interface (matches constrained-rag.service.ts) ────────────

interface RetrievedFact {
  id: string;
  content: string;
  source: string;
  confidence: number;
}

// ─── Mapping Function Under Test ─────────────────────────────────────────────

/**
 * Maps RetrievedFact objects to CandidateDocument format.
 * This replicates the mapping logic from constrained-rag.service.ts:
 *   - fact.content → CandidateDocument.content (used for scoring)
 *   - fact.id → CandidateDocument.id
 *   - { ...fact, content: undefined } → CandidateDocument.metadata
 *   - fact.confidence → CandidateDocument.originalScore
 */
function mapFactsToCandidateDocuments(facts: RetrievedFact[]): CandidateDocument[] {
  return facts.map((fact, index) => ({
    id: fact.id || `fact-${index}`,
    content: fact.content,
    metadata: { ...fact, content: undefined },
    originalScore: fact.confidence,
  }));
}

// ─── Generators ──────────────────────────────────────────────────────────────

/** Generate a fact ID */
const factIdArb = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter((s) => s.trim().length > 0 && /^[a-zA-Z0-9_-]+$/.test(s));

/** Generate fact content (non-empty text) */
const factContentArb = fc
  .string({ minLength: 1, maxLength: 300 })
  .filter((s) => s.trim().length > 0);

/** Generate a source string */
const sourceArb = fc
  .string({ minLength: 1, maxLength: 100 })
  .filter((s) => s.trim().length > 0);

/** Generate a confidence score in [0, 1] */
const confidenceArb = fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true });

/** Generate a single RetrievedFact */
const retrievedFactArb: fc.Arbitrary<RetrievedFact> = fc
  .tuple(factIdArb, factContentArb, sourceArb, confidenceArb)
  .map(([id, content, source, confidence]) => ({
    id,
    content,
    source,
    confidence,
  }));

/** Generate a non-empty array of RetrievedFacts with unique IDs */
const retrievedFactsArb = fc.uniqueArray(retrievedFactArb, {
  minLength: 1,
  maxLength: 20,
  comparator: (a, b) => a.id === b.id,
});

/** Generate a query string */
const queryArb = fc
  .string({ minLength: 1, maxLength: 100 })
  .filter((s) => s.trim().length > 0);

// ─── Mock Backend that Records Received Content ──────────────────────────────

/**
 * Creates a mock backend that records what content was submitted for scoring.
 * This allows us to verify that fact.content was used as the scoring input.
 */
function createRecordingBackend(): {
  backend: RerankBackend;
  getReceivedDocuments: () => CandidateDocument[];
} {
  let receivedDocuments: CandidateDocument[] = [];

  const backend: RerankBackend = {
    type: "cohere" as RerankBackendType,
    async score(
      _query: string,
      documents: CandidateDocument[]
    ): Promise<RawScore[]> {
      receivedDocuments = [...documents];
      return documents.map((doc, index) => ({
        documentId: doc.id,
        score: (documents.length - index) / documents.length,
      }));
    },
    async isAvailable(): Promise<boolean> {
      return true;
    },
  };

  return {
    backend,
    getReceivedDocuments: () => receivedDocuments,
  };
}

// ─── Service Factory ─────────────────────────────────────────────────────────

function createTestService(backend: RerankBackend): RerankingService {
  const config: RerankBackendConfig = {
    defaultBackend: backend.type,
    priorityOrder: [backend.type],
  };
  const backends = new Map<RerankBackendType, RerankBackend>();
  backends.set(backend.type, backend);
  return new RerankingService(config, backends);
}

// ─── Property 12: RetrievedFact content extraction ───────────────────────────

describe("Feature: reranking-service, Property 12: RetrievedFact content extraction", () => {
  let recordingBackend: ReturnType<typeof createRecordingBackend>;
  let service: RerankingService;

  beforeEach(() => {
    recordingBackend = createRecordingBackend();
    service = createTestService(recordingBackend.backend);
  });

  /**
   * **Validates: Requirements 7.2**
   *
   * For any RetrievedFact, its content field is used as the CandidateDocument.content
   * for backend scoring. The mock backend receives the fact's content text.
   */
  it("fact content field is used as the candidate document content for scoring", async () => {
    await fc.assert(
      fc.asyncProperty(queryArb, retrievedFactsArb, async (query, facts) => {
        const candidateDocs = mapFactsToCandidateDocuments(facts);
        await service.rerank({ query, documents: candidateDocs });

        const receivedDocs = recordingBackend.getReceivedDocuments();

        // The backend must receive exactly the fact's content for each document
        for (const fact of facts) {
          const receivedDoc = receivedDocs.find((d) => d.id === fact.id);
          expect(receivedDoc).toBeDefined();
          expect(receivedDoc!.content).toBe(fact.content);
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 7.2**
   *
   * For any RetrievedFact, after reranking the result's content matches
   * the original fact's content field exactly.
   */
  it("reranked result content matches the original fact content", async () => {
    await fc.assert(
      fc.asyncProperty(queryArb, retrievedFactsArb, async (query, facts) => {
        const candidateDocs = mapFactsToCandidateDocuments(facts);
        const response = await service.rerank({ query, documents: candidateDocs });

        for (const fact of facts) {
          const result = response.results.find((r) => r.id === fact.id);
          expect(result).toBeDefined();
          expect(result!.content).toBe(fact.content);
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 7.2**
   *
   * For any RetrievedFact, all non-content fields (id, source, confidence)
   * are preserved in the result's metadata.
   */
  it("all non-content fact fields are preserved in result metadata", async () => {
    await fc.assert(
      fc.asyncProperty(queryArb, retrievedFactsArb, async (query, facts) => {
        const candidateDocs = mapFactsToCandidateDocuments(facts);
        const response = await service.rerank({ query, documents: candidateDocs });

        for (const fact of facts) {
          const result = response.results.find((r) => r.id === fact.id);
          expect(result).toBeDefined();
          expect(result!.metadata).toBeDefined();

          // id is preserved in metadata
          expect(result!.metadata!.id).toBe(fact.id);
          // source is preserved in metadata
          expect(result!.metadata!.source).toBe(fact.source);
          // confidence is preserved in metadata
          expect(result!.metadata!.confidence).toBe(fact.confidence);
          // content is explicitly set to undefined in metadata (not used as metadata value)
          expect(result!.metadata!.content).toBeUndefined();
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 7.2**
   *
   * For any RetrievedFact, the fact's confidence score is preserved
   * as the originalScore on the reranked result.
   */
  it("fact confidence is preserved as originalScore in the result", async () => {
    await fc.assert(
      fc.asyncProperty(queryArb, retrievedFactsArb, async (query, facts) => {
        const candidateDocs = mapFactsToCandidateDocuments(facts);
        const response = await service.rerank({ query, documents: candidateDocs });

        for (const fact of facts) {
          const result = response.results.find((r) => r.id === fact.id);
          expect(result).toBeDefined();
          expect(result!.originalScore).toBe(fact.confidence);
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 7.2**
   *
   * The mapping produces exactly one CandidateDocument per RetrievedFact,
   * and no facts are lost or duplicated during the conversion process.
   */
  it("mapping produces exactly one CandidateDocument per fact with no loss", () => {
    fc.assert(
      fc.property(retrievedFactsArb, (facts) => {
        const candidateDocs = mapFactsToCandidateDocuments(facts);

        // Same number of documents as facts
        expect(candidateDocs.length).toBe(facts.length);

        // All fact IDs are present in the candidate documents
        const docIds = new Set(candidateDocs.map((d) => d.id));
        for (const fact of facts) {
          expect(docIds.has(fact.id)).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });
});
