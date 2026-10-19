import {
    pgTable,
    text,
    serial,
    boolean,
    timestamp,
    integer,
    jsonb,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { pipelines } from './pipeline-core.js';

export const pipelineTriggers = pgTable("pipeline_triggers", {
    id: serial("id").primaryKey(),
    pipelineId: integer("pipeline_id")
        .notNull()
        .references(() => pipelines.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(), // e.g. "ticket.created", "ticket.analyzed"
    filterCondition: text("filter_condition"), // JS expression: "event.ticket.priority == 'high'"
    isActive: boolean("is_active").default(true).notNull(),
    description: text("description"),
    // Reactive Intelligence: Debouncing & Batching
    debounceWindow: integer("debounce_window").default(0), // Seconds to wait before firing (0 = immediate)
    batchSize: integer("batch_size").default(1), // Max events to bundle (1 = no batching)

    // Webhook Extensions
    mapPayload: boolean("map_payload").default(false),
    payloadMapping: jsonb("payload_mapping"), // e.g., { "pipeline_var": "webhook.body.data.id" }
    verificationMode: text("verification_mode").default("none"), // 'hmac', 'header_token', 'none'
    verificationConfig: jsonb("verification_config"), // { "header": "X-Hub-Signature", "secret": "..." }

    // Actions
    actionType: text("action_type").default("pipeline").notNull(), // 'pipeline', 'notification'
    notificationConfig: jsonb("notification_config"), // { channel: 'slack' | 'email', target: string, template?: string }

    createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertPipelineTriggerSchema = createInsertSchema(pipelineTriggers, {
    pipelineId: z.number().int().positive(),
    eventType: z.string().min(1),
    debounceWindow: z.number().int().min(0).max(3600).optional(), // Max 1 hour
    batchSize: z.number().int().min(1).max(1000).optional(), // Max 1000 events
    mapPayload: z.boolean().optional(),
    payloadMapping: z.any().optional(),
    verificationMode: z.string().optional(),
    verificationConfig: z.any().optional(),
}).omit({
    id: true,
    createdAt: true,
} as const);

export type InsertPipelineTrigger = z.infer<typeof insertPipelineTriggerSchema>;
export type PipelineTrigger = typeof pipelineTriggers.$inferSelect;


