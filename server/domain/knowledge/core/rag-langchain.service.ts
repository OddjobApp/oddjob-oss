import { hasAiOrganizationContext } from "@domain/ai/core/ai-org-context.js";
import { markDegradation } from "@domain/ai/core/ai-degradation.js";
import { organizationEmbeddings } from "@domain/ai/core/org-embeddings.js";
import { developmentProviderKey, resolveOrgTextAiKey } from "@domain/ai/core/org-gemini-key.js";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import {
  ensureQdrantCollection,
  upsertQdrantPoints,
  searchQdrant,
  deleteQdrantByFilter,
  QDRANT_COLLECTION
} from "../../../integrations/qdrant-client.js";
import { AIClientFactory } from "../../ai/core/ai-client.service.js";
import { getRerankingService } from "@domain/ai/core/reranking/reranking.service.js";
import type { CandidateDocument } from "@domain/ai/core/reranking/types.js";

import { db } from "@server/database_service.js";
import { credentials } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { getAssetPlainText, buildRagContextString, type RagContentSource } from "./rag-utils.service.js";
import { withEmbeddingRetry } from "@server/utils/embedding-retry.js";
import { createLogger } from "@server/utils/logger.js";
import { retrievePlatformDocumentation } from "./platform-documentation-retrieval.js";
import crypto from "crypto";
import { redisService } from "@domain/core/infrastructure/redis/redis-client.js";

const logger = createLogger("LangChainRAG");


const EMBEDDING_MODEL = process.env.RAG_EMBEDDING_MODEL || "models/gemini-embedding-001";
if (!developmentProviderKey() && process.env.NODE_ENV !== "production") {
  logger.warn(
    "[LangChain] GEMINI_API_KEY is not set. RAG embeddings will fail until it is configured."
  );
}

const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: Number(process.env.RAG_CHUNK_SIZE || 800),
  chunkOverlap: Number(process.env.RAG_CHUNK_OVERLAP || 150),
});

/**
 * Resolves the sharded collection name based on organization context.
 *
 * Only deletion still falls through to QDRANT_COLLECTION, so legacy points there
 * can be cleaned up. Reads and writes go through requireVectorOrgId first.
 */
function getShardedCollection(organizationId?: number | null): string {
  if (organizationId) {
    return `oddjob_org_${organizationId}`;
  }
  return QDRANT_COLLECTION;
}

/**
 * The organization a vector read or write belongs to, or a throw.
 *
 * A missing organization used to mean "the default collection". That collection
 * (oddjob_rag_assets) is not neutral: it holds chunks tagged with real
 * organizations from before per-org sharding, alongside ~40k with no owner at all,
 * and a null-org read searched it with no organization filter. So a caller that
 * lost its context read other tenants' documents, and a writer that lost its
 * context added to the pile. Neither may happen; fail instead.
 */
export function requireVectorOrgId(organizationId: number | null | undefined, operation: string): number {
  const orgId = Number(organizationId);
  if (!Number.isInteger(orgId) || orgId <= 0) {
    throw new Error(`Organization context required for vector ${operation}: it will not fall back to the shared default collection.`);
  }
  return orgId;
}

const OLLAMA_BASE_URL   = (process.env.OLLAMA_BASE_URL || "http://localhost:11434").replace(/\/$/, "");
/**
 * The local model used when the cloud embedding quota is exhausted.
 *
 * An embedding model, not a chat one. This defaulted to llama3.2, which Ollama
 * refuses with "This server does not support embeddings" -- so the Ollama arm of
 * the fallback never worked and every degraded embed fell through to the
 * deterministic lexical vector below. nomic-embed-text answers normally and is
 * already what OLLAMA_EMBEDDING_MODEL would be set to.
 */
const OLLAMA_EMBED_MODEL = process.env.OLLAMA_EMBEDDING_MODEL || "nomic-embed-text:latest";

