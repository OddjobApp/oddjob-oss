
import { Router, Request, Response } from "express";
import { asyncHandler } from "../../../middleware/error-handler.js";
import { jiraOversightService } from "../jira-oversight.service.js";
import { getUserOrgContext } from "../../../utils/auth-context.js";
import { z } from "zod";

const jiraOversightRouter = Router();

const querySchema = z.object({
    credentialId: z.coerce.number(),
    days: z.coerce.number().optional().default(7)
});

/**
 * GET /api/integrations/jira/oversight
 * Fetches recent issues for technical oversight.
 */
jiraOversightRouter.get("/oversight", asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    if (!orgContext.organizationId) throw new Error("Organization context missing");
    const { credentialId, days } = querySchema.parse(req.query);

    const stats = await jiraOversightService.getRecentIssues(credentialId, orgContext.organizationId, days);
    
    res.json(stats);
}));

export default jiraOversightRouter;
