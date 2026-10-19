/**
 * Signal Intelligence REST API Routes
 * Endpoints for managing signal feeds, querying event primitives,
 * causal graph links, state transitions, counterfactual simulations,
 * and autonomous action policies/approvals.
 *
 * POST   /api/signal-feeds                    — Configure new feed
 * GET    /api/signal-feeds                    — List feeds for org
 * PATCH  /api/signal-feeds/:id               — Update feed config
 * DELETE /api/signal-feeds/:id               — Disable feed
 * GET    /api/event-primitives               — List with filters
 * GET    /api/causal-graph/links/:eventId    — Get affected entities for event
 * POST   /api/simulations/counterfactual     — Submit counterfactual simulation
 * GET    /api/state-transitions              — Recent transitions (limit 1000)
 * GET    /api/autonomous-actions/policies    — List policies for org
 * POST   /api/autonomous-actions/policies    — Create policy
 * POST   /api/autonomous-actions/approve/:id — Approve pending request
 * POST   /api/autonomous-actions/reject/:id  — Reject pending request
 *
 * Rule suites (GRIE) live in `rule-suites.routes.ts` under /api/rule-suites.
 *
 * POST /api/event-primitives/inject accepts optional spatial telemetry
 * (latitude/longitude, velocity, heading, projected position, per-cell metrics,
 * subjectId). Absent, the signal is placed by the ingestion resolver from its
 * text or jurisdiction, with the resulting precision recorded — see
 * docs/SIGNAL_INTELLIGENCE_SPATIAL_RULES.md §7.
 *
 * Requirements: 13.1, 13.2, 16.4, 17.2, 17.4
 */

import { Router, type Request, type Response } from "express";
import { db } from "@server/database_service.js";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { withProjectScope } from "@server/middleware/project-scope.js";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { getUserOrgContext, requireOrgId } from "@server/utils/auth-context.js";
import { signalFeedsService } from "../core/signal-feeds.service.js";
import { autonomousActionService } from "../core/autonomous-action.service.js";
import { createLogger } from "@server/utils/logger.js";
import { NotFoundError, ConflictError } from "@server/utils/errors.js";
import { eq, and, desc, gte, isNull, lte, or } from "drizzle-orm";
import {
  signalFeeds,
  eventPrimitives,
  autonomousActionPolicies,
  autonomousActionLogs,
  autonomousActionArtifacts,
  feedSourceTypes,
  severities,
  targetSectors,
  actionTypes,
  approvalGates,
  cycleSignalSubscriptions,
  operationalCycles,
  type FeedSourceType,
  type Severity,
} from "@shared/schema/index.js";
import { signalIngestionService } from "../core/signal-ingestion.service.js";
import {
  storeFeedCredentials,
  deleteFeedCredentials,
  redactFeedCredentials,
} from "../core/feed-credentials.service.js";
import { registerBuiltInFetchers } from "../core/fetchers/index.js";
import { causalGraphService } from "../core/causal-graph.service.js";
import { worldModelBridgeService } from "../core/world-model-bridge.service.js";
import { cycleSignalSubscriptionService } from "../core/cycle-signal-subscription.service.js";
import { enqueueSpatialSignal } from "../core/spatial-kafka.service.js";
import { spatialTelemetryResolver } from "../core/spatial-telemetry-resolver.service.js";
import { RULE_DELIVERY_MODES } from "@shared/contracts/rule-specification.js";

const logger = createLogger("SignalIntelligenceRoutes");

// ============================================================================
// SIGNAL FEEDS ROUTER
// ============================================================================

const feedsRouter = Router();
feedsRouter.use(requireAuth);
feedsRouter.use(withProjectScope());

/**
 * POST /api/signal-feeds
 * Configure a new signal feed for the organization.
 * Validates URL format, polling interval [30, 86400], and source type enum.
 * Returns 201 on success, 400 on validation error.
 */
