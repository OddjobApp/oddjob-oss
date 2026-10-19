import { validateIdParam } from "@server/utils/api-utils.js";
import { Router, type Request, type Response } from "express";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { getUserOrgContext, requireOrgId } from "../utils/auth-context.js";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { BadRequestError, ForbiddenError, UnauthorizedError } from "@server/utils/errors.js";
import { createLogger } from "@server/utils/logger.js";
import { getOrgConditions } from "@server/utils/org-conditions.js";
import { hilService } from "@domain/pipeline/core/hil.service.js";
import { hilFormAccess } from "@domain/pipeline/core/hil-form-access.service.js";
import { formStudioRouter } from "@domain/pipeline/api/form-studio.routes.js";
import { db } from "@server/database_service.js";
import { hilForms, approvalRequests, xrayOperationalNotifications } from "@shared/schema/index.js";
import { gmailAlertRoute } from '@shared/gmail-notification-handoff.js';
import { approvalService } from "../domain/integrations/core/approval.service.js";
import { eq, and, desc, sql } from "drizzle-orm";

const router = Router();
const logger = createLogger('HilRoute');

// GET /api/forms - List all active forms
router.get("/", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgCtx = await getUserOrgContext(req);
    const organizationId = requireOrgId(orgCtx);
    const userId = (req as any).user?.id || "system";
    const forms = await hilService.listForms(userId, organizationId);
    res.json(forms);
}));

// GET /api/forms/notifications - List unviewed pending HIL requests
router.get("/notifications", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const userId = (req as any).user?.id || (req.session as any)?.userId;
    const email = (req as any).user?.email;

    console.log(`[HIL_DEBUG] Fetching notifications for User: ${userId}, Email: ${email}`);

    // 1. Fetch standard HIL forms. Scoped with the canonical org conditions: the
    // old `organizationId ? eq(...) : undefined` became `.where(undefined)` for a
    // caller with no org, and returned every tenant's pending forms.
    const unviewedForms = await db
        .select()
        .from(hilForms)
        .where(
            and(
                // Requests only. Builder templates saved before `kind` existed were
                // "pending" too, and sat in the inbox as if someone were waiting.
                eq(hilForms.kind, "request"),
                eq(hilForms.status, "pending"),
                eq(hilForms.isViewed, false),
                ...getOrgConditions(orgContext, hilForms, false)
            )
        );

    // 2. Fetch pending approvals (shadow and standard)
    // Map them to look like hilForms for the UI
    const pendingApprovals = await approvalService.listPending(userId, email);
    console.log(`[HIL_DEBUG] Pending Approvals found: ${pendingApprovals.length}`);

    const mappedApprovals = pendingApprovals.map(app => ({
        id: `app-${app.id}`, // Add prefix to avoid ID collisions in list
        stepExecutionId: app.executionId, // Use executionId as step ref
        status: "pending",
        isViewed: false,
        name: (app as any).modifiedOutput?.command || "Human-In-The-Loop Approval",
        description: `Approval required for ${app.executionId}`,
        createdAt: app.createdAt,
        type: 'approval'
    }));

    // 3. Fetch advisory X-Ray operational notifications. This is deliberately
    // non-blocking so the existing HIL inbox remains available before migration
    // 0004 has been applied in every environment.
    let mappedXrayNotifications: any[] = [];
    if (orgContext.organizationId) {
        try {
            const records = await db
                .select()
                .from(xrayOperationalNotifications)
                .where(and(
                    eq(xrayOperationalNotifications.organizationId, orgContext.organizationId),
                    eq(xrayOperationalNotifications.status, "unread"),
                    sql`(${xrayOperationalNotifications.scope} not like 'gmail_directive:%' or ${xrayOperationalNotifications.payload}->>'recipientUserId' = ${String((req as any).user?.id ?? '')})`,
                ))
                .orderBy(desc(xrayOperationalNotifications.createdAt))
                .limit(50);
            mappedXrayNotifications = records.map(notification => ({
                id: `xray-${notification.id}`,
                xrayNotificationId: notification.id,
                status: notification.status,
                isViewed: false,
                name: notification.title,
                description: notification.description,
                createdAt: notification.createdAt,
                type: "xray_operation",
                severity: notification.severity,
                scope: notification.scope,
                payload: notification.scope.startsWith('gmail_directive:') ? { ...notification.payload, actionUrl: gmailAlertRoute(notification.payload.route, notification.eventId), route: gmailAlertRoute(notification.payload.route, notification.eventId), url: gmailAlertRoute(notification.payload.route, notification.eventId), actionLabel: 'Review email in CREW' } : notification.payload,
            }));
        } catch (error: any) {
            logger.warn("X-Ray operational notifications unavailable", { error: error.message });
        }
    }

    console.log(`[HIL_DEBUG] Mapped Approvals: ${mappedApprovals.length}`);

    const combined = [
        ...unviewedForms.map(f => ({ ...f, type: 'hil' })),
        ...mappedApprovals,
        ...mappedXrayNotifications,
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    res.json(combined);
}));