function deterministicFallbackEmbedding(text: string, targetDim: number): number[] {
  const vector = new Array(targetDim).fill(0);
  const tokens = text.toLowerCase().match(/[a-z0-9_'-]+/g) || [];
  for (const token of tokens) {
    let hash = 2166136261;
    for (let i = 0; i < token.length; i++) {
      hash ^= token.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    const index = Math.abs(hash) % targetDim;
    vector[index] += 1;
  }

  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return magnitude > 0 ? vector.map(value => value / magnitude) : vector;
}

/** Call Ollama /api/embeddings and pad/truncate the vector to targetDim. */
async function ollamaEmbed(text: string, targetDim: number): Promise<number[]> {
  const resp = await fetch(`${OLLAMA_BASE_URL}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: OLLAMA_EMBED_MODEL, prompt: text }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok) throw new Error(`Ollama /api/embeddings ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  const vec: number[] = data.embedding || [];
  if (vec.length === 0) throw new Error("Ollama returned empty embedding");
  return vec.length >= targetDim ? vec.slice(0, targetDim) : [...vec, ...new Array(targetDim - vec.length).fill(0)];
}

/**
 * An embedding call that "succeeded" with nothing in it.
 *
 * Under a Gemini spending cap the API answers 429, but the LangChain wrapper
 * does not surface that as a rejection — it resolves with a zero-length vector.
 * Every guard downstream then passed it along: the quota branch below never ran
 * (no error to inspect), Qdrant rejected the upsert with "expected dim: 768,
 * got 0", and that rejection was swallowed by a non-blocking catch. The document
 * row still carried a qdrant_point_id, so nothing anywhere recorded that the
 * document had not been indexed — it was simply unfindable, permanently.
 *
 * Treating an empty vector as a failure is what lets the Ollama/deterministic
 * fallback below actually engage, which is what it was built for.
 */
class EmptyEmbeddingError extends Error {
  constructor(label: string) {
    super(`${label} returned an empty embedding (provider reported success) — treating as a quota failure`);
    this.name = "EmptyEmbeddingError";
  }
}

/** A vector Qdrant will accept: a non-empty array of finite numbers. */
function isUsableVector(v: unknown): v is number[] {
  return Array.isArray(v) && v.length > 0 && v.every((n) => typeof n === "number" && isFinite(n));
}

function isQuotaError(msg: string): boolean {
  const m = msg.toLowerCase();
  return m.includes("429") || m.includes("resource_exhausted") || m.includes("resource exhausted") ||
         m.includes("spending cap") || m.includes("monthly budget") || m.includes("project spend");
}

/** Fallback embedding: try Ollama, then L2-normalized deterministic vector (degraded RAG — no crash). */
async function fallbackEmbed(text: string, targetDim: number, label: string): Promise<number[]> {
  try {
    logger.warn(`[LangChain] ${label} quota exhausted. Attempting Ollama fallback (${OLLAMA_EMBED_MODEL})...`);
    const rawVec = await ollamaEmbed(text, targetDim);
    // L2 Normalize to ensure consistent vector magnitude in Qdrant
    const mag = Math.sqrt(rawVec.reduce((sum, v) => sum + v * v, 0));
    const vec = mag > 0 ? rawVec.map(v => v / mag) : rawVec;
    logger.info(`[LangChain] ${label} Ollama fallback succeeded (${vec.length}-dim, L2-normalized).`);
    // An Ollama vector is in a different space than the stored Gemini vectors,
    // so nearest-neighbour results over the mix are degraded even though the
    // call "worked".
    markDegradation("embeddings", `${label}: provider quota exhausted — serving Ollama (${OLLAMA_EMBED_MODEL}) fallback vectors`);
    return vec;
  } catch (ollamaErr: any) {
    // Last resort, and worth being loud about: a lexical hash is not in the same
    // space as the model's embeddings, so nearest-neighbour search over a mix of
    // the two returns neighbours that mean nothing. It keeps RAG from crashing;
    // it does not keep RAG working.
    logger.error(
      `[LangChain] ${label} Ollama fallback failed: ${ollamaErr.message}. ` +
        `Falling back to a deterministic lexical vector — results from this embed are NOT semantically ` +
        `comparable to stored vectors, and any search using it should be treated as unreliable.`,
    );
    markDegradation("embeddings", `${label}: Ollama fallback failed (${ollamaErr.message}) — serving deterministic lexical vectors not comparable to stored embeddings`);
    return deterministicFallbackEmbedding(text, targetDim);
  }
}

// ── Two-Tier Query Embedding Cache (In-Memory LRU + Redis) ────────────
interface EmbedCacheEntry {
  vector: number[];
  expiresAt: number;
}
const MEMORY_EMBED_CACHE = new Map<string, EmbedCacheEntry>();
const MAX_MEMORY_CACHE_ENTRIES = 2000;
const MEMORY_TTL_MS = 60 * 60 * 1000; // 1 hour
const REDIS_TTL_SEC = 24 * 60 * 60;   // 24 hours

function getEmbeddingCacheKey(text: string): string {
  const normalized = text.trim().toLowerCase();
  const hash = crypto.createHash("sha256").update(`${EMBEDDING_MODEL}:${normalized}`).digest("hex");
  return `rag:query_embed:${hash}`;
}

function setMemoryCache(key: string, vector: number[]): void {
  if (MEMORY_EMBED_CACHE.size >= MAX_MEMORY_CACHE_ENTRIES) {
    const oldestKey = MEMORY_EMBED_CACHE.keys().next().value;
    if (oldestKey) MEMORY_EMBED_CACHE.delete(oldestKey);
  }
  MEMORY_EMBED_CACHE.set(key, { vector, expiresAt: Date.now() + MEMORY_TTL_MS });
}

export async function getCachedQueryEmbedding(text: string): Promise<number[] | null> {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return null;

  const key = getEmbeddingCacheKey(normalized);

  // 1. Tier 1: In-Memory LRU
  const memEntry = MEMORY_EMBED_CACHE.get(key);
  if (memEntry) {
    if (Date.now() < memEntry.expiresAt) {
      // Refresh order for LRU behavior: re-insert
      MEMORY_EMBED_CACHE.delete(key);
      MEMORY_EMBED_CACHE.set(key, memEntry);
      return memEntry.vector;
    } else {
      MEMORY_EMBED_CACHE.delete(key);
    }
  }

  // 2. Tier 2: Redis
  try {
    const client = redisService.client;
    if (client) {
      const cached = await client.get(key);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setMemoryCache(key, parsed);
          return parsed;
        }
      }
    }
  } catch (err: any) {
    logger.debug(`[LangChain] Redis embedding cache read error: ${err?.message}`);
  }

  return null;
}

export async function setCachedQueryEmbedding(text: string, vector: number[]): Promise<void> {
  const normalized = text.trim().toLowerCase();
  if (!normalized || !vector || vector.length === 0) return;

  const key = getEmbeddingCacheKey(normalized);

  // 1. Set In-Memory
  setMemoryCache(key, vector);

  // 2. Set Redis (asynchronous, non-blocking)
  try {
    const client = redisService.client;
    if (client) {
      await client.setex(key, REDIS_TTL_SEC, JSON.stringify(vector)).catch(() => {});
    }
  } catch (err: any) {
    logger.debug(`[LangChain] Redis embedding cache write error: ${err?.message}`);
  }
}

let embeddingsInstance: any | null = null;
export function getEmbeddings() {
  if (hasAiOrganizationContext() || process.env.NODE_ENV === "production") return organizationEmbeddings();
  if (process.env.SKIP_GEMINI_EMBEDDINGS === "true") {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SKIP_GEMINI_EMBEDDINGS must not be set in production — it produces zero vectors that corrupt Qdrant retrieval.");
    }
    logger.warn("[LangChain] SKIP_GEMINI_EMBEDDINGS is true (non-production). Returning dummy embeddings instance.");
    const qdrantVectorSize = Number(process.env.QDRANT_VECTOR_SIZE || 3072);
    return {
      embedQuery: async (_text: string) => new Array(qdrantVectorSize).fill(0),
      embedDocuments: async (texts: string[]) => texts.map(() => new Array(qdrantVectorSize).fill(0))
    };
  }

  if (!embeddingsInstance) {
    logger.debug(`[LangChain] Initializing GoogleGenerativeAIEmbeddings with model: ${EMBEDDING_MODEL}`);
    // Development without an organization only: production and any request
    // carrying an organization returned organizationEmbeddings() above.
    const platformKey = developmentProviderKey();
    if (!platformKey) {
      throw new Error("GEMINI_API_KEY is required for embeddings");
    }

    try {
      const baseEmbeddings = new GoogleGenerativeAIEmbeddings({
        apiKey: platformKey,
        modelName: EMBEDDING_MODEL,
        model: EMBEDDING_MODEL,
        // Retry policy belongs to withEmbeddingRetry, which knows that a
        // spending-cap 429 is PERMANENT and aborts immediately. LangChain's own
        // loop does not: it retried a cap error with exponential backoff for
        // over a minute before our handler ever saw the message, turning an
        // instant, unambiguous failure into an indefinite hang.
        maxRetries: 0,
      });

      const qdrantVectorSize = Number(process.env.QDRANT_VECTOR_SIZE || 3072);

      embeddingsInstance = {
        ...baseEmbeddings,
        embedQuery: async (text: string) => {
          // Check cache before computing embedding
          const cached = await getCachedQueryEmbedding(text);
          if (cached) {
            return cached.length > qdrantVectorSize ? cached.slice(0, qdrantVectorSize) : cached;
          }

          try {
            // @ts-ignore
            const vector = await withEmbeddingRetry(() => baseEmbeddings.embedQuery(text), "embedQuery", "LangChain");
            if (!isUsableVector(vector)) throw new EmptyEmbeddingError("embedQuery");
            const result = vector.length > qdrantVectorSize ? vector.slice(0, qdrantVectorSize) : vector;
            // Write to cache (both memory and Redis)
            await setCachedQueryEmbedding(text, result);
            return result;
          } catch (err: any) {
            if (isQuotaError(err.message || "") || err instanceof EmptyEmbeddingError) {
              // Reset singleton so the next non-quota call re-initialises fresh.
              embeddingsInstance = null;
              return fallbackEmbed(text, qdrantVectorSize, "embedQuery");
            }
            throw err;
          }
        },
        embedDocuments: async (texts: string[]) => {
          try {
            const vectors = await withEmbeddingRetry(() => baseEmbeddings.embedDocuments(texts), "embedDocuments", "LangChain");
            if (!Array.isArray(vectors) || vectors.length !== texts.length || !vectors.every(isUsableVector)) {
              throw new EmptyEmbeddingError("embedDocuments");
            }
            return vectors.map((v: number[]) => v.length > qdrantVectorSize ? v.slice(0, qdrantVectorSize) : v);
          } catch (err: any) {
            if (isQuotaError(err.message || "") || err instanceof EmptyEmbeddingError) {
              embeddingsInstance = null;
              return Promise.all(texts.map(t => fallbackEmbed(t, qdrantVectorSize, "embedDocuments")));
            }
            throw err;
          }
        }
      };
    } catch (err: any) {
      logger.error(`[LangChain] Failed to initialize embeddings:`, err.message);
      throw new Error(`Embedding system initialization failed: ${err.message}`);
    }
  }
  return embeddingsInstance;
}

export interface RagChunkMetadata {
  id?: number;           // Knowledge document ID for linking
  assetId?: number;
  assetKey?: string;
  name: string;
  assetType: string;
  sourceType: string;
  order: number;
  chunkId: string;
  // Job output metadata
  isJobOutput?: boolean;
  jobId?: number;
  jobName?: string;
  pipelineStepExecutionId?: number;
  tags?: string[];
  topicId?: number;
  topicIds?: number[];
  topicName?: string;
  url?: string;
  capturedAt?: string;
  verificationStatus?: string;
  organizationId?: number | null;
  // Universal Indexing
  datasetId?: number | null;
  nodeId?: number | null;
  // Enrichment fields
  entities?: string[];
  summary?: string;
  keywords?: string[];
  temporalDate?: string;
  linkedNodeIds?: number[];
  missionId?: number;
}

interface RagDocument {
  pageContent: string;
  metadata: RagChunkMetadata;
}

import { createHash } from "crypto";
import { resolveCredentialSecret } from "@domain/auth/core/credential-secret-store.js";

function generateDeterministicUUID(input: string): string {
  const hash = createHash('md5').update(input).digest('hex');
  // Format as UUID: 8-4-4-4-12
  return `${hash.substring(0, 8)}-${hash.substring(8, 12)}-${hash.substring(12, 16)}-${hash.substring(16, 20)}-${hash.substring(20, 32)}`;
}

export async function assetToDocuments(
  asset: RagContentSource,
  knowledgeDocument?: {
    organizationId?: number | null;
    metadata?: Record<string, unknown> | null;
  }
): Promise<RagDocument[]> {
  const text = await getAssetPlainText(asset);

  if (!text?.trim()) {
    return [];
  }

  const chunks = await splitter.splitText(text);
  const assetKey = asset.qdrantPointId || `asset-${asset.id}`;

  // Extract job output metadata from knowledge document if present
  const docMetadata = knowledgeDocument?.metadata as Record<string, unknown> | null | undefined;
  const isJobOutput = docMetadata?.jobId !== undefined;

  // Use metadata verificationStatus or default to "verified"
  const verificationStatus = (docMetadata?.status === "success" || docMetadata?.verificationStatus === "verified")
    ? "verified"
    : (docMetadata?.verificationStatus as string || "verified");

  const capturedAt = (docMetadata?.executedAt as string) ||
    (docMetadata?.executionTime as string) ||
    new Date().toISOString();

  return chunks.map((chunk, index) => {
    // Generate a valid UUID for Qdrant Point ID
    const rawChunkId = `${assetKey}:${index}`;
    const chunkId = generateDeterministicUUID(rawChunkId);

    return {
      pageContent: chunk,
      metadata: {
        assetId: asset.id,
        assetKey,
        name: asset.name,
        assetType: asset.assetType,
        sourceType: asset.sourceType,
        order: asset.order ?? index,
        chunkId, // Must be UUID
        originalChunkId: rawChunkId, // Store original for debugging
        capturedAt,
        verificationStatus,
        organizationId: (knowledgeDocument?.organizationId ?? docMetadata?.organizationId) as number | null | undefined,
        topicIds: docMetadata?.topicIds as number[] | undefined,
        // Include job output metadata if present
        ...(isJobOutput && {
          isJobOutput: true,
          jobId: docMetadata?.jobId as number | undefined,
          pipelineStepExecutionId: docMetadata?.pipelineStepExecutionId as number | undefined,
          tags: docMetadata?.tags as string[] | undefined,
        }),
        url: asset.url as string | undefined,
        // Universal Indexing
        ...(asset.datasetId && { datasetId: asset.datasetId }),
        ...(asset.nodeId && { nodeId: asset.nodeId }),
        // Merge arbitrary metadata if provided in asset
        ...(asset.metadata || {}),
      },
    };
  });
}

/**
 * Enriches a text chunk using Gemini Flash to extract metadata
 */
export async function enrichChunk(content: string, organizationId?: number | null): Promise<Partial<RagChunkMetadata>> {
  // Gate on the organization's key. Gating on the platform GEMINI_API_KEY —
  // never set in production — skipped enrichment for every customer.
  const apiKey = await resolveOrgTextAiKey(organizationId);
  if (!apiKey) return {};

  try {
    const aiClient = AIClientFactory.getClient({ provider: "google", model: "gemini-2.0-flash" } as any);
    const systemPrompt = `You are a Knowledge Context Enricher.
Extract structured metadata from the following text chunk to improve vector search retrieval.

Return ONLY a JSON object with:
- "entities": Array of specific named entities (People, Organizations, Tools, Technologies, Concepts)
- "summary": A one-sentence high-level summary of the content
- "keywords": 5-10 specific technical or conceptual keywords
- "temporalDate": If the text refers to a specific point in time or date, extract it as an ISO string or "unknown"

Text:
"${content}"`;

    const result = await aiClient.execute({
      model: "gemini-2.0-flash",
      userPrompt: systemPrompt,
      temperature: 0.1,
      requestType: "json",
      useCache: true,
      credentialId: undefined, // System call
      enableQueryExpansion: false,
      saveOutputToFile: false,
      organizationId: organizationId ?? undefined,
    }, undefined, apiKey);

    if (result.success && result.output) {
      const data = JSON.parse(result.output);
      const enrichment: Partial<RagChunkMetadata> = {
        entities: data.entities || [],
        summary: data.summary || "",
        keywords: data.keywords || [],
        temporalDate: data.temporalDate !== "unknown" ? data.temporalDate : undefined,
      };

      // Cross-link entities to KG nodes if organizationId is present
      if (organizationId && enrichment.entities?.length) {
        try {
          const { graphService } = await import("./graph/graph-service.js");
          const nodeIds = await graphService.resolveEntitiesToNodeIds(enrichment.entities, {
            organizationId,
            userId: "system" // enrichment is a background process
          } as any);
          if (nodeIds.length > 0) {
            // Store linked node IDs in metadata
            (enrichment as any).linkedNodeIds = nodeIds;
          }
        } catch (e) {
          logger.warn("[RAG Enrichment] KG resolution failed:", e as any);
        }
      }

      return enrichment;
    }
  } catch (error) {
    logger.error("[RAG Enrichment] Failed to enrich chunk:", error);
  }
  return {};
}

export async function addDocumentsToVectorStore(docs: RagDocument[]): Promise<void> {
  if (!docs.length) return;

  // Group by sharded collection
  const shards = new Map<string, RagDocument[]>();
  for (const doc of docs) {
    const collection = getShardedCollection(requireVectorOrgId(doc.metadata.organizationId, "indexing"));
    if (!shards.has(collection)) shards.set(collection, []);
    shards.get(collection)!.push(doc);
  }

  for (const [collection, shardDocs] of shards.entries()) {
    await ensureQdrantCollection(collection);

    // Enrich chunks in parallel with configurable concurrency
    const enrichedDocs = [...shardDocs];
    const CONCURRENCY = parseInt(process.env.ENRICHMENT_CONCURRENCY || "20", 10);
    for (let i = 0; i < shardDocs.length; i += CONCURRENCY) {
      const batch = shardDocs.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(async (doc, idx) => {
        if (doc.metadata.keywords && doc.metadata.keywords.length > 0) return;
        const enrichment = await enrichChunk(doc.pageContent, doc.metadata.organizationId);
        enrichedDocs[i + idx].metadata = { ...doc.metadata, ...enrichment };
      }));
    }

    const embeddings = getEmbeddings();
    const EMBED_BATCH_SIZE = parseInt(process.env.EMBED_BATCH_SIZE || "20", 10);
    const EMBED_BATCH_DELAY_MS = parseInt(process.env.EMBED_BATCH_DELAY_MS || "0", 10);
    const allTexts = enrichedDocs.map((doc) => doc.pageContent);
    const vectors: number[][] = [];

    for (let i = 0; i < allTexts.length; i += EMBED_BATCH_SIZE) {
      const batchVectors = await embeddings.embedDocuments(allTexts.slice(i, i + EMBED_BATCH_SIZE));
      vectors.push(...batchVectors);
      if (EMBED_BATCH_DELAY_MS > 0 && i + EMBED_BATCH_SIZE < allTexts.length) {
        await new Promise(resolve => setTimeout(resolve, EMBED_BATCH_DELAY_MS));
      }
    }

    const points = vectors.map((vector: number[], index: number) => ({
      id: enrichedDocs[index].metadata.chunkId,
      vector,
      payload: {
        ...enrichedDocs[index].metadata,
        pageContent: enrichedDocs[index].pageContent,
        collectionName: collection,
        // Every chunk MUST carry this. search-service filters vector hits with
        // `must: [{ key: "securityClassification", range: { lte: clearance } }]`, and a
        // Qdrant range filter excludes any point LACKING the field — so a chunk indexed
        // without it is not "unclassified", it is invisible. Nothing here ever set it,
        // which silently made the vector arm of unified search return zero for every
        // query in every org: 0 of 7826 points matched in org 342 and 0 of 5064 in org
        // 291, while the same query with no filter returned 5 documents.
        securityClassification:
          (enrichedDocs[index].metadata as unknown as Record<string, unknown>)?.securityClassification ??
          DEFAULT_SECURITY_CLASSIFICATION,
      },
    }));

    await upsertQdrantPoints(points, collection);
    logger.debug(`[RAG] Indexed ${points.length} points to collection: ${collection}`);
  }
}

