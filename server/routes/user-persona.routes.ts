import { Router, type Request, type Response } from "express";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { getUserOrgContext, requireOrgId } from "@server/utils/auth-context.js";
import { syntheticPersonaService } from "@domain/agents/core/synthetic-persona.service.js";
import { userInterestGraphService } from "@domain/agents/core/user-interest-graph.service.js";
import { theoryOfMindService } from "@domain/agents/core/theory-of-mind.service.js";
import { oceanAssessmentService } from "@domain/agents/core/ocean-assessment.service.js";

const router = Router();
router.use(requireAuth);

/**
 * GET /api/user/persona
 * Returns full synthetic persona, OCEAN profile, and interest graph for current user.
 */
router.get("/persona", asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const orgId = requireOrgId(orgContext);
    const userId = orgContext.userId;

    const [persona, interests, tomRecord, activities] = await Promise.all([
        syntheticPersonaService.getPersona(orgId, userId),
        userInterestGraphService.getTopInterests(orgId, userId, 15),
        theoryOfMindService.getToMState(orgId, userId),
        userInterestGraphService.getRecentActivities(orgId, userId, 10),
    ]);

    res.json({
        persona,
        interests,
        oceanProfile: tomRecord?.oceanProfile ?? null,
        recentActivities: activities,
    });
}));

/**
 * POST /api/user/persona/synthesize
 * Force re-synthesis of synthetic persona.
 */
router.post("/persona/synthesize", asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const orgId = requireOrgId(orgContext);
    const userId = orgContext.userId;

    const persona = await syntheticPersonaService.synthesizePersona(orgId, userId);
    res.json({ success: true, persona });
}));

/**
 * POST /api/user/interests
 * Body: { topic, category?, weight? }
 */
router.post("/interests", asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const orgId = requireOrgId(orgContext);
    const userId = orgContext.userId;

    const { topic, category, weight } = req.body ?? {};
    if (!topic || typeof topic !== "string") {
        return res.status(400).json({ error: "Topic string is required" });
    }

    const record = await userInterestGraphService.reinforceInterest(
        orgId,
        userId,
        topic,
        category || "general",
        weight || 15.0,
        "User added via profile UI"
    );

    // Re-synthesize persona asynchronously
    void syntheticPersonaService.synthesizePersona(orgId, userId);

    res.json({ success: true, interest: record });
}));

export default router;