feedsRouter.post("/", asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  const orgId = requireOrgId(orgContext);

  const { name, sourceType, url, authCredentials, pollingIntervalSeconds, enabled } = req.body;

  // Validate required fields
  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return res.status(400).json({ error: "Feed name is required" });
  }
  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "Feed URL is required" });
  }
  if (!sourceType || !feedSourceTypes.includes(sourceType as FeedSourceType)) {
    return res.status(400).json({
      error: `Invalid source type. Must be one of: ${feedSourceTypes.join(", ")}`,
    });
  }
  if (
    pollingIntervalSeconds == null ||
    typeof pollingIntervalSeconds !== "number" ||
    pollingIntervalSeconds < 30 ||
    pollingIntervalSeconds > 86400
  ) {
    return res.status(400).json({
      error: "Polling interval must be between 30 and 86400 seconds",
    });
  }

  const created = await signalIngestionService.configureFeed(orgId, {
    name,
    sourceType,
    url,
    authCredentials,
    pollingIntervalSeconds,
    enabled,
  });

  logger.info(`Signal feed created: ${created.id} for org ${orgId}`);
  res.status(201).json(redactFeedCredentials(created));
}));

/**
 * GET /api/signal-feeds
 * List all signal feeds for the authenticated user's organization.
 * Returns 200 with an array of feed configurations.
 */
feedsRouter.get("/", asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  const orgId = requireOrgId(orgContext);

  const feeds = await signalFeedsService.listForOrg(orgId);

  // Whole rows used to go out here, so every stored token was served to any
  // member of the org.
  res.json(feeds.map(redactFeedCredentials));
}));

/**
 * PATCH /api/signal-feeds/:id
 * Update a feed configuration. Supports partial updates.
 * Validates source type enum, polling interval bounds if provided.
 * Returns 200 on success, 400 on validation error, 404 if not found.
 */
feedsRouter.patch("/:id", asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  const orgId = requireOrgId(orgContext);
  const id = parseInt(req.params.id, 10);

  if (isNaN(id)) {
    return res.status(400).json({ error: "Invalid feed ID" });
  }

  // Verify feed exists and belongs to org
  const existing = await signalFeedsService.getForOrg(id, orgId);

  if (!existing) {
    throw new NotFoundError(
      `Signal feed ${id} not found`,
      "NOT_FOUND",
      { feedId: id, organizationId: orgId }
    );
  }

  const updateData: Record<string, any> = {};
  const { name, sourceType, url, authCredentials, pollingIntervalSeconds, enabled } = req.body;

  if (name !== undefined) {
    if (typeof name !== "string" || name.trim().length === 0) {
      return res.status(400).json({ error: "Feed name cannot be empty" });
    }
    updateData.name = name.trim();
  }

  if (sourceType !== undefined) {
    if (!feedSourceTypes.includes(sourceType as FeedSourceType)) {
      return res.status(400).json({
        error: `Invalid source type. Must be one of: ${feedSourceTypes.join(", ")}`,
      });
    }
    updateData.sourceType = sourceType;
  }

  if (url !== undefined) {
    if (typeof url !== "string" || url.trim().length === 0) {
      return res.status(400).json({ error: "Feed URL cannot be empty" });
    }
    // Basic URL format validation
    try {
      new URL(url);
    } catch {
      return res.status(400).json({ error: "Invalid URL format" });
    }
    updateData.url = url;
  }

  if (pollingIntervalSeconds !== undefined) {
    if (
      typeof pollingIntervalSeconds !== "number" ||
      pollingIntervalSeconds < 30 ||
      pollingIntervalSeconds > 86400
    ) {
      return res.status(400).json({
        error: "Polling interval must be between 30 and 86400 seconds",
      });
    }
    updateData.pollingIntervalSeconds = pollingIntervalSeconds;
  }

  if (authCredentials !== undefined) {
    // Never assign the caller's blob straight onto the row — `auth_credentials`
    // is plain jsonb, so that is a cleartext token at rest. Encrypt it and keep
    // only the descriptor. `null` clears the credential.
    if (authCredentials === null) {
      await deleteFeedCredentials(orgId, id);
      updateData.authCredentials = null;
    } else if (
      typeof authCredentials?.type === "string" &&
      typeof authCredentials?.token === "string"
    ) {
      updateData.authCredentials = await storeFeedCredentials(
        orgId,
        id,
        authCredentials
      );
    } else {
      return res.status(400).json({
        error: "authCredentials must be null or an object with string 'type' and 'token'",
      });
    }
  }

  if (enabled !== undefined) {
    updateData.enabled = !!enabled;
  }

  if (Object.keys(updateData).length === 0) {
    return res.status(400).json({ error: "No valid fields to update" });
  }

  const updated = await signalFeedsService.updateForOrg(id, orgId, updateData);

  res.json(redactFeedCredentials(updated));
}));

