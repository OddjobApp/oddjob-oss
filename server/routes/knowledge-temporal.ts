import { Router, type Request, type Response } from "express";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { getUserOrgContext } from "../utils/auth-context.js";
import { createLogger } from "@server/utils/logger.js";
import { temporalVersionStoreService } from "../domain/knowledge/core/temporal/temporal-version-store.service.js";
import {
    beliefPropagationEngine,
    isCounterfactualError,
    type CreateCausalEdgeParams,
    type CounterfactualQuery,
} from "../domain/knowledge/core/causal/belief-propagation-engine.service.js";
import { linkPredictorService } from "../domain/knowledge/core/prediction/link-predictor.service.js";
import { customOntologyStoreService } from "../domain/knowledge/core/ontology/custom-ontology-store.service.js";
import { ontologyMigrationService } from "../domain/knowledge/core/ontology/ontology-migration.service.js";
import { db } from "@server/database_service.js";
import { knowledgePredictedLinks } from "@shared/schema/index.js";
import { eq, and, desc } from "drizzle-orm";

const logger = createLogger("KnowledgeTemporalRouter");
const router = Router();

router.use(["/knowledge", "/ontology"], requireAuth);

// ─── Temporal Routes ─────────────────────────────────────────────────────────

/**
 * GET /api/knowledge/nodes/:id/history
 * Get node version history (range query).
 * Query params: from (ISO timestamp), to (ISO timestamp)
 */
router.get("/knowledge/nodes/:id/history", asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    if (!orgContext.organizationId) {
        return res.status(401).json({ error: "Organization context missing" });
    }

    const nodeId = parseInt(req.params.id, 10);
    if (isNaN(nodeId)) {
        return res.status(400).json({ error: "Invalid node ID" });
    }

    const fromStr = req.query.from as string | undefined;
    const toStr = req.query.to as string | undefined;

    if (!fromStr || !toStr) {
        return res.status(400).json({ error: "Missing required query params: from, to (ISO timestamps)" });
    }

    const from = new Date(fromStr);
    const to = new Date(toStr);

    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
        return res.status(400).json({ error: "Invalid timestamp format. Use ISO 8601." });
    }

    const versions = await temporalVersionStoreService.getNodeVersionRange(nodeId, from, to);
    res.json({ versions });
}));

/**
 * GET /api/knowledge/nodes/:id/at/:timestamp
 * Get node state at a specific point in time.
 */
router.get("/knowledge/nodes/:id/at/:timestamp", asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    if (!orgContext.organizationId) {
        return res.status(401).json({ error: "Organization context missing" });
    }

    const nodeId = parseInt(req.params.id, 10);
    if (isNaN(nodeId)) {
        return res.status(400).json({ error: "Invalid node ID" });
    }

    const timestamp = new Date(req.params.timestamp);
    if (isNaN(timestamp.getTime())) {
        return res.status(400).json({ error: "Invalid timestamp format. Use ISO 8601." });
    }

    const result = await temporalVersionStoreService.getNodeAtTimestamp(nodeId, timestamp);

    if (!result.found) {
        return res.status(404).json({ error: "No history available for this node at the specified timestamp" });
    }

    res.json({ state: result.state, version: result.version });
}));

/**
 * GET /api/knowledge/edges/diff
 * Get edge diff between two timestamps.
 * Query params: from (ISO timestamp), to (ISO timestamp), cursor (optional)
 */
router.get("/knowledge/edges/diff", asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    if (!orgContext.organizationId) {
        return res.status(401).json({ error: "Organization context missing" });
    }

    const fromStr = req.query.from as string | undefined;
    const toStr = req.query.to as string | undefined;
    const cursor = req.query.cursor as string | undefined;

    if (!fromStr || !toStr) {
        return res.status(400).json({ error: "Missing required query params: from, to (ISO timestamps)" });
    }

    const from = new Date(fromStr);
    const to = new Date(toStr);

    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
        return res.status(400).json({ error: "Invalid timestamp format. Use ISO 8601." });
    }

    const result = await temporalVersionStoreService.getEdgeDiff(
        orgContext.organizationId,
        from,
        to,
        cursor,
    );

    res.json(result);
}));

