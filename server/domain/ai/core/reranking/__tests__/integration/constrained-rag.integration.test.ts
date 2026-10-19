/**
 * Integration tests for Constrained RAG Service ↔ Reranking Service.
 *
 * Validates that the constrained RAG service correctly invokes the
 * reranking service to re-score retrieved facts, maps RetrievedFact.content
 * to CandidateDocument.content, and uses the reranked order for fact
 * prioritization in the generation prompt.
 *
 * Requirements: 7.1, 7.2, 7.3
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mock External Dependencies ──────────────────────────────────────────────

// Mock logger
vi.mock("@server/utils/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock AI client — capture the prompt passed to execute() for verification
const mockExecute = vi.fn().mockResolvedValue({
  success: true,
  output: "According to the facts, AI is transformative [FACT-1] and ML optimizes pipelines [FACT-2].",
});

vi.mock("@domain/ai/core/ai-client.service.js", () => ({
  AIClientFactory: {
    getClient: vi.fn(() => ({
      execute: mockExecute,
    })),
  },
}));

// ─── Mock Reranking Service ──────────────────────────────────────────────────

const mockRerank = vi.fn();

vi.mock("@domain/ai/core/reranking/reranking.service.js", () => ({
  getRerankingService: vi.fn(() => ({
    rerank: mockRerank,
  })),
}));

// ─── Import After Mocks ─────────────────────────────────────────────────────

import { ConstrainedRAGService, type RetrievedFact } from "@domain/knowledge/core/constrained-rag.service.js";
import { getRerankingService } from "@domain/ai/core/reranking/reranking.service.js";

// ─── Test Data ───────────────────────────────────────────────────────────────

const testFacts: RetrievedFact[] = [
  {
    id: "fact-1",
    content: "Artificial intelligence is transforming the industry.",
    source: "AI Report 2024",
    confidence: 0.92,
  },
  {
    id: "fact-2",
    content: "Machine learning pipelines improve production efficiency by 40%.",
    source: "ML Engineering Guide",
    confidence: 0.85,
  },
  {
    id: "fact-3",
    content: "Cloud services reduce infrastructure costs significantly.",
    source: "Cloud Economics Paper",
    confidence: 0.78,
  },
];

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Constrained RAG Service ↔ Reranking Service Integration", () => {
  let service: ConstrainedRAGService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ConstrainedRAGService();

    // Default: reranking reorders facts (fact-2 ranked higher than fact-1)
    mockRerank.mockResolvedValue({
      results: [
        {
          id: "fact-2",
          content: "Machine learning pipelines improve production efficiency by 40%.",
          relevanceScore: 0.97,
          originalScore: 0.85,
          metadata: { source: "ML Engineering Guide", confidence: 0.85 },
        },
        {
          id: "fact-1",
          content: "Artificial intelligence is transforming the industry.",
          relevanceScore: 0.89,
          originalScore: 0.92,
          metadata: { source: "AI Report 2024", confidence: 0.92 },
        },
        {
          id: "fact-3",
          content: "Cloud services reduce infrastructure costs significantly.",
          relevanceScore: 0.45,
          originalScore: 0.78,
          metadata: { source: "Cloud Economics Paper", confidence: 0.78 },
        },
      ],
      metadata: {
        backendUsed: "cohere",
        fallbackTriggered: false,
        latencyMs: 95,
        documentCount: 3,
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Requirement 7.1: WHEN the Constrained RAG service retrieves facts for generation,
   * THE Constrained RAG service SHALL invoke the Reranking_Service to re-score
   * retrieved facts against the user query.
   */
  it("invokes rerankingService.rerank() with retrieved facts", async () => {
    await service.generateWithConstraints(
      "How does AI improve productivity?",
      testFacts,
    );

    expect(getRerankingService).toHaveBeenCalled();
    expect(mockRerank).toHaveBeenCalledTimes(1);

    const rerankCall = mockRerank.mock.calls[0][0];
    expect(rerankCall.query).toBe("How does AI improve productivity?");
    expect(rerankCall.documents).toHaveLength(3);
  });

  /**
   * Requirement 7.2: THE Reranking_Service SHALL accept RetrievedFact objects as
   * Candidate_Documents by extracting their content field for scoring.
   */
  it("maps RetrievedFact.content to CandidateDocument.content for scoring", async () => {
    await service.generateWithConstraints(
      "How does AI improve productivity?",
      testFacts,
    );

    const rerankCall = mockRerank.mock.calls[0][0];
    const documents = rerankCall.documents;

    // Each CandidateDocument.content should match the fact's content
    expect(documents[0].content).toBe(testFacts[0].content);
    expect(documents[1].content).toBe(testFacts[1].content);
    expect(documents[2].content).toBe(testFacts[2].content);
  });

  /**
   * Requirement 7.2: Fact IDs are preserved in the CandidateDocument mapping.
   */
  it("preserves fact IDs in CandidateDocument.id", async () => {
    await service.generateWithConstraints(
      "How does AI improve productivity?",
      testFacts,
    );

    const rerankCall = mockRerank.mock.calls[0][0];
    const documents = rerankCall.documents;

    expect(documents[0].id).toBe("fact-1");
    expect(documents[1].id).toBe("fact-2");
    expect(documents[2].id).toBe("fact-3");
  });

  /**
   * Requirement 7.2: originalScore on CandidateDocuments is set to fact confidence.
   */
  it("maps fact confidence to CandidateDocument.originalScore", async () => {
    await service.generateWithConstraints(
      "How does AI improve productivity?",
      testFacts,
    );

    const rerankCall = mockRerank.mock.calls[0][0];
    const documents = rerankCall.documents;

    expect(documents[0].originalScore).toBe(0.92);
    expect(documents[1].originalScore).toBe(0.85);
    expect(documents[2].originalScore).toBe(0.78);
  });

  /**
   * Requirement 7.3: WHEN reranking is applied to retrieved facts, THE Constrained
   * RAG service SHALL use the reranked order to prioritize facts in the generation prompt.
   */
  it("uses reranked fact order in the generation prompt", async () => {
    await service.generateWithConstraints(
      "How does AI improve productivity?",
      testFacts,
    );

    // The mock execute captures the prompt — verify fact ordering
    expect(mockExecute).toHaveBeenCalledTimes(1);
    const executeCall = mockExecute.mock.calls[0][0];
    const prompt = executeCall.userPrompt;

    // After reranking, fact-2 should appear before fact-1 in the prompt
    const fact2Position = prompt.indexOf("Machine learning pipelines");
    const fact1Position = prompt.indexOf("Artificial intelligence is transforming");
    const fact3Position = prompt.indexOf("Cloud services reduce");

    expect(fact2Position).toBeLessThan(fact1Position);
    expect(fact1Position).toBeLessThan(fact3Position);
  });

  /**
   * Requirement 7.1: Reranking is invoked by default when the service is enabled.
   * Backward compatibility — generation still works when reranking service is unavailable.
   */
  it("continues with original fact order when reranking service throws", async () => {
    mockRerank.mockRejectedValueOnce(new Error("Service unavailable"));

    const result = await service.generateWithConstraints(
      "How does AI improve productivity?",
      testFacts,
    );

    // Should still produce a result (no crash)
    expect(result).toHaveProperty("generatedText");
    expect(result.generatedText).not.toBe("");

    // The prompt should use original fact order (fact-1 before fact-2)
    const executeCall = mockExecute.mock.calls[0][0];
    const prompt = executeCall.userPrompt;
    const fact1Position = prompt.indexOf("Artificial intelligence is transforming");
    const fact2Position = prompt.indexOf("Machine learning pipelines");

    expect(fact1Position).toBeLessThan(fact2Position);
  });

  /**
   * Requirement 7.3: When config.enabled is false, unconstrained generation is used
   * and reranking is NOT invoked.
   */
  it("does NOT invoke reranking when config.enabled is false", async () => {
    await service.generateWithConstraints(
      "How does AI improve productivity?",
      testFacts,
      { enabled: false },
    );

    // Unconstrained path bypasses the reranking step
    expect(mockRerank).not.toHaveBeenCalled();
  });

  /**
   * Requirement 7.2: All fact fields are preserved through the reranking process.
   */
  it("preserves all fact fields in metadata through reranking", async () => {
    await service.generateWithConstraints(
      "How does AI improve productivity?",
      testFacts,
    );

    const rerankCall = mockRerank.mock.calls[0][0];
    const documents = rerankCall.documents;

    // metadata should contain the fact's non-content fields
    for (let i = 0; i < documents.length; i++) {
      expect(documents[i].metadata).toHaveProperty("source");
      expect(documents[i].metadata).toHaveProperty("confidence");
      expect(documents[i].metadata.source).toBe(testFacts[i].source);
      expect(documents[i].metadata.confidence).toBe(testFacts[i].confidence);
    }
  });
});
