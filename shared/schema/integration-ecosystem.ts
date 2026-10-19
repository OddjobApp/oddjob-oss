import { pgTable, text, serial, integer, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { orgs } from './auth.js';

export const saasIntegrations = pgTable("saas_integrations", {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    platform: text("platform").notNull(),
    type: text("type").notNull().default("webhook"),
    config: jsonb("config").default({}),
    organizationId: integer("organization_id").references(() => orgs.id, { onDelete: "cascade" }),
    isActive: boolean("is_active").default(true),
    lastSync: timestamp("last_sync").defaultNow(),
    syncFrequency: integer("sync_frequency").default(60),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    deletedAt: timestamp("deleted_at"),
});

export const integrationTemplates = pgTable("integration_templates", {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    platform: text("platform").notNull(),
    description: text("description"),
    category: text("category").notNull(),
    configSchema: jsonb("config_schema").default({}),
    webhookEndpoints: jsonb("webhook_endpoints").default([]),
    isPublic: boolean("is_public").default(true),
    usageCount: integer("usage_count").default(0),
    rating: integer("rating").default(0),
    tags: jsonb("tags").default([]),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull()
});

export const integrationEvents = pgTable("integration_events", {
    id: serial("id").primaryKey(),
    integrationId: integer("integration_id").references(() => saasIntegrations.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").default({}),
    status: text("status").notNull().default("pending"),
    errorMessage: text("error_message"),
    retryCount: integer("retry_count").default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    processedAt: timestamp("processed_at")
});

// Insert schemas
export const insertSaaSIntegrationSchema = createInsertSchema(saasIntegrations).omit({
    id: true,
    createdAt: true,
    updatedAt: true,
    deletedAt: true
});

export const insertIntegrationTemplateSchema = createInsertSchema(integrationTemplates).omit({
    id: true,
    createdAt: true,
    updatedAt: true
});

export const insertIntegrationEventSchema = createInsertSchema(integrationEvents).omit({
    id: true,
    createdAt: true,
    processedAt: true
});

// Select schemas
export const selectSaaSIntegrationSchema = createSelectSchema(saasIntegrations);
export const selectIntegrationTemplateSchema = createSelectSchema(integrationTemplates);
export const selectIntegrationEventSchema = createSelectSchema(integrationEvents);

// Types
export type SaaSIntegration = typeof saasIntegrations.$inferSelect;
export type IntegrationTemplate = typeof integrationTemplates.$inferSelect;
export type IntegrationEvent = typeof integrationEvents.$inferSelect;