// ─── Causal Routes ───────────────────────────────────────────────────────────

/**
 * POST /api/knowledge/causal-edges
 * Create a causal edge between two knowledge nodes.
 */
router.post("/knowledge/causal-edges", asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    if (!orgContext.organizationId) {
        return res.status(401).json({ error: "Organization context missing" });
    }

    const { sourceNodeId, targetNodeId, causalStrength, propagationDirection, lagDurationSeconds } = req.body;

    if (sourceNodeId == null || targetNodeId == null) {
        return res.status(400).json({ error: "Missing required fields: sourceNodeId, targetNodeId" });
    }

    if (causalStrength == null || typeof causalStrength !== "number" || causalStrength < 0 || causalStrength > 1) {
        return res.status(400).json({ error: "causalStrength must be a number between 0.0 and 1.0" });
    }

    if (!propagationDirection || !["forward", "backward"].includes(propagationDirection)) {
        return res.status(400).json({ error: "propagationDirection must be 'forward' or 'backward'" });
    }

    if (lagDurationSeconds == null || typeof lagDurationSeconds !== "number" || lagDurationSeconds < 0 || lagDurationSeconds > 86400) {
        return res.status(400).json({ error: "lagDurationSeconds must be a number between 0 and 86400" });
    }

    const params: CreateCausalEdgeParams = {
        sourceNodeId,
        targetNodeId,
        organizationId: orgContext.organizationId,
        causalStrength,
        propagationDirection,
        lagDurationSeconds,
    };

    const result = await beliefPropagationEngine.createCausalEdge(params);

    if (!result.success) {
        return res.status(400).json({ error: result.error });
    }

    res.status(201).json({ edge: result.edge });
}));

/**
 * POST /api/knowledge/counterfactual
 * Run a counterfactual query ("what if" scenario).
 */
router.post("/knowledge/counterfactual", asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    if (!orgContext.organizationId) {
        return res.status(401).json({ error: "Organization context missing" });
    }

    const { targetNodeId, hypotheticalState, maxHops } = req.body;

    if (targetNodeId == null) {
        return res.status(400).json({ error: "Missing required field: targetNodeId" });
    }

    if (!hypotheticalState || typeof hypotheticalState !== "object") {
        return res.status(400).json({ error: "Missing or invalid field: hypotheticalState (must be an object)" });
    }

    const query: CounterfactualQuery = {
        targetNodeId,
        hypotheticalState,
        organizationId: orgContext.organizationId,
        maxHops: maxHops != null ? Math.min(Math.max(1, maxHops), 10) : undefined,
    };

    const result = await beliefPropagationEngine.counterfactual(query);

    if (isCounterfactualError(result)) {
        return res.status(404).json({ error: result.error });
    }

    res.json(result);
}));

// ─── Link Prediction Routes ─────────────────────────────────────────────────

/**
 * POST /api/knowledge/predictions/run
 * Trigger link prediction for the organization.
 */
router.post("/knowledge/predictions/run", asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    if (!orgContext.organizationId) {
        return res.status(401).json({ error: "Organization context missing" });
    }

    const { confidenceThreshold, maxResults } = req.body || {};

    const result = await linkPredictorService.runPrediction(orgContext.organizationId, {
        confidenceThreshold,
        maxResults,
    });

    res.json(result);
}));

/**
 * GET /api/knowledge/predictions
 * List predicted links for the organization.
 * Query params: status (optional, default "predicted")
 */
router.get("/knowledge/predictions", asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    if (!orgContext.organizationId) {
        return res.status(401).json({ error: "Organization context missing" });
    }

    const status = (req.query.status as string) || "predicted";

    const predictions = await db
        .select()
        .from(knowledgePredictedLinks)
        .where(
            and(
                eq(knowledgePredictedLinks.organizationId, orgContext.organizationId),
                eq(knowledgePredictedLinks.status, status),
            ),
        )
        .orderBy(desc(knowledgePredictedLinks.createdAt));

    res.json({ predictions });
}));

/**
 * POST /api/knowledge/predictions/:id/approve
 * Approve a predicted link (promotes to verified edge).
 */
