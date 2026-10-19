/**
 * Behavioral Intelligence Engine — Public API
 *
 * Endpoints for external customers (SDK, webhooks, CRM sync).
 * Authenticated via API keys (scoped per org).
 * Mounted at: /api/v1/behavioral/*
 *
 * Provides: event ingestion, score queries, identity association.
 */
import { Router, type Request, type Response } from "express";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { BadRequestError, UnauthorizedError } from "@server/utils/errors.js";
import { biIngestionService } from "../core/ingestion.service.js";
import { biScoreState } from "../infrastructure/score-state.js";
import { computeDecay, computeRecency } from "../core/decay-engine.js";
import { requireBI } from "../infrastructure/feature-gate.js";
import { createLogger } from "@server/utils/logger.js";
import { getRedisClient } from "@domain/core/infrastructure/redis/redis-client.js";

const router = Router();
const logger = createLogger("BIPublicAPI");

// ─── API Key Authentication Middleware ───────────────────────────────────────

interface APIKeyContext {
  orgId: number;
  keyId: string;
  permissions: string[];
}

/**
 * Validate API key from Authorization header or x-api-key header.
 * Keys are stored as hashes in Redis with org + permission metadata.
 */
async function resolveApiKey(req: Request): Promise<APIKeyContext> {
  const authHeader = req.headers.authorization;
  const apiKeyHeader = req.headers["x-api-key"] as string | undefined;

  const rawKey = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : apiKeyHeader;

  if (!rawKey) throw new UnauthorizedError("API key required (Authorization: Bearer <key> or x-api-key header)");

  // Look up key in Redis cache first, then DB
  const client = getRedisClient();
  const cacheKey = `bi:apikey:${rawKey.slice(0, 16)}`; // Use prefix for lookup
  const cached = await client.get(cacheKey);

  if (cached) {
    return JSON.parse(cached);
  }

  // In production: hash the key and look up in bi_api_keys collection
  // For now, accept keys in format: bi_{orgId}_{keyId}_{permissions}
  // This is a development fallback — production uses hashed key lookup
  const parts = rawKey.split("_");
  if (parts.length >= 3 && parts[0] === "bi") {
    const orgId = parseInt(parts[1]);
    if (isNaN(orgId)) throw new UnauthorizedError("Invalid API key format");

    const context: APIKeyContext = {
      orgId,
      keyId: parts[2],
      permissions: ["event_write", "score_read"], // Default permissions
    };

    // Cache for 5 minutes
    await client.set(cacheKey, JSON.stringify(context), "EX", 300);
    return context;
  }

  throw new UnauthorizedError("Invalid API key");
}

function requirePermission(permission: string) {
  return async (req: Request, _res: Response, next: Function) => {
    const context = await resolveApiKey(req);
    if (!context.permissions.includes(permission) && !context.permissions.includes("admin")) {
      throw new UnauthorizedError(`API key lacks '${permission}' permission`);
    }
    (req as any).biApiContext = context;
    next();
  };
}

// ─── Rate Limiting ───────────────────────────────────────────────────────────

const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = 1000; // 1000 requests per minute per key

async function checkRateLimit(keyId: string): Promise<{ allowed: boolean; remaining: number }> {
  const client = getRedisClient();
  const key = `bi:ratelimit:${keyId}`;
  const current = await client.incr(key);
  if (current === 1) await client.expire(key, 60);
  return { allowed: current <= RATE_LIMIT_MAX, remaining: Math.max(0, RATE_LIMIT_MAX - current) };
}

// ─── CORS Headers ────────────────────────────────────────────────────────────

router.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-api-key");
  next();
});

router.options("*", (_req, res) => res.status(204).end());

// ─── Event Ingestion ─────────────────────────────────────────────────────────

router.post(
  "/events",
  asyncHandler(async (req: Request, res: Response) => {
    const context = await resolveApiKey(req);
    if (!context.permissions.includes("event_write") && !context.permissions.includes("admin")) {
      throw new UnauthorizedError("API key lacks 'event_write' permission");
    }

    const { allowed, remaining } = await checkRateLimit(context.keyId);
    if (!allowed) {
      res.setHeader("Retry-After", "60");
      return res.status(429).json({ error: "Rate limit exceeded", retry_after_seconds: 60 });
    }
    res.setHeader("X-RateLimit-Remaining", String(remaining));

    const { event_type, entity_type, entity_id, timestamp, payload, environmental } = req.body;

    const result = await biIngestionService.ingestEvent(context.orgId, {
      event_type, entity_type, entity_id,
      source: "sdk",
      signal_category: "behavioral",
      timestamp, payload, environmental,
      api_key_id: context.keyId,
    });

    if (!result.success) {
      return res.status(result.error?.includes("not enabled") ? 403 : 422).json({ success: false, error: result.error });
    }

    res.status(202).json({ success: true, event_id: result.event_id });
  })
);

// ─── Batch Event Ingestion ───────────────────────────────────────────────────

