/**
 * Semantic Deduplication Service
 *
 * Computes embeddings for collected content items and removes near-duplicates
 * using cosine similarity with a configurable threshold (default: 0.85).
 * When two items are semantically similar above the threshold, only the one
 * with the larger contentSize (more information) is retained.
 *
 * Gracefully degrades when the embedding service is unavailable — logs a
 * warning and returns the original array unchanged.
 *
 * @module ingestion/deduplication
 */

import { createLogger } from "@server/utils/logger.js";
import type { CollectedContent } from "./collectors/collector.interface.js";

const logger = createLogger("Deduplication");

// ─── Constants ─────────────────────────────────────────────────────────────────

/** Cosine similarity threshold above which items are considered duplicates */
const SIMILARITY_THRESHOLD = 0.85;

// ─── Types ─────────────────────────────────────────────────────────────────────

/** Embedding function signature for dependency injection / testing */
export interface EmbeddingProvider {
  embedDocuments(texts: string[]): Promise<number[][]>;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Compute cosine similarity between two vectors.
 * Returns a value in the range [-1, 1]; 1 means identical direction.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) {
    return 0;
  }

  return dotProduct / denominator;
}

/**
 * Build a text representation of a collected content item suitable for embedding.
 */
function buildContentText(item: CollectedContent): string {
  const parts: string[] = [];
  if (item.title) parts.push(item.title);
  if (item.content) parts.push(item.content.slice(0, 2000)); // Limit content length for embedding
  if (item.url) parts.push(item.url);
  return parts.join(" | ");
}

/**
 * Lazily import the embedding provider from the RAG langchain service.
 * Returns null if the service is unavailable or misconfigured.
 */
async function getEmbeddingProvider(): Promise<EmbeddingProvider | null> {
  try {
    const { getEmbeddings } = await import("../rag-langchain.service.js");
    const embeddings = getEmbeddings();
    if (!embeddings) return null;
    return embeddings as EmbeddingProvider;
  } catch {
    return null;
  }
}

// ─── Service ───────────────────────────────────────────────────────────────────

export const deduplicationService = {
  /**
   * Deduplicate collected content items based on semantic similarity.
   *
   * For any two items with cosine similarity ≥ 0.85, retains only the one
   * with larger contentSize. If the embedding service is unavailable, returns
   * the original array unchanged with a logged warning.
   *
   * @param items - Array of CollectedContent items to deduplicate
   * @param embeddingProvider - Optional embedding provider override (for testing)
   * @returns Deduplicated array of CollectedContent items
   */
  async deduplicate(
    items: CollectedContent[],
    embeddingProvider?: EmbeddingProvider | null
  ): Promise<CollectedContent[]> {
    // Short-circuit for trivial inputs
    if (items.length <= 1) {
      return items;
    }

    // Resolve embedding provider
    const provider = embeddingProvider !== undefined
      ? embeddingProvider
      : await getEmbeddingProvider();

    if (!provider) {
      logger.warn(
        "Embedding service unavailable — skipping deduplication",
        { itemCount: items.length }
      );
      return items;
    }

    // Compute embeddings for items that don't already have one
    const embeddings: number[][] = [];
    const textsToEmbed: string[] = [];
    const textIndices: number[] = [];

    for (let i = 0; i < items.length; i++) {
      if (items[i].embedding && items[i].embedding!.length > 0) {
        embeddings[i] = items[i].embedding!;
      } else {
        textsToEmbed.push(buildContentText(items[i]));
        textIndices.push(i);
      }
    }

    // Batch-compute missing embeddings
    if (textsToEmbed.length > 0) {
      try {
        const computedVectors = await provider.embedDocuments(textsToEmbed);
        for (let j = 0; j < textIndices.length; j++) {
          embeddings[textIndices[j]] = computedVectors[j];
        }
      } catch (error) {
        logger.warn(
          "Failed to compute embeddings — skipping deduplication",
          { error: error instanceof Error ? error.message : String(error), itemCount: items.length }
        );
        return items;
      }
    }

    // Pairwise comparison: mark items to discard
    const discarded = new Set<number>();

    for (let i = 0; i < items.length; i++) {
      if (discarded.has(i)) continue;

      for (let j = i + 1; j < items.length; j++) {
        if (discarded.has(j)) continue;

        const similarity = cosineSimilarity(embeddings[i], embeddings[j]);

        if (similarity >= SIMILARITY_THRESHOLD) {
          // Keep the item with greater contentSize (more information)
          if (items[i].contentSize >= items[j].contentSize) {
            discarded.add(j);
          } else {
            discarded.add(i);
            break; // Item i is discarded, no need to compare it further
          }
        }
      }
    }

    const deduplicated = items.filter((_, index) => !discarded.has(index));

    logger.info("Deduplication complete", {
      inputCount: items.length,
      outputCount: deduplicated.length,
      removedCount: items.length - deduplicated.length,
    });

    return deduplicated;
  },
};
