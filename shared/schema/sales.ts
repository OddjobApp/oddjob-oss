import { sql } from "drizzle-orm";
import {
    boolean,
    decimal,
    index,
    integer,
    jsonb,
    pgEnum,
    pgTable,
    serial,
    text,
    timestamp,
    uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { orgs } from "./auth.js";
import { prospectLeads } from "./prospecting.js";

export const SALES_STAGE_VALUES = [
    "PROSPECT",
    "QUALIFIED",
    "PROPOSAL",
    "NEGOTIATION",
    "CLOSED_WON",
    "CLOSED_LOST",
] as const;

export const SALES_LEAD_STATUS_VALUES = [
    "NEW",
    "QUALIFYING",
    "QUALIFIED",
    "DISQUALIFIED",
    "CONVERTED",
] as const;

export const SALES_ACTIVITY_TYPE_VALUES = [
    "REPLY",
    "MEETING",
    "DEMO",
    "PROPOSAL_OPENED",
    "CALL",
    "EMAIL_SENT",
    "STAGE_ADVANCED",
    "NOTE",
] as const;

export const SALES_WINDOW_STATUS_VALUES = ["ARMED", "DECAYING", "WON", "LOST"] as const;
export const SALES_REARM_EFFECT_VALUES = ["HOLD", "REBASELINE", "NONE"] as const;
export const SALES_RECOMMENDATION_KIND_VALUES = [
    "slip_risk",
    "stalled",
    "aging",
    "next_best_action",
    "win",
    "loss",
] as const;
export const SALES_RECOMMENDATION_STATUS_VALUES = ["OPEN", "ACTED", "SNOOZED", "DISMISSED"] as const;

export const salesStageEnum = pgEnum("sales_stage", SALES_STAGE_VALUES);
export const salesLeadStatusEnum = pgEnum("sales_lead_status", SALES_LEAD_STATUS_VALUES);
export const salesActivityTypeEnum = pgEnum("sales_activity_type", SALES_ACTIVITY_TYPE_VALUES);
export const salesWindowStatusEnum = pgEnum("sales_window_status", SALES_WINDOW_STATUS_VALUES);
export const salesRearmEffectEnum = pgEnum("sales_rearm_effect", SALES_REARM_EFFECT_VALUES);
export const salesRecommendationKindEnum = pgEnum("sales_recommendation_kind", SALES_RECOMMENDATION_KIND_VALUES);
export const salesRecommendationStatusEnum = pgEnum("sales_recommendation_status", SALES_RECOMMENDATION_STATUS_VALUES);

export const salesAccounts = pgTable("sales_accounts", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").references(() => orgs.id, { onDelete: "cascade" }).notNull(),
    accountKey: text("account_key").notNull(),
    name: text("name").notNull(),
    domain: text("domain"),
    industry: text("industry"),
    segment: text("segment"),
    ownerRep: text("owner_rep"),
    externalCrmId: text("external_crm_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    orgAccountKeyIdx: uniqueIndex("sales_accounts_org_key_idx").on(table.organizationId, table.accountKey),
    orgNameIdx: index("sales_accounts_org_name_idx").on(table.organizationId, table.name),
    externalCrmIdx: index("sales_accounts_external_crm_idx").on(table.externalCrmId),
}));

export const salesContacts = pgTable("sales_contacts", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").references(() => orgs.id, { onDelete: "cascade" }).notNull(),
    accountId: integer("account_id").references(() => salesAccounts.id, { onDelete: "cascade" }),
    contactKey: text("contact_key").notNull(),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    title: text("title"),
    role: text("role"),
    isPrimary: boolean("is_primary").default(false).notNull(),
    externalCrmId: text("external_crm_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    orgContactKeyIdx: uniqueIndex("sales_contacts_org_key_idx").on(table.organizationId, table.contactKey),
    accountIdx: index("sales_contacts_account_idx").on(table.accountId),
    emailIdx: index("sales_contacts_email_idx").on(table.organizationId, table.email),
}));

export const salesLeads = pgTable("sales_leads", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").references(() => orgs.id, { onDelete: "cascade" }).notNull(),
    prospectLeadId: integer("prospect_lead_id").references(() => prospectLeads.id, { onDelete: "set null" }),
    leadKey: text("lead_key").notNull(),
    name: text("name").notNull(),
    company: text("company"),
    email: text("email"),
    phone: text("phone"),
    source: text("source"),
    estimatedValue: decimal("estimated_value", { precision: 14, scale: 2 }).default("0").notNull(),
    timeline: text("timeline"),
    status: salesLeadStatusEnum("status").default("NEW").notNull(),
    qualificationScore: decimal("qualification_score", { precision: 5, scale: 4 }),
    convertedAccountId: integer("converted_account_id").references(() => salesAccounts.id, { onDelete: "set null" }),
    convertedContactId: integer("converted_contact_id").references(() => salesContacts.id, { onDelete: "set null" }),
    convertedOpportunityId: integer("converted_opportunity_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    orgLeadKeyIdx: uniqueIndex("sales_leads_org_key_idx").on(table.organizationId, table.leadKey),
    prospectLeadIdx: index("sales_leads_prospect_lead_idx").on(table.prospectLeadId),
    orgStatusIdx: index("sales_leads_org_status_idx").on(table.organizationId, table.status),
}));

