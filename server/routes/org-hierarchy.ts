/**
 * Org Hierarchy Routes
 *
 * Groups three Paperclip-parity feature areas:
 *  - /api/org/agent-hierarchy   — tenant-scoped agent org chart
 *  - /api/org/cost-ledger       — per-agent/mission cost attribution
 *  - /api/org/heartbeat-triggers — continuous polling trigger CRUD
 */

import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { getUserOrgContext } from "../utils/auth-context.js";
import { agentHierarchyService, setReportsToPayload } from "@domain/agents/core/agent-hierarchy.service.js";
import { costLedgerService } from "@domain/system/cost-ledger.service.js";
import { heartbeatTriggerService } from "@domain/agents/core/heartbeat-trigger.service.js";
import {
    insertHeartbeatTriggerSchema,
    updateHeartbeatTriggerSchema,
    heartbeatSourceTypes,
} from "@shared/schema/heartbeat-triggers.js";
import { agentOrgRoles } from "@shared/schema/agent-deployments.js";
import { BadRequestError } from "@server/utils/errors.js";
import { validateIdParam } from "@server/utils/api-utils.js";
import { requireOrganizationPermission } from "@server/utils/organization-permissions.js";

/** Asserts the user has a valid org context (required for all org-scoped routes). */
function assertOrgId(organizationId: number | null): asserts organizationId is number {
    if (organizationId === null) {
        throw new BadRequestError("No organization context found. Join or create an org first.");
    }
}

const router = Router();

// ============================================================================
// AGENT ORG HIERARCHY
// ============================================================================

/**
 * GET /api/org/agent-hierarchy
 * Returns the full recursive agent org chart for the calling user's org.
 */
router.get(
    "/agent-hierarchy",
    requireAuth,
    asyncHandler(async (req: any, res: any) => {
        const { organizationId } = await getUserOrgContext(req);
        assertOrgId(organizationId);
        const tree = await agentHierarchyService.getOrgHierarchy(organizationId);
        res.json({ tree });
    }),
);

/**
 * PUT /api/org/agent-hierarchy/:agentId/reports-to
 * Sets the supervisor relationship for an agent.
 * Body: { supervisorId: number | null, orgRole?: string }
 */
router.put(
    "/agent-hierarchy/:agentId/reports-to",
    requireAuth,
    asyncHandler(async (req: any, res: any) => {
        const { organizationId } = await getUserOrgContext(req);
        assertOrgId(organizationId);
        const agentId = validateIdParam(req.params.agentId);
        const payload = setReportsToPayload.parse(req.body);

        const updated = await agentHierarchyService.setReportsTo(
            agentId,
            organizationId,
            payload,
        );

        res.json(updated);
    }),
);

/**
 * GET /api/org/agent-hierarchy/:agentId/direct-reports
 * Returns flat list of agents that directly report to the given agent.
 */
router.get(
    "/agent-hierarchy/:agentId/direct-reports",
    requireAuth,
    asyncHandler(async (req: any, res: any) => {
        const { organizationId } = await getUserOrgContext(req);
        assertOrgId(organizationId);
        const agentId = validateIdParam(req.params.agentId);
        const reports = await agentHierarchyService.getDirectReports(agentId, organizationId);
        res.json(reports);
    }),
);

// ============================================================================
// COST LEDGER
// ============================================================================

const costLedgerQuerySchema = z.object({
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
    agentDeploymentId: z.coerce.number().int().positive().optional(),
    missionId: z.coerce.number().int().positive().optional(),
    model: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(500).optional().default(50),
    offset: z.coerce.number().int().min(0).optional().default(0),
});

/**
 * GET /api/org/cost-ledger
 * Returns paginated cost ledger entries for the calling org.
 * Supports filtering by date range, agent, mission, and model.
 */
router.get(
    "/cost-ledger",
    requireAuth,
    asyncHandler(async (req: any, res: any) => {
        const { organizationId } = await getUserOrgContext(req);
        assertOrgId(organizationId);
        const query = costLedgerQuerySchema.parse(req.query);

        const result = await costLedgerService.getLedger(organizationId, {
            startDate: query.startDate ? new Date(query.startDate) : undefined,
            endDate: query.endDate ? new Date(query.endDate) : undefined,
            agentDeploymentId: query.agentDeploymentId,
            missionId: query.missionId,
            model: query.model,
            limit: query.limit,
            offset: query.offset,
        });

        res.json(result);
    }),
);

/**
 * GET /api/org/cost-ledger/summary
 * Returns per-agent monthly spend summaries for the current month.
 */
