import { pgTable, integer, text, timestamp, primaryKey, uniqueIndex, index } from "drizzle-orm/pg-core";
import { orgs } from "./auth.js";

/** Public connection metadata only. Secrets live in encrypted_credentials. */
export const agentmailConnections = pgTable("agentmail_connections", {
    organizationId: integer("organization_id").primaryKey().references(() => orgs.id, { onDelete: "cascade" }),
    inboxId: text("inbox_id").notNull().unique(),
    /** The organization's own AgentMail webhook, limited to inboxId. Null: none registered (inbound by polling). */
    webhookId: text("webhook_id"),
    /** SHA-256 of the opaque token in the webhook URL. The token itself is never stored. */
    webhookTokenHash: text("webhook_token_hash"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    webhookTokenHashUnique: uniqueIndex("agentmail_connections_webhook_token_hash_unq").on(table.webhookTokenHash),
}));

/** Delivered webhook events, so a retried delivery (same event_id) is handled once. */
export const agentmailWebhookEvents = pgTable("agentmail_webhook_events", {
    organizationId: integer("organization_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    eventId: text("event_id").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    pk: primaryKey({ columns: [table.organizationId, table.eventId] }),
}));

/**
 * Which project an AgentMail thread belongs to. No row, or no project: the whole
 * organization may read it. projectId has no foreign key on purpose, so a thread
 * whose project is deleted stays hidden instead of falling open.
 */
export const agentmailThreads = pgTable("agentmail_threads", {
    organizationId: integer("organization_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    threadId: text("thread_id").notNull(),
    projectId: integer("project_id"),
    crewSessionId: integer("crew_session_id"),
    missionRunId: integer("mission_run_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    pk: primaryKey({ columns: [table.organizationId, table.threadId] }),
    projectIdx: index("agentmail_threads_project_idx").on(table.organizationId, table.projectId),
}));
