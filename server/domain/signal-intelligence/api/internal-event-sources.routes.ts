/**
 * Internal Event Sources REST API Routes
 * Manages configuration and status aggregation for internal Oddjob event streams
 * (cycle events, mission events, deliverable events, agent events).
 *
 * GET    /api/internal-event-sources/status  — Aggregates active subscription counts across event categories
 * POST   /api/internal-event-sources         — Configure new internal event source
 * GET    /api/internal-event-sources         — List internal event sources for tenant
 * DELETE /api/internal-event-sources/:id     — Disable or delete internal event source
 */

import { Router, type Request, type Response } from "express";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { withProjectScope } from "@server/middleware/project-scope.js";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { getUserOrgContext, requireOrgId } from "@server/utils/auth-context.js";
import { createLogger } from "@server/utils/logger.js";
import { db } from "@server/database_service.js";
import { eq, and, desc } from "drizzle-orm";
import { signalFeedsService } from "../core/signal-feeds.service.js";
import { cycleSignalSubscriptionService } from "../core/cycle-signal-subscription.service.js";
import {
  signalFeeds,
  cycleSignalSubscriptions,
} from "@shared/schema/index.js";

const logger = createLogger("InternalEventSourcesRoutes");

export const INTERNAL_EVENT_CATEGORIES = {
  cycle_events: [
    "cycle_phase_changed",
    "cycle_failed",
    "cycle_completed",
    "cycle_blocked",
  ],
  mission_events: [
    "mission_started",
    "mission_failed",
    "mission_completed",
    "mission_budget_exceeded",
  ],
  deliverable_events: [
    "deliverable_created",
    "deliverable_approved",
    "deliverable_rejected",
  ],
  agent_events: [
    "task_completed",
    "task_failed",
    "agent_retry",
  ],
} as const;

export const internalEventSourcesRouter = Router();
internalEventSourcesRouter.use(requireAuth);
internalEventSourcesRouter.use(withProjectScope());

/**
 * GET /api/internal-event-sources/status
 * Returns subscription counts and active status for each known internal event type.
 */
internalEventSourcesRouter.get("/status", asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  const orgId = requireOrgId(orgContext);

  // Load active internal feeds for the tenant
  const feeds = await signalFeedsService.listInternalEventFeeds(orgId);

  // Load active cycle signal subscriptions
  const subscriptions = await cycleSignalSubscriptionService.listEnabledForOrg(orgId);

  // Initialize response structure
  const status: Record<string, Record<string, { subscribed: boolean; count: number }>> = {};

  for (const [category, events] of Object.entries(INTERNAL_EVENT_CATEGORIES)) {
    status[category] = {};
    for (const eventId of events) {
      status[category][eventId] = { subscribed: false, count: 0 };
    }
  }

  // Aggregate counts from configured internal feeds
  for (const feed of feeds) {
    if (!feed.enabled) continue;
    const creds = (feed.authCredentials as any) || {};
    const category = creds.internalSourceType;
    const triggers: string[] = Array.isArray(creds.eventTriggers) ? creds.eventTriggers : [];

    if (category && status[category]) {
      for (const trigger of triggers) {
        if (status[category][trigger]) {
          status[category][trigger].subscribed = true;
          status[category][trigger].count += 1;
        }
      }
    }
  }

  // Aggregate counts from active cycle subscriptions.
  //
  // A subscription selects events through `filters.eventTypes`, a list — there
  // is no `eventType` column. Reading one meant every cycle subscription
  // contributed nothing, so this panel reported them all as unsubscribed no
  // matter how many cycles were listening.
  for (const sub of subscriptions) {
    const filters = (sub.filters ?? {}) as { eventTypes?: string[] };
    const eventTypes = Array.isArray(filters.eventTypes) ? filters.eventTypes : [];

    for (const eventType of eventTypes) {
      for (const [category, events] of Object.entries(INTERNAL_EVENT_CATEGORIES)) {
        if ((events as readonly string[]).includes(eventType) && status[category]?.[eventType]) {
          status[category][eventType].subscribed = true;
          status[category][eventType].count += 1;
        }
      }
    }
  }

  res.json(status);
}));

/**
 * POST /api/internal-event-sources
 * Configure a new internal event source feed for the tenant.
 */
internalEventSourcesRouter.post("/", asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  const orgId = requireOrgId(orgContext);

  const { name, sourceType, eventTriggers, filters } = req.body;

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return res.status(400).json({ error: "Source name is required" });
  }

  const validSourceTypes = Object.keys(INTERNAL_EVENT_CATEGORIES);
  if (!sourceType || !validSourceTypes.includes(sourceType)) {
    return res.status(400).json({
      error: `Invalid internal source type. Must be one of: ${validSourceTypes.join(", ")}`,
    });
  }

  if (!Array.isArray(eventTriggers) || eventTriggers.length === 0) {
    return res.status(400).json({ error: "At least one event trigger must be specified" });
  }

  const allowedTriggers = INTERNAL_EVENT_CATEGORIES[sourceType as keyof typeof INTERNAL_EVENT_CATEGORIES] as readonly string[];
  const invalidTriggers = eventTriggers.filter(t => !allowedTriggers.includes(t));
  if (invalidTriggers.length > 0) {
    return res.status(400).json({
      error: `Invalid event triggers for ${sourceType}: ${invalidTriggers.join(", ")}`,
    });
  }

  const feed = await signalFeedsService.createInternalEventFeed(orgId, {
    name: name.trim(),
    sourceType,
    eventTriggers,
    filters,
  });

  logger.info(`Created internal event source ${feed.id} for org ${orgId} (${sourceType})`);

  res.status(201).json({
    success: true,
    feed,
  });
}));

/**
 * GET /api/internal-event-sources
 * List all configured internal event sources for the tenant.
 */
internalEventSourcesRouter.get("/", asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  const orgId = requireOrgId(orgContext);

  const feeds = await signalFeedsService.listInternalEventFeeds(orgId);

  res.json({
    sources: feeds,
  });
}));

/**
 * DELETE /api/internal-event-sources/:id
 * Delete or disable an internal event source.
 */
internalEventSourcesRouter.delete("/:id", asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  const orgId = requireOrgId(orgContext);
  const id = parseInt(req.params.id, 10);

  if (isNaN(id)) {
    return res.status(400).json({ error: "Invalid source ID" });
  }

  const deleted = await signalFeedsService.deleteForOrg(id, orgId);

  if (!deleted) {
    return res.status(404).json({ error: "Internal event source not found" });
  }

  logger.info(`Deleted internal event source ${id} for org ${orgId}`);

  res.json({
    success: true,
    message: "Internal event source removed",
  });
}));
