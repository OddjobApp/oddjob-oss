import { Router, type Express, type Response } from "express";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { asyncHandler } from "../../../middleware/error-handler.js";
import { createLogger } from "@server/utils/logger.js";
import { BadRequestError } from "@server/utils/errors.js";
import { validateIdParam } from "@server/utils/api-utils.js";

import { approvalService } from "../core/approval.service.js";
import { getUserOrgContext, requireOrgId } from "@server/utils/auth-context.js";
import { requireOrganizationPermission } from "@server/utils/organization-permissions.js";
import { db } from "@server/database_service.js";
import { approvalRequests, missions } from "@shared/schema/index.js";
import { eq, and, sql, asc } from "drizzle-orm";
import { cacheService } from "@domain/cache/cache.service.js";
import { registerApprovalRequestsCompatRoutes } from "./approval-requests-compat.routes.js";

const router = Router();
const logger = createLogger('Approvals');

export function registerApprovalsRoutes(app: Express) {
    logger.info("Registering Approvals routes");
    app.use("/api/approvals", router);
    registerApprovalRequestsCompatRoutes(app);
}

// GET /api/approvals/pending/count - Pending count with high-risk aging info
router.get("/pending/count", requireAuth, asyncHandler(async (req: any, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const organizationId = orgContext.organizationId;

    if (!organizationId) {
        return res.json({ count: 0, highRiskAgingCount: 0, oldestPendingAt: null });
    }

    // Cache key for pending approvals count
    const cacheKey = `approval:count:org:${organizationId}:pending`;

    const result = await cacheService.getOrFetch(cacheKey, async () => {
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

        const [queryResult] = await db.select({
            count: sql<number>`COUNT(*)::int`,
            highRiskAgingCount: sql<number>`COUNT(*) FILTER (WHERE (${approvalRequests.modifiedOutput}->>'risk')::text = 'high' AND ${approvalRequests.createdAt} < ${fiveMinutesAgo})::int`,
            oldestPendingAt: sql<string | null>`MIN(${approvalRequests.createdAt})::text`,
        })
            .from(approvalRequests)
            .where(
                and(
                    eq(approvalRequests.status, "pending"),
                    eq(approvalRequests.organizationId, organizationId)
                )
            );

        return {
            count: queryResult?.count ?? 0,
            highRiskAgingCount: queryResult?.highRiskAgingCount ?? 0,
            oldestPendingAt: queryResult?.oldestPendingAt ?? null,
        };
    }, {
        ttl: 60, // 1 minute - counts change frequently
        tags: [`org:${organizationId}`, 'approval-count'],
    });

    res.json(result);
}));

// GET /api/approvals/pending/blocked - Blocked work grouped by mission
router.get("/pending/blocked", requireAuth, asyncHandler(async (req: any, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const organizationId = orgContext.organizationId;

    if (!organizationId) {
        return res.json({ items: [], totalCount: 0 });
    }

    // Cache key for blocked approvals
    const cacheKey = `approval:blocked:org:${organizationId}`;

    const result = await cacheService.getOrFetch(cacheKey, async () => {
        const rows = await db.select({
            id: approvalRequests.id,
            missionId: approvalRequests.missionId,
            missionName: missions.name,
            createdAt: approvalRequests.createdAt,
            modifiedOutput: approvalRequests.modifiedOutput,
            toolName: approvalRequests.toolName,
            toolArgs: approvalRequests.toolArgs,
        })
            .from(approvalRequests)
            .leftJoin(missions, eq(approvalRequests.missionId, missions.id))
            .where(
                and(
                    eq(approvalRequests.status, "pending"),
                    eq(approvalRequests.organizationId, organizationId)
                )
            )
            .orderBy(asc(approvalRequests.createdAt));

        // Group by mission, sorted by longest pending duration first (oldest createdAt)
        const missionMap = new Map<number | null, {
            missionId: number | null;
            missionName: string;
            requests: any[];
            oldestCreatedAt: Date;
        }>();

        for (const row of rows) {
            const key = row.missionId;
            const output = row.modifiedOutput as Record<string, any> | null;

            const toolName = (output?.tool && output.tool !== "unknown")
                ? output.tool
                : (row.toolName || "Approval Request");

            const description = (output?.description || output?.goal || "").trim()
                || (row.toolArgs as any)?.description
                || (row.toolArgs as any)?.intent
                || (row.toolName ? `Run ${row.toolName}` : "")
                || "Approval pending review";

            const request = {
                id: row.id,
                toolName: toolName,
                riskLevel: output?.risk || "medium",
                pendingSince: row.createdAt.toISOString(),
                description: description,
            };

            if (!missionMap.has(key)) {
                missionMap.set(key, {
                    missionId: row.missionId,
                    missionName: row.missionName || "Unassigned",
                    requests: [request],
                    oldestCreatedAt: row.createdAt,
                });
            } else {
                const group = missionMap.get(key)!;
                group.requests.push(request);
                if (row.createdAt < group.oldestCreatedAt) {
                    group.oldestCreatedAt = row.createdAt;
                }
            }
        }

        // Sort groups by longest pending duration first (oldest createdAt first)
        const items = Array.from(missionMap.values())
            .sort((a, b) => a.oldestCreatedAt.getTime() - b.oldestCreatedAt.getTime())
            .map(({ oldestCreatedAt, ...rest }) => rest);

        return {
            items,
            totalCount: rows.length,
        };
    }, {
        ttl: 300, // 5 minutes - blocked list changes with approvals
        tags: [`org:${organizationId}`, 'approval-blocked'],
    });

    res.json(result);
}));

