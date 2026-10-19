/**
 * LLM-Based Reranking Backend
 *
 * Uses general-purpose LLM inference via the LLM Router to estimate
 * document relevance against a query. Constructs a scoring prompt
 * asking the model to rate documents on a 0–10 scale, parses JSON
 * response into per-document raw scores.
 *
 * Returns original ordering with a warning if parsing fails (never throws).
 * Splits large document sets into groups of maxDocsPerPrompt.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5
 */

import type { CandidateDocument, RerankBackendConfig, RerankOptions } from "../types.js";
import type { RawScore, RerankBackend } from "./rerank-backend.interface.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("LLMRerankBackend");

const DEFAULT_MAX_DOCS_PER_PROMPT = 20;
const DEFAULT_TEMPERATURE = 0;

/** Interface for making LLM calls through the router. */
export interface LLMRouterClient {
  complete(
    prompt: string,
    options?: { model?: string; temperature?: number; routingStrategy?: string }
  ): Promise<string>;
  isAvailable(): Promise<boolean>;
}

/** Config specific to the LLM reranking backend. */
export interface LLMBackendConfig {
  maxDocsPerPrompt?: number;
  model?: string;
  temperature?: number;
}

/**
 * ParseError is no longer thrown by LLMBackend (it returns fallback scores instead),
 * but exported for backward compatibility with the service layer catch block.
 * @deprecated LLMBackend now handles parse failures internally.
 */
export class ParseError extends Error {
  constructor(message: string, public readonly rawResponse?: string) {
    super(message);
    this.name = "ParseError";
  }
}

/** Expected shape of the LLM's JSON response. */
interface RankingResponsePayload {
  rankings: Array<{ index: number; score: number }>;
}

/**
 * Split an array of documents into groups of at most `maxPerGroup`.
 * Exported for testability (Property 11).
 */
export function splitIntoGroups(
  documents: CandidateDocument[],
  maxPerGroup: number
): CandidateDocument[][] {
  if (maxPerGroup <= 0) {
    throw new Error("maxPerGroup must be a positive integer");
  }

  const groups: CandidateDocument[][] = [];
  for (let i = 0; i < documents.length; i += maxPerGroup) {
    groups.push(documents.slice(i, i + maxPerGroup));
  }
  return groups;
}

/**
 * Parse the LLM's JSON ranking response into per-document raw scores.
 * Returns null if parsing fails (malformed JSON, missing fields, wrong count, etc.).
 * Exported for testability (Property 9).
 *
 * Scores are expected on a 0–10 scale (raw scores; normalization happens at the service layer).
 */
export function parseRankingResponse(
  response: string,
  documentCount: number
): RawScore[] | null {
  try {
    // Try to extract JSON from the response (LLMs sometimes wrap in markdown fences)
    const jsonStr = extractJson(response);
    if (!jsonStr) return null;

    const parsed = JSON.parse(jsonStr) as RankingResponsePayload;

    if (!parsed || !Array.isArray(parsed.rankings)) {
      return null;
    }

    // Validate each entry has a numeric index and score
    for (const entry of parsed.rankings) {
      if (
        typeof entry.index !== "number" ||
        typeof entry.score !== "number" ||
        entry.index < 0 ||
        entry.index >= documentCount ||
        !isFinite(entry.score)
      ) {
        return null;
      }
    }

    // Ensure we have exactly as many rankings as documents
    if (parsed.rankings.length !== documentCount) {
      return null;
    }

    // Check for duplicate indices
    const seenIndices = new Set<number>();
    for (const entry of parsed.rankings) {
      if (seenIndices.has(entry.index)) {
        return null;
      }
      seenIndices.add(entry.index);
    }

    // Return placeholder IDs keyed by index — the caller maps them to real doc IDs.
    return parsed.rankings.map((entry) => ({
      documentId: `__index_${entry.index}`,
      score: entry.score,
    }));
  } catch {
    return null;
  }
}

/**
 * Extract a JSON object from a response string.
 * Handles cases where the LLM wraps output in markdown code fences.
 */
function extractJson(response: string): string | null {
  const trimmed = response.trim();

  // Try direct parse first
  if (trimmed.startsWith("{")) {
    return trimmed;
  }

  // Try extracting from markdown code fence
  const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch?.[1]) {
    return fenceMatch[1].trim();
  }

  // Try finding the first { ... } block
  const braceStart = trimmed.indexOf("{");
  const braceEnd = trimmed.lastIndexOf("}");
  if (braceStart !== -1 && braceEnd > braceStart) {
    return trimmed.slice(braceStart, braceEnd + 1);
  }

  return null;
}

