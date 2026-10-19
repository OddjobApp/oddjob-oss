import { pgTable, serial, integer, timestamp, date, numeric, uniqueIndex } from "drizzle-orm/pg-core";
import { appDeployments } from './apps.js';

export const appAnalyticsDaily = pgTable("app_analytics_daily", {
    id: serial("id").primaryKey(),
    deploymentId: integer("deployment_id").notNull().references(() => appDeployments.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    launchCount: integer("launch_count").default(0).notNull(),
    uniqueUserCount: integer("unique_user_count").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    deploymentDateUnq: uniqueIndex("app_analytics_deployment_date_unq").on(table.deploymentId, table.date),
}));



