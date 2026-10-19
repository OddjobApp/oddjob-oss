/**
 * Behavioral Intelligence Engine — Management API
 *
 * Admin endpoints for configuring vector models, rules, thresholds,
 * API keys, and operational monitoring.
 * Mounted at: /api/behavioral/*
 *
 * Authenticated via standard org admin auth.
 */
import { Router, type Request, type Response } from "express";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { BadRequestError, NotFoundError } from "@server/utils/errors.js";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { biVectorModelService } from "../models/vector-model.service.js";
import { biScoreState } from "../infrastructure/score-state.js";
import { biRedisStreams } from "../infrastructure/redis-streams.js";
import { biIngestionService } from "../core/ingestion.service.js";
import { computeDecay, computeRecency } from "../core/decay-engine.js";
import { evaluate, validate } from "../core/expression-engine.js";
import { requireBI, getLimits, TIER_LIMITS, type BITier } from "../infrastructure/feature-gate.js";
import { getOrCreateIndex } from "../infrastructure/rule-index.js";
import { createLogger } from "@server/utils/logger.js";

const router = Router();
const logger = createLogger("BIManagementAPI");

// All management routes require authentication
router.use(requireAuth);

// ─── Helper: Get org context ─────────────────────────────────────────────────

function getOrgId(req: Request): number {
  return (req as any).organizationId || (req as any).user?.organizationId || 0;
}

function getAppId(req: Request): number {
  // Management API uses a system app ID for storage
  return 0; // Will be resolved from org's BI app deployment
}

// ─── Vector Models ───────────────────────────────────────────────────────────

router.get("/models", asyncHandler(async (req: Request, res: Response) => {
  const orgId = getOrgId(req);
  await requireBI(orgId);
  const models = await biVectorModelService.listModels(orgId, getAppId(req));
  res.json({ models, count: models.length });
}));

router.get("/models/templates", asyncHandler(async (_req: Request, res: Response) => {
  const keys = biVectorModelService.getTemplateKeys();
  const templates = keys.map(key => ({ key, ...biVectorModelService.MODEL_TEMPLATES[key] }));
  res.json({ templates });
}));

router.post("/models", asyncHandler(async (req: Request, res: Response) => {
  const orgId = getOrgId(req);
  await requireBI(orgId);
  const model = await biVectorModelService.createModel(orgId, getAppId(req), req.body);
  res.status(201).json(model);
}));

router.post("/models/from-template", asyncHandler(async (req: Request, res: Response) => {
  const orgId = getOrgId(req);
  await requireBI(orgId);
  const { template_key } = req.body;
  if (!template_key) throw new BadRequestError("'template_key' is required");
  const model = await biVectorModelService.installTemplate(orgId, getAppId(req), template_key);
  if (!model) throw new NotFoundError(`Template '${template_key}' not found`);
  res.status(201).json(model);
}));

router.put("/models/:id", asyncHandler(async (req: Request, res: Response) => {
  const orgId = getOrgId(req);
  await requireBI(orgId);
  const updated = await biVectorModelService.updateModel(orgId, getAppId(req), req.params.id, req.body);
  if (!updated) throw new NotFoundError("Model not found");
  res.json(updated);
}));

router.delete("/models/:id", asyncHandler(async (req: Request, res: Response) => {
  const orgId = getOrgId(req);
  await requireBI(orgId);
  const archived = await biVectorModelService.archiveModel(orgId, getAppId(req), req.params.id);
  if (!archived) throw new NotFoundError("Model not found");
  res.status(204).end();
}));

// ─── Rule Debugger ───────────────────────────────────────────────────────────

router.post("/rules/:id/test", asyncHandler(async (req: Request, res: Response) => {
  const orgId = getOrgId(req);
  await requireBI(orgId);
  const { test_event, test_context } = req.body;

  if (!test_event) throw new BadRequestError("'test_event' is required");

  const index = getOrCreateIndex(orgId);
  const matches = index.findMatches(test_event, test_context || {});

  res.json({
    matches: matches.map(m => ({
      rule_id: m.rule.definition.id,
      rule_name: m.rule.definition.name,
      weights: m.weights,
      chain_targets: m.chainTargets?.length || 0,
    })),
    total_matches: matches.length,
    index_size: index.size,
    compiled_at: new Date(index.compiledAt).toISOString(),
  });
}));

// ─── Expression Validator ────────────────────────────────────────────────────

router.post("/expressions/validate", asyncHandler(async (req: Request, res: Response) => {
  const { expression, test_context } = req.body;
  if (!expression) throw new BadRequestError("'expression' is required");

  const error = validate(expression);
  if (error) return res.json({ valid: false, error });

  let result: any = null;
  if (test_context) {
    try { result = evaluate(expression, test_context, 50); }
    catch (e: any) { return res.json({ valid: true, test_error: e.message }); }
  }

  res.json({ valid: true, test_result: result });
}));

