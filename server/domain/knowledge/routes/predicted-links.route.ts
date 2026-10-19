import { Router, type Request, type Response } from "express";
// requireOrgId, because OrgContext.organizationId is `number | null` while
// every use below is a tenant filter or a service that requires a real org. A
// null would otherwise widen these queries past their organization.
import { getUserOrgContext, requireOrgId } from "@server/utils/auth-context.js";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { linkPredictorService } from "../core/prediction/link-predictor.service.js";
import { parseLinkPredictionReview, parseLinkPredictionStatus } from "../core/prediction/link-prediction-input.js";

const router = Router();

/**
 * GET /api/knowledge/predictions/links
 * Returns predicted links for the organization filtered by status.
 */
router.get("/links", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const status = parseLinkPredictionStatus(req.query.status);
    const links = await linkPredictorService.listPredictions(requireOrgId(orgContext), status);

    res.json({
        success: true,
        count: links.length,
        predictions: links
    });
}));

/**
 * POST /api/knowledge/predictions/run
 * Triggers a manual TransE link prediction run.
 */
router.post("/run", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const result = await linkPredictorService.runPrediction(requireOrgId(orgContext));

    res.json({
        success: true,
        metadata: result.metadata,
        count: result.predictions.length,
        predictions: result.predictions
    });
}));

/**
 * POST /api/knowledge/predictions/links/:id/review
 * Promotes an approved predicted link to a verified knowledge edge or marks it rejected.
 */
router.post("/links/:id/review", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const { linkId, action } = parseLinkPredictionReview(req.params.id, req.body);
    const reviewed = await linkPredictorService.reviewPrediction({
        predictionId: linkId,
        organizationId: requireOrgId(orgContext),
        reviewerId: req.user?.id ?? "supervisor",
        action,
    });
    if (!reviewed) {
        res.status(404).json({ error: "Predicted link not found" });
        return;
    }
    const newStatus = action === "approve" ? "approved" : "rejected";

    res.json({
        success: true,
        linkId,
        status: newStatus
    });
}));

export default router;