/**
 * DELETE /api/signal-feeds/:id
 * Disable a signal feed (soft delete: sets enabled=false, status=disabled).
 * Returns 200 on success, 404 if not found.
 */
feedsRouter.delete("/:id", asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  const orgId = requireOrgId(orgContext);
  const id = parseInt(req.params.id, 10);

  if (isNaN(id)) {
    return res.status(400).json({ error: "Invalid feed ID" });
  }

  // Verify feed exists and belongs to org
  const existing = await signalFeedsService.getForOrg(id, orgId);

  if (!existing) {
    throw new NotFoundError(
      `Signal feed ${id} not found`,
      "NOT_FOUND",
      { feedId: id, organizationId: orgId }
    );
  }

  await signalFeedsService.disableForOrg(id, orgId);

  res.json({ success: true, message: `Signal feed ${id} has been disabled` });
}));

// ============================================================================
// EVENT PRIMITIVES ROUTER
// ============================================================================

const eventsRouter = Router();
eventsRouter.use(requireAuth);

eventsRouter.post("/ingest", asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  const orgId = requireOrgId(orgContext);
  const {
    signalId = crypto.randomUUID(), eventType, targetSector, jurisdiction, severity,
    confidence = 1, summary, sourceUrl, entityRefs = [], provenance,
  } = req.body ?? {};
  if (!eventType || !targetSector || !jurisdiction || !severity) {
    return res.status(400).json({ error: "eventType, targetSector, jurisdiction, and severity are required" });
  }
  const normalizedConfidence = Number(confidence);
  if (!Number.isFinite(normalizedConfidence) || normalizedConfidence < 0 || normalizedConfidence > 1) {
    return res.status(400).json({ error: "confidence must be between 0 and 1" });
  }
  if (!Array.isArray(entityRefs) || entityRefs.some(ref => !ref || typeof ref.type !== "string" || typeof ref.id !== "string")) {
    return res.status(400).json({ error: "entityRefs must contain { type, id } entries" });
  }
  const eventId = await enqueueSpatialSignal(orgId, {
    signalId: String(signalId), eventType: String(eventType), targetSector: String(targetSector),
    jurisdiction: String(jurisdiction), severity: String(severity), confidence: normalizedConfidence,
    summary: summary == null ? undefined : String(summary),
    sourceUrl: sourceUrl == null ? undefined : String(sourceUrl), entityRefs, provenance,
  }, {
    correlationId: typeof req.headers["x-correlation-id"] === "string" ? req.headers["x-correlation-id"] : undefined,
    producer: "oddjob-api",
  });
  res.status(202).json({ accepted: true, eventId, organizationId: orgId });
}));