export const salesOpportunities = pgTable("sales_opportunities", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").references(() => orgs.id, { onDelete: "cascade" }).notNull(),
    accountId: integer("account_id").references(() => salesAccounts.id, { onDelete: "restrict" }).notNull(),
    leadId: integer("lead_id").references(() => salesLeads.id, { onDelete: "set null" }),
    opportunityKey: text("opportunity_key").notNull(),
    name: text("name").notNull(),
    amount: decimal("amount", { precision: 14, scale: 2 }).default("0").notNull(),
    currency: text("currency").default("USD").notNull(),
    stage: salesStageEnum("stage").default("PROSPECT").notNull(),
    stageEntitlement: integer("stage_entitlement").default(90).notNull(),
    ownerRep: text("owner_rep"),
    expectedClose: timestamp("expected_close"),
    outcome: text("outcome").$type<"won" | "lost" | null>(),
    closedAt: timestamp("closed_at"),
    externalCrmId: text("external_crm_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
    openedAt: timestamp("opened_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    orgOpportunityKeyIdx: uniqueIndex("sales_opportunities_org_key_idx").on(table.organizationId, table.opportunityKey),
    accountIdx: index("sales_opportunities_account_idx").on(table.accountId),
    orgStageIdx: index("sales_opportunities_org_stage_idx").on(table.organizationId, table.stage),
    ownerIdx: index("sales_opportunities_owner_idx").on(table.organizationId, table.ownerRep),
}));

export const salesActivities = pgTable("sales_activities", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").references(() => orgs.id, { onDelete: "cascade" }).notNull(),
    opportunityId: integer("opportunity_id").references(() => salesOpportunities.id, { onDelete: "cascade" }).notNull(),
    activityKey: text("activity_key").notNull(),
    type: salesActivityTypeEnum("type").notNull(),
    occurredAt: timestamp("occurred_at").notNull(),
    actor: text("actor"),
    summary: text("summary"),
    isRearmSignal: boolean("is_rearm_signal").default(false).notNull(),
    rearmEffect: salesRearmEffectEnum("rearm_effect").default("NONE").notNull(),
    weight: decimal("weight", { precision: 6, scale: 2 }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
    orgActivityKeyIdx: uniqueIndex("sales_activities_org_key_idx").on(table.organizationId, table.activityKey),
    opportunityIdx: index("sales_activities_opportunity_idx").on(table.opportunityId),
    occurredAtIdx: index("sales_activities_occurred_at_idx").on(table.organizationId, table.occurredAt),
}));

export const salesStageHistory = pgTable("sales_stage_history", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").references(() => orgs.id, { onDelete: "cascade" }).notNull(),
    opportunityId: integer("opportunity_id").references(() => salesOpportunities.id, { onDelete: "cascade" }).notNull(),
    fromStage: salesStageEnum("from_stage"),
    toStage: salesStageEnum("to_stage").notNull(),
    changedAt: timestamp("changed_at").defaultNow().notNull(),
    changedBy: text("changed_by"),
    reason: text("reason"),
}, (table) => ({
    opportunityIdx: index("sales_stage_history_opportunity_idx").on(table.opportunityId),
    changedAtIdx: index("sales_stage_history_changed_at_idx").on(table.organizationId, table.changedAt),
}));

export const salesOpportunityWindows = pgTable("sales_opportunity_windows", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").references(() => orgs.id, { onDelete: "cascade" }).notNull(),
    opportunityId: integer("opportunity_id").references(() => salesOpportunities.id, { onDelete: "cascade" }).notNull(),
    windowKey: text("window_key").notNull(),
    amount: decimal("amount", { precision: 14, scale: 2 }).default("0").notNull(),
    openedAt: timestamp("opened_at").defaultNow().notNull(),
    cycleLengthDays: integer("cycle_length_days").notNull(),
    gateLadder: jsonb("gate_ladder").$type<number[]>().default([90, 60, 30, 0]).notNull(),
    currentGateIndex: integer("current_gate_index").default(0).notNull(),
    currentCeiling: integer("current_ceiling").default(90).notNull(),
    nextGateDeadline: timestamp("next_gate_deadline").notNull(),
    gracePeriodHours: integer("grace_period_hours").default(0).notNull(),
    rearmSignals: jsonb("rearm_signals").$type<string[]>().default(["REPLY", "MEETING", "DEMO", "PROPOSAL_OPENED", "STAGE_ADVANCED"]).notNull(),
    lastRearmAt: timestamp("last_rearm_at"),
    status: salesWindowStatusEnum("status").default("ARMED").notNull(),
    outcome: text("outcome").$type<"won" | "lost" | null>(),
    closedAt: timestamp("closed_at"),
}, (table) => ({
    orgWindowKeyIdx: uniqueIndex("sales_opportunity_windows_org_key_idx").on(table.organizationId, table.windowKey),
    opportunityIdx: index("sales_opportunity_windows_opportunity_idx").on(table.opportunityId),
    statusDeadlineIdx: index("sales_opportunity_windows_status_deadline_idx").on(table.status, table.nextGateDeadline),
}));