export async function deleteAssetFromVectorStore(asset: {
  id: number;
  qdrantPointId?: string | null;
  organizationId?: number | null;
}): Promise<void> {
  const collection = getShardedCollection(asset.organizationId);
  const filterKey = asset.qdrantPointId ? "assetKey" : "assetId";
  await deleteQdrantByFilter({
    must: [
      {
        key: filterKey,
        match: { value: asset.qdrantPointId ?? asset.id },
      },
    ],
  }, collection);
}

export interface RetrieverOptions {
  k?: number;
  scoreThreshold?: number;
  recencyBias?: number; // 0.0 to 1.0
  authorityBias?: number; // 0.0 to 1.0
  enableReranking?: boolean;
  credentialId?: number;
  organizationId?: number | null; // Strict context
  missionId?: number; // Mission-specific context
  filter?: Record<string, any>; // Arbitrary Qdrant filters
  // Temporal Filters
  before?: string | Date;
  after?: string | Date;
  since?: string | Date;
}

interface RetrievedDocument {
  pageContent: string;
  metadata: Partial<RagChunkMetadata>;
  score?: number;
  adjustedScore?: number;
  semanticScore?: number;
}

/**
 * Classification stamped on a chunk whose source declares none.
 *
 * 1 is the lowest, most open band and matches ontology-mapper.ts's own fallback,
 * `item.securityClassification || schema.defaultSecurityClassification || 1`. It is
 * named here rather than inlined because the indexer, the backfill and any future
 * writer must agree: a chunk that disagrees does not merely carry the wrong label, it
 * drops out of search entirely.
 */
