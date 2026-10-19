import {
    pgTable,
    serial,
    integer,
    varchar,
    text,
    boolean,
    jsonb,
    timestamp,
    index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { orgs } from "./auth.js";
import { agentDeployments } from "./agent-deployments.js";

// ============================================================================
// HEARTBEAT SOURCE TYPES
// Defines which external sources the daemon can poll per-trigger.
// ============================================================================

export const heartbeatSourceTypes = [
    "email",     // IMAP/SMTP inbox polling
    "slack",     // Slack channel or DM watch
    "jira",      // Jira project/board queue
    "db_inbox",  // Internal Oddjob inbox table
    "webhook",   // Passive inbound webhook listener
    "rss",       // RSS/Atom feed
] as const;
export type HeartbeatSourceType = (typeof heartbeatSourceTypes)[number];

// ============================================================================
// HEARTBEAT TRIGGERS TABLE
// Each row is a continuous polling specification for one org/agent pair.
// The HeartbeatWorker reads all active rows on startup and schedules
// repeatable BullMQ jobs for each, using pollingIntervalMs as the repeat delay.
// ============================================================================

export const heartbeatTriggers = pgTable("heartbeat_triggers", {
    id: serial("id").primaryKey(),

    // Tenant context
    orgId: integer("org_id")
        .notNull()
        .references(() => orgs.id, { onDelete: "cascade" }),

    // Which deployed agent should receive newly discovered items as missions
    agentDeploymentId: integer("agent_deployment_id")
        .references(() => agentDeployments.id, { onDelete: "set null" }),

    // Human-readable label
    name: varchar("name", { length: 120 }).notNull(),
    description: text("description"),

    // Source type — determines which polling adapter to use
    sourceType: varchar("source_type", { length: 50 })
        .notNull()
        .$type<HeartbeatSourceType>(),

    // Adapter-specific configuration (API keys, channel IDs, filters, etc.)
    // Stored as opaque JSONB so each adapter can define its own shape.
    sourceConfig: jsonb("source_config").notNull().default({}),

    // How often to poll (milliseconds)
    pollingIntervalMs: integer("polling_interval_ms").default(60_000).notNull(),

    // Watermark / cursor for deduplication — updated after each poll
    lastItemId: text("last_item_id"),
    lastPolledAt: timestamp("last_polled_at"),

    // Mission template fields injected into auto-created missions
    missionTitleTemplate: text("mission_title_template"),  // e.g. "Triage: {{subject}}"
    missionPriority: varchar("mission_priority", { length: 20 }).default("normal"), // 'low'|'normal'|'high'

    isActive: boolean("is_active").default(true).notNull(),

    createdBy: text("created_by").notNull().default("system"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
    index("idx_heartbeat_triggers_org").on(table.orgId),
    index("idx_heartbeat_triggers_active").on(table.isActive),
    index("idx_heartbeat_triggers_agent").on(table.agentDeploymentId),
]);

// ============================================================================
// ZOD SCHEMAS & TYPES
// ============================================================================

export const insertHeartbeatTriggerSchema = createInsertSchema(heartbeatTriggers, {
    name: z.string().min(1, "Trigger name is required").max(120),
    sourceType: z.enum(heartbeatSourceTypes),
    sourceConfig: z.record(z.any()),
    pollingIntervalMs: z.number().int().min(10_000).max(86_400_000), // 10s – 24h
    missionPriority: z.enum(["low", "normal", "high"]).optional(),
}).omit({ id: true, createdAt: true, updatedAt: true, lastPolledAt: true });

export const updateHeartbeatTriggerSchema = insertHeartbeatTriggerSchema.partial().omit({
    orgId: true,
});

export type HeartbeatTrigger = typeof heartbeatTriggers.$inferSelect;
export type InsertHeartbeatTrigger = z.infer<typeof insertHeartbeatTriggerSchema>;
export type UpdateHeartbeatTrigger = z.infer<typeof updateHeartbeatTriggerSchema>;
