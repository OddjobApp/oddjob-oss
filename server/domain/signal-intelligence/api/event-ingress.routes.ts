/**
 * Event Ingress API Routes
 *
 * REST API endpoints for Event Schema Inference, Source Health Monitoring,
 * DLQ Replay, Universal Webhook Ingress, and Interactive JSONPath Schema Mapping.
 */

import { Router, type Request, type Response } from "express";
import { eventIngressService } from "../core/event-ingress.service.js";
import { createLogger } from "@server/utils/logger.js";
import { getUserOrgContext } from "@server/utils/auth-context.js";
import { eventSchemaInferencerService } from "../core/event-schema-inferencer.service.js";
import { eventIngressHealthService } from "../core/event-ingress-health.service.js";
import { eventDlqAutoHealerService } from "../core/event-dlq-auto-healer.service.js";
import { eventJsonPathMapperService, type SignalJsonPathMapping } from "../core/event-jsonpath-mapper.service.js";
import { causalGraphService } from "../core/causal-graph.service.js";
import { worldModelBridgeService } from "../core/world-model-bridge.service.js";

const logger = createLogger("EventIngressRoutes");
const router = Router();

/**
 * POST /api/oddjob/signal/ingress/infer-schema
 * Infers structural JSON Schema from raw payload
 */
router.post("/infer-schema", async (req: Request, res: Response) => {
  try {
    const { rawPayload, title } = req.body;
    if (!rawPayload) {
      return res.status(400).json({ error: "rawPayload is required" });
    }

    const schema = eventSchemaInferencerService.inferSchemaFromPayload(rawPayload, title);
    return res.json(schema);
  } catch (error: any) {
    logger.error(`[EventIngressRoutes] Schema inference failed:`, error.message);
    return res.status(400).json({ error: error.message });
  }
});

/**
 * POST /api/oddjob/signal/ingress/test-mapping
 * Evaluates a JSONPath mapping schema against a sample raw payload without persisting to the database.
 */
router.post("/test-mapping", async (req: Request, res: Response) => {
  try {
    const { rawPayload, mapping } = req.body;
    if (!rawPayload) {
      return res.status(400).json({ error: "rawPayload is required" });
    }

    const outcome = eventJsonPathMapperService.mapPayload(rawPayload, mapping);
    return res.json(outcome);
  } catch (error: any) {
    logger.error(`[EventIngressRoutes] Test mapping failed:`, error.message);
    return res.status(400).json({ error: error.message });
  }
});

/**
 * POST /api/oddjob/signal/ingress/events/:feedId?
 * Universal Webhook & Stream Ingress Endpoint.
 * Ingests external JSON payloads, transforms via JSONPath mapping, derives H3 coordinates,
 * and persists to event_primitives.
 */
router.post("/events/:feedId?", async (req: Request, res: Response) => {
  try {
    const feedIdParam = req.params.feedId ? parseInt(req.params.feedId, 10) : null;

    // The writer's organization comes from its SESSION, never from the request.
    // This used to fall back to an `x-organization-id` header, and to any feed id
    // without a credential — so anyone could write events into any org, and those
    // events fire pipeline triggers. Unauthenticated webhooks need a per-feed
    // signing secret before they can be accepted; until then, sign in.
    let orgId: number | null = null;
    try {
      orgId = (await getUserOrgContext(req)).organizationId ?? null;
    } catch {
      orgId = null;
    }
    if (!orgId || (req as any).user == null) {
      return res.status(401).json({ error: "Sign in to post events. Unauthenticated webhook ingress needs a per-feed signing secret, which is not implemented yet." });
    }

    let feedMapping: SignalJsonPathMapping | undefined;
    let feed: any = null;
    if (feedIdParam && !isNaN(feedIdParam)) {
      const foundFeed = await eventIngressService.findFeedForOrg(feedIdParam, orgId);
      // Another org's feed is indistinguishable from a missing one.
      if (!foundFeed) {
        return res.status(404).json({ error: `Signal feed #${feedIdParam} not found` });
      }
      feed = foundFeed;
      if (foundFeed.authCredentials && typeof foundFeed.authCredentials === "object") {
        feedMapping = (foundFeed.authCredentials as any).mapping || (foundFeed.authCredentials as any).schemaMapping;
      }
    }

    const rawBody = req.body || {};
    const explicitMapping = rawBody.mapping || feedMapping || {};
    const payloadData = rawBody.payload !== undefined ? rawBody.payload : (rawBody.events !== undefined ? rawBody.events : rawBody);

    const items = Array.isArray(payloadData) ? payloadData : [payloadData];
    const MAX_EVENTS_PER_REQUEST = 500;
    if (items.length > MAX_EVENTS_PER_REQUEST) {
      return res.status(413).json({ error: `At most ${MAX_EVENTS_PER_REQUEST} events per request; got ${items.length}.` });
    }
    const insertedEvents: any[] = [];
    const errors: string[] = [];

    for (const item of items) {
      if (!item || typeof item !== "object") continue;

      const outcome = eventJsonPathMapperService.mapPayload(item, explicitMapping);
      if (!outcome.success || !outcome.event) {
        errors.push(...outcome.errors);
        continue;
      }

      const mapped = outcome.event;
      const inserted = await eventIngressService.insertEvent({
        organizationId: orgId,
        sourceEntryId: mapped.sourceEntryId,
        eventType: mapped.eventType,
        targetSector: mapped.targetSector,
        jurisdiction: mapped.jurisdiction,
        severity: mapped.severity,
        sourceUrl: mapped.sourceUrl,
        extractionTimestamp: mapped.extractionTimestamp,
        confidenceScore: mapped.confidenceScore,
        rawText: mapped.rawText,
        flags: mapped.flags,
        contentHash: mapped.contentHash,
        latitude: mapped.latitude,
        longitude: mapped.longitude,
        h3Index: mapped.h3Index,
        subjectId: mapped.subjectId,
        dwellMinutes: mapped.dwellMinutes,
      });

      insertedEvents.push(inserted);

      // Async trigger causal graph mapping if confidence is sufficient
      if (inserted.confidenceScore >= 0.3) {
        try {
          const links = await causalGraphService.mapEventToGraph(inserted);
          await worldModelBridgeService.emitStateTransition(inserted, links);
        } catch (graphErr: any) {
          logger.warn(`[EventIngressRoutes] Causal graph mapping failed for event ${inserted.id}:`, graphErr.message);
        }
      }
    }

    // Update feed polling stats if associated with a feed
    if (feed) {
      await eventIngressService.markFeedDelivered(feed.id);
    }

    return res.status(201).json({
      success: true,
      count: insertedEvents.length,
      events: insertedEvents,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error: any) {
    logger.error(`[EventIngressRoutes] Ingress failed:`, error.message);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/oddjob/signal/ingress/sources/health
 * Retrieves live source health telemetry
 */
router.get("/sources/health", async (_req: Request, res: Response) => {
  try {
    const summary = await eventIngressHealthService.getIngressHealthSummary();
    return res.json(summary);
  } catch (error: any) {
    logger.error(`[EventIngressRoutes] Health query failed:`, error.message);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/oddjob/signal/ingress/dlq/replay
 * Triggers DLQ auto-healing and replay
 */
router.post("/dlq/replay", async (req: Request, res: Response) => {
  try {
    const { maxRetries } = req.body;
    const summary = await eventDlqAutoHealerService.processDlqAutoHealing(maxRetries);
    return res.json(summary);
  } catch (error: any) {
    logger.error(`[EventIngressRoutes] DLQ replay failed:`, error.message);
    return res.status(500).json({ error: error.message });
  }
});

export default router;
