import { getRedisClient } from "../../core/infrastructure/redis/redis-client.js";
import { getEmbeddings } from "../../knowledge/core/rag-langchain.service.js";
import { 
    searchQdrant, 
    upsertQdrantPoints, 
    ensureQdrantCollection 
} from "../../../integrations/qdrant-client.js";
import { createLogger } from "../../../utils/logger.js";
import { createHash } from "crypto";

const logger = createLogger("SemanticCache");
const CACHE_COLLECTION = "llm_semantic_cache";
const SIMILARITY_THRESHOLD = 0.985; // Very high precision required for cache
const EXACT_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

export interface CacheEntry {
    prompt: string;
    response: string;
    metadata?: any;
}

export class SemanticCacheService {
    private static exactKey(prompt: string, organizationId?: number | null): string {
        const hash = createHash("sha256").update(`${organizationId ?? 'global'}:${prompt}`).digest("hex");
        return `semantic_cache:exact:${hash}`;
    }

    /**
     * Attempts to find an exact (Redis) or semantically similar (Qdrant) prompt in cache.
     * Tier 1 exact match returns in <2ms with 0 embedding token costs.
     */
    static async get(prompt: string, organizationId?: number | null): Promise<string | null> {
        // 1. TIER 1: Exact Hash Match via Redis
        try {
            const redis = getRedisClient();
            if (redis) {
                const key = this.exactKey(prompt, organizationId);
                const exactHit = await redis.get(key);
                if (exactHit) {
                    logger.debug(`[SemanticCache] Exact Redis hit for key: ${key}`);
                    return exactHit;
                }
            }
        } catch (redisErr: any) {
            logger.warn(`[SemanticCache] Redis lookup failed: ${redisErr.message}`);
        }

        // 2. TIER 2: Semantic Vector Match via Qdrant
        try {
            const embeddings = getEmbeddings();
            const vector = await embeddings.embedQuery(prompt);

            const filter = organizationId ? {
                must: [{ key: "organizationId", match: { value: organizationId } }]
            } : undefined;

            const results = await searchQdrant(vector, {
                limit: 1,
                scoreThreshold: SIMILARITY_THRESHOLD,
                filter,
                collection: CACHE_COLLECTION
            });

            if (results.length > 0 && results[0].payload) {
                const payload = results[0].payload as any;
                logger.info(`[SemanticCache] Semantic hit! Score: ${results[0].score.toFixed(4)}`);
                return payload.response;
            }
        } catch (err: any) {
            logger.error(`[SemanticCache] Get failed: ${err.message}`);
        }
        return null;
    }

    /**
     * Stores a prompt-response pair in both Redis (exact) and Qdrant (semantic).
     */
    static async set(prompt: string, response: string, organizationId?: number | null, metadata?: any): Promise<void> {
        // 1. TIER 1: Store in Redis for instant exact lookup
        try {
            const redis = getRedisClient();
            if (redis) {
                const key = this.exactKey(prompt, organizationId);
                await redis.set(key, response, "EX", EXACT_CACHE_TTL_SECONDS);
                logger.debug(`[SemanticCache] Saved exact Redis entry ${key}`);
            }
        } catch (redisErr: any) {
            logger.warn(`[SemanticCache] Redis set failed: ${redisErr.message}`);
        }

        // 2. TIER 2: Store in Qdrant for semantic similarity lookup
        try {
            const hash = createHash("sha256").update(prompt).digest("hex");
            const pointId = `cache-${hash}`;

            const embeddings = getEmbeddings();
            const vector = await embeddings.embedQuery(prompt);

            await ensureQdrantCollection(CACHE_COLLECTION);
            
            await upsertQdrantPoints([{
                id: pointId,
                vector,
                payload: {
                    prompt: prompt.substring(0, 1000), // Store snippet for debugging
                    response,
                    organizationId,
                    createdAt: new Date().toISOString(),
                    ...metadata
                }
            }], CACHE_COLLECTION);

            logger.debug(`[SemanticCache] Saved entry ${pointId}`);
        } catch (err: any) {
            logger.error(`[SemanticCache] Set failed: ${err.message}`);
        }
    }
}