export const DEFAULT_SECURITY_CLASSIFICATION = 1;

export async function retrieveSimilarDocuments(
  query: string,
  options: RetrieverOptions = {}
): Promise<RetrievedDocument[]> {
  // The library reads docs/ from disk on first use and throws if a published file
  // is missing (an image built without docs/, say). That must cost the shared
  // guides, not every organization's own retrieval.
  let platform: RetrievedDocument[] = [];
  try {
    platform = retrievePlatformDocumentation(query, options);
  } catch (error) {
    logger.error("[RAG] Platform documentation unavailable; retrieving organization documents only", { error });
  }
  let organization: RetrievedDocument[];
  try {
    organization = await retrieveOrganizationDocuments(query, options);
  } catch (error) {
    if (!platform.length) throw error;
    logger.warn("[RAG] Organization retrieval failed; returning published platform documentation only", { error });
    return platform;
  }
  return [...organization, ...platform]
    .sort((a, b) => (b.adjustedScore ?? b.score ?? 0) - (a.adjustedScore ?? a.score ?? 0))
    .slice(0, options.k ?? Number(process.env.RAG_RETRIEVAL_K || 5));
}

async function retrieveOrganizationDocuments(
  query: string,
  options: RetrieverOptions = {}
): Promise<RetrievedDocument[]> {
  const {
    k = Number(process.env.RAG_RETRIEVAL_K || 5),
    scoreThreshold,
    recencyBias = 0,
    authorityBias = 0,
  } = options;

  const organizationId = requireVectorOrgId(options.organizationId, "retrieval");

  if (!query || typeof query !== 'string' || !query.trim()) {
    return [];
  }

  const collection = getShardedCollection(organizationId);
  const embeddings = getEmbeddings();
  let vector: number[];
  try {
    vector = await embeddings.embedQuery(query);
  } catch (err: any) {
    logger.error("[RAG] Embedding generation failed in retrieveSimilarDocuments:", err);
    throw new Error(`Embedding failed: ${err.message || 'Unknown error'}`);
  }

  const fetchLimit = (recencyBias > 0 || authorityBias > 0) ? Math.max(k * 2, 50) : k;

  // Kept although the collection is already per-org: a chunk filed in the wrong
  // shard must still not be returned to this organization.
  const orgFilter = {
    key: "organizationId",
    match: { value: organizationId }
  };

  // Construct Mission Filter
  const missionFilter = (options.missionId !== undefined)
    ? {
      key: "missionId",
      match: { value: options.missionId }
    }
    : null;

  // Construct Temporal Filters
  const temporalFilters = [];
  if (options.before) {
    temporalFilters.push({
      key: "capturedAt",
      range: { lt: new Date(options.before).toISOString() }
    });
  }
  if (options.after || options.since) {
    const sinceDate = options.after || options.since;
    temporalFilters.push({
      key: "capturedAt",
      range: { gt: new Date(sinceDate!).toISOString() }
    });
  }

  // Merge filters
  const mustFilters = [...(options.filter?.must || []), ...temporalFilters];
  if (orgFilter) mustFilters.push(orgFilter);
  if (missionFilter) mustFilters.push(missionFilter);

  const finalFilter = {
    ...options.filter,
    ...(mustFilters.length > 0 ? { must: mustFilters } : {})
  };

  const results = await searchQdrant(vector, {
    limit: fetchLimit,
    scoreThreshold,
    filter: finalFilter,
    collection
  });

  const now = new Date();
  const retrieved: RetrievedDocument[] = results
    .map((hit) => {
      const payload = hit.payload || {};
      const pageContent = typeof payload.pageContent === "string" ? payload.pageContent : "";
      if (!pageContent.trim()) {
        return null;
      }

      const metadata: Partial<RagChunkMetadata> = {
        assetId: payload.assetId as number | undefined,
        assetKey: payload.assetKey as string | undefined,
        name: (payload.name as string) || "Unknown",
        assetType: (payload.assetType as string) || "Unknown",
        sourceType: (payload.sourceType as string) || "Unknown",
        order: typeof payload.order === "number" ? (payload.order as number) : 0,
        chunkId: (payload.chunkId as string) || "Unknown",
        capturedAt: payload.capturedAt as string | undefined,
        verificationStatus: payload.verificationStatus as string | undefined,
        url: payload.url as string | undefined,
      };

      let adjustedScore = hit.score;

      // 1. Recency Decay
      if (recencyBias > 0 && metadata.capturedAt) {
        try {
          const docDate = new Date(metadata.capturedAt);
          const ageDays = (now.getTime() - docDate.getTime()) / (1000 * 60 * 60 * 24);
          if (!isNaN(ageDays)) {
            const decay = Math.pow(2, -(ageDays / 180));
            const multiplier = 1 + (decay - 1) * recencyBias;
            adjustedScore *= multiplier;
          }
        } catch (e) {
          logger.warn("[RAG] Failed to calculate recency decay:", e as any);
        }
      }

      // 2. Authority Multiplier
      if (authorityBias > 0 && metadata.verificationStatus === "verified") {
        const boost = 1 + (1.0 * authorityBias);
        adjustedScore *= boost;
      }

      return {
        pageContent,
        metadata,
        score: hit.score,
        adjustedScore,
      } as RetrievedDocument;
    })
    .filter((doc): doc is RetrievedDocument => doc !== null);

  // --- PHASE 2: Semantic Re-Ranking via Reranking Service ---
  if (options.enableReranking && retrieved.length > 0) {
    try {
      const rerankingService = getRerankingService();
      const candidateDocs: CandidateDocument[] = retrieved.map((doc) => ({
        id: doc.metadata?.chunkId || doc.metadata?.assetKey || `doc-${Math.random()}`,
        content: doc.pageContent,
        metadata: doc.metadata,
        originalScore: doc.adjustedScore,
      }));
      
      const response = await rerankingService.rerank({
        query,
        documents: candidateDocs,
        topK: k,
        options: {
          organizationId: options.organizationId ?? undefined,
          credentialId: options.credentialId ?? undefined,
        },
      });
      
      // Map reranked results back to RetrievedDocument format
      return response.results.map((result) => ({
        pageContent: result.content,
        metadata: result.metadata as any,
        score: result.originalScore ?? 0,
        adjustedScore: result.relevanceScore,
      }));
    } catch (error) {
      logger.warn("[RAG] Reranking service unavailable, skipping reranking", { error });
      // Fall through to return without reranking
    }
  }

  return retrieved.slice(0, k);
}