eventsRouter.post("/inject", asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  const orgId = requireOrgId(orgContext);
  const {
    eventType,
    targetSector,
    jurisdiction,
    severity,
    confidenceScore = 1,
    rawText = "",
    sourceUrl = "manual://operator",
    // Optional positional telemetry. Absent, the resolver places the signal
    // from its text or jurisdiction and records that lower precision.
    latitude,
    longitude,
    velocityKnots,
    headingDegrees,
    projectedLatitude,
    projectedLongitude,
    fluxDensityPhi,
    cellMetrics,
    subjectId,
    precisionM,
  } = req.body;
  if (!eventType || !targetSector || !jurisdiction) {
    return res.status(400).json({ error: "eventType, targetSector, and jurisdiction are required" });
  }
  // Reject malformed coordinates rather than silently dropping them: an
  // operator who supplied a position expects it to be honoured.
  const hasLat = latitude !== undefined && latitude !== null;
  const hasLng = longitude !== undefined && longitude !== null;
  if (hasLat !== hasLng) {
    return res.status(400).json({ error: "latitude and longitude must be supplied together" });
  }
  if (hasLat) {
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      return res.status(400).json({ error: "latitude must be a number between -90 and 90" });
    }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      return res.status(400).json({ error: "longitude must be a number between -180 and 180" });
    }
  }
  if (!severities.includes(severity as Severity)) {
    return res.status(400).json({ error: `Invalid severity. Must be one of: ${severities.join(", ")}` });
  }
  const confidence = Number(confidenceScore);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    return res.status(400).json({ error: "confidenceScore must be between 0 and 1" });
  }
  const now = new Date();
  const spatial = await spatialTelemetryResolver.resolve({
    organizationId: orgId,
    text: String(rawText),
    jurisdiction: String(jurisdiction),
    telemetry: {
      latitude: hasLat ? Number(latitude) : null,
      longitude: hasLng ? Number(longitude) : null,
      velocityKnots: velocityKnots != null ? Number(velocityKnots) : null,
      headingDegrees: headingDegrees != null ? Number(headingDegrees) : null,
      projectedLatitude: projectedLatitude != null ? Number(projectedLatitude) : null,
      projectedLongitude: projectedLongitude != null ? Number(projectedLongitude) : null,
      fluxDensityPhi: fluxDensityPhi != null ? Number(fluxDensityPhi) : null,
      cellMetrics: cellMetrics ?? null,
      subjectId: subjectId != null ? String(subjectId) : null,
      precisionM: precisionM != null ? Number(precisionM) : null,
    },
  });

  const event = await signalIngestionService.injectManualEvent({
    organizationId: orgId,
    projectId: req.projectId ?? null,
    sourceEntryId: `manual-${crypto.randomUUID()}`,
    eventType: String(eventType),
    targetSector: String(targetSector),
    jurisdiction: String(jurisdiction),
    severity,
    sourceUrl: String(sourceUrl),
    extractionTimestamp: now,
    confidenceScore: confidence,
    rawText: String(rawText),
    flags: ["operator_injected"],
    contentHash: crypto.randomUUID(),
    ...spatial,
  });
  const links = await causalGraphService.mapEventToGraph(event);
  const transition = await worldModelBridgeService.emitStateTransition(event, links);
  res.status(201).json({ event, links, transition });
}));

feedsRouter.post("/:id/poll", asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  const orgId = requireOrgId(orgContext);
  const id = Number(req.params.id);
  const feed = await signalIngestionService.getFeedById(id, orgId);
  if (!feed) return res.status(404).json({ error: "Signal feed not found" });
  if (!feed.enabled) return res.status(409).json({ error: "Signal feed is disabled" });
  // The manual path must dispatch identically to the poller; without this a
  // hand-triggered poll would quietly use the generic HTTP fetcher.
  registerBuiltInFetchers();
  res.json(await signalIngestionService.pollAndProcess(feed));
}));

/**
 * GET /api/event-primitives
 * List event primitives with optional filters: severity, sector, jurisdiction, time range.
 * Query params:
 *   - severity: Low | Medium | High | Critical
 *   - sector: target sector enum value
 *   - jurisdiction: ISO country code or supranational identifier
 *   - startTime: ISO 8601 datetime (inclusive lower bound)
 *   - endTime: ISO 8601 datetime (inclusive upper bound)
 *   - limit: number (default 100, max 1000)
 * Returns 200 with filtered array of event primitives.
 */
eventsRouter.get("/", asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  const orgId = requireOrgId(orgContext);

  const { severity, sector, jurisdiction, startTime, endTime, limit: limitParam } = req.query;

  // Validate severity filter
  if (severity && !severities.includes(severity as Severity)) {
    return res.status(400).json({
      error: `Invalid severity filter. Must be one of: ${severities.join(", ")}`,
    });
  }

  // Validate sector filter
  if (sector && !targetSectors.includes(sector as any)) {
    return res.status(400).json({
      error: `Invalid sector filter. Must be one of: ${targetSectors.join(", ")}`,
    });
  }

  // Validate time range format
  if (startTime && isNaN(Date.parse(startTime as string))) {
    return res.status(400).json({ error: "Invalid startTime format. Use ISO 8601 datetime." });
  }
  if (endTime && isNaN(Date.parse(endTime as string))) {
    return res.status(400).json({ error: "Invalid endTime format. Use ISO 8601 datetime." });
  }

  // Parse limit
  let limit = 100;
  if (limitParam) {
    const parsed = parseInt(limitParam as string, 10);
    if (isNaN(parsed) || parsed < 1) {
      return res.status(400).json({ error: "Limit must be a positive integer" });
    }
    limit = Math.min(parsed, 1000);
  }

  // Build conditions
  const conditions = [eq(eventPrimitives.organizationId, orgId)];

  if (severity) {
    conditions.push(eq(eventPrimitives.severity, severity as string));
  }
  if (sector) {
    conditions.push(eq(eventPrimitives.targetSector, sector as string));
  }
  if (jurisdiction) {
    conditions.push(eq(eventPrimitives.jurisdiction, jurisdiction as string));
  }
  if (startTime) {
    conditions.push(gte(eventPrimitives.extractionTimestamp, new Date(startTime as string)));
  }
  if (endTime) {
    conditions.push(lte(eventPrimitives.extractionTimestamp, new Date(endTime as string)));
  }

  const results = await autonomousActionService.searchEventPrimitives(orgId, {
    severity: severity as string | undefined,
    sector: sector as string | undefined,
    jurisdiction: jurisdiction as string | undefined,
    startTime: startTime as string | undefined,
    endTime: endTime as string | undefined,
    limit,
  });

  res.json(results);
}));

