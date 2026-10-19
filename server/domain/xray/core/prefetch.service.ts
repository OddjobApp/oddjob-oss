/**
 * Prefetch Service
 *
 * Extracts CALLS_API edges from the composition graph to generate
 * per-screen prefetch manifests. Each manifest describes which API
 * endpoints a screen will need, enabling the client-side loader to
 * fire parallel fetches early in the page lifecycle.
 */

import { createLogger } from "@server/utils/logger.js";
import { xrayCompositionService } from "./xray-composition.service.js";

import type {
  CompositionGraph,
  CompositionNode,
} from "../types/composition.js";

const logger = createLogger("PrefetchService");

const CACHE_TTL_SECONDS = 3600; // 1 hour — matches composition graph cache TTL

// ─── Concurrency Guard ───────────────────────────────────────────────────────

/** In-memory set tracking active warm-up operations by scope+org key */
const activeWarmUps = new Set<string>();

function warmUpLockKey(scope: string, organizationId: number): string {
  return `${scope}:org:${organizationId}`;
}

async function getRedis() {
  const { redis } = await import("@domain/core/infrastructure/redis/redis-client.js");
  return redis;
}

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface PrefetchEndpointEntry {
  method: string;                        // "GET" | "POST" | "PUT" | "DELETE" | "PATCH"
  path: string;                          // "/api/missions"
  staticParams: Record<string, string>;  // default query params from graph metadata
}

export interface PrefetchManifest {
  screenPath: string;
  scope: string;
  generatedAt: string;   // ISO 8601 timestamp
  endpoints: PrefetchEndpointEntry[];
}

// ─── Service ─────────────────────────────────────────────────────────────────

