import { QdrantClient } from "@qdrant/js-client-rest";
import { createHash } from "crypto";

export const QDRANT_URL = process.env.QDRANT_URL || "http://localhost:6333";
export const QDRANT_API_KEY = process.env.QDRANT_API_KEY || "";
export const QDRANT_COLLECTION = process.env.QDRANT_COLLECTION || "oddjob_rag_assets";

const DEFAULT_VECTOR_SIZE = parseInt(process.env.QDRANT_VECTOR_SIZE || "768", 10);
const DEFAULT_DISTANCE = (process.env.QDRANT_DISTANCE || "Cosine") as
  | "Cosine"
  | "Dot"
  | "Euclid";

const MAX_RETRIES = parseInt(process.env.QDRANT_MAX_RETRIES || "3", 10);
const RETRY_DELAY_MS = parseInt(process.env.QDRANT_RETRY_DELAY_MS || "1000", 10);

let clientInstance: QdrantClient | null = null;

export function getClient(): QdrantClient {
  if (!clientInstance) {
    clientInstance = new QdrantClient({
      url: QDRANT_URL,
      apiKey: QDRANT_API_KEY || undefined,
      checkCompatibility: false,
      timeout: 30000,
    });
  }
  return clientInstance;
}

import { retry } from "@oddjob/shared-utils";

/**
 * Retry helper with exponential backoff
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = MAX_RETRIES,
  delayMs: number = RETRY_DELAY_MS
): Promise<T> {
  return retry(fn, {
    maxRetries,
    initialDelayMs: delayMs,
    isRetryable: (error: any) => {
      console.error(`[Qdrant] Execution failed:`, {
        message: error.message,
        status: error.status,
        data: error.response?.data || error.data
      });

      // Don't retry on 4xx errors (client errors)
      if (error?.status >= 400 && error?.status < 500) {
        return false;
      }
      return true;
    }
  });
}

const PAYLOAD_INDEXES: Array<{ field_name: string; field_schema: "integer" | "keyword" | "float" | "geo" | "text" | "bool" | "datetime" | "uuid" }> = [
  { field_name: "organizationId", field_schema: "integer" },
  { field_name: "jobId", field_schema: "integer" },
  { field_name: "nodeId", field_schema: "integer" },
  { field_name: "topicId", field_schema: "integer" },
  { field_name: "assetType", field_schema: "keyword" },
  { field_name: "verification_status", field_schema: "keyword" },
  { field_name: "verificationStatus", field_schema: "keyword" },
];

const initializedCollections = new Set<string>();

/**
 * Ensures a collection exists and is indexed.
 * Supports dynamic collection names for sharding.
 */
export async function ensureQdrantCollection(collection: string = QDRANT_COLLECTION, vectorSize = DEFAULT_VECTOR_SIZE): Promise<void> {
  if (initializedCollections.has(collection)) return;

  const client = getClient();
  return retryWithBackoff(async () => {
    try {
      await client.getCollection(collection);
    } catch (error: any) {
      if (error?.status !== 404) {
        throw error;
      }

      await client.createCollection(collection, {
        vectors: {
          size: vectorSize,
          distance: DEFAULT_DISTANCE,
        },
      });
      console.log(`[Qdrant] Created new sharded collection: ${collection}`);
    }

    // Ensure payload indexes exist (idempotent)
    await Promise.all(
      PAYLOAD_INDEXES.map((idx) =>
        client.createPayloadIndex(collection, {
          field_name: idx.field_name,
          field_schema: idx.field_schema,
        }).catch(() => {
          // Ignore errors for existing indexes
        })
      )
    );

    initializedCollections.add(collection);
  });
}

export interface VectorPoint {
  id: string | number;
  vector: number[];
  payload?: Record<string, unknown>;
}