// ============================================================================
// CAUSAL GRAPH ROUTER
// ============================================================================

const causalGraphRouter = Router();
causalGraphRouter.use(requireAuth);
causalGraphRouter.use(withProjectScope());

/**
 * GET /api/causal-graph/links/:eventId
 * Get all affected entities (causal graph links) for a given event primitive.
 * Returns 200 with array of causal graph links.
 */
causalGraphRouter.get("/links/:eventId", asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  const orgId = requireOrgId(orgContext);

  const { eventId } = req.params;

  if (!eventId || eventId.trim().length === 0) {
    return res.status(400).json({ error: "Event ID is required" });
  }

  const event = await signalIngestionService.findEvent(eventId, orgId, req.projectId);
  if (!event) return res.status(404).json({ error: "Signal not found" });

  const links = await causalGraphService.getAffectedEntities(eventId);

  res.json(links);
}));

// ============================================================================
// SIMULATIONS ROUTER
// ============================================================================

const simsRouter = Router();
simsRouter.use(requireAuth);

/**
 * POST /api/simulations/counterfactual
 * Submit a counterfactual simulation with a synthetic event primitive.
 * Validates required fields: eventType, targetSector, jurisdiction, severity.
 * Returns 200 with simulation results, 400 for validation errors, 408 on timeout.
 */
simsRouter.post("/counterfactual", asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  const orgId = requireOrgId(orgContext);

  const { eventType, targetSector, jurisdiction, severity, sourceUrl, rawText } = req.body;

  // Validate required fields
  if (!eventType || typeof eventType !== "string") {
    return res.status(400).json({ error: "eventType is required" });
  }
  if (!targetSector || typeof targetSector !== "string") {
    return res.status(400).json({ error: "targetSector is required" });
  }
  if (!jurisdiction || typeof jurisdiction !== "string") {
    return res.status(400).json({ error: "jurisdiction is required" });
  }
  if (!severity || !severities.includes(severity as Severity)) {
    return res.status(400).json({
      error: `Invalid severity. Must be one of: ${severities.join(", ")}`,
    });
  }

  // Build synthetic event primitive for simulation
  const syntheticEvent = {
    id: crypto.randomUUID(),
    organizationId: orgId,
    projectId: null,
    sourceEntryId: `simulation-${Date.now()}`,
    eventType,
    targetSector,
    jurisdiction,
    severity,
    sourceUrl: sourceUrl || "simulation://counterfactual",
    extractionTimestamp: new Date(),
    confidenceScore: 1.0, // Synthetic events have full confidence
    rawText: rawText || "",
    flags: [] as string[],
    contentHash: `sim-${Date.now()}`,
    // Counterfactual simulations carry no telemetry, so spatial conditions
    // simply do not match rather than matching on stale coordinates.
    latitude: null,
    longitude: null,
    h3Index: null,
    previousH3Index: null,
    dwellMinutes: null,
    velocityKnots: null,
    headingDegrees: null,
    projectedLatitude: null,
    projectedLongitude: null,
    fluxDensityPhi: null,
    cellMetrics: null,
    subjectId: null,
    spatialSource: null,
    spatialPrecisionM: null,
    spatialHdop: null,
    createdAt: new Date(),
  };

  try {
    const result = await worldModelBridgeService.runCounterfactual(syntheticEvent);
    res.json(result);
  } catch (error: any) {
    if (error.message?.includes("timeout")) {
      // Return 408 with partial results if available
      logger.warn(`Counterfactual simulation timeout for org ${orgId}`);
      return res.status(408).json({
        error: "Counterfactual simulation timed out",
        message: "The simulation exceeded the 30-second time limit",
        partialResults: null,
      });
    }
    throw error;
  }
}));

