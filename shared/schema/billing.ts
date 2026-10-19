
import { pgTable, serial, integer, timestamp, decimal } from "drizzle-orm/pg-core";
import { orgs } from './auth.js';
import { relations } from "drizzle-orm";

/**
 * Monthly Spend History
 * Captures a snapshot of organizational spend before each monthly reset.
 */
export const monthlySpendHistory = pgTable("monthly_spend_history", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").references(() => orgs.id).notNull(),

    month: integer("month").notNull(), // 0-11
    year: integer("year").notNull(),
    totalSpendUsd: decimal("total_spend_usd", { precision: 10, scale: 2 }).notNull(),
    budgetLimitUsd: decimal("budget_limit_usd", { precision: 10, scale: 2 }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const monthlySpendHistoryRelations = relations(monthlySpendHistory, ({ one }) => ({
    organization: one(orgs, {
        fields: [monthlySpendHistory.organizationId],
        references: [orgs.id],
    }),
}));