// Dev tool: Generate HIL link
router.post("/dev/generate-hil-link", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    if (process.env.NODE_ENV !== 'development') {
        throw new ForbiddenError("Development environment only");
    }

    const { stepExecutionId } = req.body;
    if (!stepExecutionId) {
        throw new BadRequestError("stepExecutionId required");
    }

    const protocol = req.headers['x-forwarded-proto'] ? String(req.headers['x-forwarded-proto']) : req.protocol;
    const host = req.headers['x-forwarded-host'] ? String(req.headers['x-forwarded-host']) : req.get('host');

    const userId = (req as any).user?.id || "system";
    // @ts-ignore - method exists in hilService but tsc is struggling with the bridge/type resolution in this context
    const url = await hilService.generateDevLink(Number(stepExecutionId), protocol, host || 'localhost:5000');

    res.json({ url });
}));

// GET /api/forms/:id - Get full form details (caller's org only)
router.get("/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const formId = validateIdParam(req.params.id);

    res.json(await hilFormAccess.get(formId, orgContext));
}));

// POST /api/forms - Author a form template in the caller's org.
//
// Templates are created as templates. Requests go through hilRequests, which
// announces them; announcing a template someone is designing would tell people an
// agent is waiting for them when nobody is.
router.post("/", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const userId = (req.session as any)?.userId;
    if (!userId) {
        throw new UnauthorizedError("Authentication required");
    }

    const form = await hilFormAccess.createTemplate(req.body, requireOrgId(orgContext), userId);
    logger.info('Form created', { correlationId: req.correlationId, formId: form.id });
    res.status(201).json(form);
}));

// PUT /api/forms/:id - Update a form (allow-listed fields, caller's org only)
router.put("/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const formId = validateIdParam(req.params.id);

    const updatedForm = await hilFormAccess.update(formId, req.body, orgContext);
    logger.info('Form updated', { correlationId: req.correlationId, formId });
    res.json(updatedForm);
}));

// DELETE /api/forms/:id - Archive form (soft delete; it used to hard-delete)
router.delete("/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const formId = validateIdParam(req.params.id);

    const archived = await hilFormAccess.archive(formId, orgContext);
    logger.info('Form archived', { correlationId: req.correlationId, formId });
    res.json({ message: "Form archived", id: archived.id });
}));

// POST /api/forms/:id/submit - Answer a pending request and resume what waits on it
router.post("/:id/submit", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const formId = validateIdParam(req.params.id);

    res.json(await hilFormAccess.submit(formId, orgContext, req.body?.data, orgContext.userId));
}));

// PUT /api/forms/:id/viewed - Mark form as viewed
router.put("/:id/viewed", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const formId = validateIdParam(req.params.id);

    await hilFormAccess.markViewed(formId, orgContext);
    res.json({ success: true });
}));

/**
 * /api/oddjob/forms: the session-authenticated endpoints PlatformFormBlock calls
 * when it renders inside the copilot or a CREW room.
 *
 * Inside a built app the preview proxy rewrites the same path to the app-token
 * API; in chat nothing served it, so the block could never load a form. Copies
 * of the block inside already-built apps call this path too.
 */
const oddjobFormsRouter = Router();

oddjobFormsRouter.get("/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    res.json(await hilFormAccess.getBlockForm(validateIdParam(req.params.id), orgContext));
}));

oddjobFormsRouter.post("/:id/submit", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    res.json(await hilFormAccess.submitBlockForm(validateIdParam(req.params.id), orgContext, req.body?.data, orgContext.userId));
}));

export function registerHilRoutes(app: any) {
    app.use("/api/form-studio", formStudioRouter);
    app.use("/api/forms", router);
    app.use("/api/oddjob/forms", oddjobFormsRouter);
}
