/**
 * Reranking API Routes
 *
 * REST endpoint for submitting reranking requests to the multi-backend
 * reranking service. Validates input, enforces auth/org access, and
 * returns scored results with metadata.
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5
 */

import { Router, type Request, type Response } from "express";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { getUserOrgContext } from "@server/utils/auth-context.js";
import { getRerankingService } from "@domain/ai/core/reranking/reranking.service.js";
import type { RerankBackendType, CandidateDocument } from "@domain/ai/core/reranking/types.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("RerankingAPI");
const router = Router();

/** Valid backend types for request validation. */
const VALID_BACKENDS: RerankBackendType[] = ["cohere", "local", "llm"];

/** Maximum number of documents per request (Requirement 8.4). */
const MAX_DOCUMENTS = 1000;

/**
 * POST /api/ai/reranking/rerank
 *
 * Submit a reranking request. Requires authentication and enforces
 * organization-scoped access control.
 *
 * Request body:
 *   - query (string, required): The query to score documents against
 *   - documents (array, required): Candidate documents (max 1000)
 *   - topK (number, optional): Return only top K results
 *   - backend ("cohere" | "local" | "llm", optional): Preferred backend
 *
 * Response:
 *   - results: Reranked documents with relevanceScore
 *   - metadata: backendUsed, fallbackTriggered, latencyMs, documentCount
 */
router.post("/rerank", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  // Enforce organization-scoped access control (Requirement 8.3)
  const orgContext = await getUserOrgContext(req);

  if (!orgContext.organizationId) {
    res.status(403).json({ error: "Organization access required" });
    return;
  }

  const { query, documents, topK, backend } = req.body;

  // Validate: query is required and must be a non-empty string
  if (!query || typeof query !== "string" || query.trim().length === 0) {
    res.status(400).json({ error: "Query string is required" });
    return;
  }

  // Validate: documents is required and must be an array
  if (!documents || !Array.isArray(documents)) {
    res.status(400).json({ error: "Documents array is required" });
    return;
  }

  // Validate: documents array must not exceed MAX_DOCUMENTS (Requirement 8.4)
  if (documents.length > MAX_DOCUMENTS) {
    res.status(400).json({ error: "Maximum 1000 documents per request" });
    return;
  }

  // Validate: backend must be a valid type if specified
  if (backend !== undefined && !VALID_BACKENDS.includes(backend)) {
    res.status(400).json({ error: "Invalid backend. Must be: cohere, local, llm" });
    return;
  }

  // Validate: topK must be a positive integer if specified
  if (topK !== undefined && (typeof topK !== "number" || topK < 1 || !Number.isInteger(topK))) {
    res.status(400).json({ error: "topK must be a positive integer" });
    return;
  }

  // Map request documents to CandidateDocument[]
  const candidateDocuments: CandidateDocument[] = documents.map((doc: any, index: number) => ({
    id: doc.id || `doc-${index}`,
    content: doc.content || "",
    metadata: doc.metadata,
    originalScore: doc.originalScore,
  }));

  // Invoke the reranking service (Requirement 8.2)
  const rerankingService = getRerankingService();
  const response = await rerankingService.rerank({
    query: query.trim(),
    documents: candidateDocuments,
    topK,
    backend,
    options: {
      organizationId: orgContext.organizationId,
    },
  });

  logger.info("Reranking API request completed", {
    organizationId: orgContext.organizationId,
    userId: orgContext.userId,
    documentCount: candidateDocuments.length,
    backendUsed: response.metadata.backendUsed,
    latencyMs: response.metadata.latencyMs,
  });

  // Return structured response with metadata (Requirements 8.2, 8.5)
  res.json(response);
}));

export default router;