export interface RerankOptions {
  semanticWeight?: number;
  baseWeight?: number;
  negativePrompt?: string;
}

export async function semanticRerank(
  docs: RetrievedDocument[],
  query: string,
  credentialId: number,
  options: RerankOptions = {}
): Promise<RetrievedDocument[]> {
  if (docs.length === 0) return [];

  // Default weights: 70% semantic, 30% base
  const wSemantic = options.semanticWeight ?? 0.7;
  const wBase = options.baseWeight ?? 0.3;

  try {
    const [credential] = await db.select().from(credentials).where(eq(credentials.id, credentialId)).limit(1);
    if (!credential) return docs;

    const apiKey = (await resolveCredentialSecret(credential));
    if (!apiKey) return docs;

    const metadata = credential.metadata as any;
    const client = AIClientFactory.getClient(metadata);

    // Determine model based on provider
    let model = "gpt-4o-mini";
    if (metadata.provider === "google") {
      model = "gemini-2.0-flash-lite-preview-02-05";
    }

    const docsText = docs.map((doc, i) => `[D${i}] ${doc.pageContent}`).join("\n\n");

    const negativeInstruction = options.negativePrompt
      ? `5. DEMOTE documents that match this negative context: "${options.negativePrompt}". Give them a score < 0.2.`
      : "";

    const prompt = `Role: Precision Retrieval Analyst.
Task: Re-rank the following document chunks based on their exact relevance to the query.

Query: "${query}"

Documents:
${docsText}

Instructions:
1. Re-rank the documents by calculating a relevance score from 0.0 to 1.0.
2. Return ONLY a JSON object with a "rankings" array containing "index" and "score".
3. Highly relevant documents should be > 0.8. Tangential documents < 0.3.
4. Format: {"rankings": [{"index": 0, "score": 0.95}, {"index": 2, "score": 0.88}]}
${negativeInstruction}
`;

    const result = await client.execute({
      credentialId,
      model,
      userPrompt: prompt,
      temperature: 0,
      requestType: "json",
      useCache: true,
      enableQueryExpansion: false,
      saveOutputToFile: false,
    }, undefined, apiKey);

    if (result.success && result.output) {
      const data = JSON.parse(result.output);
      const rankings = data.rankings as { index: number; score: number }[];

      const reranked = docs.map((doc, i) => {
        const ranking = rankings.find(r => r.index === i);
        const semanticScore = ranking ? ranking.score : 0;

        // Configurable Scoring Weights
        const finalScore = (doc.adjustedScore || 0) * wBase + semanticScore * wSemantic;

        return {
          ...doc,
          semanticScore,
          adjustedScore: finalScore
        };
      });

      logger.debug(`[RAG Reranker] Reranked ${reranked.length} documents for query: "${query.substring(0, 50)}..."`);
      return reranked.sort((a, b) => (b.adjustedScore || 0) - (a.adjustedScore || 0));
    } else {
      logger.error(`[RAG Reranker] AI Call failed. Success: ${result.success}, Error: ${result.error}`);
    }
  } catch (e) {
    logger.error("[RAG Reranker] Failed to rerank:", e);
  }

  return docs;
}