/**
 * Generate fallback scores that preserve original document order.
 * Assigns descending scores based on position so the service layer
 * returns documents in their original input order after sorting.
 */
function generateFallbackScores(documents: CandidateDocument[]): RawScore[] {
  return documents.map((doc, index) => ({
    documentId: doc.id,
    score: documents.length - index, // Descending: first doc gets highest score
  }));
}

export class LLMBackend implements RerankBackend {
  readonly type = "llm" as const;

  private maxDocsPerPrompt: number;
  private model: string | undefined;
  private temperature: number;
  private router: LLMRouterClient;

  constructor(config: LLMBackendConfig | RerankBackendConfig["llm"], router: LLMRouterClient) {
    this.maxDocsPerPrompt = config?.maxDocsPerPrompt ?? DEFAULT_MAX_DOCS_PER_PROMPT;
    this.model = config?.model;
    this.temperature = config?.temperature ?? DEFAULT_TEMPERATURE;
    this.router = router;
  }

  /**
   * Score query-document pairs by constructing a relevance-scoring prompt,
   * routing through the LLM Router with routingStrategy: "cost", and
   * parsing the JSON response.
   *
   * If the document set exceeds maxDocsPerPrompt, splits into groups
   * and makes multiple LLM calls, merging results.
   *
   * If parsing fails for any group, logs a warning and returns fallback
   * scores that preserve original document order (never throws).
   */
  async score(
    query: string,
    documents: CandidateDocument[],
    options?: RerankOptions
  ): Promise<RawScore[]> {
    const maxDocs = options?.maxDocumentsPerPrompt ?? this.maxDocsPerPrompt;
    const groups = splitIntoGroups(documents, maxDocs);

    const allScores: RawScore[] = [];

    for (const group of groups) {
      const prompt = this.buildPrompt(query, group);

      let response: string;
      try {
        response = await this.router.complete(prompt, {
          model: this.model,
          temperature: this.temperature,
          routingStrategy: "cost",
        });
      } catch (error: any) {
        logger.warn("[LLMBackend] LLM Router call failed, returning original order", {
          documentCount: documents.length,
          groupSize: group.length,
          error: error.message,
        });
        return generateFallbackScores(documents);
      }

      const parsed = parseRankingResponse(response, group.length);

      if (!parsed) {
        logger.warn("[LLMBackend] Failed to parse LLM response, returning original order", {
          documentCount: documents.length,
          groupSize: group.length,
          responsePreview: response.slice(0, 200),
        });
        return generateFallbackScores(documents);
      }

      // Map the placeholder index-based IDs back to real document IDs
      const mappedScores = parsed.map((rawScore) => {
        const indexStr = rawScore.documentId.replace("__index_", "");
        const localIndex = parseInt(indexStr, 10);
        const doc = group[localIndex];
        return {
          documentId: doc.id,
          score: rawScore.score,
        };
      });

      allScores.push(...mappedScores);
    }

    return allScores;
  }

  /**
   * Check if the LLM Router is available.
   */
  async isAvailable(): Promise<boolean> {
    try {
      return await this.router.isAvailable();
    } catch {
      return false;
    }
  }

  /**
   * Build the relevance-scoring prompt for a group of documents.
   * Asks the model to rate on a 0–10 scale (raw scores; normalization
   * to 0–1 happens at the service layer).
   */
  private buildPrompt(query: string, documents: CandidateDocument[]): string {
    const docList = documents
      .map((doc, index) => `[Document ${index}]: ${doc.content}`)
      .join("\n\n");

    return `You are a relevance scoring system. Given a query and a list of documents, rate each document's relevance to the query on a scale from 0 to 10, where 10 means perfectly relevant and 0 means completely irrelevant.

Query: ${query}

Documents:
${docList}

Respond with ONLY a JSON object in exactly this format (no other text):
{ "rankings": [{ "index": 0, "score": 8.5 }, { "index": 1, "score": 3.2 }, ...] }

Rules:
- Include ALL ${documents.length} documents in your response
- Each "index" must correspond to the document number shown above
- Each "score" must be a number between 0 and 10
- Return ONLY the JSON object, no explanations`;
  }
}