// GET /api/approvals - List pending approvals for current user
router.get("/", requireAuth, asyncHandler(async (req: any, res: Response) => {
    const userId = req.user.id;
    const userEmail = req.user.email;

    logger.info(`[Approvals] Fetching for User: ${userId}, Email: ${userEmail}`);
    const orgContext = await getUserOrgContext(req);
    const list = await approvalService.listPending(userId, userEmail, { ...req.user.adminRole, organizationId: orgContext.organizationId });
    logger.info(`[Approvals] Found ${list.length} pending approvals`);
    res.json(list);
}));

// ───────────────────────────────────────────────────────────────────────────
// STREAMING ENDPOINTS (Phase 4C)
// ───────────────────────────────────────────────────────────────────────────

// GET /api/approvals/stream - Server-Sent Events streaming
router.get("/stream", requireAuth, asyncHandler(async (req: any, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const organizationId = orgContext.organizationId;

    if (!organizationId) {
        return res.status(403).json({ error: "Organization context required" });
    }

    try {
        const { StreamController } = await import("@domain/streaming/streaming.service.js");
        const { createPaginator } = await import("@domain/pagination/pagination.service.js");

        const paginator = createPaginator<typeof approvalRequests.$inferSelect>(approvalRequests);

        await StreamController.streamPaginated(
            res,
            'sse',
            async (cursor) => {
                const result = await paginator.getPageByOffset(db, {
                    cursor,
                    limit: 50,
                    where: eq(approvalRequests.organizationId, organizationId),
                    orderBy: [asc(approvalRequests.createdAt)]
                });
                return result;
            },
            {
                formatItem: (item) => ({
                    id: item.id,
                    status: item.status,
                    createdAt: item.createdAt,
                    modifiedOutput: item.modifiedOutput
                })
            }
        );
    } catch (error: any) {
        logger.error('Streaming error:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: error.message });
        }
    }
}));

// GET /api/approvals/export.csv - CSV streaming export
router.get("/export.csv", requireAuth, asyncHandler(async (req: any, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const organizationId = orgContext.organizationId;

    if (!organizationId) {
        return res.status(403).json({ error: "Organization context required" });
    }

    try {
        const { StreamController } = await import("@domain/streaming/streaming.service.js");
        const { createPaginator } = await import("@domain/pagination/pagination.service.js");

        const paginator = createPaginator<typeof approvalRequests.$inferSelect>(approvalRequests);

        await StreamController.streamPaginated(
            res,
            'csv',
            async (cursor) => {
                const result = await paginator.getPageByOffset(db, {
                    cursor,
                    limit: 500,
                    where: eq(approvalRequests.organizationId, organizationId),
                    orderBy: [asc(approvalRequests.createdAt)]
                });
                return result;
            },
            {
                headers: ['ID', 'Status', 'Created At', 'Tool', 'Risk Level'],
                formatRow: (item) => [
                    String(item.id),
                    item.status,
                    item.createdAt.toISOString(),
                    (item.modifiedOutput as any)?.tool || 'Unknown',
                    (item.modifiedOutput as any)?.risk || 'medium'
                ]
            }
        );
    } catch (error: any) {
        logger.error('CSV export error:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: error.message });
        }
    }
}));

