/**
 * Slack notification history.
 *
 * Extracted from routes/integrations/slack/notification.routes.ts so the route
 * stops querying the database directly (lint:arch, Deep Module pattern).
 */
import { desc, eq } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { slackNotifications } from "@shared/schema/index.js";

export const slackNotificationService = {
    /** Notification history for an org, newest first. */
    async listForOrg(organizationId: number, limit: number, offset: number) {
        return await db
            .select()
            .from(slackNotifications)
            .where(eq(slackNotifications.organizationId, organizationId))
            .orderBy(desc(slackNotifications.createdAt))
            .limit(limit)
            .offset(offset);
    },
};