router.get(
    "/cost-ledger/summary",
    requireAuth,
    asyncHandler(async (req: any, res: any) => {
        const { organizationId } = await getUserOrgContext(req);
        assertOrgId(organizationId);
        const now = new Date();
        const summaries = await costLedgerService.getAgentMonthlySummaries(
            organizationId,
            now.getFullYear(),
            now.getMonth() + 1, // 1-12
        );
        res.json(summaries);
    }),
);

// ============================================================================
// HEARTBEAT TRIGGERS
// ============================================================================

/**
 * GET /api/org/heartbeat-triggers
 * Lists all heartbeat triggers for the calling org.
 */
router.get(
    "/heartbeat-triggers",
    requireAuth,
    asyncHandler(async (req: any, res: any) => {
        const { organizationId } = await getUserOrgContext(req);
        assertOrgId(organizationId);
        const triggers = await heartbeatTriggerService.listTriggers(organizationId);
        res.json(triggers);
    }),
);

/**
 * POST /api/org/heartbeat-triggers
 * Creates a new heartbeat trigger for the calling org.
 */
router.post(
    "/heartbeat-triggers",
    requireAuth,
    asyncHandler(async (req: any, res: any) => {
        const { organizationId } = await getUserOrgContext(req);
        assertOrgId(organizationId);
        const userId = (req.session as any)?.userId ?? "system";

        const payload = insertHeartbeatTriggerSchema.parse({
            ...req.body,
            orgId: organizationId,
            createdBy: userId,
        });

        const created = await heartbeatTriggerService.createTrigger(
            organizationId,
            userId,
            payload,
        );

        res.status(201).json(created);
    }),
);

/**
 * PATCH /api/org/heartbeat-triggers/:id
 * Updates an existing heartbeat trigger.
 */
router.patch(
    "/heartbeat-triggers/:id",
    requireAuth,
    asyncHandler(async (req: any, res: any) => {
        const { organizationId } = await getUserOrgContext(req);
        assertOrgId(organizationId);
        const triggerId = validateIdParam(req.params.id);
        const payload = updateHeartbeatTriggerSchema.parse(req.body);

        const updated = await heartbeatTriggerService.updateTrigger(
            triggerId,
            organizationId,
            payload,
        );

        res.json(updated);
    }),
);

/**
 * DELETE /api/org/heartbeat-triggers/:id
 * Deletes a heartbeat trigger and removes its repeatable job.
 */
router.delete(
    "/heartbeat-triggers/:id",
    requireAuth,
    asyncHandler(async (req: any, res: any) => {
        const { organizationId } = await getUserOrgContext(req);
        assertOrgId(organizationId);
        const triggerId = validateIdParam(req.params.id);

        await heartbeatTriggerService.deleteTrigger(triggerId, organizationId);

        res.json({ success: true, id: triggerId });
    }),
);

// ============================================================================
// STANDING AGENTS
// ============================================================================
//
// One-call provisioning for a continuously-running agent: a job (the agent
// definition), a deployment (the addressable runtime), and optionally a
// heartbeat trigger that materializes inbound items into launched missions.
// The approval boundary is stored on the deployment — the outbound send gate
// resolves it via the executing job — and folded into the system prompt so
// the model sees its own rules too.

const standingAgentSchema = z.object({
    name: z.string().min(1).max(100),
    description: z.string().max(500).optional(),
    instructions: z.string().min(1),
    tools: z.array(z.string()).optional(),
    approvalBoundary: z.string().max(2000).optional(),
    orgRole: z.enum(agentOrgRoles).optional(),
    heartbeat: z
        .object({
            sourceType: z.enum(heartbeatSourceTypes),
            sourceConfig: z.record(z.any()).default({}),
            pollingIntervalMs: z.number().int().min(10_000).max(86_400_000),
            missionTitleTemplate: z.string().optional(),
            missionPriority: z.enum(["low", "normal", "high"]).optional(),
        })
        .optional(),
});

/**
 * POST /api/org/standing-agents
 * Creates job + deployment (+ optional heartbeat trigger) in one call.
 */
router.post(
    "/standing-agents",
    requireAuth,
    // A standing agent launches missions unattended and carries the approval
    // boundary the outbound send gate enforces — both are policy, not a
    // member-level setting.
    requireOrganizationPermission("policy:manage"),
    asyncHandler(async (req: any, res: any) => {
        const orgContext = await getUserOrgContext(req);
        assertOrgId(orgContext.organizationId);
        const userId = (req.session as any)?.userId ?? orgContext.userId ?? "system";

        const input = standingAgentSchema.parse(req.body);

        const { standingAgentService } = await import(
            "../domain/agents/core/standing-agent.service.js"
        );
        const result = await standingAgentService.provision(orgContext, userId, input);

        res.status(201).json({
            job: { id: result.job.id, name: result.job.name },
            deployment: result.deployment,
            heartbeatTrigger: result.heartbeatTrigger,
        });
    }),
);

export default router;