// ============================================================================
// STATE TRANSITIONS ROUTER
// ============================================================================

const transitionsRouter = Router();
transitionsRouter.use(requireAuth);

/**
 * GET /api/state-transitions
 * Get recent state-transition events for the organization.
 * Query params:
 *   - limit: number (default 1000, max 1000)
 * Returns 200 with array of state transition events.
 */
transitionsRouter.get("/", asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  const orgId = requireOrgId(orgContext);

  let limit = 1000;
  if (req.query.limit) {
    const parsed = parseInt(req.query.limit as string, 10);
    if (!isNaN(parsed) && parsed > 0) {
      limit = Math.min(parsed, 1000);
    }
  }

  const transitions = await worldModelBridgeService.getRecentTransitions(orgId, limit);

  res.json(transitions);
}));

// ============================================================================
// CYCLE SIGNAL SUBSCRIPTIONS ROUTER
// ============================================================================

const subscriptionsRouter = Router();
subscriptionsRouter.use(requireAuth);

subscriptionsRouter.get("/", asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  const orgId = requireOrgId(orgContext);
  const cycleId = req.query.cycleId ? Number(req.query.cycleId) : undefined;
  if (cycleId !== undefined && (!Number.isInteger(cycleId) || cycleId <= 0)) {
    return res.status(400).json({ error: "Invalid cycleId" });
  }
  res.json(await cycleSignalSubscriptionService.list(orgId, cycleId));
}));

subscriptionsRouter.post("/", asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  const orgId = requireOrgId(orgContext);
  const cycleId = Number(req.body.cycleId);
  const cycle = await cycleSignalSubscriptionService.getOperationalCycle(cycleId, orgId);
  if (!cycle) return res.status(404).json({ error: "Cycle not found" });
  const deliveryModes = RULE_DELIVERY_MODES;
  const deliveryMode = req.body.deliveryMode ?? "context_only";
  if (!deliveryModes.includes(deliveryMode)) {
    return res.status(400).json({ error: `Invalid deliveryMode. Must be one of: ${deliveryModes.join(", ")}` });
  }
  const created = await cycleSignalSubscriptionService.createSubscription({
    organizationId: orgId,
    cycleId,
    name: String(req.body.name || `${cycle.name} intelligence`),
    enabled: req.body.enabled !== false,
    filters: req.body.filters ?? {},
    deliveryMode,
    stateProjection: req.body.stateProjection ?? { namespace: "external_environment", reducer: "latest" },
    cooldownMinutes: Math.max(0, Number(req.body.cooldownMinutes ?? 0)),
    createdBy: orgContext.userId,
  });
  res.status(201).json(created);
}));

subscriptionsRouter.patch("/:id", asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  const orgId = requireOrgId(orgContext);
  const id = Number(req.params.id);
  if (req.body.deliveryMode !== undefined && !RULE_DELIVERY_MODES.includes(req.body.deliveryMode)) {
    return res.status(400).json({ error: `Invalid deliveryMode. Must be one of: ${RULE_DELIVERY_MODES.join(", ")}` });
  }

  if (req.body.cooldownMinutes !== undefined) {
    const cooldown = Number(req.body.cooldownMinutes);
    if (!Number.isFinite(cooldown) || cooldown < 0) {
      return res.status(400).json({ error: "cooldownMinutes must be a non-negative number" });
    }
  }
  const allowed: Record<string, any> = {};
  for (const key of ["name", "enabled", "filters", "deliveryMode", "stateProjection", "cooldownMinutes"]) {
    if (req.body[key] !== undefined) allowed[key] = req.body[key];
  }
  allowed.updatedAt = new Date();
  const updated = await cycleSignalSubscriptionService.updateSubscription(id, orgId, allowed);
  if (!updated) return res.status(404).json({ error: "Subscription not found" });
  res.json(updated);
}));

