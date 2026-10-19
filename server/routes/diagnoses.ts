
import { Router, type Request, type Response } from "express";
import { db } from "@server/database_service.js";
import { errorDiagnoses } from "@shared/schema/index.js";
import { eq, desc, and, sql, type SQL } from "drizzle-orm";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { getUserOrgContext, requireOrgId } from "../utils/auth-context.js";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { NotFoundError } from "@server/utils/errors.js";

const router = Router();

// --- Error Diagnosis (Dashboard) ---

/**
 * GET /api/admin/diagnoses
 * List recent error diagnoses
 */
router.get("/admin/diagnoses", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    let query: any = db.select().from(errorDiagnoses).orderBy(desc(errorDiagnoses.createdAt)).limit(limit).offset(offset);

    // Filter by organization if not super admin
    if (!orgContext.isSuperAdmin && orgContext.organizationId) {
        query = db.select().from(errorDiagnoses)
            .where(eq(errorDiagnoses.organizationId, orgContext.organizationId))
            .orderBy(desc(errorDiagnoses.createdAt))
            .limit(limit)
            .offset(offset);
    }

    const results = await query;
    res.json(results);
}));

/**
 * GET /api/admin/diagnoses/:diagnosisId
 * Get details of a specific diagnosis
 */
router.get("/admin/diagnoses/:diagnosisId", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const { diagnosisId } = req.params;

    let result;
    if (orgContext.isSuperAdmin) {
        [result] = await db.select().from(errorDiagnoses).where(eq(errorDiagnoses.diagnosisId, diagnosisId)).limit(1);
    } else if (orgContext.organizationId) {
        [result] = await db.select().from(errorDiagnoses).where(and(
            eq(errorDiagnoses.diagnosisId, diagnosisId),
            eq(errorDiagnoses.organizationId, orgContext.organizationId)
        )).limit(1);
    }

    if (!result) {
        throw new NotFoundError("Diagnosis not found");
    }

    res.json(result);
}));

/**
 * POST /api/admin/diagnoses/:diagnosisId/feedback
 * Submit user feedback on a diagnosis
 */
router.post("/admin/diagnoses/:diagnosisId/feedback", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { diagnosisId } = req.params;
    const { helpful, appliedFixId, fixSuccessful, comment } = req.body;

    // Import engine dynamically to avoid circular dependecies at top level if any
    const { errorDiagnosisEngine } = await import('@domain/diagnostics/index.js');

    await errorDiagnosisEngine.recordFeedback(diagnosisId, {
        helpful,
        appliedFixId,
        fixSuccessful,
        comment
    });

    res.json({ success: true });
}));

/**
 * POST /api/admin/diagnoses/:diagnosisId/fix
 * Apply a recommended fix
 */
router.post("/admin/diagnoses/:diagnosisId/fix", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { diagnosisId } = req.params;
    const { recommendationId } = req.body;
    const userId = (req.session as any)?.userId;

    if (!recommendationId) {
        throw new Error("recommendationId is required");
    }

    const { errorDiagnosisEngine } = await import('@domain/diagnostics/index.js');

    const result = await errorDiagnosisEngine.applyFix(diagnosisId, recommendationId, { userId });

    res.json(result);
}));

/**
 * DELETE /api/admin/diagnoses/clear-fixed
 * Clear all diagnoses that have been successfully fixed
 */
router.delete("/admin/diagnoses/clear-fixed", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    
    let conditions: any = eq(errorDiagnoses.fixSuccessful, true);

    // If not super admin, restrict to their organization
    if (!orgContext.isSuperAdmin && orgContext.organizationId) {
        conditions = and(
            eq(errorDiagnoses.fixSuccessful, true),
            eq(errorDiagnoses.organizationId, orgContext.organizationId)
        );
    }

    const result = await db.delete(errorDiagnoses)
        .where(conditions)
        .returning();

    res.json({ 
        success: true, 
        count: result.length,
        message: `Cleared ${result.length} fixed incidents.`
    });
}));

/**
 * DELETE /api/admin/diagnoses/clear-all
 * Clear all diagnoses for the current organization
 */
router.delete("/admin/diagnoses/clear-all", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    
    // `conditions` was `any` and left unassigned by a third case: a
    // non-super-admin whose organization is null matched neither branch, so
    // `.where(undefined)` reached Drizzle — which treats that as NO FILTER, not
    // as an empty match. This endpoint therefore deleted every organization's
    // diagnoses for such a caller. Typing it as SQL and making the non-super
    // path go through requireOrgId means there is no unassigned case left: a
    // caller with no organization gets a 403 instead of clearing the platform.
    let conditions: SQL;
    if (orgContext.isSuperAdmin) {
        // Deliberate: a super admin clears every organization.
        conditions = sql`true`;
    } else {
        conditions = eq(errorDiagnoses.organizationId, requireOrgId(orgContext));
    }

    const result = await db.delete(errorDiagnoses)
        .where(conditions)
        .returning();

    res.json({ 
        success: true, 
        count: result.length,
        message: `Cleared all ${result.length} incidents.`
    });
}));

// --- On-Demand Analysis ---
router.post("/diagnosis/analyze", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { error, httpStatus, requestUrl, jobType, stepExecutionId, includeAI } = req.body;

    const { errorDiagnosisEngine } = await import('@domain/diagnostics/index.js');

    const result = await errorDiagnosisEngine.diagnose({
        error,
        httpStatus,
        requestUrl,
        jobType,
        stepExecutionId,
    }, { includeAI });

    res.json(result);
}));

export function registerDiagnosisRoutes(app: any) {
    app.use("/api", router);
}

export default router;

