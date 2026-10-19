/**
 * Agent Card REST API Routes
 * CRUD operations for managing agent cards scoped to an organization.
 *
 * POST   /api/agent-cards       — Create a new agent card
 * GET    /api/agent-cards       — List all enabled agent cards for the org
 * GET    /api/agent-cards/:id   — Get a single agent card by ID
 * PATCH  /api/agent-cards/:id   — Partial update of an agent card
 * DELETE /api/agent-cards/:id   — Soft-delete an agent card (sets enabled=false)
 */

import { Router, type Request, type Response } from "express";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { getUserOrgContext, requireOrgId } from "@server/utils/auth-context.js";
import { resolveOrganizationAuthorization } from "@server/utils/organization-permissions.js";
import { createLogger } from "@server/utils/logger.js";
import { NotFoundError } from "@server/utils/errors.js";
import { agentCardService } from "../core/agent-card.service.js";
import { agentSyncService } from "../core/agent-sync.service.js";
import { seedProvisioningService } from "../core/seed-provisioning.service.js";

const logger = createLogger("AgentCardRoutes");
const router = Router();

// All agent-card routes require authentication
router.use(requireAuth);

/**
 * POST /api/agent-cards/sync
 * Synchronize existing platform agents (ai_agent/agent_ai jobs) into agent cards.
 * Creates agent cards for agents that don't already have one (matched by name + org).
 * Returns 200 with sync results including counts and any errors.
 */
router.post("/sync", asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const orgId = requireOrgId(orgContext);

    logger.info(`Agent sync triggered for org ${orgId}`);

    // Seed cards first. seedForOrganization runs once, at org creation, so an
    // organization that predates a seed addition would otherwise never get it —
    // and the Crew Room's default selection depends on the Copilot existing.
    // Idempotent, so calling it on every sync is safe.
    const backfilled = await seedProvisioningService.ensureDefaultCards(orgId);

    const result = await agentSyncService.syncForOrganization(orgId);

    res.json({
        success: true,
        message: `Sync complete: ${result.synced} created, ${result.skipped} skipped`,
        ...result,
        seeded: backfilled.map((c) => c.name),
    });
}));

/**
 * GET /api/agent-cards/sync
 * Shows sync status — lists available agent jobs and their types for debugging.
 */
router.get("/sync", asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const orgId = requireOrgId(orgContext);

    const { db: database } = await import("@server/database_service.js");
    const { jobs: jobsTable } = await import("@shared/schema/index.js");
    const { eq, sql } = await import("drizzle-orm");

    // Get distinct job types for this org
    const types = await database
        .select({ type: jobsTable.type, count: sql<number>`count(*)::int` })
        .from(jobsTable)
        .where(eq(jobsTable.organizationId, orgId))
        .groupBy(jobsTable.type);

    res.json({ organizationId: orgId, jobTypes: types });
}));

/**
 * POST /api/agent-cards
 * Create a new agent card for the authenticated user's organization.
 * Returns 201 on success, 400 on validation error, 409 on name conflict.
 */
router.post("/", asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const orgId = requireOrgId(orgContext);

    const created = await agentCardService.create(orgId, req.body);

    logger.info(`Agent card created: ${created.id} for org ${orgId}`);
    res.status(201).json(created);
}));

/**
 * GET /api/agent-cards
 * List all enabled agent cards for the authenticated user's organization.
 * Returns 200 with an array of agent card records.
 */
router.get("/", asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const orgId = requireOrgId(orgContext);

    await seedProvisioningService.ensureDefaultCards(orgId).catch(() => []);
    const cards = await agentCardService.list(orgId);

    res.json(cards);
}));

/**
 * GET /api/agent-cards/:id
 * Get a single agent card by ID, scoped to the authenticated user's organization.
 * Returns 200 on success, 404 if not found or not in org.
 */
router.get("/:id", asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const orgId = requireOrgId(orgContext);
    const id = parseInt(req.params.id, 10);

    if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid agent card ID" });
    }

    const card = await agentCardService.getById(orgId, id);

    if (!card) {
        throw new NotFoundError(
            `Agent card ${id} not found`,
            "NOT_FOUND",
            { agentCardId: id, organizationId: orgId }
        );
    }

    res.json(card);
}));

/**
 * PATCH /api/agent-cards/:id
 * Partial update of an agent card.
 * Only provided fields are modified; unspecified fields are preserved.
 * Returns 200 on success, 400 on validation error, 404 if not found, 409 on name conflict.
 */
router.patch("/:id", asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const orgId = requireOrgId(orgContext);
    const id = parseInt(req.params.id, 10);

    if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid agent card ID" });
    }

    // The approval boundary is policy the outbound send gate enforces; a
    // member who could edit it could clear "never contact customers" on the
    // agent they are about to use.
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, "approvalBoundary")) {
        const authorization = await resolveOrganizationAuthorization(req);
        if (!authorization.permissions.includes("policy:manage")) {
            return res.status(403).json({ error: "Forbidden", requiredPermission: "policy:manage" });
        }
    }

    const updated = await agentCardService.update(orgId, id, req.body);

    res.json(updated);
}));

/**
 * DELETE /api/agent-cards/:id
 * Soft-delete an agent card (sets enabled=false).
 * The record is retained for auditing but excluded from list/routing queries.
 * Returns 200 on success, 404 if not found.
 */
router.delete("/:id", asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const orgId = requireOrgId(orgContext);
    const id = parseInt(req.params.id, 10);

    if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid agent card ID" });
    }

    await agentCardService.softDelete(orgId, id);

    res.json({ success: true, message: `Agent card ${id} has been disabled` });
}));

export const agentCardRouter = router;
export default router;
