
import { Router, type Request, type Response } from "express";
import { externalService } from "../core/external.service.js";
import { asyncHandler } from "../../../middleware/error-handler.js";
import { UnauthorizedError, ValidationError } from "@server/utils/errors.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger('ExternalGateway');
const router = Router();

// GET /api/external/task?token=... - Validate JWT and return form schema
router.get("/task", asyncHandler(async (req: Request, res: Response) => {
    const token = req.query.token as string;
    if (!token) throw new ValidationError("Token is required", { field: 'token' });

    // Validate JWT token
    const { validateExternalToken } = await import("@domain/auth/core/jwt.service.js");
    let payload;
    try {
        payload = validateExternalToken(token);
        logger.info(`[ExternalGateway] Validated token for: ${payload.email} (formId: ${payload.formId}, requestId: ${payload.requestId})`);
    } catch (err: any) {
        logger.error(`[ExternalGateway] Token validation FAILED: ${err.message}`, { token: token.substring(0, 10) + '...' });
        throw new UnauthorizedError("This link is no longer valid.");
    }

    const result = await externalService.getTaskForm(payload);
    res.json(result);
}));

// POST /api/external/otp/request - Generate and send OTP code
router.post("/otp/request", asyncHandler(async (req: Request, res: Response) => {
    const { token, email } = req.body;

    if (!token || !email) throw new ValidationError("Token and email are required", { fields: ['token', 'email'] });

    // Validate JWT token
    const { validateExternalToken } = await import("@domain/auth/core/jwt.service.js");
    let payload;
    try {
        payload = validateExternalToken(token);
    } catch (error: any) {
        throw new UnauthorizedError(error.message || "Invalid or expired token");
    }

    const result = await externalService.requestOtp(payload, email);
    logger.info('OTP sent', { correlationId: req.correlationId, email, formId: result.formId });
    res.json(result);
}));

// POST /api/external/otp/verify - Validate OTP code
router.post("/otp/verify", asyncHandler(async (req: Request, res: Response) => {
    const { token, email, code } = req.body;

    if (!token || !email || !code) throw new ValidationError("Token, email, and code are required", { fields: ['token', 'email', 'code'] });

    const { validateExternalToken } = await import("@domain/auth/core/jwt.service.js");
    let payload;
    try {
        payload = validateExternalToken(token);
    } catch (error: any) {
        throw new UnauthorizedError(error.message || "Invalid or expired token");
    }

    const result = await externalService.verifyOtp(payload, email, code);
    logger.info('OTP verified', { correlationId: req.correlationId, email, formId: result.formId });
    res.json(result);
}));

// POST /api/external/task/submit - Submit form response and resume pipeline
router.post("/task/submit", asyncHandler(async (req: Request, res: Response) => {
    const { token, responses } = req.body;

    if (!token || !responses) throw new ValidationError("Token and responses are required", { fields: ['token', 'responses'] });

    const { validateExternalToken } = await import("@domain/auth/core/jwt.service.js");
    let payload;
    try {
        payload = validateExternalToken(token);
    } catch (error: any) {
        throw new UnauthorizedError(error.message || "Invalid or expired token");
    }

    const result = await externalService.submitForm(payload, responses);
    logger.info('Form submitted', { correlationId: req.correlationId, stepExecutionId: result.stepExecutionId });
    const formStudioStage = (result as { formStudioStage?: unknown }).formStudioStage;
    res.json({
        status: "success",
        message: "Form submission received and pipeline will resume",
        // A form stage's submitter gets back the stage's results, limited to what they may see.
        ...(formStudioStage ? { formStudioStage } : {}),
    });
}));

export function registerExternalRoutes(app: any) {
    app.use("/api/external", router);
}

export default router;


