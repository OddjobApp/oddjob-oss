import {
    pgTable,
    text,
    serial,
    timestamp,
    integer,
    jsonb,
    boolean,
    index,
} from "drizzle-orm/pg-core";
import { z } from "zod";

import { orgs } from '../auth.js';

// Event Log Table (CloudEvents Audit Trail)
export const eventLog = pgTable("event_log", {
    id: serial("id").primaryKey(),
    eventId: text("event_id").notNull().unique(), // UUID v4
    type: text("type").notNull(),                 // CloudEvent type: 'competitor.price_changed', 'job.completed'
    source: text("source").notNull(),             // Origin: 'pipeline:123', 'job:456'
    subject: text("subject"),                     // Optional: affected entity 'node:789'
    payload: jsonb("payload").notNull(),          // The event data (diff, context, etc.)
    organizationId: integer("organization_id").references(() => orgs.id, { onDelete: "cascade" }),
    emittedAt: timestamp("emitted_at").defaultNow().notNull(),
}, (table) => ({
    typeIdx: index("event_type_idx").on(table.type),
    sourceIdx: index("event_source_idx").on(table.source),
    timeIdx: index("event_time_idx").on(table.emittedAt),
}));

export type EventLogEntry = typeof eventLog.$inferSelect;
export type InsertEventLogEntry = typeof eventLog.$inferInsert;

export const insertEventLogSchema = z.object({
    eventId: z.string().uuid(),
    type: z.string().min(1).max(200),
    source: z.string().min(1).max(500),
    subject: z.string().max(500).optional().nullable(),
    payload: z.record(z.any()),
    organizationId: z.number().int().positive().optional().nullable(),
});

// Event Webhook Subscriptions Table
export const eventWebhookSubscriptions = pgTable("event_webhook_subscriptions", {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    eventTypePattern: text("event_type_pattern").notNull(), // Glob pattern: "ticket.*", "pipeline.completed", "*"
    webhookUrl: text("webhook_url").notNull(), // Target URL
    httpMethod: text("http_method").notNull().default("POST"), // POST, PUT, PATCH
    headers: jsonb("headers").default({}), // Custom headers: {"Authorization": "Bearer xxx", "X-Custom": "value"}
    payloadTemplate: text("payload_template"), // Optional Handlebars/JSON template for transforming payload
    isActive: boolean("is_active").default(true).notNull(),
    retryCount: integer("retry_count").default(3).notNull(), // Number of retries on failure
    retryDelayMs: integer("retry_delay_ms").default(5000).notNull(), // Delay between retries
    timeoutMs: integer("timeout_ms").default(30000).notNull(), // Request timeout
    lastTriggeredAt: timestamp("last_triggered_at"),
    lastSuccess: boolean("last_success"),
    lastError: text("last_error"),
    successCount: integer("success_count").default(0).notNull(),
    failureCount: integer("failure_count").default(0).notNull(),
    organizationId: integer("organization_id").references(() => orgs.id, { onDelete: "cascade" }),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    eventTypeIdx: index("webhook_sub_event_type_idx").on(table.eventTypePattern),
    activeIdx: index("webhook_sub_active_idx").on(table.isActive),
    orgIdx: index("webhook_sub_org_idx").on(table.organizationId),
}));

export const insertEventWebhookSubscriptionSchema = z.object({
    name: z.string().min(1, "Name is required").max(200),
    description: z.string().max(1000).optional().nullable(),
    eventTypePattern: z.string().min(1, "Event type pattern is required").max(200),
    webhookUrl: z.string().url("Must be a valid URL"),
    httpMethod: z.enum(["POST", "PUT", "PATCH"]).optional().default("POST"),
    headers: z.record(z.string()).optional().default({}),
    payloadTemplate: z.string().max(10000).optional().nullable(),
    isActive: z.boolean().optional().default(true),
    retryCount: z.number().int().min(0).max(10).optional().default(3),
    retryDelayMs: z.number().int().min(100).max(60000).optional().default(5000),
    timeoutMs: z.number().int().min(1000).max(120000).optional().default(30000),
    organizationId: z.number().int().positive().optional().nullable(),
    createdBy: z.string().optional().nullable(),
});

export type EventWebhookSubscription = typeof eventWebhookSubscriptions.$inferSelect;
export type InsertEventWebhookSubscription = z.infer<typeof insertEventWebhookSubscriptionSchema>;

// Webhook Delivery Log Table
export const webhookDeliveryLog = pgTable("webhook_delivery_log", {
    id: serial("id").primaryKey(),
    subscriptionId: integer("subscription_id")
        .notNull()
        .references(() => eventWebhookSubscriptions.id, { onDelete: "cascade" }),
    eventId: text("event_id").notNull(),
    eventType: text("event_type").notNull(),
    attemptNumber: integer("attempt_number").notNull().default(1),
    status: text("status").notNull(), // "pending", "success", "failed", "retrying"
    httpStatus: integer("http_status"),
    responseBody: text("response_body"),
    error: text("error"),
    requestDurationMs: integer("request_duration_ms"),
    sentAt: timestamp("sent_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
}, (table) => ({
    subscriptionIdx: index("webhook_delivery_sub_idx").on(table.subscriptionId),
    eventIdx: index("webhook_delivery_event_idx").on(table.eventId),
    statusIdx: index("webhook_delivery_status_idx").on(table.status),
}));

export type WebhookDeliveryLog = typeof webhookDeliveryLog.$inferSelect;
export type InsertWebhookDeliveryLog = typeof webhookDeliveryLog.$inferInsert;