subscriptionsRouter.delete("/:id", asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  const orgId = requireOrgId(orgContext);
  const disabled = await cycleSignalSubscriptionService.disableSubscription(Number(req.params.id), orgId);
  if (!disabled) return res.status(404).json({ error: "Subscription not found" });
  res.json({ success: true });
}));

subscriptionsRouter.get("/:cycleId/world-state", asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  const orgId = requireOrgId(orgContext);
  res.json(await cycleSignalSubscriptionService.getWorldState(orgId, Number(req.params.cycleId)));
}));

subscriptionsRouter.get("/:cycleId/deliveries", asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  const orgId = requireOrgId(orgContext);
  res.json(await cycleSignalSubscriptionService.getDeliveries(orgId, Number(req.params.cycleId), Number(req.query.limit ?? 50)));
}));

// ============================================================================
// AUTONOMOUS ACTIONS ROUTER
// ============================================================================

const actionsRouter = Router();
actionsRouter.use(requireAuth);

/**
 * GET /api/autonomous-actions/policies
 * List all autonomous action policies for the organization.
 * Returns 200 with array of policies.
 */
actionsRouter.get("/policies", asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  const orgId = requireOrgId(orgContext);

  const policies = await autonomousActionService.listPolicies(orgId);

  res.json(policies);
}));

/**
 * POST /api/autonomous-actions/policies
 * Create a new autonomous action policy.
 * Validates trigger conditions, action type enum, and approval gate enum.
 * Returns 201 on success, 400 on validation error.
 */
actionsRouter.post("/policies", asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  const orgId = requireOrgId(orgContext);

  const { name, triggerCondition, actionType, approvalGate, enabled } = req.body;

  // Validate required fields
  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return res.status(400).json({ error: "Policy name is required" });
  }

  // Validate trigger condition
  if (!triggerCondition || typeof triggerCondition !== "object") {
    return res.status(400).json({ error: "triggerCondition is required and must be an object" });
  }
  if (!triggerCondition.minSeverity || !severities.includes(triggerCondition.minSeverity)) {
    return res.status(400).json({
      error: `triggerCondition.minSeverity must be one of: ${severities.join(", ")}`,
    });
  }

  // Validate action type
  if (!actionType || !actionTypes.includes(actionType)) {
    return res.status(400).json({
      error: `Invalid actionType. Must be one of: ${actionTypes.join(", ")}`,
    });
  }

  // Validate approval gate
  if (!approvalGate || !approvalGates.includes(approvalGate)) {
    return res.status(400).json({
      error: `Invalid approvalGate. Must be one of: ${approvalGates.join(", ")}`,
    });
  }

  const created = await autonomousActionService.createPolicy(orgId, {
    name: name.trim(),
    triggerCondition,
    actionType,
    approvalGate,
    effectiveApprovalGate: approvalGate,
    volatilityOverride: false,
    enabled: enabled !== false, // default true
  });

  logger.info(`Autonomous action policy created: ${created.id} for org ${orgId}`);
  res.status(201).json(created);
}));

/**
 * GET /api/autonomous-actions/artifacts
 *
 * What the autonomy engine actually produced: RFCs, compliance findings and
 * routing directives, newest first. Optional `?status=` and `?kind=` filters,
 * and `?eventPrimitiveId=` to answer "what did this signal cause?".
 *
 * Without this the artifacts would be write-only, which is the failure the
 * whole exercise was about — an action that leaves a row nobody can find has
 * not really been performed.
 */
actionsRouter.get("/artifacts", asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  const orgId = requireOrgId(orgContext);

  const statuses = ["open", "acknowledged", "resolved", "dismissed"];
  const kinds = ["rfc", "compliance_finding", "routing_directive"];
  const { status, kind, eventPrimitiveId } = req.query;

  if (status && !statuses.includes(String(status))) {
    return res.status(400).json({ error: `Invalid status. Must be one of: ${statuses.join(", ")}` });
  }
  if (kind && !kinds.includes(String(kind))) {
    return res.status(400).json({ error: `Invalid kind. Must be one of: ${kinds.join(", ")}` });
  }

  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));

  const rows = await autonomousActionService.listArtifacts(orgId, {
    status: status ? String(status) : undefined,
    kind: kind ? String(kind) : undefined,
    eventPrimitiveId: eventPrimitiveId ? String(eventPrimitiveId) : undefined,
    limit,
  });

  res.json(rows);
}));

