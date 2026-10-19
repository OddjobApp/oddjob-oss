import { Router, type Request, type Response } from "express";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { BadRequestError } from "@server/utils/errors.js";
import { getUserOrgContext } from "@server/utils/auth-context.js";
import { upsertAppReviewSchema } from "@shared/schema/app-reviews.js";
import { appReviewsService } from "./core/app-reviews.service.js";

const router = Router();

function appIdOf(req: Request): number {
    const id = Number.parseInt(req.params.appId, 10);
    if (!Number.isInteger(id) || id <= 0) throw new BadRequestError("Invalid app id");
    return id;
}

/** Reviews of one listing, plus whether the caller may write one. */
router.get("/:appId/reviews", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const appId = appIdOf(req);
    const userId = String((req as any).user.id);
    const org = await getUserOrgContext(req);
    const [reviews, summaries, canReview] = await Promise.all([
        appReviewsService.list(appId, userId, org.organizationId),
        appReviewsService.summaries([appId]),
        appReviewsService.canReview(appId, userId, org.organizationId),
    ]);
    res.json({
        summary: summaries.get(appId) ?? { average: 0, count: 0 },
        canReview,
        reviews,
    });
}));

/** Create or replace the caller's own review. */
router.put("/:appId/reviews/mine", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const appId = appIdOf(req);
    const parsed = upsertAppReviewSchema.safeParse(req.body);
    if (!parsed.success) throw new BadRequestError("A rating from 1 to 5 is required; comments are at most 2000 characters");
    const org = await getUserOrgContext(req);
    const review = await appReviewsService.upsert(appId, String((req as any).user.id), org.organizationId, parsed.data);
    res.json(review);
}));

router.delete("/:appId/reviews/mine", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const appId = appIdOf(req);
    const removed = await appReviewsService.remove(appId, String((req as any).user.id));
    res.json({ removed });
}));

export { router as appReviewsRouter };