export const salesWindowSnapshots = pgTable("sales_window_snapshots", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").references(() => orgs.id, { onDelete: "cascade" }).notNull(),
    windowId: integer("window_id").references(() => salesOpportunityWindows.id, { onDelete: "cascade" }).notNull(),
    opportunityId: integer("opportunity_id").references(() => salesOpportunities.id, { onDelete: "cascade" }).notNull(),
    snapshotKey: text("snapshot_key").notNull(),
    takenAt: timestamp("taken_at").defaultNow().notNull(),
    gateIndex: integer("gate_index").notNull(),
    ceilingBefore: integer("ceiling_before").notNull(),
    ceilingAfter: integer("ceiling_after").notNull(),
    amountAtSnapshot: decimal("amount_at_snapshot", { precision: 14, scale: 2 }).default("0").notNull(),
    weightedValue: decimal("weighted_value", { precision: 14, scale: 2 }).default("0").notNull(),
    trigger: text("trigger").notNull(),
    realizedOutcome: integer("realized_outcome"),
}, (table) => ({
    orgSnapshotKeyIdx: uniqueIndex("sales_window_snapshots_org_key_idx").on(table.organizationId, table.snapshotKey),
    windowIdx: index("sales_window_snapshots_window_idx").on(table.windowId),
    takenAtIdx: index("sales_window_snapshots_taken_at_idx").on(table.organizationId, table.takenAt),
}));

export const salesForecasts = pgTable("sales_forecasts", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").references(() => orgs.id, { onDelete: "cascade" }).notNull(),
    forecastKey: text("forecast_key").notNull(),
    period: text("period").notNull(),
    generatedAt: timestamp("generated_at").defaultNow().notNull(),
    weightedPipeline: decimal("weighted_pipeline", { precision: 14, scale: 2 }).default("0").notNull(),
    committed: decimal("committed", { precision: 14, scale: 2 }).default("0").notNull(),
    bestCase: decimal("best_case", { precision: 14, scale: 2 }).default("0").notNull(),
    dealCount: integer("deal_count").default(0).notNull(),
    generatedBy: text("generated_by"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
}, (table) => ({
    orgForecastKeyIdx: uniqueIndex("sales_forecasts_org_key_idx").on(table.organizationId, table.forecastKey),
    periodIdx: index("sales_forecasts_period_idx").on(table.organizationId, table.period),
}));

export const salesQuotas = pgTable("sales_quotas", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").references(() => orgs.id, { onDelete: "cascade" }).notNull(),
    quotaKey: text("quota_key").notNull(),
    ownerRep: text("owner_rep").notNull(),
    period: text("period").notNull(),
    targetAmount: decimal("target_amount", { precision: 14, scale: 2 }).default("0").notNull(),
    attainment: decimal("attainment", { precision: 8, scale: 4 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    orgQuotaKeyIdx: uniqueIndex("sales_quotas_org_key_idx").on(table.organizationId, table.quotaKey),
    ownerPeriodIdx: index("sales_quotas_owner_period_idx").on(table.organizationId, table.ownerRep, table.period),
}));

export const salesRecommendations = pgTable("sales_recommendations_domain", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").references(() => orgs.id, { onDelete: "cascade" }).notNull(),
    opportunityId: integer("opportunity_id").references(() => salesOpportunities.id, { onDelete: "cascade" }).notNull(),
    recommendationKey: text("recommendation_key").notNull(),
    kind: salesRecommendationKindEnum("kind").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    status: salesRecommendationStatusEnum("status").default("OPEN").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    orgRecommendationKeyIdx: uniqueIndex("sales_recommendations_domain_org_key_idx").on(table.organizationId, table.recommendationKey),
    opportunityIdx: index("sales_recommendations_domain_opportunity_idx").on(table.opportunityId),
    statusIdx: index("sales_recommendations_domain_status_idx").on(table.organizationId, table.status),
}));

