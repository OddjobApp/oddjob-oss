/**
 * Slack Command Repository
 * Handles database operations for Slack slash commands
 */

import { db } from "@server/database_service.js";
import { slackCommands, type InsertSlackCommand, type SlackCommand } from "@shared/schema/integrations/slack.js";
import { eq, and, desc, lt, sql } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("SlackCommandRepository");

export const slackCommandRepository = {
    /**
     * Find command by ID
     */
    async findById(id: number): Promise<SlackCommand | undefined> {
        const [command] = await db
            .select()
            .from(slackCommands)
            .where(eq(slackCommands.id, id))
            .limit(1);
        return command;
    },

    /**
     * List commands for a workspace
     */
    async findByWorkspaceId(workspaceId: number, limit: number = 50): Promise<SlackCommand[]> {
        return db
            .select()
            .from(slackCommands)
            .where(eq(slackCommands.workspaceId, workspaceId))
            .orderBy(desc(slackCommands.createdAt))
            .limit(limit);
    },

    /**
     * List commands for an organization
     */
    async findByOrganizationId(organizationId: number, limit: number = 50): Promise<SlackCommand[]> {
        return db
            .select()
            .from(slackCommands)
            .where(eq(slackCommands.organizationId, organizationId))
            .orderBy(desc(slackCommands.createdAt))
            .limit(limit);
    },

    /**
     * Create a new command log entry
     */
    async create(data: InsertSlackCommand): Promise<SlackCommand> {
        const [command] = await db
            .insert(slackCommands)
            .values(data)
            .returning();
        logger.debug(`Logged Slack command: ${command.command} from team ${command.teamId}`);
        return command;
    },

    /**
     * Update command response
     */
    async updateResponse(id: number, responseBody: any, responseStatus: string = "sent"): Promise<SlackCommand | undefined> {
        const [command] = await db
            .update(slackCommands)
            .set({ responseBody, responseStatus })
            .where(eq(slackCommands.id, id))
            .returning();
        return command;
    },

    /**
     * Delete old command logs (for cleanup)
     */
    async deleteOlderThan(date: Date): Promise<number> {
        const result = await db
            .delete(slackCommands)
            .where(lt(slackCommands.createdAt, date))
            .returning();
        return result.length;
    },

    /**
     * Count commands for workspace
     */
    async countByWorkspaceId(workspaceId: number): Promise<number> {
        const result = await db
            .select({ count: sql<number>`count(*)` })
            .from(slackCommands)
            .where(eq(slackCommands.workspaceId, workspaceId));
        return Number(result[0]?.count || 0);
    },
};
