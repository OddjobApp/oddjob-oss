import { db } from "@server/database_service.js";
import { slackNotifications, type InsertSlackNotification, type SlackNotification } from "@shared/schema/integrations/slack.js";
import { eq, and, desc, sql } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("SlackNotificationRepository");

export const slackNotificationRepository = {
    /**
     * Find notification by ID
     */
    async findById(id: number): Promise<SlackNotification | undefined> {
        const [notification] = await db
            .select()
            .from(slackNotifications)
            .where(eq(slackNotifications.id, id))
            .limit(1);
        return notification;
    },

    /**
     * List notifications for a workspace
     */
    async findByWorkspaceId(workspaceId: number, limit: number = 50): Promise<SlackNotification[]> {
        return db
            .select()
            .from(slackNotifications)
            .where(eq(slackNotifications.workspaceId, workspaceId))
            .orderBy(desc(slackNotifications.createdAt))
            .limit(limit);
    },

    /**
     * List notifications for an organization
     */
    async findByOrganizationId(organizationId: number, limit: number = 50): Promise<SlackNotification[]> {
        return db
            .select()
            .from(slackNotifications)
            .where(eq(slackNotifications.organizationId, organizationId))
            .orderBy(desc(slackNotifications.createdAt))
            .limit(limit);
    },

    /**
     * List failed notifications that should be retried
     */
    async findFailedForRetry(limit: number = 10): Promise<SlackNotification[]> {
        return db
            .select()
            .from(slackNotifications)
            .where(eq(slackNotifications.deliveryStatus, "failed"))
            .orderBy(desc(slackNotifications.createdAt))
            .limit(limit);
    },

    /**
     * Create a new notification
     */
    async create(data: InsertSlackNotification): Promise<SlackNotification> {
        const [notification] = await db
            .insert(slackNotifications)
            .values(data)
            .returning();
        logger.debug(`Created Slack notification: ${notification.id} (${notification.type})`);
        return notification;
    },

    /**
     * Update notification status
     */
    async updateStatus(
        id: number,
        status: "pending" | "delivered" | "failed",
        errorMessage?: string
    ): Promise<SlackNotification | undefined> {
        const [notification] = await db
            .update(slackNotifications)
            .set({
                deliveryStatus: status,
                errorMessage,
                deliveredAt: status === "delivered" ? new Date() : undefined,
            })
            .where(eq(slackNotifications.id, id))
            .returning();
        return notification;
    },

    /**
     * Mark notification as delivered
     */
    async markDelivered(id: number): Promise<SlackNotification | undefined> {
        const [notification] = await db
            .update(slackNotifications)
            .set({
                deliveryStatus: "delivered",
                deliveredAt: new Date(),
            })
            .where(eq(slackNotifications.id, id))
            .returning();
        logger.debug(`Marked notification as delivered: ${id}`);
        return notification;
    },

    /**
     * Delete old notifications (for cleanup)
     */
    async deleteOlderThan(date: Date): Promise<number> {
        const result = await db
            .delete(slackNotifications)
            .where(sql`${slackNotifications.createdAt} < ${date}`);
        return result.rowCount ?? 0;
    },

    /**
     * Get notification statistics
     */
    async getStats(organizationId: number): Promise<{
        total: number;
        delivered: number;
        failed: number;
    }> {
        const stats = await db
            .select({
                status: slackNotifications.deliveryStatus,
                count: sql<number>`count(*)`,
            })
            .from(slackNotifications)
            .where(eq(slackNotifications.organizationId, organizationId))
            .groupBy(slackNotifications.deliveryStatus);

        return {
            total: stats.reduce((acc, s) => acc + Number(s.count), 0),
            delivered: stats.filter(s => s.status === "delivered").reduce((acc, s) => acc + Number(s.count), 0),
            failed: stats.filter(s => s.status === "failed").reduce((acc, s) => acc + Number(s.count), 0),
        };
    },
};
