import { z } from "zod";
import { planWaveSchema } from "@shared/project-plan-commit.js";
import type { ToolDefinition, ToolContext } from "./types.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("CycleTools");

/**
 * Cycle Management Tools for the in-app Oddjob Copilot.
 *
 * These let a user approve a staged ("pending_approval") operational cycle
 * conversationally — the same action as the "Approve & Launch" button on the
 * cycle detail page (client/src/modules/operations/pages/CycleDetailPage.tsx).
 * The approve logic mirrors POST /api/cycles/:id/approve exactly: flip to
 * `active`, set start/end dates from durationDays, and spawn the blueprint
 * fleet with dependency ordering.
 *
 * Auth: `approve_cycle` is admin-gated (org-admin or super-admin), matching the
 * route's `requireOrgAdminOrSuper`. `list_pending_cycles` is read-only so the
 * copilot can resolve a cycle name → id before approving.
 */
export const CYCLE_TOOLS: Record<string, ToolDefinition> = {
    list_pending_cycles: {
        name: "list_pending_cycles",
        label: "List Pending Cycles",
        group: "Operations",
        description:
            "List operational cycles that are staged and awaiting human approval before their mission fleet can launch. Use this to find the cycle id/name the user is referring to before calling approve_cycle.",
        parameters: z.object({
            limit: z.number().optional().default(25).describe("Maximum number of cycles to return (default 25)."),
        }),
        idempotency: "read-safe",
        execute: async ({ limit }: any, context: ToolContext) => {
            try {
                const { db } = await import("@server/database_service.js");
                const { operationalCycles } = await import("@shared/schema/index.js");
                const { and, eq, desc } = await import("drizzle-orm");

                const conditions = [eq(operationalCycles.status, "pending_approval")];
                // Org members see only their org; super admins see all pending cycles.
                if (!context?.isSuperAdmin && context?.organizationId) {
                    conditions.push(eq(operationalCycles.organizationId, context.organizationId));
                }

                const rows = await db
                    .select({
                        id: operationalCycles.id,
                        name: operationalCycles.name,
                        status: operationalCycles.status,
                        priority: operationalCycles.priority,
                        organizationId: operationalCycles.organizationId,
                        createdAt: operationalCycles.createdAt,
                    })
                    .from(operationalCycles)
                    .where(and(...conditions))
                    .orderBy(desc(operationalCycles.createdAt))
                    .limit(Math.min(Number(limit) || 25, 100));

                if (rows.length === 0) {
                    return "No cycles are currently awaiting approval.";
                }
                return JSON.stringify(
                    {
                        count: rows.length,
                        cycles: rows.map(r => ({
                            id: r.id,
                            name: r.name,
                            priority: r.priority,
                            awaitingApprovalSince: r.createdAt,
                        })),
                    },
                    null,
                    2
                );
            } catch (e: any) {
                return `Failed to list pending cycles: ${e.message}`;
            }
        },
    },

    approve_cycle: {
        name: "approve_cycle",
        label: "Approve & Launch Cycle",
        group: "Operations",
        adminOnly: true,
        riskLevel: "high",
        sideEffects: ["database", "queue-message"],
        idempotency: "idempotent",
        approvalPolicy: {
            rationale: "Approving a cycle releases its autonomous mission fleet to begin executing.",
        },
        description:
            "Approve a staged (pending_approval) operational cycle and launch its mission fleet — the same as clicking 'Approve & Launch' on the cycle page. Requires org-admin or super-admin. Resolve the cycle id first with list_pending_cycles if the user gave a name.",
        parameters: z.object({
            cycleId: z.number().describe("ID of the cycle to approve. Use list_pending_cycles to resolve a name to an id."),
        }),
        execute: async ({ cycleId }: any, context: ToolContext) => {
            if (!context?.isAdmin && !context?.isOrgAdmin && !context?.isSuperAdmin) {
                return "Error: Admin permissions (org-admin or super-admin) are required to approve a cycle.";
            }

            try {
                const { db } = await import("@server/database_service.js");
                const { operationalCycles } = await import("@shared/schema/index.js");
                const { and, eq } = await import("drizzle-orm");
                const { CycleManagerService } = await import("../../../mission/core/cycle-manager.service.js");

                // Scope: org members can only approve their own org's cycles; super
                // admins may approve any. Mirrors requireOrgAdminOrSuper on the route.
                const conditions = [eq(operationalCycles.id, cycleId)];
                if (!context.isSuperAdmin && context.organizationId) {
                    conditions.push(eq(operationalCycles.organizationId, context.organizationId));
                }

                const [existing] = await db.select().from(operationalCycles).where(and(...conditions)).limit(1);
                if (!existing) {
                    return `Error: Cycle ${cycleId} not found or not in your organization.`;
                }
                if (existing.status !== "pending_approval") {
                    return `Cycle "${existing.name}" (id ${cycleId}) is not awaiting approval — current status is "${existing.status}". Nothing to approve.`;
                }

                const meta = (existing.metadata as any) || {};
                const durationDays = Number(meta.durationDays ?? meta.duration_days ?? 5);
                const startDate = new Date();
                const endDate = new Date(startDate.getTime() + durationDays * 24 * 60 * 60 * 1000);

                const [cycle] = await db
                    .update(operationalCycles)
                    .set({ status: "active", startDate, endDate, updatedAt: new Date() })
                    .where(and(...conditions))
                    .returning();

                // Spawn the blueprint fleet with dependency ordering. Run under the
                // CYCLE's own organization (not necessarily the approver's), matching
                // spawnBlueprintsWithDeps' documented contract.
                const blueprints = (cycle?.metadata as any)?.blueprints;
                if (blueprints && blueprints.length > 0) {
                    void CycleManagerService.spawnBlueprintsWithDeps(
                        cycleId,
                        blueprints,
                        context.userId || "agent",
                        cycle.organizationId ?? null,
                        cycle.priority ?? 5
                    ).catch(err => {
                        logger.error(`[approve_cycle] Spawn failed for cycle ${cycleId}: ${err?.message}`);
                    });
                }

                // Best-effort cache invalidation so the UI reflects the new status.
                try {
                    const { cacheService } = await import("@domain/cache/cache.service.js");
                    const { invalidateCachePattern } = await import("@server/utils/cache-utils.js");
                    void cacheService.invalidate(`cycle:metadata:${cycleId}`).catch(() => {});
                    const orgId = cycle.organizationId;
                    void invalidateCachePattern(orgId ? `cache:cycles:org:${orgId}:*` : "cache:cycles:org:*").catch(() => {});
                } catch { /* cache is best-effort */ }

                return JSON.stringify(
                    {
                        success: true,
                        cycleId,
                        name: cycle.name,
                        status: "active",
                        message: `Cycle "${cycle.name}" approved and launched. Its mission fleet is now spinning up.`,
                    },
                    null,
                    2
                );
            } catch (e: any) {
                return `Error approving cycle ${cycleId}: ${e.message}`;
            }
        },
    },

    mount_project_studio: {
        name: "mount_project_studio",
        idempotency: "read-safe",
        label: "Mount Project Studio",
        group: "Operations",
        riskLevel: "low",
        description:
            "Mounts Project Studio in the side rail beside the CREW conversation. Pass cycleId to reopen a saved " +
            "cycle's wave plan, or pass the plan (projectTitle, objective, waves) to open it for editing. With " +
            "neither, the studio opens empty — it never shows example data.",
        parameters: z.object({
            cycleId: z.number().int().positive().optional().describe("Saved cycle whose wave plan to reopen."),
            cycleName: z.string().optional().describe("Name of the operational cycle to inspect."),
            title: z.string().optional().describe("Title for the studio pod."),
            projectTitle: z.string().optional().describe("Plan title, when opening a new plan."),
            objective: z.string().optional().describe("Plan objective, when opening a new plan."),
            waves: z.array(planWaveSchema).max(100).optional()
                .describe("Waves of a new plan: id, name, waveNumber, objective, assignee, dependencies (predecessor wave ids), acceptanceCriteria."),
            budgetLimitUsd: z.number().min(0).optional(),
            tokenLimit: z.number().int().min(1).optional(),
            targetSlaDays: z.number().positive().optional(),
            maxParallelMissions: z.number().int().min(1).optional(),
        }),
        execute: async (params: {
            cycleId?: number; cycleName?: string; title?: string; projectTitle?: string; objective?: string;
            waves?: unknown[]; budgetLimitUsd?: number; tokenLimit?: number; targetSlaDays?: number; maxParallelMissions?: number;
        }) => {
            const { cycleId, cycleName, title } = params;
            const heading = title || cycleName || "Project Studio";
            const props = {
                cycleId,
                cycleName,
                title: heading,
                ...(params.projectTitle ? { projectTitle: params.projectTitle } : {}),
                ...(params.objective ? { objective: params.objective } : {}),
                ...(params.waves && params.waves.length > 0 ? { waves: params.waves } : {}),
                ...(params.budgetLimitUsd !== undefined ? { defaultBudgetLimitUsd: params.budgetLimitUsd } : {}),
                ...(params.tokenLimit !== undefined ? { defaultTokenLimit: params.tokenLimit } : {}),
                ...(params.targetSlaDays !== undefined ? { defaultTargetSlaDays: params.targetSlaDays } : {}),
                ...(params.maxParallelMissions !== undefined ? { defaultMaxParallelMissions: params.maxParallelMissions } : {}),
            };
            return JSON.stringify({
                type: "project_studio_pod",
                module: "ProjectStudioPod",
                component: "ProjectStudioPod",
                title: heading,
                cycleId,
                props,
            });
        },
    },
};