export const prefetchService = {

  /**
   * Derive the Redis cache key for a single prefetch manifest.
   * Format: xray:prefetch:{scope}:{screenPath}:org:{orgId}
   */
  _cacheKey(scope: string, screenPath: string, organizationId: number): string {
    return `xray:prefetch:${scope}:${screenPath}:org:${organizationId}`;
  },

  /**
   * Derive the scope key set key that tracks all individual manifest keys for a scope+org.
   * Used for efficient bulk invalidation.
   */
  _scopeKeySetKey(scope: string, organizationId: number): string {
    return `xray:prefetch:keys:${scope}:org:${organizationId}`;
  },

  /**
   * Parse an API_Endpoint_Node label into method + path.
   * Label format: "<METHOD> <path>" — splits at the first space.
   */
  _parseEndpointLabel(label: string): { method: string; path: string } {
    const spaceIdx = label.indexOf(" ");
    if (spaceIdx <= 0) {
      return { method: "GET", path: label };
    }
    return {
      method: label.slice(0, spaceIdx),
      path: label.slice(spaceIdx + 1),
    };
  },

  /**
   * Extract a PrefetchManifest from a prebuilt CompositionGraph for a specific screen.
   *
   * Finds the Screen_Node matching the path, collects all CALLS_API edge targets,
   * parses each target's label and metadata, deduplicates by method+path, and
   * returns the manifest.
   *
   * Returns an empty manifest (zero endpoints) when the screen node is not found
   * or has no CALLS_API edges.
   */
  _extractManifestFromGraph(graph: CompositionGraph, screenPath: string, scope: string): PrefetchManifest {
    const emptyManifest: PrefetchManifest = {
      screenPath,
      scope,
      generatedAt: new Date().toISOString(),
      endpoints: [],
    };

    // Find the Screen_Node matching the requested path
    const screenNode = graph.nodes.find(
      (n) => n.type === "screen" && n.id === `screen::${screenPath}`
    );

    if (!screenNode) {
      return emptyManifest;
    }

    // Collect all CALLS_API edges originating from this screen
    const callsApiEdges = graph.edges.filter(
      (e) => e.source === screenNode.id && e.relation === "CALLS_API"
    );

    if (callsApiEdges.length === 0) {
      return emptyManifest;
    }

    // Build a node lookup for efficient target resolution
    const nodeMap = new Map<string, CompositionNode>();
    for (const node of graph.nodes) {
      nodeMap.set(node.id, node);
    }

    // Parse each target endpoint node and deduplicate by method+path
    const seen = new Set<string>();
    const endpoints: PrefetchEndpointEntry[] = [];

    for (const callEdge of callsApiEdges) {
      const targetNode = nodeMap.get(callEdge.target);
      if (!targetNode || targetNode.type !== "api_endpoint") continue;

      const { method, path } = this._parseEndpointLabel(targetNode.label);
      const dedupeKey = `${method}:${path}`;

      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      // Extract staticParams from node metadata if present
      const staticParams: Record<string, string> = {};
      if (targetNode.metadata) {
        const metaParams = targetNode.metadata.staticParams ?? targetNode.metadata.defaultParams;
        if (metaParams && typeof metaParams === "object") {
          for (const [key, value] of Object.entries(metaParams as Record<string, unknown>)) {
            if (typeof value === "string") {
              staticParams[key] = value;
            } else if (value !== null && value !== undefined) {
              staticParams[key] = String(value);
            }
          }
        }
      }

      endpoints.push({ method, path, staticParams });
    }

    return {
      screenPath,
      scope,
      generatedAt: new Date().toISOString(),
      endpoints,
    };
  },

  /**
   * Generate or retrieve cached manifest for a single screen.
   * Checks Redis first; on miss, generates from graph and stores in Redis with TTL.
   * Handles Redis unavailability gracefully by generating directly from graph.
   */
  async getManifest(screenPath: string, scope: string, organizationId: number): Promise<PrefetchManifest> {
    const cacheKey = this._cacheKey(scope, screenPath, organizationId);

    // Try Redis cache first
    try {
      const redis = await getRedis();
      const cached = await redis.get(cacheKey);
      if (cached) {
        logger.info(`[PrefetchService] Cache hit: ${cacheKey}`);
        return JSON.parse(cached);
      }
    } catch (err: any) {
      logger.warn(`[PrefetchService] Redis read failed for ${cacheKey}, generating directly: ${err.message}`);
    }

    // Cache miss — generate from graph
    try {
      const graph = await xrayCompositionService.buildGraph(scope, organizationId);
      const manifest = this._extractManifestFromGraph(graph, screenPath, scope);

      // Store in Redis cache
      try {
        const redis = await getRedis();
        const serialized = JSON.stringify(manifest);
        await redis.set(cacheKey, serialized, "EX", CACHE_TTL_SECONDS);

        // Track this key in the scope key set for bulk invalidation
        const scopeSetKey = this._scopeKeySetKey(scope, organizationId);
        await redis.sadd(scopeSetKey, cacheKey);
        await redis.expire(scopeSetKey, CACHE_TTL_SECONDS);

        logger.info(`[PrefetchService] Cache miss, stored: ${cacheKey}`);
      } catch (err: any) {
        logger.warn(`[PrefetchService] Redis write failed for ${cacheKey}, returning manifest without caching: ${err.message}`);
      }

      return manifest;
    } catch (err: any) {
      logger.error(`[PrefetchService] Failed to generate manifest for ${scope}:${screenPath}: ${err.message}`);
      return {
        screenPath,
        scope,
        generatedAt: new Date().toISOString(),
        endpoints: [],
      };
    }
  },

  /**
   * Generate manifests for all screens in a scope (bulk).
   * Queries all Screen_Nodes in scope and returns a map of screenPath → PrefetchManifest.
   * Individual manifests are cached in Redis; on cache miss they are generated and stored.
   */
  async getBulkManifests(scope: string, organizationId: number): Promise<Record<string, PrefetchManifest>> {
    try {
      const graph = await xrayCompositionService.buildGraph(scope, organizationId);
      const screenNodes = graph.nodes.filter((n) => n.type === "screen");
      const result: Record<string, PrefetchManifest> = {};

      for (const screen of screenNodes) {
        // Extract screen path from the node id (format: "screen::<path>")
        const screenPath = screen.id.replace(/^screen::/, "");
        const cacheKey = this._cacheKey(scope, screenPath, organizationId);

        // Try Redis cache first for each screen
        let manifest: PrefetchManifest | null = null;
        try {
          const redis = await getRedis();
          const cached = await redis.get(cacheKey);
          if (cached) {
            manifest = JSON.parse(cached);
          }
        } catch (err: any) {
          logger.warn(`[PrefetchService] Redis read failed for ${cacheKey} in bulk: ${err.message}`);
        }

        if (!manifest) {
          manifest = this._extractManifestFromGraph(graph, screenPath, scope);

          // Store in Redis cache
          try {
            const redis = await getRedis();
            const serialized = JSON.stringify(manifest);
            await redis.set(cacheKey, serialized, "EX", CACHE_TTL_SECONDS);

            // Track this key in the scope key set
            const scopeSetKey = this._scopeKeySetKey(scope, organizationId);
            await redis.sadd(scopeSetKey, cacheKey);
            await redis.expire(scopeSetKey, CACHE_TTL_SECONDS);
          } catch (err: any) {
            logger.warn(`[PrefetchService] Redis write failed for ${cacheKey} in bulk: ${err.message}`);
          }
        }

        result[screenPath] = manifest;
      }

      return result;
    } catch (err: any) {
      logger.error(`[PrefetchService] Failed to generate bulk manifests for scope ${scope}: ${err.message}`);
      return {};
    }
  },

  /**
   * Invalidate all cached manifests for a scope+org.
   * Uses the scope key set to discover all individual manifest keys,
   * deletes them all, then deletes the scope key set itself.
   */
  async invalidateScope(scope: string, organizationId: number): Promise<void> {
    const scopeSetKey = this._scopeKeySetKey(scope, organizationId);

    try {
      const redis = await getRedis();

      // Retrieve all manifest keys tracked by the scope key set
      const manifestKeys = await redis.smembers(scopeSetKey);

      if (manifestKeys.length > 0) {
        // Delete all individual manifest cache entries
        await redis.del(...manifestKeys);
        logger.info(`[PrefetchService] Invalidated ${manifestKeys.length} manifest keys for scope "${scope}" org ${organizationId}`);
      }

      // Delete the scope key set itself
      await redis.del(scopeSetKey);
    } catch (err: any) {
      logger.warn(`[PrefetchService] Redis invalidation failed for scope "${scope}" org ${organizationId}: ${err.message}`);
    }
  },

  /**
   * Regenerate and cache manifests for all screens in a scope (warm-up).
   * Rebuilds the composition graph, iterates all Screen_Nodes, generates manifests,
   * and stores them in Redis.
   *
   * Includes a concurrency guard: if warm-up is already in progress for the same
   * scope+org, the duplicate call is skipped to prevent redundant work when multiple
   * triggers fire in rapid succession.
   *
   * If a single screen's manifest generation fails, logs a warning with the screen
   * path and continues warming the remaining screens.
   */
  async warmManifests(scope: string, organizationId: number): Promise<void> {
    const lockKey = warmUpLockKey(scope, organizationId);

    // Concurrency guard — skip if warm-up already in progress for this scope+org
    if (activeWarmUps.has(lockKey)) {
      logger.debug(`[PrefetchService] Warm-up already in progress for scope "${scope}" org ${organizationId}, skipping duplicate`);
      return;
    }

    activeWarmUps.add(lockKey);

    try {
      const graph = await xrayCompositionService.buildGraph(scope, organizationId);
      const screenNodes = graph.nodes.filter((n) => n.type === "screen");

      let warmed = 0;
      let failed = 0;

      for (const screen of screenNodes) {
        const screenPath = screen.id.replace(/^screen::/, "");

        try {
          const manifest = this._extractManifestFromGraph(graph, screenPath, scope);
          const cacheKey = this._cacheKey(scope, screenPath, organizationId);

          try {
            const redis = await getRedis();
            const serialized = JSON.stringify(manifest);
            await redis.set(cacheKey, serialized, "EX", CACHE_TTL_SECONDS);

            // Track this key in the scope key set
            const scopeSetKey = this._scopeKeySetKey(scope, organizationId);
            await redis.sadd(scopeSetKey, cacheKey);
            await redis.expire(scopeSetKey, CACHE_TTL_SECONDS);

            warmed++;
          } catch (err: any) {
            logger.warn(`[PrefetchService] Redis write failed during warm-up for screen "${screenPath}" in scope "${scope}": ${err.message}`);
            failed++;
          }
        } catch (err: any) {
          logger.warn(`[PrefetchService] Manifest generation failed during warm-up for screen "${screenPath}" in scope "${scope}": ${err.message}`);
          failed++;
        }
      }

      logger.info(`[PrefetchService] Warm-up complete for scope "${scope}" org ${organizationId}: ${warmed} warmed, ${failed} failed, ${screenNodes.length} total screens`);
    } catch (err: any) {
      logger.error(`[PrefetchService] Warm-up failed for scope "${scope}" org ${organizationId}: ${err.message}`);
    } finally {
      activeWarmUps.delete(lockKey);
    }
  },
};
