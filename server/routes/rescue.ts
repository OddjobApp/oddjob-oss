import { validateIdParam } from "@server/utils/api-utils.js";
import { Router, Request, Response } from "express";
import { rescueService, geocodingService, rescueGeoService, routingService } from "@domain/rescue/index.js";
import { rescueTacticalService } from "@domain/rescue/tactical.service.js";
import { eventStream } from "@domain/core/infrastructure/event-stream.service.js";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { getUserOrgContext } from "../utils/auth-context.js";
import { createLogger } from "@server/utils/logger.js";
import { db } from "@server/database_service.js";
import { sql, eq, or } from "drizzle-orm";
import { rescueSessions } from "@shared/schema/rescue.js";
import { asyncHandler } from "../middleware/error-handler.js";
import { recommendDispatchAction } from "@domain/rescue/core/dispatch-copilot.js";

const logger = createLogger("RescueRouter");
const router = Router();

logger.info("Rescue router loaded");

/**
 * GET /api/rescue/health
 */
router.get("/health", (req, res) => {
    res.json({ ok: true });
});

/**
 * GET /api/rescue/tactical-summary
 * Returns a tactical overview of squads and missions.
 */
router.get("/tactical-summary", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    if (!orgContext.organizationId) throw new Error("Organization context missing");
    const stats = await rescueTacticalService.getTacticalOverview(orgContext.organizationId);
    res.json(stats);
}));

/**
 * GET /api/rescue/sessions
 * List all rescue sessions for the organization.
 */
router.get("/sessions", requireAuth, async (req: any, res) => {
    try {
        // Scope to the org the user is actively viewing. getUserOrgContext honors a
        // super-admin's ?orgId override (the client appends the selected org), so the
        // inbox no longer leaks another org's sessions when the org switcher is set —
        // previously this used req.user.organizationId (the user's *default* org).
        const orgContext = await getUserOrgContext(req);
        const organizationId = orgContext.organizationId;

        const sessions = await db.select()
            .from(rescueSessions)
            .where(
                organizationId ? eq(rescueSessions.organizationId, organizationId) : undefined
            )
            .orderBy(sql`${rescueSessions.createdAt} DESC`);

        res.json(sessions);
    } catch (error) {
        logger.error(`Error listing rescue sessions:`, error);
        res.status(500).json({ error: "Internal server error" });
    }
});

/**
 * GET /api/rescue/geocode
 * Convert address to coordinates.
 */
router.get("/geocode", async (req, res) => {
    try {
        const { address } = req.query;
        if (!address || typeof address !== "string") {
            return res.status(400).json({ error: "Address is required" });
        }

        const result = await geocodingService.geocode(address);
        if (!result) {
            return res.status(404).json({ error: "Address not found" });
        }

        res.json(result);
    } catch (error) {
        logger.error(`Error geocoding address:`, error);
        res.status(500).json({ error: "Internal server error" });
    }
});

/**
 * GET /api/rescue/geocode/suggest
 * Get address suggestions for autocomplete.
 */
router.get("/geocode/suggest", async (req, res) => {
    try {
        const { q } = req.query;
        if (!q || typeof q !== "string") {
            return res.status(400).json({ error: "Query 'q' is required" });
        }

        const suggestions = await geocodingService.suggest(q);
        res.json(suggestions);
    } catch (error) {
        logger.error(`Error fetching geocode suggestions:`, error);
        res.status(500).json({ error: "Internal server error" });
    }
});

/**
 * GET /api/rescue/reverse-geocode
 * Convert coordinates to address.
 */
router.get("/reverse-geocode", async (req, res) => {
    try {
        const { lat, lng } = req.query;
        if (!lat || !lng) {
            return res.status(400).json({ error: "Latitude and Longitude are required" });
        }

        const latitude = parseFloat(lat as string);
        const longitude = parseFloat(lng as string);

        if (isNaN(latitude) || isNaN(longitude)) {
            return res.status(400).json({ error: "Invalid coordinates" });
        }

        const result = await geocodingService.reverseGeocode(latitude, longitude);
        res.json(result);
    } catch (error) {
        logger.error(`Error reverse geocoding:`, error);
        res.status(500).json({ error: "Internal server error" });
    }
});

/**
 * GET /api/rescue/sessions/:id
 * Poll for rescue session status and telemetry.
 */
router.get("/sessions/:id", async (req, res) => {
    try {
        const sessionId = validateIdParam(req.params.id);

        if (isNaN(sessionId)) {
            return res.status(400).json({ error: "Invalid session ID" });
        }

        const session = await rescueService.getSession(sessionId);

        if (!session) {
            return res.status(404).json({ error: "Session not found" });
        }

        // Add dynamic routing data
        let etaSeconds = 0;
        let routePoints: Array<[number, number]> = [];

        if (session.providerLocation && session.status !== 'COMPLETED' && session.status !== 'FAILED') {
            const route = await routingService.calculateRoute(session.providerLocation, session.userLocation);
            if (route) {
                etaSeconds = route.durationMin * 60;
                routePoints = route.points || [];
            } else {
                etaSeconds = rescueGeoService.calculateETA(session.providerLocation, session.userLocation) * 60;
            }
        }

        res.json({
            ...session,
            etaSeconds,
            routePoints,
            verificationCode: session.arrivalHandshakeHash
        });
    } catch (error) {
        logger.error(`Error fetching rescue session ${req.params.id}:`, error);
        res.status(500).json({ error: "Internal server error" });
    }
});