const moneyString = z.union([z.string(), z.number()]).transform((value) => String(value));

export const insertSalesAccountSchema = createInsertSchema(salesAccounts);
export const selectSalesAccountSchema = createSelectSchema(salesAccounts);
export const insertSalesContactSchema = createInsertSchema(salesContacts);
export const selectSalesContactSchema = createSelectSchema(salesContacts);
export const insertSalesLeadSchema = createInsertSchema(salesLeads, {
    estimatedValue: moneyString.optional(),
    qualificationScore: moneyString.optional().nullable(),
});
export const selectSalesLeadSchema = createSelectSchema(salesLeads);
export const insertSalesOpportunitySchema = createInsertSchema(salesOpportunities, {
    amount: moneyString.optional(),
});
export const selectSalesOpportunitySchema = createSelectSchema(salesOpportunities);
export const insertSalesActivitySchema = createInsertSchema(salesActivities);
export const selectSalesActivitySchema = createSelectSchema(salesActivities);
export const insertSalesStageHistorySchema = createInsertSchema(salesStageHistory);
export const selectSalesStageHistorySchema = createSelectSchema(salesStageHistory);
export const insertSalesOpportunityWindowSchema = createInsertSchema(salesOpportunityWindows, {
    amount: moneyString.optional(),
});
export const selectSalesOpportunityWindowSchema = createSelectSchema(salesOpportunityWindows);
export const insertSalesWindowSnapshotSchema = createInsertSchema(salesWindowSnapshots, {
    amountAtSnapshot: moneyString.optional(),
    weightedValue: moneyString.optional(),
});
export const selectSalesWindowSnapshotSchema = createSelectSchema(salesWindowSnapshots);
export const insertSalesForecastSchema = createInsertSchema(salesForecasts, {
    weightedPipeline: moneyString.optional(),
    committed: moneyString.optional(),
    bestCase: moneyString.optional(),
});
export const selectSalesForecastSchema = createSelectSchema(salesForecasts);
export const insertSalesQuotaSchema = createInsertSchema(salesQuotas, {
    targetAmount: moneyString.optional(),
    attainment: moneyString.optional().nullable(),
});
export const selectSalesQuotaSchema = createSelectSchema(salesQuotas);
export const insertSalesRecommendationSchema = createInsertSchema(salesRecommendations);
export const selectSalesRecommendationSchema = createSelectSchema(salesRecommendations);

export type SalesStage = (typeof SALES_STAGE_VALUES)[number];
export type SalesLeadStatus = (typeof SALES_LEAD_STATUS_VALUES)[number];
export type SalesActivityType = (typeof SALES_ACTIVITY_TYPE_VALUES)[number];
export type SalesWindowStatus = (typeof SALES_WINDOW_STATUS_VALUES)[number];
export type SalesRearmEffect = (typeof SALES_REARM_EFFECT_VALUES)[number];
export type SalesRecommendationKind = (typeof SALES_RECOMMENDATION_KIND_VALUES)[number];
export type SalesRecommendationStatus = (typeof SALES_RECOMMENDATION_STATUS_VALUES)[number];

export type SalesAccount = typeof salesAccounts.$inferSelect;
export type InsertSalesAccount = typeof salesAccounts.$inferInsert;
export type SalesContact = typeof salesContacts.$inferSelect;
export type InsertSalesContact = typeof salesContacts.$inferInsert;
export type SalesLead = typeof salesLeads.$inferSelect;
export type InsertSalesLead = typeof salesLeads.$inferInsert;
export type SalesOpportunity = typeof salesOpportunities.$inferSelect;
export type InsertSalesOpportunity = typeof salesOpportunities.$inferInsert;
export type SalesActivity = typeof salesActivities.$inferSelect;
export type InsertSalesActivity = typeof salesActivities.$inferInsert;
export type SalesStageHistory = typeof salesStageHistory.$inferSelect;
export type InsertSalesStageHistory = typeof salesStageHistory.$inferInsert;
export type SalesOpportunityWindow = typeof salesOpportunityWindows.$inferSelect;
export type InsertSalesOpportunityWindow = typeof salesOpportunityWindows.$inferInsert;
export type SalesWindowSnapshot = typeof salesWindowSnapshots.$inferSelect;
export type InsertSalesWindowSnapshot = typeof salesWindowSnapshots.$inferInsert;
export type SalesForecast = typeof salesForecasts.$inferSelect;
export type InsertSalesForecast = typeof salesForecasts.$inferInsert;
export type SalesQuota = typeof salesQuotas.$inferSelect;
export type InsertSalesQuota = typeof salesQuotas.$inferInsert;
export type SalesRecommendationRecord = typeof salesRecommendations.$inferSelect;
export type InsertSalesRecommendationRecord = typeof salesRecommendations.$inferInsert;
