import { Router, type Request, type Response } from "express";
import { requireAuth } from "../../core/auth/security.service.js";
import { getUserOrgContext } from "../../../utils/auth-context.js";
import { missionQueryService } from "../core/mission-query.service.js";
import { asyncHandler } from "../../../middleware/error-handler.js";
import { BadRequestError } from "../../../utils/errors.js";

const router = Router();

/**
 * GET /api/workstreams
 * Returns live workstream telemetry aggregated from the knowledge graph.
 * `?projectId` scopes the feed to missions filed under that project space.
 */
router.get("/", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);

    if (!orgContext.organizationId) {
        throw new BadRequestError("Organization context required");
    }

    let projectId: number | undefined;
    if (req.query.projectId != null) {
        const parsed = Number(req.query.projectId);
        if (!Number.isInteger(parsed) || parsed < 1) {
            throw new BadRequestError("Invalid projectId");
        }
        // Resolve through projectService so an invisible or foreign project reads
        // as not-found rather than returning an empty-but-revealing feed.
        const { projectService } = await import("../../projects/core/project.service.js");
        const project = await projectService.getProject({
            organizationId: orgContext.organizationId,
            userId: orgContext.userId,
            isSuperAdmin: orgContext.isSuperAdmin,
            isOrgAdmin: orgContext.isOrgAdmin,
        }, parsed);
        projectId = project.id;
    }

    const workstreams = await missionQueryService.getWorkstreams(orgContext.organizationId, projectId);
    res.json(workstreams);
}));

export default router;