export function mergeRagContexts(baseContext: string, docs: RetrievedDocument[]): string {
  if (!docs.length) {
    return baseContext;
  }

  const formatted = docs
    .map((doc, idx) => {
      const meta = doc.metadata ?? {};
      const label = meta.name ? `"${meta.name}"` : `Document ${idx + 1}`;
      return `CONTENT FROM ${label} (Asset ID: ${meta.assetId ?? "unknown"})\n${doc.pageContent}`;
    })
    .join("\n\n");

  if (!baseContext.trim()) {
    return formatted;
  }

  return `${baseContext}\n\n---\n\nADDITIONAL CONTEXT FROM LANGCHAIN RETRIEVER:\n${formatted}`;
}

/**
 * Transforms a user query into optimal search terms using LLM
 */
async function refineQuery(originalQuery: string, credentialId: number): Promise<string> {
  try {
    const [credential] = await db.select().from(credentials).where(eq(credentials.id, credentialId)).limit(1);
    if (!credential) return originalQuery;

    const apiKey = (await resolveCredentialSecret(credential));
    if (!apiKey) return originalQuery;

    const metadata = credential.metadata as any;
    const client = AIClientFactory.getClient(metadata);

    const prompt = `
Role: Search Expert.
Task: Expand and refine the user's query to maximize retrieval from a technical documentation vector database.
User Query: "${originalQuery}"

Instructions:
- Suggest synonyms, technical terms, and error codes related to the intent.
- Remove conversational filler ("How do I...", "Please help me...").
- Return ONLY the list of keywords and phrases separated by spaces.
`;

    const result = await client.execute({
      credentialId,
      model: "gpt-4o-mini", 
      userPrompt: prompt,
      temperature: 0.3,
      useCache: true,
      enableQueryExpansion: false, // Prevent recursion
      saveOutputToFile: false,
    }, undefined, apiKey);

    if (result.success && result.output) {
      logger.debug(`[RAG Refiner] Original: "${originalQuery}" -> Refined: "${result.output}"`);
      return result.output;
    }
  } catch (e) {
    logger.error("[RAG Refiner] Failed to refine query:", e);
  }
  return originalQuery;
}