router.post(
  "/events/batch",
  asyncHandler(async (req: Request, res: Response) => {
    const context = await resolveApiKey(req);
    if (!context.permissions.includes("event_write") && !context.permissions.includes("admin")) {
      throw new UnauthorizedError("API key lacks 'event_write' permission");
    }

    const { allowed, remaining } = await checkRateLimit(context.keyId);
    if (!allowed) {
      res.setHeader("Retry-After", "60");
      return res.status(429).json({ error: "Rate limit exceeded" });
    }
    res.setHeader("X-RateLimit-Remaining", String(remaining));

    const { events } = req.body;
    if (!Array.isArray(events) || events.length === 0) throw new BadRequestError("'events' array is required");
    if (events.length > 100) throw new BadRequestError("Maximum 100 events per batch");

    const inputs = events.map((e: any) => ({
      ...e,
      source: "sdk" as const,
      signal_category: e.signal_category || "behavioral",
      api_key_id: context.keyId,
    }));

    const result = await biIngestionService.ingestBatch(context.orgId, inputs);
    res.status(202).json(result);
  })
);

// ─── Score Queries ───────────────────────────────────────────────────────────

router.get(
  "/scores/:entityType/:entityId",
  asyncHandler(async (req: Request, res: Response) => {
    const context = await resolveApiKey(req);
    if (!context.permissions.includes("score_read") && !context.permissions.includes("admin")) {
      throw new UnauthorizedError("API key lacks 'score_read' permission");
    }

    const { entityType, entityId } = req.params;
    const scores = await biScoreState.getScores(context.orgId, entityType, entityId);
    const now = Math.floor(Date.now() / 1000);

    const vectors: Record<string, { raw: number; decayed: number; source: string }> = {};
    for (const score of scores) {
      const decayed = computeDecay(score.rawScore, score.lastUpdate, now, { type: "exponential", halfLifeDays: 7 });
      vectors[score.vector] = {
        raw: Math.round(score.rawScore * 1000) / 1000,
        decayed: Math.round(decayed * 1000) / 1000,
        source: score.source,
      };
    }

    const lastActivity = scores.length > 0 ? Math.max(...scores.map(s => s.lastUpdate)) : 0;

    res.json({
      entity_type: entityType,
      entity_id: entityId,
      vectors,
      rfg: { recency: Math.round(computeRecency(lastActivity, now, 7) * 1000) / 1000 },
      queried_at: new Date().toISOString(),
    });
  })
);

// ─── Batch Score Query ───────────────────────────────────────────────────────

router.post(
  "/scores/batch",
  asyncHandler(async (req: Request, res: Response) => {
    const context = await resolveApiKey(req);
    if (!context.permissions.includes("score_read") && !context.permissions.includes("admin")) {
      throw new UnauthorizedError("API key lacks 'score_read' permission");
    }

    const { entity_type, entity_ids } = req.body;
    if (!entity_type || !Array.isArray(entity_ids)) throw new BadRequestError("'entity_type' and 'entity_ids' required");
    if (entity_ids.length > 100) throw new BadRequestError("Maximum 100 entities per batch");

    const scoreMap = await biScoreState.batchGetScores(context.orgId, entity_type, entity_ids);
    const now = Math.floor(Date.now() / 1000);

    const results: Record<string, Record<string, number>> = {};
    for (const [entityId, scores] of scoreMap) {
      const vectors: Record<string, number> = {};
      for (const score of scores) {
        vectors[score.vector] = Math.round(computeDecay(score.rawScore, score.lastUpdate, now, { type: "exponential", halfLifeDays: 7 }) * 1000) / 1000;
      }
      results[entityId] = vectors;
    }

    res.json({ entity_type, scores: results, count: Object.keys(results).length });
  })
);

// ─── Identity Association ────────────────────────────────────────────────────

router.post(
  "/identify",
  asyncHandler(async (req: Request, res: Response) => {
    const context = await resolveApiKey(req);
    if (!context.permissions.includes("event_write") && !context.permissions.includes("admin")) {
      throw new UnauthorizedError("API key lacks 'event_write' permission");
    }

    const { anonymous_id, known_id, entity_type, attributes } = req.body;
    if (!anonymous_id || !known_id) throw new BadRequestError("'anonymous_id' and 'known_id' are required");

    // Merge anonymous scores into known entity
    const anonScores = await biScoreState.getScores(context.orgId, entity_type || "contact", anonymous_id);
    if (anonScores.length > 0) {
      const updates = anonScores.map(s => ({
        vector: s.vector,
        weight: s.rawScore,
        operation: "increment" as const,
        source: (s.source === "blended" ? "behavioral" : s.source) as "behavioral" | "qualification",
      }));
      await biScoreState.applyScoreUpdates(context.orgId, entity_type || "contact", known_id, updates);
      // Delete anonymous scores
      await biScoreState.deleteEntityScores(context.orgId, entity_type || "contact", anonymous_id);
    }

    // Emit identify event for downstream processing
    await biIngestionService.ingestEvent(context.orgId, {
      event_type: "identify",
      entity_type: entity_type || "contact",
      entity_id: known_id,
      source: "sdk",
      signal_category: "qualification",
      payload: { anonymous_id, attributes },
      api_key_id: context.keyId,
    });

    res.json({ success: true, merged_vectors: anonScores.length, entity_id: known_id });
  })
);

// ─── Health Check ────────────────────────────────────────────────────────────

router.get(
  "/health",
  asyncHandler(async (req: Request, res: Response) => {
    const context = await resolveApiKey(req);
    res.json({ status: "ok", org_id: context.orgId, timestamp: new Date().toISOString() });
  })
);

export { router as biPublicApiRouter };