// GET /api/approvals/export.jsonl - JSONL streaming export
router.get("/export.jsonl", requireAuth, asyncHandler(async (req: any, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const organizationId = orgContext.organizationId;

    if (!organizationId) {
        return res.status(403).json({ error: "Organization context required" });
    }

    try {
        const { StreamController } = await import("@domain/streaming/streaming.service.js");
        const { createPaginator } = await import("@domain/pagination/pagination.service.js");

        const paginator = createPaginator<typeof approvalRequests.$inferSelect>(approvalRequests);

        await StreamController.streamPaginated(
            res,
            'jsonl',
            async (cursor) => {
                const result = await paginator.getPageByOffset(db, {
                    cursor,
                    limit: 100,
                    where: eq(approvalRequests.organizationId, organizationId),
                    orderBy: [asc(approvalRequests.createdAt)]
                });
                return result;
            },
            {
                formatItem: (item) => ({
                    id: item.id,
                    status: item.status,
                    createdAt: item.createdAt.toISOString(),
                    missionId: item.missionId,
                    output: item.modifiedOutput
                })
            }
        );
    } catch (error: any) {
        logger.error('JSONL export error:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: error.message });
        }
    }
}));

// GET /api/approvals/outbound-automation - How much outbound work runs
// unattended vs. behind review cards vs. blocked by agent boundaries.
// Registered before /:id so the literal isn't captured as an id.
router.get("/outbound-automation", requireAuth, requireOrganizationPermission("mission:approve"), asyncHandler(async (req: any, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const organizationId = orgContext.organizationId;
    if (!organizationId) {
        return res.json({ periodDays: 30, totals: { fullyAutomated: 0, semiAutomated: 0, blocked: 0, pendingReview: 0 }, proposals: { total: 0, pending: 0, sent: 0, discarded: 0, sendFailed: 0, byChannel: {} }, direct: { sends: 0, failures: 0, byTool: {} }, workTypes: {}, byAgent: [] });
    }
    const days = Math.min(365, Math.max(1, parseInt(String(req.query.days ?? "30"), 10) || 30));
    const { outboundAnalyticsService } = await import("../core/outbound-analytics.service.js");
    res.json(await outboundAnalyticsService.summary(organizationId, days));
}));

// GET /api/approvals/:id/calendar-verification - Re-read an approved calendar event from Google
router.get("/:id/calendar-verification", requireAuth, asyncHandler(async (req: any, res: Response) => {
    const requestId = validateIdParam(req.params.id, 'Approval ID');
    const orgContext = await getUserOrgContext(req);
    const verification = await approvalService.verifyCalendarEvent(requestId, req.user.id, req.user.email, orgContext.organizationId ?? undefined, req.user.adminRole);
    res.json(verification);
}));

// GET /api/approvals/:id - Get detail for a specific approval
router.get("/:id", requireAuth, asyncHandler(async (req: any, res: Response) => {
    const requestId = validateIdParam(req.params.id, "approval ID");
    const userId = req.user.id;
    const userEmail = req.user.email;

    const orgContext = await getUserOrgContext(req);
    const detail = await approvalService.getById(requestId, userId, userEmail, orgContext.organizationId ?? undefined, req.user.adminRole);
    res.json(detail);
}));

