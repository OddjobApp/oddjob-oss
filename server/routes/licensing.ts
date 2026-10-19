import { Router, Request, Response } from "express";
import { licenseService } from "@domain/core/licensing/license-service.js";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { BadRequestError, TrialAlreadyUsedError } from "@server/utils/errors.js";
import { auditService } from "@domain/audit/index.js";

const router = Router();

// GET /api/licensing/status - Get current license/trial status
router.get("/status", asyncHandler(async (req: Request, res: Response) => {
    const status = await licenseService.getEffectiveLicense();
    res.json(status);
}));

// POST /api/licensing/trial - Start a 30-day trial
router.post("/trial", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const result = await licenseService.startTrial();
    if (!result.success) {
        throw new TrialAlreadyUsedError(result.message);
    }

    await auditService.logFromRequest(req, "trial_started", "system", undefined, {
        plan: "30-Day Trial"
    });

    res.json(result);
}));

// POST /api/licensing/activate - Activate a paid license key
router.post("/activate", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { key } = req.body;
    if (!key) {
        throw new BadRequestError("License key is required.");
    }
    const result = await licenseService.activateLicense(key);
    if (!result.success) {
        throw new BadRequestError(result.message || "Failed to activate license.");
    }

    await auditService.logFromRequest(req, "license_activated", "system", result.license?.id, {
        plan: result.license?.planType,
        customer: result.license?.customerName
    });

    res.json(result);
}));

export function registerLicensingRoutes(app: any) {
    app.use("/api/licensing", router);
}

export default router;

