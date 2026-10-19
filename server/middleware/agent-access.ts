import { Request, Response, NextFunction } from "express";
import { getUserOrgContext } from "../utils/auth-context.js";
import { db } from "../database_service.js";
import { agentDeployments } from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";

// Extend Express Request to include deployment
declare global {
    namespace Express {
        interface Request {
            agentDeployment?: typeof agentDeployments.$inferSelect;
        }
    }
}

/**
 * Middleware that verifies the user has access to the agent deployment
 * and attaches the deployment to req.agentDeployment
 */
export async function requireAgentDeploymentAccess(
    req: Request,
    res: Response,
    next: NextFunction
) {
    try {
        const jobId = parseInt(req.params.jobId);
        if (isNaN(jobId)) {
            res.status(400).json({ error: "Invalid job ID" });
            return;
        }

        const orgContext = await getUserOrgContext(req);
        if (!orgContext.organizationId) {
            res.status(403).json({ error: "No organization context" });
            return;
        }

        const deployment = await db.query.agentDeployments.findFirst({
            where: and(
                eq(agentDeployments.jobId, jobId),
                eq(agentDeployments.organizationId, orgContext.organizationId)
            )
        });

        if (!deployment) {
            res.status(404).json({ error: "Deployment not found or access denied" });
            return;
        }

        // Attach to request for use in route handlers
        req.agentDeployment = deployment;
        next();
    } catch (error) {
        next(error);
    }
}

