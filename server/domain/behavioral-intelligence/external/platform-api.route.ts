/**
 * Behavioral Intelligence Engine — Platform API
 *
 * Endpoints for internal cycle workbench apps (authenticated via AppToken).
 * Mounted at: /api/platform/app/behavioral/*
 *
 * Provides: event emission, score queries, signal history, threshold status.
 */
import { Router, type Request, type Response } from "express";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { BadRequestError, NotFoundError } from "@server/utils/errors.js";
import { requireAppToken } from "../../apps/infrastructure/app-token.service.js";
import { biIngestionService } from "../core/ingestion.service.js";
import { biScoreState } from "../infrastructure/score-state.js";
import { computeDecay, computeRecency, computeFrequency } from "../core/decay-engine.js";
import { biThresholdEngine } from "../core/threshold-engine.service.js";
import { createLogger } from "@server/utils/logger.js";

const router = Router();
const logger = createLogger("BIPlatformAPI");

// ── Emit Scoring Events ──────────────────────────────────────────────────────

router.post(
  "/events",
  requireAppToken("datasets"),
  asyncHandler(async (req: Request, res: Response) => {
    const { orgId } = req.appTokenContext!;
    const { event_type, entity_type, entity_id, source, signal_category, timestamp, payload, environmental } = req.body;

    if (!event_type) throw new BadRequestError("'event_type' is required");
    if (!entity_type) throw new BadRequestError("'entity_type' is required");
    if (!entity_id) throw new BadRequestError("'entity_id' is required");

    const result = await biIngestionService.ingestEvent(orgId, {
      event_type, entity_type, entity_id,
      source: source || "workbench",
      signal_category, timestamp, payload, environmental,
    });

    if (!result.success) {
      return res.status(result.error?.includes("not enabled") ? 403 : 422).json({ success: false, error: result.error });
    }

    res.status(202).json({ success: true, event_id: result.event_id });
  })
);

// ── Batch Emit ───────────────────────────────────────────────────────────────

router.post(
  "/events/batch",
  requireAppToken("datasets"),
  asyncHandler(async (req: Request, res: Response) => {
    const { orgId } = req.appTokenContext!;
    const { events } = req.body;

    if (!Array.isArray(events) || events.length === 0) throw new BadRequestError("'events' array is required");
    if (events.length > 100) throw new BadRequestError("Maximum 100 events per batch");

    const result = await biIngestionService.ingestBatch(orgId, events);
    res.status(202).json(result);
  })
);

// ── Get Scores ───────────────────────────────────────────────────────────────

router.get(
  "/scores/:entityType/:entityId",
  requireAppToken("datasets"),
  asyncHandler(async (req: Request, res: Response) => {
    const { orgId } = req.appTokenContext!;
    const { entityType, entityId } = req.params;

    const scores = await biScoreState.getScores(orgId, entityType, entityId);
    const now = Math.floor(Date.now() / 1000);

    // Apply decay to get effective scores
    const vectors: Record<string, { raw: number; decayed: number; source: string; last_update: string }> = {};
    for (const score of scores) {
      // Default exponential decay (7-day half-life) — in production, load from model config
      const decayed = computeDecay(score.rawScore, score.lastUpdate, now, { type: "exponential", halfLifeDays: 7 });
      vectors[score.vector] = {
        raw: score.rawScore,
        decayed: Math.round(decayed * 1000) / 1000,
        source: score.source,
        last_update: new Date(score.lastUpdate * 1000).toISOString(),
      };
    }

    // Compute RFG
    const lastActivity = scores.length > 0 ? Math.max(...scores.map(s => s.lastUpdate)) : 0;
    const recency = lastActivity > 0 ? computeRecency(lastActivity, now, 7) : 0;

    res.json({
      entity_type: entityType,
      entity_id: entityId,
      vectors,
      rfg: { recency: Math.round(recency * 1000) / 1000 },
      queried_at: new Date().toISOString(),
    });
  })
);

// ── Batch Get Scores ─────────────────────────────────────────────────────────

router.post(
  "/scores/batch",
  requireAppToken("datasets"),
  asyncHandler(async (req: Request, res: Response) => {
    const { orgId } = req.appTokenContext!;
    const { entity_type, entity_ids } = req.body;

    if (!entity_type) throw new BadRequestError("'entity_type' is required");
    if (!Array.isArray(entity_ids) || entity_ids.length === 0) throw new BadRequestError("'entity_ids' array is required");
    if (entity_ids.length > 100) throw new BadRequestError("Maximum 100 entities per batch");

    const scoreMap = await biScoreState.batchGetScores(orgId, entity_type, entity_ids);
    const now = Math.floor(Date.now() / 1000);

    const results: Record<string, any> = {};
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

// ── Signal History ───────────────────────────────────────────────────────────

router.get(
  "/signals/:entityType/:entityId",
  requireAppToken("datasets"),
  asyncHandler(async (req: Request, res: Response) => {
    const { orgId } = req.appTokenContext!;
    const { entityType, entityId } = req.params;

    // Get event window (last 20 events)
    const window = await biScoreState.getWindow(orgId, entityType, entityId);

    res.json({
      entity_type: entityType,
      entity_id: entityId,
      signals: window,
      count: window.length,
    });
  })
);

// ── Threshold Status ─────────────────────────────────────────────────────────

router.get(
  "/thresholds/:entityType/:entityId",
  requireAppToken("datasets"),
  asyncHandler(async (req: Request, res: Response) => {
    const { orgId } = req.appTokenContext!;
    const { entityType, entityId } = req.params;

    // In production, load thresholds from bi_thresholds collection
    // For now, return empty status
    res.json({
      entity_type: entityType,
      entity_id: entityId,
      thresholds: [],
      queried_at: new Date().toISOString(),
    });
  })
);

// ── List Vector Models ───────────────────────────────────────────────────────

router.get(
  "/models",
  requireAppToken("datasets"),
  asyncHandler(async (req: Request, res: Response) => {
    const { orgId, appId } = req.appTokenContext!;
    const { biVectorModelService } = await import("../models/vector-model.service.js");
    const models = await biVectorModelService.listModels(orgId, appId);
    res.json({ models, count: models.length });
  })
);

// ── Get Model Templates ──────────────────────────────────────────────────────

router.get(
  "/models/templates",
  requireAppToken("datasets"),
  asyncHandler(async (_req: Request, res: Response) => {
    const { biVectorModelService } = await import("../models/vector-model.service.js");
    const keys = biVectorModelService.getTemplateKeys();
    const templates = keys.map(key => ({ key, ...biVectorModelService.MODEL_TEMPLATES[key] }));
    res.json({ templates, count: templates.length });
  })
);

export { router as biPlatformApiRouter };
