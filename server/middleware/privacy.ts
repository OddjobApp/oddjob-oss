import { Request, Response, NextFunction } from "express";
import { db } from "@server/database_service.js";
import { appDeployments, apps } from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";

/**
 * Middleware to respect the oj_opt_out cookie
 * If the opt-out cookie is present, we short-circuit any tracking requests.
 */
export const enforcePrivacy = (req: Request, res: Response, next: NextFunction) => {
    if (req.cookies?.oj_opt_out === "true" || req.get("Sec-GPC") === "1") {
        return res.status(204).end(); // No Content - Privacy Respected
    }
    next();
};

const PROSPECTOR_SLUG = "prospector";

/**
 * Middleware to enforce mini-app installation.
 * Checks that the requesting organization has an active Prospector app deployment.
 * Returns 403 if the app is not installed for this org.
 */
export const requireProspectingApp = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const user = (req as any).user;
        const organizationId: number | null = user?.organizationId ?? null;

        if (!organizationId) {
            return res.status(403).json({
                error: "Organization context required to use the Prospector app.",
            });
        }

        // Find the prospector app by its slug
        const [prospectorApp] = await db
            .select({ id: apps.id })
            .from(apps)
            .where(eq(apps.slug, PROSPECTOR_SLUG))
            .limit(1);

        if (!prospectorApp) {
            return res.status(403).json({
                error: "Prospector app is not available on this platform.",
            });
        }

        // Check that this org has deployed it
        const [deployment] = await db
            .select({ id: appDeployments.id })
            .from(appDeployments)
            .where(
                and(
                    eq(appDeployments.organizationId, organizationId),
                    eq(appDeployments.appId, prospectorApp.id),
                )
            )
            .limit(1);

        if (!deployment) {
            return res.status(403).json({
                error: "Prospector app is not installed for your organization. Install it from the App Gallery.",
            });
        }

        next();
    } catch (err: any) {
        next(err);
    }
};

