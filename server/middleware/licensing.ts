import { Request, Response, NextFunction } from "express";
import { licenseService } from "@domain/core/licensing/license-service.js";
import { createLogger } from "@server/utils/logger.js";
import { LicenseRequiredError, InternalServerError } from "@server/utils/errors.js";

const logger = createLogger("LicensingMiddleware");

/**
 * Middleware to enforce licensing for state-changing operations
 */
export async function requireLicense(req: Request, res: Response, next: NextFunction) {
    // 1. Allow all GET requests (read-only mode is okay even if expired)
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
        return next();
    }

    // 2. Bypass for licensing routes (so they can activate/trial)
    if (req.path.startsWith("/licensing") || req.path.startsWith("/api/licensing")) {
        return next();
    }

    // 3. Bypass for SuperAdmins (emergency access)
    const user = (req as any).user;
    if (user?.isSuperAdmin) {
        return next();
    }

    try {
        const license = await licenseService.getEffectiveLicense();

        if (!license.isActive) {
            logger.warn(`Blocked ${req.method} ${req.path} - License inactive/expired.`);
            return next(new LicenseRequiredError());
        }

        // Feature-specific gating could be added here if needed

        next();
    } catch (err: any) {
        logger.error("Licensing check failed:", err);
        next(new InternalServerError("Failed to verify licensing status", { originalError: err.message }));
    }
}