// Sender identities are loaded only after the existing approval-view authorization.
router.get("/:id/email-accounts", requireAuth, asyncHandler(async (req: any, res: Response) => {
    const id = validateIdParam(req.params.id, "approval ID");
    const context = await getUserOrgContext(req);
    const detail = await approvalService.getById(id, req.user.id, req.user.email, context.organizationId ?? undefined, req.user.adminRole);
    const meta = detail.toolArgs as any;
    if (meta?.kind !== "outbound_message" || meta.channel !== "email" || ["send_agentmail", "reply_agentmail"].includes(meta.sendTool ?? "")) throw new BadRequestError("This is not a user-authored email draft");
    const { outboundEmailAccounts } = await import("../core/outbound-email-accounts.service.js");
    const orgId = requireOrgId(context);
    const projectId = await outboundEmailAccounts.projectForRoom(orgId, meta.sessionKey);
    res.setHeader("Cache-Control", "no-store");
    res.json(await outboundEmailAccounts.options(orgId, String(req.user.id), projectId));
}));
router.delete("/email-sender/preference", requireAuth, asyncHandler(async (req: any, res: Response) => {
    const { outboundEmailAccounts } = await import("../core/outbound-email-accounts.service.js");
    await outboundEmailAccounts.clearPreference(requireOrgId(await getUserOrgContext(req)), String(req.user.id));
    res.status(204).send();
}));

// POST /api/approvals/:id/decision - Approve or Reject
router.post("/:id/decision", requireAuth, requireOrganizationPermission("mission:approve"), asyncHandler(async (req: any, res: Response) => {
    const requestId = validateIdParam(req.params.id, "approval ID");
    const { decision, action, comments, modifiedOutput } = req.body;
    // Accept both: decision ('approved'|'rejected') or action ('approve'|'reject')
    const resolvedDecision = decision ?? (action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : null);

    if (!resolvedDecision || !['approved', 'rejected'].includes(resolvedDecision)) {
        throw new BadRequestError("Invalid decision. Must provide 'decision' ('approved'|'rejected') or 'action' ('approve'|'reject').");
    }

    const userId = req.user.id;
    const userEmail = req.user.email;

    try {
        const result = await approvalService.processDecision(requestId, {
            decision: resolvedDecision,
            comments,
            modifiedOutput
        }, userId, userEmail, req.user.adminRole);

        // Invalidate approval caches for the organization
        const orgContext = await getUserOrgContext(req);
        if (orgContext.organizationId) {
            await cacheService.invalidate(`approval:*:org:${orgContext.organizationId}:*`);
            await cacheService.invalidateByTag(`org:${orgContext.organizationId}`);
        }

        res.json({ message: "Decision recorded", ...result });
    } catch (error: any) {
        throw error;
    }
}));

// POST /api/approvals/:id/snooze - Snooze the request
router.post("/:id/snooze", requireAuth, asyncHandler(async (req: any, res: Response) => {
    const requestId = validateIdParam(req.params.id, "approval ID");
    const { snoozedUntil } = req.body;

    if (!snoozedUntil) {
        throw new BadRequestError("Missing 'snoozedUntil' timestamp.");
    }

    const userId = req.user.id;
    const userEmail = req.user.email;

    const result = await approvalService.snooze(requestId, new Date(snoozedUntil), userId, userEmail);

    // Invalidate approval caches for the organization
    const orgContext = await getUserOrgContext(req);
    if (orgContext.organizationId) {
        await cacheService.invalidate(`approval:*:org:${orgContext.organizationId}:*`);
        await cacheService.invalidateByTag(`org:${orgContext.organizationId}`);
    }

    res.json(result);
}));

// POST /api/approvals/:id/synthesize-skill - Codify human approval into autonomous skill
router.post("/:id/synthesize-skill", requireAuth, requireOrganizationPermission("mission:approve"), asyncHandler(async (req: any, res: Response) => {
    const requestId = validateIdParam(req.params.id, "approval ID");
    const orgContext = await getUserOrgContext(req);
    const organizationId = orgContext.organizationId;
    if (organizationId == null) {
        throw new BadRequestError("Active organization context is required to synthesize skills");
    }

    const { skillName, customInstructions } = req.body || {};
    const { skillGeneratorService } = await import("@domain/mission/core/skill-generator.service.js");
    const result = await skillGeneratorService.synthesizeFromIntervention({
        approvalRequestId: requestId,
        organizationId,
        skillName,
        userId: req.user?.id,
        customInstructions,
    });

    res.json({
        message: "Skill synthesized successfully from approval intervention",
        ...result,
    });
}));

export default router;