/**
 * PATCH /api/autonomous-actions/artifacts/:id
 * Moves an artifact through its lifecycle: open → acknowledged → resolved,
 * or dismissed. A status an operator cannot move is a status that means nothing.
 */
actionsRouter.patch("/artifacts/:id", asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  const orgId = requireOrgId(orgContext);
  // uuid primary key, so this stays a string
  const id = String(req.params.id || "");
  if (!id) {
    return res.status(400).json({ error: "Invalid artifact ID" });
  }

  const statuses = ["open", "acknowledged", "resolved", "dismissed"];
  const status = req.body?.status;
  if (!statuses.includes(status)) {
    return res.status(400).json({ error: `Invalid status. Must be one of: ${statuses.join(", ")}` });
  }

  const terminal = status === "resolved" || status === "dismissed";
  const updated = await autonomousActionService.updateArtifactStatus(
    id, orgId, status, String(orgContext.userId ?? "operator"), terminal,
  );
  

  if (!updated) return res.status(404).json({ error: "Artifact not found" });
  res.json(updated);
}));

/**
 * POST /api/autonomous-actions/approve/:id
 * Approve a pending autonomous action request.
 * Returns 200 on success, 404 if not found, 409 if already resolved.
 */
actionsRouter.post("/approve/:id", asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  const orgId = requireOrgId(orgContext);
  const id = parseInt(req.params.id, 10);

  if (isNaN(id)) {
    return res.status(400).json({ error: "Invalid action log ID" });
  }

  // Find the pending approval request
  const actionLog = await autonomousActionService.getActionLog(id, orgId);

  if (!actionLog) {
    throw new NotFoundError(
      `Approval request ${id} not found`,
      "NOT_FOUND",
      { actionLogId: id, organizationId: orgId }
    );
  }

  if (actionLog.approvalStatus !== "pending") {
    throw new ConflictError(
      `Approval request ${id} has already been resolved with status: ${actionLog.approvalStatus}`
    );
  }

  // Update to approved
  const updated = await autonomousActionService.approveActionLog(id, orgId);

  logger.info(`Autonomous action ${id} approved for org ${orgId}`);
  res.json(updated);
}));

/**
 * POST /api/autonomous-actions/reject/:id
 * Reject a pending autonomous action request.
 * Returns 200 on success, 404 if not found, 409 if already resolved.
 */
actionsRouter.post("/reject/:id", asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  const orgId = requireOrgId(orgContext);
  const id = parseInt(req.params.id, 10);

  if (isNaN(id)) {
    return res.status(400).json({ error: "Invalid action log ID" });
  }

  // Find the pending approval request
  const actionLog = await autonomousActionService.getActionLog(id, orgId);

  if (!actionLog) {
    throw new NotFoundError(
      `Approval request ${id} not found`,
      "NOT_FOUND",
      { actionLogId: id, organizationId: orgId }
    );
  }

  if (actionLog.approvalStatus !== "pending") {
    throw new ConflictError(
      `Approval request ${id} has already been resolved with status: ${actionLog.approvalStatus}`
    );
  }

  const { reason } = req.body;

  // Update to rejected
  const updated = await autonomousActionService.rejectActionLog(id, orgId, reason);

  logger.info(`Autonomous action ${id} rejected for org ${orgId}`);
  res.json(updated);
}));

// ============================================================================
// EXPORTS
// ============================================================================

export const signalFeedsRouter = feedsRouter;
export const eventPrimitivesRouter = eventsRouter;
export const causalGraphLinksRouter = causalGraphRouter;
export const simulationsRouter = simsRouter;
export const stateTransitionsRouter = transitionsRouter;
export const autonomousActionsRouter = actionsRouter;
export const cycleSignalSubscriptionsRouter = subscriptionsRouter;

export default {
  signalFeedsRouter: feedsRouter,
  eventPrimitivesRouter: eventsRouter,
  causalGraphLinksRouter: causalGraphRouter,
  simulationsRouter: simsRouter,
  stateTransitionsRouter: transitionsRouter,
  autonomousActionsRouter: actionsRouter,
  cycleSignalSubscriptionsRouter: subscriptionsRouter,
};