export async function upsertQdrantPoints(points: VectorPoint[], collection: string = QDRANT_COLLECTION, vectorSize?: number): Promise<void> {
  if (!points.length) return;

  // Refuse empty vectors rather than shipping them. Qdrant answers an empty
  // vector with "expected dim: N, got 0", which reads as a Qdrant problem and
  // tells you nothing about which document lost its embedding — and callers
  // that index in the background swallow it, leaving a document that believes
  // it is indexed and can never be retrieved. Fail here, naming the point.
  const empty = points.filter((p) => !Array.isArray(p.vector) || p.vector.length === 0);
  if (empty.length > 0) {
    throw new Error(
      `Refusing to index ${empty.length}/${points.length} point(s) into '${collection}' with an empty vector ` +
      `(ids: ${empty.slice(0, 5).map((p) => String(p.id)).join(", ")}${empty.length > 5 ? ", …" : ""}). ` +
      `The embedding provider returned nothing — check embedding quota before retrying.`,
    );
  }

  await ensureQdrantCollection(collection, vectorSize ?? points[0].vector.length);
  const client = getClient();

  return retryWithBackoff(async () => {
    const payload = {
      points: points.map((p) => {
        let finalId = p.id;
        if (typeof finalId === "string" && finalId.includes("-") && finalId.length !== 36) {
          const crypto = createHash("md5").update(finalId).digest("hex");
          finalId = `${crypto.substring(0, 8)}-${crypto.substring(8, 12)}-${crypto.substring(12, 16)}-${crypto.substring(16, 20)}-${crypto.substring(20, 32)}`;
        }

        return {
          id: finalId,
          vector: Array.isArray(p.vector) ? p.vector.filter(v => typeof v === 'number' && isFinite(v)) : [],
          payload: p.payload ?? {},
        };
      })
    };

    try {
      await (client as any).api("collections").upsertPoints(collection, {
        wait: true,
        ...payload
      });
    } catch (e) {
      await client.upsert(collection, {
        wait: true,
        points: payload.points
      });
    }
  });
}

export async function deleteQdrantPoints(pointIds: Array<string | number>, collection: string = QDRANT_COLLECTION): Promise<void> {
  if (!pointIds.length) return;
  const client = getClient();
  await ensureQdrantCollection(collection);

  await client.delete(collection, { points: pointIds });
}

/**
 * Fetch points by id, returning only those that exist.
 *
 * Existence is a different question from similarity, and `searchQdrant` cannot
 * answer it: a vector search always returns its nearest neighbours, so asking
 * "is capability X registered?" that way returns whatever is closest and calls
 * it a match. Callers that need an exact answer — validating that a genome
 * references real capabilities, for one — need a keyed lookup.
 */
export async function retrieveQdrantPoints(
  pointIds: Array<string | number>,
  collection: string = QDRANT_COLLECTION,
): Promise<Array<{ id: string | number; payload: Record<string, unknown> | null }>> {
  if (!pointIds.length) return [];
  const client = getClient();
  await ensureQdrantCollection(collection);

  const found = await client.retrieve(collection, { ids: pointIds, with_payload: true });
  return found.map((point) => ({
    id: point.id,
    payload: (point.payload as Record<string, unknown> | null) ?? null,
  }));
}

export interface SearchOptions {
  limit?: number;
  scoreThreshold?: number;
  filter?: NonNullable<Parameters<QdrantClient["search"]>[1]>["filter"];
  vectorSize?: number;
  collection?: string;
}

export async function searchQdrant(
  vector: number[],
  { limit = 5, scoreThreshold, filter, vectorSize, collection = QDRANT_COLLECTION }: SearchOptions = {}
) {
  await ensureQdrantCollection(collection, vectorSize ?? vector.length);
  const client = getClient();

  return retryWithBackoff(async () => {
    return await client.search(collection, {
      vector,
      limit,
      with_payload: true,
      score_threshold: scoreThreshold,
      filter,
    });
  });
}

export async function clearQdrantCollection(collection: string = QDRANT_COLLECTION): Promise<void> {
  const client = getClient();
  await (client as any).delete(collection, { filter: { must: [] } });
}

export async function deleteQdrantByFilter(filter: Record<string, unknown>, collection: string = QDRANT_COLLECTION): Promise<void> {
  if (!filter) {
    return;
  }

  await ensureQdrantCollection(collection);
  const client = getClient();

  return retryWithBackoff(async () => {
    await (client as any).delete(collection, { filter });
  });
}

/**
 * Health check for Qdrant connection
 */
export async function checkQdrantHealth(): Promise<{ healthy: boolean; error?: string }> {
  try {
    const client = getClient();
    await client.getCollections();
    return { healthy: true };
  } catch (error: any) {
    return { healthy: false, error: error.message };
  }
}
