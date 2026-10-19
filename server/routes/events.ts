import { validateIdParam } from "@server/utils/api-utils.js";
import { Router, type Request, type Response } from "express";
import { eventStream } from "@domain/core/infrastructure/event-stream.service.js";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { getUserOrgContext } from "../utils/auth-context.js";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { BadRequestError, NotFoundError, ForbiddenError } from "@server/utils/errors.js";
import { createLogger } from "@server/utils/logger.js";
import { compileEventTypeFilter, isEventVisibleTo, type StreamViewer } from "@domain/core/infrastructure/event-visibility.js";

const router = Router();
const logger = createLogger('EventsRoute');

import { podRegistry } from "@domain/core/infrastructure/pod-registry.service.js";

// GET /api/events/pods - List registered domain pods
router.get("/pods", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    res.json(podRegistry.getPodMetadata());
}));

/**
 * The recent buffer filtered to what this viewer may see, newest first.
 * The buffer is shared by every tenant, so filter before applying the limit.
 */
function visibleRecentEvents(viewer: StreamViewer, typeFilter: string | undefined, source: string | undefined, limit: number) {
    const matchesType = compileEventTypeFilter(typeFilter);
    return eventStream.getRecentEvents(undefined, source, Number.MAX_SAFE_INTEGER)
        .filter((e) => (!matchesType || matchesType(e.eventType)) && isEventVisibleTo(e, viewer))
        .slice(0, limit);
}

// GET /api/events/stream - Server-Sent Events stream
router.get("/stream", requireAuth, async (req: Request, res: Response) => {
    // Resolve the org before the stream opens: `getUserOrgContext` honours
    // `?organizationId=` only for members, and throws for anyone else.
    let viewer: StreamViewer;
    try {
        const ctx = await getUserOrgContext(req);
        viewer = { userId: String(ctx.userId), organizationId: ctx.organizationId };
    } catch (err) {
        const status = err instanceof ForbiddenError ? 403 : 500;
        res.status(status).json({ error: status === 403 ? "Forbidden" : "Could not resolve organization" });
        return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const typeFilter = req.query.type as string | undefined;
    const matchesType = compileEventTypeFilter(typeFilter);

    logger.info(`[EventsRoute] SSE client connected: ${viewer.userId} (type=${typeFilter ?? '*'}, org=${viewer.organizationId ?? 'none'})`);

    // Replay recent buffer so the client catches up on connect
    for (const e of visibleRecentEvents(viewer, typeFilter, undefined, 100).reverse()) {
        res.write(`data: ${JSON.stringify(e)}\n\n`);
    }

    const listener = (event: any) => {
        if (matchesType && !matchesType(event.eventType)) return;
        if (!isEventVisibleTo(event, viewer)) return;
        res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    eventStream.on("*", listener);

    // Heartbeat every 25s to keep connection alive through proxies/load balancers
    const heartbeat = setInterval(() => {
        res.write(': heartbeat\n\n');
    }, 25000);

    req.on('close', () => {
        logger.info(`[EventsRoute] SSE client disconnected: ${viewer.userId}`);
        eventStream.off("*", listener);
        clearInterval(heartbeat);
    });
});

// GET /api/events - List historical events
router.get("/", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { organizationId, isSuperAdmin } = await getUserOrgContext(req);
    const { type, source, search, limit, offset, since, until } = req.query;

    const filter: any = {
        limit: limit ? parseInt(String(limit)) : 100,
        offset: offset ? parseInt(String(offset)) : 0,
        search: search as string,
        organizationId: isSuperAdmin ? undefined : (organizationId || undefined), // If superadmin, show all (or technically filtered by org if provided in query, but logic here defaults to user's org)
    };

    // If super admin wants to see specific org
    if (isSuperAdmin && req.query.organizationId) {
        filter.organizationId = parseInt(String(req.query.organizationId));
    }

    if (type) filter.types = [String(type)];
    if (source) filter.sources = [String(source)];
    if (since) filter.since = new Date(String(since));
    if (until) filter.until = new Date(String(until));

    const events = await eventStream.queryEvents(filter);
    res.json(events);
}));


// GET /api/events/live - Get recent live events (buffer)
router.get("/live", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { type, source, limit } = req.query;
    const ctx = await getUserOrgContext(req);

    res.json(visibleRecentEvents(
        { userId: String(ctx.userId), organizationId: ctx.organizationId },
        type as string | undefined,
        source as string | undefined,
        limit ? parseInt(String(limit)) : 50,
    ));
}));