// ─── Score Explainability ────────────────────────────────────────────────────

router.get("/explain/:entityType/:entityId", asyncHandler(async (req: Request, res: Response) => {
  const orgId = getOrgId(req);
  await requireBI(orgId);
  const { entityType, entityId } = req.params;

  const scores = await biScoreState.getScores(orgId, entityType, entityId);
  const window = await biScoreState.getWindow(orgId, entityType, entityId);
  const temporal = await biScoreState.getTemporalMetrics(orgId, entityType, entityId);
  const now = Math.floor(Date.now() / 1000);

  const vectors: Record<string, any> = {};
  for (const score of scores) {
    const decayed = computeDecay(score.rawScore, score.lastUpdate, now, { type: "exponential", halfLifeDays: 7 });
    vectors[score.vector] = {
      raw: score.rawScore,
      decayed: Math.round(decayed * 1000) / 1000,
      decay_factor: score.rawScore > 0 ? Math.round((decayed / score.rawScore) * 1000) / 1000 : 0,
      source: score.source,
      last_update: new Date(score.lastUpdate * 1000).toISOString(),
      age_hours: Math.round((now - score.lastUpdate) / 3600 * 10) / 10,
    };
  }

  res.json({
    entity_type: entityType,
    entity_id: entityId,
    vectors,
    recent_signals: window.slice(0, 10),
    temporal_metrics: temporal,
    rfg: {
      recency: scores.length > 0 ? computeRecency(Math.max(...scores.map(s => s.lastUpdate)), now, 7) : 0,
    },
    explanation: `Entity has ${scores.length} active vectors from ${window.length} recent events.`,
  });
}));

// ─── Operational Health ──────────────────────────────────────────────────────

router.get("/health", asyncHandler(async (req: Request, res: Response) => {
  const orgId = getOrgId(req);
  const tier = await requireBI(orgId);
  const limits = TIER_LIMITS[tier];

  const [streamLength, consumerLag, dailyEvents] = await Promise.all([
    biRedisStreams.getStreamLength(orgId),
    biRedisStreams.getConsumerLag(orgId),
    biIngestionService.getDailyEventCount(orgId),
  ]);

  const index = getOrCreateIndex(orgId);

  res.json({
    status: consumerLag > 10000 ? "degraded" : "healthy",
    tier,
    limits,
    metrics: {
      stream_length: streamLength,
      consumer_lag: consumerLag,
      daily_events: dailyEvents,
      daily_limit: limits.eventsPerDay,
      utilization_percent: limits.eventsPerDay > 0 ? Math.round((dailyEvents / limits.eventsPerDay) * 100) : 0,
      rules_compiled: index.size,
      index_compiled_at: new Date(index.compiledAt).toISOString(),
    },
    timestamp: new Date().toISOString(),
  });
}));

// ─── API Key Management ──────────────────────────────────────────────────────

router.get("/keys", asyncHandler(async (req: Request, res: Response) => {
  const orgId = getOrgId(req);
  await requireBI(orgId);
  // In production: query bi_api_keys collection
  res.json({ keys: [], count: 0, note: "API key management — implementation pending" });
}));

router.post("/keys", asyncHandler(async (req: Request, res: Response) => {
  const orgId = getOrgId(req);
  await requireBI(orgId);
  const { name, permissions } = req.body;
  if (!name) throw new BadRequestError("'name' is required");

  // Generate a new API key
  const crypto = await import("node:crypto");
  const keyId = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  const rawKey = `bi_${orgId}_${keyId}_${Date.now().toString(36)}`;

  // In production: hash and store in bi_api_keys collection
  res.status(201).json({
    key_id: keyId,
    api_key: rawKey, // Only shown once at creation
    name,
    permissions: permissions || ["event_write", "score_read"],
    created_at: new Date().toISOString(),
    note: "Store this key securely — it cannot be retrieved again",
  });
}));

// ─── Super-Admin: Org Management ─────────────────────────────────────────────

router.get("/admin/orgs", asyncHandler(async (req: Request, res: Response) => {
  // Requires super-admin — check in production
  res.json({ orgs: [], note: "Super-admin org management — requires elevated permissions" });
}));

router.put("/admin/orgs/:orgId/tier", asyncHandler(async (req: Request, res: Response) => {
  const targetOrgId = parseInt(req.params.orgId);
  const { tier } = req.body;
  if (!["starter", "pro", "enterprise", null].includes(tier)) {
    throw new BadRequestError("'tier' must be 'starter', 'pro', 'enterprise', or null (disable)");
  }
  // In production: update org_settings.behavioralIntelligenceTier
  const { invalidateTierCache } = await import("../infrastructure/feature-gate.js");
  invalidateTierCache(targetOrgId);
  res.json({ success: true, org_id: targetOrgId, tier });
}));

export { router as biManagementApiRouter };