/**
 * GET /api/rescue/sessions/:id/copilot/recommendation
 * Returns an evidence-aware recommendation. It never mutates dispatch state.
 */
router.get("/sessions/:id/copilot/recommendation", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const sessionId = validateIdParam(req.params.id);
    const session = await rescueService.getSession(sessionId);
    if (!session) return res.status(404).json({ error: "Session not found" });

    const orgContext = await getUserOrgContext(req);
    if (orgContext.organizationId && session.organizationId !== orgContext.organizationId) {
        return res.status(404).json({ error: "Session not found" });
    }
    res.json(recommendDispatchAction(session));
}));

/**
 * GET /api/rescue/sessions/:id/risk-field
 *
 * The H3 spatial risk field around an incident, shaped for direct rendering:
 * `hexCells` is exactly the prop RescueMap expects.
 *
 * The hexagonal engine could always compute this — it is exposed to agents as
 * `h3_hexagonal_spatial_evaluate` — but nothing ever drew it, so the output only
 * existed as numbers inside a tool response. This is the same engine call behind
 * an endpoint the map can use.
 *
 * Pure computation: no model call and no external service, so it behaves
 * identically when the AI backend is degraded.
 */
router.get("/sessions/:id/risk-field", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const sessionId = validateIdParam(req.params.id);
    const session = await rescueService.getSession(sessionId);
    if (!session) return res.status(404).json({ error: "Session not found" });

    const orgContext = await getUserOrgContext(req);
    if (orgContext.organizationId && session.organizationId !== orgContext.organizationId) {
        return res.status(404).json({ error: "Session not found" });
    }

    const userLoc = (session.userLocation as any) || {};
    const lat = Number(userLoc.lat);
    const lng = Number(userLoc.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        // No coordinates means no field to draw. An empty set renders as "no
        // overlay", which is correct — better than inventing a location.
        return res.json({ hexCells: [], resolution: null, origin: null });
    }

    // Severity drives the origin cell's flux density. Kept as an explicit map so
    // the shading is traceable to dispatch data rather than a magic constant.
    const severityRisk: Record<string, number> = {
        critical: 0.95,
        high: 0.75,
        medium: 0.5,
        low: 0.25,
    };
    const severity = String(session.severity ?? "").toLowerCase();
    const riskFluxDensity = severityRisk[severity] ?? 0.6;

    const resolution = Math.min(12, Math.max(4, Number(req.query.resolution) || 8));

    const { H3HexagonalSpatialEngineService } = await import("@domain/ai/core/h3-hexagonal-spatial-engine.service.js");
    const engine = new H3HexagonalSpatialEngineService();

    const evaluation = engine.evaluateHexagonalSpatialState(
        `RSC-${String(session.id).padStart(3, "0")}`,
        session.serviceType || "Rescue incident",
        lat,
        lng,
        0, // stationary incident site
        riskFluxDensity,
        resolution,
    );

    const field = evaluation.isotropicFluxField;
    const hexCells = [
        { h3Index: field.originCellH3, risk: field.fluxDensityPhi },
        ...field.neighboringCells.map((cell) => ({
            h3Index: cell.h3Index,
            risk: cell.projectedRisk,
        })),
    ];

    res.json({
        hexCells,
        resolution: evaluation.currentCell.resolution,
        origin: { lat: evaluation.currentCell.centerLat, lng: evaluation.currentCell.centerLng },
    });
}));

/**
 * POST /api/rescue/sessions/:id/transition
 * Applies a human-approved transition through the dispatch policy and audit log.
 */
router.post("/sessions/:id/transition", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const sessionId = validateIdParam(req.params.id);
    const { status, reason, completionEvidence } = req.body || {};
    const validStatuses = new Set([
        "ACTIVE", "REQUESTED", "TRIAGED", "OFFERED", "ACCEPTED", "ENROUTE",
        "ARRIVED", "ASSISTING", "RELAY_ENROUTE", "COMPLETED", "FAILED", "CANCELLED",
    ]);
    if (!validStatuses.has(status)) return res.status(400).json({ error: "Invalid rescue status" });

    const session = await rescueService.getSession(sessionId);
    if (!session) return res.status(404).json({ error: "Session not found" });
    const orgContext = await getUserOrgContext(req);
    if (orgContext.organizationId && session.organizationId !== orgContext.organizationId) {
        return res.status(404).json({ error: "Session not found" });
    }

    await rescueService.updateStatus(sessionId, status, {
        actorId: String((req as any).user?.id || (req as any).userId || "operator"),
        actorType: "user",
        reason,
        completionEvidence,
    });
    res.json({ success: true, sessionId, status });
}));

