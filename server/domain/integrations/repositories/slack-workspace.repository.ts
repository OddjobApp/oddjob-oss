import { db } from "@server/database_service.js";
import { slackWorkspaces, type InsertSlackWorkspace, type SlackWorkspace } from "@shared/schema/integrations/slack.js";
import { eq, and, desc, sql } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("SlackWorkspaceRepository");

export const slackWorkspaceRepository = {
    /**
     * Find workspace by ID
     */
    async findById(id: number): Promise<SlackWorkspace | undefined> {
        const [workspace] = await db
            .select()
            .from(slackWorkspaces)
            .where(eq(slackWorkspaces.id, id))
            .limit(1);
        return workspace;
    },

    /**
     * Find workspace by team ID
     */
    async findByTeamId(teamId: string): Promise<SlackWorkspace | undefined> {
        const [workspace] = await db
            .select()
            .from(slackWorkspaces)
            .where(and(
                eq(slackWorkspaces.teamId, teamId),
                eq(slackWorkspaces.isActive, true)
            ))
            .limit(1);
        return workspace;
    },

    /**
     * Find active workspace by team ID
     */
    async findActiveByTeamId(teamId: string): Promise<SlackWorkspace | undefined> {
        const [workspace] = await db
            .select()
            .from(slackWorkspaces)
            .where(and(
                eq(slackWorkspaces.teamId, teamId),
                eq(slackWorkspaces.isActive, true)
            ))
            .limit(1);
        return workspace;
    },

    /**
     * List all workspaces for an organization
     */
    async findByOrganizationId(organizationId: number): Promise<SlackWorkspace[]> {
        return db
            .select()
            .from(slackWorkspaces)
            .where(eq(slackWorkspaces.organizationId, organizationId))
            .orderBy(desc(slackWorkspaces.installedAt));
    },

    /**
     * Create a new workspace
     */
    async create(data: InsertSlackWorkspace): Promise<SlackWorkspace> {
        const [workspace] = await db
            .insert(slackWorkspaces)
            .values(data)
            .returning();
        logger.info(`Created Slack workspace: ${workspace.teamName} (${workspace.id})`);
        return workspace;
    },

    /**
     * Update workspace by ID
     */
    async updateById(id: number, data: Partial<InsertSlackWorkspace>): Promise<SlackWorkspace | undefined> {
        const [workspace] = await db
            .update(slackWorkspaces)
            .set({ ...data, updatedAt: new Date() })
            .where(eq(slackWorkspaces.id, id))
            .returning();
        return workspace;
    },

    /**
     * Update workspace by team ID
     */
    async updateByTeamId(teamId: string, data: Partial<InsertSlackWorkspace>): Promise<SlackWorkspace | undefined> {
        const [workspace] = await db
            .update(slackWorkspaces)
            .set({ ...data, updatedAt: new Date() })
            .where(eq(slackWorkspaces.teamId, teamId))
            .returning();
        return workspace;
    },

    /**
     * Soft delete (deactivate) workspace
     */
    async deactivate(id: number): Promise<SlackWorkspace | undefined> {
        const [workspace] = await db
            .update(slackWorkspaces)
            .set({ isActive: false, updatedAt: new Date() })
            .where(eq(slackWorkspaces.id, id))
            .returning();
        logger.info(`Deactivated Slack workspace: ${id}`);
        return workspace;
    },

    /**
     * Delete workspace permanently
     */
    async deleteById(id: number): Promise<void> {
        await db
            .delete(slackWorkspaces)
            .where(eq(slackWorkspaces.id, id));
        logger.info(`Deleted Slack workspace: ${id}`);
    },

    /**
     * Count workspaces for organization
     */
    async countByOrganizationId(organizationId: number): Promise<number> {
        const result = await db
            .select({ count: sql<number>`count(*)` })
            .from(slackWorkspaces)
            .where(and(
                eq(slackWorkspaces.organizationId, organizationId),
                eq(slackWorkspaces.isActive, true)
            ));
        return Number(result[0]?.count || 0);
    },
};
