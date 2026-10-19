import { z } from "zod";
import { eq } from "drizzle-orm";
import type { ToolDefinition, ToolContext } from "./types.js";
import { createLogger } from "@server/utils/logger.js";
import { projectService } from "@domain/projects/core/project.service.js";
import { db } from "@server/database_service.js";
import { orgSettings } from "@shared/schema/index.js";
import { requireToolOrgId } from "./org-context.js";

const logger = createLogger("ProjectBudgetTools");

/**
 * Org-wide spend, for callers with no project in scope.
 *
 * A CREW room that is not bound to a Project Space has no projectKey, so asking
 * this tool for spend used to return `{ error: "Project key or ID is
 * required" }` — which is how "Spend data is not available" ended up on a
 * status deck for a platform that tracks spend perfectly well. The org budget
 * guardrail is the right answer to "what are we spending"; it just is not the
 * project one, so the shape says which it is.
 */
async function getOrganizationSpend(organizationId: number) {
    const [settings] = await db
        .select({
            spend: orgSettings.currentMonthSpendUsd,
            cap: orgSettings.monthlyBudgetUsd,
            resetDay: orgSettings.budgetResetDay,
            lastResetAt: orgSettings.lastBudgetResetAt,
        })
        .from(orgSettings)
        .where(eq(orgSettings.organizationId, organizationId))
        .limit(1);

    if (!settings) {
        return {
            scope: "organization" as const,
            organizationId,
            configured: false,
            note: "No budget settings exist for this organization, so no spend is being tracked at the org level.",
        };
    }

    // `decimal` columns come back as strings from drizzle, not numbers.
    const spendToDateUsd = Number(settings.spend ?? 0);
    const budgetLimitUsd = settings.cap === null ? null : Number(settings.cap);

    return {
        scope: "organization" as const,
        organizationId,
        configured: true,
        spendToDateUsd,
        budgetLimitUsd,
        remainingUsd: budgetLimitUsd === null ? null : budgetLimitUsd - spendToDateUsd,
        budgetResetDay: settings.resetDay,
        lastBudgetResetAt: settings.lastResetAt,
        note: "Organization-wide spend for the current billing month. No project was in scope, so this is not project-specific.",
    };
}

export const PROJECT_BUDGET_TOOLS: Record<string, ToolDefinition> = {
    get_project_spend: {
        name: "get_project_spend",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "Get Project Spend",
        group: "Project Budget",
        description:
            "Retrieves current spend, budget cap and remaining USD. Scoped to a Project Space when one is " +
            "given or active in context; otherwise falls back to organization-wide spend for the current " +
            "billing month. The result carries a `scope` field saying which you got.",
        parameters: z.object({
            projectKey: z.string().optional().describe("Project Key or ID (defaults to the active project in context; omit for organization-wide spend)"),
        }),
        execute: async ({ projectKey }: { projectKey?: string }, context: ToolContext) => {
            try {
                const orgId = requireToolOrgId(context);
                const ctx = { organizationId: orgId, userId: context.userId };
                const targetKey = projectKey || context.projectKey || context.projectId;

                if (!targetKey) {
                    return JSON.stringify(await getOrganizationSpend(orgId));
                }

                const spend = await projectService.getProjectSpend(ctx, targetKey);
                return JSON.stringify({ scope: "project" as const, ...spend });
            } catch (err: any) {
                // A project that cannot be read is not the same as no project
                // being in scope: fall back rather than fail, but say so.
                if (projectKey || context.projectKey || context.projectId) {
                    logger.warn(`Project spend lookup failed (${err.message}); falling back to organization spend.`);
                    const orgSpend = await getOrganizationSpend(requireToolOrgId(context));
                    return JSON.stringify({
                        ...orgSpend,
                        note: `${orgSpend.note} The requested project could not be read: ${err.message}`,
                    });
                }
                throw new Error(`Failed to fetch spend: ${err.message}`);
            }
        }
    },

    set_project_budget_cap: {
        name: "set_project_budget_cap",

        idempotency: "idempotent",
        label: "Set Project Budget Cap",
        group: "Project Budget",
        description: "Sets or updates the financial budget limit (USD) for a Project Space.",
        parameters: z.object({
            projectKey: z.string().describe("Project Key (e.g. 'rescue-dispatch')"),
            budgetLimitUsd: z.number().min(0).describe("Budget limit in USD (e.g. 25.00)"),
        }),
        execute: async ({ projectKey, budgetLimitUsd }: { projectKey: string; budgetLimitUsd: number }, context: ToolContext) => {
            try {
                const orgId = requireToolOrgId(context);
                const ctx = { organizationId: orgId, userId: context.userId };

                const updated = await projectService.updateProject(ctx, projectKey, {
                    budgetLimitUsd: budgetLimitUsd.toString(),
                });

                return JSON.stringify({
                    success: true,
                    projectKey: updated.key,
                    name: updated.name,
                    budgetLimitUsd: updated.budgetLimitUsd ? Number(updated.budgetLimitUsd) : null,
                });
            } catch (err: any) {
                return `Failed to update project budget cap: ${err.message}`;
            }
        }
    }
};
