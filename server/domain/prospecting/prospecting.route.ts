import { Router, type Request, type Response } from "express";
import { createLogger } from "@server/utils/logger.js";
import { enforcePrivacy } from "../../middleware/privacy.js";
import { propertyIngestGuard, invalidatePropertyCache } from "./ingest-guard.js";
import { prospectingService } from "./prospecting.service.js";
import { requireAuth } from "../auth/core/security.service.js";
import { getUserOrgContext } from "../../utils/auth-context.js";
import { asyncHandler } from "../../middleware/error-handler.js"; // Standard Oddjob middleware

const logger = createLogger("ProspectingRouter");
const router = Router();

/**
 * JS Harness Event Ingestion
 * POST /api/prospecting/events
 */
router.post("/events", enforcePrivacy, propertyIngestGuard({ perMinute: 600 }), asyncHandler(async (req: Request, res: Response) => {
    const events = Array.isArray(req.body) ? req.body : [req.body];

    if (events.length === 0) {
        return res.status(400).json({ error: "Empty payload" });
    }

    const clientIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || req.ip;
    let originalIp: string = "127.0.0.1";

    if (Array.isArray(clientIp)) {
        originalIp = clientIp[0];
    } else if (typeof clientIp === 'string') {
        originalIp = clientIp.split(',')[0].trim();
    }

    const result = await prospectingService.enqueueBatchedEvents(events, req.cookies?.oj_prospect_id, originalIp);

    if (result.count === 0) {
        return res.status(202).json({ status: "accepted" });
    }

    res.cookie("oj_prospect_id", result.mainProspectUid, { maxAge: 365 * 24 * 60 * 60 * 1000, httpOnly: true });

    res.status(202).json({
        status: "accepted",
        prospectUid: result.mainProspectUid
    });
}));

/**
 * Identify an anonymous visitor (Identity Bridge)
 * POST /api/prospecting/identify
 */
router.post("/identify", propertyIngestGuard({ perMinute: 120 }), asyncHandler(async (req: Request, res: Response) => {
    const { propertyUid, prospectUid, userId, email, metadata } = req.body;

    if (!propertyUid || !prospectUid || !userId) {
        return res.status(400).json({ error: "Missing required identification fields" });
    }

    const result = await prospectingService.identify({
        propertyUid,
        prospectUid,
        userId,
        email,
        metadata
    });

    res.cookie("oj_prospect_id", result.masterUid, { maxAge: 365 * 24 * 60 * 60 * 1000, httpOnly: true });
    res.json({ success: true, message: "Prospect identified and merged", masterUid: result.masterUid });
}));

/**
 * Opt-out of tracking
 * POST /api/prospecting/opt-out
 */
router.post("/opt-out", (req, res) => {
    res.cookie("oj_opt_out", "true", { maxAge: 365 * 24 * 60 * 60 * 1000, httpOnly: false });
    res.json({ success: true, message: "Opt-out preference stored" });
});

/**
 * Poll for pending interventions (Co-pilot delivery endpoint)
 * GET /api/prospecting/interventions/poll?propertyUid=X&prospectUid=Y
 * 
 * The JS harness calls this after flushing events to check if the async
 * worker has produced an intervention (stored in Redis with 5-min TTL).
 * On retrieval, the intervention is deleted (consume-once semantics).
 */
router.get("/interventions/poll", asyncHandler(async (req: Request, res: Response) => {
    const { propertyUid, prospectUid } = req.query as { propertyUid?: string; prospectUid?: string };

    if (!propertyUid || !prospectUid) {
        return res.status(400).json({ error: "propertyUid and prospectUid are required" });
    }

    try {
        const { redis } = await import("@domain/core/infrastructure/redis/redis-client.js");
        const interventionKey = `prospect_intervention:${propertyUid}:${prospectUid}`;
        const cached = await redis.get(interventionKey);

        if (!cached) {
            return res.json({ intervention: null });
        }

        // Consume-once: delete after retrieval so it doesn't fire again
        await redis.del(interventionKey);

        const intervention = JSON.parse(cached);
        res.json({ intervention });
    } catch (err: any) {
        logger.warn("Intervention poll failed (non-blocking)", err);
        res.json({ intervention: null });
    }
}));

/**
 * Live co-pilot chat (P1 handoff)
 * POST /api/prospecting/copilot/chat
 * Public (visitor-initiated). Body: { propertyUid, prospectUid, messages[], agentPrompt? }
 */
router.post("/copilot/chat", enforcePrivacy, propertyIngestGuard({ perMinute: 120 }), asyncHandler(async (req: Request, res: Response) => {
    const { propertyUid, prospectUid, messages, agentPrompt } = req.body || {};
    if (!propertyUid || !prospectUid) {
        return res.status(400).json({ error: "propertyUid and prospectUid are required" });
    }
    const result = await prospectingService.copilotChat({
        propertyUid,
        prospectUid,
        messages: Array.isArray(messages) ? messages : [],
        agentPrompt,
    });
    res.json(result);
}));

// ==========================================
// DASHBOARD APIs (Multi-Property Management)
// ==========================================

// Enrichment provider status (for the dashboard de-anonymization hint)
router.get("/enrichment-status", requireAuth, asyncHandler(async (_req: Request, res: Response) => {
    res.json(await prospectingService.getEnrichmentStatus());
}));

// Ensure all dashboard routes under this require authentication
router.use("/properties", requireAuth);

router.get("/properties", asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req as any);
    const properties = await prospectingService.getProperties(orgContext.organizationId as number);
    res.json(properties);
}));

router.post("/properties", asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req as any);
    const property = await prospectingService.createProperty(orgContext.organizationId as number, req.body);
    res.json(property);
}));

router.put("/properties/:id", asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req as any);
    const property = await prospectingService.updateProperty(orgContext.organizationId as number, parseInt(req.params.id), req.body);
    if (property?.uid) invalidatePropertyCache(property.uid); // domain change → refresh allowlist now
    res.json(property);
}));

router.delete("/properties/:id", asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req as any);
    await prospectingService.deleteProperty(orgContext.organizationId as number, parseInt(req.params.id));
    res.json({ success: true });
}));

router.get("/properties/:id/leads", asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req as any);
    const leads = await prospectingService.getLeadsByProperty(orgContext.organizationId as number, parseInt(req.params.id));
    res.json(leads);
}));

router.get("/leads/:leadId/events", asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req as any);
    const events = await prospectingService.getEventsByLead(orgContext.organizationId as number, parseInt(req.params.leadId, 10));

    if (!events) return res.status(404).json({ error: "Lead not found" });
    res.json(events);
}));

export const prospectingRouter = router;


