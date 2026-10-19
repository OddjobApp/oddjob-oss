import { db } from "@server/database_service.js";
import { eq, and, isNull, inArray } from "drizzle-orm";
import {
    agentDeployments,
    type AgentDeployment,
    type AgentHierarchyNode,
    agentOrgRoles,
} from "@shared/schema/agent-deployments.js";
import { createLogger } from "@server/utils/logger.js";
import { z } from "zod";

const logger = createLogger("AgentHierarchyService");

// ============================================================================
// AGENT HIERARCHY SERVICE
// Manages the tenant-scoped agent org chart.
// Tenants (Orgs) ≡ Companies; Agents form a hierarchical reporting structure
// modelled by the self-referential `reportsToId` column on agentDeployments.
// ============================================================================

export const setReportsToPayload = z.object({
    supervisorId: z.number().int().positive().nullable(),
    orgRole: z.enum(agentOrgRoles).optional(),
});

export type SetReportsToPayload = z.infer<typeof setReportsToPayload>;

class AgentHierarchyService {
    /**
     * Returns the full org chart for a tenant as a recursive tree.
     * Root nodes (CEO / top-level) have reportsToId === null.
     */
    async getOrgHierarchy(orgId: number): Promise<AgentHierarchyNode[]> {
        const allAgents = await db
            .select({
                id: agentDeployments.id,
                slug: agentDeployments.slug,
                title: agentDeployments.title,
                orgRole: agentDeployments.orgRole,
                reportsToId: agentDeployments.reportsToId,
            })
            .from(agentDeployments)
            .where(
                and(
                    eq(agentDeployments.organizationId, orgId),
                    eq(agentDeployments.isActive, true),
                )
            );

        return this._buildTree(allAgents, null);
    }

    /**
     * Sets the supervisor for an agent, ensuring both belong to the same org.
     * Pass supervisorId = null to make the agent a root node.
     */
    async setReportsTo(
        agentId: number,
        orgId: number,
        payload: SetReportsToPayload,
    ): Promise<AgentDeployment> {
        const { supervisorId, orgRole } = payload;

        // Validate the agent exists in this org
        const [agent] = await db
            .select()
            .from(agentDeployments)
            .where(
                and(
                    eq(agentDeployments.id, agentId),
                    eq(agentDeployments.organizationId, orgId),
                )
            )
            .limit(1);

        if (!agent) {
            throw new Error(`Agent ${agentId} not found in org ${orgId}`);
        }

        // Validate the supervisor exists in the same org (if provided)
        if (supervisorId !== null) {
            const [supervisor] = await db
                .select({ id: agentDeployments.id })
                .from(agentDeployments)
                .where(
                    and(
                        eq(agentDeployments.id, supervisorId),
                        eq(agentDeployments.organizationId, orgId),
                    )
                )
                .limit(1);

            if (!supervisor) {
                throw new Error(
                    `Supervisor agent ${supervisorId} not found in org ${orgId}`,
                );
            }

            // Cycle detection: supervisor must not already report to this agent
            if (await this._wouldCreateCycle(agentId, supervisorId, orgId)) {
                throw new Error(
                    "Cannot set supervisor: would create a reporting cycle",
                );
            }
        }

        const updateFields: Partial<typeof agentDeployments.$inferInsert> = {
            reportsToId: supervisorId,
            updatedAt: new Date(),
        };

        if (orgRole) {
            updateFields.orgRole = orgRole;
        }

        const [updated] = await db
            .update(agentDeployments)
            .set(updateFields)
            .where(eq(agentDeployments.id, agentId))
            .returning();

        logger.info(
            `Agent ${agentId} now reports to ${supervisorId ?? "nobody (root)"} in org ${orgId}`,
        );

        return updated;
    }

    /**
     * Returns the flat list of subordinates (direct reports) for an agent.
     */
    async getDirectReports(
        agentId: number,
        orgId: number,
    ): Promise<AgentDeployment[]> {
        return db
            .select()
            .from(agentDeployments)
            .where(
                and(
                    eq(agentDeployments.reportsToId, agentId),
                    eq(agentDeployments.organizationId, orgId),
                )
            );
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    private _buildTree(
        agents: Array<{
            id: number;
            slug: string;
            title: string;
            orgRole: string | null;
            reportsToId: number | null;
        }>,
        parentId: number | null,
    ): AgentHierarchyNode[] {
        return agents
            .filter((a) => a.reportsToId === parentId)
            .map((a) => ({
                id: a.id,
                slug: a.slug,
                title: a.title,
                orgRole: a.orgRole,
                reportsToId: a.reportsToId,
                children: this._buildTree(agents, a.id),
            }));
    }

    /**
     * Walks up the supervisor chain from `candidateSupervisorId` to detect
     * if `agentId` would end up in the chain (cycle).
     */
    private async _wouldCreateCycle(
        agentId: number,
        candidateSupervisorId: number,
        orgId: number,
    ): Promise<boolean> {
        let current: number | null = candidateSupervisorId;
        const visited = new Set<number>();

        while (current !== null) {
            if (visited.has(current)) break; // guard infinite loop on existing bad data
            if (current === agentId) return true;
            visited.add(current);

            const [row] = await db
                .select({ reportsToId: agentDeployments.reportsToId })
                .from(agentDeployments)
                .where(
                    and(
                        eq(agentDeployments.id, current),
                        eq(agentDeployments.organizationId, orgId),
                    )
                )
                .limit(1);

            current = row?.reportsToId ?? null;
        }

        return false;
    }
}

export const agentHierarchyService = new AgentHierarchyService();