export type HybridContextOptions = {
  enableQueryExpansion?: boolean;
  credentialId?: number;
  organizationId?: number | null;
  retrievalSettings?: {
    enabled?: boolean;
    k?: number;
    recencyBias?: number;
    authorityBias?: number;
    enableReranking?: boolean;
  };
};

export interface HybridContextResult {
  context: string;
  retrievedDocs: RetrievedDocument[];
  refinedQuery?: string;
}

export async function buildHybridContextFromAssets(
  assets: RagContentSource[],
  prompt: string,
  options: HybridContextOptions = {}
): Promise<HybridContextResult> {
  const ragContextResult = await buildRagContextString(assets);
  logger.debug(`[RAG] Built base RAG context (${ragContextResult.length} chars)`);

  let hybridContext = ragContextResult.context;
  let allRetrievedDocs: RetrievedDocument[] = [];
  let refinedQuery: string | undefined = undefined;

  try {
    let searchQuery = prompt;

    // Apply Query Expansion if enabled
    if (options.enableQueryExpansion && options.credentialId) {
      logger.debug(`[RAG] Query Expansion Enabled. Refining query...`);
      searchQuery = await refineQuery(prompt, options.credentialId);
      refinedQuery = searchQuery;
    }

    const retrievedDocs = await retrieveSimilarDocuments(searchQuery, {
      k: options.retrievalSettings?.k,
      recencyBias: options.retrievalSettings?.recencyBias,
      authorityBias: options.retrievalSettings?.authorityBias,
      enableReranking: options.retrievalSettings?.enableReranking,
      credentialId: options.credentialId, // Pass through for reranking
      organizationId: options.organizationId, // Support for org context
    });

    allRetrievedDocs = retrievedDocs;
    hybridContext = mergeRagContexts(hybridContext, retrievedDocs);
    logger.debug(`[RAG] Appended ${retrievedDocs.length} documents from Qdrant retriever (Boosts Applied: ${!!options.retrievalSettings?.enabled}, Reranking: ${!!options.retrievalSettings?.enableReranking})`);
  } catch (error) {
    logger.error("[RAG] Retriever failed:", error);
  }

  return {
    context: hybridContext,
    retrievedDocs: allRetrievedDocs,
    refinedQuery
  };
}