/**
 * POST /api/rescue/sessions/:id/verify
 * Submit arrival verification code.
 */
router.post("/sessions/:id/verify", async (req, res) => {
    try {
        const sessionId = validateIdParam(req.params.id);
        const { code } = req.body;

        if (isNaN(sessionId) || !code) {
            return res.status(400).json({ error: "Session ID and code are required" });
        }

        const isValid = await rescueService.verifyHandshake(sessionId, code);
        res.json({ success: isValid });
    } catch (error) {
        logger.error(`Error verifying rescue handshake for ${req.params.id}:`, error);
        res.status(500).json({ error: "Internal server error" });
    }
});

/**
 * POST /api/rescue/sessions/:id/cancel
 * Cancel a rescue session.
 */
router.post("/sessions/:id/cancel", async (req, res) => {
    try {
        const sessionId = validateIdParam(req.params.id);
        const { reason } = req.body;

        if (isNaN(sessionId)) {
            return res.status(400).json({ error: "Invalid session ID" });
        }

        await rescueService.cancelRescue(sessionId, reason);
        res.json({ success: true });
    } catch (error: any) {
        logger.error(`Error cancelling rescue session ${req.params.id}:`, error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
});

/**
 * POST /api/rescue/demo/simulate
 * Trigger a full dispatch simulation with seeded providers.
 * Seeds fake providers near the given location, creates a rescue session,
 * and runs the full lifecycle animation (assignment → movement → arrival → completion).
 */
router.post("/demo/simulate", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    if (!orgContext.organizationId) throw new Error("Organization context required");

    const { lat, lng, serviceType } = req.body as { lat?: number; lng?: number; serviceType?: string };
    const userLat = lat || 34.0522; // Default: Los Angeles
    const userLng = lng || -118.2437;

    const result = await rescueGeoService.runFullDemoSimulation({
        orgId: orgContext.organizationId,
        userLat,
        userLng,
        serviceType: serviceType || "roadside-assistance",
    });

    res.json({
        success: true,
        message: `Demo simulation started. ${result.providersSeeded.length} providers seeded, session ${result.sessionId} created.`,
        sessionId: result.sessionId,
        trackingUrl: `/r/demo-${result.sessionId}`,
        providersSeeded: result.providersSeeded.length,
    });
}));

/**
 * GET /api/rescue/resolve-token/:token
 * Resolve a public rescue token to a session ID (for public tracking page).
 */
router.get("/resolve-token/:token", async (req, res) => {
    try {
        const { token } = req.params;
        if (!token) {
            return res.status(400).json({ error: "Token is required" });
        }

        const numId = parseInt(token.replace(/^demo-/, ''), 10);
        let session;
        if (!isNaN(numId)) {
            [session] = await db.select({ id: rescueSessions.id, status: rescueSessions.status })
                .from(rescueSessions)
                .where(or(eq(rescueSessions.publicToken, token), eq(rescueSessions.id, numId)))
                .limit(1);
        } else {
            [session] = await db.select({ id: rescueSessions.id, status: rescueSessions.status })
                .from(rescueSessions)
                .where(eq(rescueSessions.publicToken, token))
                .limit(1);
        }

        if (!session) {
            return res.status(404).json({ error: "Invalid or expired token" });
        }

        res.json({ sessionId: session.id, status: session.status });
    } catch (error) {
        logger.error(`Error resolving rescue token:`, error);
        res.status(500).json({ error: "Internal server error" });
    }
});

/**
 * GET /api/rescue/sessions/:id/stream
 * Real-time event stream for a specific rescue session.
 */
router.get("/sessions/:id/stream", async (req, res) => {
    const sessionId = validateIdParam(req.params.id);
    if (isNaN(sessionId)) return res.status(400).end();

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const listener = (event: any) => {
        if (event.payload?.sessionId === sessionId || event.context?.sessionId === sessionId) {
            res.write(`data: ${JSON.stringify(event)}\n\n`);
        }
    };

    eventStream.on("*", listener);

    const heartbeat = setInterval(() => {
        res.write(': heartbeat\n\n');
    }, 30000);

    req.on('close', () => {
        eventStream.off("*", listener);
        clearInterval(heartbeat);
    });
});

/**
 * POST /api/rescue/sessions/:id/recovery/:optionId
 * Apply a triage recovery option. Routes to governor, blackboard, or status change.
 */
router.post("/sessions/:id/recovery/:optionId", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const sessionId = validateIdParam(req.params.id);
    const optionId = req.params.optionId;
    const actorId = (req as any).userId || (req as any).user?.id;

    const result = await rescueService.applyRecoveryOption(sessionId, optionId, actorId);
    if (!result.success) {
        return res.status(400).json(result);
    }
    res.json(result);
}));

export const rescueRouter = router;