// GET /api/events/stats - Get event statistics
router.get("/stats", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { organizationId, isSuperAdmin } = await getUserOrgContext(req);
    const days = req.query.days ? parseInt(String(req.query.days)) : 7;

    // Determine target org ID (admin can see global or specific, user sees own)
    let targetOrgId = organizationId || undefined;
    if (isSuperAdmin && req.query.organizationId) {
        targetOrgId = parseInt(String(req.query.organizationId));
    } else if (isSuperAdmin && !req.query.organizationId) {
        targetOrgId = undefined; // Global stats
    }

    const stats = await eventStream.getEventStats(days, targetOrgId);
    res.json(stats);
}));

// GET /api/events/types - Get distinct event types
router.get("/types", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { organizationId, isSuperAdmin } = await getUserOrgContext(req);
    const targetOrgId = isSuperAdmin ? undefined : (organizationId || undefined);

    const types = await eventStream.getEventTypes(targetOrgId);
    res.json(types);
}));

// GET /api/events/sources - Get distinct event sources
router.get("/sources", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { organizationId, isSuperAdmin } = await getUserOrgContext(req);
    const targetOrgId = isSuperAdmin ? undefined : (organizationId || undefined);

    const sources = await eventStream.getEventSources(targetOrgId);
    res.json(sources);
}));

// POST /api/events/emit - Emit a custom event (Internal/Admin only or protected)
router.post("/emit", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { organizationId } = await getUserOrgContext(req);
    const { type, payload, source, context } = req.body;

    if (!type || !payload) {
        throw new BadRequestError("Type and payload are required");
    }

    const eventId = await eventStream.publish(type, payload, {
        ...context,
        organizationId: organizationId || context?.organizationId,
        userId: (req.session as any)?.userId
    }, source || "api");

    res.status(201).json({ eventId, message: "Event emitted" });
}));

// GET /api/events/:eventId/outcomes - Get pipeline trigger outcomes for an event
router.get("/:eventId/outcomes", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { eventId } = req.params;
    const { pipelineTriggerLogs, pipelines } = await import("@shared/schema/index.js");
    const { eq, and, desc } = await import("drizzle-orm");
    const { db } = await import("@server/database_service.js");

    const outcomes = await db
        .select({
            log: pipelineTriggerLogs,
            pipelineName: pipelines.name
        })
        .from(pipelineTriggerLogs)
        .leftJoin(pipelines, eq(pipelineTriggerLogs.pipelineId, pipelines.id))
        .where(eq(pipelineTriggerLogs.eventId, eventId))
        .orderBy(desc(pipelineTriggerLogs.createdAt));

    res.json(outcomes);
}));

// POST /api/events/replay - Replay events
router.post("/replay", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { isSuperAdmin } = await getUserOrgContext(req);

    if (!isSuperAdmin) {
        throw new ForbiddenError("Only admins can replay events");
    }

    const { type, since, until, emitLocal } = req.body;

    const count = await eventStream.replayEvents({
        types: type ? [type] : undefined,
        since: since ? new Date(since) : undefined,
        until: until ? new Date(until) : undefined,
    }, emitLocal !== false);

    res.json({ message: `Replayed ${count} events` });
}));

// =============================================================================
// WEBHOOK SUBSCRIPTIONS
// =============================================================================

// GET /api/events/subscriptions
router.get("/subscriptions", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { organizationId, isSuperAdmin } = await getUserOrgContext(req);
    const targetOrgId = isSuperAdmin ? undefined : (organizationId || undefined);

    const subscriptions = await eventStream.listSubscriptions(targetOrgId);
    res.json(subscriptions);
}));

// POST /api/events/subscriptions
router.post("/subscriptions", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { organizationId } = await getUserOrgContext(req);

    const sub = await eventStream.createSubscription({
        ...req.body,
        organizationId,
        createdBy: String((req.session as any)?.userId),
    });

    res.status(201).json(sub);
}));

// GET /api/events/subscriptions/:id/history
router.get("/subscriptions/:id/history", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const id = validateIdParam(req.params.id);
    if (isNaN(id)) throw new BadRequestError("Invalid ID");

    // We should probably check ownership here, but for now delegating simple list
    // In a real app, we'd fetch the subscription first to verify org ownership
    const history = await eventStream.getDeliveryHistory(id);
    res.json(history);
}));

export function registerEventRoutes(app: any) {
    app.use("/api/events", router);
}