router.post("/knowledge/predictions/:id/approve", asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    if (!orgContext.organizationId) {
        return res.status(401).json({ error: "Organization context missing" });
    }

    const predictionId = parseInt(req.params.id, 10);
    if (isNaN(predictionId)) {
        return res.status(400).json({ error: "Invalid prediction ID" });
    }

    const reviewerId = (req as any).user?.id || (req as any).user?.username || "unknown";

    try {
        const edge = await linkPredictorService.approvePrediction(predictionId, reviewerId);
        res.json({ edge });
    } catch (error: any) {
        if (error.message?.includes("not found") || error.message?.includes("Not found")) {
            return res.status(404).json({ error: "Prediction not found" });
        }
        throw error;
    }
}));

/**
 * POST /api/knowledge/predictions/:id/reject
 * Reject a predicted link.
 */
router.post("/knowledge/predictions/:id/reject", asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    if (!orgContext.organizationId) {
        return res.status(401).json({ error: "Organization context missing" });
    }

    const predictionId = parseInt(req.params.id, 10);
    if (isNaN(predictionId)) {
        return res.status(400).json({ error: "Invalid prediction ID" });
    }

    const reviewerId = (req as any).user?.id || (req as any).user?.username || "unknown";

    try {
        await linkPredictorService.rejectPrediction(predictionId, reviewerId);
        res.json({ success: true });
    } catch (error: any) {
        if (error.message?.includes("not found") || error.message?.includes("Not found")) {
            return res.status(404).json({ error: "Prediction not found" });
        }
        throw error;
    }
}));

// ─── Ontology Version Routes ─────────────────────────────────────────────────

/**
 * GET /api/ontology/types/:id/versions
 * Get ontology type version history.
 */
router.get("/ontology/types/:id/versions", asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    if (!orgContext.organizationId) {
        return res.status(401).json({ error: "Organization context missing" });
    }

    const typeId = parseInt(req.params.id, 10);
    if (isNaN(typeId)) {
        return res.status(400).json({ error: "Invalid type ID" });
    }

    const versions = await customOntologyStoreService.getVersionHistory(typeId, orgContext.organizationId);
    res.json({ versions });
}));

/**
 * POST /api/ontology/types/:id/migrate
 * Run a schema migration on an ontology type.
 * Body: { action: "addProperty" | "removeProperty" | "changePropertyType", propertyName, propertySchema?, newType? }
 */
router.post("/ontology/types/:id/migrate", asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    if (!orgContext.organizationId) {
        return res.status(401).json({ error: "Organization context missing" });
    }

    const typeId = parseInt(req.params.id, 10);
    if (isNaN(typeId)) {
        return res.status(400).json({ error: "Invalid type ID" });
    }

    const { action, propertyName, propertySchema, newType } = req.body;
    const actorId = (req as any).user?.id || (req as any).user?.username || "unknown";

    if (!action || !["addProperty", "removeProperty", "changePropertyType"].includes(action)) {
        return res.status(400).json({
            error: "Missing or invalid action. Must be 'addProperty', 'removeProperty', or 'changePropertyType'",
        });
    }

    if (!propertyName || typeof propertyName !== "string") {
        return res.status(400).json({ error: "Missing or invalid propertyName" });
    }

    try {
        switch (action) {
            case "addProperty": {
                if (!propertySchema) {
                    return res.status(400).json({ error: "propertySchema is required for addProperty" });
                }
                await ontologyMigrationService.addProperty(typeId, propertyName, propertySchema, actorId);
                return res.json({ success: true, action: "addProperty", propertyName });
            }
            case "removeProperty": {
                await ontologyMigrationService.removeProperty(typeId, propertyName, actorId);
                return res.json({ success: true, action: "removeProperty", propertyName });
            }
            case "changePropertyType": {
                if (!newType || typeof newType !== "string") {
                    return res.status(400).json({ error: "newType is required for changePropertyType" });
                }
                const result = await ontologyMigrationService.changePropertyType(typeId, propertyName, newType, actorId);
                return res.json({ ...result, action: "changePropertyType", propertyName, newType });
            }
            default:
                return res.status(400).json({ error: "Unknown action" });
        }
    } catch (error: any) {
        if (error.message?.includes("not found")) {
            return res.status(404).json({ error: error.message });
        }
        throw error;
    }
}));

export default router;
